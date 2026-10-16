"use strict";

const { pool } = require("./database");

const products = [
  [
    "SKU-P1",
    "Wireless Noise-Cancelling Headphones",
    "Electronics",
    "Quality wireless headphones from a verified ShopHub seller.",
    4500,
    5000,
    "🎧",
    "seller@shophub.com",
    4.8,
    124,
    24,
  ],
  [
    "SKU-P2",
    "Mechanical Gaming Keyboard RGB",
    "Electronics",
    "RGB mechanical gaming keyboard.",
    2200,
    2200,
    "⌨️",
    "seller@shophub.com",
    4.5,
    89,
    15,
  ],
  [
    "SKU-P3",
    "Smart Fitness Watch Series 5",
    "Electronics",
    "Smart fitness watch with health tracking.",
    3100,
    3500,
    "⌚",
    "seller@shophub.com",
    4.2,
    56,
    0,
  ],
  [
    "SKU-P4",
    "Minimalist Wooden Coffee Table",
    "Home & Living",
    "Minimalist wooden coffee table.",
    1850,
    1850,
    "🪑",
    "leo@mail.com",
    4.6,
    34,
    5,
  ],
  [
    "SKU-P5",
    "Classic White Canvas Sneakers",
    "Fashion",
    "Classic white canvas sneakers.",
    1500,
    1500,
    "👟",
    "leo@mail.com",
    4.9,
    210,
    50,
  ],
  [
    "SKU-P6",
    "Professional DSLR Camera",
    "Electronics",
    "Professional DSLR camera.",
    35000,
    38000,
    "📷",
    "seller@shophub.com",
    4.7,
    45,
    3,
  ],
  [
    "SKU-P7",
    "Denim Jacket",
    "Fashion",
    "Everyday denim jacket.",
    1299,
    1599,
    "🧥",
    "leo@mail.com",
    4.4,
    77,
    30,
  ],
  [
    "SKU-P8",
    "Hydrating Face Serum",
    "Beauty",
    "Hydrating face serum.",
    650,
    800,
    "🧴",
    "leo@mail.com",
    4.7,
    143,
    60,
  ],
  [
    "SKU-P9",
    "Yoga Mat Pro",
    "Sports",
    "Non-slip yoga mat.",
    899,
    899,
    "🧘",
    "leo@mail.com",
    4.6,
    98,
    40,
  ],
  [
    "SKU-P10",
    "Leather Wallet",
    "Accessories",
    "Leather wallet with card slots.",
    799,
    999,
    "👛",
    "leo@mail.com",
    4.5,
    61,
    25,
  ],
  [
    "SKU-P11",
    "Aroma Diffuser",
    "Home & Living",
    "Aroma diffuser for home.",
    1250,
    1450,
    "🕯️",
    "seller@shophub.com",
    4.3,
    52,
    18,
  ],
  [
    "SKU-P12",
    "Running Shoes",
    "Sports",
    "Lightweight running shoes.",
    2800,
    3200,
    "🏃",
    "leo@mail.com",
    4.8,
    175,
    8,
  ],
];

async function seedDemo() {
  await pool.execute(
    `
    INSERT INTO users (full_name, email, password_hash, role, status)
    VALUES (?, ?, ?, 'seller', 'Active')
    ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), status = VALUES(status)
  `,
    ["Demo Seller", "seller@shophub.com", "demo-only-no-login"],
  );
  await pool.execute(
    `
    INSERT INTO users (full_name, email, password_hash, role, status)
    VALUES (?, ?, ?, 'seller', 'Active')
    ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), status = VALUES(status)
  `,
    ["Leo Santos", "leo@mail.com", "demo-only-no-login"],
  );
  await pool.execute(
    `
    INSERT INTO users (full_name, email, password_hash, role, status)
    VALUES (?, ?, ?, 'customer', 'Active')
    ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), status = VALUES(status)
  `,
    ["Jessica Mae", "customer@shophub.com", "demo-only-no-login"],
  );

  const [sellers] = await pool.execute(`
    SELECT user_id, email FROM users
    WHERE email IN ('seller@shophub.com', 'leo@mail.com')
  `);
  const sellerIds = new Map(
    sellers.map((seller) => [seller.email, seller.user_id]),
  );
  await pool.execute(
    `
    INSERT INTO seller_profiles (seller_id, store_name, description)
    VALUES (?, 'TechHub PH', 'Gadgets and home tech.')
    ON DUPLICATE KEY UPDATE store_name = VALUES(store_name), description = VALUES(description)
  `,
    [sellerIds.get("seller@shophub.com")],
  );
  await pool.execute(
    `
    INSERT INTO seller_profiles (seller_id, store_name, description)
    VALUES (?, 'StyleHub', 'Fashion, sports and home.')
    ON DUPLICATE KEY UPDATE store_name = VALUES(store_name), description = VALUES(description)
  `,
    [sellerIds.get("leo@mail.com")],
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS demo_seed_stock (
      sku VARCHAR(64) PRIMARY KEY,
      seeded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  for (const [
    sku,
    name,
    category,
    description,
    price,
    originalPrice,
    image,
    sellerEmail,
    rating,
    reviewCount,
    stock,
  ] of products) {
    const [categories] = await pool.execute(
      "SELECT category_id FROM categories WHERE name = ? AND is_active = 1 LIMIT 1",
      [category],
    );
    if (!categories.length)
      throw new Error(`Missing active category: ${category}`);
    await pool.execute(
      `
      INSERT INTO products
        (seller_id, category_id, sku, name, description, price, original_price,
         image, status, rating_avg, review_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name), description = VALUES(description), price = VALUES(price),
        original_price = VALUES(original_price), image = VALUES(image), status = 'Active'
    `,
      [
        sellerIds.get(sellerEmail),
        categories[0].category_id,
        sku,
        name,
        description,
        price,
        originalPrice,
        image,
        rating,
        reviewCount,
      ],
    );

    if (stock > 0) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [marker] = await connection.execute(
          "INSERT IGNORE INTO demo_seed_stock (sku) VALUES (?)",
          [sku],
        );
        if (marker.affectedRows) {
          const [rows] = await connection.execute(
            `
            SELECT p.product_id, i.quantity_on_hand
            FROM products p JOIN inventory i ON i.product_id = p.product_id
            WHERE p.sku = ? FOR UPDATE
          `,
            [sku],
          );
          const product = rows[0];
          const before = Number(product.quantity_on_hand);
          const after = before + stock;
          await connection.execute(
            "UPDATE inventory SET quantity_on_hand = ? WHERE product_id = ?",
            [after, product.product_id],
          );
          await connection.execute(
            `
            INSERT INTO inventory_movements
              (product_id, movement_type, quantity_change, quantity_before, quantity_after,
               reference_type, reference_id, reason)
            VALUES (?, 'RESTOCK', ?, ?, ?, 'DEMO_SEED', 'SHOPHUB_DEMO_V1', 'Demo starting stock')
          `,
            [product.product_id, stock, before, after],
          );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  }

  console.log(
    `Demo data ready: ${products.length} products; stock seed applied once.`,
  );
}

seedDemo()
  .catch((error) => {
    console.error("Could not seed ShopHub demo data:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
