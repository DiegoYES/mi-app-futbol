#!/usr/bin/env bash
# FASE 2 (NO ejecutar en la fase actual): migración de producción de
# PM2/root (proceso futbol-app en /var/www/mi-app-futbol) a un servicio
# systemd con usuario restringido, según deploy/mi-app-futbol.service.
#
# REQUIERE autorización explícita y una ventana de mantenimiento: detiene el
# proceso PM2 y arranca el servicio systemd. Si el servicio no queda
# saludable, RESTAURA el proceso PM2 automáticamente.
#
# Uso:   deploy/migrate-production-systemd.sh
# Vars:  PROD_DIR       (por defecto /var/www/mi-app-futbol)
#        PROD_PM2_APP   (por defecto futbol-app)
#        PROD_SERVICE   (por defecto mi-app-futbol)
#        PROD_PORT      (por defecto 3000)
#        PROD_USER      usuario restringido del servicio (por defecto miappfutbol)
#        RELEASES_DIR   (por defecto /opt/mi-app-futbol)
#
# Qué hace, en orden y con verificación en cada paso:
#  1. Verifica por PM2 que futbol-app está online con el script y cwd esperados
#     y detecta el commit exacto que ejecuta (git en su cwd).
#  2. Instala ese mismo commit como release inicial en ${RELEASES_DIR}/releases/<sha>
#     (aborta ante cualquier divergencia; no es un mecanismo de despliegue).
#  3. Crea el symlink current y DEPLOYED_COMMIT; verifica propietario (PROD_USER
#     debe existir) y que current/server.js existe.
#  4. Instala el unit systemd (no debe existir uno previo), daemon-reload.
#  5. pm2 stop (NO delete: la definición se conserva para poder restaurar),
#     systemctl start, health check.
#  6. Restauración transaccional ante cualquier fallo: detiene y deshabilita el
#     unit, elimina el unit instalado por este script, restaura symlink y
#     DEPLOYED_COMMIT (o su ausencia) y rearranca el proceso PM2 original.
#  7. Sólo si todo queda saludable sugiere el paso final manual y autorizado:
#     pm2 delete futbol-app && pm2 save, y actualizar EnvironmentFile/Nginx.
#
# No toca MongoDB, DNS, certificados ni Nginx. Exige teclear MIGRAR.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="${PROD_DIR:-/var/www/mi-app-futbol}"
PROD_PM2_APP="${PROD_PM2_APP:-futbol-app}"
PROD_SERVICE="${PROD_SERVICE:-mi-app-futbol}"
PROD_PORT="${PROD_PORT:-3000}"
PROD_USER="${PROD_USER:-miappfutbol}"
RELEASES_DIR="${RELEASES_DIR:-/opt/mi-app-futbol}"
UNIT_PATH="/etc/systemd/system/${PROD_SERVICE}.service"
PLANTILLA_UNIT="${SCRIPT_DIR}/mi-app-futbol.service"

fallo() { echo "ERROR: $*" >&2; exit 1; }

[ -d "${PROD_DIR}/.git" ] || fallo "PROD_DIR no es un repositorio git: ${PROD_DIR}"
[ -f "${PLANTILLA_UNIT}" ] || fallo "no existe la plantilla de unit: ${PLANTILLA_UNIT}"
[ ! -f "${UNIT_PATH}" ] || fallo "ya existe ${UNIT_PATH}; esta migración espera partir de PM2 sin unit previo."
command -v pm2 >/dev/null || fallo "pm2 no está disponible."
command -v systemctl >/dev/null || fallo "systemctl no está disponible."
id "${PROD_USER}" >/dev/null 2>&1 \
  || fallo "no existe el usuario ${PROD_USER}; créalo antes de migrar (usuario sin privilegios para el servicio)."
grep -q "EnvironmentFile=" "${PLANTILLA_UNIT}" \
  || fallo "la plantilla ${PLANTILLA_UNIT} no define EnvironmentFile."
ENV_FILE="$(sed -n 's/^EnvironmentFile=//p' "${PLANTILLA_UNIT}" | head -1)"
[ -f "${ENV_FILE}" ] || fallo "no existe ${ENV_FILE}; créalo (permisos 600) antes de migrar."

# --- 1. Detectar el estado real vía PM2 --------------------------------------
JLIST="$(pm2 jlist)"
ESTADO="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${PROD_PM2_APP}" status)" \
  || fallo "no existe el proceso PM2 '${PROD_PM2_APP}'."
[ "${ESTADO}" = "online" ] || fallo "el proceso ${PROD_PM2_APP} no está online (estado: ${ESTADO})."
CWD_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${PROD_PM2_APP}" cwd)"
[ "${CWD_PM2}" = "${PROD_DIR}" ] || fallo "el proceso ${PROD_PM2_APP} ejecuta desde '${CWD_PM2}', no desde ${PROD_DIR}."
SCRIPT_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${PROD_PM2_APP}" script)"
case "${SCRIPT_PM2}" in
  */server.js) : ;;
  *) fallo "el proceso ${PROD_PM2_APP} ejecuta '${SCRIPT_PM2}', no server.js." ;;
esac
SHA="$(git -C "${PROD_DIR}" rev-parse HEAD)"

echo "Migración PM2 -> systemd (FASE 2):"
echo "  Proceso PM2    : ${PROD_PM2_APP} (online, cwd ${CWD_PM2})"
echo "  Commit actual  : ${SHA}"
echo "  Release en     : ${RELEASES_DIR}/releases/${SHA}"
echo "  Servicio nuevo : ${PROD_SERVICE} (${UNIT_PATH})"
echo "Este proceso detiene PM2 y arranca systemd UNA vez; restaura PM2 si falla."
printf 'Escribe exactamente MIGRAR para continuar: '
read -r CONFIRMACION
[ "${CONFIRMACION}" = "MIGRAR" ] || fallo "confirmación incorrecta; no se hace nada."

# --- 2. Release inicial: exactamente el commit que PM2 ejecuta ----------------
RELEASE_DIR="${RELEASES_DIR}/releases/${SHA}"
mkdir -p "${RELEASES_DIR}/releases"
if [ ! -f "${RELEASE_DIR}/.release-ok" ]; then
  mkdir -p "${RELEASE_DIR}"
  echo "Exportando commit ${SHA} a ${RELEASE_DIR}..."
  git -C "${PROD_DIR}" archive "${SHA}" | tar -x -C "${RELEASE_DIR}"
  [ -f "${RELEASE_DIR}/server.js" ] || fallo "la exportación no contiene server.js; abortando."
  (cd "${RELEASE_DIR}" && npm ci --omit=dev --no-audit --no-fund)
  mkdir -p "${RELEASE_DIR}/var"
  touch "${RELEASE_DIR}/.release-ok"
fi
chown -R "${PROD_USER}:${PROD_USER}" "${RELEASE_DIR}" 2>/dev/null \
  || sudo chown -R "${PROD_USER}:${PROD_USER}" "${RELEASE_DIR}"

# --- 3. Fase transaccional -----------------------------------------------------
CURRENT_PREVIO=""
CURRENT_EXISTIA=0
if [ -L "${RELEASES_DIR}/current" ]; then
  CURRENT_EXISTIA=1
  CURRENT_PREVIO="$(readlink "${RELEASES_DIR}/current")"
elif [ -e "${RELEASES_DIR}/current" ]; then
  fallo "${RELEASES_DIR}/current existe y no es un symlink; resuélvelo manualmente."
fi
DEPLOYED_PREVIO=""
DEPLOYED_EXISTIA=0
if [ -f "${RELEASES_DIR}/DEPLOYED_COMMIT" ]; then
  DEPLOYED_EXISTIA=1
  DEPLOYED_PREVIO="$(cat "${RELEASES_DIR}/DEPLOYED_COMMIT")"
fi
UNIT_INSTALADO=0
PM2_DETENIDO=0
TRANSACCION_OK=0
RESTAURADO=0

restaurar_estado() {
  [ "${TRANSACCION_OK}" = "1" ] && return 0
  [ "${RESTAURADO}" = "1" ] && return 0
  RESTAURADO=1
  set +e
  echo "RESTAURANDO estado previo de la migración..." >&2
  if [ "${UNIT_INSTALADO}" = "1" ]; then
    sudo systemctl stop "${PROD_SERVICE}" 2>/dev/null
    sudo systemctl disable "${PROD_SERVICE}" 2>/dev/null
    sudo rm -f "${UNIT_PATH}"
    sudo systemctl daemon-reload
  fi
  if [ "${CURRENT_EXISTIA}" = "1" ]; then
    ln -sfn "${CURRENT_PREVIO}" "${RELEASES_DIR}/current"
  else
    rm -f "${RELEASES_DIR}/current"
  fi
  if [ "${DEPLOYED_EXISTIA}" = "1" ]; then
    printf '%s\n' "${DEPLOYED_PREVIO}" > "${RELEASES_DIR}/DEPLOYED_COMMIT"
  else
    rm -f "${RELEASES_DIR}/DEPLOYED_COMMIT"
  fi
  if [ "${PM2_DETENIDO}" = "1" ]; then
    pm2 restart "${PROD_PM2_APP}" --update-env
    for _ in $(seq 1 20); do
      if curl -fsS "http://127.0.0.1:${PROD_PORT}/health/ready" >/dev/null 2>&1; then
        echo "Producción quedó restaurada y saludable con PM2 (${PROD_PM2_APP})." >&2
        return 0
      fi
      sleep 2
    done
    echo "INTERVENCIÓN MANUAL URGENTE: PM2 no respondió /health/ready tras la restauración. Revisa pm2 logs ${PROD_PM2_APP}." >&2
  else
    echo "PM2 no llegó a detenerse; producción sigue sirviendo con PM2." >&2
  fi
}
trap restaurar_estado EXIT

ln -sfn "${RELEASE_DIR}" "${RELEASES_DIR}/current"
printf '%s\n' "${SHA}" > "${RELEASES_DIR}/DEPLOYED_COMMIT"
[ -f "${RELEASES_DIR}/current/server.js" ] || fallo "current/server.js no existe; abortando sin tocar PM2 ni systemd."

# --- 4. Instalar el unit (no existía) ------------------------------------------
echo "Instalando unit ${UNIT_PATH}..."
UNIT_INSTALADO=1
sudo cp "${PLANTILLA_UNIT}" "${UNIT_PATH}"
sudo systemctl daemon-reload

# --- 5. Conmutación: pm2 stop (sin delete) + systemd start ----------------------
echo "Deteniendo el proceso PM2 ${PROD_PM2_APP} (la definición se conserva)..."
PM2_DETENIDO=1
pm2 stop "${PROD_PM2_APP}"
echo "Arrancando ${PROD_SERVICE} con systemd..."
sudo systemctl start "${PROD_SERVICE}"

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
  sudo systemctl enable "${PROD_SERVICE}" >/dev/null 2>&1 || true
  printf '%s migracion-systemd -> %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SHA}" >> "${RELEASES_DIR}/RELEASE_HISTORY"
  echo "Migración completada: ${PROD_SERVICE} sirve el commit ${SHA} desde ${RELEASES_DIR}/current."
  echo "El proceso PM2 ${PROD_PM2_APP} quedó DETENIDO pero conservado. Pasos finales manuales (autorizados):"
  echo "  1. Observa el servicio un tiempo prudente: journalctl -u ${PROD_SERVICE} -f"
  echo "  2. Sólo entonces: pm2 delete ${PROD_PM2_APP} && pm2 save"
  echo "  3. Adapta los scripts de promoción/rollback al modelo systemd antes del siguiente despliegue."
  exit 0
fi

fallo "el servicio systemd no respondió /health/ready; se restaura PM2."
