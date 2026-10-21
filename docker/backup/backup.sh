#!/bin/bash
# One backup into /backups/<UTC stamp>/:
#   itop.sql.gz       iTop's database (every ticket, CI, account, attachment)
#   arcus_bff.sql.gz  the BFF's sessions database (losing it only signs people out)
#   itop-files.tar.gz iTop's conf/ (config-itop.php: DB and SMTP passwords,
#                     the encryption key), data/ and env-production/ (the
#                     compiled data model, so a restore needs no setup run)
# Old backups beyond BACKUP_KEEP_DAYS are deleted. docs/deployment.md, "Backups".
set -euo pipefail

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST=/backups/$STAMP
TMP=$DEST.partial
umask 077
mkdir -p "$TMP"

dump() { # host port user password database file
    MYSQL_PWD=$4 mysqldump -h "$1" -P "$2" -u "$3" \
        --single-transaction --quick --routines --triggers --events --hex-blob \
        --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 \
        "$5" | gzip > "$TMP/$6"
}

echo "backup $STAMP: iTop database ${ITOP_DB_NAME:-itop}"
dump "${ITOP_DB_HOST:-db}" "${ITOP_DB_PORT:-3306}" "${ITOP_DB_USER:-itop}" "$ITOP_DB_PASSWORD" "${ITOP_DB_NAME:-itop}" itop.sql.gz
echo "backup $STAMP: sessions database ${SESSION_DB_NAME:-arcus_bff}"
dump "${SESSION_DB_HOST:-db}" "${SESSION_DB_PORT:-3306}" "${SESSION_DB_USER:-arcus_bff}" "$SESSION_DB_PASSWORD" "${SESSION_DB_NAME:-arcus_bff}" arcus_bff.sql.gz

echo "backup $STAMP: iTop files (conf, data, env-production)"
# Caches are rebuilt on demand; iTop's own backups (data/backups) are not ours.
tar -C /itop --numeric-owner --exclude='./data/cache-*' --exclude='./data/backups' \
    -czf "$TMP/itop-files.tar.gz" ./conf ./data ./env-production

mv "$TMP" "$DEST"
echo "backup $STAMP: done, $(du -sh "$DEST" | cut -f1) in $DEST"

KEEP=${BACKUP_KEEP_DAYS:-14}
find /backups -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$KEEP" -print -exec rm -rf {} + \
    | sed 's/^/backup: removed old /'
find /backups -mindepth 1 -maxdepth 1 -type d -name '*.partial' -mmin +360 -exec rm -rf {} +
