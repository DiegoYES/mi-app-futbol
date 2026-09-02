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
#        STAGING_DIR             (por defecto /var/www/mi-app-futbol-staging)
#        STAGING_PM2_APP         proceso PM2 de staging (por defecto futbol-staging)
#        STAGING_SECONDARY_PM2_APP / STAGING_SECONDARY_PORT
#                                segunda instancia local (futbol-staging-2 / 3101)
#        SMOKE_REMOTE=1          omite la verificación local de PM2/clon (para
#                                ejecutar el smoke desde otra máquina)
#        STAGING_BASIC_AUTH_USER / STAGING_BASIC_AUTH_PASSWORD
#                                credenciales HTTP opcionales si Nginx protege
#                                staging con auth_basic (nunca hardcodeadas)
#        RUN_PLAYWRIGHT=1        además ejecuta deploy/smoke-staging.playwright.js
#
# Si todo pasa, registra el commit como VALIDADO en:
#   ${STAGING_DIR}/VALIDATED_COMMIT   (el único que promote-production.sh acepta)
#   ${STAGING_DIR}/VALIDATED_HISTORY  (historial para rollback)
set -euo pipefail

BASE_URL="${STAGING_BASE_URL:-https://staging.data-fut.com}"
STAGING_DIR="${STAGING_DIR:-/var/www/mi-app-futbol-staging}"
STAGING_PM2_APP="${STAGING_PM2_APP:-futbol-staging}"
STAGING_PORT="${STAGING_PORT:-3100}"
STAGING_SECONDARY_PM2_APP="${STAGING_SECONDARY_PM2_APP:-${STAGING_PM2_APP}-2}"
STAGING_SECONDARY_PORT="${STAGING_SECONDARY_PORT:-3101}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
# Acepta un SHA abreviado, pero resuélvelo siempre contra el clon local para
# comparar y registrar la identidad completa del commit desplegado.
if [ -d "${STAGING_DIR}/.git" ]; then
  git -C "${STAGING_DIR}" cat-file -e "${COMMIT}^{commit}" 2>/dev/null \
    || fallo "el commit indicado (${COMMIT}) no existe en el clon de staging."
  COMMIT="$(git -C "${STAGING_DIR}" rev-parse "${COMMIT}^{commit}")"
fi
# Sólo puede validarse el commit que staging está sirviendo AHORA. Impide
# probar la versión A y registrar la B como validada.
[ -n "${DESPLEGADO}" ] || fallo "no existe ${STAGING_DIR}/DEPLOYED_COMMIT: despliega primero con deploy-staging.sh."
[ "${COMMIT}" = "${DESPLEGADO}" ] || fallo "el commit indicado (${COMMIT}) no coincide con el desplegado en staging (${DESPLEGADO}); no se valida."

# --- Coherencia con PM2 y el clon de staging ----------------------------------
# Verifica que el proceso PM2 correcto (nombre, script, cwd, estado) sirve
# exactamente el commit a validar. SMOKE_REMOTE=1 lo omite si el smoke corre
# desde otra máquina sin acceso a PM2 ni al clon.
if [ "${SMOKE_REMOTE:-0}" != "1" ]; then
  command -v pm2 >/dev/null || fallo "pm2 no está disponible (usa SMOKE_REMOTE=1 sólo desde otra máquina)."
  JLIST="$(pm2 jlist)"
  validar_proceso_pm2() {
    local APP="$1" PUERTO="$2" ESTADO_PM2 CWD_PM2 SCRIPT_PM2
    ESTADO_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${APP}" status)" \
      || fallo "no existe el proceso PM2 '${APP}'; despliega antes con deploy-staging.sh."
    [ "${ESTADO_PM2}" = "online" ] || fallo "el proceso ${APP} no está online (estado: ${ESTADO_PM2})."
    CWD_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${APP}" cwd)"
    [ "${CWD_PM2}" = "${STAGING_DIR}" ] \
      || fallo "el proceso ${APP} ejecuta desde '${CWD_PM2}', no desde ${STAGING_DIR}."
    SCRIPT_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${APP}" script)"
    case "${SCRIPT_PM2}" in
      */server.js) : ;;
      *) fallo "el proceso ${APP} ejecuta '${SCRIPT_PM2}', no server.js." ;;
    esac
    curl -fsS "http://127.0.0.1:${PUERTO}/health/ready" >/dev/null \
      || fallo "${APP} no está listo en el puerto ${PUERTO}."
  }
  validar_proceso_pm2 "${STAGING_PM2_APP}" "${STAGING_PORT}"
  validar_proceso_pm2 "${STAGING_SECONDARY_PM2_APP}" "${STAGING_SECONDARY_PORT}"
  [ -d "${STAGING_DIR}/.git" ] || fallo "${STAGING_DIR} no es un clon git."
  HEAD_CLON="$(git -C "${STAGING_DIR}" rev-parse HEAD)"
  [ "${HEAD_CLON}" = "${COMMIT}" ] \
    || fallo "el clon de staging tiene HEAD ${HEAD_CLON}, no el commit a validar (${COMMIT}); vuelve a desplegar."
fi

# Una repetición del smoke debe revalidar desde cero. Si cualquier comprobación
# posterior falla o el proceso se interrumpe, no puede sobrevivir un marcador
# exitoso de una ejecución anterior.
[ -w "${STAGING_DIR}" ] || fallo "no puedo actualizar la validación en ${STAGING_DIR}."
rm -f "${STAGING_DIR}/VALIDATED_COMMIT"

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

# Autenticación básica opcional de Nginx. Usuario y contraseña deben llegar
# JUNTOS. La credencial se pasa mediante un archivo de configuración temporal
# de curl (-K) con permisos 600, nunca en la línea de comandos.
CURL_AUTH=()
if [ -n "${STAGING_BASIC_AUTH_USER:-}" ] || [ -n "${STAGING_BASIC_AUTH_PASSWORD:-}" ]; then
  [ -n "${STAGING_BASIC_AUTH_USER:-}" ] && [ -n "${STAGING_BASIC_AUTH_PASSWORD:-}" ] \
    || fallo "define STAGING_BASIC_AUTH_USER y STAGING_BASIC_AUTH_PASSWORD juntos, o ninguno."
  # El formato de curl -K usa comillas dobles y barra invertida como escape;
  # además el usuario no puede contener ':'. Rechazamos esos caracteres y los
  # de control en lugar de intentar escaparlos.
  case "${STAGING_BASIC_AUTH_USER}" in
    *[\"\\:]*) fallo 'STAGING_BASIC_AUTH_USER no puede contener comillas dobles, barras invertidas ni ":".' ;;
  esac
  case "${STAGING_BASIC_AUTH_PASSWORD}" in
    *[\"\\]*) fallo 'STAGING_BASIC_AUTH_PASSWORD no puede contener comillas dobles ni barras invertidas.' ;;
  esac
  case "${STAGING_BASIC_AUTH_USER}${STAGING_BASIC_AUTH_PASSWORD}" in
    *[$'\n\r\t']*) fallo 'las credenciales de auth_basic no pueden contener caracteres de control.' ;;
  esac
  CURL_CFG="$(mktemp)"
  chmod 600 "${CURL_CFG}"
  printf 'user = "%s:%s"\n' "${STAGING_BASIC_AUTH_USER}" "${STAGING_BASIC_AUTH_PASSWORD}" > "${CURL_CFG}"
  CURL_AUTH=(-K "${CURL_CFG}")
  trap 'rm -f "${COOKIES}" "${CUERPO}" "${CURL_CFG}"' EXIT
fi

http_get() { curl -sS "${CURL_AUTH[@]+"${CURL_AUTH[@]}"}" -o "${CUERPO}" -w '%{http_code}' -b "${COOKIES}" "${BASE_URL}$1"; }

echo "== Smoke test contra ${BASE_URL} (commit ${COMMIT}) =="

echo "-- Salud --"
comprobar "/health/live"  200 "$(http_get /health/live)"
comprobar "/health/ready" 200 "$(http_get /health/ready)"

echo "-- Cabeceras de seguridad en / --"
HEADERS="$(curl -sSI "${CURL_AUTH[@]+"${CURL_AUTH[@]}"}" "${BASE_URL}/")"
for cabecera in 'content-security-policy' 'strict-transport-security' 'x-content-type-options' 'permissions-policy'; do
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
if [ -S /run/redis/redis-server.sock ]; then
  redis-cli -s /run/redis/redis-server.sock keys "datafut:staging:rate-limit:*" 2>/dev/null | xargs -r redis-cli -s /run/redis/redis-server.sock del >/dev/null 2>&1 || true
fi
CODIGO_LOGIN="$(curl -sS "${CURL_AUTH[@]+"${CURL_AUTH[@]}"}" -o "${CUERPO}" -w '%{http_code}' -c "${COOKIES}" \
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
comprobar "competiciones /competiciones.html" 200 "$(http_get /competiciones.html)"
comprobar "centro de competición /competicion.html" 200 "$(http_get '/competicion.html?id=39')"
comprobar "GET /api/home/resumen"            200 "$(http_get /api/home/resumen)"
comprobar "GET /api/home/competiciones"       200 "$(http_get /api/home/competiciones)"
comprobar "GET /api/calendario/proximos"     200 "$(http_get /api/calendario/proximos)"
comprobar "GET /api/picks/seguimiento"       200 "$(http_get /api/picks/seguimiento)"
comprobar "GET /api/boletas"                 200 "$(http_get /api/boletas)"

if [ "${RUN_PLAYWRIGHT:-0}" = "1" ]; then
  echo "-- Playwright (escritorio + móvil, errores JS, duplicados) --"
  if [ -S /run/redis/redis-server.sock ]; then
    redis-cli -s /run/redis/redis-server.sock keys "datafut:staging:rate-limit:*" 2>/dev/null | xargs -r redis-cli -s /run/redis/redis-server.sock del >/dev/null 2>&1 || true
  fi
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
