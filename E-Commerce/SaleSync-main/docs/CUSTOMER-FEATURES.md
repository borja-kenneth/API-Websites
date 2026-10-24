# Customer commerce features — 23 October 2026

The six requested additions are implemented in the existing Node.js/SQLite application. No framework migration or dependency upgrade was needed. The API contract is version **1.2.0**, served at `/api/v1/openapi.json`. Existing authentication, individual staff roles, Gmail settings, saved data and the separate `?demo=1` prototype remain in place.

## What is available

| Feature | Customer/staff workflow | External connection |
| --- | --- | --- |
| Courier tracking | Dispatch a shipment, then use **Enable local auto tracking** in Seller or Management orders. The worker advances a local shipment from shipped to out for delivery to delivered. Customers see persisted tracking events. | AfterShip registration, polling and signed webhook adapter prepared and tested with mock responses. No account/key is configured. This integrates tracking; it does not book pickups, purchase labels or contact a real courier in local-test mode. |
| Order emails | Order creation, individual shipment dispatch and individual shipment delivery queue branded HTML/plain-text emails. Management has **Order emails** with delivery states and explicit retry for failed messages. | Uses the existing Gmail sender. Tests capture MIME/messages; new real inbox delivery and appearance still require manual QA. |
| Partial returns/refunds | Customers select item quantities, including a full order. Management approves/rejects and receives the return, then refunds its selected quantities. Explicit restock and shipping choices are separate. | Refunds remain **local test records**. No real money moves without a future payment-provider integration. |
| Ratings/reviews | Delivered purchases with unrefunded units can leave one versioned review per customer/product. Public product details show verified reviews and aggregate ratings. Management can hide/restore with a reason. | Stored in SQLite; no external service. |
| Promotions/vouchers | Management creates percent/fixed promotions with dates, minimum subtotal, optional discount cap, usage limits and automatic/code-based application. Customers preview the quote at checkout. | Computed on the server; no payment-provider discount dependency. |
| Pagination | Public product browsing, customer orders, Management/seller catalog and orders, returns, promotions, reviews and email queue expose bounded pages. Public catalog page URLs support refresh and Back/Forward. | JSON endpoints include pagination metadata. Catalog bootstrap is bounded, and saved products outside it are loaded by ID. |

## Courier setup

Development defaults to:

```dotenv
COURIER_MODE=local-test
COURIER_TEST_STEP_SECONDS=60
```

The worker runs approximately every 15 seconds while the Node process is running. Once a **shipped** shipment is explicitly connected, local tracking advances at the configured step interval. **Advance local tracking** provides the same flow immediately for QA. Ordinary manual shipment actions still work without enabling tracking.

For a future AfterShip account, configure these **only in the backend `.env`**, then restart:

```dotenv
COURIER_MODE=aftership
AFTERSHIP_API_KEY=
AFTERSHIP_WEBHOOK_SECRET=
```

Enter a supported courier slug when connecting an already-dispatched tracking reference. The adapter uses the official `https://api.aftership.com/tracking/2026-07/trackings` endpoint and `as-api-key` authentication. No recipient address/email is sent to the tracking registration API. Polling can work from localhost with credentials; incoming webhooks need an externally reachable HTTPS deployment. Configure the callback as `https://YOUR_HOST/api/v1/webhooks/aftership`. These requirements follow [AfterShip’s API guide](https://www.aftership.com/docs/tracking/quickstart/api-quick-start).

Webhook handling verifies Base64 HMAC-SHA256 against the **exact raw body** using `aftership-hmac-sha256`, as specified in [AfterShip’s signature documentation](https://www.aftership.com/docs/tracking/webhook/webhook-signature). Event IDs are persisted for deduplication; old/regressive events cannot move a shipment backwards. Tracking IDs and tracking references must match the registered shipment. Signed events can advance through missing delivery checkpoints, while maintaining the existing legal shipment stages. Delivery exceptions appear in tracking without falsely marking delivery complete.

`COURIER_MODE=manual` disables registration/automatic tracking. Production rejects `local-test`. Provider failures retain existing shipment state and record a sanitized error for retry. A real account/plan and its courier-specific requirements have **not** been validated in this project.

## Email behavior

Order and shipment changes queue events **inside the same SQLite transaction** as the business update. SMTP runs after commit in a background worker. Delivery failure cannot roll back a successful order or shipment, and checkout retries cannot enqueue the same event twice. Existing historical orders are not emailed retroactively during migration.

Queue states are pending, sending, sent and failed. Failures retry with backoff, up to five attempts; Management can requeue a terminal failure. A lease recovers interrupted sends, and a stable Message-ID identifies each event. SMTP acceptance followed by a process crash can still cause a repeat delivery on retry; email delivery cannot be guaranteed exactly once. Inbox placement remains controlled by the recipient provider.

The previously provisioned four local QA role accounts have synthetic Gmail identifiers, not owned inboxes. Their `LOCAL_QA_ACCOUNT_CREATED` audit marker suppresses order emails. Use your own verified customer account to test actual delivery. Verification and password-reset mail continue to use their existing flows.

## Pricing and refunds

- One promotion applies to an order. An entered code selects that voucher; with no code, the best eligible automatic promotion wins. Discounts apply to merchandise, not shipping, and are allocated across lines in integer cents.
- A quote is advisory. Checkout rechecks stock, promotion eligibility and usage limits transactionally. Pending local-test orders hold a promotion use; payment commits it, while cancellation/expiry releases it. Refunds do not restore a consumed voucher use. Disabled-payment requests do not hold uses.
- Original net paid line amounts are saved with the order. Later price or promotion edits cannot change a refund. Cumulative per-unit rounding prevents repeated partial refunds from exceeding the paid line total.
- Active/received/refunded returns reserve their item quantities against overlapping requests. Rejected cases release them. Customers can make another partial return for the remaining units after delivery.
- Dispatched goods require a received return case. Refund the quantities of that received case together. Explicit `restock` restores only those quantities once, with inventory history. Refunding before dispatch does not require a physical return.
- Shipping can be refunded only with or after the final item quantities. The API supports a later shipping-only refund with `items:[]` and `refundShipping:true`. The order becomes fully refunded only when cumulative refunds equal its original payment; earlier partial refunds retain fulfillment status and expose `refunded`/`refundable` totals.
- Partial refunds require an `Idempotency-Key` and current order revision. An identical keyed retry does not create a second refund or restock. A changed request/key conflict, stale revision, excess quantity or excess payment amount is rejected.
- Zero-total checkout is not implemented. If a promotion reduces an order with zero shipping to zero, the API rejects it rather than fabricating a paid order.

## API integration

Use the existing same-site cookie/CSRF flow. There is no public role assignment, wildcard CORS, mobile bearer-token issuer or secret in frontend assets. The authenticated tracking/admin APIs retain the corresponding seller ownership or Management checks. Only the exact signed AfterShip webhook route is exempt from browser Origin/CSRF checks.

- [API guide](API.md)
- [OpenAPI definition](openapi.json)
- [Postman collection](SaleSync.postman_collection.json): set origin and credentials locally; requests are intended to be run individually.
- [Browser API client example](../examples/api-client.mjs): retains CSRF and sends cookie credentials. It is a browser client, not a Node cookie-jar implementation.

Paged lists accept `page=1&limit=20`, with a maximum limit of 100. Responses retain their resource array (`products`, `orders`, `reviews`, etc.) and add `{page,limit,total,pages}`. Filters run before SQL count/limit/offset. Ordering includes a stable tie breaker; concurrent inserts can still shift numbered pages. The old unpaged `/catalog` response remains for compatibility; the website uses `/catalog?limit=20`, `/products` and `/products/lookup`.

## Recovery and verification

Before edits: `checkpoints/before-customer-features-20261023-001312.zip` and a consistent database snapshot `checkpoints/before-customer-features.sqlite`. Source archives exclude `.env`, databases and dependencies. Restore into a separate directory first; never overwrite newer customer records just to undo a UI change.

Schema 4 adds feature tables and copies historical return records into item-aware return cases. A migration on a copy of the current database preserved identical fingerprints for all **30 original tables**. The old return table is retained. No existing accounts, roles or Gmail credentials are replaced.

Automated verification uses isolated SQLite files, captured email and mock provider responses. It does not add test products/orders to the normal database or send test messages through Gmail. Browser checks cover promotion creation, larger catalog pagination and history, voucher checkout, connected seller tracking, reviews/moderation, two partial returns/refunds, email queue states, account isolation and password recovery. Test results are under `.preview/`.

Final verification results:

| Check | Result |
| --- | --- |
| `npm.cmd test` | **58/58 passed**: original backend/email checks plus promotion limits, partial refunds, concurrency, review ownership/moderation, pagination/lookup, courier signatures, outbox retry and OpenAPI contract checks. |
| `node tests/browser.cjs` | **78/78 passed**, no JavaScript errors. Existing registration, browsing, cart, disabled-payment checkout, staff and Sandbox flows preserved. |
| `$env:SALESYNC_FEATURE_QA='1'; node tests/commerce-browser.cjs` | **65/65 passed**, no JavaScript errors. Final run used the LAN origin, 38 products, promotion form/quote, local tracking, reviews, two partial returns/refunds, email queue and saved-item restoration outside the first bootstrap page. |
| Both standalone HTML demos | **58/58 passed**, no JavaScript errors. |
| Migration on database copy | All **30 original tables** retained identical row fingerprints. |
| Live startup | Schema **4**, API **1.2.0**, **93 documented operations**; homepage, new JS asset, health, product page, product lookup and OpenAPI returned HTTP 200. |
| Live preservation | Existing `users`, `orders`, `products`, `settings` and `stores` matched pre-start fingerprints. No QA products/orders were added to the live database. |
| Private static paths | `.env`, backend source and checkpoints remained HTTP 404. PC loopback and localhost session requests remained available. |

Live site at verification: **http://192.168.100.207:3000/**. API base: **http://192.168.100.207:3000/api/v1**. It remains a local network application; keep the PC server running and use the same network on a phone. No real AfterShip credentials, courier booking, real-money refunds or new real-Gmail order-email delivery were exercised by these tests.

Artifacts: `.preview/customer-feature-migration-results.json`, `.preview/customer-features-live-results.json`, `.preview/features-browser-results.json`, `.preview/connected-browser-results.json` and `.preview/file-demo-results.json`. A fresh consistent snapshot was taken before startup: `checkpoints/before-customer-features-start-2026-10-23T06-26-25-875Z.sqlite`. Source checkpoint SHA-256: `76A008380929937CEFD2E2BE8056170EBDB6A58DC22CC694A772B9D90D2B4A12`.

## Manual QA checklist

- [ ] Management: create a voucher, edit with the current revision, disable it, and check invalid/expired/usage-limited codes.
- [ ] Customer: preview totals, create an order and verify the saved total matches the displayed promotion.
- [ ] Seller/Management: dispatch, enable local tracking, check automatic updates and repeat a refresh without duplicate delivery events.
- [ ] Customer: confirm only your own order exposes its tracking and return options.
- [ ] Customer: review a delivered purchase, edit it, and confirm an account without a delivered purchase is refused.
- [ ] Management: hide/restore a review and verify public counts change.
- [ ] Customer: return one unit from a multi-unit order, then return the remaining units in a second case.
- [ ] Management: approve/receive each case; check partial refund amounts, final shipping choice, stock ledger and test reports.
- [ ] Management: check order email states and retry a failed message. Use an owned customer email for real Gmail appearance/delivery checks.
- [ ] Browse beyond page one, filter/search, refresh and use Back/Forward. Confirm saved products outside the first page survive sign-out/sign-in and refresh.
- [ ] Confirm Customer/Seller/Management/Maintenance access remains separated.
- [ ] Check desktop, tablet and phone layouts; keep the PC server running for LAN testing.
