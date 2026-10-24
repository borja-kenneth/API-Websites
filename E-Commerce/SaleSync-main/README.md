# SaleSync Online — API upgrade

## Quick start for classmates (Windows)

1. Install **Node.js 24 or later** once.
2. Download this repository with **Code → Download ZIP** and extract it, or clone it with Git.
3. Double-click **`Start-Demo.cmd`** in the extracted folder. Keep its window open.

The starter installs the locked dependencies automatically (internet needed on the first run), creates a separate demo database, and opens a local page with **customer, seller, management and maintenance accounts**. Click **Open SaleSync** there. Each installation generates its own passwords; existing demo accounts and changes are preserved when you reopen it.

Demo website: **http://localhost:3001/**. The accounts page is `data/demo/accounts.html`; the local inbox is `data/demo/mail/index.html`. For registration or password recovery, request it on the website, then refresh the local inbox to read the verification code or reset email. Order/shipping/delivery emails also appear there. **No email is sent to Gmail. Payments and courier updates are simulated.** The demo uses the real frontend, backend, role checks and SQLite workflows, independently of your regular database and `.env`.

To use your regular installation, double-click **`Start-SaleSync.cmd`** instead. It installs dependencies, creates `.env` from the template if missing, starts the server and opens the site. Configure your own Gmail sender in `.env` for real email delivery. Neither starter replaces existing configuration or deletes a database. Press **Ctrl+C** in the starter window to stop. If port 3001 is occupied, close the previous demo first.

Gmail passwords, existing accounts/orders, session secrets and uploaded customer files are intentionally kept out of GitHub. Everything needed to generate a fresh, usable demo is included. Node.js and the first dependency download are still required; this is not a bundled Windows executable or online hosting.

SaleSync retains the existing vanilla JavaScript design and branding, with a Node.js API and SQLite persistence. It now supports approved customer-owned seller stores, product creation and uploads, inventory reservations, local test payments, shipment tracking, returns/test refunds, password recovery, saved addresses, private shopping state and support conversations. No real payment provider is connected. Existing accounts and historical orders are preserved through additive migrations. See the [commerce implementation and testing report](docs/COMMERCE.md).

The latest additions include automatic local courier tracking with an AfterShip adapter, queued order/shipping/delivery emails, partial returns/test refunds, verified-purchase reviews, promotions/vouchers and paginated lists. See the [current feature guide and QA checklist](docs/CUSTOMER-FEATURES.md). API **1.2.0** includes an [OpenAPI contract](docs/openapi.json), [Postman collection](docs/SaleSync.postman_collection.json) and [browser client example](examples/api-client.mjs).

## Start locally

Requires **Node.js 24 or later**. From this directory:

```powershell
npm.cmd ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd start
```

Open **http://127.0.0.1:3000/**. The API base is **http://127.0.0.1:3000/api/v1**. `localhost` is a different configured origin; use the address above or change `APP_ORIGIN` consistently. The SQLite database is created under `data/`. Migrations only add schema fields; startup never resets existing accounts or orders. Development creates a private local signing secret if `APP_SECRET` is absent. Production requires an explicit secret, HTTPS, and secure cookies.

The existing `?demo=1` account previews remain available at **http://127.0.0.1:3000/?demo=1**. They use a separate browser-storage key, perform simulated payments, and do not call account/admin APIs. The standalone offline HTML remains self-contained and browser-only; append `?demo=1` to access its sample roles. Its sample accounts never grant backend access.

## Clone on another PC

Install Git and **Node.js 24 or later**, then run:

```powershell
git clone https://github.com/estayanikhristianmaenard-a11y/SaleSync.git
cd SaleSync
npm.cmd ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd start
```

Open **http://127.0.0.1:3000/** and keep the terminal running. A new clone uses its own local SQLite database. Existing QA accounts are not included; register a customer or provision staff with `npm.cmd run admin:create`. Configure a Gmail sender locally for verification/reset/order emails, as described below. The `?demo=1` prototype is available without a real account.

Git contains application code, assets, tests and documentation. `.env`, signing secrets, databases, uploaded customer images, local QA artifacts, dependencies and recovery checkpoints stay local. Publishing this repository does not deploy the Node server. The GitHub workflow runs API/email tests on Node 24 with isolated data and captured mail; browser checks remain a separate local command.

## Gmail verification setup

Use a dedicated Gmail or Google Workspace sender. Custom-domain Workspace addresses are accepted if Google hosts the mailbox and the organization permits SMTP authentication. Configure `GMAIL_USER` and **either** `GMAIL_APP_PASSWORD` **or** all of `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. OAuth2 takes precedence. Use an app password with two-step verification, never the Google account’s normal password. App-password display spaces are removed automatically. Customer registration remains restricted to Gmail addresses. See [Nodemailer’s supported Gmail authentication guide](https://nodemailer.com/guides/using-gmail).

All credentials remain in the backend environment and are excluded from API responses, logs, static assets, and admin Settings. `.env` and database files are ignored and cannot be served by the Node server. Restart after changing environment variables.

Registration stores a scrypt password hash, then emails a cryptographically random four-digit code. Codes are HMAC-protected with a per-issue nonce, expire, are single use, and never repeat the immediately preceding issued code. A pending account cannot sign in as active until verification succeeds. Defaults: **5 minutes**, **5 incorrect attempts**, **60-second resend cooldown**, **5 sends per account per hour**, plus persistent IP and account rate limits. Gmail dot/plus aliases cannot create duplicates. Delivery failures preserve registration details and provide a retry state. Pending registration and authenticated sessions use separate HttpOnly cookies.

Without sender credentials, registration correctly reports that mail is not configured; it does **not** pretend a code was delivered. End-to-end inbox delivery requires your sender and a real recipient. Automated tests capture messages in memory without contacting Gmail.

Verification messages include a branded HTML design with a prominent, selectable code, exact expiration text and an embedded 512px SaleSync logo. A plain-text alternative is included. The logo travels as an inline CID PNG attachment, so it does not depend on localhost or an external image URL. The Sandbox captures the same template with a clear sample label. Run `npm.cmd run email:preview` to regenerate the vector-derived PNG and create sample HTML, MIME, and desktop/mobile previews under `.preview/`; this command sends no email.

If messages land in Spam, see [sender authentication findings and delivery instructions](docs/EMAIL-DELIVERY.md). Run `npm.cmd run email:dns` for read-only SPF/DMARC/DKIM checks. The previous school sender domain had no published SPF/DMARC records at the checked names. The local application now uses a dedicated Gmail sender, whose SMTP authentication was verified. Inbox placement cannot be guaranteed by application code.

The `VERIFICATION_*` environment values initialize a new database. Once initialized, use Maintenance Settings & Sandbox to change these policies; restarting never overwrites persisted settings.

## Open password-reset links on a phone

`127.0.0.1` and `localhost` refer to the device opening the email. A phone cannot reach the PC through either address. For local phone testing, connect the phone to the same trusted network as the PC, keep the Node server running, and configure `.env`:

```dotenv
HOST=0.0.0.0
APP_ORIGIN=http://YOUR_PC_LAN_IP:3000
API_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
```

Replace `YOUR_PC_LAN_IP` with the PC's active IPv4 address from `ipconfig` (the adapter with a default gateway). Restart SaleSync, open that address in the phone browser, then request a **new** reset email. Previously delivered emails retain their old address. The same 30-minute, single-use reset flow applies; no passwords or tokens belong in the configuration.

Local recovery emails explain the PC/same-network requirement. If the phone cannot open the homepage either, check that it uses Wi-Fi rather than mobile data and that the router permits devices to reach each other. If Windows Firewall blocks Node, allow the application's TCP port 3000 on the **Private** network profile; do not disable the firewall. The app does not change firewall rules. A changing DHCP address requires updating `APP_ORIGIN` and restarting. Access away from the local network requires a deployed HTTPS site; this configuration does not publish the project online.

## Individual administrators

For the complete localhost shopping/seller workflow, see [the step-by-step commerce guide](docs/COMMERCE.md). Development uses `PAYMENT_MODE=local-test` and 15-minute stock reservations by default; no PayMongo account or card details are needed. Existing Gmail configuration continues to send verification and password-reset emails. Order/store/support notifications are in-app.

Create each person’s account separately:

```powershell
npm.cmd run admin:create
```

The command asks for a full name, individual Gmail, role (`management` or `maintenance`), and a hidden password of at least 12 characters. The regular installation has **no shared default administrator accounts**, public role-assignment endpoints, or browser role upgrades. The separate local demo provisions generated sample accounts only in its own database. Administrators sign in through the same Sign in page.

| Role | Server-enforced access |
| --- | --- |
| Customer | Own account, cart/wishlist, addresses, orders, local test payments, returns and support; can apply to sell |
| Approved store owner | Customer capabilities plus own store, product catalog, inventory and shipments; no staff permissions |
| Management | Store approvals, catalog/inventory, order fulfillment, returns/test refunds, support, customer suspension, test reports, business audit, store settings and Sandbox |
| Maintenance | Database health, sanitized error events, technical audit, verification settings, maintenance settings and their Sandbox |

Maintenance cannot read customer lists, orders or business reports. Management cannot change email policy or technical maintenance configuration. Changing roles is deliberately unavailable through the API. Provisioning and significant administrator actions create audit entries.

## Settings & Sandbox

1. Open Settings & Sandbox using an individual admin account.
2. Edit only your permitted settings and **Save Sandbox draft**. The public site remains unchanged.
3. **Preview** the saved draft and change summary; **Validate** it or **Discard** it.
4. To apply, review the diff, give a reason and type **APPLY**. The backend rechecks permission, draft revision and live version, then writes configuration, history and audit together.
5. Use Change history to review rollback, give a reason and type **ROLLBACK**. Later overlapping changes, stale versions and unauthorized fields are rejected. Unrelated changes remain intact.

Drafts and sandbox test records have separate tables and are private to each administrator. Email tests use a Nodemailer **in-memory stream transport** and `example.test` recipient; they cannot connect to Gmail. Checkout tests create separate simulation records and never charge payments, change inventory, or create real orders. Applying configuration does not promote test records into production.

Store name/tagline, support email and shipping estimates are connected to the public UI/API. Verification settings govern future code issuance; maintenance mode shows the configured customer notice and blocks new order requests. Credential editing, POS, couriers and payment configuration are not represented as working controls.

## Connect another frontend

See [API integration and endpoint reference](docs/API.md) and [OpenAPI 3.0 definition](docs/openapi.json). The running definition is available at `/api/v1/openapi.json`. Use same-site cookie credentials and the session CSRF token; a reverse proxy can put another frontend and this backend behind one origin. `API_ALLOWED_ORIGINS` permits explicit additional **same-site** origins for local development. No wildcard CORS or public bearer tokens are enabled.

## Verification

```powershell
npm.cmd test
node tests/browser.cjs
node tests/commerce-browser.cjs
```

For the extended six-feature browser flow, use PowerShell:

```powershell
$env:SALESYNC_FEATURE_QA='1'
node tests/commerce-browser.cjs
Remove-Item Env:SALESYNC_FEATURE_QA
```

Browser tests need installed Chrome (default Windows path is supplied); set `CHROME_PATH` for another installation. The baseline suite uses port 3100 with payments disabled; the commerce suite uses port 3150 with local test payments. Both use isolated SQLite databases and captured mailers, never the normal `data/` database or real Gmail sends. Chrome needs permission to create browser subprocesses. Artifacts go to `.preview/`.

See [the current feature guide and verification report](docs/CUSTOMER-FEATURES.md) for results, setup, manual QA and remaining external integrations. Earlier reports are retained as implementation history.

## Recovery

The requested pre-edit Git check found **no Git repository**. A recoverable archive was created before editing: `checkpoints/before-fullstack-upgrade-2026-10-22.zip` (SHA-256 `CE571CED5E28E3F3FE9F08ADE7BBA8BCAA5D1C4FA567696BD7A1F5A26FD6DD26`). Extract it into a **separate** directory to compare or run the original prototype. Do not overwrite the current `data/` directory to restore the UI. No database reset or customer-record deletion command is part of the setup.

## Current limits

- Gmail verification delivery was confirmed by the user after local sender setup. The redesigned HTML email has been tested with captured MIME and browser previews; its appearance in a real Gmail inbox still needs a new resend check.
- **PayMongo is not connected.** Development defaults to `PAYMENT_MODE=local-test`: pending orders reserve stock, simulated payment success deducts it once, and manual shipment tracking/returns/test refunds are available. No real money moves. `PAYMENT_MODE=disabled` retains unreserved requests. Production rejects local simulation; a real provider and signed webhook integration are future work.
- Seller approval, password recovery, support, partial returns/test refunds, reviews, promotions and queued order notifications are implemented. AfterShip tracking requires credentials and a real account; local mode only simulates updates. POS synchronization, courier label/pickup booking and real-money refunds remain future work. Order email templates/queue are tested with captured mail; new real inbox delivery still needs manual QA.
- Other groups’ recommendations, approved business/legal policies, and verified seller photographs were not supplied. Existing product-photo limitations remain documented in the original `IMAGE_ASSET_NOTES.md`.
- This is a local application, not a hosted deployment. Internet deployment needs HTTPS, backups, the intended reverse proxy, and an infrastructure review. Keep `data/` persistent and restricted to the server account.
- This workspace is under XAMPP’s htdocs. A defensive `.htaccess` denies sensitive paths, but its Apache behavior was not verified. Use the Node server or verify equivalent Apache/proxy denial rules before exposing the folder.
