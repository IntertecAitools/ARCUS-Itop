#!/bin/bash
# Restores one backup made by backup.sh: both databases are dropped and loaded
# from the dumps, iTop's conf/, data/ and env-production/ are replaced.
# Stop iTop, its cron and the BFF first (docs/deployment.md, "Restore"):
#
#   docker compose ... stop itop itop-cron bff
#   docker compose ... run --rm backup restore 20261021T020000Z
#   docker compose ... up -d
set -euo pipefail

STAMP=${1:-}
SRC=/backups/$STAMP
if [ -z "$STAMP" ] || [ ! -f "$SRC/itop.sql.gz" ]; then
    echo "usage: restore <backup>; available:" >&2
    find /backups -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' -printf '%f\n' | sort >&2
    exit 1
fi

load() { # host port user password database file
    echo "restore $STAMP: database $5"
    MYSQL_PWD=$4 mysql -h "$1" -P "$2" -u "$3" -e \
        "DROP DATABASE IF EXISTS \`$5\`; CREATE DATABASE \`$5\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    gunzip -c "$SRC/$6" | MYSQL_PWD=$4 mysql -h "$1" -P "$2" -u "$3" --default-character-set=utf8mb4 "$5"
}

load "${ITOP_DB_HOST:-db}" "${ITOP_DB_PORT:-3306}" "${ITOP_DB_USER:-itop}" "$ITOP_DB_PASSWORD" "${ITOP_DB_NAME:-itop}" itop.sql.gz
if [ -f "$SRC/arcus_bff.sql.gz" ]; then
    load "${SESSION_DB_HOST:-db}" "${SESSION_DB_PORT:-3306}" "${SESSION_DB_USER:-arcus_bff}" "$SESSION_DB_PASSWORD" "${SESSION_DB_NAME:-arcus_bff}" arcus_bff.sql.gz
fi

echo "restore $STAMP: iTop files"
for d in conf data env-production; do
    find "/itop/$d" -mindepth 1 -delete
done
tar -C /itop --numeric-owner -xpzf "$SRC/itop-files.tar.gz"

echo "restore $STAMP: done. Start everything again: docker compose ... up -d"
