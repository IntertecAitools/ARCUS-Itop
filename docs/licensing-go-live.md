# Switching licensing on in production

Production runs as **one installation**: `TENANCY` is not set. So it needs
**one licence**, bound to the installation, uploaded by an administrator on
the Licence page. The operator Licences page belongs to multi-tenant
platforms and is not used here.

Every step below is a settings change plus a pipeline run with its manual
approval. Nothing is deleted at any step, and setting `LICENSING` back to
`off` undoes it.

## 0. Before you start

- Licence-signing key in AWS KMS: in place since 2026-11-19 (`alias/arcus-licence-signing`, kid `arcus-2026-1`). Arcus trusts it from PR #72.
- **Issuer:** you need an authenticator-app MFA device on your AWS user (a passkey works only in the console) and the AWS CLI signed in as yourself.
- **Decide the edition and the number of agents with Sales**: for Intertec's own production, usually Enterprise. Step 2 shows the real counts first.

## 1. Turn on warning mode

```powershell
.\deploy\aws\scripts\set-setting.ps1 prod-env LICENSING -Value warn
```

Then in CodePipeline, `arcus-servicedesk-prod`: **Release change**, and approve the deploy.

What changes:
- The licence module loads.
- The installation gets its id and starts a 30-day trial.
- Staff see a small blue notice: "Evaluation: 30 days left".
- **Nothing is blocked** in warning mode.

## 2. Read the installation id and the real usage

Sign in as an administrator and open **Administration → Licence**:

- **Installation id:** the licence will be bound to it. Copy it.
- **Usage:** agents and configuration items counted now. Choose the edition and agent count so these fit, with room to grow. The CI limit is 2,500 / 10,000 / 50,000 by edition, plus packs of 1,000.

## 3. Issue the licence (on your machine, about a minute)

```powershell
cd backend
powershell -ExecutionPolicy Bypass -File scripts/issue-licence.ps1 `
  -Customer "Intertec" -Order "INTERNAL-2026" -Edition ENT -Agents 50 `
  -Binding install:<installation id> -Term 1
```

The script:
1. asks for your MFA code;
2. signs the licence in KMS;
3. records it in the licence register, `backend/.licence-dev/register.json` on your machine;
4. verifies it.

Keep that register file safe, for example in a backed-up company folder. It is the record of every licence issued. Never commit it.

## 4. Install it

Still on **Administration → Licence**:
1. paste or upload the `.lic` file;
2. select **Check**: it shows what the licence grants;
3. accept the end-user licence agreement;
4. select **Install licence**.

It applies at once, and the evaluation notice goes away.

## 5. Two weeks of warning mode

Licensing checks everything and blocks nothing. Look at the **History** on the Licence page, or ask Claude to review it:
- **"Would have refused"** events: a feature outside the edition, or a limit reached. Each is a sign the edition or the limits need changing before enforcement.
- Banners at 80% and 100% of a limit.

If something needs changing, issue a new licence (step 3) and install it (step 4).

## 6. Enforce

With Commercial's agreement:

```powershell
.\deploy\aws\scripts\set-setting.ps1 prod-env LICENSING -Value enforce
```

Then release and approve the pipeline. From now on:
- the edition's features are enforced;
- limits pause new use past the limit plus 10%;
- after the end date and 30 days of grace, the service becomes read-only.

## Later

- **Renewal:** before the end date (administrators are warned 30 days ahead), issue a new licence with the same `-Binding` and install it. Several licences can be installed; the newest valid one wins, so it can be installed early.
- **Legal's final agreement:** replace the text in `backend/src/platform/licensing/eula.ts` with a new version. Administrators are asked to accept it again.
- **Undo:** `set-setting.ps1 prod-env LICENSING -Value off`, then release. Licensing stops; nothing is deleted.
