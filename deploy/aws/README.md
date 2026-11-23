# Production on AWS (CodePipeline)

Production runs on **one EC2 server** with Docker (`docker/docker-compose.prod.yml`),
behind **CloudFront** (HTTPS), in account `557690608274`, region `us-east-1`,
VPC `Intertec-vpc`. Every change reaches it through **CodePipeline**, and a person
approves each deploy.

```
merge to main ─▶ Source ─▶ Build ─────────────────▶ Approval ─────▶ Deploy
                 (GitHub)   security scans, tests,   email; click    backup → images pulled
                            3 images scanned → ECR,  Approve in AWS  (signatures checked) → new
                            SBOMs + reports → S3,                    release → iTop setup/upgrade
                            images signed,                           → health check → rollback
                            release bundle → S3                      if unhealthy
```

The security steps (readiness items SEC-02 to SEC-05) are described in
[Security in the pipeline](#security-in-the-pipeline) below.

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
| Images | ECR `arcus-servicedesk/arcus-bff`, `arcus-web`, `arcus-itop` (30 newest kept; 60 with image signing, signatures included) |
| Scan reports and SBOMs | S3 `arcus-servicedesk-pipeline-557690608274/bundles/<APP_TAG>/security/` (180 days), and the Build stage's artifacts |

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

## Security in the pipeline

The Build stage checks the code and the images before anything can be
approved. Policy, thresholds and how to accept a risk:
[`security/README.md`](../../security/README.md).

| Step | What it does | Stops the release when |
|---|---|---|
| Source scans (SEC-02), first in Build | secrets (gitleaks), dependencies and infrastructure as code (Trivy), static analysis (Semgrep) | a critical or high finding is not fixed or accepted |
| Image scans (SEC-03), before each push | Trivy on every image, built here or reused from ECR | a critical or high vulnerability with a fix is not accepted |
| SBOMs (SEC-04) | CycloneDX SBOMs of the backend, the frontend and the three images | (never) |
| Signing (SEC-05), when turned on | the build signs the three images with a KMS key; the server checks them before starting a release | an image is unsigned, signed by another key, or changed |

Reports and SBOMs: `s3://arcus-servicedesk-pipeline-557690608274/bundles/<APP_TAG>/security/`
(`source/`, `images/`, `sbom/`), also when a scan failed. The Build log shows
the findings that failed. GitHub CI runs the same scans on every pull request,
builds and scans the images, and tests the signing scripts with a test key.

**When a scan stops a release:** read the finding in the Build log. Fix it
(usually a newer library or base image), or accept it in the repository with a
reason and an expiry (`security/README.md`, "Accepting a risk"), then merge.
For the iTop image, a newer base image needs a new date in
`docker/itop-prod/base-refresh` (the next deploy then runs iTop's upgrade step).

### Image signing (off until turned on)

`deploy/aws/terraform/image-signing.tf` creates the signing key only when
`image_signing_enabled = true`. While it is false (the default), Terraform
creates and changes nothing for it, the build prints "Image signing is off",
and the server skips the check.

To turn it on (with the approval of whoever owns the account's KMS keys):

1. Add `image_signing_enabled = true` to `deploy/aws/terraform/terraform.tfvars`.
2. `terraform plan`, and check it shows only: one KMS key and its alias
   (`alias/arcus-servicedesk-image-signing`), two IAM role policies
   (`sign-images` on the CodeBuild role, `check-image-signatures` on the
   server role), the `IMAGE_SIGNING_KEY` variable on the build and deploy
   CodeBuild projects, and the ECR lifecycle rule keeping 60 images.
3. `terraform apply`.
4. **Release change** on the pipeline: the build signs the three images and
   the deploy checks them ("signature ok" three times in the Deploy log).

The key costs about USD 1 a month. The server can read only its public key,
never sign.

**Rolling back to a release built before signing was on:** the pipeline's
Rollback redeploys that run's images, and the server refuses them unsigned.
Sign them once, from a machine with the AWS CLI and cosign (version in
`security/versions.env`), as someone allowed to use the key (the CodeBuild
role, or an administrator given `kms:Sign` for this):

```bash
aws ecr get-login-password | docker login --username AWS --password-stdin 557690608274.dkr.ecr.us-east-1.amazonaws.com
bash security/sign-image.sh awskms:///alias/arcus-servicedesk-image-signing   557690608274.dkr.ecr.us-east-1.amazonaws.com/arcus-servicedesk/arcus-bff:<APP_TAG>   557690608274.dkr.ecr.us-east-1.amazonaws.com/arcus-servicedesk/arcus-web:<APP_TAG>   557690608274.dkr.ecr.us-east-1.amazonaws.com/arcus-servicedesk/arcus-itop:<ITOP_TAG>
```

To turn it off again: `image_signing_enabled = false`, plan, apply. The key
then waits 30 days before it is deleted.

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
