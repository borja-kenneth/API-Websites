# PayMongo TEST checkout

1. Set private `.env`: `PAYMENT_MODE=paymongo-test`, `PAYMONGO_SECRET_KEY` (sk_test only), `PAYMONGO_WEBHOOK_SECRET`, and `PAYMONGO_PAYMENT_METHODS` (comma-separated methods actually enabled in the test account). Never paste keys into chat or frontend code.
2. Set `APP_ORIGIN` to the reachable HTTPS test deployment/tunnel origin. Register `/api/v1/webhooks/paymongo` for `checkout_session.payment.paid` in the test dashboard; use that endpoint's signing secret. Restart the server.
3. Checkout saves authoritative prices/variants/discounts/shipping first. Continue to PayMongo TEST; returning alone never marks paid. Use Check payment status to reconcile.
4. Back up using existing maintenance tools before operational testing. No schema migration is required. Session references and unique provider payment/event IDs use existing payment_events; no raw provider payload or billing/card data is stored.

Creation uses /v2/checkout_sessions. Retrieval and explicit expiration use documented /v1/checkout_sessions/{id} endpoints. An active session is reused. Stock stays held if expiration fails or payment is ongoing. The worker reconciles overdue holds. Cancel closes the provider session before releasing stock; a confirmed closed session requires a new checkout order.

A network-uncertain creation without a session ID is deliberately blocked from automatic replacement. Resolve the order reference in the PayMongo test dashboard before any manual intervention; stock is retained. There is no automatic unsafe reset, payout, or PayMongo refund implementation.

Official references:
- https://docs.paymongo.com/docs/payment-channels-hosted-checkout-quick-start
- https://docs.paymongo.com/docs/payment-channels-key-concepts
- https://docs.paymongo.com/docs/developer-tools-webhook-setup-management
- https://docs.paymongo.com/reference/expire-a-checkout-session
