# IRAOPS on Azure

IRAOPS is a second, independent installation of the same product, under the
name IRAOPS. It runs on **one Azure VM** with Docker
(`docker/docker-compose.prod.yml`, the same file as Intertec), behind **Azure
Front Door** (HTTPS), in **UAE North**. It has its own empty databases, its
own secrets and its own backups. Nothing is shared with the Intertec
production on AWS.

One code base, two installations. A merge to `main` is built and tested
**once**, by the Intertec pipeline. Each installation then has its own manual
approval:

```
                         ┌─▶ Approval "ApproveProductionDeploy" ─▶ Intertec (AWS)        deploy/aws
merge to main ─▶ Build ──┤      (arcus-servicedesk-prod, unchanged)
   (tests, scans,        └─▶ iraops-release: WaitForBuild ─▶ Approval "ReleaseToIRAOPS" ─▶ IRAOPS (Azure)
    images → ECR)             (same commit, same images)      (its own email)           server deploys it
```

The product's name comes from `deploy/azure/server/names.env`
(docs/deployment.md, "The product's name"). The images are the same.

| What | Where |
|---|---|
| The app | `terraform -chdir=deploy/azure/terraform output app_url` (an `*.azurefd.net` address until a domain is added) |
| Release pipeline | AWS CodePipeline → `iraops-release` (us-east-1, beside Intertec's) |
| Server | Azure portal → resource group `iraops-prod` → VM `iraops-server`. No SSH: **Run command**, or `az vm run-command invoke` |
| Settings and secrets | Key Vault `iraops-kv-*`: `prod--*` (prod.env) and `itop--*` (itop.env). Names use `-` for `_`. Reachable only from the server and `operator_ips` |
| Deploy logs | the pipeline's Release step; on the server `/opt/arcus/state/last-release.log` |
| Backups | Storage account `iraopsbackups*`, container `daily` (90 days); daily VM backups in the vault `iraops-backup-vault` (14) |
| Images | Intertec's ECR (read only, with the server's own identity) |

## How it fits together

- **Nothing reaches into the server.** Every minute its *release agent*
  (`server/release-agent.sh`) asks the AWS bucket `iraops-release-*` whether
  a release was approved. When there is a new one, it deploys it
  (`server/deploy.sh`: backup, pull, start, iTop install or upgrade, health
  check, rollback on failure) and writes the result back. The pipeline's
  Release step waits for that result and shows the log.
- **No stored AWS keys.** The VM's Azure managed identity gets a token, which
  AWS exchanges for the role `iraops-azure-server` (`aws/main.tf`). It may
  pull the three images, read and answer release control, and sign licences
  with the licence key.
- **Licences** are issued from the IRAOPS operator Licences page and signed
  in AWS KMS with the same key as Intertec (`kid arcus-2026-1`): the BFF uses
  the same token (`server/docker-compose.azure.yml`). The key's own policy
  names the role (`licence_extra_signers` in `deploy/aws/terraform`).
- **Front Door** forwards to the VM's port 8088 over HTTP. The VM's network
  security group admits only Front Door (`AzureFrontDoor.Backend`); port 22
  is closed.

## Day to day

**Releasing a change:** merge a PR into `main`. Intertec's pipeline builds
and tests it as always. `iraops-release` starts at the same time, waits for
that build, then emails its approvers. Open the link and press **Approve**:
the server picks it up within a minute. The deploy takes about 2 minutes of
downtime, or about 15 when iTop changed. **Reject** leaves IRAOPS as it is.
Approving one installation never releases the other.

**When a deploy fails:** the server switches back to the previous release by
itself, the Release step turns red (with an email), and its log shows why.

**Rolling back on purpose:** CodePipeline → `iraops-release` → **History** →
an earlier successful run → **Rollback**. It hands that run's release to the
server again; nothing is rebuilt.

**Changing a setting:** set it, then **Release change** on `iraops-release`:

```powershell
.\deploy\azure\scripts\set-setting.ps1 -KeyVault <vault> prod SMTP_HOST -Value smtp.office365.com
.\deploy\azure\scripts\set-setting.ps1 -KeyVault <vault> prod SMTP_PASSWORD -Secret
```

**Running a command on the server** (for example the tenant tools):

```powershell
az vm run-command invoke -g iraops-prod -n iraops-server --command-id RunShellScript --scripts "docker ps"
```

## Restoring a backup

On the server (Run command, as root):

```bash
cd /opt/arcus/releases/$(cat /opt/arcus/state/app_tag)
export ARCUS_REGISTRY=<the image_base of the release> ARCUS_VERSION=$(cat /opt/arcus/state/app_tag) ARCUS_ITOP_VERSION=$(cat /opt/arcus/state/itop_tag)
export ARCUS_ENV_FILE=/opt/arcus/shared/prod.env ITOP_ENV_FILE=/opt/arcus/shared/itop.env
alias dc='docker compose -f docker/docker-compose.prod.yml -f deploy/azure/server/docker-compose.azure.yml --env-file /opt/arcus/shared/prod.env'
dc run --rm backup restore                      # lists the backups
dc stop itop itop-cron bff web
dc run --rm backup restore 20261103T020000Z      # the one to restore
dc up -d --no-build
```

A backup older than the server's copy is in Storage:
`AZCOPY_AUTO_LOGIN_TYPE=MSI azcopy copy "https://<account>.blob.core.windows.net/daily/<folder>" /opt/arcus/backups --recursive`.

## Building it from nothing

Once; this is how it was first built. Needs the Azure CLI (`az login`), the
AWS CLI signed in to the Intertec account, and Terraform.

```powershell
# 1. Azure: state storage, then everything else (about 30 resources)
.\deploy\azure\scripts\bootstrap-state.ps1 -SubscriptionId <subscription>
cd deploy\azure\terraform
"subscription_id = `"<subscription>`"`noperator_ips = [`"<your public IP>/32`"]`nnotify_emails = [`"approver@example.com`"]" | Set-Content terraform.tfvars
terraform init -backend-config=backend.hcl
terraform apply

# 2. AWS: the server's role, the release bucket, the iraops-release pipeline
cd ..\aws
"azure_tenant_id = `"$(terraform -chdir=../terraform output -raw tenant_id)`"`nazure_server_principal_id = `"$(terraform -chdir=../terraform output -raw server_principal_id)`"`nnotify_emails = [`"approver@example.com`"]" | Set-Content terraform.tfvars
terraform init
terraform apply

# 3. Azure again: tell the server where AWS is
cd ..\terraform
"aws_role_arn = `"$(terraform -chdir=../aws output -raw server_role_arn)`"`naws_release_bucket = `"$(terraform -chdir=../aws output -raw release_bucket)`"" | Add-Content terraform.tfvars
terraform apply

# 4. The licence key may sign for IRAOPS (deploy/aws: one line in licensing.auto.tfvars)
#    licence_extra_signers = ["<server_role_arn>"]   then plan (only the key policy changes) and apply

# 5. Settings
cd ..\..\..
.\deploy\azure\scripts\init-settings.ps1 -KeyVault (terraform -chdir=deploy/azure/terraform output -raw key_vault) `
  -AppUrl (terraform -chdir=deploy/azure/terraform output -raw app_url) -TimeZone Asia/Dubai
```

Then:

1. **Confirm the subscription email** AWS sends to each approver.
2. **Release change** on `iraops-release`, and approve. The first deploy
   installs iTop (about 15 minutes after approval).
3. Sign in as `admin` with the password from Key Vault
   (`itop--ITOP-ADMIN-PASSWORD`), and set up MFA.
4. Multi-customer mode needs a tenant: create the first organisation, then
   `tenants set` (docs/licensing-go-live.md) through Run command, and issue
   its licence on the Licences page.

## Mail and a domain, later

Mail: the same settings as Intertec (`deploy/aws/README.md`, "Mail"), set with
`set-setting.ps1` (`prod`/`itop` instead of `prod-env`/`itop-env`).

A domain: add it to Front Door (custom domain with a managed certificate) in
`terraform/frontdoor.tf`, add the DNS record Front Door asks for, then set
`APP_BASE_URL` and `CORS_ORIGINS` to `https://<domain>` and **Release change**.

## Costs

About USD 130–160 a month: the VM (B2ms) and its 128 GB premium disk, Front
Door Standard, VM backups, Storage, Key Vault, plus data transfer for the
images pulled from AWS on each release.
