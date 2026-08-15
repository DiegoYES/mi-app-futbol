#!/usr/bin/env bash
# Instala el backup diario sin ejecutarlo automáticamente. Requiere confirmación
# literal y se niega a sobrescribir una instalación previa.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DEST="/usr/local/sbin/data-fut-mongo-backup"
SERVICE_DEST="/etc/systemd/system/data-fut-mongo-backup.service"
TIMER_DEST="/etc/systemd/system/data-fut-mongo-backup.timer"
BACKUP_DIR="/var/backups/data-fut-mongodb"

fallo() { echo "ERROR: $*" >&2; exit 1; }
[ "${EUID}" -eq 0 ] || fallo "ejecuta mediante sudo."
for ARCHIVO in data-fut-mongo-backup data-fut-mongo-backup.service data-fut-mongo-backup.timer; do
  [ -f "${SCRIPT_DIR}/${ARCHIVO}" ] || fallo "falta ${SCRIPT_DIR}/${ARCHIVO}."
done
for DESTINO in "${BIN_DEST}" "${SERVICE_DEST}" "${TIMER_DEST}"; do
  [ ! -e "${DESTINO}" ] || fallo "ya existe ${DESTINO}; no se sobrescribe."
done
[ -f /etc/mi-app-futbol/app.env ] || fallo "falta el entorno productivo."

echo "Destino de copias: ${BACKUP_DIR}"
echo "Horario: diario 03:35 UTC + retraso aleatorio máximo de 10 minutos"
echo "Retención: 7 días; la base no se modifica."
printf 'Escribe exactamente INSTALAR_BACKUP para continuar: '
read -r CONFIRMACION
[ "${CONFIRMACION}" = INSTALAR_BACKUP ] || fallo "confirmación incorrecta; no se hace nada."

limpiar_instalacion_incompleta() {
  systemctl disable --now data-fut-mongo-backup.timer >/dev/null 2>&1 || true
  rm -f -- "${BIN_DEST}" "${SERVICE_DEST}" "${TIMER_DEST}"
  systemctl daemon-reload >/dev/null 2>&1 || true
}
trap limpiar_instalacion_incompleta ERR

install -d -o root -g root -m 700 "${BACKUP_DIR}"
install -o root -g root -m 700 "${SCRIPT_DIR}/data-fut-mongo-backup" "${BIN_DEST}"
systemd-analyze verify "${SCRIPT_DIR}/data-fut-mongo-backup.service" "${SCRIPT_DIR}/data-fut-mongo-backup.timer"
install -o root -g root -m 644 "${SCRIPT_DIR}/data-fut-mongo-backup.service" "${SERVICE_DEST}"
install -o root -g root -m 644 "${SCRIPT_DIR}/data-fut-mongo-backup.timer" "${TIMER_DEST}"
systemctl daemon-reload
systemctl enable --now data-fut-mongo-backup.timer
trap - ERR
echo "Backup diario instalado. Ejecuta y valida ahora: systemctl start data-fut-mongo-backup.service"
