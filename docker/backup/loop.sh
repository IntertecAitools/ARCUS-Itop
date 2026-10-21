#!/bin/bash
# The backup container's main process: runs backup.sh once a day at
# BACKUP_TIME (HH:MM, the container's clock, UTC unless TZ is set).
# `docker compose ... run --rm backup backup` takes one now;
# `... run --rm backup restore <stamp>` restores one.
set -u

case "${1:-loop}" in
    backup)  exec /scripts/backup.sh ;;
    restore) shift; exec /scripts/restore.sh "$@" ;;
    loop)    ;;
    *)       exec "$@" ;;
esac

AT=${BACKUP_TIME:-02:00}
echo "backup: daily at $AT ($(date +%Z)), keeping ${BACKUP_KEEP_DAYS:-14} days, into /backups"
last=""
while :; do
    if [ "$(date +%H:%M)" = "$AT" ] && [ "$last" != "$(date +%F)" ]; then
        last=$(date +%F)
        /scripts/backup.sh || echo "backup: FAILED (exit $?)" >&2
    fi
    sleep 20
done
