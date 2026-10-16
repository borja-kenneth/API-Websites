# ShopHub — Web-based E-Commerce (SIA)

A front-end prototype of a Philippine multi-seller marketplace with **customer**, **seller** and **admin** roles.
The current database demo loads the catalog and available stock from MySQL and saves Cash on Delivery demo orders there. Most other screens still use in-memory sample data, so those changes reset after a page refresh.

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

This is a presentation path, not a finished backend. The database connection covers storefront products and stock plus COD demo order creation. Login, most seller/admin tools, vouchers, shipping updates, and other data still use browser memory. The demo order API also trusts ShopHub's browser-calculated voucher discount, so keep it local and do not use it for real sales. It is not connected to SaleSync yet.

## Demo logins
Use the buttons on the login page, or type an email (any non-empty password works in the demo):
`customer@shophub.com` · `seller@shophub.com` (TechHub PH) · `admin@shophub.com` · `leo@mail.com` (seller, StyleHub) · `mark@mail.com` (suspended) · `pending@shophub.com` (pending seller).
To try the first-order voucher, **sign up** a new customer.
The demo clock is the `TODAY` constant in `js/data.js` (so seeded vouchers stay valid whenever you open it).

## 1. Shipping — the whole process
| Step | Who | What happens |
|---|---|---|
| Address | Customer | Full PH address (region → barangay, mobile validated). Region sets the delivery estimate: NCR 2–4, Luzon 3–5, Visayas 4–7, Mindanao 5–8 days |
| Fee | System | Flat ₱50 **per seller shipment** (admin can change it). A cart with 2 sellers = 2 orders/shipments |
| Accept → Pack | Seller | Pending → Processing → Packed. Customer may cancel before shipping (stock, payment and voucher are given back) |
| Book courier | Seller | Choose J&T / LBC / Flash / Ninja Van, parcel weight, notes → tracking number + printable **waybill** (shows “collect cash” for COD) |
| In transit | Seller / courier | Shipped → Out for Delivery, with timestamped courier events |
| Delivery | Seller / rider | **Delivered** (received-by name; COD cash recorded) or **Failed attempt** with a reason. After 3 failed attempts the parcel is **Returned to sender**: stock restored, prepaid payment refunded, voucher restored |
| Tracking | Customer / public | Order tracking page, and a public **Track Parcel** page (tracking number only, no personal data shown) |
| Oversight | Admin | Shipping console: counts, couriers on/off, every shipment and its timeline |

## 2. Vouchers
* **Platform vouchers** (admin) and **shop vouchers** (each seller, in *Shop Vouchers*). Types: percent (with cap), fixed amount, **free shipping with a cap**.
* Rules per voucher: minimum spend, category, **first-order only**, **total usage limit**, **uses per customer**, expiry, enable/disable.
* **Stacking:** one platform voucher + one shop voucher per seller in the same checkout. Discounts are split across shipments proportionally.
* Funding: shop vouchers come out of the seller’s earnings; platform vouchers are paid by the platform.
* Cancelled / returned orders give the voucher use back.
* Seeded codes: `SHOP10` `WELCOME100` `FREESHIP` `SHIP30` `NEWUSER` `TECH15` `STYLE50` (StyleHub) `TECHSHIP` (TechHub) `OLD20` (expired, to show the error).

## 3. Payments, linked accounts and payouts (PayMongo-style simulation)
* **Customers pay with:** Cash on Delivery, GCash, Maya, GrabPay, QR Ph, online banking, cards. A sandbox screen simulates success/failure; card numbers ending in `0002` decline.
* **Customers link** an e-wallet, bank or card under *Payment Methods* (one-time code `123456`; only the last 4 digits are kept) and choose it at checkout.
* **Sellers link** a payout account (GCash, Maya, banks, or digital banks: GoTyme, Maya Bank, SeaBank, CIMB, Tonik, UnionDigital) and request payouts.
* **Money flow:** online payments are held until delivery; COD earnings are released after the admin confirms the courier’s remittance. Seller net = sales − shop-funded discounts − commission (default 5%).
* **Admin ledger:** payments, COD remittance, refunds, estimated gateway fees, payout requests (pay / reject) and simulated webhook events.

## Which provider should we integrate?
* **Collecting payments → PayMongo.** Hosted Checkout covers GCash, Maya, GrabPay, QR Ph, online banking and cards, so the checkout list above maps directly to it. Start in test mode with `sk_test_` keys.
* **Paying sellers → check first.** PayMongo documents payout/transfer webhook events, but confirm with them that payouts are enabled for a marketplace account. If not, **Xendit** (Disbursements / XenPlatform) is built for sending money to banks and e-wallets, or run a manual InstaPay / PESONet batch from the admin ledger (this is what “Mark paid” represents today).
* Digital banks (GoTyme, Maya Bank, SeaBank, …) are *payout destinations* here; customers of those banks can pay through **QR Ph**.
* Rates, settlement times and payout limits change — get written quotes from both providers.

## Going live checklist
1. Move the data and the rules in `js/app.js` (`totals`, `vcheck`, `finalize`, payouts) to a backend + database. A browser page can’t be the source of truth.
2. Run `server/` (or port it): create Checkout Sessions server-side, **verify webhooks**, mark orders paid only from the webhook. See `server/server.js`; `cd server && npm test` runs an offline self-test against a fake PayMongo.
3. Keep secret keys in server env vars only. Never collect raw card numbers yourself — PayMongo’s hosted page does that.
4. Add refunds (PayMongo refund API) where `setStatus()` currently simulates them, and real courier booking / tracking webhooks where `book()` simulates them.
5. Provider onboarding (business verification), Data Privacy Act (RA 10173) notice/consent, and real authentication (the demo login accepts any password).

## What changed in this version
Added/finished: full shipping flow, courier booking + waybills, failed-delivery handling, public parcel tracker, platform + seller vouchers with stacking/limits/first-order/free-shipping caps, linked customer & seller accounts, seller payouts, admin payments ledger, voucher restore on cancel/return, collision-free order numbers, safer handling of quotes in names/categories and stricter SKU/category validation, PayMongo server example.
