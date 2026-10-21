#!/bin/bash
# Runs once, when the bundled MySQL starts on an empty volume (the image runs
# /docker-entrypoint-initdb.d/*). Creates the two databases and their users:
#   iTop's (ITOP_DB_*) and the BFF's sessions (SESSION_DB_*), each user with
#   rights on its own database only.
# With an external MySQL, run the same statements there by hand
# (docs/deployment.md, "Using an existing MySQL").
set -euo pipefail

: "${ITOP_DB_PASSWORD:?ITOP_DB_PASSWORD is not set}"
: "${SESSION_DB_PASSWORD:?SESSION_DB_PASSWORD is not set}"
ITOP_DB_NAME=${ITOP_DB_NAME:-itop}
ITOP_DB_USER=${ITOP_DB_USER:-itop}
SESSION_DB_NAME=${SESSION_DB_NAME:-arcus_bff}
SESSION_DB_USER=${SESSION_DB_USER:-arcus_bff}

# Values go in as SQL string literals: double any single quote.
q() { printf "%s" "${1//\'/\'\'}"; }

mysql --protocol=socket -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS \`$ITOP_DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$(q "$ITOP_DB_USER")'@'%' IDENTIFIED BY '$(q "$ITOP_DB_PASSWORD")';
GRANT ALL PRIVILEGES ON \`$ITOP_DB_NAME\`.* TO '$(q "$ITOP_DB_USER")'@'%';

CREATE DATABASE IF NOT EXISTS \`$SESSION_DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$(q "$SESSION_DB_USER")'@'%' IDENTIFIED BY '$(q "$SESSION_DB_PASSWORD")';
GRANT ALL PRIVILEGES ON \`$SESSION_DB_NAME\`.* TO '$(q "$SESSION_DB_USER")'@'%';
FLUSH PRIVILEGES;
SQL

echo "01-databases: created $ITOP_DB_NAME (user $ITOP_DB_USER) and $SESSION_DB_NAME (user $SESSION_DB_USER)"
