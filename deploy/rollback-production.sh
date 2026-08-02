#!/usr/bin/env bash
# Revierte PRODUCCIÓN (proceso PM2 "futbol-app") a un commit previamente
# registrado en RELEASE_HISTORY.
#
# Uso:   deploy/rollback-production.sh [commit]
#        Sin argumento, usa el commit anterior registrado en el historial.
# Vars:  PROD_DIR      (por defecto /var/www/mi-app-futbol)
#        PROD_PM2_APP  (por defecto futbol-app)
#        PROD_PORT     (por defecto 3000)
#
# Garantías:
#  - Sólo vuelve a commits que aparecen en ${PROD_DIR}/RELEASE_HISTORY.
#  - Valida por PM2 el nombre, script y cwd del proceso antes de tocarlo.
#  - Se niega si el árbol tiene cambios locales versionados.
#  - Exige confirmación explícita. No toca MongoDB. No borra nada.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="${PROD_DIR:-/var/www/mi-app-futbol}"
PROD_PM2_APP="${PROD_PM2_APP:-futbol-app}"
PROD_PORT="${PROD_PORT:-3000}"

fallo() { echo "ERROR: $*" >&2; exit 1; }

[ -d "${PROD_DIR}/.git" ] || fallo "PROD_DIR no es un repositorio git: ${PROD_DIR}"
command -v pm2 >/dev/null || fallo "pm2 no está disponible."
HISTORIAL="${PROD_DIR}/RELEASE_HISTORY"
[ -f "${HISTORIAL}" ] || fallo "no existe ${HISTORIAL}: no hay despliegues registrados a los que volver."

# --- Validación del proceso PM2 productivo -----------------------------------
JLIST="$(pm2 jlist)"
ESTADO="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${PROD_PM2_APP}" status)" \
  || fallo "no existe el proceso PM2 '${PROD_PM2_APP}'."
CWD_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${PROD_PM2_APP}" cwd)"
SCRIPT_PM2="$(printf '%s' "${JLIST}" | node "${SCRIPT_DIR}/pm2-info.js" "${PROD_PM2_APP}" script)"
[ "${CWD_PM2}" = "${PROD_DIR}" ] \
  || fallo "el proceso ${PROD_PM2_APP} ejecuta desde '${CWD_PM2}', no desde ${PROD_DIR}."
case "${SCRIPT_PM2}" in
  */server.js) : ;;
  *) fallo "el proceso ${PROD_PM2_APP} ejecuta '${SCRIPT_PM2}', no server.js; me niego a continuar." ;;
esac

OBJETIVO="${1:-}"
if [ -z "${OBJETIVO}" ]; then
  # Última línea del historial: "<fecha> <commit_anterior> -> <commit_nuevo>...".
  OBJETIVO="$(tail -n 1 "${HISTORIAL}" | awk '{print $2}')"
  [ -n "${OBJETIVO}" ] || fallo "el historial no registra un commit anterior utilizable; indícalo como argumento."
fi
git -C "${PROD_DIR}" cat-file -e "${OBJETIVO}^{commit}" 2>/dev/null \
  || fallo "el commit '${OBJETIVO}' no existe en ${PROD_DIR}."
OBJETIVO="$(git -C "${PROD_DIR}" rev-parse "${OBJETIVO}^{commit}")"
grep -q "${OBJETIVO}" "${HISTORIAL}" \
  || fallo "el commit ${OBJETIVO} no aparece en ${HISTORIAL}; sólo se permite volver a commits registrados."

[ -z "$(git -C "${PROD_DIR}" status --porcelain --untracked-files=no)" ] \
  || fallo "el árbol de producción tiene cambios locales en archivos versionados; resuélvelos antes del rollback."
ACTUAL="$(git -C "${PROD_DIR}" rev-parse HEAD)"

echo "Rollback de PRODUCCIÓN (PM2):"
echo "  Proceso        : ${PROD_PM2_APP} (estado: ${ESTADO}, cwd ${CWD_PM2})"
echo "  Commit actual  : ${ACTUAL}"
echo "  Volver a       : ${OBJETIVO}"
printf 'Escribe exactamente ROLLBACK para continuar: '
read -r CONFIRMACION
[ "${CONFIRMACION}" = "ROLLBACK" ] || fallo "confirmación incorrecta; no se hace nada."

printf '%s %s -> %s (rollback)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${ACTUAL}" "${OBJETIVO}" >> "${HISTORIAL}"
git -C "${PROD_DIR}" checkout --detach --quiet "${OBJETIVO}"
[ -f "${PROD_DIR}/server.js" ] || fallo "el checkout no contiene server.js; abortando antes de reiniciar."
(cd "${PROD_DIR}" && npm ci --omit=dev --no-audit --no-fund)

echo "Reiniciando ${PROD_PM2_APP}..."
pm2 restart "${PROD_PM2_APP}" --update-env
for intento in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PROD_PORT}/health/ready" >/dev/null 2>&1; then
    printf '%s\n' "${OBJETIVO}" > "${PROD_DIR}/DEPLOYED_COMMIT"
    echo "Rollback completado: producción sirve el commit ${OBJETIVO}."
    exit 0
  fi
  sleep 2
done
fallo "producción no respondió /health/ready tras el rollback; revisa pm2 logs ${PROD_PM2_APP}."
