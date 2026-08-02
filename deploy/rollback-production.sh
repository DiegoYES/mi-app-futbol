#!/usr/bin/env bash
# Revierte PRODUCCIÓN a un commit previamente registrado en RELEASE_HISTORY.
#
# Uso:   deploy/rollback-production.sh [commit]
#        Sin argumento, usa el commit anterior registrado en el historial.
# Vars:  PROD_DIR      (por defecto /opt/mi-app-futbol)
#        PROD_SERVICE  (por defecto mi-app-futbol)
#        PROD_PORT     (por defecto 3000)
#
# Garantías:
#  - Sólo activa releases que ya existen en ${PROD_DIR}/releases (instaladas y
#    verificadas en su momento); no reconstruye ni descarga nada.
#  - Verifica que el servicio ejecuta desde ${PROD_DIR}/current (si no, cambiar
#    el symlink no tendría efecto y el éxito sería falso).
#  - Exige confirmación explícita. No toca MongoDB. No borra nada.
set -euo pipefail

PROD_DIR="${PROD_DIR:-/opt/mi-app-futbol}"
PROD_SERVICE="${PROD_SERVICE:-mi-app-futbol}"
PROD_PORT="${PROD_PORT:-3000}"

fallo() { echo "ERROR: $*" >&2; exit 1; }

[ -d "${PROD_DIR}" ] || fallo "no existe PROD_DIR: ${PROD_DIR}"

WD_SERVICIO="$(systemctl show -p WorkingDirectory --value "${PROD_SERVICE}" 2>/dev/null || true)"
[ "${WD_SERVICIO}" = "${PROD_DIR}/current" ] \
  || fallo "el servicio ${PROD_SERVICE} ejecuta desde '${WD_SERVICIO:-desconocido}', no desde ${PROD_DIR}/current; el rollback por symlink no tendría efecto. Migra primero con deploy/bootstrap-production-releases.sh."

HISTORIAL="${PROD_DIR}/RELEASE_HISTORY"
[ -f "${HISTORIAL}" ] || fallo "no existe ${HISTORIAL}: no hay despliegues registrados a los que volver."

OBJETIVO="${1:-}"
if [ -z "${OBJETIVO}" ]; then
  # Última línea del historial: "<fecha> <commit_anterior> -> <commit_nuevo>".
  OBJETIVO="$(tail -n 1 "${HISTORIAL}" | awk '{print $2}')"
  [ -n "${OBJETIVO}" ] && [ "${OBJETIVO}" != "(desconocido)" ] \
    || fallo "el historial no registra un commit anterior utilizable; indícalo como argumento."
fi

grep -q "${OBJETIVO}" "${HISTORIAL}" || fallo "el commit ${OBJETIVO} no aparece en ${HISTORIAL}; sólo se permite volver a commits registrados."

RELEASE_DIR="${PROD_DIR}/releases/${OBJETIVO}"
[ -f "${RELEASE_DIR}/.release-ok" ] || fallo "la release ${OBJETIVO} no está instalada en ${RELEASE_DIR}."

ACTUAL="(desconocido)"
[ -f "${PROD_DIR}/DEPLOYED_COMMIT" ] && ACTUAL="$(cat "${PROD_DIR}/DEPLOYED_COMMIT")"

echo "Rollback de PRODUCCIÓN:"
echo "  Commit actual  : ${ACTUAL}"
echo "  Volver a       : ${OBJETIVO}"
printf 'Escribe exactamente ROLLBACK para continuar: '
read -r CONFIRMACION
[ "${CONFIRMACION}" = "ROLLBACK" ] || fallo "confirmación incorrecta; no se hace nada."

printf '%s %s -> %s (rollback)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${ACTUAL}" "${OBJETIVO}" >> "${HISTORIAL}"
ln -sfn "${RELEASE_DIR}" "${PROD_DIR}/current"
printf '%s\n' "${OBJETIVO}" > "${PROD_DIR}/DEPLOYED_COMMIT"

echo "Reiniciando ${PROD_SERVICE}..."
sudo systemctl restart "${PROD_SERVICE}"

for intento in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PROD_PORT}/health/ready" >/dev/null 2>&1; then
    echo "Rollback completado: producción sirve el commit ${OBJETIVO}."
    exit 0
  fi
  sleep 2
done
fallo "producción no respondió /health/ready tras el rollback; revisa journalctl -u ${PROD_SERVICE}."
