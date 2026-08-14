#!/usr/bin/env bash
# Fixture aislado: valida éxito y detección de una secundaria no saludable.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d /tmp/data-fut-monitor-test.XXXXXX)"
trap 'rm -rf -- "${TMP}"' EXIT
BIN="${TMP}/bin"
LOG="${TMP}/monitor.log"
mkdir -p "${BIN}"

cat > "${BIN}/systemctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "${BIN}/curl" <<'EOF'
#!/usr/bin/env bash
URL=""
for ARG in "$@"; do URL="${ARG}"; done
if [ "${FAKE_HEALTH:-ok}" = fail-secondary ] && [[ "${URL}" == *127.0.0.1:3001* ]]; then
  exit 22
fi
exit 0
EOF
cat > "${BIN}/logger" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${MONITOR_TEST_LOG}"
EOF
chmod 755 "${BIN}/systemctl" "${BIN}/curl" "${BIN}/logger"

env PATH="${BIN}:/usr/bin:/bin" MONITOR_TEST_LOG="${LOG}" FAKE_HEALTH=ok \
  "${REPO}/deploy/data-fut-monitor"
grep -q 'OK ports=3000,3001' "${LOG}"

: > "${LOG}"
set +e
env PATH="${BIN}:/usr/bin:/bin" MONITOR_TEST_LOG="${LOG}" FAKE_HEALTH=fail-secondary \
  "${REPO}/deploy/data-fut-monitor"
RC=$?
set -e
[ "${RC}" -eq 2 ]
grep -q 'Instancia 3001 no responde en /health/live.' "${LOG}"
grep -q 'Instancia 3001 no está lista en /health/ready.' "${LOG}"

echo "OK: monitor detecta salud completa y fallo de secundaria."
