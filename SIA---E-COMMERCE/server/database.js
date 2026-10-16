"use strict";

const mysql = require("mysql2/promise");
const salesync = require("./api/salesync");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || "shophub",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  waitForConnections: true,
  connectionLimit: 5,
  charset: "utf8mb4",
});

async function health() {
  if (salesync.isConfigured()) return salesync.health();
  await pool.query("SELECT 1");
  return { ok: true, database: process.env.DB_NAME || "shophub" };
}

async function catalog() {
  if (salesync.isConfigured()) return salesync.catalog();
  const [products] = await pool.query(`
    SELECT product_id, seller_id, category_id, sku, name, description,
           price, original_price, stock, image, status, rating_avg,
           review_count, seller_name, category_name
    FROM v_live_products
    ORDER BY product_id
  `);
  const [categories] = await pool.query(`
    SELECT name, icon FROM categories WHERE is_active = 1 ORDER BY name
  `);
  return { products, categories };
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

async function createDemoOrders(input) {
  if (salesync.isConfigured()) return salesync.placeOrders(input);
  if (process.env.ENABLE_DEMO_ORDERS !== "true") {
    throw Object.assign(new Error("Demo orders are disabled."), {
      status: 403,
    });
  }
  if (!Array.isArray(input.groups) || input.groups.length === 0) {
    throw badRequest("The order has no items.");
  }
  if (input.paymentMethod !== "Cash on Delivery") {
    throw badRequest(
      "The connected demo order currently supports Cash on Delivery only.",
    );
  }

  const address = input.address || {};
  const addressFields = [
    "name",
    "phone",
    "region",
    "province",
    "city",
    "barangay",
    "street",
    "zip",
  ];
  if (addressFields.some((field) => !String(address[field] || "").trim())) {
    throw badRequest(
      "Complete the delivery address before placing the demo order.",
    );
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [customers] = await connection.execute(
      "SELECT user_id FROM users WHERE email = ? AND role = 'customer' AND status = 'Active' LIMIT 1",
      [input.customerEmail || "customer@shophub.com"],
    );
    if (!customers.length) {
      throw badRequest(
        "Run npm run seed:demo in server/ to add the demo customer.",
      );
    }
    const customerId = customers[0].user_id;
    const [couriers] = await connection.execute(
      "SELECT courier_id FROM couriers ORDER BY courier_id LIMIT 1",
    );
    const [methods] = await connection.execute(
      "SELECT payment_method_id FROM payment_methods WHERE code = 'pay_cod' LIMIT 1",
    );
    if (!couriers.length || !methods.length) {
      throw new Error(
        "ShopHub courier or payment-method reference data is missing.",
      );
    }

    const saved = [];
    for (const group of input.groups) {
      if (!/^ORD-\d{4,}$/.test(String(group.orderNumber || ""))) {
        throw badRequest("The demo order number is invalid.");
      }
      if (!Array.isArray(group.items) || group.items.length === 0) {
        throw badRequest("An order group has no items.");
      }

      let subtotal = 0;
      let sellerId = null;
      const lines = [];
      for (const item of group.items) {
        const sku = String(item.sku || "").trim();
        const quantity = Number(item.quantity);
        if (
          !sku ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 99
        ) {
          throw badRequest("A product SKU or quantity is invalid.");
        }
        const [rows] = await connection.execute(
          `
          SELECT p.product_id, p.seller_id, p.price,
                 i.quantity_on_hand, i.quantity_reserved
          FROM products p
          JOIN inventory i ON i.product_id = p.product_id
          WHERE p.sku = ? AND p.status = 'Active'
          FOR UPDATE
        `,
          [sku],
        );
        const product = rows[0];
        if (!product) throw badRequest(`Product ${sku} is not available.`);
        if (
          sellerId !== null &&
          String(sellerId) !== String(product.seller_id)
        ) {
          throw badRequest("Keep each demo order group to one seller.");
        }
        if (product.quantity_on_hand - product.quantity_reserved < quantity) {
          throw badRequest(`There is not enough stock for ${sku}.`);
        }
        sellerId = product.seller_id;
        const price = Number(product.price);
        subtotal += price * quantity;
        lines.push({ productId: product.product_id, sku, quantity, price });
      }

      const itemDiscount = Number(group.itemDiscount || 0);
      const shippingFee = Number(group.shippingFee ?? 50);
      const shippingDiscount = Number(group.shippingDiscount || 0);
      if (
        !Number.isFinite(itemDiscount) ||
        itemDiscount < 0 ||
        itemDiscount > subtotal ||
        !Number.isFinite(shippingFee) ||
        shippingFee < 0 ||
        !Number.isFinite(shippingDiscount) ||
        shippingDiscount < 0 ||
        shippingDiscount > shippingFee
      ) {
        throw badRequest("The order discount or shipping amount is invalid.");
      }
      const netShipping =
        Math.round((shippingFee - shippingDiscount) * 100) / 100;
      const total =
        Math.round((subtotal - itemDiscount + netShipping) * 100) / 100;

      await connection.execute(
        `
        INSERT INTO orders
          (order_number, customer_id, seller_id, courier_id, payment_method_id,
           payment_status, status, subtotal, shipping_fee, discount, total,
           ship_name, ship_phone, ship_region, ship_province, ship_city,
           ship_barangay, ship_street, ship_zip)
        VALUES (?, ?, ?, ?, ?, 'Unpaid', 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          group.orderNumber,
          customerId,
          sellerId,
          couriers[0].courier_id,
          methods[0].payment_method_id,
          subtotal,
          netShipping,
          itemDiscount,
          total,
          address.name,
          address.phone,
          address.region,
          address.province,
          address.city,
          address.barangay,
          address.street,
          address.zip,
        ],
      );
      const orderId = (
        await connection.query("SELECT LAST_INSERT_ID() AS id")
      )[0][0].id;
      await connection.execute(
        "INSERT INTO order_status_history (order_id, status_label) VALUES (?, 'Order Placed')",
        [orderId],
      );

      for (const line of lines) {
        await connection.execute(
          "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
          [orderId, line.productId, line.quantity, line.price],
        );
        const [inventoryRows] = await connection.execute(
          "SELECT quantity_reserved FROM inventory WHERE product_id = ? FOR UPDATE",
          [line.productId],
        );
        const reservedBefore = Number(inventoryRows[0].quantity_reserved);
        const reservedAfter = reservedBefore + line.quantity;
        await connection.execute(
          "UPDATE inventory SET quantity_reserved = ? WHERE product_id = ?",
          [reservedAfter, line.productId],
        );
        await connection.execute(
          `
          INSERT INTO inventory_movements
            (product_id, movement_type, quantity_change, quantity_before, quantity_after,
             reference_type, reference_id, reason, created_by)
          VALUES (?, 'RESERVATION', ?, ?, ?, 'ORDER', ?, 'ShopHub demo order placed', ?)
        `,
          [
            line.productId,
            line.quantity,
            reservedBefore,
            reservedAfter,
            group.orderNumber,
            customerId,
          ],
        );
      }
      saved.push({ orderNumber: group.orderNumber, total });
    }

    await connection.commit();
    return { ok: true, orders: saved };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function cancelDemoOrder(orderNumber) {
  if (salesync.isConfigured()) return salesync.cancelOrder(orderNumber);
  if (process.env.ENABLE_DEMO_ORDERS !== "true") {
    throw Object.assign(new Error("Demo orders are disabled."), {
      status: 403,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [orders] = await connection.execute(
      "SELECT order_id, status FROM orders WHERE order_number = ? FOR UPDATE",
      [orderNumber],
    );
    const order = orders[0];
    if (!order) {
      throw Object.assign(new Error("The order was not found."), {
        status: 404,
      });
    }
    if (!["Pending", "Processing", "Packed"].includes(order.status)) {
      throw Object.assign(new Error("This order can no longer be cancelled."), {
        status: 409,
      });
    }

    const [lines] = await connection.execute(
      "SELECT product_id, quantity FROM order_items WHERE order_id = ?",
      [order.order_id],
    );
    for (const line of lines) {
      const [inventoryRows] = await connection.execute(
        "SELECT quantity_reserved FROM inventory WHERE product_id = ? FOR UPDATE",
        [line.product_id],
      );
      const before = Number(inventoryRows[0].quantity_reserved);
      const quantity = Number(line.quantity);
      if (before < quantity) {
        throw new Error("The order reservation does not match inventory.");
      }
      const after = before - quantity;
      await connection.execute(
        "UPDATE inventory SET quantity_reserved = ? WHERE product_id = ?",
        [after, line.product_id],
      );
      await connection.execute(
        `
        INSERT INTO inventory_movements
          (product_id, movement_type, quantity_change, quantity_before, quantity_after,
           reference_type, reference_id, reason)
        VALUES (?, 'RELEASE', ?, ?, ?, 'ORDER', ?, 'ShopHub demo order cancelled')
      `,
        [line.product_id, -quantity, before, after, orderNumber],
      );
    }
    await connection.execute(
      "UPDATE orders SET status = 'Cancelled' WHERE order_id = ?",
      [order.order_id],
    );
    await connection.execute(
      "INSERT INTO order_status_history (order_id, status_label) VALUES (?, 'Cancelled')",
      [order.order_id],
    );
    await connection.commit();
    return { ok: true, orderNumber, status: "Cancelled" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function completeDemoOrder(orderNumber) {
  if (!salesync.isConfigured()) {
    throw Object.assign(new Error("SaleSync is not configured."), {
      status: 503,
    });
  }
  return salesync.completeOrder(orderNumber);
}

module.exports = {
  health,
  catalog,
  createDemoOrders,
  cancelDemoOrder,
  completeDemoOrder,
  usesSaleSync: salesync.isConfigured,
  pool,
};
