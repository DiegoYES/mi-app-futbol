#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d /tmp/data-fut-mongo-backup-test.XXXXXX)"
trap 'rm -rf -- "${TMP}"' EXIT
BIN="${TMP}/bin"
DESTINO="${TMP}/backups"
mkdir -p "${BIN}" "${DESTINO}"

cat > "${BIN}/mongodump" <<'EOF'
#!/usr/bin/env bash
for ARG in "$@"; do case "${ARG}" in --archive=*) ARCHIVO="${ARG#--archive=}";; esac; done
printf 'backup sintético válido\n' | gzip > "${ARCHIVO}"
EOF
cat > "${BIN}/mongorestore" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" > "${RESTORE_ARGS_LOG}"
EOF
chmod 755 "${BIN}/mongodump" "${BIN}/mongorestore"

ejecutar() {
  env PATH="${BIN}:/usr/bin:/bin" ALLOW_NON_ROOT=1 \
    MONGODB_URI="mongodb://127.0.0.1:27017/futbol-app" \
    BACKUP_DIR="${DESTINO}" LOCK_FILE="${TMP}/backup.lock" \
    MIN_BACKUP_BYTES=1 RETENTION_DAYS=7 RESTORE_ARGS_LOG="${TMP}/restore.args" \
    MONGODUMP_BIN="${BIN}/mongodump" MONGORESTORE_BIN="${BIN}/mongorestore" \
    BACKUP_TIMESTAMP="$1" "${REPO}/deploy/data-fut-mongo-backup"
}

ejecutar 20260815T010000Z
ARCHIVO="${DESTINO}/mongodb-futbol-app-20260815T010000Z.archive.gz"
[ -s "${ARCHIVO}" ]
(cd "${DESTINO}" && sha256sum -c "$(basename "${ARCHIVO}").sha256")
grep -q -- '--dryRun' "${TMP}/restore.args"

touch -d '10 days ago' "${ARCHIVO}" "${ARCHIVO}.sha256"
ejecutar 20260815T020000Z
[ ! -e "${ARCHIVO}" ] && [ ! -e "${ARCHIVO}.sha256" ]

set +e
env PATH="${BIN}:/usr/bin:/bin" ALLOW_NON_ROOT=1 \
  MONGODB_URI="mongodb://127.0.0.1:27017/base-equivocada" \
  BACKUP_DIR="${DESTINO}" LOCK_FILE="${TMP}/otro.lock" \
  MONGODUMP_BIN="${BIN}/mongodump" MONGORESTORE_BIN="${BIN}/mongorestore" \
  "${REPO}/deploy/data-fut-mongo-backup" >/dev/null 2>&1
RC=$?
set -e
[ "${RC}" -ne 0 ]

echo "OK: backup atómico, checksum, dry-run, retención y bloqueo de base incorrecta."
