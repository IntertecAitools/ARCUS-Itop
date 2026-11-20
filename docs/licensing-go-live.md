# Switching production to multi-customer mode, with licensing

Decided on 2026-11-19:
- **Mode:** production becomes a multi-customer platform (`TENANCY=on`), so licences are issued on the operator **Licences** page.
- **Customer:** Intertec's own company is the first customer, id `intertec`, with every organisation in it.
- **Licence:** Enterprise, 50 agents.
- **Platform operators:** `admin` and `Platform_Admin`.

Rehearsed on the local system on 2026-11-19 (`npm run e2e:tenancy-switch`, 10/10).

Every production step is a settings change or an operator command, followed by a pipeline run with its manual approval. Nothing is deleted at any step. Steps 1–2 are inert while `TENANCY` is off, and step 3 can be undone by setting `TENANCY=off`.

## What changes for people

| Who | After the switch |
|---|---|
| `admin`, `Platform_Admin` (platform operators) | As today, plus the **Licences** page. They are the only ones who change shared reference data (knowledge articles/FAQs, brands, models, profiles), notification settings and customers' web addresses, or give the Administrator profile. Licensing never blocks them. |
| Other administrators | Administrators of the Intertec customer: users, organisations, teams, branding, email domains, the Licence page. Data imports must run from an account limited to Intertec's organisations, not an Administrator account. |
| Agents and requesters | No change. |

## 0. Before you start

- **Merge the PR** that adds `tenants … --all-orgs` and `tenants … unclaimed`, and approve its deploy. The commands must be in the production image.
- **Operator commands on the server:**
  1. In AWS Console, open EC2 → `arcus-servicedesk-server` → Connect → **Session Manager**.
  2. Run:

```bash
sudo -i
cd /opt/arcus/releases/$(cat /opt/arcus/state/app_tag)
export ARCUS_REGISTRY=$(aws ecr describe-registry --query registryId --output text).dkr.ecr.us-east-1.amazonaws.com/arcus-servicedesk/
export ARCUS_VERSION=$(cat /opt/arcus/state/app_tag) ARCUS_ITOP_VERSION=$(cat /opt/arcus/state/itop_tag)
export ARCUS_ENV_FILE=/opt/arcus/shared/prod.env ITOP_ENV_FILE=/opt/arcus/shared/itop.env
alias dc='docker compose -f docker/docker-compose.prod.yml --env-file /opt/arcus/shared/prod.env'
alias tenants='dc exec -e TENANCY=on -e PLATFORM_LOGINS=admin,Platform_Admin bff node dist/cli/tenants.js'
```

`-e TENANCY=on` applies to the command only. The running service is not affected.

## 1. Create the Intertec customer with every organisation

```bash
tenants set intertec --name Intertec --all-orgs
tenants list
```

This saves the customer in the BFF database. It has no effect until step 3.

## 2. Check nobody would be locked out

```bash
tenants unclaimed
```

The aim is **"0 no tenant claims"**. Each account it lists would be refused at sign-in after step 3. Fix each one before going on, either:
- give the account's person an organisation of Intertec, or
- add the account to `PLATFORM_LOGINS` if it is an operator.

Then run `tenants set intertec --name Intertec --all-orgs` again if organisations were added.

## 3. Switch the settings

On your machine, from the repository root:

```powershell
.\deploy\aws\scripts\set-setting.ps1 prod-env TENANCY -Value on
.\deploy\aws\scripts\set-setting.ps1 prod-env PLATFORM_LOGINS -Value "admin,Platform_Admin"
.\deploy\aws\scripts\set-setting.ps1 prod-env LICENSING -Value warn
.\deploy\aws\scripts\set-setting.ps1 prod-env LICENCE_SIGNER -Value kms
.\deploy\aws\scripts\set-setting.ps1 prod-env LICENCE_KMS_KID -Value arcus-2026-1
```

Then in CodePipeline, `arcus-servicedesk-prod`: **Release change**, and approve the deploy.

Until step 4, staff see a "No valid licence … (warning mode: nothing is blocked yet)" banner. Do step 4 straight away.

## 4. Issue and install the Intertec licence

1. Sign in as `admin` at the normal address.
2. Open **Administration → Licences** and select **Issue a licence**. Fill in:
   - customer: Intertec
   - type: subscription, 1 year
   - edition: Enterprise
   - deployment: SaaS
   - binding: `tenant:intertec`
   - agents: 50
3. Issue it. The server signs it with the KMS key and installs it at once.
4. A staff member (not an operator) signs in and opens **Administration → Licence**. It shows **Enterprise, valid**. The first Intertec administrator accepts the **terms of service** there.

## 5. Two weeks of warning mode

Licensing checks everything and blocks nothing. On the Licence page, the **History** shows:
- **"Would have refused"** events;
- banners at 80% and 100% of a limit.

If something needs changing, use **Re-issue** on the Licences page.

## 6. Enforce

With Commercial's agreement:

```powershell
.\deploy\aws\scripts\set-setting.ps1 prod-env LICENSING -Value enforce
```

Then release and approve.

## Later

- **New organisations:** create them in **Organisation admin**, which puts them in the Intertec customer. An organisation made any other way belongs to no customer, and its people are refused. Fix that with `tenants set intertec --name Intertec --all-orgs`.
- **A second customer company:** on the Licences page, **Issue a licence** with deployment SaaS and "A new customer: create its tenant" ticked. It creates the customer (its organisations and web address) and its licence in one step.
- **Renewal:** use **Re-issue** before the end date (administrators are warned 30 days ahead).
- **Legal's final agreement:** replace the text in `backend/src/platform/licensing/eula.ts` with a new version. Administrators are asked to accept it again.
- **Undo multi-customer mode:** `set-setting.ps1 prod-env TENANCY -Value off`, then release. The customer records stay in the database, unused.
- **Issuing without the page** (for example a deployed customer's licence): `backend/scripts/issue-licence.ps1`, with your MFA code.
