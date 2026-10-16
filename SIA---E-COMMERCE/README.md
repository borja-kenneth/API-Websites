# ShopHub — Web-based E-Commerce (SIA)

A front-end prototype of a Philippine multi-seller marketplace with **customer**, **seller** and **admin** roles.
The site can load its catalog and available stock from the ShopHub database, or from SaleSync through the separate server-side connector. Most non-order screens still use in-memory sample data, so those changes reset after a page refresh.

```
index.html          page shell (loads the files below, in this order)
css/styles.css      small global styles
js/data.js          constants and fallback demo data
js/helpers.js       shared UI helpers, route lists, menus
js/app.js           the `app` object: cart, vouchers, checkout, payments, shipping, payouts, admin actions
js/views.js         every screen (R.<view> render functions) + start-up
server/             Node web server, MySQL API, demo data seeder and optional PayMongo example
```

## Connect the database demo

1. Install **MySQL 8.0.16 or newer** and import `shophub_db_v1.2.sql` into the server. The SQL file creates the `shophub` database.
2. In a terminal, open `server/` and run `npm install`.
3. Copy `.env.example` to `.env`. Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` for your MySQL installation. Keep `ENABLE_DEMO_ORDERS=true` for the presentation demo.
4. Run `npm run seed:demo` once to add the sample sellers, customer, products, images, and starting stock. Re-running it refreshes product details without adding the starting stock again.
5. Run `npm start`, then open `http://localhost:3000`. Check `http://localhost:3000/api/health` for the database connection and `http://localhost:3000/api/catalog` for products.
6. Sign in as the demo customer, add an item to the cart, choose **Cash on Delivery**, and place the order. ShopHub records the order and reserves the stock in MySQL; available stock should drop by the ordered amount.

This remains a student project connection, not a live-commerce system. Login, seller/admin tools, vouchers, shipping updates, and other data still use browser memory. Only Cash on Delivery is connected to SaleSync; the PayMongo screen remains a payment simulation.

## Connect ShopHub to SaleSync on two computers

SaleSync is the source of product names, prices, and stock. ShopHub reads that catalog through SaleSync's private API. Checkout reserves stock in SaleSync. When the order is marked **Delivered / Completed**, SaleSync releases the reservation, subtracts the physical stock, and records an `ECOMMERCE` transaction. Cancelling an uncompleted order releases the reservation.

1. Put both computers on the same trusted Wi-Fi or local network. On the SaleSync computer, start Apache and MySQL in XAMPP and confirm `http://localhost/SaleSync/api/index.php?route=health` returns `{"ok":true,"database":"salesync"}`.
2. Import `SaleSync/api/ecommerce/schema.sql` into the existing `salesync` database once. It adds only the two tables needed to track ShopHub reservations; it does not replace existing POS data.
3. Copy `SaleSync/api/ecommerce/config.example.php` to `SaleSync/api/ecommerce/config.local.php`. Choose a long random secret and put it in `api_key`. Keep this local file private.
4. On the SaleSync computer, run `ipconfig` and note its Wi-Fi/Ethernet IPv4 address (for example `192.168.1.25`). If Windows Firewall asks, allow Apache on **Private networks**. Do not expose this API to the public internet.
5. On the ShopHub computer, copy `server/.env.example` to `server/.env`. Set `SALESYNC_API_URL` to `http://SALE-SYNC-IP/SaleSync/api/ecommerce/index.php` using the SaleSync computer's IPv4 address. Set `SALESYNC_API_KEY` to the exact same secret from step 3. Do not put the key in any browser JavaScript.
6. In a terminal on the ShopHub computer, open `SIA---E-COMMERCE/server` and run `npm install` if needed, then `npm start`. Open `http://localhost:3000` on that same ShopHub computer. Check `http://localhost:3000/api/health`; it should report the `salesync` database.
7. Sign in as the demo customer, place a **Cash on Delivery** order, and then advance it through the delivery statuses until it says **Completed**. At checkout, SaleSync's available stock should drop because it is reserved. After completion, SaleSync's physical on-hand stock drops and a transaction with source `ECOMMERCE` appears. Cancel a pending order to see the reserved amount restored.

ShopHub will show the active products that already exist in SaleSync; it will not use the unrelated ShopHub sample electronics in this mode. SaleSync products do not currently have product photos, so ShopHub uses its package emoji placeholder. Product additions and edits are still managed in SaleSync. If the computers are not reachable over the local network, check their Wi-Fi connection, the SaleSync IP address, XAMPP Apache, and Windows Firewall's Private network rule.

## Demo logins

Use the buttons on the login page, or type an email (any non-empty password works in the demo):
`customer@shophub.com` · `seller@shophub.com` (TechHub PH) · `admin@shophub.com` · `leo@mail.com` (seller, StyleHub) · `mark@mail.com` (suspended) · `pending@shophub.com` (pending seller).
To try the first-order voucher, **sign up** a new customer.
The demo clock is the `TODAY` constant in `js/data.js` (so seeded vouchers stay valid whenever you open it).

## 1. Shipping — the whole process

| Step          | Who               | What happens                                                                                                                                                                                                      |
| ------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Address       | Customer          | Full PH address (region → barangay, mobile validated). Region sets the delivery estimate: NCR 2–4, Luzon 3–5, Visayas 4–7, Mindanao 5–8 days                                                                      |
| Fee           | System            | Flat ₱50 **per seller shipment** (admin can change it). A cart with 2 sellers = 2 orders/shipments                                                                                                                |
| Accept → Pack | Seller            | Pending → Processing → Packed. Customer may cancel before shipping (stock, payment and voucher are given back)                                                                                                    |
| Book courier  | Seller            | Choose J&T / LBC / Flash / Ninja Van, parcel weight, notes → tracking number + printable **waybill** (shows “collect cash” for COD)                                                                               |
| In transit    | Seller / courier  | Shipped → Out for Delivery, with timestamped courier events                                                                                                                                                       |
| Delivery      | Seller / rider    | **Delivered** (received-by name; COD cash recorded) or **Failed attempt** with a reason. After 3 failed attempts the parcel is **Returned to sender**: stock restored, prepaid payment refunded, voucher restored |
| Tracking      | Customer / public | Order tracking page, and a public **Track Parcel** page (tracking number only, no personal data shown)                                                                                                            |
| Oversight     | Admin             | Shipping console: counts, couriers on/off, every shipment and its timeline                                                                                                                                        |

## 2. Vouchers

- **Platform vouchers** (admin) and **shop vouchers** (each seller, in _Shop Vouchers_). Types: percent (with cap), fixed amount, **free shipping with a cap**.
- Rules per voucher: minimum spend, category, **first-order only**, **total usage limit**, **uses per customer**, expiry, enable/disable.
- **Stacking:** one platform voucher + one shop voucher per seller in the same checkout. Discounts are split across shipments proportionally.
- Funding: shop vouchers come out of the seller’s earnings; platform vouchers are paid by the platform.
- Cancelled / returned orders give the voucher use back.
- Seeded codes: `SHOP10` `WELCOME100` `FREESHIP` `SHIP30` `NEWUSER` `TECH15` `STYLE50` (StyleHub) `TECHSHIP` (TechHub) `OLD20` (expired, to show the error).

## 3. Payments, linked accounts and payouts (PayMongo-style simulation)

- **Customers pay with:** Cash on Delivery, GCash, Maya, GrabPay, QR Ph, online banking, cards. A sandbox screen simulates success/failure; card numbers ending in `0002` decline.
- **Customers link** an e-wallet, bank or card under _Payment Methods_ (one-time code `123456`; only the last 4 digits are kept) and choose it at checkout.
- **Sellers link** a payout account (GCash, Maya, banks, or digital banks: GoTyme, Maya Bank, SeaBank, CIMB, Tonik, UnionDigital) and request payouts.
- **Money flow:** online payments are held until delivery; COD earnings are released after the admin confirms the courier’s remittance. Seller net = sales − shop-funded discounts − commission (default 5%).
- **Admin ledger:** payments, COD remittance, refunds, estimated gateway fees, payout requests (pay / reject) and simulated webhook events.

## Which provider should we integrate?

- **Collecting payments → PayMongo.** Hosted Checkout covers GCash, Maya, GrabPay, QR Ph, online banking and cards, so the checkout list above maps directly to it. Start in test mode with `sk_test_` keys.
- **Paying sellers → check first.** PayMongo documents payout/transfer webhook events, but confirm with them that payouts are enabled for a marketplace account. If not, **Xendit** (Disbursements / XenPlatform) is built for sending money to banks and e-wallets, or run a manual InstaPay / PESONet batch from the admin ledger (this is what “Mark paid” represents today).
- Digital banks (GoTyme, Maya Bank, SeaBank, …) are _payout destinations_ here; customers of those banks can pay through **QR Ph**.
- Rates, settlement times and payout limits change — get written quotes from both providers.

## Going live checklist

1. Move the data and the rules in `js/app.js` (`totals`, `vcheck`, `finalize`, payouts) to a backend + database. A browser page can’t be the source of truth.
2. Run `server/` (or port it): create Checkout Sessions server-side, **verify webhooks**, mark orders paid only from the webhook. See `server/server.js`; `cd server && npm test` runs an offline self-test against a fake PayMongo.
3. Keep secret keys in server env vars only. Never collect raw card numbers yourself — PayMongo’s hosted page does that.
4. Add refunds (PayMongo refund API) where `setStatus()` currently simulates them, and real courier booking / tracking webhooks where `book()` simulates them.
5. Provider onboarding (business verification), Data Privacy Act (RA 10173) notice/consent, and real authentication (the demo login accepts any password).

## What changed in this version

Added/finished: full shipping flow, courier booking + waybills, failed-delivery handling, public parcel tracker, platform + seller vouchers with stacking/limits/first-order/free-shipping caps, linked customer & seller accounts, seller payouts, admin payments ledger, voucher restore on cancel/return, collision-free order numbers, safer handling of quotes in names/categories and stricter SKU/category validation, PayMongo server example.
