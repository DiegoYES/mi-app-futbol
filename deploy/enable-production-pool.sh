#!/usr/bin/env bash
# Activa una segunda instancia Node y balanceo Nginx en producción.
# No despliega código ni toca MongoDB. Exige confirmación literal y restaura
# configuración/servicio si cualquier health check o validación falla.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRIMARY_SERVICE="${PRIMARY_SERVICE:-mi-app-futbol}"
SECONDARY_SERVICE="${SECONDARY_SERVICE:-mi-app-futbol-secondary}"
SECONDARY_UNIT="${SECONDARY_UNIT:-/etc/systemd/system/${SECONDARY_SERVICE}.service}"
SECONDARY_ENV="${SECONDARY_ENV:-/etc/mi-app-futbol/secondary.env}"
DEPLOY_ENV="${DEPLOY_ENV:-/etc/mi-app-futbol/deploy.env}"
NGINX_UPSTREAM="${NGINX_UPSTREAM:-/etc/nginx/conf.d/data-fut-upstream.conf}"
NGINX_SNIPPET="${NGINX_SNIPPET:-/etc/nginx/snippets/data-fut-proxy.conf}"
RELEASES_DIR="${RELEASES_DIR:-/opt/mi-app-futbol}"
CURRENT_LINK="${CURRENT_LINK:-${RELEASES_DIR}/current}"
BACKUP_PARENT="${BACKUP_PARENT:-/root}"
PRIMARY_PORT="${PRIMARY_PORT:-3000}"
SECONDARY_PORT="${SECONDARY_PORT:-3001}"
PUBLIC_READY="${PUBLIC_READY:-https://data-fut.com/health/ready}"

fallo() { echo "ERROR: $*" >&2; exit 1; }
saludable() {
  local PUERTO="$1"
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:${PUERTO}/health/ready" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

[ "${EUID}" -eq 0 ] || fallo "ejecuta mediante sudo."
for COMANDO in chmod cp curl install mktemp nginx readlink rm systemctl systemd-analyze; do
  command -v "${COMANDO}" >/dev/null || fallo "${COMANDO} no está disponible."
done
[ -d "${BACKUP_PARENT}" ] || fallo "no existe el directorio de respaldo ${BACKUP_PARENT}."
[ -L "${CURRENT_LINK}" ] || fallo "current no es un symlink de release."
[ "$(systemctl is-active "${PRIMARY_SERVICE}")" = active ] || fallo "la primaria no está activa."
saludable "${PRIMARY_PORT}" || fallo "la primaria no está saludable."
[ ! -e "${SECONDARY_UNIT}" ] || fallo "ya existe ${SECONDARY_UNIT}; revisa el estado manualmente."
[ ! -e "${SECONDARY_ENV}" ] || fallo "ya existe ${SECONDARY_ENV}; revisa el estado manualmente."
[ ! -e "${DEPLOY_ENV}" ] || fallo "ya existe ${DEPLOY_ENV}; el pool podría estar configurado."
[ ! -e "${NGINX_UPSTREAM}" ] || fallo "ya existe ${NGINX_UPSTREAM}; revisa Nginx manualmente."
[ -f "${NGINX_SNIPPET}" ] || fallo "falta ${NGINX_SNIPPET}."
[ -f "${SCRIPT_DIR}/mi-app-futbol-secondary.service" ] || fallo "falta la plantilla de unidad."
[ -f "${SCRIPT_DIR}/production-secondary.env" ] || fallo "falta el entorno secundario."
[ -f "${SCRIPT_DIR}/production-pool.env" ] || fallo "falta la configuración de deploy."
[ -f "${SCRIPT_DIR}/nginx-production-upstream.conf" ] || fallo "falta la plantilla upstream."
[ -f "${SCRIPT_DIR}/nginx-production-proxy-pool.conf" ] || fallo "falta el snippet del pool."
systemd-analyze verify "${SCRIPT_DIR}/mi-app-futbol-secondary.service"

echo "Primaria : ${PRIMARY_SERVICE} (${PRIMARY_PORT})"
echo "Secundaria: ${SECONDARY_SERVICE} (${SECONDARY_PORT})"
echo "Release  : $(readlink -f "${CURRENT_LINK}")"
printf 'Escribe exactamente ACTIVAR_POOL para continuar: '
read -r CONFIRMACION
[ "${CONFIRMACION}" = ACTIVAR_POOL ] || fallo "confirmación incorrecta; no se hace nada."

BACKUP_DIR="$(mktemp -d "${BACKUP_PARENT}/data-fut-pool-backup.XXXXXX")"
chmod 700 "${BACKUP_DIR}"
cp -a "${NGINX_SNIPPET}" "${BACKUP_DIR}/data-fut-proxy.conf"
OK=0
restaurar() {
  [ "${OK}" = 1 ] && return 0
  set +e
  echo "RESTAURANDO configuración previa del pool..." >&2
  systemctl stop "${SECONDARY_SERVICE}" >/dev/null 2>&1
  systemctl disable "${SECONDARY_SERVICE}" >/dev/null 2>&1
  rm -f -- "${SECONDARY_UNIT}" "${SECONDARY_ENV}" "${DEPLOY_ENV}" "${NGINX_UPSTREAM}"
  cp -a "${BACKUP_DIR}/data-fut-proxy.conf" "${NGINX_SNIPPET}"
  systemctl daemon-reload
  nginx -t && systemctl reload nginx
  saludable "${PRIMARY_PORT}" \
    && echo "Restauración saludable; respaldo: ${BACKUP_DIR}" >&2 \
    || echo "INTERVENCIÓN URGENTE: la primaria no quedó saludable." >&2
}
trap restaurar EXIT

install -o root -g root -m 600 "${SCRIPT_DIR}/production-secondary.env" "${SECONDARY_ENV}"
install -o root -g root -m 644 "${SCRIPT_DIR}/mi-app-futbol-secondary.service" "${SECONDARY_UNIT}"
systemctl daemon-reload
systemctl enable "${SECONDARY_SERVICE}" >/dev/null
systemctl start "${SECONDARY_SERVICE}"
saludable "${SECONDARY_PORT}" || fallo "la secundaria no alcanzó readiness."

install -o root -g root -m 644 "${SCRIPT_DIR}/nginx-production-upstream.conf" "${NGINX_UPSTREAM}"
install -o root -g root -m 644 "${SCRIPT_DIR}/nginx-production-proxy-pool.conf" "${NGINX_SNIPPET}"
nginx -t
systemctl reload nginx
curl -fsS "${PUBLIC_READY}" >/dev/null || fallo "el readiness público falló tras recargar Nginx."

install -o root -g root -m 600 "${SCRIPT_DIR}/production-pool.env" "${DEPLOY_ENV}"
OK=1
trap - EXIT
echo "Pool de producción activo y saludable. Respaldo: ${BACKUP_DIR}"
