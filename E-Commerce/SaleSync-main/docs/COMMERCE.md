# SaleSync local commerce implementation — 22 October 2026

This report records the earlier commerce phase. For the current courier, email, partial-refund, review, promotion and pagination additions, use [the 23 October feature guide](CUSTOMER-FEATURES.md), including its verification results and remaining limits.

The requested sequence is implemented in the existing Node.js/SQLite project and running at **http://127.0.0.1:3000/**. Refresh an already-open tab to load the new frontend. The earlier navy/blue/cyan presentation, individual staff accounts, Gmail verification and configuration Sandbox remain in place.

**Payments use a clearly labeled local simulator, as requested because no PayMongo account is available.** No provider requests, card collection or real-money charges/refunds occur. Simulator outcomes update real local order, reservation, shipment and payment records so the complete workflow can be tested.

## Try the working flow

### Quick purchase using the existing catalog

1. Sign in with a verified customer account, add an available product to the cart and continue to checkout.
2. Enter delivery details or select a saved address. Choose **Create test order**.
3. The server saves the order and temporarily reserves stock. Choose **Simulate successful payment**. Failure, expiry and cancellation are also available as explicit test outcomes.
4. Open **My account → Orders & tracking**. Refreshing a payment URL resumes the same saved order.
5. Sign in as Management and open **Orders**. Advance each seller shipment through Processing, Packed, Shipped, Out for delivery and Delivered. Enter courier/tracking text before dispatch.
6. The customer sees shipment status, tracking and order history. After delivery they can request a return. Management reviews it under **Returns**, marks the goods received, then records a full **test refund** under Orders. Restocking is an explicit choice.

The seeded TechHub PH and StyleHub stores are approved and initially managed by SaleSync; they do not require a new seller account before the existing products can be tested.

### Create an actual seller-owned store and product

1. A verified customer opens **My account → Apply to sell**, enters a unique store name, tagline and description, and submits the application.
2. Management opens **Sellers & stores** and approves or rejects the application, with a review reason.
3. After approval, the customer signs in again and opens **My account → Your seller store → Open seller workspace**.
4. Choose **Create product**. Enter SKU, category, prices, physical stock, description/specifications and optionally upload a PNG/JPEG/WebP image. Publish the listing.
5. Sellers can edit only their own approved store’s products, inspect stock history, update their store profile and fulfill their own shipments. They retain the customer role and gain no staff permissions.

Management can also create/edit products in approved stores through **Catalog & inventory**. Archiving uses the existing Published checkbox; referenced products/orders are not physically deleted.

### Customer features

- **Profile & security:** update name/mobile; change password by confirming the current password. A password change revokes all sessions.
- **Forgot your password?:** email a single-use 30-minute reset link through the configured Gmail sender. The API never returns the reset token. Password-reset completion revokes existing sessions and other reset links.
- **Saved addresses:** add/edit/remove personal addresses and select a default for checkout.
- **Wishlist & saved:** account shopping data persists in SQLite across sign-ins/devices. Guest shopping remains local. Signing out or changing accounts does not expose the previous customer’s wishlist/cart.
- **Notifications:** persisted order, seller-review and support updates, with mark-read behavior.
- **Help requests:** private support conversations; Management can reply and close/reopen them. Maintenance cannot read them.

If staff accounts have not been provisioned, run `npm.cmd run admin:create` and create an individual Management account. There are no shared/default passwords or public staff-role assignment endpoints.

## Bugs corrected

| Finding | Implemented correction |
| --- | --- |
| Archived featured product could crash the homepage | Published-product fallback, with a branded fallback for an empty catalog. |
| Numeric postal code caused HTTP 500 | Strict address field typing; malformed input returns controlled HTTP 422. |
| Retried checkout created duplicate orders | Required Idempotency-Key, saved request fingerprint, unique user/key constraint and replay of the original order. Changed payload/key reuse returns 409. |
| Stock edits overwrote concurrent changes | Required product revision, transactional updates and adjustment reasons/movement records. |
| Shopping data leaked between accounts in one browser | User-scoped local caches and authenticated persistent shopping with owner/revision checks; logout clears customer delivery/order state. |
| Sandbox checkout always returned 123.45 | Shared quote service validates real catalog/stock and draft shipping; no charge, reservation or order side effects. |

## Backend behavior

- Prices and shipping are calculated on the server in integer PHP cent amounts. Purchased prices are snapshotted, so later catalog edits do not alter an existing order.
- Available stock is **physical stock on hand minus active reservations**. Catalog responses expose `onHand`, `reserved` and `primary` (available). Product edit input `primary` means physical stock on hand.
- Reservation, sale, release, opening, adjustment and restock events are recorded in an inventory ledger. A stock edit cannot reduce physical stock below active reservations.
- Order creation, reservation, payment settlement, cancellation, refunds and shipment updates use SQLite transactions. Repeated successful payment outcomes cannot deduct stock twice; repeated refunds cannot restock twice.
- A default 15-minute reservation expires on API activity or the background cleanup interval. Expired orders cannot be paid through the simulator. Failure/cancellation releases reservations without decrementing physical stock.
- Payment amount/currency must match the saved order. Test outcomes are restricted to the owning customer and a local-test payment. Staff cannot manually set an arbitrary order to paid.
- Shipments advance sequentially. A multi-store order follows its least advanced shipment. Courier/tracking entry is manual; no courier is contacted.
- Returns are currently full-order and available after delivery. Dispatched goods must be marked received before a test refund. Management explicitly decides whether stock is saleable and should be restored.
- Test reports derive receipts/refunds from persisted payment records. Net test receipts include shipping; they are not profit. `liveRevenue` remains zero.
- Password-reset tokens are hashed, expire, are single-use and are invalidated by password changes or suspension. Recovery responses do not reveal whether an account exists. Codes, passwords and SMTP secrets are not logged or returned.
- Product images are limited to decoded 750 KB PNG/JPEG/WebP. SVG is rejected. Generated filenames are served through an explicit image route; image files live in `data/uploads/` alongside the configured database rather than among source assets.
- Store/product ownership, customer addresses, shopping, support and order access are enforced on the backend. Maintenance retains technical access only. Seller/customer business activity is included in the Management audit scope.

## Configuration and API integration

Development defaults:

```dotenv
PAYMENT_MODE=local-test
RESERVATION_TTL_SECONDS=900
```

`PAYMENT_MODE=disabled` preserves unreserved unpaid-request behavior. Production defaults to disabled and rejects local-test configuration. Existing `.env` Gmail credentials and persisted email/store settings were retained; no new payment credentials are required.

The existing same-site cookie/CSRF API is documented in [API.md](API.md) and [OpenAPI 1.1.0](openapi.json). Download the running definition at `/api/v1/openapi.json`. New clients must send `Idempotency-Key` for checkout and the latest revision for editable records. This is not a bearer-token/mobile authentication API.

## Migration and preservation

Schema version **3** adds stores, product/order metadata, order items, reservations, inventory movements, payment attempts/events, shipments, order history, profiles, addresses, password resets, shopping, notifications, returns and support records. Existing user roles/password hashes, original order/product JSON and store settings are preserved. Catalog fixtures now come from `backend/seed-products.json`, rather than parsing the prototype HTML during startup. Databases newer than this application are rejected before schema changes.

The migration was first tested on a copy of the pre-change database: all **12 original tables** retained identical row fingerprints. A fresh consistent SQLite backup was taken immediately before restarting the real localhost server. After restart, the live `users`, `orders`, `products` and `settings` tables still matched their pre-restart fingerprints. The live API returned HTTP 200 with `mode:local-test`, `realMoney:false`, schema 3 and API definition 1.1.0.

Historical `awaiting_gateway` requests remain unpaid and unreserved. Migration does not retroactively charge them or reserve inventory. Cancel/recreate a request to exercise the new test checkout.

## Verification

| Check | Result |
| --- | --- |
| `npm.cmd test` | **45/45 passed**, including recovery-message HTML/plain-text/MIME composition and local-device access notes without SMTP. |
| `node tests/browser.cjs` | **78/78 passed**, 0 JavaScript errors, with payment disabled to preserve regression coverage for the previous workflow. |
| `node tests/commerce-browser.cjs` | **49/49 passed** through the PC's LAN address, 0 JavaScript errors, covering seller approval/product image upload, reservation, payment, fulfillment, return/refund, support, private shopping, profile/address updates and password recovery at phone width, including refresh. |
| Standalone online/offline HTML opened directly from disk | **58/58 passed**, 0 JavaScript errors. Existing demo roles and simulated workflows remain separate. |
| Responsive connected screens | Seller administration/workspace, checkout and customer tracking fit 320, 390, 768, 1024 and 1440 px in the commerce suite; the baseline suite covers the other storefront/staff layouts. |
| Migration on a database copy | 12 original tables unchanged. |
| Live restart | Health/catalog/OpenAPI available; original core records unchanged. |

Automated tests use isolated databases/accounts and capture email in memory. They do not use live sender credentials, send real mail, contact a payment provider or add QA products/orders to the live database. Browser images are written into each isolated database directory. Screenshots and result JSON are under `.preview/`, including `commerce-browser-results.json`, `commerce-migration-results.json` and `commerce-live-results.json`.

### Mobile password-reset access — 22 October 2026

The reported inaccessible reset link was opened on a phone while `APP_ORIGIN` pointed to `127.0.0.1`. That address refers to the phone itself. Local configuration now listens on `0.0.0.0`, uses `http://192.168.100.207:3000` for new reset links, and explicitly allows the existing `127.0.0.1` and `localhost` PC origins. Gmail credentials and password-reset security rules are unchanged. Previously delivered emails keep the old URL; request a new link. The phone must share the PC's network and the server must remain running. See [phone setup and troubleshooting](../README.md#open-password-reset-links-on-a-phone).

The LAN browser run exposed checkout's use of secure-context-only `crypto.randomUUID()`. It now falls back to a UUID built from `crypto.getRandomValues()` on local HTTP LAN addresses, retaining cryptographic randomness and request deduplication. Local recovery messages include device/network instructions; hosted messages do not.

The LAN commerce suite was run with `SALESYNC_QA_HOST=0.0.0.0` and `SALESYNC_QA_ORIGIN=http://192.168.100.207:3150`. At 390 px, it followed the captured email link, refreshed the reset page, submitted a new password and signed in. The live LAN/loopback/localhost homepages and session endpoints returned HTTP 200; an unapproved Origin returned 403 and private paths remained 404. These checks ran on the PC; connectivity from the physical phone and a new real Gmail message still require user QA. No firewall rules were changed and no internet hosting was added.

## Recovery checkpoints

- Source archive: `checkpoints/before-commerce-20261022-165903.zip`.
- SHA-256: `036EDCD36954B59660AD58C21BCAC6D98B6D60E9E5266FE29FA5F23E74C7E3A5`.
- Initial consistent database snapshot: `checkpoints/before-commerce-2026-10-22T08-59-05-280Z.sqlite`.
- Fresh snapshot immediately before restart: `checkpoints/before-commerce-start-2026-10-22T14-42-37-368Z.sqlite`.
- Before mobile reset source changes: `checkpoints/before-mobile-reset-20261022-232337.zip` (SHA-256 `58EC36156D02506CA447C631D7A993D2BECF56C26BBF553F5965020CF66946D8`); original API adapter: `checkpoints/before-mobile-reset-live.js`.
- Before the mobile-access restart: `checkpoints/before-mobile-reset-start-2026-10-22T15-25-34-284Z.sqlite`; original non-secret network settings: `checkpoints/before-mobile-reset-network-settings.json`.

Source archives exclude credentials, runtime data and dependencies. Database snapshots contain private account/order data and remain excluded from Git and HTTP serving. For recovery, stop the server and restore into a separate directory first; do not overwrite newer customer records merely to reverse a UI change.

## Remaining boundaries

Real PayMongo payments, provider webhooks and real-money refunds are not connected. External courier APIs/POS synchronization, partial returns/refunds, promotions, persisted reviews, automated order-status emails, scheduled backups, advanced reporting exports and large-dataset pagination remain future work. Customer order/store/support notifications are currently in-app; only verification and password recovery use the configured mailer.

No hosted deployment, load/penetration test or full accessibility audit was performed. Inbox placement of a newly sent recovery email was not tested with real Gmail. Business/legal policies, production catalog photographs and operational return terms still require store approval. The current result is a working localhost commerce system with explicit test payments.
