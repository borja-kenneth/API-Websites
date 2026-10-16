/* PUBLIC PAGES */
const pwField = (id, l, v = "") =>
  `<div><label for="${id}" class="block text-sm font-medium">${l}</label><div class="relative mt-1"><input id="${id}" type="password" class="i pr-10" value="${v}" autocomplete="off"><button type="button" aria-label="Show password" onclick="app.togglePw('${id}',this)" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-primary"><i class="fa-solid fa-eye"></i></button></div></div>`;
const R = {};
R.login =
  () => `<div class="max-w-md mx-auto c p-8 mt-4"><h1 class="text-3xl font-bold text-primary text-center mb-1"><i class="fa-solid fa-store"></i> ShopHub</h1><p class="text-center text-gray-500 text-sm mb-5">Sign in to your account</p>
<form onsubmit="event.preventDefault();app.loginForm()" class="space-y-3"><label class="block text-sm font-medium">Email<input id="em" type="email" class="i mt-1" value="customer@shophub.com"></label>${pwField("pw", "Password", "password123")}<p id="lerr" class="text-red-600 text-sm"></p>
<div class="flex justify-between text-sm"><label><input type="checkbox"> Remember me</label><a href="#" class="text-primary" onclick="app.modal('Reset Password','A reset link was sent to your email (simulated).');return false">Forgot password?</a></div><button class="b w-full">Login</button></form><p class="text-center text-sm mt-3">New customer? <a href="#" class="text-primary font-semibold" onclick="app.navigate('signup');return false">Sign Up</a></p>
<p class="text-center text-xs text-gray-400 my-4">Login as (demo accounts)</p><div class="grid gap-2"><button class="g" onclick="app.login('customer@shophub.com')"><i class="fa-solid fa-user"></i> Login as Customer</button><button class="g" onclick="app.login('seller@shophub.com')"><i class="fa-solid fa-shop"></i> Login as Seller</button><button class="g" onclick="app.login('admin@shophub.com')"><i class="fa-solid fa-shield-halved"></i> Login as Admin</button>
<button class="text-xs text-gray-500" onclick="app.modal('Reset Demo Data','Reload the page to restore all demo data?',()=>location.reload(),'Reset')">Reset demo data</button></div>
<p class="text-xs text-gray-400 mt-3">Other demo logins: mark@mail.com (suspended), pending@shophub.com (pending seller). Sign up a new account to try the NEWUSER first-order voucher.</p></div>`;
R.signup =
  () => `<div class="max-w-md mx-auto c p-8 mt-4"><h1 class="text-2xl font-bold text-primary text-center mb-1"><i class="fa-solid fa-store"></i> Create your account</h1><p class="text-center text-gray-500 text-sm mb-5">Sign up as a ShopHub customer</p>
<form onsubmit="event.preventDefault();app.signup()" class="space-y-3"><label class="block text-sm font-medium">Full name<input id="sn" class="i mt-1" autocomplete="name"></label><label class="block text-sm font-medium">Email<input id="se" type="email" class="i mt-1" autocomplete="email"></label><label class="block text-sm font-medium">Phone (optional)<input id="sp" class="i mt-1"></label>${pwField("spw", "Password (min. 8 characters)")}${pwField("spc", "Confirm password")}<p id="sperr" class="text-red-600 text-sm" role="alert"></p><button class="b w-full">Sign Up</button></form>
<p class="text-center text-sm mt-4">Already have an account? <a href="#" class="text-primary font-semibold" onclick="app.navigate('login');return false">Login</a></p></div>`;
R.home =
  () => `<div class="bg-gradient-to-r from-blue-700 to-indigo-800 text-white rounded-2xl p-10 mb-8"><span class="text-xs font-bold uppercase bg-blue-500 px-3 py-1 rounded-full">Grand Sale</span><h2 class="text-4xl font-bold my-3">Discover the best products online</h2><p class="mb-5 text-blue-100">Verified Philippine sellers. Use SHOP10 for 10% off.</p><button class="bg-white text-primary font-bold px-6 py-2 rounded-full" onclick="app.navigate('catalog')">Browse Products</button></div>
<h3 class="text-xl font-bold mb-3">Categories</h3><div class="grid grid-cols-2 md:grid-cols-6 gap-3 mb-8">${J(mockDB.categories, (c) => `<button class="c p-4 text-center hover:shadow-md font-medium text-sm" onclick="app.cat=${jq(c)};app.q='';app.navigate('catalog')">${c}</button>`)}</div>
<h3 class="text-xl font-bold mb-3">Top Rated</h3>${cards(
    live()
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 4),
  )}`;
R.catalog = () =>
  `<div class="c p-3 mb-4 flex flex-wrap gap-2"><input class="i flex-1 min-w-[160px]" placeholder="Search products, stores, categories..." value="${esc(app.q)}" aria-label="Search" oninput="app.q=this.value;app.grid()" onchange="app.searches.push(this.value)"><select class="i w-auto" aria-label="Category" onchange="app.cat=this.value;app.grid()"><option value="">All categories</option>${J(mockDB.categories, (c) => `<option ${c == app.cat ? "selected" : ""}>${c}</option>`)}</select><select id="sort" class="i w-auto" aria-label="Sort" onchange="app.grid()"><option value="">Relevance</option><option value="pa">Price: low to high</option><option value="pd">Price: high to low</option><option value="r">Top rated</option></select></div><div id="grid"></div>`;
R.catalog.after = () => app.grid();
R.product = ({ id }) => {
  const p = P(id);
  if (!p) return empty("fa-box", "Product not found.");
  if (app.role() === "customer") app.viewed.push(p.category);
  const rv = mockDB.reviews.filter((r) => r.productId === id),
    d = p.orig > p.price ? Math.round((1 - p.price / p.orig) * 100) : 0,
    bought =
      app.role() === "customer" &&
      mockDB.orders.some(
        (o) =>
          o.customerId === me() &&
          o.status === "Completed" &&
          o.items.some((i) => i.productId === id),
      );
  return `<button class="text-sm text-gray-500 mb-3" onclick="app.navigate('catalog')">← Back to products</button><div class="c p-6 grid md:grid-cols-2 gap-8 mb-6"><div class="text-9xl text-center py-12 bg-gray-50 rounded-xl">${productImage(p, "h-64 max-w-full object-contain mx-auto")}</div><div>
<p class="text-xs font-bold text-primary uppercase">${p.category}</p><h1 class="text-2xl font-bold">${p.name}</h1><p class="text-sm text-gray-500 mb-2">Sold by <a href="#" class="text-primary" onclick="app.q=${jq(p.sellerName)};app.cat='';app.navigate('catalog');return false">${p.sellerName}</a> · ★ ${p.rating} (${p.reviews} reviews)</p>
<p class="text-3xl font-bold mb-1">${fmt(p.price)} ${d ? `<s class="text-base text-gray-400 font-normal">${fmt(p.orig)}</s> <span class="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">-${d}%</span>` : ""}</p><p class="mb-3">${p.stock ? badge(p.stock < 10 ? "Low Stock" : "In Stock") + " " + p.stock + " available" : badge("Out of Stock")}</p><p class="text-sm text-gray-600 mb-4">${p.desc}</p>
<label class="text-sm font-medium">Quantity <input id="qty" type="number" min="1" max="${p.stock}" value="1" class="i w-20 inline"></label>
<div class="flex flex-wrap gap-2 mt-4"><button class="b" ${p.stock ? "" : 'disabled style="opacity:.5"'} onclick="app.addToCart('${p.id}',Math.min(${p.stock},Math.max(1,+$('qty').value||1)))">Add to Cart</button><button class="g" ${p.stock ? "" : "disabled"} onclick="app.addToCart('${p.id}',Math.max(1,+$('qty').value||1));if(app.cart.length)app.navigate('checkout')">Buy Now</button><button class="g" onclick="app.toggleWishlist('${p.id}')"><i class="fa-solid fa-heart ${app.wishlist.includes(p.id) ? "text-red-500" : ""}"></i> Wishlist</button><button class="g" onclick="app.toggleCompare('${p.id}')"><i class="fa-solid fa-code-compare"></i> Compare</button>${app.role() === "customer" ? `<button class="text-xs text-gray-500" onclick="app.report(${jq("Product: " + p.name)})">Report</button>` : ""}</div></div></div>
<div class="c p-6 mb-6"><h3 class="font-bold mb-3">Specifications</h3>${J(Object.entries({ SKU: p.sku, Category: p.category, Seller: p.sellerName, Warranty: "1 Year", Shipping: fmt(app.shippingFee) + " flat per seller shipment" }), ([k, v]) => `<div class="flex justify-between border-b py-1 text-sm"><span class="text-gray-500">${k}</span><span>${v}</span></div>`)}</div>
<div class="c p-6 mb-6"><div class="flex justify-between mb-3"><h3 class="font-bold">Customer Reviews (${rv.length})</h3>${bought ? `<button class="b text-sm" onclick="app.review('${id}')">Write a Review</button>` : ""}</div>${rv.length ? J(rv, (r) => `<div class="border-b py-2 text-sm"><b>${U(r.customerId).name}</b> ${"★".repeat(r.rating)} <span class="text-gray-400">${r.date}</span><p>${r.text}</p>${r.reply ? `<p class="text-primary text-xs">Seller reply: ${r.reply}</p>` : ""}</div>`) : '<p class="text-sm text-gray-500">No reviews yet.</p>'}</div>
<h3 class="font-bold mb-3">Related Products</h3>${cards(
    live()
      .filter((x) => x.category === p.category && x.id !== id)
      .slice(0, 4),
  )}<h3 class="font-bold my-3">Customers Also Bought</h3>${cards(
    live()
      .filter((x) => x.id !== id)
      .sort((a, b) => b.reviews - a.reviews)
      .slice(0, 4),
  )}`;
};
R.categories = () =>
  h("Categories") +
  `<div class="grid grid-cols-2 md:grid-cols-3 gap-4">${J(mockDB.categories, (k) => `<div class="c p-6 cursor-pointer hover:shadow-md" onclick="app.cat=${jq(k)};app.q='';app.navigate('catalog')"><p class="font-bold">${k}</p><p class="text-sm text-gray-500">${live().filter((p) => p.category === k).length} products</p></div>`)}</div>`;
R.sellers = () =>
  h("Shop Directory") +
  `<div class="grid md:grid-cols-3 gap-4">${J(
    mockDB.users.filter((u) => u.role === "seller" && u.status === "Active"),
    (s) => {
      const rv = mockDB.reviews.filter(
        (r) => P(r.productId) && P(r.productId).sellerId === s.id,
      );
      return `<div class="c p-5 cursor-pointer hover:shadow-md" onclick="app.q=${jq(s.storeName)};app.cat='';app.navigate('catalog')"><div class="w-12 h-12 rounded-full bg-blue-100 text-primary font-bold flex items-center justify-center mb-2">${s.storeName[0]}</div><p class="font-bold">${s.storeName}</p><p class="text-sm text-gray-500">${s.desc || ""}</p><p class="text-xs mt-1">${mockDB.products.filter((p) => p.sellerId === s.id && p.status === "Active").length} products · ★ ${rv.length ? (rv.reduce((a, r) => a + r.rating, 0) / rv.length).toFixed(1) : "—"}</p></div>`;
    },
  )}</div>`;
R.track = ({ n } = {}) => {
  const q = String(n || "")
      .trim()
      .toUpperCase(),
    o = q
      ? mockDB.orders.find((x) => x.shp && x.shp.tracking.toUpperCase() === q)
      : null,
    s = o && o.shp,
    a = (o && o.addr) || {};
  return (
    h("Track a Parcel") +
    `<form class="c p-4 flex gap-2 mb-4" onsubmit="event.preventDefault();app.navigate('track',{n:$('tn').value})"><input id="tn" class="i" placeholder="Enter your courier tracking number" aria-label="Tracking number" value="${esc(n || "")}"><button class="b">Track</button></form>` +
    (!q
      ? '<p class="text-sm text-gray-500">Find the tracking number on your order page or in the courier SMS. No login needed.</p>'
      : !o
        ? empty("fa-box-open", "No parcel found for that tracking number.")
        : `<div class="c p-6"><div class="flex justify-between items-start"><div><p class="text-xs text-gray-500">${esc(s.courier)}</p><p class="font-bold text-lg">${esc(s.tracking)}</p></div>${badge(o.status)}</div><p class="text-sm mt-3">Destination: <b>${esc(a.city || "-")}, ${esc(a.province || "")}</b> &middot; ${o.status === "Completed" ? "Delivered" : "Estimated delivery: <b>" + s.eta[0] + " to " + s.eta[1] + "</b>"}</p>${s.attempts && !["Completed", "Returned"].includes(o.status) ? `<p class="text-xs text-red-600 mt-1">Failed delivery attempts: ${s.attempts} of ${MAX_ATTEMPTS}</p>` : ""}<h4 class="font-semibold text-sm mt-4 mb-2">Courier updates</h4><div class="text-xs space-y-1">${J(s.events.slice().reverse(), (e) => `<div class="flex gap-3"><span class="text-gray-400 shrink-0">${e.time}</span><span>${esc(e.text)}</span></div>`)}</div></div>`)
  );
};
R.denied = () =>
  `<div class="text-center py-20"><i class="fa-solid fa-lock text-6xl text-gray-300 mb-3"></i><h2 class="text-2xl font-bold">Access Denied</h2><p class="text-gray-500 mb-4">You do not have permission to view this page.</p><button class="b" onclick="app.navigate('${HOME[app.role()] || "login"}')">Go to my dashboard</button></div>`;

/* CUSTOMER MODULES */
R.dashboard = () => {
  const os = mockDB.orders.filter((o) => o.customerId === me()),
    ok = os.filter((o) => okO(o)),
    spent = ok.reduce((a, o) => a + o.total, 0);
  return (
    h("Welcome back, " + esc(app.currentUser.name)) +
    grid(
      3,
      stat("Total Orders", os.length, "orders") +
        stat(
          "Pending Orders",
          os.filter((o) =>
            ["Pending", "Processing", "Packed"].includes(o.status),
          ).length,
          "orders",
        ) +
        stat(
          "Completed Orders",
          os.filter((o) => o.status === "Completed").length,
          "orders",
        ) +
        stat("Wishlist Items", app.wishlist.length, "wishlist") +
        stat("Cart Items", app.cart.length, "cart") +
        stat("Total Spending", fmt(spent)),
    ) +
    tbl(
      "Recent Orders",
      ["Order ID", "Date", "Items", "Total", "Status", "Action"],
      os
        .slice(0, 5)
        .map((o) => [
          o.id,
          o.date,
          o.items.reduce((a, i) => a + i.qty, 0),
          fmt(o.total),
          badge(o.status),
          `<button class="text-primary" onclick="app.navigate('tracking',{id:'${o.id}'})">Track</button>`,
        ]),
      "",
      "You don't have any orders yet.",
    ) +
    `<div class="c p-5 my-6"><h3 class="font-bold mb-2">Spending Overview</h3><p class="text-sm text-gray-600 mb-3">${ok.length} orders · average order value ${fmt(ok.length ? spent / ok.length : 0)}</p>${bars(
      ok.reduce(
        (m, o) => (
          (m[o.date.slice(0, 7)] = (m[o.date.slice(0, 7)] || 0) + o.total),
          m
        ),
        {},
      ),
      1,
    )}</div><h3 class="font-bold mb-3">Recommended Products</h3>${cards(
      live()
        .sort((a, b) => app.score(b) - app.score(a))
        .slice(0, 4),
    )}`
  );
};
R.cart = () => {
  const t = app.totals(),
    rows = J(app.cart, (i) => {
      const p = P(i.productId);
      return `<tr><td>${productImage(p)} <b>${p.name}</b><div class="text-xs text-gray-500">${p.sellerName} · ${p.stock} in stock</div></td><td>${fmt(p.price)}</td><td><button class="g" aria-label="Decrease" onclick="app.qty('${p.id}',-1)">−</button> <b class="mx-1">${i.qty}</b> <button class="g" aria-label="Increase" onclick="app.qty('${p.id}',1)">+</button></td><td class="font-bold">${fmt(p.price * i.qty)}</td><td><button class="text-primary text-xs" onclick="app.saveLater('${p.id}')">Save for Later</button> <button class="text-red-500 ml-2" aria-label="Remove" onclick="app.removeFromCart('${p.id}')"><i class="fa-solid fa-trash"></i></button></td></tr>`;
    });
  return (
    h("Shopping Cart") +
    `<div class="grid lg:grid-cols-3 gap-6"><div class="lg:col-span-2">${app.cart.length ? `<div class="c overflow-x-auto"><table class="w-full text-sm"><thead><tr><th>Product</th><th>Price</th><th>Quantity</th><th>Subtotal</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : empty("fa-cart-shopping", "Your cart is empty.")}
${
  app.saved.length
    ? `<h3 class="font-bold mt-6 mb-2">Saved for Later</h3>${J(
        app.saved,
        (i) => {
          const p = P(i.productId);
          return `<div class="c p-3 mb-2 flex justify-between items-center text-sm"><span>${productImage(p)} ${p.name} · ${fmt(p.price)}</span><span><button class="text-primary" onclick="app.moveToCart('${p.id}')">Move to Cart</button> <button class="text-red-500 ml-2" onclick="app.saved=app.saved.filter(x=>x.productId!=='${p.id}');app.refresh()">Remove</button></span></div>`;
        },
      )}`
    : ""
}</div>
<div class="c p-5 h-fit"><h3 class="font-bold mb-3">Order Summary</h3>${sum(t)}${vchips()}<div class="flex gap-2 mt-4"><input id="vc" class="i" placeholder="Voucher code" aria-label="Voucher code" value=""><button class="g" onclick="app.applyVoucher()">Apply</button></div><p class="text-xs text-gray-500 mt-2">Stack one platform voucher with one shop voucher per seller. <a href="#" class="text-primary" onclick="app.navigate('vouchers');return false">Browse vouchers</a></p><button class="b w-full mt-4" ${app.cart.length ? "" : 'disabled style="opacity:.5"'} onclick="app.navigate('checkout')">Proceed to Checkout</button></div></div>`
  );
};
R.wishlist = () =>
  h("My Wishlist") +
  (app.wishlist.length
    ? `<div class="grid grid-cols-2 md:grid-cols-4 gap-4">${J(app.wishlist.map(P).filter(Boolean), (p) => `<div class="c p-3 text-sm"><div class="text-5xl text-center py-4 bg-gray-50 rounded">${productImage(p)}</div><p class="font-semibold mt-2">${p.name}</p><p class="text-xs text-gray-500">${p.sellerName} · ★ ${p.rating} · ${p.stock ? p.stock + " in stock" : "Out of stock"}</p><p class="font-bold text-primary my-1">${fmt(p.price)}</p><div class="flex gap-1"><button class="b flex-1 text-xs" ${p.stock ? "" : 'disabled style="opacity:.5"'} onclick="app.addToCart('${p.id}');app.toggleWishlist('${p.id}')">Move to Cart</button><button class="g text-xs" onclick="app.addToCart('${p.id}')">Add</button><button class="g text-red-500" aria-label="Remove" onclick="app.toggleWishlist('${p.id}')"><i class="fa-solid fa-trash"></i></button></div></div>`)}</div>`
    : empty("fa-heart", "You haven't saved any products yet."));
R.compare = () => {
  const l = app.compareList.map(P);
  if (!l.length)
    return (
      h("Compare Products") +
      empty(
        "fa-code-compare",
        "No products selected. Add up to 4 from the catalog.",
      )
    );
  const rows = [
    ["Seller", (p) => p.sellerName],
    ["Price", (p) => `<b class="text-primary">${fmt(p.price)}</b>`],
    [
      "Discount",
      (p) =>
        p.orig > p.price ? Math.round((1 - p.price / p.orig) * 100) + "%" : "—",
    ],
    ["Rating", (p) => "★ " + p.rating],
    ["Reviews", (p) => p.reviews],
    [
      "Stock",
      (p) => (p.stock ? p.stock + " available" : badge("Out of Stock")),
    ],
    ["Category", (p) => p.category],
    ["SKU", (p) => p.sku],
    ["Warranty", (p) => "1 Year"],
    [
      "",
      (p) =>
        `<button class="b text-xs" ${p.stock ? "" : 'disabled style="opacity:.5"'} onclick="app.addToCart('${p.id}')">Add to Cart</button>`,
    ],
  ];
  return (
    h("Compare Products (" + l.length + "/4)") +
    `<div class="c overflow-x-auto"><table class="w-full text-sm min-w-[600px]"><thead><tr><th></th>${J(l, (p) => `<th class="text-center normal-case"><div class="text-4xl">${productImage(p)}</div><b class="text-gray-800 text-sm">${p.name}</b><br><button class="text-red-500 text-xs" onclick="app.toggleCompare('${p.id}')">Remove</button></th>`)}</tr></thead><tbody>${J(rows, ([k, f]) => `<tr><td class="font-bold">${k}</td>${J(l, (p) => `<td class="text-center">${f(p)}</td>`)}</tr>`)}</tbody></table></div>`
  );
};
R.checkout = () => {
  if (!app.cart.length) return empty("fa-cart-shopping", "Your cart is empty.");
  const ms = METHODS.filter((m) => app.settings.methods[m]);
  if (!ms.includes(app.pay)) app.pay = ms[0];
  const a = app.addr,
    t = app.totals(),
    accts = app.acctsFor(app.pay);
  if (!accts.length) app.payAcct = null;
  else if (app.payAcct === null)
    app.payAcct = (accts.find((x) => x.def) || accts[0]).id;
  const F = (k, l) =>
    k === "region"
      ? `<label class="block text-sm font-medium">${l}<select class="i mt-1" onchange="app.addr.region=this.value;app.refresh()">${REGION_GROUP[a.region] ? "" : '<option value="">Select region</option>'}${J(Object.keys(REGION_GROUP), (r) => `<option ${r === a.region ? "selected" : ""}>${r}</option>`)}</select></label>`
      : `<label class="block text-sm font-medium">${l}<input class="i mt-1" value="${esc(a[k] || "")}" oninput="app.addr['${k}']=this.value"></label>`;
  const eta = etaRange(a.region, TODAY),
    vOpt = (v, sel) =>
      `<option value="${v.code}" ${sel ? "selected" : ""}>${v.code} - ${esc(app.vLabel(v))}</option>`,
    plat = mockDB.vouchers.filter((v) => !v.seller && !app.vcheck(v));
  return (
    h("Checkout") +
    `<div class="grid lg:grid-cols-3 gap-6"><div class="lg:col-span-2 space-y-4"><div class="c p-5"><h3 class="font-bold mb-3">Step 1 - Delivery Address</h3><div class="grid sm:grid-cols-2 gap-3">${F("name", "Full name")}${F("phone", "Mobile number")}${F("region", "Region")}${F("province", "Province")}${F("city", "City / Municipality")}${F("barangay", "Barangay")}${F("street", "Street / House no.")}${F("zip", "Postal code")}</div><p id="aerr" class="text-red-600 text-sm mt-2" role="alert"></p></div>
<div class="c p-5"><h3 class="font-bold mb-1">Step 2 - Shipping &amp; Items</h3><p class="text-xs text-gray-500 mb-3">Each seller ships separately. Flat ${fmt(app.shippingFee)} per shipment. Delivery to ${igroup(a.region)}: ${eta[0]} to ${eta[1]}.</p>${J(
      t.groups,
      (g, i) =>
        `<div class="border rounded-lg p-3 mb-2 text-sm"><div class="flex justify-between"><b><i class="fa-solid fa-box"></i> Shipment ${i + 1} of ${t.n} &middot; ${esc(U(g.sellerId).storeName)}</b><span>${g.shipDisc ? `<s class="text-gray-400">${fmt(g.ship)}</s> ` : ""}<b>${fmt(g.ship - g.shipDisc)}</b> shipping</span></div>${J(
          g.items,
          (it) => {
            const p = P(it.productId);
            return `<div class="flex justify-between py-1 border-b"><span>${productImage(p)} ${p.name} <span class="text-gray-500">&middot; ${it.qty} &times; ${fmt(p.price)}</span></span><b>${fmt(p.price * it.qty)}</b></div>`;
          },
        )}</div>`,
    )}</div>
<div class="c p-5"><h3 class="font-bold mb-1">Step 3 - Vouchers</h3><p class="text-xs text-gray-500 mb-3">Use one platform voucher plus one shop voucher per seller.</p><label class="block text-sm font-medium">Platform voucher<select class="i mt-1" onchange="app.setV(0,this.value)"><option value="">${plat.length ? "No voucher" : "No platform vouchers available"}</option>${J(plat, (v) => vOpt(v, app.activeVoucher && app.activeVoucher.code === v.code))}</select></label>
${J(t.groups, (g) => {
  const sv = mockDB.vouchers.filter(
      (v) => v.seller === g.sellerId && !app.vcheck(v),
    ),
    cur = app.shopV[g.sellerId];
  return `<label class="block text-sm font-medium mt-3">Shop voucher - ${esc(U(g.sellerId).storeName)}<select class="i mt-1" onchange="app.setV('${g.sellerId}',this.value)"><option value="">${sv.length ? "No voucher" : "No shop vouchers available"}</option>${J(sv, (v) => vOpt(v, cur && cur.code === v.code))}</select></label>`;
})}
<div class="flex gap-2 mt-3"><input id="vc2" class="i" placeholder="Have a code? Enter it here" aria-label="Voucher code"><button class="g" onclick="app.applyVoucher($('vc2').value)">Apply</button></div></div>
<div class="c p-5"><h3 class="font-bold mb-3">Step 4 - Payment</h3>${J(ms, (m) => `<label class="flex gap-2 p-2 text-sm items-center"><input type="radio" name="pay" ${app.pay === m ? "checked" : ""} onchange="app.pay='${m}';app.payAcct=null;app.refresh()"> <i class="fa-solid ${ICON[m]} w-5 text-gray-500"></i> ${m}</label>`)}
${accts.length ? `<label class="block text-sm font-medium mt-2">Pay with a linked account<select class="i mt-1" onchange="app.payAcct=this.value"><option value="" ${app.payAcct === "" ? "selected" : ""}>Use another ${esc(app.pay)} account</option>${J(accts, (x) => `<option value="${x.id}" ${app.payAcct === x.id ? "selected" : ""}>${esc(acctLabel(x))} (${esc(x.holder)})</option>`)}</select></label>` : ""}
<p class="text-xs text-gray-500 mt-2">${app.pay === "Cash on Delivery" ? "Pay the rider in cash when your parcel arrives." : "You will complete the payment in the next step."} <a href="#" class="text-primary" onclick="app.navigate('wallet');return false">Manage payment methods</a></p><p class="text-xs text-gray-400">PayMongo sandbox simulation. No real payment is processed.</p></div></div>
<div class="c p-5 h-fit"><h3 class="font-bold mb-3">Step 5 - Confirm Order</h3>${sum(t)}<button class="b w-full mt-4" onclick="app.placeOrder()">${app.pay === "Cash on Delivery" ? "PLACE ORDER" : "PAY &amp; PLACE ORDER"}</button></div></div>`
  );
};
R.receipt = ({ id }) => {
  const o = mockDB.orders.find((x) => x.id === id);
  if (!o || o.customerId !== me())
    return empty("fa-receipt", "Receipt not found.");
  return `<div class="max-w-2xl mx-auto c p-8"><div class="text-center border-b pb-4 mb-4"><h2 class="text-2xl font-bold text-primary"><i class="fa-solid fa-store"></i> ShopHub</h2><p class="text-xs uppercase tracking-widest text-gray-500">Official Receipt</p></div>
<div class="grid grid-cols-2 text-sm gap-2 mb-4"><p>Receipt No: <b>RC-${o.id.slice(4)}</b></p><p>Order No: <b>${o.id}</b></p><p>Date: <b>${o.date}</b></p><p>Customer: <b>${esc(app.currentUser.name)}</b></p><p>Seller: <b>${U(o.sellerId).storeName}</b></p><p>Payment: <b>${o.pay}</b> ${badge(o.payStatus)}</p>${o.payRef ? `<p>Payment ref: <b class="text-xs">${o.payRef}</b></p>` : ""}<p class="col-span-2">Ship to: <b>${esc((o.addr || {}).name || "")}</b>, ${addrLine(o.addr)}</p>${o.shp ? `<p class="col-span-2">Courier: <b>${o.shp.courier}</b> &middot; Tracking: <b>${o.shp.tracking}</b></p>` : ""}</div>
<table class="w-full text-sm mb-4"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>${J(o.items, (i) => `<tr><td>${P(i.productId).name}</td><td>${i.qty}</td><td>${fmt(i.price)}</td><td>${fmt(i.price * i.qty)}</td></tr>`)}</tbody></table>
<div class="ml-auto w-64">${sum(otot(o))}</div><div class="flex flex-wrap gap-2 justify-center mt-6 np"><button class="g" onclick="window.print()">Print Receipt</button><button class="g" onclick="app.dlReceipt('${o.id}')">Download Receipt</button><button class="b" onclick="app.navigate('tracking',{id:'${o.id}'})">View Order</button></div></div>`;
};
const tabOf = (o) =>
  ({
    Completed: "Delivered",
    "Out for Delivery": "Shipped",
    Packed: "Processing",
  })[o.status] || o.status;
R.orders = () => {
  const os = mockDB.orders.filter(
    (o) => o.customerId === me() && (app.tab === "All" || tabOf(o) === app.tab),
  );
  return (
    h("Order History") +
    `<div class="flex gap-2 mb-3 overflow-x-auto">${J(["All", "Pending", "Processing", "Shipped", "Delivered", "Cancelled", "Returned"], (t) => `<button class="${app.tab === t ? "b" : "g"} text-sm" onclick="app.tab='${t}';app.refresh()">${t}</button>`)}</div>` +
    tbl(
      "",
      ["Order ID", "Date", "Seller", "Items", "Total", "Status", "Actions"],
      os.map((o) => [
        o.id,
        o.date,
        U(o.sellerId).storeName,
        o.items.reduce((a, i) => a + i.qty, 0),
        fmt(o.total),
        badge(o.status),
        `<button class="text-primary" onclick="app.navigate('tracking',{id:'${o.id}'})">Track Order</button> <button class="text-primary ml-2" onclick="app.navigate('receipt',{id:'${o.id}'})">Receipt</button>${["Pending", "Processing"].includes(o.status) ? ` <button class="text-red-500 ml-2" onclick="app.cancelOrder('${o.id}')">Cancel</button>` : ""}${o.status === "Completed" ? ` <button class="text-primary ml-2" onclick="app.review('${o.items[0].productId}')">Review</button>` : ""}`,
      ]),
      "",
      "You don't have any orders yet.",
    )
  );
};
R.tracking = ({ id, placed }) => {
  const o = mockDB.orders.find((x) => x.id === id);
  if (!o || o.customerId !== me()) return empty("fa-box", "Order not found.");
  const s = o.shp,
    term = ["Cancelled", "Returned"].includes(o.status),
    eta = s ? s.eta : etaRange((o.addr || {}).region, o.date),
    refunded = o.payStatus === "Refunded";
  return `<div class="max-w-2xl mx-auto"><button class="text-sm text-gray-500 mb-3" onclick="app.navigate('orders')">← Back to orders</button>${placed ? '<div class="bg-green-50 border border-green-200 text-green-800 p-3 rounded-lg mb-3 text-sm" role="status"><i class="fa-solid fa-circle-check"></i> Thank you! Your order has been placed.</div>' : ""}<div class="c p-6 mb-4"><div class="flex justify-between items-start mb-3"><div><h2 class="text-xl font-bold">Order Tracking</h2><p class="text-sm text-gray-500">Order No: <b>${o.id}</b> · ${o.date}</p></div><div class="text-right text-xs text-gray-500">Current status<br>${badge(o.status)}</div></div><h3 class="font-bold text-sm mb-1">Order Summary</h3>${J(o.items, (i) => `<div class="flex justify-between text-sm py-1 border-b"><span>${P(i.productId).img} ${P(i.productId).name} × ${i.qty}</span><b>${fmt(i.price * i.qty)}</b></div>`)}<div class="mt-3">${sum(otot(o))}</div><p class="text-xs text-gray-500 mt-2">Payment: ${o.pay} ${badge(o.payStatus)}${o.payRef ? " · Ref <code>" + o.payRef + "</code>" : ""} · Seller: ${U(o.sellerId).storeName}</p><button class="g text-sm mt-3" onclick="app.navigate('receipt',{id:'${o.id}'})">View Receipt</button></div>
<div class="c p-6 mb-4"><h3 class="font-bold mb-3"><i class="fa-solid fa-truck-fast text-primary"></i> Shipment</h3><div class="grid sm:grid-cols-2 gap-3 text-sm"><p><span class="text-gray-500">Courier</span><br><b>${s ? s.courier : "Assigned when the seller ships"}</b></p><p><span class="text-gray-500">Tracking no.</span><br><b>${s ? s.tracking : "-"}</b></p><p><span class="text-gray-500">${o.status === "Completed" ? "Delivered" : "Estimated delivery"}</span><br><b>${o.status === "Completed" ? (s && s.receivedBy ? "Received by " + s.receivedBy : "Delivered") : term ? "-" : eta[0] + " to " + eta[1]}</b></p><p><span class="text-gray-500">Ship to</span><br><b>${esc((o.addr || {}).name || "")}</b><br>${addrLine(o.addr)}</p></div>
${o.pay === "Cash on Delivery" && !term && o.status !== "Completed" ? `<p class="text-xs bg-yellow-50 border border-yellow-200 text-yellow-800 p-2 rounded mt-3">Cash on delivery: please prepare <b>${fmt(o.total)}</b> for the rider.</p>` : ""}${s && s.attempts && !term ? `<p class="text-xs text-red-600 mt-2">Failed delivery attempts: ${s.attempts} of ${MAX_ATTEMPTS}. After ${MAX_ATTEMPTS} the parcel returns to the seller.</p>` : ""}
${s ? `<h4 class="font-semibold text-sm mt-4 mb-2">Courier updates</h4><div class="text-xs space-y-1">${J(s.events.slice().reverse(), (e) => `<div class="flex gap-3"><span class="text-gray-400 shrink-0">${e.time}</span><span>${esc(e.text)}</span></div>`)}</div>` : '<p class="text-xs text-gray-500 mt-3">Courier updates will appear here once your parcel is picked up.</p>'}</div>
<div class="c p-6"><h3 class="font-bold mb-4">Delivery Progress</h3>${term ? `<p class="text-red-600 mb-4">${o.status === "Returned" ? "The parcel could not be delivered and was returned to the seller." : "This order was cancelled."}${refunded ? " Your payment has been refunded to your original payment method." : ""}</p>` : ""}<div class="space-y-5 border-l-2 border-gray-200 ml-2 pl-6">${J(
    term ? o.timeline.map((t) => t.status) : FLOW,
    (st) => {
      const e = o.timeline.find((t) => t.status === st);
      return `<div class="relative"><span class="absolute -left-[33px] w-4 h-4 rounded-full ${e ? "bg-primary" : "bg-gray-300"}"></span><p class="font-semibold ${e ? "" : "text-gray-400"}">${st}</p><p class="text-xs text-gray-500">${e ? e.time + " — " + (st === "Delivered" ? "Package delivered." : "Status updated.") : "Upcoming"}</p></div>`;
    },
  )}</div>
${["Completed", "Cancelled", "Returned"].includes(o.status) ? "" : `<div class="flex flex-wrap gap-2 mt-6"><button class="g" onclick="app.advance('${o.id}')">Simulate Next Status</button>${o.status === "Out for Delivery" ? `<button class="g text-red-600" onclick="app.simFail('${o.id}')">Simulate failed delivery</button>` : ""}</div><p class="text-xs text-gray-400 mt-2">Demo controls. In production the seller and courier update these.</p>`}</div></div>`;
};
R.notifications = () => {
  const l = mockDB.notifications.filter((n) => n.userId === me());
  return `<div class="max-w-2xl mx-auto"><div class="flex justify-between mb-4"><h2 class="text-2xl font-bold">Notifications</h2><button class="text-primary text-sm" onclick="mockDB.notifications.forEach(n=>{if(n.userId===me())n.read=true});app.refresh()">Mark all as read</button></div>${l.length ? `<div class="c divide-y">${J(l, (n) => `<div class="p-4 cursor-pointer hover:bg-gray-50" onclick="mockDB.notifications.find(x=>x.id==${n.id}).read=true;app.refresh()"><div class="flex justify-between"><b class="text-sm">${!n.read ? '<span class="inline-block w-2 h-2 rounded-full bg-primary mr-2"></span>' : ""}${n.title}</b><span class="text-xs text-gray-400">${n.date}</span></div><p class="text-sm text-gray-500">${n.desc}</p></div>`)}</div>` : empty("fa-bell-slash", "You're all caught up.")}</div>`;
};
R.recs = () => {
  const top = app.topCat(),
    w = app.wishlist.map((i) => P(i).category),
    ranked = live().sort((a, b) => app.score(b) - app.score(a)),
    sec = (t, l) => `<h3 class="font-bold mt-6 mb-3">${t}</h3>${cards(l)}`;
  return (
    h("Recommendations") +
    `<div class="c p-4 mb-2 bg-blue-50 text-sm"><b>Recommendation Basis</b> (simulation): Recommended because you frequently browse <b>${top}</b> products. Scores combine categories viewed, purchases, wishlist, cart, price range, ratings and search activity.</div>` +
    sec("Recommended for You", ranked.slice(0, 4)) +
    sec(
      "Based on Your Recent Searches",
      live()
        .filter((p) =>
          app.searches.some(
            (s) => s && p.name.toLowerCase().includes(s.toLowerCase()),
          ),
        )
        .slice(0, 4),
    ) +
    sec(
      "Based on Your Wishlist",
      live()
        .filter((p) => w.includes(p.category) && !app.wishlist.includes(p.id))
        .slice(0, 4),
    ) +
    sec(
      "Customers Also Bought",
      live()
        .sort((a, b) => b.reviews - a.reviews)
        .slice(0, 4),
    ) +
    sec(
      "Similar Products",
      live()
        .filter((p) => p.category === (app.viewed.slice(-1)[0] || top))
        .slice(0, 4),
    )
  );
};
R.vouchers = () =>
  h("Vouchers") +
  `<p class="text-sm text-gray-600 mb-3">Stack up to <b>one platform voucher</b> and <b>one shop voucher per seller</b> in a single checkout. ${app.cart.length ? "" : "Add items to your cart to see which vouchers you qualify for."}</p>` +
  tbl(
    "",
    ["Code", "Voucher", "Scope", "Conditions", "Expires", "Status", ""],
    mockDB.vouchers
      .filter((v) => v.status === "Active")
      .map((v) => {
        const e = app.vcheck(v),
          cond = [
            v.min ? "Min. spend " + fmt(v.min) : "No minimum",
            v.category ? v.category + " only" : "",
            v.firstOrder ? "First order only" : "",
            v.limit ? Math.max(0, v.limit - v.uses) + " left" : "",
            v.perUser ? v.perUser + " per customer" : "",
          ]
            .filter(Boolean)
            .join(" · ");
        return [
          `<b>${v.code}</b>`,
          app.vLabel(v),
          v.seller ? "Shop: " + esc(U(v.seller).storeName) : "Platform",
          `<span class="text-xs text-gray-600">${cond}</span>`,
          v.expiry,
          e
            ? `<span class="text-xs text-gray-500">${esc(e)}</span>`
            : badge("Active").replace("Active", "Eligible"),
          `<button class="text-primary" ${e ? 'disabled style="opacity:.4"' : ""} onclick="app.applyVoucher('${v.code}',1)">Apply</button>`,
        ];
      }),
    "",
    "No vouchers available right now.",
  );
R.wallet = () =>
  acctTable(
    "Payment Methods",
    mockDB.linked.filter((x) => x.userId === me()),
  ) +
  `<div class="c p-4 mt-4 text-sm text-gray-600"><p><b>How linking works.</b> Link a GCash, Maya or GrabPay wallet, a bank for online banking, or a card. You verify with a one-time code (demo code <b>123456</b>), and ShopHub keeps only the last 4 digits. Linked accounts are offered at checkout.</p><p class="text-xs text-gray-400 mt-2">Simulation only. A real build tokenizes accounts and cards on PayMongo's servers, never in the browser.</p></div>`;

/* SELLER MODULES */
const sOrders = () => mockDB.orders.filter((o) => o.sellerId === me()),
  sProds = () =>
    mockDB.products.filter(
      (p) => p.sellerId === me() && p.status !== "Removed",
    ),
  sold = (id) =>
    mockDB.orders
      .filter((o) => okO(o))
      .reduce(
        (a, o) =>
          a +
          o.items
            .filter((i) => i.productId === id)
            .reduce((x, i) => x + i.qty, 0),
        0,
      );
R["s-dash"] = () => {
  const u = app.currentUser,
    os = sOrders(),
    ok = os.filter((o) => okO(o)),
    ps = sProds(),
    sales = (f) => fmt(ok.filter(f).reduce((a, o) => a + o.total, 0)),
    rv = mockDB.reviews.filter(
      (r) => P(r.productId) && P(r.productId).sellerId === me(),
    ),
    bp = {},
    bs = {};
  ok.forEach((o) =>
    o.items.forEach((i) => {
      const product = P(i.productId);
      // Connected SaleSync catalogs replace the sample products, so old demo
      // orders can refer to products that are no longer in the active catalog.
      if (product)
        bp[product.name] = (bp[product.name] || 0) + i.qty;
    }),
  );
  os.forEach((o) => (bs[o.status] = (bs[o.status] || 0) + 1));
  return (
    (u.status === "Pending"
      ? '<div class="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded-lg mb-4">Awaiting approval: you cannot publish products until an admin approves your store.</div>'
      : "") +
    h(u.storeName + " — Dashboard") +
    grid(
      4,
      stat(
        "Today's Sales",
        sales((o) => o.date === TODAY),
      ) +
        stat(
          "Monthly Sales",
          sales((o) => o.date.slice(0, 7) === TODAY.slice(0, 7)),
        ) +
        stat("Total Orders", os.length, "s-orders") +
        stat(
          "Pending Orders",
          os.filter((o) => o.status === "Pending").length,
          "s-orders",
        ) +
        stat("Total Products", ps.length, "s-products") +
        stat(
          "Low Stock",
          ps.filter((p) => p.stock < 10).length,
          "s-inventory",
        ) +
        stat(
          "Average Rating",
          rv.length
            ? (rv.reduce((a, r) => a + r.rating, 0) / rv.length).toFixed(1) +
                " ★"
            : "—",
          "s-feedback",
        ),
    ) +
    `<div class="grid md:grid-cols-3 gap-4 mb-6"><div class="c p-4"><h3 class="font-bold mb-2">Sales overview (by month)</h3>${bars(
      ok.reduce(
        (m, o) => (
          (m[o.date.slice(0, 7)] = (m[o.date.slice(0, 7)] || 0) + o.total),
          m
        ),
        {},
      ),
      1,
    )}</div><div class="c p-4"><h3 class="font-bold mb-2">Orders overview</h3>${bars(bs)}</div><div class="c p-4"><h3 class="font-bold mb-2">Top products (units)</h3>${bars(bp)}</div></div>` +
    tbl(
      "Recent Orders",
      ["Order", "Date", "Total", "Status"],
      os.slice(0, 5).map((o) => [o.id, o.date, fmt(o.total), badge(o.status)]),
      "",
      "No orders yet.",
    )
  );
};
R["s-products"] = () =>
  tbl(
    "Product Management",
    [
      "Product",
      "SKU",
      "Category",
      "Price",
      "Stock",
      "Sales",
      "Rating",
      "Status",
      "Actions",
    ],
    sProds().map((p) => [
      p.img + " " + p.name,
      p.sku,
      p.category,
      fmt(p.price),
      p.stock,
      sold(p.id),
      "★ " + p.rating,
      badge(p.status),
      `<button class="text-primary" onclick="app.productForm('${p.id}')">Edit</button> <button class="text-gray-600 ml-2" onclick="app.archive('${p.id}')">${p.status === "Archived" ? "Unarchive" : "Archive"}</button> <button class="text-red-500 ml-2" onclick="app.delProduct('${p.id}')">Delete</button>`,
    ]),
    `<button class="b" onclick="app.productForm()"><i class="fa-solid fa-plus"></i> Add Product</button>`,
    "No products have been added yet.",
  );
R["s-inventory"] = () =>
  tbl(
    "Inventory",
    ["Product", "SKU", "Current Stock", "Reserved", "Available", "Status", ""],
    sProds().map((p) => {
      const r = sOrders()
        .filter((o) => ["Pending", "Processing", "Packed"].includes(o.status))
        .reduce(
          (a, o) =>
            a +
            o.items
              .filter((i) => i.productId === p.id)
              .reduce((x, i) => x + i.qty, 0),
          0,
        );
      return [
        p.name,
        p.sku,
        p.stock + r,
        r,
        p.stock,
        badge(
          p.stock === 0
            ? "Out of Stock"
            : p.stock < 10
              ? "Low Stock"
              : "In Stock",
        ),
        `<button class="text-primary" onclick="app.updateStock('${p.id}')">Update Stock</button>`,
      ];
    }),
    "",
    "No products have been added yet.",
  );
R["s-orders"] = () =>
  tbl(
    "Order Management & Shipping",
    [
      "Order ID",
      "Customer",
      "Items",
      "Total",
      "Payment",
      "Courier / Tracking",
      "Status",
      "Date",
      "Actions",
    ],
    sOrders().map((o) => {
      const s = o.shp,
        st = o.status,
        A = [],
        b = (t, fn, c = "text-primary") =>
          `<button class="${c} text-xs mr-2" onclick="${fn}">${t}</button>`;
      if (st === "Pending")
        A.push(
          b("Accept &amp; Process", `app.sellerDo('${o.id}','Processing')`),
        );
      if (st === "Processing")
        A.push(b("Mark Packed", `app.sellerDo('${o.id}','Packed')`));
      if (st === "Packed")
        A.push(b("Arrange Shipment", `app.shipForm('${o.id}')`));
      if (st === "Shipped")
        A.push(
          b("Out for Delivery", `app.sellerDo('${o.id}','Out for Delivery')`),
        );
      if (st === "Out for Delivery") {
        A.push(b("Mark Delivered", `app.deliverForm('${o.id}')`));
        A.push(b("Delivery Failed", `app.failForm('${o.id}')`, "text-red-500"));
      }
      if (s) A.push(b("Waybill", `app.waybill('${o.id}')`, "text-gray-600"));
      A.push(b("Details", `app.orderInfo('${o.id}')`, "text-gray-600"));
      if (["Pending", "Processing"].includes(st))
        A.push(
          b("Cancel", `app.sellerDo('${o.id}','Cancelled')`, "text-red-500"),
        );
      return [
        o.id,
        esc(U(o.customerId).name),
        o.items.reduce((a, x) => a + x.qty, 0),
        fmt(o.total),
        o.pay + " " + badge(o.payStatus),
        s
          ? s.courier +
            '<br><span class="text-xs text-gray-500">' +
            s.tracking +
            "</span>"
          : '<span class="text-xs text-gray-400">Not shipped</span>',
        badge(st) +
          (s && s.attempts && st === "Out for Delivery"
            ? '<div class="text-xs text-red-600">' +
              s.attempts +
              " failed</div>"
            : ""),
        o.date,
        A.join(""),
      ];
    }),
    "",
    "No orders yet.",
  );
R["s-feedback"] = () => {
  const rv = mockDB.reviews.filter(
    (r) => P(r.productId) && P(r.productId).sellerId === me(),
  );
  return (
    grid(
      3,
      stat(
        "Overall Rating",
        rv.length
          ? (rv.reduce((a, r) => a + r.rating, 0) / rv.length).toFixed(1) + " ★"
          : "—",
      ) +
        stat("Reviews", rv.length) +
        stat("Delivery Rating", "4.6 ★"),
    ) +
    tbl(
      "Customer Feedback",
      ["Customer", "Product", "Rating", "Review", "Date", ""],
      rv.map((r) => [
        U(r.customerId).name,
        P(r.productId).name,
        "★".repeat(r.rating),
        r.text +
          (r.reply
            ? `<div class="text-xs text-primary">Reply: ${r.reply}</div>`
            : ""),
        r.date,
        `<button class="text-primary" onclick="app.replyReview('${r.id}')">Reply to Review</button>`,
      ]),
      "",
      "No reviews yet.",
    )
  );
};
R["s-store"] = () => {
  const u = app.currentUser,
    ps = sProds();
  return `<div class="max-w-xl c p-6"><div class="w-16 h-16 rounded-full bg-blue-100 text-primary text-2xl font-bold flex items-center justify-center mb-3">${esc(u.storeName[0])}</div><h2 class="text-2xl font-bold">${u.storeName}</h2><p class="text-gray-500 mb-3">${u.desc || "No description yet."}</p><p class="text-sm">Seller: <b>${u.name}</b> ${badge(u.status)}</p><p class="text-sm">Contact: ${u.email} · ${u.phone || "—"}</p><p class="text-sm">Products: <b>${ps.length}</b> · Total sales: <b>${fmt(
    sOrders()
      .filter((o) => okO(o))
      .reduce((a, o) => a + o.total, 0),
  )}</b></p><button class="b mt-4" onclick="app.editStore()">Edit Store</button></div>`;
};

R["s-vouchers"] = () =>
  tbl(
    "My Shop Vouchers",
    [
      "Code",
      "Voucher",
      "Min Spend",
      "Used",
      "Per Customer",
      "Targeting",
      "Expires",
      "Status",
      "Actions",
    ],
    mockDB.vouchers
      .filter((v) => v.seller === me())
      .map((v) => [
        `<b>${v.code}</b>`,
        app.vLabel(v),
        fmt(v.min),
        v.uses + (v.limit ? " / " + v.limit : ""),
        v.perUser || "Unlimited",
        [v.firstOrder ? "First order only" : "", v.category || ""]
          .filter(Boolean)
          .join(", ") || "All customers",
        v.expiry,
        badge(v.status === "Active" && v.expiry < TODAY ? "Expired" : v.status),
        `<button class="text-primary" onclick="app.voucherForm('${v.code}')">Edit</button> <button class="text-yellow-600 ml-1" onclick="app.vStatus('${v.code}')">${v.status === "Active" ? "Disable" : "Enable"}</button> <button class="text-red-500 ml-1" onclick="app.delVoucher('${v.code}')">Delete</button>`,
      ]),
    `<button class="b" onclick="app.voucherForm()"><i class="fa-solid fa-plus"></i> Create</button>`,
    "You have no shop vouchers yet.",
  ) +
  `<p class="text-xs text-gray-500 mt-3">Shop vouchers are funded by your store: the discount is deducted from your earnings. Customers can combine one shop voucher with one platform voucher.</p>`;
R["s-payouts"] = () => {
  const os = sOrders().filter(okO),
    T = (f) =>
      fmt(os.filter((o) => f(payState(o))).reduce((a, o) => a + o.payout, 0)),
    po = mockDB.payouts.filter((p) => p.sellerId === me());
  return (
    h("Payouts & Bank Accounts") +
    grid(
      5,
      stat(
        "Held until delivered",
        T((x) => x.startsWith("Held")),
      ) +
        stat(
          "Awaiting COD remittance",
          T((x) => x.startsWith("Awaiting")),
        ) +
        stat(
          "Available to withdraw",
          T((x) => x === "Available"),
        ) +
        stat(
          "In payout request",
          T((x) => x.startsWith("In payout")),
        ) +
        stat(
          "Paid out",
          T((x) => x === "Paid out"),
        ),
    ) +
    `<div class="flex flex-wrap gap-3 items-center mb-6"><button class="b" onclick="app.requestPayout()"><i class="fa-solid fa-money-bill-transfer"></i> Request payout</button><span class="text-xs text-gray-500">Minimum ${fmt(app.settings.minPayout)}. Earnings are released after delivery (cash orders after the courier remits the COD). Paid to your default account.</span></div>` +
    acctTable(
      "Linked payout accounts",
      mockDB.linked.filter((x) => x.userId === me()),
    ) +
    '<div class="h-6"></div>' +
    tbl(
      "Payout History",
      [
        "Payout ID",
        "Requested",
        "Orders",
        "Amount",
        "To account",
        "Status",
        "Processed",
        "Reference",
      ],
      po.map((p) => [
        p.id,
        p.requested,
        p.orderIds.join(", "),
        fmt(p.amount),
        esc(acctLabel(mockDB.linked.find((x) => x.id === p.acctId))),
        badge(p.status),
        p.processed || "-",
        p.ref || "-",
      ]),
      "",
      "No payouts yet.",
    ) +
    '<div class="h-6"></div>' +
    tbl(
      "Earnings by Order",
      [
        "Order",
        "Date",
        "Sales",
        "Shop-funded discounts",
        "Commission",
        "Net earnings",
        "Payout status",
      ],
      os.map((o) => [
        o.id,
        o.date,
        fmt(o.sub),
        fmt(o.sellerFunded || 0),
        fmt(o.commission),
        `<b>${fmt(o.payout)}</b>`,
        payState(o),
      ]),
      "",
      "No orders yet.",
    )
  );
};

/* ADMIN MODULES */
R["a-dash"] = () => {
  const os = mockDB.orders,
    bs = {},
    bc = {};
  os.forEach((o) => (bs[o.status] = (bs[o.status] || 0) + 1));
  os.filter((o) => okO(o)).forEach((o) =>
    o.items.forEach((i) => {
      const product = P(i.productId);
      // Ignore sample order lines whose products aren't in the SaleSync catalog.
      if (product)
        bc[product.category] =
          (bc[product.category] || 0) + i.price * i.qty;
    }),
  );
  return (
    h("Platform Dashboard") +
    grid(
      4,
      stat(
        "Total Customers",
        mockDB.users.filter((u) => u.role === "customer").length,
        "a-customers",
      ) +
        stat(
          "Total Sellers",
          mockDB.users.filter(
            (u) => u.role === "seller" && u.status === "Active",
          ).length,
          "a-sellers",
        ) +
        stat("Total Products", mockDB.products.length, "a-products") +
        stat("Total Orders", os.length, "a-orders") +
        stat(
          "Platform Revenue",
          fmt(
            os
              .filter((o) => o.status === "Completed")
              .reduce((a, o) => a + o.total, 0),
          ),
          "a-orders",
        ) +
        stat(
          "Pending Seller Approvals",
          mockDB.users.filter((u) => u.status === "Pending").length,
          "a-approval",
        ) +
        stat(
          "Pending Reports",
          mockDB.reports.filter((r) => r.status === "Open").length,
          "a-reports",
        ) +
        stat("Cancelled Orders", bs.Cancelled || 0, "a-orders"),
    ) +
    `<div class="grid md:grid-cols-2 gap-4"><div class="c p-4"><h3 class="font-bold mb-2">Orders by status</h3>${bars(bs)}</div><div class="c p-4"><h3 class="font-bold mb-2">Sales by category</h3>${bars(bc, 1)}</div></div>`
  );
};
const orderCount = (id) =>
  mockDB.orders.filter((o) => o.customerId === id || o.sellerId === id).length;
R["a-customers"] = () =>
  tbl(
    "Customer Management",
    [
      "Customer ID",
      "Name",
      "Email",
      "Orders",
      "Total Spending",
      "Status",
      "Registered",
      "Actions",
    ],
    mockDB.users
      .filter((u) => u.role === "customer")
      .map((u) => [
        u.id,
        u.name,
        u.email,
        orderCount(u.id),
        fmt(
          mockDB.orders
            .filter((o) => o.customerId === u.id && okO(o))
            .reduce((a, o) => a + o.total, 0),
        ),
        badge(u.status),
        u.registered,
        `${u.status === "Active" ? `<button class="text-red-500" onclick="app.setUser('${u.id}','Suspended','suspend')">Suspend</button>` : `<button class="text-green-600" onclick="app.setUser('${u.id}','Active','activate')">Activate</button>`} <button class="text-primary ml-2" onclick='app.ofilter=${jq(u.name)};app.navigate("a-orders")'>View Orders</button>`,
      ]),
  );
R["a-sellers"] = () =>
  tbl(
    "Seller Management",
    [
      "Seller ID",
      "Store",
      "Owner",
      "Products",
      "Orders",
      "Revenue",
      "Rating",
      "Status",
      "Actions",
    ],
    mockDB.users
      .filter((u) => u.role === "seller")
      .map((u) => {
        const rv = mockDB.reviews.filter(
          (r) => P(r.productId) && P(r.productId).sellerId === u.id,
        );
        return [
          u.id,
          u.storeName,
          u.name,
          mockDB.products.filter((p) => p.sellerId === u.id).length,
          orderCount(u.id),
          fmt(
            mockDB.orders
              .filter((o) => o.sellerId === u.id && okO(o))
              .reduce((a, o) => a + o.total, 0),
          ),
          rv.length
            ? (rv.reduce((a, r) => a + r.rating, 0) / rv.length).toFixed(1)
            : "—",
          badge(u.status),
          u.status === "Pending"
            ? `<button class="text-green-600" onclick="app.approve('${u.id}')">Approve</button>`
            : u.status === "Active"
              ? `<button class="text-red-500" onclick="app.setUser('${u.id}','Suspended','suspend')">Suspend</button>`
              : `<button class="text-green-600" onclick="app.setUser('${u.id}','Active','activate')">Activate</button>`,
        ];
      }),
  );
R["a-approval"] = () =>
  tbl(
    "Seller Approval",
    [
      "Seller",
      "Store",
      "Email",
      "Contact",
      "Registered",
      "Verification",
      "Actions",
    ],
    mockDB.users
      .filter((u) => u.role === "seller" && u.status === "Pending")
      .map((u) => [
        u.name,
        u.storeName,
        u.email,
        u.phone || "—",
        u.registered,
        badge("Pending"),
        `<button class="b text-xs" onclick="app.approve('${u.id}')">Approve</button> <button class="g text-xs text-red-600" onclick="app.reject('${u.id}')">Reject</button> <button class="text-primary ml-1" onclick='app.modal(${jq(u.storeName)},${jq("Owner: " + u.name + "<br>Email: " + u.email + "<br>Contact: " + (u.phone || "—") + "<br>Applied: " + u.registered + "<br>ID document: placeholder (pending review)")})'>View Details</button>`,
      ]),
    "",
    "No pending applications.",
  );
R["a-products"] = () =>
  tbl(
    "Product Management",
    [
      "Product",
      "Seller",
      "Category",
      "Price",
      "Stock",
      "Rating",
      "Status",
      "Actions",
    ],
    mockDB.products.map((p) => [
      p.img + " " + p.name,
      p.sellerName,
      p.category,
      fmt(p.price),
      p.stock,
      "★ " + p.rating,
      badge(p.status),
      `<button class="text-primary" onclick='app.modal(${jq(p.name)},${jq(p.desc + "<br>SKU: " + p.sku)})'>View</button> <button class="text-primary ml-1" onclick="app.prodStatus('${p.id}','Active')">Approve</button> <button class="text-yellow-600 ml-1" onclick="app.prodStatus('${p.id}','Flagged','Flag this product for review? It will be hidden from the catalog.')">Flag</button> <button class="text-red-500 ml-1" onclick="app.prodStatus('${p.id}','Removed','Remove this product from the platform?')">Remove</button>`,
    ]),
  );
R["a-categories"] = () =>
  tbl(
    "Category Management",
    ["Category", "Products", "Actions"],
    mockDB.categories.map((c) => [
      c,
      mockDB.products.filter((p) => p.category === c).length,
      `<button class="text-primary" onclick='app.catForm(${jq(c)})'>Edit</button> <button class="text-red-500 ml-2" onclick='app.delCat(${jq(c)})'>Delete</button>`,
    ]),
    `<button class="b" onclick="app.catForm()"><i class="fa-solid fa-plus"></i> Add Category</button>`,
  );
R["a-orders"] = () => {
  const q = app.ofilter.toLowerCase(),
    l = mockDB.orders.filter(
      (o) =>
        (!app.ostatus || o.status === app.ostatus) &&
        (o.id + U(o.customerId).name + U(o.sellerId).storeName)
          .toLowerCase()
          .includes(q),
    );
  return (
    `<div class="flex flex-wrap gap-2 mb-3"><input class="i w-64" placeholder="Search order, customer, seller" aria-label="Filter orders" value="${esc(app.ofilter)}" onchange="app.ofilter=this.value;app.refresh()"><select class="i w-auto" aria-label="Status" onchange="app.ostatus=this.value;app.refresh()"><option value="">All statuses</option>${J(ST, (s) => `<option ${app.ostatus === s ? "selected" : ""}>${s}</option>`)}</select><button class="g" onclick="app.ofilter='';app.ostatus='';app.refresh()">Clear</button></div>` +
    tbl(
      "Order Monitoring",
      [
        "Order ID",
        "Customer",
        "Seller",
        "Amount",
        "Payment",
        "Shipment",
        "Status",
        "Date",
        "Actions",
      ],
      l.map((o) => [
        o.id,
        U(o.customerId).name,
        U(o.sellerId).storeName,
        fmt(o.total),
        o.pay + " " + badge(o.payStatus),
        o.shp
          ? o.shp.courier +
            '<br><span class="text-xs text-gray-500">' +
            o.shp.tracking +
            "</span>"
          : "-",
        badge(o.status),
        o.date,
        `<button class="text-primary" onclick="app.orderInfo('${o.id}')">View</button>`,
      ]),
    )
  );
};
R["a-vouchers"] = () =>
  tbl(
    "Voucher Management",
    [
      "Code",
      "Scope",
      "Voucher",
      "Min Spend",
      "Used",
      "Per Customer",
      "Targeting",
      "Expiry",
      "Status",
      "Actions",
    ],
    mockDB.vouchers.map((v) => [
      `<b>${v.code}</b>`,
      v.seller ? "Shop: " + esc(U(v.seller).storeName) : "Platform",
      app.vLabel(v),
      fmt(v.min),
      v.uses + (v.limit ? " / " + v.limit : ""),
      v.perUser || "Unlimited",
      [v.firstOrder ? "First order only" : "", v.category || ""]
        .filter(Boolean)
        .join(", ") || "All customers",
      v.expiry,
      badge(v.status === "Active" && v.expiry < TODAY ? "Expired" : v.status),
      `${v.seller ? "" : `<button class="text-primary" onclick="app.voucherForm('${v.code}')">Edit</button>`} <button class="text-yellow-600 ml-1" onclick="app.vStatus('${v.code}')">${v.status === "Active" ? "Disable" : "Enable"}</button> <button class="text-red-500 ml-1" onclick="app.delVoucher('${v.code}')">Delete</button>`,
    ]),
    `<button class="b" onclick="app.voucherForm()"><i class="fa-solid fa-plus"></i> Create Platform Voucher</button>`,
  );
R["a-shipping"] = () => {
  const os = mockDB.orders,
    c = (st) => os.filter((o) => st.includes(o.status)).length,
    cs = mockDB.couriers,
    att = os
      .filter(
        (o) => o.shp && ["Shipped", "Out for Delivery"].includes(o.status),
      )
      .reduce((a, o) => a + o.shp.attempts, 0);
  return (
    h("Shipping & Deliveries") +
    grid(
      5,
      stat("To pack / ship", c(["Pending", "Processing", "Packed"])) +
        stat("In transit", c(["Shipped"])) +
        stat("Out for delivery", c(["Out for Delivery"])) +
        stat("Failed attempts (active)", att) +
        stat("Returned to sender", c(["Returned"])),
    ) +
    tbl(
      "Couriers",
      [
        "Courier",
        "Tracking prefix",
        "Shipments",
        "Delivered",
        "Status",
        "Actions",
      ],
      cs.map((x, i) => [
        x.name,
        x.prefix,
        os.filter((o) => o.shp && o.shp.courier === x.name).length,
        os.filter(
          (o) => o.shp && o.shp.courier === x.name && o.status === "Completed",
        ).length,
        badge(x.enabled ? "Active" : "Disabled"),
        `<button class="${x.enabled ? "text-yellow-600" : "text-green-600"}" onclick="app.toggleCourier(${i})">${x.enabled ? "Disable" : "Enable"}</button>`,
      ]),
      `<span class="text-xs text-gray-500">Flat fee: ${fmt(app.shippingFee)} per seller shipment (change in Settings)</span>`,
    ) +
    '<div class="h-6"></div>' +
    tbl(
      "Shipments",
      [
        "Order ID",
        "Seller",
        "Destination",
        "Courier",
        "Tracking no.",
        "Status",
        "Failed attempts",
        "Est. delivery",
        "Actions",
      ],
      os
        .filter((o) => o.status !== "Cancelled")
        .map((o) => {
          const a = o.addr || {};
          return [
            o.id,
            esc(U(o.sellerId).storeName),
            esc((a.city || "-") + " (" + igroup(a.region) + ")"),
            o.shp ? o.shp.courier : "-",
            o.shp ? o.shp.tracking : "-",
            badge(o.status),
            o.shp ? o.shp.attempts : "-",
            o.shp ? o.shp.eta[0] + " to " + o.shp.eta[1] : "-",
            `<button class="text-primary" onclick="app.orderInfo('${o.id}')">Timeline</button>`,
          ];
        }),
      "",
      "No shipments yet.",
    )
  );
};
R["a-payments"] = () => {
  const os = mockDB.orders,
    st = app.settings,
    fee = (o) =>
      o.pay === "Cash on Delivery" ||
      !["Paid", "Refunded"].includes(o.payStatus)
        ? 0
        : R2((o.total * st.gatewayFee) / 100),
    S = (l) => fmt(l.reduce((a, o) => a + o.total, 0)),
    po = mockDB.payouts,
    online = os.filter(
      (o) => o.pay !== "Cash on Delivery" && o.payStatus === "Paid",
    ),
    codDone = os.filter(
      (o) => o.pay === "Cash on Delivery" && o.status === "Completed",
    ),
    codPend = codDone.filter((o) => !o.codRemitted),
    refunds = os.filter((o) => o.payStatus === "Refunded"),
    comm = os
      .filter((o) => o.status === "Completed")
      .reduce((a, o) => a + (o.commission || 0), 0);
  return (
    h("Payments & Payouts") +
    grid(
      4,
      stat("Online payments received", S(online)) +
        stat("COD collected by couriers", S(codDone)) +
        stat("COD pending remittance", S(codPend)) +
        stat("Refunded", S(refunds)) +
        stat("Est. gateway fees", fmt(os.reduce((a, o) => a + fee(o), 0))) +
        stat("Commission earned", fmt(comm)) +
        stat(
          "Payouts requested",
          fmt(
            po
              .filter((p) => p.status === "Requested")
              .reduce((a, p) => a + p.amount, 0),
          ),
        ) +
        stat(
          "Paid out to sellers",
          fmt(
            po
              .filter((p) => p.status === "Paid")
              .reduce((a, p) => a + p.amount, 0),
          ),
        ),
    ) +
    tbl(
      "Seller Payout Requests",
      [
        "Payout ID",
        "Seller",
        "Orders",
        "Amount",
        "Destination",
        "Requested",
        "Status",
        "Reference",
        "Actions",
      ],
      po.map((p) => [
        p.id,
        esc(U(p.sellerId).storeName),
        p.orderIds.join(", "),
        fmt(p.amount),
        esc(acctLabel(mockDB.linked.find((x) => x.id === p.acctId))),
        p.requested,
        badge(p.status),
        p.ref || "-",
        p.status === "Requested"
          ? `<button class="text-green-600" onclick="app.poPay('${p.id}')">Mark paid</button> <button class="text-red-500 ml-1" onclick="app.poReject('${p.id}')">Reject</button>`
          : "-",
      ]),
      "",
      "No payout requests.",
    ) +
    '<div class="h-6"></div>' +
    tbl(
      "Payments Ledger",
      [
        "Order",
        "Customer",
        "Method",
        "Reference",
        "Amount",
        "Status",
        "Est. fee",
        "COD remittance",
      ],
      os.map((o) => [
        o.id,
        esc(U(o.customerId).name),
        o.pay,
        o.payRef ? `<code class="text-xs">${o.payRef}</code>` : "-",
        fmt(o.total),
        badge(o.payStatus),
        fee(o) ? fmt(fee(o)) : "-",
        o.pay === "Cash on Delivery" && o.status === "Completed"
          ? o.codRemitted
            ? badge("Paid").replace("Paid", "Remitted")
            : `<button class="text-primary" onclick="app.codRemit('${o.id}')">Mark remitted</button>`
          : "-",
      ]),
      "",
      "No payments yet.",
    ) +
    '<div class="h-6"></div>' +
    tbl(
      "Gateway Events (simulated webhooks)",
      ["Time", "Event", "Reference", "Method", "Amount"],
      mockDB.payEvents
        .slice(0, 20)
        .map((e) => [
          e.time,
          `<code class="text-xs">${e.type}</code>`,
          `<code class="text-xs">${e.ref}</code>`,
          e.method,
          fmt(e.amount),
        ]),
      "",
      "No gateway events yet.",
    )
  );
};
R["a-reports"] = () =>
  tbl(
    "Reports / Complaints",
    ["Report ID", "Reporter", "Target", "Reason", "Date", "Status", "Actions"],
    mockDB.reports.map((r) => [
      r.id,
      r.reporter,
      r.target,
      r.reason,
      r.date,
      badge(r.status),
      r.status === "Open"
        ? `<button class="text-green-600" onclick="app.reportAct('${r.id}','Resolved')">Resolve</button> <button class="text-gray-600 ml-2" onclick="app.reportAct('${r.id}','Dismissed')">Dismiss</button>`
        : "—",
    ]),
    "",
    "No reports available for the selected period.",
  );
R["a-audit"] = () =>
  tbl(
    "Audit Logs",
    ["Timestamp", "User", "Role", "Action", "Target", "Previous", "New"],
    mockDB.auditLogs.map((l) => [
      l.time,
      l.user,
      l.role,
      l.action,
      l.target,
      l.prev || "—",
      l.next || "—",
    ]),
    "",
    "No audit entries.",
  );
R["a-settings"] = () => {
  const st = app.settings,
    N = (k, l, step) =>
      `<label class="block text-sm font-medium">${l}<input type="number" min="0" step="${step}" class="i mt-1" value="${st[k]}" onchange="app.setSetting('${k}',this.value)"></label>`;
  return `<div class="max-w-xl c p-6 space-y-4">${h("Settings")}<label class="block text-sm font-medium">Website name<input class="i mt-1" value="ShopHub"></label><label class="block text-sm font-medium">Shipping fee per seller shipment (₱)<input type="number" min="0" class="i mt-1" value="${app.shippingFee}" onchange="app.setShipFee(this.value)"></label>
${N("commission", "Platform commission on seller sales (%) - placeholder, set your own", 0.5)}${N("gatewayFee", "Estimated payment gateway fee (%) - placeholder, set to your PayMongo rate", 0.1)}${N("minPayout", "Minimum seller payout (₱)", 1)}
<div><p class="text-sm font-medium mb-1">Payment methods offered at checkout</p>${J(METHODS, (m) => `<label class="flex gap-2 text-sm py-0.5"><input type="checkbox" ${st.methods[m] ? "checked" : ""} onchange="app.toggleMethod('${m}',this)"> ${m}</label>`)}</div>
<div class="border rounded-lg p-3 text-sm space-y-1 bg-yellow-50 border-yellow-200 text-yellow-900"><p class="font-bold"><i class="fa-solid fa-plug"></i> Payment integration</p><p>Mode: <b>Simulation</b> (no real money moves).</p><p><b>Collections (customers pay):</b> PayMongo - GCash, Maya, GrabPay, QR Ph, online banking and cards.</p><p><b>Seller payouts:</b> PayMongo transfers if enabled on your account, otherwise Xendit disbursements, or a manual InstaPay / PESONet batch from the Payments ledger.</p><p class="text-xs">Secret keys must live on a server, never in this page. See README.md and server/server.js for a PayMongo Checkout + webhook example.</p></div>
<label class="flex gap-2 text-sm"><input type="checkbox" checked> Email notifications</label><button class="g text-red-600" onclick="app.modal('Reset Demo Data','Reload and restore all demo data?',()=>location.reload(),'Reset')">Reset Demo Data</button></div>`;
};

/* INITIALIZATION */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") app.closeModal();
});
window.addEventListener("DOMContentLoaded", async () => {
  await connectDatabaseCatalog();
  app.navigate("login");
});
