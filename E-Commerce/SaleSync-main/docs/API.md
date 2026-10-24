# SaleSync API integration

Base URL: `http://127.0.0.1:3000/api/v1`. JSON request/response format. The backend also accepts `/api` as an alias. Download `/api/v1/openapi.json` for the machine-readable contract. Private files, environment configuration, databases and checkpoints are never exposed by the static server.

Current contract: **1.2.0**. New courier, email, partial-return/refund, review, promotion and pagination behavior is detailed in [CUSTOMER-FEATURES.md](CUSTOMER-FEATURES.md). An importable [Postman collection](SaleSync.postman_collection.json) and [browser client example](../examples/api-client.mjs) are supplied; fill credentials locally.

## Authentication and browser connection

Use a same-site frontend or reverse proxy. Browser requests use `credentials: 'include'`. Cookies are HttpOnly and SameSite=Lax; production also requires Secure and HTTPS. JavaScript must not store a session token in localStorage. For another same-site frontend origin, explicitly list its origin in `API_ALLOWED_ORIGINS`. Browser mutations require an approved `Origin` and `Content-Type: application/json`; authenticated mutations outside `/auth/` also require `X-CSRF-Token` from `/auth/session`. Cross-site browser mutations are rejected even if the origin was listed. There is no API for assigning roles. The exact `/webhooks/aftership` POST route uses a verified raw-body HMAC instead of browser authentication.

```js
const BASE = '/api/v1';
let csrfToken;
async function request(path, method = 'GET', body, extraHeaders = {}) {
  const response = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error.message), result.error);
  if (result.csrfToken) csrfToken = result.csrfToken;
  return result;
}

await request('/auth/session');
await request('/auth/register', 'POST', {
  name: 'Your name', email: 'youraddress@gmail.com', password: 'your strong password',
});
// Prompt the customer for the emailed code. Never hardcode or request a code from the API.
// await request('/auth/verify', 'POST', { code: codeEnteredByCustomer });
```

For non-browser integration tests, send `Origin: http://127.0.0.1:3000`, maintain the cookie jar and send the returned CSRF token. A third-party/mobile bearer-token flow is not implemented.

## Endpoint map

All paths below are relative to `/api/v1`.

| Method | Path | Access / behavior |
| --- | --- | --- |
| GET | `/health` | Public API health |
| GET | `/openapi.json` | Public API definition |
| GET | `/catalog` | Published products, public settings, integration status |
| GET | `/auth/session` | Account, permissions and CSRF token, or anonymous state |
| POST | `/auth/register` | `{name,email,password}`; Gmail only; creates pending account and sends code |
| GET | `/auth/pending` | Saved name/email, delivery state, expiration, resend time and attempts remaining; pending cookie required |
| POST | `/auth/resend` | `{}`; invalidates previous code, enforces cooldown/quotas |
| POST | `/auth/verify` | `{code:"1234"}`; consumes code and activates account |
| POST | `/auth/login` | `{email,password}`; individual account login |
| POST | `/auth/logout` | `{}`; revoke session and clear cookies |
| GET | `/orders` | Customer’s own orders or Management order list; Maintenance denied |
| POST | `/orders` | Verified customer; `{items:[{id,qty}],delivery:{name,phone,address,barangay,city,province,postal}}` |
| GET | `/admin/catalog` | Management; includes archived listings |
| PATCH | `/admin/catalog/:id` | Management; product edits require latest `revision`; stock changes also require `reason` |
| GET | `/admin/customers` | Management; safe customer fields only |
| PATCH | `/admin/customers/:id` | Management; `{status:"active"|"suspended"}` for verified customers; sessions revoked |
| PATCH | `/admin/orders/:id` | Management; `{revision,status}`; cancel unpaid orders or advance a single-store shipment |
| GET | `/admin/reports` | Management; saved-order counts and payment availability |
| GET | `/admin/health` | Maintenance; DB check, uptime, mail-setup state and sanitized events |
| GET | `/admin/audit` | Administrators; role-scoped audit events |
| GET | `/admin/settings` | Role-permitted live settings, global version, own draft and history |
| POST | `/admin/sandbox/draft` | `{revision:0,settings:{store:{...}}}` or permitted technical sections; revision must match on update |
| DELETE | `/admin/sandbox/draft` | `{revision}`; discard own draft |
| GET | `/admin/sandbox/preview` | Own draft preview, field-level diff, own separate test records |
| POST | `/admin/sandbox/validate` | `{}`; validate saved draft and detect a stale live base |
| POST | `/admin/sandbox/test` | Management: shared checkout quote validation against draft settings; Maintenance: captured email |
| POST | `/admin/sandbox/apply` | `{revision,confirm:"APPLY",reason}`; version checked, explicit authorized apply |
| POST | `/admin/settings/history/:id/rollback` | `{version,confirm:"ROLLBACK",reason}`; scoped, conflict-safe rollback |

Server-calculated totals/status cannot be supplied to order creation. Prices are PHP amounts with at most two decimal places. Every new checkout requires an **`Idempotency-Key`** header (16–100 letters, digits, hyphens or underscores). Reuse the same key only when retrying identical order details; the API returns the original order instead of creating another. A changed payload with the same key returns 409.

In development, `PAYMENT_MODE=local-test` creates a `pending_payment` order, a temporary stock reservation and a local test-payment record. `/catalog` identifies this simulator and reports `realMoney:false`. `PAYMENT_MODE=disabled` retains the unreserved `awaiting_gateway` behavior. Existing historical requests are preserved. No PayMongo connection or real-money payment is implemented.

## Commerce and account endpoints

The complete request schemas and required fields are in [OpenAPI](openapi.json). All paths below use the same session/CSRF/origin rules.

| Methods | Paths | Behavior |
| --- | --- | --- |
| POST | `/seller/application` | Verified customer applies to sell; one store per account |
| GET, PATCH | `/seller/store` | Own application/profile; profile changes require approval and revision |
| GET | `/admin/sellers` | Management reviews seller applications and owner contacts |
| PATCH | `/admin/sellers/:id` | Management approval/rejection/suspension, with revision and reason |
| GET, POST | `/admin/catalog`, `/seller/catalog` | Read/create products; seller catalog is restricted to their approved store |
| PATCH | `/seller/catalog/:id` | Edit an owned listing with revision; archive using `published:false` |
| POST | `/admin/media`, `/seller/media` | Base64 PNG/JPEG/WebP upload, maximum decoded 750 KB; returns public image URL |
| GET | `/admin/inventory/:id`, `/seller/inventory/:id` | Stock on hand, reserved and available quantities, plus movements |
| POST | `/admin/inventory/:id/adjustments`, `/seller/inventory/:id/adjustments` | `{revision,delta,reason}`; atomic stock change |
| GET | `/orders/:id` | Read an owned order with payment, shipment history and return status |
| POST | `/orders/:id/cancel` | `{revision}`; customer cancels an unpaid order and releases its reservation |
| POST | `/payments/:id/simulate` | Owner chooses `success`, `failed`, `expired` or `cancelled`; development local-test only |
| GET | `/seller/orders` | Only the seller’s order lines, delivery address and shipments |
| PATCH | `/admin/shipments/:id`, `/seller/shipments/:id` | `{revision,status,courier?,tracking?}`; sequential fulfillment |
| POST | `/orders/:id/returns` | Customer requests a return after delivery, with reason |
| GET, PATCH | `/admin/returns`, `/admin/returns/:id` | Management approves/rejects, then marks returned goods received |
| POST | `/admin/orders/:id/refund` | `{revision,reason,restock,items?,returnId?,refundShipping?}`; full/partial test refund. Partial requests require an `Idempotency-Key`. |
| GET, PATCH | `/account` | Read/update name and mobile; email/roles are not editable here |
| POST | `/account/password` | Current-password reauthentication; updates password and revokes all sessions |
| POST | `/auth/forgot-password`, `/auth/reset-password` | Emailed single-use 30-minute reset link; no token returned in API responses |
| GET, POST | `/account/addresses` | Read/create saved delivery addresses |
| PATCH, DELETE | `/account/addresses/:id` | Update/delete an owned address with revision |
| GET, PUT | `/account/shopping` | Account cart, wishlist, saved products and comparison; owner/revision checked |
| GET, PATCH | `/account/notifications` | Read customer notifications; `{read:true}` marks them read |
| GET, POST | `/account/support` | Read/create private support conversations |
| GET | `/admin/support` | Management support inbox; Maintenance denied |
| POST | `/account/support/:id`, `/admin/support/:id` | Authorized reply with `{revision,message,status}` |

Seller capability is linked to an approved customer-owned store. It does **not** assign a new user role or grant staff permissions. Management can operate seeded stores, which initially have no customer owner.

Stock responses expose `onHand`, `reserved` and `primary` (available). Product edit payload `primary` means **physical stock on hand**, so use `onHand` to populate a stock editor. Reservations reduce available stock, not physical stock. A successful test payment deducts physical stock and consumes its reservation exactly once. Failure, cancellation or expiry releases held stock. Stock edits require the latest product revision and cannot reduce stock below reservations.

Shipment stages are `paid → processing → packed → shipped → out_for_delivery → delivered`. Dispatch requires courier and tracking text. Multi-store orders follow their least advanced shipment. Browser return URLs cannot mark an order paid. Only the local test endpoint can settle a local-test payment, using its saved amount. Repeated identical outcomes are idempotent.

Dispatched items must have a selected return marked `received` before a test refund. Returns and refunds support selected product quantities. Refund all quantities of a received case together; another case may cover remaining units. `restock` is explicit; idempotent retries cannot restock twice. Refund amounts use the saved net prices after discounts. Shipping can be refunded with or after the final item quantities. Reports show simulated receipts after refunds (including shipping), separate from `liveRevenue`, which remains zero. See the full rules in [CUSTOMER-FEATURES.md](CUSTOMER-FEATURES.md#pricing-and-refunds).

Example after customer sign-in/verification:

```js
const checkoutKey = Array.from(crypto.getRandomValues(new Uint8Array(20)), n => n.toString(16).padStart(2,'0')).join(''); // retain for retries of this same checkout, including HTTP LAN testing
const { order } = await request('/orders', 'POST', {
  items: [{ id: productId, qty: 1 }],
  delivery: deliveryFormValues, // phone and postal must be strings
}, { 'Idempotency-Key': checkoutKey });
// LOCAL TEST ONLY: no provider request or real charge occurs.
await request(`/payments/${order.payment.id}/simulate`, 'POST', { outcome: 'success' });
```

For `/account/shopping`, GET the current revision before PUT and include `ownerId` equal to the current session customer ID. A 409 requires refreshing/reviewing the newer state rather than silently overwriting it. Guest shopping stays browser-local; account shopping persists in SQLite. No authentication secrets are stored with shopping data.

## Settings payloads

Management can change `store`: `name`, `tagline`, `supportEmail`, `shippingPerSeller`. Maintenance can change `email`: `ttlSeconds` (60–900), `maxAttempts` (1–5), `resendSeconds` (60–600), `maxSendsPerHour` (1–5); and `maintenance`: `enabled`, `message`. Unknown fields and other-role sections are rejected. Environment credentials are never settings fields.

```json
{
  "revision": 0,
  "settings": {
    "store": { "tagline": "Find your next everyday favorite." }
  }
}
```

Each draft captures the live version at creation. Concurrent changes return `409 CONFIG_CONFLICT` rather than overwriting another administrator. Discard the stale draft and review a newly created one. Rollback compares only the original affected fields and preserves unrelated settings.

## Error contract and registration states

```json
{
  "error": {
    "code": "CODE_INCORRECT",
    "message": "The verification code is incorrect.",
    "requestId": "request-reference",
    "attemptsRemaining": 4
  }
}
```

| Status / code | Client behavior |
| --- | --- |
| 201 registration | Show verification form; pending cookie is already set |
| 503 `MAIL_NOT_CONFIGURED` / `DELIVERY_FAILED`, `pending:true` | Keep entered name/email, load `/auth/pending`, show delivery error and timed resend |
| 422 `CODE_INCORRECT` | Show attempts remaining; allow retry |
| 410 `CODE_EXPIRED` | Ask for a new code |
| 429 `TOO_MANY_ATTEMPTS` | Stop verification attempts; request a fresh code after cooldown |
| 429 `RESEND_COOLDOWN` / `RATE_LIMITED` | Honor `Retry-After` and `error.retryAfter` seconds |
| 403 `EMAIL_UNVERIFIED`, `pending:true` | Login password was correct; continue the saved verification flow |
| 409 `ACCOUNT_EXISTS` | Use sign-in instead of creating a duplicate |
| 401 `UNAUTHENTICATED` | Ask for sign-in |
| 403 `FORBIDDEN` / `CSRF_INVALID` | Do not retry blindly; enforce permissions or refresh the session |
| 409 `CONFIG_CONFLICT` / `DRAFT_CONFLICT` | Reload and review current configuration |
| 409 `REVISION_CONFLICT` | Reload/review the record; do not overwrite another editor's changes |
| 422 `IDEMPOTENCY_REQUIRED` / 409 `IDEMPOTENCY_CONFLICT` | Supply a retained checkout key; use a new key only for changed order details |
| 409 `INVALID_STOCK` / `RESERVED_STOCK` | Refresh availability; do not deduct stock in the browser |
| 409 `PAYMENT_FINAL` / `PAYMENT_MISMATCH` | Refresh the saved order; do not claim a successful payment |
| 410 `RESET_EXPIRED` | Request a new password-reset link |

Code values, password hashes, session hashes, Gmail credentials, SMTP error contents and verification HMACs never appear in responses or logs. A successful SMTP send means the provider accepted the message; it does not guarantee inbox delivery.
