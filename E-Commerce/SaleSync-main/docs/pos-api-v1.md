# SaleSync POS inventory contract v1

This is the proposed integration contract for the standalone POS provider. No actual POS contract or endpoint was supplied. The e-commerce adapter is implemented and tested with isolated providers; the POS team must implement or explicitly adapt this contract before enabling it.

## Private configuration

Set `POS_ENABLED=true`, `POS_BASE_URL` (HTTPS origin), `POS_AUTH_TOKEN`, and `POS_MAPPINGS` in private server configuration. Keep `.env` untracked. Use a high-entropy read-only machine token restricted by the POS server to the configured stores; rotate it on both systems. No credentials are sent to browsers. HTTPS is mandatory except explicitly opted-in development loopback HTTP.

`POS_MAPPINGS` is a JSON array of `{storeId, posStoreId, skus:[{sku,posSku}]}`. Store IDs and SKUs must already exist in e-commerce. Map individual variant SKUs, not a variation parent. Each POS store and SKU maps uniquely; no name matching or automatic discovery occurs. At most 100 stores, with 100 explicitly mapped SKUs per store, are supported per configuration. Mapping changes require a server restart. Invalid or renamed local SKU mappings fail closed.

## Provider requests

All requests use `Authorization: Bearer <private token>`, `Accept: application/json`, and `X-SaleSync-API-Version: 1`. Provider authorization must validate the token and its allowed stores. Never return other stores' records.

- `GET /api/v1/health` returns `{"apiVersion":"1","status":"ok"}` with no business data.
- `GET /api/v1/inventory?store_id=POS_STORE_ID&sku=SKU_ONE&sku=SKU_TWO` returns:

```json
{"apiVersion":"1","storeId":"POS_STORE_ID","asOf":"2026-10-24T00:00:00Z","items":[{"sku":"SKU_ONE","quantity":7,"updatedAt":"2026-10-24T00:00:00Z"}]}
```

Quantities must be non-negative safe integers (maximum 1 billion). UTC source timestamps must be valid, not more than 60 seconds ahead of the e-commerce clock. Duplicate/unrequested SKUs, incorrect store IDs, oversized responses (>128 KiB), and invalid quantities are rejected. Missing SKUs are unavailable, never assumed to be zero. Source age and last successful fetch determine staleness. Synchronize server clocks.

Use 401/403 for authentication/scope failures, 429 for rate limiting, and 5xx for transient provider errors. The adapter retries a read once for network/timeout/5xx errors, never for 401/403/429. Redirects are rejected. Each attempt times out after `POS_TIMEOUT_MS` (100–10000 ms).

## E-commerce endpoints and roles

All use existing cookie sessions, CSRF validation for POST, and `/api/v1`:

- Seller: `GET /seller/pos/inventory`, `POST /seller/pos/inventory/refresh` with `{reason}`. Approved owned store only.
- Management: `GET /admin/pos/inventory?storeId=...`, `POST /admin/pos/inventory/refresh?storeId=...` with `{reason}`. Refresh requires one explicit store.
- Maintenance: `GET /admin/pos/status`, `POST /admin/pos/check` with `{reason}`. Diagnostics only; no SKU quantities, store identifiers, tokens, or endpoint URLs.
- Customers have no POS access. POS machines have no e-commerce mutation endpoint.

`referenceOnly:true` responses separate `backupQuantity` from canonical e-commerce quantities. Refresh failures retain the previous snapshot marked unavailable/stale. No POS response writes products, reservations, inventory movements, carts, orders, or payments. Refreshes are explicit and audited. The reference cache is bounded by configured mappings and held in process memory; restart clears it and shows Never/not updated until the next successful fetch. No schema migration is needed. Existing records and PayMongo are unchanged.
