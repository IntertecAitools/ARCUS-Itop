# Security scanning

Every build checks the code before it is allowed any further (readiness item
SEC-02). The same script, `security/scan-source.sh`, runs in two places:

- **The AWS build** (`deploy/aws/buildspec-build.yml`): first step of the
  Build stage. A failure stops the pipeline before any image is built or
  pushed, so nothing reaches the approval step.
- **GitHub CI** (`.github/workflows/ci.yml`, job "Security scans"): on every
  pull request and every push to main. Reports are attached to the run as the
  `security-reports` artifact (kept 30 days).

## What is scanned, and what fails the build

| Scan | Tool (pinned in `versions.env`) | Fails on |
|---|---|---|
| Secrets | gitleaks: the whole Git history in CI; the files in the AWS build (it gets no history) | any finding |
| Dependencies | Trivy `fs`: every `package-lock.json` and `composer.lock` | CRITICAL or HIGH with a fixed version available |
| Infrastructure as code | Trivy `config`: Terraform (`deploy/aws/terraform`) and the Dockerfiles | CRITICAL or HIGH |
| Static analysis | Semgrep OSS, registry rules `p/default` | severity ERROR (Semgrep's highest) |

All four always run; the script fails at the end if any failed, so one run
shows everything. Reports (JSON) go to `security-reports/source/`.

Not scanned by Semgrep and gitleaks: upstream iTop (`iTop/`), which we ship
unchanged. Its libraries are still checked by the dependency scan, and the
image scan (SEC-03) checks the built image.

The tools are downloaded by `security/install-tools.sh` at the pinned
version, and each download is checked against the SHA-256 in `versions.env`.
To upgrade a tool: pick a release at least two weeks old, change the version
and checksum together, and run the scans.

### Running it yourself

On Linux: `bash security/scan-source.sh`. On Windows (Git Bash): put
`trivy.exe` and `gitleaks.exe` (same versions) in `.security-tools/`,
`pip install semgrep==<version>` into a virtualenv on PATH, then run the same
command. `.security-tools/` and `security-reports/` are ignored by Git.

## Accepting a risk

When a finding cannot be fixed now, it may be accepted. Every acceptance is
written down in the repository, with the reason, so it is reviewed in the pull
request like any other change. Never turn a scan off or lower its threshold
to get a build through.

1. **Decide.** Fix it if you can (upgrade the library, change the code). Accept
   only when the fix is out of reach for now, or the finding is wrong (a false
   positive). The product owner approves acceptances of real risks.
2. **Record it** in the place for that scanner:

   | Scanner | Where | How |
   |---|---|---|
   | Trivy (dependencies, IaC) | `security/trivyignore.yaml` | an entry with `id`, `statement` (why), `paths` where it applies, and `expired_at` |
   | Semgrep | the line itself | `// nosemgrep: <rule id> -- <why>` (`#` in Python) |
   | gitleaks, current files | the line itself | `// gitleaks:allow (<why>)` |
   | gitleaks, Git history | `.gitleaksignore` | the finding's fingerprint, with a comment saying why |

3. **Give real risks an expiry.** `expired_at` makes Trivy fail the build again
   on that date, so the decision is looked at again: 30 days for a vulnerable
   library, at most a year for a design decision. False positives need none.
4. **Say so in the pull request** that adds the acceptance.

## Accepted today

Recorded on 2026-11-23, when these scans were switched on:

- **Upstream iTop's PHP libraries** (Guzzle, six Symfony components): 10 high
  vulnerabilities, accepted for 30 days (until 2026-12-23). iTop is not
  reachable from the internet; only the BFF's service account calls it.
  Updating them means changing upstream iTop and testing it end to end, which
  is a task of its own.
- **AWS settings** (until 2027-02-23 unless noted): no WAF in front of
  CloudFront (its own readiness item); unrestricted outbound traffic from the
  server (it needs AWS services and Microsoft 365, whose addresses change);
  the notification topic unencrypted (pipeline notices only); S3 encrypted with
  S3-managed keys rather than our own (until 2027-11-23); the web and iTop
  images start as root and drop to unprivileged workers.
- **False positives**: the S3 public access block (Trivy misreads the
  `for_each`), the local-only development Dockerfile, test values in two BFF
  unit tests, the mock API's demo TOTP secret, the iTop schema extractors
  parsing our own XML, and the developer script that needs a shell on Windows.

Fixed rather than accepted: the BFF now fixes the AES-GCM tag length to 16
bytes when it seals sessions and secrets, and the marketing site
(`weftbase-site`) moved to Next.js 15.5.29, with PostCSS and sharp pinned to
fixed versions.
