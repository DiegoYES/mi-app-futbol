#!/usr/bin/env bash
# Prueba operativa aislada para promoción/rollback systemd. No toca /opt.
set -euo pipefail
[ "${EUID}" -eq 0 ] || { echo "Ejecuta con sudo: $0" >&2; exit 1; }
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="$(mktemp -d /tmp/data-fut-deploy-test.XXXXXX)"
case "${ROOT}" in /tmp/data-fut-deploy-test.*) :;; *) exit 2;; esac
trap 'rm -rf -- "${ROOT}"' EXIT
FIX="${ROOT}/fixture"; BIN="${ROOT}/bin"; LOG="${ROOT}/calls.log"
PROMOTE="${REPO}/deploy/promote-production.sh"; ROLLBACK="${REPO}/deploy/rollback-production.sh"
A="$(git -c "safe.directory=${REPO}" -C "${REPO}" rev-parse HEAD^1)"
B="$(git -c "safe.directory=${REPO}" -C "${REPO}" rev-parse HEAD)"
mkdir -p "${BIN}"
cat > "${BIN}/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >> "${FAKE_LOG}"
case "$1" in
  show)
    PROP=""; while [ "$#" -gt 0 ]; do [ "$1" = -p ] && PROP="$2" && break; shift; done
    case "${PROP}" in
      LoadState) echo loaded;; FragmentPath) echo "${UNIT_PATH}";;
      WorkingDirectory) echo "${EXPECTED_WORKING_DIR}";; User) echo root;;
      ExecStart) echo "/usr/bin/node server.js";; *) exit 91;;
    esac;;
  is-active) echo active;; restart) exit 0;; *) exit 90;;
esac
EOF
cat > "${BIN}/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "${FAKE_LOG}"
[ "${FAKE_HEALTH:-ok}" = ok ]
EOF
cat > "${BIN}/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod 755 "${BIN}/systemctl" "${BIN}/curl" "${BIN}/sleep"

reset_fixture() {
  rm -rf -- "${FIX}"
  mkdir -p "${FIX}/releases/${A}" "${FIX}/releases/${B}" "${FIX}/staging"
  touch "${FIX}/releases/${A}/.release-ok" "${FIX}/releases/${A}/server.js"
  touch "${FIX}/releases/${B}/.release-ok" "${FIX}/releases/${B}/server.js"
  ln -s "${FIX}/releases/${A}" "${FIX}/current"
  printf '%s\n' "${A}" > "${FIX}/DEPLOYED_COMMIT"
  printf '%s\n' "${B}" > "${FIX}/staging/VALIDATED_COMMIT"
  printf '2000-01-01T00:00:00Z baseline -> %s\n' "${A}" > "${FIX}/RELEASE_HISTORY"
  : > "${LOG}"
}
run() {
  env PATH="${BIN}:/usr/bin:/bin" FAKE_LOG="${LOG}" FAKE_HEALTH="$1" \
    REPO_DIR="${REPO}" STAGING_DIR="${FIX}/staging" RELEASES_DIR="${FIX}" \
    PROD_SERVICE=falso PROD_USER=root UNIT_PATH=/fake.service \
    EXPECTED_WORKING_DIR="${FIX}/current" "$2" "${@:3}"
}
estado_es() {
  [ "$(readlink -f "${FIX}/current")" = "${FIX}/releases/$1" ]
  [ "$(tr -d '\r\n' < "${FIX}/DEPLOYED_COMMIT")" = "$1" ]
}

reset_fixture
printf 'PROMOVER\n' | run ok "${PROMOTE}" "${B}"
estado_es "${B}"; grep -q "promote -> ${B}" "${FIX}/RELEASE_HISTORY"

reset_fixture
set +e; printf 'PROMOVER\n' | run fail "${PROMOTE}" "${B}"; RC=$?; set -e
[ "${RC}" -ne 0 ]; estado_es "${A}"; ! grep -q "promote -> ${B}" "${FIX}/RELEASE_HISTORY"

preparar_rollback() {
  reset_fixture
  printf '2000-01-02T00:00:00Z promote -> %s\n' "${B}" >> "${FIX}/RELEASE_HISTORY"
  rm "${FIX}/current"; ln -s "${FIX}/releases/${B}" "${FIX}/current"
  printf '%s\n' "${B}" > "${FIX}/DEPLOYED_COMMIT"
}
preparar_rollback
printf 'ROLLBACK\n' | run ok "${ROLLBACK}" "${A}"
estado_es "${A}"; grep -q "rollback -> ${A}" "${FIX}/RELEASE_HISTORY"

preparar_rollback
set +e; printf 'ROLLBACK\n' | run fail "${ROLLBACK}" "${A}"; RC=$?; set -e
[ "${RC}" -ne 0 ]; estado_es "${B}"; ! grep -q "rollback -> ${A}" "${FIX}/RELEASE_HISTORY"

echo "OK: promoción, rollback y restauraciones systemd aisladas."
