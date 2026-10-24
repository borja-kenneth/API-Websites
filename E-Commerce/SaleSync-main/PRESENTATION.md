# SaleSync presentation

Run commands from `C:\Users\a1\Downloads\SaleSync-main\SaleSync-main` with Node.js 24+.

```powershell
npm.cmd ci                 # Only when dependencies need installing
npm.cmd run presentation   # Isolated presentation, localhost:3002
npm.cmd run demo           # Existing independent demo, localhost:3001
npm.cmd start              # Regular application, port 3000; requires valid .env
```

The presentation launcher opens `data/presentation/accounts.html` locally. It contains
randomly generated fixture accounts for Customer, two Sellers, Management and Maintenance.
Do not share this file or its passwords. Registration and recovery messages appear in
`data/presentation/mail/index.html`; no Gmail messages are sent. Payments and tracking in
this profile are explicitly local simulations, **not PayMongo connectivity evidence**.

Presentation records persist in `data/presentation/salesync.sqlite`. Initial fixture creation
takes a verified WAL-safe snapshot first. Subsequent starts preserve accounts, stock and orders;
they do not reset or duplicate fixtures. Sample stores, products, quantities, prices and existing
illustrations are labeled demonstration data. Four parent products support comparison, two
stores support multi-store checkout, and headphones have two package variants. No genuine
merchants, sales or transactions are inserted into the regular database.

The regular database remains `data/salesync.sqlite`, schema 5. Its empty catalog reflects
the absence of seller applications/products. For genuine catalog content, register and verify
a customer, apply to sell, approve the application as Management, then use that Seller's
workspace to create and publish products. Presentation accounts are never copied into it.

## External setup still required

1. **Gmail owner:** revoke the exposed App Password. Enable Google 2-Step Verification,
   create a new App Password (if allowed by account policy), and enter it privately as
   `GMAIL_APP_PASSWORD` for `GMAIL_USER` in `.env`. Do not use the ordinary Gmail password.
   If App Passwords are unavailable, configure the existing Gmail OAuth2 settings instead.
   Restart and verify receipt in an authorized mailbox; SMTP acceptance alone is insufficient.
2. **PayMongo owner:** rotate the exposed test API secret. Copy the complete new `sk_test_…`
   value privately into `PAYMONGO_SECRET_KEY`; do not repair a revoked key by adding a prefix.
   Use `PAYMENT_MODE=paymongo-test` and only account-enabled `PAYMONGO_PAYMENT_METHODS`.
3. Start `ngrok http 3000`. Set `APP_ORIGIN` to its HTTPS origin, without a trailing slash,
   and retain `http://127.0.0.1:3000,http://localhost:3000` in `API_ALLOWED_ORIGINS` for PC use.
   In PayMongo Test Mode, enable a webhook to that origin plus `/api/v1/webhooks/paymongo`,
   subscribed to `checkout_session.payment.paid`. Privately copy the **endpoint signing secret**
   into `PAYMONGO_WEBHOOK_SECRET`, never a public/secret API key. Restart after configuration.
   A dashboard Test Event checks delivery/signature; complete an actual sandbox checkout to
   verify payment settlement. Do not represent a synthetic event as a completed payment.
4. **POS provider:** supply the independent HTTPS v1 health/inventory endpoints, a read-only
   bearer credential and exact store/SKU mappings using the existing `.env.example` settings.
   Until then, POS is disconnected; its automated tests use isolated mocks. Reference stock
   remains separate from online stock.

## Walkthrough

Browse sample stores → register/verify through local inbox → apply as a new seller →
Management approval → Seller profile/catalog/stock → four-product comparison → select a
package variant → cart and multi-store checkout → explicit local payment simulation →
order history and Seller fulfillment → Management reports → Maintenance health and verified
backup. Show PayMongo's separate Test Mode workflow only after its credentials are rotated.
Show POS as integration-ready and unconnected until the real provider is supplied.
