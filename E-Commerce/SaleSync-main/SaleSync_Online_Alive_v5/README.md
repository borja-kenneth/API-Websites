# SaleSync Online — Alive UI Edition v5

An enhanced **interactive HTML design prototype** for the SaleSync Online e-commerce site. The original **SaleSync name and logo** are retained. The two standalone systems (e-commerce and SaleSync POS) are independent: POS connection is only a future private backup-stock API. PayMongo remains the **sole checkout gateway**; payment responses in this prototype are simulated, not real financial transactions.

## Open the previews

- **SaleSync_Online_Alive.html** — full multi-file prototype. Open in Chrome with internet connectivity for externally hosted product photographs. If photo requests fail, each item automatically uses its locally packaged, product-specific illustration. Keep the `assets/` folder beside the HTML.
- **SaleSync_Online_Offline_Alive.html** — stand-alone, self-contained, offline-capable HTML. It embeds the original SaleSync logo, two store marks, and product-specific illustrations. No internet or installation required. This is *not* a photograph-based build.

To test customer, seller, management-admin, maintenance-admin, applicant and pending-seller views, append **`?demo=1`** to the opened HTML file's URL. A small **Preview roles** control then appears in the lower-right corner. It is hidden during normal shopping UI browsing to keep the site presentation clean.

## What's new compared with the previous UI

1. Editorial three-banner homepage with TechHub PH, StyleHub and general shopping themes.
2. More visual category navigation, curated collection block and redesigned merchandising sections.
3. **TechHub PH** brand mark, blue tech-focused palette, store tagline, cover, store-specific landing page and product set.
4. **StyleHub** brand mark, warm rose palette, style/lifestyle cover, store-specific landing page and product set.
5. Store directory, shopping-store filtering, consistent store identity on product cards and product-detail overlay.
6. Seller **Store profile** editor now updates its own storefront headline, tagline and description using the same shared demo data.
7. Polished product cards, refined motion/hover/focus, consistent image boxes, touch targets and mobile layout.
8. Navigation bugfix: Shop all clears older search/store/category filters.
9. Existing multi-role flows, 2–4 product comparison, cart, wishlist, vouchers and PayMongo-only simulated checkout are preserved.

## Important boundaries

- This is an HTML/JavaScript UI prototype, not a production-ready store. Account switching is simulated; role restrictions and persisted localStorage records are not server security.
- **No actual PayMongo payment is performed.** No real orders, stock, couriers, messages, refunds or POS API actions occur.
- Seller mark and identity copy are proposed design assets, not verified registered company logos or approved business descriptions.
- Product photography remains an unresolved release task; see `IMAGE_ASSET_NOTES.md`. A consistent matching local illustration is embedded for every product as a visual fallback.
- This ZIP does not change the production Next.js/Node database projects or the independent SaleSync POS project.

## Suggested presentation walk-through

1. Browse homepage and switch the three hero banner dots.
2. Open TechHub PH and StyleHub from the side banners, then explore their own product collections.
3. Visit **Our stores**, compare the two identity systems, and enter either storefront.
4. Browse products, add to wishlist, compare two to four products, and add products to the cart.
5. Test customer checkout via the **simulated** PayMongo-only workflow.
6. Append `?demo=1`, choose Seller → StyleHub → Store profile; change the headline, save, then switch back to Guest → Our stores → StyleHub and see the updated heading.
7. Check Management Admin and Maintenance Admin role separation.
