# Adding an iTop module

iTop has no "install module" button. A module becomes real only when setup runs
again: it recompiles the datamodel into `iTop/data/datamodel-production.xml` and
`iTop/env-production/`, then migrates the database schema. That means adding a
module touches live data, so the order below matters.

Done once already, adding `itop-problem-mgmt`, `itop-container-mgmt` and
`itop-flow-map`. `add-modules.xml` is the exact response file that was used.

## 1. Back up first

Setup alters the schema of a database holding real records.

```bash
mysqldump -h 127.0.0.1 -u root --single-transaction --routines --triggers \
  --databases itop > backups/itop-pre-<change>.sql
tar -czf backups/itop-env-pre-<change>.tar.gz \
  -C iTop env-production data/datamodel-production.xml conf/production/config-itop.php
```

## 2. Check the module is additive, not an alternative

`iTop/datamodels/2.x/installation.xml` groups some modules under
`<alternatives>`. Those are mutually exclusive: selecting one **replaces** the
other. `itop-change-mgmt`, `itop-request-mgmt` and `itop-service-mgmt-provider`
are alternatives to `itop-change-mgmt-itil`, `itop-request-mgmt-itil` and
`itop-service-mgmt` — all installed here and holding data. Never select them.

Check dependencies too, in `module.<name>.php`.

## 3. Build the response file from the database, not by hand

`priv_module_install` is iTop's own authoritative record of what is installed.
Enumerating `selected_modules` from it means an upgrade cannot silently drop a
module that `installation.xml`'s defaults happen not to select.

```sql
SELECT name FROM priv_module_install WHERE name NOT IN ('datamodel','iTop') ORDER BY name;
```

Add the new modules to that list. Keep `<sample_data>0</sample_data>`: this
database holds real records and must not receive iTop's demo content.

Two gotchas that cost time:

- XML comments cannot contain `--`. The installer rejects the whole file.
- Run the installer **without** `--installation_xml`, or it recomputes the
  module list from installation choices and ignores `selected_modules`.

## 4. Run it in the container

PHP lives in the container; the database is on the host.

```bash
MSYS_NO_PATHCONV=1 docker exec itop php \
  /var/www/html/setup/unattended-install/unattended-install.php \
  --param-file=/var/www/html/data/add-modules.xml
```

`MSYS_NO_PATHCONV=1` is required under Git Bash, which otherwise rewrites
`/var/www/...` into a Windows path.

## 5. Fix ownership, or every page 500s

The installer's own README warns about this and it is the one step easy to
miss. Run as root, setup writes `conf/production/config-itop.php` as
`-r--r----- root root`. Apache runs as `www-data`, cannot read it, and iTop
dies before it can report anything useful:

> Uncaught ConfigException: Could not read configuration file (the file exists
> but cannot be read)

```bash
docker exec itop chown -R www-data:www-data \
  /var/www/html/conf /var/www/html/env-production /var/www/html/data /var/www/html/log
docker restart itop
```

Keep the config at mode `0440` — that is iTop's intended permission. Only the
owner was wrong.

## 6. Republish the schema to the BFF

The BFF reads `cmdb-schema/cmdb-schema.json`, not iTop, and loads it once at
boot. Nothing new appears until both steps run.

```bash
python cmdb-schema/extract-schema.py   # rewrites cmdb-schema.json
# restart the BFF
curl -s http://localhost:4000/health   # schemaClasses should have grown
```

New concrete classes then show up in the frontend's Records module on their
own, because it renders whatever the schema describes.

## 7. Verify against the baseline

Compare row counts to what you captured before, and confirm the new class
answers through the BFF rather than only in iTop:

```bash
curl -s "http://localhost:4000/api/objects/Problem?limit=1"
```
