# Production on AWS (CodePipeline)

Production runs on **one EC2 server** with Docker (`docker/docker-compose.prod.yml`),
behind **CloudFront** (HTTPS), in account `557690608274`, region `us-east-1`,
VPC `Intertec-vpc`. Every change reaches it through **CodePipeline**, and a person
approves each deploy.

```
merge to main ─▶ Source ─▶ Build ─────────────────▶ Approval ─────▶ Deploy
                 (GitHub)   tests, 3 images → ECR,   email; click    backup → new release →
                            release bundle → S3      Approve in AWS  iTop setup/upgrade → health
                                                                     check → rollback if unhealthy
```

Everything is created by Terraform in `deploy/aws/terraform/` and is named and
tagged `arcus-servicedesk`. Nothing else in the account is touched.

| What | Where |
|---|---|
| The app | `terraform output app_url` (a `*.cloudfront.net` address until a domain is added) |
| Pipeline | CodePipeline → `arcus-servicedesk-prod` |
| Server | EC2 → `arcus-servicedesk-server`. No SSH: **Connect → Session Manager** |
| Settings and secrets | Systems Manager → Parameter Store → `/arcus-servicedesk/prod/prod-env/*` and `/itop-env/*` |
| Deploy logs | CloudWatch Logs → `/arcus-servicedesk/deploy` (and the Deploy stage's CodeBuild log) |
| Backups | S3 `arcus-servicedesk-backups-557690608274/daily/` (90 days), plus daily disk snapshots (14) |
| Images | ECR `arcus-servicedesk/arcus-bff`, `arcus-web`, `arcus-itop` (30 newest kept) |

## Day to day

**Releasing a change:** merge a PR into `main`. The pipeline runs the tests and
builds (about 10–15 minutes, longer when iTop changed), then emails the approvers.
Open the link, check the commit, and press **Approve**. The deploy takes about
2 minutes of downtime, or about 10 minutes when iTop or its extensions changed.
**Reject** stops it, and production stays as it is.

**When a deploy fails:** the server switches back to the previous release by
itself and the pipeline turns red (with an email). The Deploy stage's log shows
why.

**Rolling back on purpose:** CodePipeline → the pipeline → **History** → an
earlier successful run → **Rollback** (it redeploys that run's images; nothing
is rebuilt). An iTop *upgrade* only goes forward: undoing one means restoring
the backup taken just before it (below).

**Changing a setting** (mail, the Bedrock key, a timeout): set it, then
**Release change** on the pipeline (or wait for the next deploy):

```powershell
.\deploy\aws\scripts\set-setting.ps1 prod-env AWS_BEARER_TOKEN_BEDROCK -Secret   # hidden prompt
.\deploy\aws\scripts\set-setting.ps1 prod-env SMTP_HOST -Value smtp.office365.com
```

The setting names are the ones in `docker/prod.env.example` (`prod-env`) and
`docker/itop.env.example` (`itop-env`).

## Mail, once IT provides the mailbox

| File | Setting | Value |
|---|---|---|
| `prod-env` | `SMTP_HOST`, `SMTP_PORT` | `smtp.office365.com`, `587` |
| `prod-env` | `SMTP_USER`, `SMTP_PASSWORD` (secret) | the mailbox |
| `prod-env` | `MAIL_FROM`, `NOTIFICATION_FROM` | `Intertec Servicedesk <servicedesk@intertecsys.com>` |
| `itop-env` | `ITOP_SMTP_HOST`, `ITOP_SMTP_PORT`, `ITOP_SMTP_ENCRYPTION` | `smtp.office365.com`, `587`, `tls` |
| `itop-env` | `ITOP_SMTP_USER`, `ITOP_SMTP_PASSWORD` (secret) | the mailbox |
| `itop-env` | `ITOP_MAIL_FROM_ADDRESS`, `ITOP_MAIL_FROM_LABEL` | the mailbox, `Intertec Servicedesk` |
| `prod-env` | `MAIL_INTAKE_SOURCE`, `MAIL_INTAKE_ADDRESS`, `MAIL_INTAKE_OAUTH_TENANT_ID`, `MAIL_INTAKE_OAUTH_CLIENT_ID`, `MAIL_INTAKE_OAUTH_CLIENT_SECRET` (secret) | email to ticket: `imap`, the mailbox, the Entra app |

## Adding a domain later

1. Request a certificate in **ACM, us-east-1**, for e.g. `servicedesk.intertecsys.com` (DNS validation).
2. Add the domain and certificate to the CloudFront distribution (`cdn.tf`: `aliases` and `viewer_certificate`), then `terraform apply`.
3. Add a DNS record pointing the domain at the CloudFront address (CNAME).
4. Set `APP_BASE_URL` and `CORS_ORIGINS` to `https://<domain>`, then **Release change**.

## Restoring a backup

In Session Manager on the server (`sudo -i`):

```bash
cd /opt/arcus/releases/$(cat /opt/arcus/state/app_tag)
export ARCUS_REGISTRY=$(aws ecr describe-registry --query registryId --output text).dkr.ecr.us-east-1.amazonaws.com/arcus-servicedesk/
export ARCUS_VERSION=$(cat /opt/arcus/state/app_tag) ARCUS_ITOP_VERSION=$(cat /opt/arcus/state/itop_tag)
export ARCUS_ENV_FILE=/opt/arcus/shared/prod.env ITOP_ENV_FILE=/opt/arcus/shared/itop.env
alias dc='docker compose -f docker/docker-compose.prod.yml --env-file /opt/arcus/shared/prod.env'
dc run --rm backup restore                      # lists the backups
dc stop itop itop-cron bff web
dc run --rm backup restore 20261103T020000Z      # the one to restore
dc up -d --no-build
```

A backup older than the server's copy is in S3: `aws s3 sync s3://arcus-servicedesk-backups-557690608274/daily/<folder> /opt/arcus/backups/<folder>`.

## Building it from nothing

Once per account; this is how it was first built.

```powershell
.\deploy\aws\scripts\bootstrap-state.ps1        # Terraform's state bucket
cd deploy\aws\terraform
'notify_emails = ["approver@intertecsys.com"]' | Set-Content terraform.tfvars
terraform init
terraform apply                                 # 42 resources
cd ..\..\..
.\deploy\aws\scripts\init-settings.ps1 -AppUrl (terraform -chdir=deploy/aws/terraform output -raw app_url) -TimeZone Asia/Dubai -AdminLogin admin
```

Then:

1. **Connect GitHub:** Developer Tools → Connections → `arcus-servicedesk-github` → **Update pending connection**, then authorise the AWS Connector app for the `IntertecAitools` organisation. This needs a GitHub organisation admin.
2. **Confirm the subscription email** AWS sends to each approver.
3. **Release change** on the pipeline. The first deploy installs iTop (about 15 minutes after approval).
4. Sign in as `admin` with the password from Parameter Store (`itop-env/ITOP_ADMIN_PASSWORD`, **Show decrypted value**), and set up MFA.

Approvers need an AWS console login with permission to approve
(`codepipeline:PutApprovalResult` on this pipeline).
