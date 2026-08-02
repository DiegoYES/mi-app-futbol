#!/usr/bin/env bash
# Migración ÚNICA de producción al modelo de releases (current -> releases/<sha>).
# Resuelve el arranque circular: promote-production.sh y rollback-production.sh
# exigen que el servicio ejecute desde ${PROD_DIR}/current, y este script es el
# procedimiento seguro para llegar a ese estado por primera vez.
#
# Uso:   deploy/bootstrap-production-releases.sh [commit]
#        Sin argumento intenta detectar el commit que producción ejecuta ahora
#        (DEPLOYED_COMMIT o, si PROD_DIR es un checkout git, su HEAD).
# Vars:  REPO_DIR      repositorio git de origen
#        PROD_DIR      (por defecto /opt/mi-app-futbol)
#        PROD_SERVICE  (por defecto mi-app-futbol)
#        PROD_PORT     (por defecto 3000)
#        PROD_USER     propietario esperado de las releases (por defecto miappfutbol)
#
# Qué hace, en orden y con verificación en cada paso:
#  1. Detecta el commit actual de producción y lo instala como release inicial
#     en ${PROD_DIR}/releases/<sha> (sin tocar el código en ejecución).
#  2. Crea el symlink current y DEPLOYED_COMMIT.
#  3. Verifica propietario/permisos de la release.
#  4. Sólo cuando current/server.js existe, respalda el unit actual e instala
#     el nuevo (WorkingDirectory=current) desde deploy/mi-app-futbol.service.
#  5. daemon-reload + restart + health check.
#  6. Restauración TRANSACCIONAL: un trap activo desde antes de tocar current
#     restaura ante cualquier fallo (incluidos cp/daemon-reload/restart bajo
#     set -e) el unit anterior, el symlink current y DEPLOYED_COMMIT — o su
#     ausencia original — y reinicia el servicio con la configuración previa.
#
# Requiere ejecutarse con permisos para escribir en PROD_DIR y sudo para
# systemd. Exige confirmación explícita. No toca MongoDB. No borra nada:
# el unit anterior queda respaldado y el código antiguo queda intacto.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
PROD_DIR="${PROD_DIR:-/opt/mi-app-futbol}"
PROD_SERVICE="${PROD_SERVICE:-mi-app-futbol}"
PROD_PORT="${PROD_PORT:-3000}"
PROD_USER="${PROD_USER:-miappfutbol}"
UNIT_PATH="/etc/systemd/system/${PROD_SERVICE}.service"
PLANTILLA_UNIT="${SCRIPT_DIR}/mi-app-futbol.service"

fallo() { echo "ERROR: $*" >&2; exit 1; }

[ -d "${REPO_DIR}/.git" ] || fallo "REPO_DIR no es un repositorio git: ${REPO_DIR}"
[ -d "${PROD_DIR}" ] || fallo "no existe PROD_DIR: ${PROD_DIR}"
[ -f "${PLANTILLA_UNIT}" ] || fallo "no existe la plantilla de unit: ${PLANTILLA_UNIT}"
[ -f "${UNIT_PATH}" ] || fallo "no existe el unit instalado: ${UNIT_PATH}"
grep -q "WorkingDirectory=${PROD_DIR}/current" "${PLANTILLA_UNIT}" \
  || fallo "la plantilla ${PLANTILLA_UNIT} no usa WorkingDirectory=${PROD_DIR}/current."

WD_ACTUAL="$(systemctl show -p WorkingDirectory --value "${PROD_SERVICE}" 2>/dev/null || true)"
[ "${WD_ACTUAL}" != "${PROD_DIR}/current" ] \
  || fallo "el servicio ya ejecuta desde ${PROD_DIR}/current; usa promote-production.sh."

# --- 1. Detectar el commit que producción ejecuta actualmente ---------------
SHA_DETECTADO=""
if [ -f "${PROD_DIR}/DEPLOYED_COMMIT" ]; then
  SHA_DETECTADO="$(cat "${PROD_DIR}/DEPLOYED_COMMIT")"
elif [ -d "${PROD_DIR}/.git" ]; then
  SHA_DETECTADO="$(git -C "${PROD_DIR}" rev-parse HEAD)"
fi

COMMIT_PEDIDO="${1:-${SHA_DETECTADO}}"
[ -n "${COMMIT_PEDIDO}" ] || fallo "no pude detectar el commit actual de producción; indícalo como argumento."
git -C "${REPO_DIR}" cat-file -e "${COMMIT_PEDIDO}^{commit}" 2>/dev/null \
  || fallo "el commit '${COMMIT_PEDIDO}' no existe en ${REPO_DIR}."
SHA="$(git -C "${REPO_DIR}" rev-parse "${COMMIT_PEDIDO}^{commit}")"

# El bootstrap copia EXACTAMENTE la versión que producción ejecuta; no es un
# mecanismo de despliegue alternativo. Cualquier diferencia aborta.
if [ -n "${SHA_DETECTADO}" ] && [ "${SHA}" != "${SHA_DETECTADO}" ]; then
  fallo "el commit indicado (${SHA}) difiere del que producción ejecuta (${SHA_DETECTADO}).
El bootstrap sólo migra la versión productiva actual. Para cambiar de versión,
completa primero el bootstrap con ${SHA_DETECTADO} y luego usa el flujo normal
staging -> smoke -> promote-production.sh."
fi

echo "Bootstrap del modelo de releases en PRODUCCIÓN:"
echo "  Commit inicial : ${SHA}"
echo "  Directorio     : ${PROD_DIR}"
echo "  Servicio       : ${PROD_SERVICE} (WorkingDirectory actual: ${WD_ACTUAL:-desconocido})"
echo "  Unit           : ${UNIT_PATH} (se respaldará antes de tocarlo)"
echo "Este proceso reinicia producción UNA vez y no toca MongoDB."
printf 'Escribe exactamente BOOTSTRAP para continuar: '
read -r CONFIRMACION
[ "${CONFIRMACION}" = "BOOTSTRAP" ] || fallo "confirmación incorrecta; no se hace nada."

# --- 2. Instalar la release inicial (sin tocar el código en ejecución) ------
RELEASE_DIR="${PROD_DIR}/releases/${SHA}"
mkdir -p "${PROD_DIR}/releases"
if [ ! -f "${RELEASE_DIR}/.release-ok" ]; then
  mkdir -p "${RELEASE_DIR}"
  echo "Exportando commit ${SHA} a ${RELEASE_DIR}..."
  git -C "${REPO_DIR}" archive "${SHA}" | tar -x -C "${RELEASE_DIR}"
  [ -f "${RELEASE_DIR}/server.js" ] || fallo "la exportación no contiene server.js; abortando."
  (cd "${RELEASE_DIR}" && npm ci --omit=dev --no-audit --no-fund)
  mkdir -p "${RELEASE_DIR}/var"
  touch "${RELEASE_DIR}/.release-ok"
fi

# --- 3. Propietario y permisos ----------------------------------------------
id "${PROD_USER}" >/dev/null 2>&1 \
  || fallo "no existe el usuario ${PROD_USER}; créalo (o indica PROD_USER) antes del bootstrap."
chown -R "${PROD_USER}:${PROD_USER}" "${RELEASE_DIR}" 2>/dev/null \
  || sudo chown -R "${PROD_USER}:${PROD_USER}" "${RELEASE_DIR}"

# --- 4. Fase transaccional ----------------------------------------------------
# A partir de aquí cualquier fallo (incluidos cp, daemon-reload o restart bajo
# set -e) dispara la restauración completa del estado previo: unit, symlink
# current y DEPLOYED_COMMIT, incluyendo su AUSENCIA original.

# Estado previo exacto.
CURRENT_PREVIO=""            # destino previo del symlink, si existía
CURRENT_EXISTIA=0
if [ -L "${PROD_DIR}/current" ]; then
  CURRENT_EXISTIA=1
  CURRENT_PREVIO="$(readlink "${PROD_DIR}/current")"
elif [ -e "${PROD_DIR}/current" ]; then
  fallo "${PROD_DIR}/current existe y no es un symlink; resuélvelo manualmente antes del bootstrap."
fi
DEPLOYED_PREVIO=""
DEPLOYED_EXISTIA=0
if [ -f "${PROD_DIR}/DEPLOYED_COMMIT" ]; then
  DEPLOYED_EXISTIA=1
  DEPLOYED_PREVIO="$(cat "${PROD_DIR}/DEPLOYED_COMMIT")"
fi

RESPALDO_UNIT="${UNIT_PATH}.pre-releases.$(date -u +%Y%m%d%H%M%S)"
UNIT_MODIFICADO=0
TRANSACCION_OK=0
RESTAURADO=0

restaurar_estado() {
  [ "${TRANSACCION_OK}" = "1" ] && return 0
  [ "${RESTAURADO}" = "1" ] && return 0
  RESTAURADO=1
  set +e
  echo "RESTAURANDO estado previo del bootstrap..." >&2
  # 1) Metadatos: symlink current y DEPLOYED_COMMIT (o su ausencia).
  if [ "${CURRENT_EXISTIA}" = "1" ]; then
    ln -sfn "${CURRENT_PREVIO}" "${PROD_DIR}/current"
  else
    rm -f "${PROD_DIR}/current"
  fi
  if [ "${DEPLOYED_EXISTIA}" = "1" ]; then
    printf '%s\n' "${DEPLOYED_PREVIO}" > "${PROD_DIR}/DEPLOYED_COMMIT"
  else
    rm -f "${PROD_DIR}/DEPLOYED_COMMIT"
  fi
  # 2) Unit anterior + daemon-reload + reinicio con la configuración previa.
  if [ "${UNIT_MODIFICADO}" = "1" ] && [ -f "${RESPALDO_UNIT}" ]; then
    sudo cp "${RESPALDO_UNIT}" "${UNIT_PATH}"
    sudo systemctl daemon-reload
    sudo systemctl restart "${PROD_SERVICE}"
    for _ in $(seq 1 20); do
      if curl -fsS "http://127.0.0.1:${PROD_PORT}/health/ready" >/dev/null 2>&1; then
        echo "Producción quedó restaurada y saludable con el unit anterior (respaldo: ${RESPALDO_UNIT})." >&2
        return 0
      fi
      sleep 2
    done
    echo "INTERVENCIÓN MANUAL URGENTE: la restauración no respondió /health/ready. Revisa journalctl -u ${PROD_SERVICE}; unit respaldado en ${RESPALDO_UNIT}." >&2
  else
    echo "El unit no llegó a modificarse; el servicio sigue con su configuración original." >&2
  fi
}
# Con set -e cualquier fallo termina el script y dispara el trap EXIT, que
# restaura el estado previo completo. No usamos trap ERR: combinado con set -e
# puede continuar la ejecución tras restaurar y duplicar el trabajo.
trap restaurar_estado EXIT

ln -sfn "${RELEASE_DIR}" "${PROD_DIR}/current"
printf '%s\n' "${SHA}" > "${PROD_DIR}/DEPLOYED_COMMIT"
[ -f "${PROD_DIR}/current/server.js" ] || fallo "current/server.js no existe tras crear el symlink; abortando sin tocar el unit."

# --- 5. Respaldar e instalar el nuevo unit -----------------------------------
echo "Respaldando unit actual en ${RESPALDO_UNIT}..."
sudo cp "${UNIT_PATH}" "${RESPALDO_UNIT}"
echo "Instalando unit nuevo desde ${PLANTILLA_UNIT}..."
UNIT_MODIFICADO=1
sudo cp "${PLANTILLA_UNIT}" "${UNIT_PATH}"
sudo systemctl daemon-reload

echo "Reiniciando ${PROD_SERVICE} con el nuevo unit..."
sudo systemctl restart "${PROD_SERVICE}"

SALUDABLE=0
for intento in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PROD_PORT}/health/ready" >/dev/null 2>&1; then
    SALUDABLE=1
    break
  fi
  sleep 2
done

if [ "${SALUDABLE}" = "1" ]; then
  TRANSACCION_OK=1
  trap - EXIT
  printf '%s bootstrap -> %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SHA}" >> "${PROD_DIR}/RELEASE_HISTORY"
  echo "Bootstrap completado: producción ejecuta desde ${PROD_DIR}/current (commit ${SHA})."
  echo "Unit anterior respaldado en ${RESPALDO_UNIT}."
  echo "A partir de ahora usa deploy/promote-production.sh y deploy/rollback-production.sh."
  exit 0
fi

# --- 6. Health check fallido: el trap restaura unit, current y DEPLOYED_COMMIT.
fallo "producción no respondió /health/ready con el nuevo unit; se restaura el estado previo."
