/* MOCK DATABASE */
const TODAY = "2026-10-03",
  FLOW = [
    "Order Placed",
    "Payment Confirmed",
    "Processing",
    "Packed",
    "Shipped",
    "Out for Delivery",
    "Delivered",
  ];
const ST = [
    "Pending",
    "Processing",
    "Packed",
    "Shipped",
    "Out for Delivery",
    "Completed",
    "Cancelled",
    "Returned",
  ],
  LBL = { Pending: "Order Placed", Completed: "Delivered" };
const fmt = (n) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    n,
  );
const R2 = (n) => Math.round(n * 100) / 100,
  rid = () =>
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 8);
const okO = (o) => !["Cancelled", "Returned"].includes(o.status);
/* SHIPPING CONSTANTS: flat fee stays; regions only drive the estimated delivery window */
const REGION_GROUP = {
  NCR: "NCR",
  CAR: "Luzon",
  "Region I - Ilocos": "Luzon",
  "Region II - Cagayan Valley": "Luzon",
  "Region III - Central Luzon": "Luzon",
  "Region IV-A - Calabarzon": "Luzon",
  MIMAROPA: "Luzon",
  "Region V - Bicol": "Luzon",
  "Region VI - Western Visayas": "Visayas",
  "Region VII - Central Visayas": "Visayas",
  "Region VIII - Eastern Visayas": "Visayas",
  "Region IX - Zamboanga Peninsula": "Mindanao",
  "Region X - Northern Mindanao": "Mindanao",
  "Region XI - Davao": "Mindanao",
  "Region XII - Soccsksargen": "Mindanao",
  "Region XIII - Caraga": "Mindanao",
  BARMM: "Mindanao",
};
const ETA_DAYS = {
  NCR: [2, 4],
  Luzon: [3, 5],
  Visayas: [4, 7],
  Mindanao: [5, 8],
};
const igroup = (r) => REGION_GROUP[r] || "Luzon";
const addD = (d, n) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const etaRange = (region, from) => {
  const [a, b] = ETA_DAYS[igroup(region)];
  return [addD(from, a), addD(from, b)];
};
const MAX_ATTEMPTS = 3;
/* PAYMENT CONSTANTS */
const METHODS = [
  "Cash on Delivery",
  "GCash",
  "Maya",
  "GrabPay",
  "QR Ph",
  "Online Banking",
  "Credit/Debit Card",
];
const ICON = {
  "Cash on Delivery": "fa-money-bill-wave",
  GCash: "fa-wallet",
  Maya: "fa-wallet",
  GrabPay: "fa-wallet",
  "QR Ph": "fa-qrcode",
  "Online Banking": "fa-building-columns",
  "Credit/Debit Card": "fa-credit-card",
};
const SEEDADDR = {
  u1: {
    name: "Jessica Mae",
    phone: "0912 345 6789",
    region: "NCR",
    province: "Metro Manila",
    city: "Makati",
    barangay: "Bel-Air",
    street: "123 Ayala Ave",
    zip: "1209",
  },
  u4: {
    name: "Mark Reyes",
    phone: "0915 777 8888",
    region: "Region III - Central Luzon",
    province: "Pampanga",
    city: "Angeles",
    barangay: "Balibago",
    street: "8 Fil-Am Friendship Hwy",
    zip: "2009",
  },
  u7: {
    name: "Carla Dizon",
    phone: "0917 222 3333",
    region: "Region IV-A - Calabarzon",
    province: "Cavite",
    city: "Dasmarinas",
    barangay: "Salitran",
    street: "45 Mabini St",
    zip: "4114",
  },
};
const mockDB = {
  users: [
    {
      id: "u1",
      name: "Jessica Mae",
      role: "customer",
      email: "customer@shophub.com",
      status: "Active",
      registered: "2025-01-15",
    },
    {
      id: "u2",
      name: "Demo Seller",
      role: "seller",
      email: "seller@shophub.com",
      storeName: "TechHub PH",
      status: "Active",
      registered: "2024-11-20",
      phone: "0917 111 2222",
      desc: "Gadgets and home tech.",
    },
    {
      id: "u3",
      name: "System Administrator",
      role: "admin",
      email: "admin@shophub.com",
      status: "Active",
      registered: "2024-01-01",
    },
    {
      id: "u4",
      name: "Mark Reyes",
      role: "customer",
      email: "mark@mail.com",
      status: "Suspended",
      registered: "2026-05-10",
    },
    {
      id: "u5",
      name: "Ana Cruz",
      role: "seller",
      email: "pending@shophub.com",
      storeName: "Fresh Kicks",
      status: "Pending",
      registered: "2026-10-01",
      phone: "0918 333 4444",
      desc: "Sneaker reseller.",
    },
    {
      id: "u6",
      name: "Leo Santos",
      role: "seller",
      email: "leo@mail.com",
      storeName: "StyleHub",
      status: "Active",
      registered: "2025-06-02",
      phone: "0920 555 6666",
      desc: "Fashion, sports and home.",
    },
    {
      id: "u7",
      name: "Carla Dizon",
      role: "customer",
      email: "carla@mail.com",
      status: "Active",
      registered: "2026-02-18",
    },
  ],
  categories: [
    "Electronics",
    "Fashion",
    "Home & Living",
    "Beauty",
    "Sports",
    "Accessories",
  ],
  products: [
    [
      "p1",
      "Wireless Noise-Cancelling Headphones",
      "Electronics",
      4500,
      5000,
      24,
      4.8,
      124,
      "🎧",
      "u2",
    ],
    [
      "p2",
      "Mechanical Gaming Keyboard RGB",
      "Electronics",
      2200,
      2200,
      15,
      4.5,
      89,
      "⌨️",
      "u2",
    ],
    [
      "p3",
      "Smart Fitness Watch Series 5",
      "Electronics",
      3100,
      3500,
      0,
      4.2,
      56,
      "⌚",
      "u2",
    ],
    [
      "p4",
      "Minimalist Wooden Coffee Table",
      "Home & Living",
      1850,
      1850,
      5,
      4.6,
      34,
      "🪑",
      "u6",
    ],
    [
      "p5",
      "Classic White Canvas Sneakers",
      "Fashion",
      1500,
      1500,
      50,
      4.9,
      210,
      "👟",
      "u6",
    ],
    [
      "p6",
      "Professional DSLR Camera",
      "Electronics",
      35000,
      38000,
      3,
      4.7,
      45,
      "📷",
      "u2",
    ],
    ["p7", "Denim Jacket", "Fashion", 1299, 1599, 30, 4.4, 77, "🧥", "u6"],
    [
      "p8",
      "Hydrating Face Serum",
      "Beauty",
      650,
      800,
      60,
      4.7,
      143,
      "🧴",
      "u6",
    ],
    ["p9", "Yoga Mat Pro", "Sports", 899, 899, 40, 4.6, 98, "🧘", "u6"],
    ["p10", "Leather Wallet", "Accessories", 799, 999, 25, 4.5, 61, "👛", "u6"],
    [
      "p11",
      "Aroma Diffuser",
      "Home & Living",
      1250,
      1450,
      18,
      4.3,
      52,
      "🕯️",
      "u2",
    ],
    ["p12", "Running Shoes", "Sports", 2800, 3200, 8, 4.8, 175, "🏃", "u6"],
  ].map(
    ([
      id,
      name,
      category,
      price,
      orig,
      stock,
      rating,
      reviews,
      img,
      sellerId,
    ]) => ({
      id,
      name,
      category,
      price,
      orig,
      stock,
      rating,
      reviews,
      img,
      sellerId,
      sku: "SKU-" + id.toUpperCase(),
      status: "Active",
      desc:
        "Quality " +
        name.toLowerCase() +
        " from a verified ShopHub seller. 7-day return policy.",
    }),
  ),
  orders: [],
  vouchers: [
    {
      code: "SHOP10",
      type: "percent",
      value: 10,
      min: 0,
      cap: 200,
      expiry: "2026-10-31",
      status: "Active",
      uses: 12,
      limit: 500,
      perUser: 3,
    },
    {
      code: "WELCOME100",
      type: "fixed",
      value: 100,
      min: 500,
      expiry: "2026-12-31",
      status: "Active",
      uses: 30,
      limit: 200,
      perUser: 1,
    },
    {
      code: "FREESHIP",
      type: "shipping",
      value: 0,
      min: 300,
      cap: 50,
      expiry: "2026-12-31",
      status: "Active",
      uses: 8,
      limit: 300,
      perUser: 5,
    },
    {
      code: "SHIP30",
      type: "shipping",
      value: 0,
      min: 200,
      cap: 30,
      expiry: "2026-12-31",
      status: "Active",
      uses: 2,
      limit: 300,
      perUser: 5,
    },
    {
      code: "NEWUSER",
      type: "fixed",
      value: 150,
      min: 500,
      expiry: "2026-12-31",
      status: "Active",
      uses: 0,
      limit: 1000,
      perUser: 1,
      firstOrder: true,
    },
    {
      code: "TECH15",
      type: "percent",
      value: 15,
      min: 1000,
      cap: 500,
      expiry: "2026-11-30",
      category: "Electronics",
      status: "Active",
      uses: 5,
      limit: 100,
      perUser: 2,
    },
    {
      code: "STYLE50",
      type: "fixed",
      value: 50,
      min: 500,
      expiry: "2026-11-15",
      seller: "u6",
      status: "Active",
      uses: 3,
      limit: 50,
      perUser: 1,
    },
    {
      code: "TECHSHIP",
      type: "shipping",
      value: 0,
      min: 1500,
      cap: 50,
      expiry: "2026-12-15",
      seller: "u2",
      status: "Active",
      uses: 1,
      limit: 100,
      perUser: 2,
    },
    {
      code: "OLD20",
      type: "percent",
      value: 20,
      min: 0,
      expiry: "2026-09-01",
      status: "Active",
      uses: 40,
    },
  ],
  notifications: [
    {
      id: 1,
      userId: "u1",
      title: "Order Delivered",
      desc: "Your order ORD-9821 was delivered.",
      read: false,
      type: "order",
      date: "2026-10-01",
    },
    {
      id: 2,
      userId: "u1",
      title: "Voucher available",
      desc: "Use WELCOME100 for ₱100 off.",
      read: true,
      type: "promo",
      date: "2026-09-20",
    },
    {
      id: 3,
      userId: "u1",
      title: "Wishlist item discounted",
      desc: "Mechanical Keyboard is on sale.",
      read: false,
      type: "promo",
      date: "2026-09-30",
    },
    {
      id: 4,
      userId: "u2",
      title: "New order",
      desc: "Order ORD-9990 needs processing.",
      read: false,
      type: "order",
      date: "2026-10-01",
    },
    {
      id: 5,
      userId: "u3",
      title: "Seller application",
      desc: "Fresh Kicks is awaiting approval.",
      read: false,
      type: "info",
      date: "2026-10-01",
    },
  ],
  reviews: [
    {
      id: "r1",
      productId: "p1",
      customerId: "u1",
      rating: 5,
      text: "Amazing sound and battery life!",
      date: "2026-10-02",
      reply: "Thank you, Jessica!",
    },
    {
      id: "r2",
      productId: "p5",
      customerId: "u7",
      rating: 5,
      text: "Very comfortable.",
      date: "2026-09-18",
    },
    {
      id: "r3",
      productId: "p2",
      customerId: "u1",
      rating: 4,
      text: "Clicky and solid.",
      date: "2026-08-20",
    },
  ],
  reports: [
    {
      id: "RPT-101",
      reporter: "Jessica Mae",
      target: "Product: Smart Fitness Watch",
      reason: "Misleading description",
      date: "2026-10-01",
      status: "Open",
    },
    {
      id: "RPT-102",
      reporter: "Carla Dizon",
      target: "Seller: StyleHub",
      reason: "Late delivery",
      date: "2026-09-29",
      status: "Open",
    },
  ],
  auditLogs: [
    {
      time: "2026-10-01 09:00",
      user: "System Administrator",
      role: "admin",
      action: "Approved Seller",
      target: "StyleHub",
      prev: "Pending",
      next: "Active",
    },
  ],
  couriers: [
    { name: "J&T Express", prefix: "JT", enabled: true },
    { name: "LBC Express", prefix: "LB", enabled: true },
    { name: "Flash Express", prefix: "FE", enabled: true },
    { name: "Ninja Van", prefix: "NV", enabled: true },
  ],
  linked: [
    {
      id: "la1",
      userId: "u1",
      kind: "ewallet",
      provider: "GCash",
      holder: "Jessica Mae",
      last4: "6789",
      def: true,
      date: "2026-01-20",
    },
    {
      id: "la2",
      userId: "u2",
      kind: "bank",
      provider: "BPI",
      holder: "TechHub PH",
      last4: "4321",
      def: true,
      date: "2025-02-11",
    },
    {
      id: "la3",
      userId: "u6",
      kind: "ewallet",
      provider: "Maya",
      holder: "Leo Santos",
      last4: "6666",
      def: true,
      date: "2025-06-10",
    },
  ],
  payouts: [],
  payEvents: [],
  redemptions: [],
};
mockDB.products.forEach(
  (p) =>
    (p.sellerName = mockDB.users.find((u) => u.id === p.sellerId).storeName),
);
const P = (id) => mockDB.products.find((p) => p.id === id),
  U = (id) => mockDB.users.find((u) => u.id === id);
const seedShip = (o) => {
  const cs = mockDB.couriers,
    c = cs[parseInt(o.id.slice(-1)) % cs.length],
    ev = [
      "Shipment booked with " + c.name,
      "Picked up from " + U(o.sellerId).storeName,
    ];
  if (["Out for Delivery", "Completed"].includes(o.status))
    ev.push(
      "Arrived at sorting hub",
      "Arrived at " + o.addr.city + " delivery hub",
      "Out for delivery (attempt 1 of 3)",
    );
  if (o.status === "Completed") ev.push("Delivered to recipient");
  return {
    courier: c.name,
    tracking: c.prefix + ("55" + o.id.slice(4) + "0000000000").slice(0, 10),
    weight: 1,
    note: "",
    attempts: 0,
    eta: etaRange(o.addr.region, o.date),
    events: ev.map((t, i) => ({
      time:
        addD(o.date, 1 + Math.floor(i / 3)) +
        " " +
        String(9 + i * 2).padStart(2, "0") +
        ":15",
      text: t,
    })),
  };
};
const mkOrder = (id, c, items, st, date, pay) => {
  const its = items.map(([productId, qty]) => ({
      productId,
      qty,
      price: P(productId).price,
    })),
    sub = its.reduce((a, i) => a + i.price * i.qty, 0),
    tl = ["Order Placed", "Payment Confirmed"];
  if (st === "Cancelled") tl.push("Cancelled");
  else ST.slice(1, ST.indexOf(st) + 1).forEach((x) => tl.push(LBL[x] || x));
  const cod = pay === "Cash on Delivery",
    o = {
      id,
      customerId: c,
      sellerId: P(items[0][0]).sellerId,
      items: its,
      sub,
      ship: 50,
      shipDisc: 0,
      disc: 0,
      sellerFunded: 0,
      commission: Math.round(sub * 5) / 100,
      vouchers: [],
      total: sub + 50,
      status: st,
      date,
      pay,
      payStatus: cod && st !== "Completed" ? "Unpaid" : "Paid",
      payRef: cod ? null : "pi_seed" + id.slice(4),
      addr: { ...SEEDADDR[c] },
      timeline: tl.map((status, i) => ({
        status,
        time: date + " " + String(9 + i).padStart(2, "0") + ":00",
      })),
    };
  if (st === "Cancelled" && !cod) o.payStatus = "Refunded";
  o.payout = R2(sub - o.commission);
  if (["Shipped", "Out for Delivery", "Completed"].includes(st))
    o.shp = seedShip(o);
  if (cod && st === "Completed") o.codCollected = true;
  return o;
};
mockDB.orders = [
  mkOrder("ORD-9990", "u1", [["p1", 1]], "Shipped", "2026-10-01", "GCash"),
  mkOrder(
    "ORD-9943",
    "u1",
    [["p5", 2]],
    "Processing",
    "2026-10-02",
    "Cash on Delivery",
  ),
  mkOrder("ORD-9821", "u1", [["p1", 1]], "Completed", "2026-09-28", "GCash"),
  mkOrder(
    "ORD-9700",
    "u1",
    [["p2", 1]],
    "Completed",
    "2026-08-15",
    "Credit/Debit Card",
  ),
  mkOrder(
    "ORD-9650",
    "u1",
    [["p4", 1]],
    "Completed",
    "2026-07-04",
    "Cash on Delivery",
  ),
  mkOrder("ORD-9555", "u4", [["p6", 1]], "Cancelled", "2026-06-20", "GCash"),
  mkOrder(
    "ORD-9500",
    "u7",
    [
      ["p7", 1],
      ["p9", 1],
    ],
    "Completed",
    "2026-05-12",
    "Online Banking",
  ),
  mkOrder("ORD-9401", "u7", [["p8", 2]], "Pending", "2026-10-02", "GCash"),
  mkOrder("ORD-9300", "u1", [["p12", 1]], "Completed", "2026-04-09", "GCash"),
  mkOrder(
    "ORD-9210",
    "u7",
    [["p11", 1]],
    "Packed",
    "2026-10-01",
    "Cash on Delivery",
  ),
];
(() => {
  const o = mockDB.orders.find((x) => x.id === "ORD-9300");
  o.payoutId = "PO-1001";
  mockDB.payouts.push({
    id: "PO-1001",
    sellerId: "u6",
    amount: o.payout,
    orderIds: [o.id],
    acctId: "la3",
    status: "Paid",
    requested: "2026-04-20",
    processed: "2026-04-22",
    ref: "trf_seed1001",
  });
  mockDB.orders
    .filter((x) => x.payRef)
    .forEach((x) => {
      mockDB.payEvents.push({
        time: x.date + " 09:00",
        type: "payment.paid",
        ref: x.payRef,
        amount: x.total,
        method: x.pay,
      });
      if (x.payStatus === "Refunded")
        mockDB.payEvents.push({
          time: x.date + " 12:00",
          type: "refund.created",
          ref: x.payRef,
          amount: x.total,
          method: x.pay,
        });
    });
})();
