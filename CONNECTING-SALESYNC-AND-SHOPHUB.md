# Connecting SaleSync and ShopHub (Starter Guide)

This guide connects ShopHub to the SaleSync POS catalog on two Windows laptops using XAMPP. SaleSync is the source for products, prices, categories, and stock. ShopHub asks SaleSync for that information through SaleSync's private API.

## Before you start

- Both laptops must be on a network that lets them reach each other. They can use the same phone hotspot, but some hotspots block communication between connected devices.
- Install XAMPP on the SaleSync laptop and Node.js 20.6 or newer on the ShopHub laptop.
- Keep the API key private. Do not put it in a web page, screenshot, or message.
- The SaleSync laptop's IP address can change. The last address used was `10.239.57.250`; check it again each time the laptops reconnect.

## 1. Start SaleSync on the POS laptop

1. Connect the POS laptop to the phone hotspot.
2. Open XAMPP Control Panel and start **Apache** and **MySQL**.
3. In a browser on the POS laptop, open:

   `http://localhost/API-Websites/SaleSync/api/ecommerce/index.php?route=health`

   You may see **Not authorized**. That is expected in a browser because the API requires a private key. It still confirms that the API page can be reached on the POS laptop.

4. Find the POS laptop's hotspot IP address:
   - Open Command Prompt and run `ipconfig`.
   - Under the adapter connected to the phone hotspot, note **IPv4 Address**.
   - Use that address below in place of `<POS-IP>`.

## 2. Check the connection from ShopHub's laptop

On the ShopHub laptop, open this address in a browser, replacing `<POS-IP>` with the address from step 1:

`http://<POS-IP>/API-Websites/SaleSync/api/ecommerce/index.php?route=health`

- **Not authorized** means the ShopHub laptop reached SaleSync. Continue to step 3.
- **This site can't be reached** means the laptops cannot reach each other yet. Confirm the IP, make sure Apache is running, and check Windows network settings below.

### If the ShopHub laptop cannot reach SaleSync

On the POS laptop, set the hotspot connection's Windows network profile to **Private**: **Settings → Network & internet → Wi-Fi → connected hotspot → Network profile type → Private**. In Windows Firewall, allow Apache HTTP Server on **Private** networks (or allow inbound TCP port 80 for the Private profile). Keep the firewall enabled.

Some phone hotspots isolate connected devices. If both laptops are on the hotspot and the page still cannot be reached, use a shared Wi-Fi router or a direct Ethernet connection instead. A ping timeout by itself is not conclusive because Windows may block ping; the browser test above is the useful check for the API.

## 3. Set ShopHub's SaleSync address and key

On the ShopHub laptop, open this file:

`C:\xampp\htdocs\API-Websites\SIA---E-COMMERCE\server\.env`

Set the SaleSync lines to the POS laptop's current IP and the same secret key that SaleSync has in:

`C:\xampp\htdocs\API-Websites\SaleSync\api\ecommerce\config.local.php`

Example (replace the IP and placeholder; do not copy the placeholder literally):

```env
SALESYNC_API_URL=http://<POS-IP>/API-Websites/SaleSync/api/ecommerce/index.php
SALESYNC_API_KEY=<same-secret-as-SaleSync-config.local.php>
```

Keep the other `.env` settings. Do not share the key or commit it to Git.

## 4. Start ShopHub's server

On the ShopHub laptop, open PowerShell and run:

```powershell
Set-Location 'C:\xampp\htdocs\API-Websites\SIA---E-COMMERCE\server'
npm install   # only needed the first time
npm start
```

Leave that terminal open while using ShopHub. Whenever you change the IP or API key, stop the server with **Ctrl+C**, then run `npm start` again so it loads the changed settings.

## 5. Check that the products and categories arrived

On the ShopHub laptop, open these addresses:

1. `http://localhost:3000/api/integration/status`
   - It should say `"salesyncConfigured":true`.
2. `http://localhost:3000/api/catalog`
   - It should return products and categories from SaleSync. The known SaleSync categories are **Bakery, Beverages, Dairy, Household, Personal Care, and Snacks**.
3. Open `http://localhost:3000` for the ShopHub website. If its categories look stale after the API catalog is correct, refresh with **Ctrl+F5**.

## Quick troubleshooting

| What you see | What it usually means | What to check |
| --- | --- | --- |
| SaleSync health page says **Not authorized** | The API page is reachable; the browser has no key | Continue setup. ShopHub sends the key from its server. |
| SaleSync health page says **This site can't be reached** on ShopHub's laptop | Network path to the POS laptop is blocked or the IP is wrong | Recheck the POS laptop's hotspot IPv4 address, Apache, Private network profile, firewall, and hotspot device isolation. |
| Integration status says `false` | ShopHub did not load its SaleSync URL setting | Check the `.env` file path and restart ShopHub from the `server` folder. |
| ShopHub reports it cannot reach SaleSync | ShopHub's server cannot make the network request | First make the browser test in step 2 work from the ShopHub laptop; then restart ShopHub. |
| API catalog has the right categories but the website does not | The browser may have stale data | Press **Ctrl+F5**. Also confirm the `npm start` terminal has no connection errors. |

