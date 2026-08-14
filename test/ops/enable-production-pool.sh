#!/usr/bin/env bash
# Fixture aislado para el activador del pool. No toca systemd, Nginx ni /etc reales.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/data-fut-pool-test.XXXXXX)"
trap 'rm -rf -- "${TMP_DIR}"' EXIT
FAKE_BIN="${TMP_DIR}/bin"
mkdir -p "${FAKE_BIN}"

cat > "${FAKE_BIN}/systemctl" <<'EOF'
#!/usr/bin/env bash
printf 'systemctl %s\n' "$*" >> "${POOL_TEST_LOG}"
if [ "${1:-}" = is-active ]; then
  printf 'active\n'
fi
EOF

cat > "${FAKE_BIN}/nginx" <<'EOF'
#!/usr/bin/env bash
printf 'nginx %s\n' "$*" >> "${POOL_TEST_LOG}"
EOF

cat > "${FAKE_BIN}/systemd-analyze" <<'EOF'
#!/usr/bin/env bash
printf 'systemd-analyze %s\n' "$*" >> "${POOL_TEST_LOG}"
EOF

cat > "${FAKE_BIN}/curl" <<'EOF'
#!/usr/bin/env bash
URL=""
for ARG in "$@"; do URL="${ARG}"; done
printf 'curl %s\n' "${URL}" >> "${POOL_TEST_LOG}"
if [ "${FAIL_PUBLIC:-0}" = 1 ] && [ "${URL}" = "${PUBLIC_READY}" ]; then
  exit 22
fi
EOF
chmod 755 "${FAKE_BIN}/systemctl" "${FAKE_BIN}/nginx" "${FAKE_BIN}/systemd-analyze" "${FAKE_BIN}/curl"

preparar_caso() {
  local NOMBRE="$1" CASO
  CASO="${TMP_DIR}/${NOMBRE}"
  mkdir -p "${CASO}/etc/systemd" "${CASO}/etc/app" "${CASO}/etc/nginx/conf.d" \
    "${CASO}/etc/nginx/snippets" "${CASO}/releases/releases/sha" "${CASO}/backup"
  ln -s "${CASO}/releases/releases/sha" "${CASO}/releases/current"
  printf 'configuracion-original\n' > "${CASO}/etc/nginx/snippets/proxy.conf"
  : > "${CASO}/commands.log"
}

activar() {
  local CASO="$1" FALLA_PUBLIC="$2"
  printf 'ACTIVAR_POOL\n' | env \
    PATH="${FAKE_BIN}:${PATH}" \
    POOL_TEST_LOG="${CASO}/commands.log" \
    FAIL_PUBLIC="${FALLA_PUBLIC}" \
    PRIMARY_SERVICE=primaria \
    SECONDARY_SERVICE=secundaria \
    SECONDARY_UNIT="${CASO}/etc/systemd/secundaria.service" \
    SECONDARY_ENV="${CASO}/etc/app/secondary.env" \
    DEPLOY_ENV="${CASO}/etc/app/deploy.env" \
    NGINX_UPSTREAM="${CASO}/etc/nginx/conf.d/upstream.conf" \
    NGINX_SNIPPET="${CASO}/etc/nginx/snippets/proxy.conf" \
    RELEASES_DIR="${CASO}/releases" \
    BACKUP_PARENT="${CASO}/backup" \
    PUBLIC_READY=http://public.test/health/ready \
    "${ROOT_DIR}/deploy/enable-production-pool.sh"
}

preparar_caso exito
CASO_EXITO="${TMP_DIR}/exito"
activar "${CASO_EXITO}" 0
test -f "${CASO_EXITO}/etc/systemd/secundaria.service"
test -f "${CASO_EXITO}/etc/app/secondary.env"
test -f "${CASO_EXITO}/etc/app/deploy.env"
test -f "${CASO_EXITO}/etc/nginx/conf.d/upstream.conf"
cmp -s "${ROOT_DIR}/deploy/nginx-production-proxy-pool.conf" "${CASO_EXITO}/etc/nginx/snippets/proxy.conf"
grep -q '^systemctl start secundaria$' "${CASO_EXITO}/commands.log"
grep -q '^systemctl reload nginx$' "${CASO_EXITO}/commands.log"

preparar_caso fallo-publico
CASO_FALLO="${TMP_DIR}/fallo-publico"
if activar "${CASO_FALLO}" 1; then
  echo "ERROR: el activador debía fallar con readiness público inválido." >&2
  exit 1
fi
test ! -e "${CASO_FALLO}/etc/systemd/secundaria.service"
test ! -e "${CASO_FALLO}/etc/app/secondary.env"
test ! -e "${CASO_FALLO}/etc/app/deploy.env"
test ! -e "${CASO_FALLO}/etc/nginx/conf.d/upstream.conf"
grep -qx 'configuracion-original' "${CASO_FALLO}/etc/nginx/snippets/proxy.conf"
grep -q '^systemctl stop secundaria$' "${CASO_FALLO}/commands.log"
grep -q '^systemctl disable secundaria$' "${CASO_FALLO}/commands.log"
grep -q '^systemctl reload nginx$' "${CASO_FALLO}/commands.log"

echo "OK: activación y restauración del pool aisladas."
