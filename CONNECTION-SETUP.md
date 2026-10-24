# SaleSync POS and E-Commerce connection

## What the connection does

- SaleSync POS owns the product list, categories, descriptions, images, prices, and stock.
- E-Commerce reads that catalog from SaleSync POS when customers open the catalog and again at checkout.
- When an order is placed, the POS reserves the requested stock. A successful local test payment turns that reservation into a POS sale and transaction receipt. A failed, expired, or cancelled order releases the reservation.
- E-Commerce keeps its vouchers and customer accounts. Its payment setting is currently `local-test`; it does not charge real money.

## Start both systems

1. On the computer hosting SaleSync POS, start XAMPP Apache and MySQL. Open SaleSync POS locally first and confirm it can connect to its MySQL database.
2. On the computer hosting E-Commerce, open `E-Commerce\SaleSync-main\Start-SaleSync.cmd`.
3. Visit `http://<E-COMMERCE-COMPUTER-IP>:3000` from the browser. Do not add `?demo=1`; that selects the old browser-only demo.

## Point E-Commerce at the POS computer

Edit `E-Commerce\SaleSync-main\.env` on the E-Commerce computer:

```env
ONLINE_POS_ENABLED=true
ONLINE_POS_URL=http://<POS-COMPUTER-IP>/API-Websites/POS-System/api/storefront/index.php
ONLINE_POS_KEY=<same private key as POS System/api/storefront/config.local.php>
```

The POS computer's IP is the address that E-Commerce must use. If both systems are on this same computer, `127.0.0.1` can be used. If they are on two computers, use the POS computer's current private Wi-Fi or Ethernet IP. Restart `Start-SaleSync.cmd` after changing `.env`.

The shared key is stored in `POS-System\api\storefront\config.local.php` and the E-Commerce `.env`. Keep it private. The POS API denies requests without the matching key. The online order tables are created automatically in the POS MySQL database on the first authenticated API request.

## Check the connection

- The existing POS backup panel in the staff screens is a separate legacy reference feature. The live customer catalog and checkout use the new SaleSync connection directly; the page layout has not been changed.
- The catalog is read from POS. To make a product available online, add or edit it in SaleSync POS, including its barcode/SKU, category, price, quantity, and optional image.
- To verify an order end-to-end, add an in-stock POS product to an E-Commerce cart, place the order, then choose the successful **local test** payment outcome. Confirm the completed sale in POS transactions. This is a test payment only.

If the connection fails between computers, check that both are connected to the same private network, the POS IP in `.env` is current, Apache/MySQL are running on the POS computer, and Windows Firewall permits Apache on the private network.
