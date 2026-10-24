# Product image and asset consistency notes

The twelve original catalog entries, names, prices, seller mapping and six categories have been preserved. Every repeated product image is driven by that product's canonical `photo`/`fallback` fields, so cart, compare, catalog, store pages and details can show the same item image.

### Current assets and limitations

- `assets/logo-mark.png`: **original SaleSync logo** copied from the user's existing SaleSync repository. No replacement logo has been invented for SaleSync itself.
- `assets/stores/techhub.svg`, `assets/stores/stylehub.svg`: **new proposed store identity marks**. These are illustrative design work and may require seller approval before live publication.
- `assets/products/p1.svg` through `p12.svg`: matching locally packaged illustrated placeholders from the earlier prototype. All have the same media treatment and consistent labels. They are *not photographs*.
- The full HTML retains the previous prototype's `images.unsplash.com` remote URLs for product photographs. These are not verified, locally licensed or manually audited against actual merchant SKU photos; some may be only approximate. They depend on network access. If unavailable, the UI shows the canonical item illustration, never an unrelated photo.
- The offline standalone HTML uses only matching illustrations and embeds the original logo and store marks so it works without the internet.

### Before production launch

Obtain photographs for the **actual 12 sale items from the sellers or a suitable properly licensed photographer**. Confirm that each image accurately represents its product/SKU and that you have usage rights. Save verified optimized images in `assets/products/` or your deployment media storage; set each product's canonical `photo` field to the approved local image. Keep 1:1 media frames (prefer ~1000×1000 source WebP/AVIF), provide alt text, optional gallery views, and maintain consistent margins, lighting and backgrounds. Do not publish the existing illustrative images as merchant photographs.

Products to verify: p1 Wireless Noise-Cancelling Headphones (TechHub PH), p2 Mechanical Gaming Keyboard RGB (TechHub PH), p3 Smart Fitness Watch Series 5 (TechHub PH), p4 Minimalist Wooden Coffee Table (StyleHub), p5 Classic White Canvas Sneakers (StyleHub), p6 Professional DSLR Camera (TechHub PH), p7 Denim Jacket (StyleHub), p8 Hydrating Face Serum (StyleHub), p9 Yoga Mat Pro (StyleHub), p10 Leather Wallet (StyleHub), p11 Aroma Diffuser (TechHub PH), p12 Running Shoes (StyleHub).
