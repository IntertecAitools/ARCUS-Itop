#!/bin/sh
# iTop's background jobs: SLA/stopwatch thresholds, escalations, auto-close,
# queued email, newsroom, log rotation... cron.php runs every task that is due,
# loops until cron_max_execution_time (600 s by default) and exits; this
# restarts it straight away, which is what iTop's docs ask of a crontab entry.
#
# Runs as www-data in its own container on the same volumes as iTop. The
# account must be an iTop Administrator: the BFF's service account
# (ITOP_CRON_USER / ITOP_CRON_PASSWORD, else ITOP_USER / ITOP_PASSWORD).
set -u

ITOP_CRON_USER=${ITOP_CRON_USER:-${ITOP_USER:-}}
ITOP_CRON_PASSWORD=${ITOP_CRON_PASSWORD:-${ITOP_PASSWORD:-}}

CONF=/var/www/html/conf/production/config-itop.php
# Written by itop-setup when it has finished (production only).
DONE=/var/www/html/data/arcus-setup.done
PARAMS=/tmp/cron.params

: "${ITOP_CRON_USER:?ITOP_CRON_USER is not set}"
: "${ITOP_CRON_PASSWORD:?ITOP_CRON_PASSWORD is not set}"

# A params file rather than --auth_pwd on the command line, so the password
# is not in the process list.
umask 077
printf 'auth_user=%s\nauth_pwd=%s\n' "$ITOP_CRON_USER" "$ITOP_CRON_PASSWORD" > "$PARAMS"

while :; do
    if [ ! -f "$CONF" ]; then
        echo "itop-cron: iTop is not installed yet (run itop-setup); waiting" >&2
        sleep 60
        continue
    fi
    if [ "${ITOP_CRON_AFTER_SETUP:-false}" = "true" ] && [ ! -f "$DONE" ]; then
        echo "itop-cron: waiting for itop-setup to finish" >&2
        sleep 15
        continue
    fi
    php /var/www/html/webservices/cron.php --param_file="$PARAMS" --verbose="${ITOP_CRON_VERBOSE:-0}"
    status=$?
    if [ "$status" -ne 0 ]; then
        echo "itop-cron: cron.php exited with $status; retrying in 60 s" >&2
        sleep 60
    else
        sleep "${ITOP_CRON_PAUSE:-10}"
    fi
done
