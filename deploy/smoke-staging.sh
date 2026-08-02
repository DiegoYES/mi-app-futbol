#!/usr/bin/env bash
# Smoke test del entorno de staging. No toca MongoDB directamente ni ejecuta
# sincronizaciones. OJO: no es 100% de sólo lectura a nivel de aplicación —
# el login actualiza ultimo_acceso/ip del usuario de staging y
# GET /api/picks/seguimiento puede liquidar picks pendientes de esa cuenta.
# Ambas escrituras ocurren únicamente en la base de staging.
#
# Uso:   deploy/smoke-staging.sh [commit]
#        Si no se pasa commit, se lee ${STAGING_DIR}/DEPLOYED_COMMIT.
# Vars:  STAGING_BASE_URL        (por defecto https://staging.data-fut.com)
#        STAGING_SMOKE_EMAIL     cuenta de staging (obligatoria; jamás una de producción)
#        STAGING_SMOKE_PASSWORD  contraseña de esa cuenta (obligatoria)
#        STAGING_DIR             (por defecto /opt/mi-app-futbol-staging)
#        RUN_PLAYWRIGHT=1        además ejecuta deploy/smoke-staging.playwright.js
#
# Si todo pasa, registra el commit como VALIDADO en:
#   ${STAGING_DIR}/VALIDATED_COMMIT   (el único que promote-production.sh acepta)
#   ${STAGING_DIR}/VALIDATED_HISTORY  (historial para rollback)
set -euo pipefail

BASE_URL="${STAGING_BASE_URL:-https://staging.data-fut.com}"
STAGING_DIR="${STAGING_DIR:-/opt/mi-app-futbol-staging}"
EMAIL="${STAGING_SMOKE_EMAIL:-}"
PASSWORD="${STAGING_SMOKE_PASSWORD:-}"

fallo() { echo "ERROR: $*" >&2; exit 1; }

case "${BASE_URL}" in
  *//data-fut.com*|*//www.data-fut.com*) fallo "STAGING_BASE_URL apunta a PRODUCCIÓN (${BASE_URL}); abortando." ;;
esac
[ -n "${EMAIL}" ] || fallo "define STAGING_SMOKE_EMAIL (cuenta exclusiva de staging)."
[ -n "${PASSWORD}" ] || fallo "define STAGING_SMOKE_PASSWORD."

COMMIT="${1:-}"
DESPLEGADO=""
[ -f "${STAGING_DIR}/DEPLOYED_COMMIT" ] && DESPLEGADO="$(cat "${STAGING_DIR}/DEPLOYED_COMMIT")"
if [ -z "${COMMIT}" ]; then
  COMMIT="${DESPLEGADO}"
fi
[ -n "${COMMIT}" ] || fallo "no sé qué commit validar: pásalo como argumento o despliega antes con deploy-staging.sh."
# Sólo puede validarse el commit que staging está sirviendo AHORA. Impide
# probar la versión A y registrar la B como validada.
[ -n "${DESPLEGADO}" ] || fallo "no existe ${STAGING_DIR}/DEPLOYED_COMMIT: despliega primero con deploy-staging.sh."
[ "${COMMIT}" = "${DESPLEGADO}" ] || fallo "el commit indicado (${COMMIT}) no coincide con el desplegado en staging (${DESPLEGADO}); no se valida."

COOKIES="$(mktemp)"
CUERPO="$(mktemp)"
trap 'rm -f "${COOKIES}" "${CUERPO}"' EXIT
FALLOS=0

comprobar() { # comprobar <descripcion> <esperado> <obtenido>
  if [ "$3" = "$2" ]; then
    echo "  OK    $1"
  else
    echo "  FALLO $1 (esperado $2, obtenido $3)"
    FALLOS=$((FALLOS + 1))
  fi
}

http_get() { curl -sS -o "${CUERPO}" -w '%{http_code}' -b "${COOKIES}" "${BASE_URL}$1"; }

echo "== Smoke test contra ${BASE_URL} (commit ${COMMIT}) =="

echo "-- Salud --"
comprobar "/health/live"  200 "$(http_get /health/live)"
comprobar "/health/ready" 200 "$(http_get /health/ready)"

echo "-- Cabeceras de seguridad en / --"
HEADERS="$(curl -sSI "${BASE_URL}/")"
for cabecera in 'content-security-policy' 'strict-transport-security' 'x-content-type-options'; do
  if printf '%s' "${HEADERS}" | grep -qi "^${cabecera}:"; then
    echo "  OK    ${cabecera}"
  else
    echo "  FALLO falta la cabecera ${cabecera}"
    FALLOS=$((FALLOS + 1))
  fi
done

echo "-- Banner de entorno --"
comprobar "portada responde 200" 200 "$(http_get /)"
if grep -q 'ENTORNO DE PRUEBA' "${CUERPO}"; then
  echo "  OK    banner ENTORNO DE PRUEBA presente"
else
  echo "  FALLO el banner ENTORNO DE PRUEBA no aparece (¿APP_ENVIRONMENT=staging?)"
  FALLOS=$((FALLOS + 1))
fi

echo "-- Login (cuenta de staging) --"
CODIGO_LOGIN="$(curl -sS -o "${CUERPO}" -w '%{http_code}' -c "${COOKIES}" \
  -H 'Content-Type: application/json' \
  -H "Origin: ${BASE_URL}" \
  --data "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  "${BASE_URL}/api/auth/login")"
comprobar "POST /api/auth/login" 200 "${CODIGO_LOGIN}"

echo "-- Páginas y API autenticadas --"
# Nota: /api/picks/seguimiento puede liquidar picks pendientes de la cuenta de
# staging (escritura acotada a la base -staging).
comprobar "portada autenticada /"            200 "$(http_get /)"
comprobar "calendario /calendario.html"      200 "$(http_get /calendario.html)"
comprobar "comparador /comparador.html"      200 "$(http_get /comparador.html)"
comprobar "centro de partido /partido.html"  200 "$(http_get /partido.html)"
comprobar "picks /picks.html"                200 "$(http_get /picks.html)"
comprobar "boletas /boletas.html"            200 "$(http_get /boletas.html)"
comprobar "GET /api/home/resumen"            200 "$(http_get /api/home/resumen)"
comprobar "GET /api/calendario/proximos"     200 "$(http_get /api/calendario/proximos)"
comprobar "GET /api/picks/seguimiento"       200 "$(http_get /api/picks/seguimiento)"
comprobar "GET /api/boletas"                 200 "$(http_get /api/boletas)"

if [ "${RUN_PLAYWRIGHT:-0}" = "1" ]; then
  echo "-- Playwright (escritorio + móvil, errores JS, duplicados) --"
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if STAGING_BASE_URL="${BASE_URL}" STAGING_SMOKE_EMAIL="${EMAIL}" STAGING_SMOKE_PASSWORD="${PASSWORD}" \
     node "${SCRIPT_DIR}/smoke-staging.playwright.js"; then
    echo "  OK    Playwright"
  else
    echo "  FALLO Playwright"
    FALLOS=$((FALLOS + 1))
  fi
fi

if [ "${FALLOS}" -gt 0 ]; then
  echo "== ${FALLOS} comprobaciones fallaron: el commit ${COMMIT} NO se registra como validado =="
  exit 1
fi

if [ -d "${STAGING_DIR}" ] && [ -w "${STAGING_DIR}" ]; then
  printf '%s\n' "${COMMIT}" > "${STAGING_DIR}/VALIDATED_COMMIT"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${COMMIT}" >> "${STAGING_DIR}/VALIDATED_HISTORY"
  echo "== Todo pasó. Commit ${COMMIT} registrado como VALIDADO en ${STAGING_DIR}/VALIDATED_COMMIT =="
else
  echo "== Todo pasó, pero no puedo escribir en ${STAGING_DIR}: registra el commit manualmente =="
  exit 1
fi
