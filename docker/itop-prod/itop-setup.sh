#!/bin/sh
# First-time install and configuration of iTop in production. Run it in the
# iTop container as www-data (docs/deployment.md, "First start"):
#
#   docker compose -f docker/docker-compose.prod.yml --env-file docker/prod.env \
#     exec -u www-data itop itop-setup
#
# 1. When iTop has no configuration yet: an unattended install from
#    install.xml.tpl (iTop's 46 standard modules plus the platform's
#    extensions: arcus-*, business hours, approvals) into the empty database
#    ITOP_DB_NAME, with the administrator ITOP_ADMIN_USER. Three passes; see
#    the end of step 1 below.
#    With --upgrade on an installed iTop: the same response file in upgrade
#    mode, which recompiles env-production/ and migrates the database. Needed
#    after a new image brings a changed iTop/ or itop-extensions/. It keeps
#    every module in the list, so it never uninstalls an extension.
# 2. Every time: configure.php applies the time zone, the mail settings and
#    the accounts the platform needs (the BFF's service account with
#    Administrator + REST Services User; REST Services User for the
#    administrator). Re-run it after changing those settings in itop.env.
#
# Then restart iTop and its cron (`docker compose ... restart itop itop-cron`).
set -eu

ROOT=/var/www/html
CONF=$ROOT/conf/production/config-itop.php
# itop-cron (ITOP_CRON_AFTER_SETUP=true) waits for this file: cron.php started
# while the setup still builds iTop's caches can read a half-written one.
DONE=$ROOT/data/arcus-setup.done

if [ "$(id -un)" != "www-data" ]; then
    echo "itop-setup: run as www-data (exec -u www-data itop itop-setup)" >&2
    exit 1
fi

MODE=install
if [ -f "$CONF" ]; then
    if [ "${1:-}" = "--upgrade" ]; then
        MODE=upgrade
    else
        echo "itop-setup: iTop is already installed ($CONF); applying the configuration only."
        MODE=
    fi
fi

rm -f "$DONE"

if [ -n "$MODE" ]; then
    : "${ITOP_DB_PASSWORD:?ITOP_DB_PASSWORD is not set}"
    : "${ITOP_ADMIN_PASSWORD:?ITOP_ADMIN_PASSWORD is not set}"
    RESPONSE=$(mktemp /tmp/itop-install.XXXXXX.xml)
    trap 'rm -f "$RESPONSE"' EXIT
    # One run of the unattended installer. $1 = install | upgrade; $2 =
    # "first" to leave combodo-approval-extended out (see install.xml.tpl).
    run_pass() {
        render "$1" "${2:-}"
        echo "itop-setup: $1 of iTop${2:+ (first pass)}, database ${ITOP_DB_NAME:-itop} on ${ITOP_DB_HOST:-db} (takes a few minutes)"
        (cd "$ROOT/setup/unattended-install" && php unattended-install.php --param-file="$RESPONSE")
        echo
        if [ ! -f "$CONF" ]; then
            echo "itop-setup: the $1 did not write $CONF; see $ROOT/log/setup.log" >&2
            exit 1
        fi
    }
    # PHP renders the template so every value is escaped for XML.
    # shellcheck disable=SC2016 # PHP code, not shell
    render() {
    php -r '
        $v = [
            "MODE"           => $argv[2],
            "PREVIOUS_CONF"  => $argv[2] === "upgrade" ? $argv[3] : "",
            "DB_SERVER"      => (getenv("ITOP_DB_HOST") ?: "db").((getenv("ITOP_DB_PORT") ?: "3306") === "3306" ? "" : ":".getenv("ITOP_DB_PORT")),
            "DB_USER"        => getenv("ITOP_DB_USER") ?: "itop",
            "DB_PASSWORD"    => getenv("ITOP_DB_PASSWORD"),
            "DB_NAME"        => getenv("ITOP_DB_NAME") ?: "itop",
            "DB_TLS"         => getenv("ITOP_DB_TLS") ?: "",
            "DB_TLS_CA"      => getenv("ITOP_DB_TLS_CA") ?: "",
            "APP_ROOT_URL"   => getenv("ITOP_APP_ROOT_URL") ?: "http://localhost:8089/",
            "ADMIN_USER"     => getenv("ITOP_ADMIN_USER") ?: "admin",
            "ADMIN_PASSWORD" => getenv("ITOP_ADMIN_PASSWORD"),
            "LANGUAGE"       => getenv("ITOP_LANGUAGE") ?: "EN US",
        ];
        $s = file_get_contents("/opt/arcus/install.xml.tpl");
        foreach ($v as $k => $x) { $s = str_replace("{{".$k."}}", htmlspecialchars($x, ENT_XML1 | ENT_QUOTES), $s); }
        if ($argv[4] === "first") { $s = str_replace("<item>combodo-approval-extended</item>", "", $s); }
        file_put_contents($argv[1], $s);
    ' "$RESPONSE" "$1" "$CONF" "$2"
    }

    # iTop 3.4 installs Combodo's approvals in three passes: approval-base
    # first (its installer needs its classes loaded before
    # combodo-approval-extended's runs), then the whole list twice (the
    # compiled schema lags one pass). An upgrade runs the whole list twice.
    if [ "$MODE" = install ]; then
        run_pass install first
    else
        run_pass upgrade
    fi
    run_pass upgrade
    run_pass upgrade
fi

php /opt/arcus/configure.php
date -u +%FT%TZ > "$DONE"
echo "itop-setup: done. Restart iTop and its cron: docker compose ... restart itop itop-cron"
