"use strict";

const configuredUrl = (process.env.SALESYNC_API_URL || "").trim();
const apiKey = (process.env.SALESYNC_API_KEY || "").trim();

function isConfigured() {
  return Boolean(configuredUrl);
}

async function request(route, method = "GET", body) {
  if (!configuredUrl || !apiKey) {
    throw Object.assign(
      new Error("ShopHub to SaleSync is not configured on the server."),
      { status: 503 },
    );
  }
  const url = new URL(configuredUrl);
  url.searchParams.set("route", route);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "X-SaleSync-Key": apiKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw Object.assign(
      new Error(
        "ShopHub cannot reach SaleSync. Check its address and that SaleSync is running.",
      ),
      { status: 502 },
    );
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(result.error || "SaleSync rejected the request."),
      { status: response.status >= 500 ? 502 : response.status },
    );
  }
  return result;
}

async function catalog() {
  const data = await request("catalog");
  return {
    products: (data.products || []).map((product) => ({
      source: "salesync",
      product_id: Number(product.product_id),
      seller_id: String(product.seller_id || "salesync-store"),
      seller_email: product.seller_email || null,
      seller_name: product.seller_name || data.storeName || "SaleSync Store",
      category_id: Number(product.category_id),
      category_name: product.category_name,
      sku: product.sku,
      name: product.name,
      description: product.description || "",
      price: Number(product.price),
      original_price: Number(product.original_price || product.price),
      stock: Number(product.stock),
      image: product.image || "📦",
      status: "Active",
      rating_avg: Number(product.rating_avg || 0),
      review_count: Number(product.review_count || 0),
    })),
    categories: (data.categories || []).map((category) => ({
      name: category.name,
      icon: "📦",
    })),
  };
}

async function health() {
  return request("health");
}

function createProduct(input) {
  return request("products", "POST", input);
}

function placeOrders(input) {
  return request("orders", "POST", input);
}

function completeOrder(orderNumber) {
  return request(
    `orders/${encodeURIComponent(orderNumber)}/complete`,
    "POST",
    {},
  );
}

function cancelOrder(orderNumber) {
  return request(
    `orders/${encodeURIComponent(orderNumber)}/cancel`,
    "POST",
    {},
  );
}

module.exports = {
  isConfigured,
  health,
  catalog,
  createProduct,
  placeOrders,
  completeOrder,
  cancelOrder,
};
