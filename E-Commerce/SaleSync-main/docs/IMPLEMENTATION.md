# Implementation and verification — 22 October 2026

This records the initial backend phase. The current seller/checkout/fulfillment/customer implementation and verification results are in [COMMERCE.md](COMMERCE.md).

The starting workspace was a two-file vanilla HTML prototype. No backend, database, or Git repository existed. The user authorized creation of an API-ready backend. A pre-edit recovery ZIP preserves both original HTML files, assets, existing documentation/screenshots and the original local-preview scripts.

## Completed and verified locally

- Node.js backend with SQLite persistence, additive schema migration, public catalog and OpenAPI-described JSON endpoints.
- Gmail-only customer registration, scrypt password hashes, randomly generated four-digit codes protected with keyed hashes/nonces, single use, expiration, replacement invalidation, attempt locks, cooldowns, persistent account/IP quotas, and inactive accounts until verification.
- Failed email delivery preserves registration; correct-password sign-in resumes pending verification. Incorrect-code, expired-code, lockout, resend and delivery states have backend responses and customer UI.
- HttpOnly sessions, CSRF protection, explicit-origin checks, duplicate Gmail mailbox prevention, session expiration/revocation, and no public role-assignment API.
- Individual Maintenance and Management accounts provisioned through a local CLI, with backend enforcement and scoped audit trails. Management catalog/stock edits, customer suspension/restore, unpaid-order cancellation and report visibility are functional. Maintenance health, sanitized errors, technical audit and email/maintenance configuration are functional.
- Compact customer and staff layouts, a labeled verification form, responsive product grids and preserved navigation.
- Separate per-admin drafts and test records, private configuration preview, validation, optimistic version checks, explicit apply with summary/reason/audit, and field-scoped rollback that preserves unrelated changes.
- Captured Sandbox email and simulated Sandbox checkout cannot send customer mail, charge, change live inventory or create production orders.
- API-backed browse → cart → delivery → saved unpaid order request; server checks stock and computes prices/shipping. The original `?demo=1` payment simulation remains intact.
- Store settings are consumed by the storefront (name/title, tagline, support email and shipping). Maintenance mode displays the configured notice and blocks new order requests. Verification settings control new challenges.

## Changed files

| Files | Purpose |
| --- | --- |
| `backend/config.cjs`, `database.cjs`, `security.cjs`, `mailer.cjs` | Environment validation, persistent schema, hashing and Gmail transport |
| `backend/emails/verification.cjs`, `assets/logo-email.svg`, `assets/logo-email.png` | Branded HTML/plain-text verification email and clear 512px inline logo; logo paths are under `SaleSync_Online_Alive_v5/` |
| `backend/app.cjs`, `settings.cjs` | HTTP API, permissions, registration, order requests, configuration drafts/apply/rollback |
| `backend/start.cjs`, `create-admin.cjs` | Application startup and individual admin provisioning |
| `SaleSync_Online_Alive_v5/assets/live.js` | Adapter connecting the existing storefront to the API |
| `SaleSync_Online_Alive_v5/assets/upgrade.css` | Compact spacing, responsive staff settings and accessible form styling |
| Both original HTML files | Online asset hooks; embedded compact CSS for the self-contained offline preview |
| `tests/backend.test.cjs`, `tests/browser.cjs` | Isolated API/security and real-Chrome integration checks |
| `tests/email.test.cjs`, `scripts/preview-email.cjs` | Captured MIME, selectable-code/expiry/inline-image checks and local email/logo rendering |
| `scripts/sync-ui.cjs`, `generate-api-schema.cjs` | Repeatable UI-hook and OpenAPI generation |
| `package.json`, `package-lock.json` | Node commands and pinned Nodemailer dependency |
| `.env.example`, `.gitignore`, `.htaccess` | Setup template, private-file exclusions and XAMPP defense in depth |
| Root `README.md`, `docs/API.md`, `docs/openapi.json` | Setup, integration guide and API contract |

## Test results

| Check | Result |
| --- | --- |
| `npm.cmd test` | **26/26 passed** (including Workspace sender handling, branded email/MIME tests, sender consistency and DNS diagnostics) |
| Branded email previews at 320, 390 and 720 px | Embedded 512px logo loaded; no horizontal overflow; desktop/mobile screenshots saved locally |
| Real Chrome against an isolated backend, SQLite database and captured mailer | **33/33 checks passed; 0 JavaScript page errors** |
| Original online/offline demo browser regression suite | **58/58 checks passed; 0 JavaScript page errors** |
| Connected customer and Settings layouts at 360, 390, 768, 1024, 1440 px | No horizontal page overflow in tested views |
| `npm.cmd audit --omit=dev` | **0 known vulnerabilities reported** for installed dependency tree |

Backend coverage includes correct/wrong/expired/consumed codes, replacement code invalidation, quota/cooldown, delivery failure, missing sender configuration, unverified login, duplicate Gmail aliases, session expiry/logout, role bypass attempts, CSRF/origin rejection, configuration validation/conflicts/rollback, isolated test side effects, concurrent resend/verify, server-calculated order amounts, customer order isolation, suspension, maintenance enforcement and additive migration.

Browser coverage includes registration, a wrong-code retry, account activation, live cart and unpaid-order persistence, individual admin sign-in, inventory editing, scoped settings, private preview, explicit apply, public configuration visibility, rollback, test email/checkout states and failed delivery recovery. Test databases are separate from `data/salesync.sqlite`. Raw verification codes are captured only inside test-process memory; they are not API-accessible.

## Required setup

1. Node.js 24+, `npm.cmd ci`, then copy `.env.example` to `.env`.
2. Configure a dedicated Gmail or Google Workspace sender with `GMAIL_USER` and either `GMAIL_APP_PASSWORD` or the OAuth2 trio `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. Custom-domain senders require a Google-hosted mailbox and permitted SMTP authentication; the backend removes display spaces from app passwords.
3. Run `npm.cmd run admin:create` once for each administrator, using their own name/email/password and one role.
4. Run `npm.cmd start` and open `http://127.0.0.1:3000/`.
5. For production, explicitly set `APP_SECRET` (32+ characters), `APP_ORIGIN=https://…`, `COOKIE_SECURE=true`, `NODE_ENV=production`, and a persistent restricted `DATABASE_PATH`. `HOST`, `PORT`, optional same-site `API_ALLOWED_ORIGINS`, session duration and initial verification defaults are in `.env.example`. After initialization, editable verification settings are stored in SQLite; environment values seed only the initial configuration.

The workspace is located under XAMPP’s htdocs. The Node server uses a static allowlist and was verified to deny environment/database/source/checkpoint requests. A root `.htaccess` also denies sensitive paths if Apache is used, but Apache was not running during validation; its override behavior is **not verified**. Serve through Node, or confirm the actual reverse-proxy/Apache rules before exposing this folder.

## Remaining blockers and limits

- Gmail SMTP authentication was verified after local sender setup, and the user confirmed verification delivery. The redesigned email was tested through captured MIME and local browser previews; its latest real-inbox appearance has not yet been checked. Automated tests never use sender credentials or send real emails.
- The user reported Spam placement. Public DNS checks found no SPF or DMARC record at the checked school-domain names; no default-selector Google DKIM record was found, though a different selector may be in use. App sender consistency, TLS and transactional wording were improved. Actual received authentication results and new inbox placement are unverified; the school administrator must review domain authentication. See `docs/EMAIL-DELIVERY.md`.
- **PayMongo, signed webhooks, stock reservations, live payment settlement, refunds, POS and couriers remain disconnected.** New persisted orders are unpaid requests only. The original full payment flow is explicitly simulated.
- Real seller account approval, account recovery and customer-support messaging remain planned. Admin creation is an operator CLI task; there are no default shared accounts.
- Other groups’ recommendations were absent. Approved policies, business contacts, real product photographs and production hosting settings were not supplied.
- Responsive and control-label checks were performed; a full accessibility audit, external penetration test, load test and hosted infrastructure verification were not performed.

Recovery archive: `checkpoints/before-fullstack-upgrade-2026-10-22.zip`; SHA-256 `CE571CED5E28E3F3FE9F08ADE7BBA8BCAA5D1C4FA567696BD7A1F5A26FD6DD26`. Restore into a separate directory; never replace a current database to recover the original UI.
