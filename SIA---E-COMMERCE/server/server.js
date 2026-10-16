/*
 * ShopHub - PayMongo integration example (zero dependencies, Node 20.6+).
 *
 * WHAT THIS IS
 *   The few server-side pieces the browser prototype cannot do safely:
 *     1. POST /api/checkout        create a PayMongo Checkout Session (secret key stays here)
 *     2. POST /webhooks/paymongo   receive + VERIFY payment events, then mark the order paid
 *     3. GET  /api/orders/:ref     let the page poll the order status after the customer returns
 *
 * WHAT THIS IS NOT
 *   A finished backend. Orders live in memory, the catalog is a stub, and voucher math is
 *   not ported. In production the same rules as js/app.js (totals(), vcheck(), finalize())
 *   must run on the server against a real database. NEVER trust prices sent by the browser.
 *
 * VERIFY BEFORE GOING LIVE
 *   Written from the PayMongo docs as of Oct 2026 (Hosted Checkout quick start, Webhooks).
 *   Endpoint versions, payment_method_types codes and the webhook payload shape can change:
 *   check https://docs.paymongo.com and run against TEST keys (sk_test_...) first.
 *
 * RUN
 *   cp .env.example .env   # then fill in the keys
 *   node --env-file=.env server.js
 */
"use strict";
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const database = require("./database");

const PORT = +process.env.PORT || 3000;
const SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || ""; // sk_test_... (server only!)
const WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || ""; // returned when you create the webhook
const API = process.env.PAYMONGO_API || "https://api.paymongo.com/v2"; // quick start currently shows /v2/checkout_sessions
const SITE = process.env.SITE_URL || "http://localhost:3000"; // where the customer returns to
const ALLOW_ORIGIN = process.env.ALLOWED_ORIGIN || SITE;
const FLAT_SHIPPING = 50; // PHP per seller shipment (same rule as the prototype)
const MAX_WEBHOOK_AGE_S = 300; // reject replayed events older than 5 minutes
const WEB_ROOT = path.resolve(__dirname, "..");

/* UI payment method -> PayMongo payment_method_types code (confirm against your dashboard) */
const METHOD = {
  GCash: "gcash",
  Maya: "paymaya",
  GrabPay: "grab_pay",
  "QR Ph": "qrph",
  "Online Banking": "dob",
  "Credit/Debit Card": "card",
};

/* Stub catalog + order store. Replace with your database. */
const CATALOG = {
  p1: {
    name: "Wireless Noise-Cancelling Headphones",
    price: 4500,
    seller: "u2",
  },
  p5: { name: "Classic White Canvas Sneakers", price: 1500, seller: "u6" },
};
const ORDERS = new Map(); // ref -> { ref, total, status:'pending'|'paid', checkoutId, paidAt }

const centavos = (php) => Math.round(php * 100);

/* ---------- 1. create a Checkout Session ---------- */
async function createCheckout({ ref, items, method, successUrl, cancelUrl }) {
  if (!METHOD[method])
    throw Object.assign(new Error("Unsupported payment method"), {
      status: 400,
    });
  if (!/^ORD-\d{4,}$/.test(ref || ""))
    throw Object.assign(new Error("Bad order reference"), { status: 400 });
  if (!Array.isArray(items) || !items.length)
    throw Object.assign(new Error("No items"), { status: 400 });
  let sub = 0;
  const sellers = new Set();
  for (const { id, qty } of items) {
    // price comes from OUR catalog, not the browser
    const p = CATALOG[id];
    const q = Number.isInteger(qty) && qty > 0 && qty <= 99 ? qty : 0;
    if (!p || !q)
      throw Object.assign(new Error("Unknown product or quantity"), {
        status: 400,
      });
    sub += p.price * q;
    sellers.add(p.seller);
  }
  const total = sub + FLAT_SHIPPING * sellers.size; // TODO port voucher rules from js/app.js totals()
  const body = {
    data: {
      attributes: {
        line_items: [
          {
            name: "ShopHub order " + ref,
            amount: centavos(total),
            currency: "PHP",
            quantity: 1,
          },
        ], // one line = final payable total
        payment_method_types: [METHOD[method]],
        reference_number: ref,
        success_url: SITE + "/?paid=" + encodeURIComponent(ref),
        cancel_url: SITE + "/?cancelled=" + encodeURIComponent(ref),
      },
    },
  };
  const res = await fetch(API + "/checkout_sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic " + Buffer.from(SECRET_KEY + ":").toString("base64"),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error("PayMongo rejected the request"), {
      status: 502,
      detail: json,
    });
  ORDERS.set(ref, { ref, total, status: "pending", checkoutId: json.data.id });
  return { checkoutUrl: json.data.attributes.checkout_url, total };
}

/* ---------- 2. verify a webhook ---------- */
/* Header:  Paymongo-Signature: t=<unix>,te=<test sig>,li=<live sig>
   Signed string: `${t}.${rawBody}`  HMAC-SHA256 with the webhook secret. Use the RAW body, not re-serialised JSON. */
function verifySignature(
  rawBody,
  header,
  secret = WEBHOOK_SECRET,
  now = Date.now() / 1000,
) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    String(header)
      .split(",")
      .map((kv) => {
        const i = kv.indexOf("=");
        return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
      }),
  );
  if (!parts.t || Math.abs(now - Number(parts.t)) > MAX_WEBHOOK_AGE_S)
    return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(parts.t + "." + rawBody)
    .digest("hex");
  return [parts.te, parts.li].some((sig) => {
    if (!sig || sig.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  });
}

function handleEvent(evt) {
  /* Payload shape: data.attributes.type = event name, data.attributes.data = the resource (confirm in the dashboard's webhook tester) */
  const a = evt && evt.data && evt.data.attributes;
  if (!a) return;
  if (a.type === "checkout_session.payment.paid") {
    const ref =
      a.data && a.data.attributes && a.data.attributes.reference_number;
    const o = ORDERS.get(ref);
    if (o && o.status !== "paid") {
      o.status = "paid";
      o.paidAt = new Date().toISOString();
      console.log("paid", ref);
    } // idempotent: events can repeat
    // TODO: create shipment records, notify seller, write to the payments ledger
  } else if (a.type === "payment.failed") {
    console.log("payment failed", a.data && a.data.id);
  }
  // other events worth handling: payment.refunded, payout.deposited, transfer.outward.successful / failed
}

/* ---------- tiny HTTP layer ---------- */
const readRaw = (req) =>
  new Promise((ok, no) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
      if (b.length > 1e6) {
        no(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => ok(b));
    req.on("error", no);
  });
const send = (res, code, obj) => {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(obj));
};

async function servePage(url, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  const requested = path.resolve(
    WEB_ROOT,
    `.${pathname === "/" ? "/index.html" : pathname}`,
  );
  if (requested !== WEB_ROOT && !requested.startsWith(WEB_ROOT + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  try {
    const content = await fs.promises.readFile(requested);
    res.writeHead(200, {
      "Content-Type":
        types[path.extname(requested).toLowerCase()] ||
        "application/octet-stream",
    });
    res.end(content);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, await database.health());
    }
    if (req.method === "GET" && url.pathname === "/api/catalog") {
      return send(res, 200, await database.catalog());
    }
    if (req.method === "GET" && url.pathname === "/api/integration/status") {
      return send(res, 200, { salesyncConfigured: database.usesSaleSync() });
    }
    if (req.method === "POST" && url.pathname === "/api/demo/orders") {
      const out = await database.createDemoOrders(
        JSON.parse((await readRaw(req)) || "{}"),
      );
      return send(res, 201, out);
    }
    const demoCancel = url.pathname.match(
      /^\/api\/demo\/orders\/(ORD-\d{4,})\/cancel$/,
    );
    if (req.method === "POST" && demoCancel) {
      const out = await database.cancelDemoOrder(demoCancel[1]);
      return send(res, 200, out);
    }
    const demoComplete = url.pathname.match(
      /^\/api\/demo\/orders\/(ORD-\d{4,})\/complete$/,
    );
    if (req.method === "POST" && demoComplete) {
      const out = await database.completeDemoOrder(demoComplete[1]);
      return send(res, 200, out);
    }
    if (req.method === "POST" && url.pathname === "/api/checkout") {
      const out = await createCheckout(
        JSON.parse((await readRaw(req)) || "{}"),
      );
      return send(res, 200, out);
    }
    if (req.method === "POST" && url.pathname === "/webhooks/paymongo") {
      const raw = await readRaw(req);
      if (!verifySignature(raw, req.headers["paymongo-signature"]))
        return send(res, 400, { error: "bad signature" });
      handleEvent(JSON.parse(raw));
      return send(res, 200, { received: true }); // 2xx + JSON tells PayMongo not to retry
    }
    const m = url.pathname.match(/^\/api\/orders\/(ORD-\d+)$/);
    if (req.method === "GET" && m) {
      const o = ORDERS.get(m[1]);
      return o
        ? send(res, 200, { ref: o.ref, status: o.status, total: o.total })
        : send(res, 404, { error: "not found" });
    }
    if (req.method === "GET") return await servePage(url, res);
    send(res, 404, { error: "not found" });
  } catch (e) {
    if (e.detail) console.error("PayMongo said:", JSON.stringify(e.detail));
    send(res, e.status || 500, {
      error:
        e.status && e.status < 500
          ? e.message
          : e.status === 502
            ? e.message
            : "server error",
    });
  }
});

if (require.main === module)
  server.listen(PORT, "0.0.0.0", () =>
    console.log(
      "ShopHub site and API on :" +
        PORT +
        (SECRET_KEY ? "" : "  (no PAYMONGO_SECRET_KEY set)"),
    ),
  );
module.exports = {
  server,
  verifySignature,
  createCheckout,
  ORDERS,
  handleEvent,
};
