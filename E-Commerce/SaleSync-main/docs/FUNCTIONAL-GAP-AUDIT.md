# SaleSync functional and backend audit

Historical audit: the subsequent [commerce implementation](COMMERCE.md) fixes the listed checkout/homepage/concurrency issues and implements the core seller, stock, local payment, fulfillment and customer workflows. Remaining boundaries are listed in that current report.

Date: 22 October 2026. Scope: current local source, API routes, SQLite schema, frontend adapter and isolated execution checks.

## Assessment

SaleSync has a working backend foundation for customer authentication, email verification, individual staff permissions, basic catalog editing, saved unpaid orders and versioned configuration. It is not yet a complete operational e-commerce system: checkout stops before payment, and there is no backend seller workflow or fulfillment workflow.

The `?demo=1` pages deliberately bypass the live adapter. Their seller accounts, payments, stock movements, reviews and other interactions are simulations. A working control there is not evidence of a working backend endpoint.

SQLite and the current Node.js server are adequate for continued localhost development. The main work is implementing business workflows and connecting the existing UI; a framework or database rewrite is not required to address these gaps.

## What already works

| Area | Verified implementation |
| --- | --- |
| Customer authentication | Persistent accounts, password hashes, email verification, login/logout, expiring and revocable sessions. |
| Verification email | Branded HTML/plain-text message, inline logo, expiry, attempt limits, resend cooldowns and quotas, failed-delivery recovery. SMTP acceptance does not establish Inbox placement. |
| Authorization | Backend-enforced customer, Management and Maintenance roles. Admins are provisioned individually through a CLI. |
| Request protection | Session cookies, CSRF checks, allowed-origin checks, request limits and a static-file allowlist. |
| Public catalog | Published products are read from SQLite through the API. Browsing, search and comparisons use the downloaded catalog. |
| Basic administration | Management can edit existing product fields/stock, suspend customers and cancel unpaid order requests. Actions are audited. |
| Order requests | Delivery details and order snapshots persist; the server validates stock and calculates prices and shipping. No payment or reservation occurs. |
| Settings | Scoped drafts, previews, validation, conflict detection, explicit apply, history and field-scoped rollback. |
| Maintenance | Basic database health, uptime, sanitized errors, email configuration status and maintenance mode. |

## Missing or incomplete business functions

Priority: **P1** completes the core shopping workflow; **P2** completes normal customer/store operations; **P3** improves maintenance and growth. These are development priorities, not claims that the localhost demo must immediately be hosted.

| Priority | Function | Current limitation | Required backend behavior |
| --- | --- | --- | --- |
| P1 | Product creation and media | Only existing products can be edited. Supported fields are name, prices, stock, published flag and description. | Create/archive products, maintain SKU/category/specifications/variants, validate images and uploads, and update the public catalog. |
| P1 | Seller accounts and stores | The database allows only customer/management/maintenance roles. Store directory/profile content comes from prototype data. | Seller applications and approval, store records, membership/ownership checks and seller-scoped products/orders. Needed if SaleSync retains its multi-store model. |
| P1 | Payment processing | Every new order is `awaiting_gateway`; payment is explicitly unconfigured. | Payment checkout creation in provider test mode, verified webhook processing, amount/currency matching, durable event deduplication, and payment failure/expiry handling. |
| P1 | Inventory accounting | Order creation checks stock but does not reserve or decrement it. Staff overwrite one stock number. | Atomic reservations/expiry, committed stock movements, adjustment reasons, cancellation releases and conflict handling. The exact reservation point should be defined together with payment. |
| P1 | Order lifecycle | Management can only cancel an unpaid request. A transition to `processing` is rejected. | Explicit allowed transitions through payment and fulfillment, customer-visible history, and customer cancellation rules. |
| P1 | Delivery and tracking | Checkout captures an address and charges a flat amount per seller; no shipment records exist. | Per-seller shipments, dispatch/tracking data, delivery statuses and supported shipping rules. Manual tracking entry is sufficient before a courier API. |
| P2 | Customer account management | Live account UI displays name/email and orders. No recovery, profile update or address-book endpoints exist. | Password reset/change, safe profile updates, saved/default delivery addresses and appropriate re-verification for email changes. |
| P2 | Persistent shopping state | Cart, wishlist, saved products and comparison list share one browser-local storage key. | User-scoped persistent cart/wishlist, guest-to-account merge rules and deliberate account-switch behavior. Comparison can remain local if desired. |
| P2 | Returns and refunds | Prototype controls simulate them; live backend has neither workflow. | Return eligibility, request/review states, refund records and provider-confirmed outcomes. |
| P2 | Discounts | Live checkout has no voucher model or discount validation. | Voucher conditions, dates, usage limits, server-calculated discounts and redemption records, if promotions are required. |
| P2 | Reviews | Reviews and seller replies exist only in prototype state. | Delivered-purchase eligibility, duplicate prevention, persistent reviews, moderation and seller ownership checks. |
| P2 | Support and notifications | Live support shows contact information; verification is the only real outbound email workflow. | Persistent tickets/replies, order notifications, read status, queued delivery and retry handling. |
| P2 | Sales reports | Reports count requests; `paidRevenue` is literally `0` in the API. | Revenue derived from confirmed payments/refunds, date filters, seller/product summaries and exports. |
| P3 | Backups and recovery | No scheduled database backup or tested restore procedure. Configuration rollback restores settings fields only. | Consistent SQLite backups, retention and a restore drill in a separate environment. |
| P3 | Operations | Health checks only basic DB connectivity/configuration. Error events lack diagnostic context. | Safe route/error context, useful operational metrics, cleanup of expired records and email delivery diagnostics. |
| P3 | Larger datasets | Catalog/orders load full collections; customer list stops at 500; audit/history queries limit before filtering by role. | Database-side paging/filtering/search, role filtering before limits and indexes based on actual queries. |
| P3 | POS integration | Only prototype mapping/status controls exist. | Defined external contract, authenticated connector, sync/reconciliation and failure handling if POS remains in scope. |

Primary evidence: [API implementation](../backend/app.cjs), [schema](../backend/database.cjs), [settings permissions/workflows](../backend/settings.cjs), [live frontend](../SaleSync_Online_Alive_v5/assets/live.js), and [prototype](../SaleSync_Online_Alive_v5/SaleSync_Online_Alive.html).

## Confirmed defects and integrity gaps

### 1. Archiving the homepage hero product breaks rendering — P1

`home()` directly reads `heroProduct.photo` and `heroProduct.name` for hardcoded product IDs. The public catalog excludes archived products. After Management archives `p1`, a newly fetched catalog lacks that product and the initial homepage renderer throws `Cannot read properties of undefined (reading 'photo')`.

Reproduced by archiving `p1` through the isolated API and executing the actual original `home()` function in Node's VM with the resulting published catalog. This was a renderer execution check, not a fresh browser test. Existing-catalog rendering passed first. Use a published fallback product and handle an empty catalog; featured content should not depend on a permanently available seed ID.

Evidence: `SaleSync_Online_Alive.html:190`, `assets/live.js:27`, `backend/app.cjs:118`.

### 2. Numeric postal code produces a server error — P1

Posting an otherwise valid order with `delivery.postal: 1609` passes the regular-expression validation but later calls `.trim()` on the number. The response is HTTP **500 INTERNAL_ERROR**. The same request with `postal: "1609"` returns **201**. The HTML form normally submits text, but API consumers can trigger this.

Require string types before trimming, or explicitly normalize supported inputs. Invalid input should return a controlled validation response, with no order created.

Evidence: `backend/app.cjs:198` and `backend/app.cjs:208`.

### 3. Retried checkout creates duplicate requests — P1

Two identical authenticated order submissions both return **201** with different order IDs. There is no idempotency mechanism. The UI's busy flag reduces repeated clicks but cannot protect against network retries or another client.

Currently these are duplicate unpaid requests, not duplicate charges. Before connecting payment, persist an idempotency key with a request fingerprint and return the original result for a repeated submission.

Evidence: `backend/app.cjs:191`, `assets/live.js:113`.

### 4. Stock editing permits lost updates — P2, before concurrent selling

Two updates based on the same previously read stock value are both accepted. There is no product revision or adjustment operation. A later stale save can overwrite another staff member's adjustment. Audit records identify changed fields but do not provide an inventory movement ledger.

Add revision checks and transactional quantity adjustments, alongside the reservation workflow.

Evidence: `backend/app.cjs:229`.

### 5. Shopping state is shared between accounts on one browser — P2

Source review shows one localStorage key, `salesync-api-shopping-v1`, and logout clears the session/orders but not cart/wishlist/saved/comparison state. Shopping selections can carry across people sharing a browser, and do not follow a customer to another device. This does not expose another customer's API orders; order access is separately protected.

Define guest-cart merge and logout behavior and scope saved state to the signed-in customer.

Evidence: `assets/live.js:7`, `assets/live.js:9`, `assets/live.js:146`. Source-confirmed; no fresh two-account browser test was run for this audit.

## Sandbox and UI accuracy

- Settings draft/apply/rollback is real and has useful conflict protection. Keep this implementation.
- The checkout Sandbox returns a fixed **123.45** result. It remained 123.45 after saving a draft with shipping set to 999. It proves isolated record creation, not checkout pricing, payment, inventory or fulfillment correctness. It should eventually exercise the same business services with isolated records and provider test mode.
- Some retained homepage/store copy still advertises PayMongo checkout and full order tracking, while the live backend supports neither. Header/footer notices were updated, but the inherited homepage/store functions retain these claims. Align visible wording with current capabilities.
- The live frontend wraps and overrides functions in the large original inline script. Hardcoded seed IDs and parallel demo/live behaviors make new features fragile. Gradually extract catalog, account, cart and order modules while retaining the separate demo deliberately.
- The current cookie/CSRF API is usable by the supplied same-site frontend and documented allowed same-site origins. It is not a general bearer-token/mobile/third-party API. Extend authentication and origin policy only when an actual external client is in scope.

Evidence: `backend/app.cjs:266`, `assets/live.js:4`, `assets/live.js:166`, `SaleSync_Online_Alive.html:182` and `:190`.

## Database work required

There are 12 application tables: `users`, `challenges`, `sessions`, `rate_limits`, `products`, `orders`, `settings`, `drafts`, `sandbox_records`, `config_history`, `audit` and `system_events`. Products and order details are largely JSON snapshots. Existing persistence is real; the missing pieces are business entities and their workflows.

Introduce these as the related feature is built:

| Feature | Suggested records |
| --- | --- |
| Marketplace | Sellers/stores, applications and store memberships; product ownership and optional variants/media. |
| Checkout | Order items and status history, payment attempts and unique provider webhook events. Preserve immutable purchased-price snapshots. |
| Inventory | Stock movements and expiring reservations, linked to products/orders and actors. |
| Fulfillment | Shipments, shipment items and tracking/status history. |
| Customer account | Addresses, password-reset token hashes, cart items and wishlist items. |
| After-sale operations | Returns, refunds, review eligibility and support tickets/messages. |
| Notifications/promotions | Email jobs/attempts, notifications, vouchers and redemptions as required. |

Use explicit versioned migrations and transactional updates for changes that must succeed together. Separate catalog seed fixtures from parsing the original HTML. Keep existing account/order data during migration.

## Recommended implementation order

1. Fix homepage fallback and delivery validation; add order idempotency and product update conflict checks. Cover these specific failures with regression tests.
2. Complete catalog creation, images and product ownership. Add seller approval/store workflows if this remains a marketplace.
3. Build shared order/pricing/inventory services and explicit status transitions. Make the Sandbox exercise these services with isolated data.
4. Connect payment in provider test mode, with durable verified webhook handling and reservation/expiry rules. Verify successful, failed, expired and repeated events before enabling real payment.
5. Add fulfillment/tracking, customer account recovery/addresses and returns/refunds. Manual fulfillment administration is sufficient for the first working version.
6. Add persistent shopping state, notifications/support, reviews/promotions as required, real reports and backup/restore verification.

Completion criterion for the core system: a customer can register, buy a seller-owned product through a test payment, see a provider-confirmed paid order, have stock updated once, and follow shipment/delivery; staff can inspect the history and handle a cancellation/refund without inconsistent stock or money records.

## Verification and limits

- Fresh `npm.cmd test`: **26 passed, 0 failed**. These tests cover the existing implementation, not the missing workflows.
- Fresh `node .preview/audit-functions.cjs`: reproduced numeric-postal HTTP 500, duplicate unpaid orders, unchanged/unreserved stock, rejected fulfillment transition, missing product creation, unversioned stock updates, fixed Sandbox total and archived-hero render failure.
- The probe used a temporary isolated SQLite database, fake accounts and captured verification mail. **No real email was sent and the live database was not modified.** Temporary test data was removed after execution.
- Probe script and machine-readable results are under `.preview/`, which is ignored by Git. The script does not load `.env`.
- Earlier browser results are documented in `IMPLEMENTATION.md`; the browser suite was not rerun as part of this audit. No new load test, penetration test or hosted-service validation was performed.
- Changes made for this request are this report and local audit artifacts. Application behavior was not changed.
