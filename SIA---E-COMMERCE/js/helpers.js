/* UTILITY FUNCTIONS */
const $ = (id) => document.getElementById(id),
  J = (a, f) => a.map(f).join(""),
  me = () => app.currentUser.id;
const esc = (s) =>
  String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
/* jq(): safely embed any string inside an inline onclick="..." handler */
const jq = (s) => esc(JSON.stringify(String(s)));
const live = () =>
  mockDB.products.filter(
    (p) => p.status === "Active" && U(p.sellerId).status === "Active",
  );
const badge = (s) => {
  const c =
    {
      Completed: "green",
      Active: "green",
      Resolved: "green",
      Cancelled: "red",
      Suspended: "red",
      Rejected: "red",
      Flagged: "red",
      Removed: "red",
      Dismissed: "gray",
      Archived: "gray",
      Draft: "gray",
      Pending: "yellow",
      Open: "yellow",
      "Low Stock": "yellow",
      "Out of Stock": "red",
      "In Stock": "green",
      Unpaid: "yellow",
      Paid: "green",
      Refunded: "gray",
      Requested: "yellow",
      Returned: "red",
      Failed: "red",
      Expired: "red",
      Disabled: "gray",
    }[s] || "blue";
  return `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-${c}-100 text-${c}-700">${s}</span>`;
};
const productImage = (p, classes = "") => {
  const image = String((p && p.img) || "📦");
  return /^(https?:\/\/|\/|data:image\/)/i.test(image)
    ? `<img src="${esc(image)}" alt="${esc(p.name)}" class="${esc(classes || "h-10 w-10 object-contain inline-block align-middle")}" loading="lazy">`
    : esc(image);
};
const h = (t) => `<h2 class="text-2xl font-bold mb-4">${t}</h2>`;
const empty = (i, t) =>
  `<div class="c p-12 text-center text-gray-500"><i class="fa-solid ${i} text-4xl text-gray-300 mb-3"></i><p>${t}</p></div>`;
const stat = (t, v, go) =>
  `<div class="c p-4 ${go ? "cursor-pointer hover:shadow-md" : ""}" ${go ? `onclick="app.navigate('${go}')"` : ""}><p class="text-xs text-gray-500">${t}</p><p class="text-xl font-bold">${v}</p></div>`;
const grid = (n, x) =>
  `<div class="grid grid-cols-2 lg:grid-cols-${n} gap-3 mb-6">${x}</div>`;
const bars = (o, money) => {
  const m = Math.max(1, ...Object.values(o));
  return Object.keys(o).length
    ? J(
        Object.entries(o),
        ([k, v]) =>
          `<div class="mb-2"><div class="flex justify-between text-xs"><span>${k}</span><b>${money ? fmt(v) : v}</b></div><div class="bg-gray-100 rounded h-2"><div class="bg-primary h-2 rounded" style="width:${(v / m) * 100}%"></div></div></div>`,
      )
    : '<p class="text-sm text-gray-500">No data for the selected period.</p>';
};
const tbl = (title, heads, rows, btn = "", msg = "No records found.") =>
  `<div class="flex justify-between items-center mb-4"><h2 class="text-2xl font-bold">${title}</h2>${btn}</div><div class="c overflow-x-auto"><table class="w-full text-sm whitespace-nowrap"><thead><tr>${J(heads, (x) => `<th>${x}</th>`)}</tr></thead><tbody>${rows.length ? J(rows, (r) => `<tr class="hover:bg-gray-50">${J(r, (x) => `<td>${x}</td>`)}</tr>`) : `<tr><td colspan="${heads.length}" class="text-center text-gray-500 py-10">${msg}</td></tr>`}</tbody></table></div>`;
const sum = (t) => {
  const m = app.vmsg;
  app.vmsg = "";
  const L = (a, b, c = "") =>
    `<div class="flex justify-between ${c}"><span>${a}</span><b>${b}</b></div>`;
  return (
    (m
      ? `<p class="text-xs bg-yellow-50 border border-yellow-200 text-yellow-800 p-2 rounded mb-2" role="status">${esc(m)}</p>`
      : "") +
    `<div class="text-sm space-y-2">${L("Subtotal", fmt(t.sub))}${L("Shipping" + (t.n > 1 ? " (" + t.n + " shipments)" : ""), fmt(t.shipping))}${t.shipDisc ? L("Shipping discount", "-" + fmt(t.shipDisc), "text-green-600") : ""}${t.vlines && t.vlines.length ? J(t.vlines, (v) => L("Voucher " + esc(v[0]), "-" + fmt(v[1]), "text-green-600")) : t.discount ? L("Discount", "-" + fmt(t.discount), "text-green-600") : ""}<div class="flex justify-between text-lg border-t pt-2"><span>Total</span><b class="text-primary">${fmt(t.total)}</b></div></div>`
  );
};
const otot = (o) => ({
  sub: o.sub,
  shipping: o.ship,
  shipDisc: o.shipDisc || 0,
  discount: o.disc || 0,
  vlines: (o.vouchers || [])
    .filter((v) => v.item > 0)
    .map((v) => [v.code + " (" + v.scope + ")", v.item]),
  total: o.total,
  n: 1,
});
const addrLine = (a) =>
  a && a.street
    ? [a.street, a.barangay, a.city, a.province, a.region, a.zip]
        .filter(Boolean)
        .map(esc)
        .join(", ")
    : "-";
const vchips = () => {
  const a = [];
  if (app.activeVoucher) a.push([app.activeVoucher, ""]);
  Object.entries(app.shopV).forEach(([sid, v]) => a.push([v, sid]));
  return a.length
    ? `<div class="flex flex-wrap gap-2 mt-3">${J(a, ([v, sid]) => `<span class="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-bold px-2 py-1 rounded-full"><i class="fa-solid fa-ticket"></i> ${v.code} <span class="font-normal">(${v.seller ? esc(U(v.seller).storeName) : "Platform"})</span><button aria-label="Remove voucher ${v.code}" onclick="app.removeVoucher('${sid}')">&times;</button></span>`)}</div>`
    : "";
};
const kindOf = (p) =>
  ["GCash", "Maya", "GrabPay", "ShopeePay"].includes(p)
    ? "ewallet"
    : p === "Credit/Debit Card"
      ? "card"
      : "bank";
const acctLabel = (a) =>
  a ? a.provider + " •••• " + a.last4 : "(removed account)";
const acctTable = (title, list) =>
  tbl(
    title,
    ["Type", "Provider", "Account", "Holder", "Default", "Linked on", ""],
    list.map((x) => [
      { ewallet: "E-wallet", bank: "Bank", card: "Card" }[x.kind],
      esc(x.provider),
      "•••• " + x.last4,
      esc(x.holder),
      x.def
        ? badge("Active").replace("Active", "Default")
        : `<button class="text-primary text-xs" onclick="app.setDef('${x.id}')">Make default</button>`,
      x.date,
      `<button class="text-red-500 text-xs" onclick="app.unlink('${x.id}')">Remove</button>`,
    ]),
    `<button class="b" onclick="app.linkForm()"><i class="fa-solid fa-link"></i> Link account</button>`,
    "No accounts linked yet.",
  );
const payState = (o) => {
  if (!okO(o)) return "Void";
  if (o.payoutId) {
    const p = mockDB.payouts.find((x) => x.id === o.payoutId);
    return p && p.status === "Paid" ? "Paid out" : "In payout " + o.payoutId;
  }
  if (o.status !== "Completed") return "Held until delivered";
  if (o.pay === "Cash on Delivery" && !o.codRemitted)
    return "Awaiting COD remittance";
  return "Available";
};
const qrSvg = (seed) => {
  let x = 0;
  for (const c of seed) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  const r = () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296,
    n = 21;
  let d = "";
  for (let y = 0; y < n; y++)
    for (let i = 0; i < n; i++) {
      const f = (i < 8 && y < 8) || (i > 12 && y < 8) || (i < 8 && y > 12);
      if (!f && r() > 0.5)
        d += `<rect x="${i}" y="${y}" width="1" height="1"/>`;
    }
  const fp = (a, b) =>
    `<rect x="${a}" y="${b}" width="7" height="7"/><rect x="${a + 1}" y="${b + 1}" width="5" height="5" fill="#fff"/><rect x="${a + 2}" y="${b + 2}" width="3" height="3"/>`;
  return `<svg viewBox="-1 -1 23 23" class="w-40 h-40 mx-auto bg-white border p-1 my-2" role="img" aria-label="Simulated QR Ph code">${d}${fp(0, 0)}${fp(14, 0)}${fp(0, 14)}</svg>`;
};
const card = (p) => {
  const d = p.orig > p.price ? Math.round((1 - p.price / p.orig) * 100) : 0;
  return `<div class="c p-3 flex flex-col"><div onclick="app.navigate('product',{id:'${p.id}'})" class="relative text-6xl text-center py-6 bg-gray-50 rounded-lg cursor-pointer">${productImage(p, "h-16 w-16 object-contain mx-auto")}${d ? `<span class="absolute top-1 right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 rounded">-${d}%</span>` : ""}<span class="absolute top-1 left-1 text-[10px]">${p.stock == 0 ? badge("Out of Stock") : p.stock < 10 ? badge("Low Stock") : ""}</span></div><p class="text-xs text-gray-500 mt-2">${p.category} · ${p.sellerName}</p><h3 class="font-semibold text-sm">${p.name}</h3><p class="text-xs text-gray-500">★ ${p.rating} · ${p.reviews} reviews</p><p class="font-bold text-primary mt-auto pt-1">${fmt(p.price)} ${d ? `<s class="text-xs text-gray-400 font-normal">${fmt(p.orig)}</s>` : ""}</p><div class="flex gap-1 mt-2"><button class="b flex-1 text-sm" ${p.stock ? "" : 'disabled style="opacity:.5"'} onclick="app.addToCart('${p.id}')">Add to Cart</button><button class="g" aria-label="Wishlist" onclick="app.toggleWishlist('${p.id}')"><i class="fa-solid fa-heart ${app.wishlist.includes(p.id) ? "text-red-500" : ""}"></i></button><button class="g" aria-label="Compare" onclick="app.toggleCompare('${p.id}')"><i class="fa-solid fa-code-compare ${app.compareList.includes(p.id) ? "text-primary" : ""}"></i></button></div><button class="text-primary text-xs mt-2" onclick="app.navigate('product',{id:'${p.id}'})">View Details</button></div>`;
};
const cards = (l) =>
  l.length
    ? `<div class="grid grid-cols-2 md:grid-cols-4 gap-4">${J(l, card)}</div>`
    : '<p class="text-sm text-gray-500">Nothing to show yet.</p>';
const PUB = [
    "login",
    "signup",
    "home",
    "catalog",
    "product",
    "categories",
    "sellers",
    "track",
  ],
  CUS = [
    "dashboard",
    "cart",
    "wishlist",
    "compare",
    "checkout",
    "receipt",
    "orders",
    "tracking",
    "notifications",
    "recs",
    "vouchers",
    "wallet",
  ];
const SEL = [
    "s-dash",
    "s-products",
    "s-inventory",
    "s-orders",
    "s-vouchers",
    "s-payouts",
    "s-feedback",
    "s-store",
  ],
  ADM = [
    "a-dash",
    "a-customers",
    "a-sellers",
    "a-approval",
    "a-products",
    "a-categories",
    "a-orders",
    "a-shipping",
    "a-payments",
    "a-vouchers",
    "a-reports",
    "a-audit",
    "a-settings",
  ];
const HOME = { customer: "home", seller: "s-dash", admin: "a-dash" };
const MENU = {
  seller: [
    ["s-dash", "Dashboard", "fa-chart-pie"],
    ["s-products", "Products", "fa-box"],
    ["s-inventory", "Inventory", "fa-warehouse"],
    ["s-orders", "Orders & Shipping", "fa-clipboard-list"],
    ["s-vouchers", "Shop Vouchers", "fa-ticket"],
    ["s-payouts", "Payouts & Bank", "fa-money-bill-transfer"],
    ["s-feedback", "Customer Feedback", "fa-star"],
    ["s-store", "Store Profile", "fa-store"],
  ],
  admin: [
    ["a-dash", "Dashboard", "fa-gauge"],
    ["a-customers", "Customers", "fa-users"],
    ["a-sellers", "Sellers", "fa-shop"],
    ["a-approval", "Seller Approval", "fa-clipboard-check"],
    ["a-products", "Products", "fa-boxes-stacked"],
    ["a-categories", "Categories", "fa-list"],
    ["a-orders", "Orders", "fa-truck-fast"],
    ["a-shipping", "Shipping", "fa-truck"],
    ["a-payments", "Payments & Payouts", "fa-money-check-dollar"],
    ["a-vouchers", "Vouchers", "fa-ticket"],
    ["a-reports", "Reports / Complaints", "fa-flag"],
    ["a-audit", "Audit Logs", "fa-shield-halved"],
    ["a-settings", "Settings", "fa-gear"],
  ],
};
