# Security Scan — Supply-Chain / Dependency Audit

**Date:** 2026-07-24
**Scope:** npm dependency supply-chain audit of the whole repo, focused on
**compromised packages that steal credentials** (env-var / token / `~/.npmrc` /
SSH-key / CI-secret exfiltration via malicious install scripts or trojaned
package versions).
**Commit audited:** `d606d1f` (branch `YN-10563-client-subscriptions-endpoint`)
**Method:** read-only static audit of manifests, lockfiles, and installed
`node_modules`, plus live `npm audit` against the registry advisory DB. No
`npm install` / lifecycle scripts were executed during the audit.

---

## Verdict

**✅ NO evidence of a compromised or credential-stealing package** in any
lockfile or in the installed `node_modules` trees. Zero malware-class advisories
from `npm audit`; zero known-bad `name@version` matches; zero suspicious install
scripts or exfiltration signatures.

There is a backlog of **ordinary** (non-malware) vulnerability advisories, a few
of which matter for the production API server — see
[npm audit summary](#npm-audit-summary). Those are patch-priority CVEs, **not**
evidence of compromise.

---

## Dependency surface

- **Layout:** npm workspaces + `lerna` 6.6.1 monorepo. Root `package.json`
  (workspaces `apps/*`) plus a standalone `docs/` project.
- **Lockfiles (all npm `lockfileVersion: 3`, all resolved from
  `registry.npmjs.org` — no git/http-tarball/`file:` deps):**

  | Lockfile | `resolved` entries |
  |---|---|
  | `package-lock.json` (root) | ~2,833 |
  | `apps/platform/package-lock.json` | ~1,146 |
  | `apps/ui/package-lock.json` | ~1,554 |
  | `docs/package-lock.json` | ~1,118 |

- Repo manifests define **no** `preinstall`/`install`/`postinstall` hooks of
  their own. No `.npmrc` anywhere in the repo or `node_modules`; no committed
  tokens.

---

## Confirmed malicious / known-compromised packages

**None.** Every resolved `name@version` was cross-referenced against known npm
supply-chain incidents:

- **Sept 2025 `chalk`/`debug` maintainer-phishing compromise** — all resolved
  versions of `chalk`, `debug`, `ansi-styles`, `strip-ansi`, `ansi-regex`,
  `color-convert`, `color-name`, `error-ex`, `is-arrayish`, `supports-color`,
  `wrap-ansi` **predate** the trojaned releases. Clean.
- **"Shai-Hulud" self-replicating worm (Sept 2025)** — no
  `postinstall: node bundle.js` in any of the ~4,500 nested `package.json`
  files under `node_modules`; no dropped `bundle.js` at any package root; no
  worm workflow directories. Clean.
- **Older incidents** — `coa`, `rc`, `ua-parser-js`, `eslint-scope` all resolve
  to safe versions; no `event-stream`/`flatmap-stream`, `node-ipc`, or
  sabotaged `colors`/`faker` versions anywhere. Clean.
- **Typosquats** — an edit-distance scan of all unique package names against
  popular-package names produced only legitimate packages (e.g. `gaxios`,
  `enquirer`, `colord`, `jws`, `dargs` are genuine). No lookalikes.
- **Rogue packages** — every installed package root in `node_modules` is present
  in a lockfile; zero packages installed that the lockfile does not declare.

---

## Install scripts & exfiltration patterns

All lifecycle scripts that execute on install are benign; the non-native ones
were read:

| Package | Install script | Assessment |
|---|---|---|
| `@parcel/watcher` | `node-gyp-build` | native prebuild loader (benign) |
| `msgpackr-extract` | `node-gyp-build-optional-packages` | optional accel, JS fallback (benign) |
| `farmhash` | `prebuild-install \|\| node-gyp rebuild` | native hash lib, hard dep of `firebase-admin` (benign) |
| `core-js` / `core-js-pure` | `node -e "…postinstall…"` | OpenCollective funding banner only (benign) |
| `protobufjs` | `node scripts/postinstall` | version-scheme warning only (benign) |
| `nx` | `node ./bin/compute-project-graph` | local graph cache (benign) |

- **Zero `preinstall` scripts** in the entire tree.
- Exfil-signature grep across all of `node_modules` (`webhook.site`, Discord
  webhooks, `burpcollaborator`, `*.oast.*`, `requestbin`, `pipedream.net`,
  `interactsh`, `trufflehog`) produced **one** hit — documentation prose in
  `node_modules/pino/docs/transports.md` (benign).
- **CI:** the only secret referenced by any workflow is `secrets.GITHUB_TOKEN`
  (ghcr login in `build.yml`). No curl/wget to external hosts in any workflow.

---

## npm audit summary

Lockfile-only (`npm audit --package-lock-only`), run 2026-07-24. **Zero
malware-class advisories** (no CWE-506/507/912, no "malware" titles) in any
tree. Ordinary-vulnerability counts:

| Lockfile | Total | Critical | High |
|---|---|---|---|
| root | 158 | 11 | 67 |
| `apps/platform` | 80 | 9 | 23 |
| `apps/ui` | 68 | 3 | 34 |
| `docs` | 72 | 3 | 28 |

Most criticals are in the **dev toolchain** (react-scripts / webpack / lerna
chains) and don't ship to production. The advisories that matter because they
are **runtime deps of the API server** (`apps/platform`):

- `@node-saml/node-saml` ≤5.0.1 — **SAML authentication bypass** (prioritize if
  SSO is enabled in production)
- `xml-crypto` 3.x — XML signature-verification bypass (same SSO surface)
- `koa` ≤2.16.3 — open redirect / ReDoS
- `handlebars` ≤4.7.8 — JS injection (used for message templating)
- `protobufjs`, `jsonpath` — prototype-pollution / code-injection classes
- `form-data`, `nodemailer` ≤9 — misc
- Deprecated `request` still present via legacy push-notification deps

These are **patch-priority CVE fixes, not compromise evidence.**

---

## Remediation applied

**CI hardened to block install-script execution and pin to the lockfile.** All
GitHub Actions jobs that previously ran bare `npm install` now run
`npm ci --ignore-scripts`:

- `.github/workflows/test.yml` — `lint`, `test`, and `build` jobs switched from
  `npm install` (the `test` job was `npm install && npm install --save-dev`) to
  `npm ci --ignore-scripts`. The `test` job additionally runs `npm rebuild
  farmhash`, because `farmhash` is a **hard native runtime dependency**
  (`firebase-admin` → `node-pushnotifications`, imported at module top level in
  `apps/platform/src/providers/push/LocalPushProvider.ts`) that the jest suite
  loads. Rebuilding only that one explicitly-trusted package keeps the tests
  working while every **other** transitive package's install script stays
  disabled.
- `.github/workflows/build.yml` — release / Docker-publish job (which holds a
  registry-write `GITHUB_TOKEN`) switched from `npm install` to
  `npm ci --ignore-scripts`. No native rebuild is needed on the host because the
  image is built by the Dockerfile's own install; this host step only provisions
  `lerna` to drive the build.
- `.github/workflows/docs.yml` — already used `npm ci` (lockfile-faithful); left
  unchanged.

**Why this matters for the stated concern:** with bare `npm install`, a *future*
compromised version of any transitive dependency would execute its malicious
`postinstall` inside CI — where a `GITHUB_TOKEN` and other secrets are present.
`npm ci --ignore-scripts` makes CI installs reproducible (lockfile-pinned) and
prevents arbitrary install scripts from running automatically; only the one
audited native dependency is rebuilt by explicit name.

---

## What was NOT verified / recommended next steps

- **On-disk integrity of `node_modules` was not re-validated** against pristine
  registry tarballs. A tampered-in-place `node_modules` that still matches
  lockfile *paths* would evade the checks in this audit. A clean
  `npm ci --ignore-scripts` in a fresh environment validates the lockfile
  `integrity` (SRI) hashes and closes this gap.
- **Lockfile ↔ package.json sync:** `npm ci` fails fast if a manifest and its
  lockfile have drifted. Dependencies were not touched by recent work, so this
  should pass; if a job fails with an `npm ci` sync error, run `npm install`
  locally and commit the refreshed lockfile (the hard failure is the intended
  safety behavior, not a regression).
- **Latest advisories:** the known-bad `name@version` list is from model
  training data; for incidents after the training cutoff this audit relied on
  live `npm audit`, which reported no malware advisories for these exact
  versions on the scan date.
- **Recommended follow-ups:**
  - Patch the runtime API-server advisories above — start with
    `@node-saml/node-saml` if SAML SSO is enabled in production.
  - Add Dependabot (or `npm audit` gating) so new advisories surface on PRs.
  - Consider committing a repo-root `.npmrc` with `ignore-scripts=true` for
    developer machines, with a documented allowlist rebuild step (`npm rebuild
    farmhash`) — mirrors the CI posture locally.

---

*Audit performed with an automated agent (Fable 5) driving read-only static
analysis + live `npm audit`. Re-run after any significant dependency bump.*
