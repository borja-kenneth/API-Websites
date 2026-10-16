/* Offline self-test: runs the server against a FAKE PayMongo. No network, no keys needed.  npm test */
"use strict";
const http = require("node:http"),
  crypto = require("node:crypto"),
  assert = require("node:assert");
let seen;
const fake = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    seen = {
      url: req.url,
      auth: req.headers.authorization,
      body: JSON.parse(b),
    };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data: {
          id: "cs_fake1",
          attributes: { checkout_url: "https://pay.example/cs_fake1" },
        },
      }),
    );
  });
});
fake.listen(0, async () => {
  process.env.PAYMONGO_API = "http://127.0.0.1:" + fake.address().port + "/v2";
  process.env.PAYMONGO_SECRET_KEY = "sk_test_abc";
  process.env.PAYMONGO_WEBHOOK_SECRET = "whsk_secret";
  process.env.SITE_URL = "http://shop.test";
  const s = require("./server.js");
  await new Promise((r) => s.server.listen(0, r));
  const base = "http://127.0.0.1:" + s.server.address().port;
  const post = (p, body, headers = {}) =>
    fetch(base + p, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const sign = (
    raw,
    t = Math.floor(Date.now() / 1000),
    secret = "whsk_secret",
  ) =>
    `t=${t},te=${crypto
      .createHmac("sha256", secret)
      .update(t + "." + raw)
      .digest("hex")},li=`;
  let pass = 0;
  const ok = (c, m) => {
    assert.ok(c, m);
    pass++;
    console.log("  ok -", m);
  };

  // 1. checkout: server prices the order itself (2 sellers => 2 x 50 shipping)
  let r = await post("/api/checkout", {
    ref: "ORD-10001",
    method: "GCash",
    items: [
      { id: "p1", qty: 1 },
      { id: "p5", qty: 2 },
    ],
    total: 1,
  });
  let j = await r.json();
  ok(
    r.status === 200 && j.checkoutUrl === "https://pay.example/cs_fake1",
    "creates checkout session, returns checkout_url",
  );
  ok(
    j.total === 7600,
    "ignores browser-supplied total; server total = 4500 + 3000 + 100 shipping",
  );
  ok(
    seen.url === "/v2/checkout_sessions" &&
      seen.auth === "Basic " + Buffer.from("sk_test_abc:").toString("base64"),
    "uses Basic auth with the secret key, on the server only",
  );
  const a = seen.body.data.attributes;
  ok(
    a.line_items[0].amount === 760000 &&
      a.line_items[0].currency === "PHP" &&
      a.payment_method_types[0] === "gcash" &&
      a.reference_number === "ORD-10001",
    "amount in centavos, method mapped, reference set",
  );
  r = await post("/api/checkout", {
    ref: "ORD-10002",
    method: "Bitcoin",
    items: [{ id: "p1", qty: 1 }],
  });
  ok(r.status === 400, "rejects unknown payment method");
  r = await post("/api/checkout", {
    ref: "ORD-10002",
    method: "GCash",
    items: [{ id: "nope", qty: 1 }],
  });
  ok(r.status === 400, "rejects unknown product");
  r = await post("/api/checkout", {
    ref: "ORD-10002",
    method: "GCash",
    items: [{ id: "p1", qty: -5 }],
  });
  ok(r.status === 400, "rejects negative quantity");

  // 2. webhook
  const evt = JSON.stringify({
    data: {
      attributes: {
        type: "checkout_session.payment.paid",
        livemode: false,
        data: { attributes: { reference_number: "ORD-10001" } },
      },
    },
  });
  r = await post("/webhooks/paymongo", evt);
  ok(r.status === 400, "webhook without signature rejected");
  r = await post("/webhooks/paymongo", evt, {
    "Paymongo-Signature": sign(evt, undefined, "wrong"),
  });
  ok(r.status === 400, "webhook with wrong secret rejected");
  r = await post("/webhooks/paymongo", evt, {
    "Paymongo-Signature": sign(evt, Math.floor(Date.now() / 1000) - 3600),
  });
  ok(r.status === 400, "old (replayed) webhook rejected");
  r = await post("/webhooks/paymongo", evt + " ", {
    "Paymongo-Signature": sign(evt),
  });
  ok(r.status === 400, "tampered body rejected");
  ok(
    (await (await fetch(base + "/api/orders/ORD-10001")).json()).status ===
      "pending",
    "still pending before a valid webhook",
  );
  r = await post("/webhooks/paymongo", evt, {
    "Paymongo-Signature": sign(evt),
  });
  ok(r.status === 200, "valid webhook accepted");
  ok(
    (await (await fetch(base + "/api/orders/ORD-10001")).json()).status ===
      "paid",
    "order marked paid",
  );
  r = await post("/webhooks/paymongo", evt, {
    "Paymongo-Signature": sign(evt),
  });
  ok(r.status === 200, "duplicate delivery handled (idempotent)");
  console.log(`\n${pass} checks passed`);
  s.server.close();
  fake.close();
});
