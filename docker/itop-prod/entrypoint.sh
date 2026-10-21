#!/bin/sh
# Starts Apache, opening iTop's console only when ITOP_ADMIN_UI=true (see
# apache.conf). Other commands (itop-setup, itop-cron, bash) run as given.
set -e

if [ "$1" = "apache2-foreground" ] && [ "${ITOP_ADMIN_UI:-false}" = "true" ]; then
    echo "itop: ITOP_ADMIN_UI=true, iTop's console is open on this container" >&2
    shift
    set -- apache2-foreground -DITOP_ADMIN_UI "$@"
fi

exec "$@"
