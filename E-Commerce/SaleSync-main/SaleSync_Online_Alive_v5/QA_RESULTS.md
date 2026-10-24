# Browser QA — Alive UI v5

This is validation of **prototype UI behavior** with bundled offline assets, not live integration testing. Browser: headless Chromium via Playwright; rendered with HTML injected into an isolated page because the browser sandbox blocks navigation to file/localhost URLs in this environment.

## Passed checks

- 12 original products displayed in the home product grids; original SaleSync logo visibly loads.
- Three selectable promotional banners (including the TechHub PH-specific promotion).
- Dedicated TechHub PH and StyleHub stores and two-card store directory.
- Clicking into a store opens its unique landing page; shopping its collection filters to that seller's products.
- Changing StyleHub storefront headline in the Seller store-profile form updates the public store page after switching back to Guest.
- Search results correctly filter the catalog; Shop all now clears prior search/store restrictions.
- Two-product compare tray and detailed matrix open; existing four-product limit preserved from prior implementation.
- Add to cart, logged-in customer cart and PayMongo-only demonstration checkout appear.
- Management and Maintenance demo portals remain distinct.
- Zero JavaScript page errors in available smoke tests.
- Responsive widths **360, 390, 768, 1024, 1280, 1440 px**: no horizontal page overflow; zero failed local image loads in offline variant.

## Not tested / incomplete

- Live PayMongo checkout, signed webhooks, merchant payouts or actual refunds.
- Real POS backup inventory API, database transactions and concurrency.
- Production authentication, access controls, email/SMS/courier integration.
- Rights and exact product-photo correspondence of externally hosted photographs.
- Full accessibility audit, all product variants and real merchant business content.

These remain required before calling this a production application.
