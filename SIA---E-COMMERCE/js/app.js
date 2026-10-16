/* DATABASE DEMO CONNECTION */
let databaseConnected = false;
async function connectDatabaseCatalog() {
  try {
    const response = await fetch("/api/catalog");
    if (!response.ok)
      throw new Error("Catalog API returned " + response.status);
    const data = await response.json(),
      rows = Array.isArray(data.products) ? data.products : [];
    const sellerIds = new Map();
    mockDB.products = rows.map((row) => {
      let sellerId = sellerIds.get(String(row.seller_id));
      if (!sellerId) {
        let seller = mockDB.users.find(
          (user) =>
            user.role === "seller" && user.storeName === row.seller_name,
        );
        if (!seller) {
          seller = {
            id: "dbseller-" + row.seller_id,
            name: row.seller_name,
            role: "seller",
            email: "seller-" + row.seller_id + "@shophub.local",
            storeName: row.seller_name,
            status: "Active",
          };
          mockDB.users.push(seller);
        }
        sellerId = seller.id;
        sellerIds.set(String(row.seller_id), sellerId);
      }
      const sku = String(row.sku || ""),
        seedId = sku.match(/^SKU-P(\d+)$/i);
      return {
        id: seedId ? "p" + seedId[1] : "dbp-" + row.product_id,
        dbProductId: Number(row.product_id),
        name: row.name,
        category: row.category_name,
        price: Number(row.price),
        orig: Number(row.original_price),
        stock: Number(row.stock),
        rating: Number(row.rating_avg),
        reviews: Number(row.review_count),
        img: row.image || "📦",
        sellerId,
        sellerName: row.seller_name,
        sku,
        status: row.status,
        desc: row.description || "",
      };
    });
    if (Array.isArray(data.categories) && data.categories.length)
      mockDB.categories = data.categories.map((category) => category.name);
    databaseConnected = true;
    return true;
  } catch (error) {
    console.warn(
      "ShopHub database catalog is unavailable; using the browser demo catalog.",
      error.message,
    );
    return false;
  }
}

/* APPLICATION STATE */
const app = {
  currentUser: null,
  cart: [],
  saved: [],
  wishlist: ["p2", "p4"],
  compareList: [],
  activeVoucher: null,
  shopV: {},
  vmsg: "",
  payAcct: null,
  pending: null,
  settings: {
    commission: 5,
    gatewayFee: 2.5,
    minPayout: 100,
    methods: Object.fromEntries(METHODS.map((m) => [m, true])),
  },
  shippingFee: 50,
  q: "",
  cat: "",
  tab: "All",
  range: "year",
  ofilter: "",
  ostatus: "",
  view: "login",
  params: {},
  viewed: [],
  searches: [],
  addr: {
    name: "Jessica Mae",
    phone: "0912 345 6789",
    region: "NCR",
    province: "Metro Manila",
    city: "Makati",
    barangay: "Bel-Air",
    street: "123 Ayala Ave",
    zip: "1209",
  },
  pay: "Cash on Delivery",
  after: null,
  placing: false,
  formatPH: fmt,
  role() {
    return this.currentUser ? this.currentUser.role : "guest";
  },
  now() {
    return TODAY + " " + new Date().toTimeString().slice(0, 5);
  },
  toast(m, t) {
    const e = $("toast");
    e.textContent = m;
    e.style.background =
      t === "error" ? "#b91c1c" : t === "success" ? "#15803d" : "#111827";
    e.classList.remove("opacity-0", "translate-y-5");
    clearTimeout(this._t);
    this._t = setTimeout(
      () => e.classList.add("opacity-0", "translate-y-5"),
      2800,
    );
  },
  modal(title, body, cb, ok = "Confirm", no = "Cancel") {
    $("mt").textContent = title;
    $("mb").innerHTML = body;
    $("mo").textContent = ok;
    $("mo").style.display = cb ? "" : "none";
    $("mx").textContent = cb ? no : "Close";
    $("mo").onclick = () => {
      if (cb() !== false) app.closeModal();
    };
    $("modal").classList.remove("hidden");
    $("modal").classList.add("flex");
    (cb
      ? $("mb").querySelector("input,select,textarea") || $("mo")
      : $("mx")
    ).focus();
  },
  closeModal() {
    $("modal").classList.add("hidden");
    $("modal").classList.remove("flex");
    $("mx").style.display = "";
  },
  confirm(msg, cb, ok, no) {
    this.modal("Please confirm", msg, cb, ok, no);
  },
  form(title, fields, cb, ok = "Save") {
    this.modal(
      title,
      J(
        fields,
        ([k, l, v, t, o]) =>
          `<label class="block text-sm font-medium">${l}${t === "select" ? `<select id="f_${k}" class="i mt-1">${J(o, (x) => `<option ${x == v ? "selected" : ""}>${x}</option>`)}</select>` : t === "textarea" ? `<textarea id="f_${k}" class="i mt-1" rows="3">${esc(v)}</textarea>` : `<input id="f_${k}" type="${t || "text"}" class="i mt-1" value="${esc(v)}">`}</label>`,
      ),
      () => {
        const v = {};
        fields.forEach((f) => (v[f[0]] = $("f_" + f[0]).value));
        return cb(v);
      },
      ok,
    );
  },
  audit(action, target, prev = "", next = "") {
    const u = this.currentUser;
    if (u)
      mockDB.auditLogs.unshift({
        time: this.now(),
        user: u.name,
        role: u.role,
        action,
        target,
        prev,
        next,
      });
  },
  notify(userId, title, desc, type = "info") {
    mockDB.notifications.unshift({
      id: Date.now() + Math.random(),
      userId,
      title,
      desc,
      read: false,
      type,
      date: TODAY,
    });
  },
  refresh() {
    this.navigate(this.view, this.params);
  },

  /* AUTHENTICATION */
  loginForm() {
    const e = $("em").value.trim(),
      p = $("pw").value;
    if (!e || !p)
      return ($("lerr").textContent = "Email and password are required.");
    this.login(e);
  },
  login(email) {
    const u = mockDB.users.find((x) => x.email === email.trim().toLowerCase());
    if (!u) {
      const e = $("lerr");
      if (e) e.textContent = "Invalid email or password.";
      return;
    }
    if (u.status === "Suspended")
      return this.toast(
        "This account is suspended. Please contact support.",
        "error",
      );
    if (u.status === "Rejected")
      return this.modal(
        "Application rejected",
        "Your seller application was rejected. Please contact support.",
      );
    this.currentUser = u;
    this.toast("Welcome, " + u.name + "!", "success");
    const a = this.after;
    this.after = null;
    this.navigate(a ? a.v : HOME[u.role], a ? a.p : {});
  },
  logout() {
    this.currentUser = null;
    this.cart = [];
    this.saved = [];
    this.activeVoucher = null;
    this.shopV = {};
    this.payAcct = null;
    this.pending = null;
    this.navigate("login");
    this.toast("Logged out");
  },
  togglePw(id, b) {
    const i = $(id),
      show = i.type === "password";
    i.type = show ? "text" : "password";
    b.innerHTML =
      '<i class="fa-solid ' + (show ? "fa-eye-slash" : "fa-eye") + '"></i>';
    b.setAttribute("aria-label", show ? "Hide password" : "Show password");
  },
  signup() {
    const v = (k) => $(k).value.trim(),
      e = $("sperr"),
      n = v("sn"),
      m = v("se").toLowerCase(),
      p = $("spw").value;
    if (!n || !m || !p)
      return (e.textContent = "Name, email and password are required.");
    if (!/^\S+@\S+\.\S+$/.test(m))
      return (e.textContent = "Enter a valid email address.");
    if (p.length < 8)
      return (e.textContent = "Password must be at least 8 characters.");
    if (p !== $("spc").value)
      return (e.textContent = "Passwords do not match.");
    if (mockDB.users.some((u) => u.email === m))
      return (e.textContent = "This email is already registered.");
    mockDB.users.push({
      id: "u" + Date.now(),
      name: esc(n),
      role: "customer",
      email: m,
      phone: esc(v("sp")),
      status: "Active",
      registered: TODAY,
    });
    this.toast("Account created. Welcome to ShopHub!", "success");
    this.login(m);
  },

  /* NAVIGATION */
  navigate(v, p = {}) {
    const r = this.role(),
      allow = {
        guest: PUB,
        customer: [...PUB, ...CUS],
        seller: SEL,
        admin: ADM,
      }[r];
    if (r === "guest" && !PUB.includes(v)) {
      this.toast("Please login to continue", "error");
      this.after = { v, p };
      v = "login";
    } else if (!allow.includes(v)) {
      v = PUB.includes(v) && r !== "guest" ? HOME[r] : "denied";
    }
    if (r !== "guest" && (v === "login" || v === "signup")) v = HOME[r];
    this.view = v;
    this.params = p;
    const f = R[v];
    $("main").innerHTML = f(p);
    window.scrollTo(0, 0);
    this.layout();
    if (f.after) f.after();
  },
  layout() {
    const u = this.currentUser,
      r = this.role(),
      cus = r === "customer";
    $("who").innerHTML = u
      ? `<span class="text-sm font-medium hidden sm:inline">${esc(u.name)} — ${r[0].toUpperCase() + r.slice(1)}</span><button class="g text-red-600 text-sm" onclick="app.logout()">Logout</button>`
      : `<button class="b text-sm" onclick="app.navigate('login')">Login / Sign Up</button>`;
    $("brand").innerHTML =
      '<i class="fa-solid fa-store"></i> ShopHub' +
      (r === "seller"
        ? ' <span class="text-gray-500 text-sm">Seller Center</span>'
        : r === "admin"
          ? ' <span class="text-gray-500 text-sm">Admin Console</span>'
          : "");
    const L = (v, t) =>
      `<a href="#" onclick="app.navigate('${v}');return false" class="whitespace-nowrap ${this.view === v ? "text-primary font-bold" : "text-gray-600"}">${t}</a>`;
    const links = [
      ["home", "Home"],
      ["catalog", "Product"],
      ["categories", "Categories"],
      ["sellers", "Shop"],
      ["track", "Track Parcel"],
    ].concat(
      cus
        ? [
            ["dashboard", "Dashboard"],
            ["orders", "Orders"],
            ["recs", "Recommendations"],
            ["vouchers", "Vouchers"],
            ["wallet", "Payment Methods"],
          ]
        : [],
    );
    $("nav").innerHTML = J(links, (x) => L(...x));
    $("nav").classList.toggle("hidden", r === "seller" || r === "admin");
    const unread = u
      ? mockDB.notifications.filter((n) => n.userId === u.id && !n.read).length
      : 0;
    $("acts").innerHTML = cus
      ? J(
          [
            ["compare", "fa-code-compare", this.compareList.length],
            ["wishlist", "fa-heart", this.wishlist.length],
            [
              "cart",
              "fa-cart-shopping",
              this.cart.reduce((a, i) => a + i.qty, 0),
            ],
            ["notifications", "fa-bell", unread],
          ],
          ([v, i, n]) =>
            `<button class="relative text-gray-500 hover:text-primary" aria-label="${v}" onclick="app.navigate('${v}')"><i class="fa-solid ${i} text-lg"></i>${n ? `<span class="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold px-1.5 rounded-full">${n}</span>` : ""}</button>`,
        )
      : "";
    const m = MENU[r];
    $("side").className = m
      ? "md:w-56 shrink-0 flex md:block gap-1 overflow-x-auto mb-4 md:mb-0 md:space-y-1"
      : "hidden";
    $("side").innerHTML = m
      ? J(
          m,
          ([v, t, i]) =>
            `<button onclick="app.navigate('${v}')" class="w-full text-left whitespace-nowrap px-3 py-2 rounded-lg text-sm ${this.view === v ? "bg-blue-50 text-primary font-bold" : "text-gray-600 hover:bg-white"}"><i class="fa-solid ${i} w-5"></i> ${t}</button>`,
        )
      : "";
  },

  /* CUSTOMER FUNCTIONS */
  needCustomer() {
    if (this.role() !== "customer") {
      this.toast("Please login as a customer first.", "error");
      this.after = null;
      this.navigate("login");
      return false;
    }
    return true;
  },
  addToCart(id, q = 1) {
    if (!this.needCustomer()) return;
    const p = P(id),
      e = this.cart.find((i) => i.productId === id);
    if (!p.stock) return this.toast("Out of stock", "error");
    if ((e ? e.qty : 0) + q > p.stock)
      return this.toast("Only " + p.stock + " in stock", "error");
    if (e) e.qty += q;
    else this.cart.push({ productId: id, qty: q });
    this.toast("Added to cart", "success");
    this.refresh();
  },
  qty(id, d) {
    const i = this.cart.find((x) => x.productId === id),
      p = P(id);
    i.qty += d;
    if (i.qty < 1) this.cart = this.cart.filter((x) => x !== i);
    else if (i.qty > p.stock) {
      i.qty = p.stock;
      this.toast("Maximum stock reached", "error");
    }
    this.refresh();
  },
  removeFromCart(id) {
    this.cart = this.cart.filter((x) => x.productId !== id);
    this.refresh();
  },
  saveLater(id) {
    const i = this.cart.find((x) => x.productId === id);
    this.cart = this.cart.filter((x) => x !== i);
    this.saved.push(i);
    this.toast("Saved for later");
    this.refresh();
  },
  moveToCart(id) {
    const i = this.saved.find((x) => x.productId === id);
    this.saved = this.saved.filter((x) => x !== i);
    const e = this.cart.find((x) => x.productId === id);
    if (e) e.qty = Math.min(P(id).stock, e.qty + i.qty);
    else this.cart.push(i);
    this.refresh();
  },
  toggleWishlist(id) {
    if (!this.needCustomer()) return;
    const i = this.wishlist.indexOf(id);
    i > -1 ? this.wishlist.splice(i, 1) : this.wishlist.push(id);
    this.toast(
      i > -1 ? "Removed from wishlist" : "Added to wishlist",
      "success",
    );
    this.refresh();
  },
  toggleCompare(id) {
    if (!this.needCustomer()) return;
    const i = this.compareList.indexOf(id);
    if (i > -1) this.compareList.splice(i, 1);
    else {
      if (this.compareList.length >= 4)
        return this.toast("Maximum 4 products can be compared", "error");
      this.compareList.push(id);
    }
    this.refresh();
  },
  sub() {
    return this.cart.reduce((s, i) => s + P(i.productId).price * i.qty, 0);
  },
  elig(v) {
    return this.cart.filter((i) => {
      const p = P(i.productId);
      return (
        (!v.category || p.category === v.category) &&
        (!v.seller || p.sellerId === v.seller)
      );
    });
  },
  eligible(v) {
    return this.elig(v).length > 0;
  },
  vBase(v, items) {
    return (items || this.cart).reduce((s, i) => {
      const p = P(i.productId);
      return (
        s +
        ((!v.category || p.category === v.category) &&
        (!v.seller || p.sellerId === v.seller)
          ? p.price * i.qty
          : 0)
      );
    }, 0);
  },
  vLabel(v) {
    return v.type === "fixed"
      ? fmt(v.value) + " off"
      : v.type === "percent"
        ? v.value + "% off" + (v.cap ? " (max " + fmt(v.cap) + ")" : "")
        : "Free shipping" + (v.cap ? " (up to " + fmt(v.cap) + ")" : "");
  },
  vUsed(v, uid) {
    return mockDB.redemptions.filter(
      (r) => r.code === v.code && r.userId === uid,
    ).length;
  },
  isNew(uid) {
    return !mockDB.orders.some((o) => o.customerId === uid && okO(o));
  },
  vcheck(v) {
    const base = this.vBase(v);
    return v.status !== "Active"
      ? "This voucher is not active."
      : v.expiry < TODAY
        ? "This voucher has expired."
        : v.seller && U(v.seller).status !== "Active"
          ? "This shop is unavailable."
          : v.limit && v.uses >= v.limit
            ? "This voucher has been fully redeemed."
            : v.perUser && this.vUsed(v, me()) >= v.perUser
              ? "You have already used this voucher " +
                (v.perUser === 1 ? "once." : v.perUser + " times.")
              : v.firstOrder && !this.isNew(me())
                ? "For first-time customers only."
                : !this.cart.length
                  ? "Your cart is empty."
                  : !base
                    ? "No eligible items in your cart."
                    : base < v.min
                      ? "Spend " +
                        fmt(v.min) +
                        (v.category || v.seller ? " on eligible items" : "") +
                        " or more to use this."
                      : null;
  },
  prune() {
    const bad = [];
    if (this.activeVoucher) {
      const e = this.vcheck(this.activeVoucher);
      if (e) {
        bad.push(this.activeVoucher.code + " removed: " + e);
        this.activeVoucher = null;
      }
    }
    Object.keys(this.shopV).forEach((k) => {
      const e = this.vcheck(this.shopV[k]);
      if (e) {
        bad.push(this.shopV[k].code + " removed: " + e);
        delete this.shopV[k];
      }
    });
    if (bad.length) this.vmsg = bad.join(" ");
  },
  totals() {
    this.prune();
    const gs = {};
    this.cart.forEach((i) => {
      const p = P(i.productId),
        g = (gs[p.sellerId] = gs[p.sellerId] || {
          sellerId: p.sellerId,
          items: [],
          sub: 0,
        });
      g.items.push(i);
      g.sub += p.price * i.qty;
    });
    const G = Object.values(gs),
      pv = this.activeVoucher,
      sm = (a, f) => a.reduce((x, y) => x + f(y), 0);
    G.forEach((g) => {
      Object.assign(g, {
        ship: this.shippingFee,
        shopDisc: 0,
        platDisc: 0,
        shipDiscShop: 0,
        shipDiscPlat: 0,
        shop: this.shopV[g.sellerId] || null,
      });
      const v = g.shop;
      if (v) {
        const base = this.vBase(v, g.items);
        if (v.type === "fixed") g.shopDisc = Math.min(v.value, base);
        else if (v.type === "percent")
          g.shopDisc = Math.min((base * v.value) / 100, v.cap || Infinity);
        else g.shipDiscShop = Math.min(g.ship, v.cap || g.ship);
      }
    });
    if (pv) {
      const bases = G.map((g) =>
          Math.min(this.vBase(pv, g.items), g.sub - g.shopDisc),
        ),
        tb = sm(bases, (x) => x);
      if (pv.type === "shipping") {
        const room = G.map((g) => g.ship - g.shipDiscShop),
          tr = sm(room, (x) => x),
          tot = Math.min(tr, pv.cap || tr);
        G.forEach((g, i) => (g.shipDiscPlat = tr ? (tot * room[i]) / tr : 0));
      } else {
        const tot =
          pv.type === "fixed"
            ? Math.min(pv.value, tb)
            : Math.min((tb * pv.value) / 100, pv.cap || Infinity);
        G.forEach((g, i) => (g.platDisc = tb ? (tot * bases[i]) / tb : 0));
      }
    }
    G.forEach((g) => {
      ["shopDisc", "platDisc", "shipDiscShop", "shipDiscPlat"].forEach(
        (k) => (g[k] = R2(g[k])),
      );
      g.shipDisc = R2(g.shipDiscShop + g.shipDiscPlat);
      g.total = R2(g.sub - g.shopDisc - g.platDisc + g.ship - g.shipDisc);
    });
    const vl = [];
    G.forEach((g) => {
      if (g.shop && g.shopDisc > 0)
        vl.push([g.shop.code + " (Shop)", g.shopDisc]);
    });
    if (pv) {
      const pd = R2(sm(G, (g) => g.platDisc));
      if (pd > 0) vl.push([pv.code + " (Platform)", pd]);
    }
    const sub = sm(G, (g) => g.sub),
      shipping = sm(G, (g) => g.ship),
      shipDisc = R2(sm(G, (g) => g.shipDisc)),
      discount = R2(sm(G, (g) => g.shopDisc + g.platDisc));
    return {
      groups: G,
      n: G.length,
      pv,
      sub,
      shipping,
      shipDisc,
      discount,
      vlines: vl,
      total: R2(sub - discount + shipping - shipDisc),
    };
  },
  applyVoucher(code, go) {
    code = (code === undefined ? ($("vc") || {}).value || "" : code)
      .trim()
      .toUpperCase();
    if (!code) return this.toast("Enter a voucher code.", "error");
    const v = mockDB.vouchers.find((x) => x.code === code);
    if (!v) return this.toast("Invalid voucher code.", "error");
    const e = this.vcheck(v);
    if (e) return this.toast(e, "error");
    const rep = v.seller ? this.shopV[v.seller] : this.activeVoucher;
    if (v.seller) this.shopV[v.seller] = v;
    else this.activeVoucher = v;
    this.toast(
      code +
        " applied" +
        (rep && rep.code !== code ? " (replaced " + rep.code + ")" : ""),
      "success",
    );
    go ? this.navigate("cart") : this.refresh();
  },
  removeVoucher(sid) {
    if (sid) delete this.shopV[sid];
    else this.activeVoucher = null;
    this.refresh();
  },
  setV(sid, code) {
    if (!code) return this.removeVoucher(sid);
    this.applyVoucher(code);
  },
  renderCart() {
    return R.cart();
  },
  renderCheckout() {
    return R.checkout();
  },
  renderWishlist() {
    return R.wishlist();
  },
  renderCompare() {
    return R.compare();
  },
  placeOrder() {
    if (this.placing || !this.cart.length) return;
    const a = this.addr,
      miss = [
        "name",
        "phone",
        "region",
        "province",
        "city",
        "barangay",
        "street",
        "zip",
      ].filter((k) => !(a[k] || "").trim());
    if (miss.length) {
      $("aerr").textContent = "Please complete: " + miss.join(", ");
      return this.toast("Incomplete delivery address", "error");
    }
    if (!REGION_GROUP[a.region]) {
      $("aerr").textContent = "Please select your region.";
      return this.toast("Select a region", "error");
    }
    if (!/^(\+63|0)9\d{9}$/.test((a.phone || "").replace(/[\s-]/g, ""))) {
      $("aerr").textContent =
        "Enter a valid PH mobile number, e.g. 0917 123 4567.";
      return this.toast("Invalid mobile number", "error");
    }
    const T = this.totals();
    if (this.vmsg) {
      this.toast(this.vmsg, "error");
      this.vmsg = "";
      return this.refresh();
    }
    this.pending = { T, addr: { ...a }, pay: this.pay };
    if (this.pay === "Cash on Delivery") return this.finalize(null);
    this.payModal();
  },
  /* ---- PAYMENTS (PayMongo-style simulation) ----
   PRODUCTION NOTE: browsers must never hold the PayMongo secret key. Replace payModal()/payOk()/payFail() with:
   1) POST /api/pay on YOUR server -> server calls PayMongo (Checkout Session or Payment Intent) with the secret key
   2) redirect the customer to the returned checkout/redirect URL
   3) a webhook endpoint on your server receives payment.paid / payment.failed and calls finalize()/payFail()
   4) refunds: server-side PayMongo refund call from setStatus() when an order is cancelled/returned
   Check the current PayMongo API docs for exact endpoints and fields.
   A runnable example of steps 1-3 is in /server/server.js (see README.md). */
  payEvent(type, ref, amount, method) {
    mockDB.payEvents.unshift({ time: this.now(), type, ref, amount, method });
  },
  busy(msg) {
    $("mb").innerHTML =
      `<div class="text-center py-6"><i class="fa-solid fa-spinner fa-spin text-3xl text-primary"></i><p class="mt-3">${msg}</p></div>`;
    $("mo").style.display = "none";
    $("mx").style.display = "none";
  },
  payModal() {
    const Q = this.pending,
      m = Q.pay,
      T = Q.T,
      ref = "pi_" + rid(),
      acct = this.payAcct
        ? mockDB.linked.find((x) => x.id === this.payAcct)
        : null,
      W = ["GCash", "Maya", "GrabPay"];
    this.payEvent("payment_intent.created", ref, T.total, m);
    const res = (a, b) =>
      `<label class="block text-sm font-medium mt-2">Simulated result<select id="pr" class="i mt-1"><option value="ok">${a}</option><option value="no">${b}</option></select></label>`;
    let body = `<p class="text-xs bg-yellow-50 border border-yellow-200 text-yellow-800 p-2 rounded">PayMongo sandbox simulation. No real money moves and no real card or account details are processed.</p><p>Amount due: <b>${fmt(T.total)}</b> &middot; Intent <code class="text-xs">${ref}</code></p>`;
    if (W.includes(m))
      body +=
        (acct
          ? `<p>Paying with your linked ${esc(m)} account <b>&bull;&bull;&bull;&bull; ${acct.last4}</b>.</p>`
          : `<p>You will be redirected to ${esc(m)} to log in and authorize this payment (simulated).</p>`) +
        res("Authorize payment (success)", "Decline payment (failure)");
    else if (m === "QR Ph")
      body +=
        qrSvg(ref) +
        '<p class="text-center text-xs">Scan with any QR Ph-enabled banking or e-wallet app.</p>' +
        res("I scanned and paid (success)", "QR code expired (failure)");
    else if (m === "Online Banking")
      body +=
        `<label class="block text-sm font-medium">Your bank<select id="pb" class="i mt-1">${J(["BDO", "BPI", "UnionBank", "Landbank", "Metrobank"], (b) => `<option ${acct && acct.provider === b ? "selected" : ""}>${b}</option>`)}</select></label><p class="text-xs">You will be redirected to your bank's online banking page to approve the payment (simulated).</p>` +
        res(
          "Approve in online banking (success)",
          "Cancelled / insufficient funds (failure)",
        );
    else
      body += `<div class="grid grid-cols-2 gap-2"><label class="col-span-2 block text-sm font-medium">Card number<input id="pc" class="i mt-1" inputmode="numeric" autocomplete="off" placeholder="1234 5678 9012 3456"></label><label class="block text-sm font-medium">Expiry (MM/YY)<input id="pe" class="i mt-1" autocomplete="off" placeholder="12/28"></label><label class="block text-sm font-medium">CVC<input id="pv" class="i mt-1" inputmode="numeric" autocomplete="off" type="password"></label><label class="col-span-2 block text-sm font-medium">Name on card<input id="pn" class="i mt-1" autocomplete="off" value="${esc(Q.addr.name)}"></label></div><p class="text-xs">Simulation only: use a made-up number. A number ending in 0002 simulates a decline.</p>`;
    this.modal(
      "PayMongo Checkout (Simulated)",
      body,
      () => {
        let ok = !$("pr") || $("pr").value === "ok",
          why =
            m === "QR Ph"
              ? "the QR code expired."
              : m === "Online Banking"
                ? "the bank payment was not approved."
                : "the payment was declined.";
        if (m === "Credit/Debit Card") {
          const n = $("pc").value.replace(/\D/g, "");
          if (
            n.length < 13 ||
            n.length > 19 ||
            !/^(0[1-9]|1[0-2])\/\d{2}$/.test($("pe").value.trim()) ||
            !/^\d{3,4}$/.test($("pv").value) ||
            !$("pn").value.trim()
          ) {
            this.toast(
              "Enter a valid card number, expiry (MM/YY), CVC and name.",
              "error",
            );
            return false;
          }
          ok = !n.endsWith("0002");
          why = "the card was declined (insufficient funds).";
        }
        this.busy("Processing payment...");
        setTimeout(() => (ok ? this.payOk(ref) : this.payFail(ref, why)), 900);
        return false;
      },
      "Pay " + fmt(T.total),
    );
  },
  payOk(ref) {
    this.closeModal();
    if (!this.pending) return;
    this.payEvent("payment.paid", ref, this.pending.T.total, this.pending.pay);
    this.finalize(ref);
  },
  payFail(ref, why) {
    this.closeModal();
    if (!this.pending) return;
    this.payEvent(
      "payment.failed",
      ref,
      this.pending.T.total,
      this.pending.pay,
    );
    this.pending = null;
    this.toast(
      "Payment failed: " +
        why +
        " You were not charged. Try again or choose another method.",
      "error",
    );
    this.refresh();
  },
  async finalize(ref) {
    const Q = this.pending;
    if (!Q || this.placing) return;
    this.placing = true;
    const T = Q.T,
      a = Q.addr,
      cod = Q.pay === "Cash on Delivery",
      made = [],
      orderRefs = new Map(T.groups.map((g) => [g.sellerId, this.newOrderId()]));
    if (databaseConnected) {
      if (!cod) {
        this.placing = false;
        this.toast(
          "The connected database demo currently supports Cash on Delivery.",
          "error",
        );
        return;
      }
      try {
        const response = await fetch("/api/demo/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerEmail: this.currentUser.email,
            address: a,
            paymentMethod: Q.pay,
            groups: T.groups.map((g) => ({
              orderNumber: orderRefs.get(g.sellerId),
              items: g.items.map((i) => ({
                sku: P(i.productId).sku,
                quantity: i.qty,
              })),
              itemDiscount: R2(g.shopDisc + g.platDisc),
              shippingFee: g.ship,
              shippingDiscount: g.shipDisc,
            })),
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || "The database did not accept the order.",
          );
      } catch (error) {
        this.placing = false;
        this.toast(
          error.message || "Could not save the order to the database.",
          "error",
        );
        return;
      }
    }
    T.groups.forEach((g) => {
      const o = {
        id: orderRefs.get(g.sellerId),
        customerId: me(),
        sellerId: g.sellerId,
        items: g.items.map((i) => ({
          productId: i.productId,
          qty: i.qty,
          price: P(i.productId).price,
        })),
        sub: g.sub,
        ship: g.ship,
        shipDisc: g.shipDisc,
        disc: R2(g.shopDisc + g.platDisc),
        total: g.total,
        status: "Pending",
        date: TODAY,
        pay: Q.pay,
        payStatus: cod ? "Unpaid" : "Paid",
        payRef: cod ? null : ref,
        addr: { ...a },
        vouchers: [],
        sellerFunded: R2(g.shopDisc + g.shipDiscShop),
        commission: R2(((g.sub - g.shopDisc) * this.settings.commission) / 100),
        timeline: [
          { status: "Order Placed", time: this.now() },
          { status: "Payment Confirmed", time: this.now() },
        ],
      };
      if (g.shop)
        o.vouchers.push({
          code: g.shop.code,
          scope: "Shop",
          item: g.shopDisc,
          ship: g.shipDiscShop,
        });
      if (T.pv)
        o.vouchers.push({
          code: T.pv.code,
          scope: "Platform",
          item: g.platDisc,
          ship: g.shipDiscPlat,
        });
      o.vouchers = o.vouchers.filter((v) => v.item > 0 || v.ship > 0);
      o.payout = Math.max(0, R2(g.sub - o.sellerFunded - o.commission));
      g.items.forEach((i) => (P(i.productId).stock -= i.qty));
      mockDB.orders.unshift(o);
      made.push(o);
      this.notify(
        me(),
        "Order Confirmed",
        "Your order " + o.id + " has been placed.",
        "order",
      );
      this.notify(
        g.sellerId,
        "New order",
        o.id + " needs processing.",
        "order",
      );
      this.notify(
        "u3",
        "New order",
        o.id + " placed on the platform.",
        "order",
      );
    });
    new Set(
      T.groups
        .map((g) => g.shop)
        .filter(Boolean)
        .concat(T.pv ? [T.pv] : []),
    ).forEach((v) => {
      v.uses++;
      mockDB.redemptions.push({
        code: v.code,
        userId: me(),
        orders: made.map((o) => o.id),
        date: TODAY,
      });
    });
    this.cart = [];
    this.activeVoucher = null;
    this.shopV = {};
    this.pending = null;
    this.placing = false;
    this.payAcct = null;
    this.toast(
      made.length > 1
        ? made.length + " orders placed (one shipment per seller)"
        : "Order placed successfully!",
      "success",
    );
    this.navigate("tracking", { id: made[0].id, placed: true });
  },
  newOrderId() {
    let id;
    do {
      id = "ORD-" + Math.floor(10000 + Math.random() * 89999);
    } while (mockDB.orders.some((x) => x.id === id));
    return id;
  },
  /* A cancelled/returned order gives its voucher uses back (unless another live order from the same checkout still used it) */
  restoreVouchers(o) {
    const back = [];
    (o.vouchers || []).forEach((x) => {
      const r = mockDB.redemptions.find(
        (y) =>
          y.code === x.code &&
          y.userId === o.customerId &&
          y.orders.includes(o.id),
      );
      if (!r) return;
      r.orders = r.orders.filter((i) => i !== o.id);
      if (
        !r.orders.some((i) => {
          const q = mockDB.orders.find((z) => z.id === i);
          return q && okO(q);
        })
      ) {
        mockDB.redemptions = mockDB.redemptions.filter((y) => y !== r);
        const v = mockDB.vouchers.find((y) => y.code === x.code);
        if (v && v.uses > 0) v.uses--;
        back.push(x.code);
      }
    });
    if (back.length)
      this.notify(
        o.customerId,
        "Voucher restored",
        back.join(", ") +
          " can be used again because " +
          o.id +
          " was not completed.",
        "promo",
      );
  },
  cancelOrder(id) {
    this.confirm(
      "Are you sure you want to cancel this order?",
      () => {
        const o = mockDB.orders.find((x) => x.id === id);
        if (!["Pending", "Processing"].includes(o.status))
          return this.toast("This order can no longer be cancelled", "error");
        if (databaseConnected) {
          this.cancelConnectedOrder(id);
          return false;
        }
        this.setStatus(id, "Cancelled");
        this.notify(
          o.sellerId,
          "Order cancelled",
          id + " was cancelled by the customer.",
          "order",
        );
        this.refresh();
      },
      "Cancel Order",
      "Keep Order",
    );
  },
  async cancelConnectedOrder(id) {
    try {
      const response = await fetch(
        "/api/demo/orders/" + encodeURIComponent(id) + "/cancel",
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not cancel the database order.");
      const order = mockDB.orders.find((item) => item.id === id);
      this.setStatus(id, "Cancelled");
      this.notify(
        order.sellerId,
        "Order cancelled",
        id + " was cancelled by the customer.",
        "order",
      );
      this.closeModal();
      this.refresh();
    } catch (error) {
      this.toast(
        error.message || "Could not cancel the database order.",
        "error",
      );
    }
  },
  sev(o, text) {
    o.shp.events.push({ time: this.now(), text });
  },
  book(o, opt = {}) {
    const c =
        (opt.courier && mockDB.couriers.find((x) => x.name === opt.courier)) ||
        mockDB.couriers.find((x) => x.enabled) ||
        mockDB.couriers[0],
      a = o.addr || this.addr;
    o.shp = {
      courier: c.name,
      tracking: c.prefix + String(Math.floor(1e9 + Math.random() * 9e9)),
      weight: opt.weight || 1,
      note: opt.note || "",
      attempts: 0,
      eta: etaRange(a.region, TODAY),
      events: [],
    };
    this.sev(
      o,
      "Shipment booked with " + c.name + " (tracking " + o.shp.tracking + ")",
    );
    this.sev(o, "Picked up from " + U(o.sellerId).storeName);
  },
  setStatus(id, st, opt = {}) {
    const o = mockDB.orders.find((x) => x.id === id),
      prev = o.status;
    if (prev === st) return;
    o.status = st;
    const a = o.addr || this.addr;
    if (["Cancelled", "Returned"].includes(st)) {
      o.items.forEach((i) => (P(i.productId).stock += i.qty));
      this.restoreVouchers(o);
      if (o.payStatus === "Paid" && o.pay !== "Cash on Delivery") {
        o.payStatus = "Refunded";
        this.payEvent("refund.created", o.payRef || "-", o.total, o.pay);
        this.notify(
          o.customerId,
          "Refund initiated",
          "Refund of " +
            fmt(o.total) +
            " for " +
            o.id +
            " will go back to your original payment method (simulated).",
          "promo",
        );
      }
    }
    if (st === "Shipped") this.book(o, opt);
    if (st === "Out for Delivery" && o.shp) {
      this.sev(o, "Arrived at sorting hub");
      this.sev(o, "Departed for destination: " + a.city + ", " + a.province);
      this.sev(o, "Arrived at " + a.city + " delivery hub");
      this.sev(
        o,
        "Out for delivery (attempt " +
          (o.shp.attempts + 1) +
          " of " +
          MAX_ATTEMPTS +
          ")",
      );
    }
    if (st === "Completed") {
      o.payStatus = "Paid";
      if (o.shp) {
        this.sev(
          o,
          "Delivered to recipient" + (opt.by ? " - received by " + opt.by : ""),
        );
        if (opt.by) o.shp.receivedBy = opt.by;
      }
      if (o.pay === "Cash on Delivery") {
        o.codCollected = true;
        if (o.shp) this.sev(o, "Cash on delivery collected: " + fmt(o.total));
      }
    }
    if (st === "Returned" && o.shp)
      this.sev(
        o,
        "Returned to sender after " +
          o.shp.attempts +
          " failed delivery attempts",
      );
    o.timeline.push({ status: LBL[st] || st, time: this.now() });
    this.notify(
      o.customerId,
      "Order " + (LBL[st] || st),
      "Your order " +
        o.id +
        " is now: " +
        (LBL[st] || st) +
        "." +
        (st === "Shipped"
          ? " Courier: " +
            o.shp.courier +
            ", tracking no. " +
            o.shp.tracking +
            "."
          : ""),
      "order",
    );
    if (this.role() !== "customer")
      this.audit("Updated Order Status", o.id, prev, st);
    this.toast("Order -> " + (LBL[st] || st), "success");
  },
  advance(id) {
    const o = mockDB.orders.find((x) => x.id === id),
      n = ST[ST.indexOf(o.status) + 1];
    if (!n || n === "Cancelled") return;
    this.setStatus(id, n);
    this.refresh();
  },
  failDelivery(id, why) {
    const o = mockDB.orders.find((x) => x.id === id);
    if (!o || !o.shp || o.status !== "Out for Delivery") return;
    o.shp.attempts++;
    this.sev(o, "Delivery attempt " + o.shp.attempts + " failed: " + why);
    if (this.role() !== "customer")
      this.audit(
        "Failed Delivery Attempt",
        o.id,
        String(o.shp.attempts - 1),
        String(o.shp.attempts),
      );
    if (o.shp.attempts >= MAX_ATTEMPTS) {
      this.setStatus(id, "Returned");
      this.notify(
        o.sellerId,
        "Parcel returned",
        id +
          " was returned after " +
          MAX_ATTEMPTS +
          " failed delivery attempts.",
        "order",
      );
    } else {
      this.sev(o, "Rescheduled: next delivery attempt tomorrow");
      this.sev(
        o,
        "Out for delivery (attempt " +
          (o.shp.attempts + 1) +
          " of " +
          MAX_ATTEMPTS +
          ")",
      );
      this.notify(
        o.customerId,
        "Delivery attempt failed",
        "Attempt " +
          o.shp.attempts +
          " for " +
          id +
          " failed (" +
          why +
          "). The courier will try again tomorrow.",
        "order",
      );
      this.toast(
        "Failed attempt " +
          o.shp.attempts +
          " of " +
          MAX_ATTEMPTS +
          " recorded",
        "error",
      );
    }
  },
  simFail(id) {
    this.failDelivery(id, "Recipient unavailable");
    this.refresh();
  },
  dlReceipt(id) {
    const o = mockDB.orders.find((x) => x.id === id),
      a = o.addr || {},
      t =
        `ShopHub Receipt\nOrder: ${o.id}\nDate: ${o.date}\nPayment: ${o.pay} (${o.payStatus})${o.payRef ? "\nPayment ref: " + o.payRef : ""}\nShip to: ${[a.name, a.street, a.barangay, a.city, a.province, a.region, a.zip].filter(Boolean).join(", ")}${o.shp ? "\nCourier: " + o.shp.courier + " / " + o.shp.tracking : ""}\n\n` +
        o.items
          .map((i) => `${P(i.productId).name} x${i.qty}  ${i.price * i.qty}`)
          .join("\n") +
        `\n\nSubtotal: ${o.sub}\nShipping: ${o.ship}` +
        (o.shipDisc ? `\nShipping discount: -${o.shipDisc}` : "") +
        (o.vouchers || [])
          .filter((v) => v.item > 0)
          .map((v) => `\nVoucher ${v.code} (${v.scope}): -${v.item}`)
          .join("") +
        `\nTotal: ${o.total}`;
    this.dl("receipt-" + id + ".txt", t);
  },
  dl(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = name;
    a.click();
  },
  review(id) {
    this.form(
      "Write a Review",
      [
        ["rating", "Rating (1-5)", 5, "number"],
        ["text", "Your review", "", "textarea"],
      ],
      (v) => {
        const r = Math.round(+v.rating);
        if (!(r >= 1 && r <= 5) || !v.text.trim()) {
          this.toast("Enter a rating 1-5 and a review", "error");
          return false;
        }
        mockDB.reviews.push({
          id: "r" + Date.now(),
          productId: id,
          customerId: me(),
          rating: r,
          text: esc(v.text),
          date: TODAY,
        });
        const p = P(id);
        p.rating =
          Math.round(((p.rating * p.reviews + r) / (p.reviews + 1)) * 10) / 10;
        p.reviews++;
        this.toast("Review submitted", "success");
        this.refresh();
      },
      "Submit",
    );
  },
  report(t) {
    this.form(
      "Report",
      [["reason", "Reason", "", "textarea"]],
      (v) => {
        if (!v.reason.trim()) return false;
        mockDB.reports.push({
          id: "RPT-" + Math.floor(100 + Math.random() * 900),
          reporter: this.currentUser.name,
          target: t,
          reason: esc(v.reason),
          date: TODAY,
          status: "Open",
        });
        this.toast("Report sent to admin", "success");
      },
      "Send",
    );
  },
  score(p) {
    const mine = mockDB.orders.filter((o) => o.customerId === me()),
      cats = mine.flatMap((o) => o.items.map((i) => P(i.productId).category)),
      w = this.wishlist.map((i) => P(i).category),
      c = this.cart.map((i) => P(i.productId).category),
      n = (a, k) => a.filter((x) => x === k).length,
      all = mine.flatMap((o) => o.items.map((i) => i.price)),
      pref = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 3000;
    return (
      n(this.viewed, p.category) * 2 +
      n(cats, p.category) * 3 +
      n(w, p.category) * 2 +
      n(c, p.category) +
      p.rating +
      (this.searches.some(
        (s) => s && p.name.toLowerCase().includes(s.toLowerCase()),
      )
        ? 4
        : 0) -
      Math.abs(Math.log(p.price / pref)) * 0.5
    );
  },
  topCat() {
    const mine = mockDB.orders
        .filter((o) => o.customerId === me())
        .flatMap((o) => o.items.map((i) => P(i.productId).category))
        .concat(
          this.viewed,
          this.wishlist.map((i) => P(i).category),
        ),
      m = {};
    mine.forEach((c) => (m[c] = (m[c] || 0) + 1));
    return Object.keys(m).sort((a, b) => m[b] - m[a])[0] || "Electronics";
  },
  grid() {
    const q = this.q.toLowerCase(),
      s = $("sort") && $("sort").value;
    let l = live().filter(
      (p) =>
        (!this.cat || p.category === this.cat) &&
        (p.name + p.sellerName + p.category).toLowerCase().includes(q),
    );
    if (s === "pa") l.sort((a, b) => a.price - b.price);
    if (s === "pd") l.sort((a, b) => b.price - a.price);
    if (s === "r") l.sort((a, b) => b.rating - a.rating);
    $("grid").innerHTML = l.length
      ? `<p class="text-sm text-gray-500 mb-2">${l.length} results</p><div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">${J(l, card)}</div>`
      : empty("fa-box-open", "No products match your filters.");
  },

  /* SELLER FUNCTIONS */
  productForm(id) {
    const p = id
      ? P(id)
      : {
          name: "",
          sku: "",
          category: "Electronics",
          price: "",
          orig: "",
          stock: "",
          img: "📦",
          desc: "",
        };
    this.form(
      id ? "Edit Product" : "Add Product",
      [
        ["name", "Product name", p.name],
        ["sku", "SKU", p.sku],
        ["category", "Category", p.category, "select", mockDB.categories],
        ["price", "Price (₱)", p.price, "number"],
        ["orig", "Original price (for discount badge)", p.orig, "number"],
        ["stock", "Stock", p.stock, "number"],
        ["img", "Image emoji", p.img],
        ["desc", "Description", p.desc, "textarea"],
      ],
      (v) => {
        const price = +v.price,
          stock = parseInt(v.stock);
        if (!v.name.trim() || !v.sku.trim() || !(price > 0) || !(stock >= 0)) {
          this.toast(
            "Name, SKU, price > 0 and stock ≥ 0 are required",
            "error",
          );
          return false;
        }
        if (!/^[A-Za-z0-9._-]{2,30}$/.test(v.sku.trim())) {
          this.toast(
            "SKU: 2-30 characters, letters, numbers, dot, dash or underscore only",
            "error",
          );
          return false;
        }
        if (
          mockDB.products.some((x) => x.sku === v.sku.trim() && x.id !== id)
        ) {
          this.toast("SKU must be unique", "error");
          return false;
        }
        const u = this.currentUser,
          d = {
            name: esc(v.name.trim()),
            sku: v.sku.trim(),
            category: v.category,
            price,
            orig: Math.max(price, +v.orig || price),
            stock,
            img: v.img || "📦",
            desc: esc(v.desc),
          };
        if (id) {
          this.audit("Edited Product", p.name, fmt(p.price), fmt(price));
          Object.assign(p, d);
        } else {
          mockDB.products.push({
            id: "p" + Date.now(),
            sellerId: u.id,
            sellerName: u.storeName,
            rating: 0,
            reviews: 0,
            status: u.status === "Active" ? "Active" : "Draft",
            ...d,
          });
          this.audit("Added Product", d.name);
          if (u.status !== "Active")
            this.toast("Saved as Draft: your store awaits approval");
        }
        this.toast("Product saved", "success");
        this.refresh();
      },
    );
  },
  archive(id) {
    const p = P(id);
    if (this.currentUser.status !== "Active")
      return this.toast("Awaiting approval: cannot publish", "error");
    p.status = p.status === "Archived" ? "Active" : "Archived";
    this.audit("Product " + p.status, p.name);
    this.refresh();
  },
  delProduct(id) {
    this.confirm(
      "Are you sure you want to delete this product?",
      () => {
        const p = P(id);
        this.audit("Deleted Product", p.name);
        mockDB.products = mockDB.products.filter((x) => x !== p);
        this.toast("Product deleted", "success");
        this.refresh();
      },
      "Delete",
    );
  },
  updateStock(id) {
    const p = P(id);
    this.form(
      "Update Stock — " + p.name,
      [
        ["stock", "Set available stock", p.stock, "number"],
        ["why", "Reason", "Restock"],
      ],
      (v) => {
        const s = parseInt(v.stock);
        if (!(s >= 0)) {
          this.toast("Enter a valid number", "error");
          return false;
        }
        this.audit("Updated Stock", p.name, p.stock, s);
        p.stock = s;
        this.toast("Stock updated", "success");
        this.refresh();
      },
    );
  },
  own(id) {
    const o = mockDB.orders.find((x) => x.id === id);
    if (!o || this.role() !== "seller" || o.sellerId !== me()) {
      this.toast("You can only manage your own orders.", "error");
      return null;
    }
    return o;
  },
  sellerDo(id, st) {
    const o = this.own(id);
    if (!o) return;
    const ok = {
      Processing: ["Pending"],
      Packed: ["Processing"],
      "Out for Delivery": ["Shipped"],
      Cancelled: ["Pending", "Processing"],
    }[st];
    if (!ok || !ok.includes(o.status))
      return this.toast("That status change is not allowed.", "error");
    const go = () => {
      this.setStatus(id, st);
      this.refresh();
    };
    st === "Cancelled"
      ? this.confirm(
          "Cancel this order? The customer will be notified" +
            (o.payStatus === "Paid" && o.pay !== "Cash on Delivery"
              ? " and refunded"
              : "") +
            ".",
          go,
          "Cancel Order",
          "Keep Order",
        )
      : go();
  },
  shipForm(id) {
    const o = this.own(id);
    if (!o) return;
    if (o.status !== "Packed")
      return this.toast("Pack the order first.", "error");
    const cs = mockDB.couriers.filter((c) => c.enabled).map((c) => c.name);
    this.form(
      "Arrange shipment - " + id,
      [
        ["courier", "Courier", cs[0], "select", cs],
        ["weight", "Parcel weight (kg)", 1, "number"],
        ["note", "Notes for courier (optional)", "", "textarea"],
      ],
      (v) => {
        const w = +v.weight;
        if (!(w > 0 && w <= 50)) {
          this.toast("Enter a parcel weight between 0.1 and 50 kg", "error");
          return false;
        }
        this.setStatus(id, "Shipped", {
          courier: v.courier,
          weight: w,
          note: esc(v.note),
        });
        this.refresh();
      },
      "Book courier",
    );
  },
  deliverForm(id) {
    const o = this.own(id);
    if (!o) return;
    if (o.status !== "Out for Delivery")
      return this.toast("Order is not out for delivery.", "error");
    this.form(
      "Mark delivered - " + id,
      [["by", "Received by (name)", U(o.customerId).name]],
      (v) => {
        if (!v.by.trim()) {
          this.toast("Enter who received the parcel", "error");
          return false;
        }
        this.setStatus(id, "Completed", { by: esc(v.by.trim()) });
        this.refresh();
      },
      o.pay === "Cash on Delivery"
        ? "Delivered & cash collected"
        : "Confirm delivery",
    );
  },
  failForm(id) {
    const o = this.own(id);
    if (!o) return;
    if (o.status !== "Out for Delivery")
      return this.toast("Order is not out for delivery.", "error");
    this.form(
      "Delivery attempt failed - " + id,
      [
        [
          "why",
          "Reason",
          "Recipient unavailable",
          "select",
          [
            "Recipient unavailable",
            "Incorrect or incomplete address",
            "Recipient refused the parcel",
            "Unable to contact recipient",
          ],
        ],
      ],
      (v) => {
        this.failDelivery(id, v.why);
        this.refresh();
      },
      "Record failed attempt",
    );
  },
  waybill(id) {
    const o = mockDB.orders.find((x) => x.id === id),
      s = o && o.shp;
    if (!s)
      return this.toast("No shipment yet. Arrange a courier first.", "error");
    const a = o.addr || {},
      sl = U(o.sellerId);
    const t = `SHOPHUB WAYBILL\n==============================\nCourier : ${s.courier}\nTracking: ${s.tracking}\nOrder   : ${o.id}\nBooked  : ${s.events[0].time}\n\nFROM\n${sl.storeName} (${sl.phone || "no contact"})\n\nTO\n${a.name || ""} (${a.phone || ""})\n${[a.street, a.barangay, a.city, a.province, a.region, a.zip].filter(Boolean).join(", ")}\n\nPARCEL\n${o.items.reduce((x, i) => x + i.qty, 0)} item(s), ${s.weight} kg\n${s.note ? "Note: " + s.note + "\n" : ""}\n${o.pay === "Cash on Delivery" ? "COLLECT CASH ON DELIVERY: " + fmt(o.total) : "PREPAID - do not collect payment"}\n`;
    this.modal(
      "Waybill - " + s.tracking,
      '<pre class="text-xs bg-gray-50 p-3 rounded overflow-x-auto">' +
        esc(t) +
        "</pre>",
      () => {
        this.dl("waybill-" + o.id + ".txt", t);
        return false;
      },
      "Download .txt",
      "Close",
    );
  },
  orderInfo(id) {
    const o = mockDB.orders.find((x) => x.id === id);
    if (!o) return;
    const s = o.shp,
      a = o.addr || {};
    this.modal(
      "Order " + o.id,
      `<p><b>Customer:</b> ${esc(U(o.customerId).name)} &middot; <b>Seller:</b> ${esc(U(o.sellerId).storeName)}</p><p><b>Status:</b> ${badge(o.status)} &middot; <b>Payment:</b> ${o.pay} ${badge(o.payStatus)}${o.payRef ? ' <code class="text-xs">' + o.payRef + "</code>" : ""}</p>${J(o.items, (i) => `<div class="flex justify-between border-b py-1"><span>${P(i.productId).img} ${P(i.productId).name} &times; ${i.qty}</span><b>${fmt(i.price * i.qty)}</b></div>`)}${sum(otot(o))}<p class="pt-2"><b>Ship to:</b> ${esc(a.name || "")} ${a.phone ? "(" + esc(a.phone) + ")" : ""}<br>${addrLine(a)}</p>${s ? `<p><b>Courier:</b> ${s.courier} &middot; <b>Tracking:</b> ${s.tracking}${s.eta ? "<br><b>Est. delivery:</b> " + s.eta[0] + " to " + s.eta[1] : ""}${s.attempts ? "<br><b>Failed attempts:</b> " + s.attempts + " of " + MAX_ATTEMPTS : ""}</p><div class="text-xs space-y-1">${J(s.events.slice().reverse(), (e) => `<div><span class="text-gray-400">${e.time}</span> ${esc(e.text)}</div>`)}</div>` : '<p class="text-gray-500">Not shipped yet.</p>'}`,
    );
  },
  replyReview(id) {
    this.form(
      "Reply to Review",
      [["t", "Your reply", "", "textarea"]],
      (v) => {
        if (!v.t.trim()) return false;
        mockDB.reviews.find((r) => r.id === id).reply = esc(v.t);
        this.toast("Reply saved", "success");
        this.refresh();
      },
      "Reply",
    );
  },
  editStore() {
    const u = this.currentUser;
    this.form(
      "Edit Store",
      [
        ["storeName", "Store name", u.storeName],
        ["name", "Seller name", u.name],
        ["phone", "Contact", u.phone || ""],
        ["desc", "Description", u.desc || "", "textarea"],
      ],
      (v) => {
        if (!v.storeName.trim()) return false;
        Object.assign(u, {
          storeName: esc(v.storeName),
          name: esc(v.name),
          phone: esc(v.phone),
          desc: esc(v.desc),
        });
        mockDB.products.forEach((p) => {
          if (p.sellerId === u.id) p.sellerName = u.storeName;
        });
        this.audit("Edited Store", u.storeName);
        this.toast("Store updated", "success");
        this.refresh();
      },
    );
  },

  /* LINKED ACCOUNTS & PAYOUTS (customers and sellers) */
  acctsFor(m) {
    const l = mockDB.linked.filter((x) => x.userId === me());
    return ["GCash", "Maya", "GrabPay"].includes(m)
      ? l.filter((x) => x.provider === m)
      : m === "Online Banking"
        ? l.filter((x) => x.kind === "bank")
        : m === "Credit/Debit Card"
          ? l.filter((x) => x.kind === "card")
          : [];
  },
  linkForm() {
    const sel = this.role() === "seller",
      B = ["BDO", "BPI", "UnionBank", "Landbank", "Metrobank"],
      D = [
        "GoTyme Bank",
        "Maya Bank",
        "SeaBank",
        "CIMB Bank",
        "Tonik",
        "UnionDigital",
      ],
      opts = sel
        ? ["GCash", "Maya", ...B, ...D]
        : ["GCash", "Maya", "GrabPay", ...B, "Credit/Debit Card"],
      u = this.currentUser;
    this.form(
      sel ? "Link a payout account" : "Link a payment method",
      [
        ["provider", "Provider", opts[0], "select", opts],
        ["holder", "Account holder name", u.name],
        ["num", "Mobile no. (e-wallet), account no. (bank) or card no.", ""],
      ],
      (v) => {
        const kind = kindOf(v.provider),
          d = v.num.replace(/[\s-]/g, ""),
          E = (m) => {
            this.toast(m, "error");
            return false;
          };
        if (!v.holder.trim()) return E("Enter the account holder name.");
        if (kind === "ewallet" && !/^(\+63|0)9\d{9}$/.test(d))
          return E("Enter a valid PH mobile number linked to the e-wallet.");
        if (kind === "bank" && !/^\d{8,16}$/.test(d))
          return E("Bank account numbers are 8 to 16 digits.");
        if (kind === "card" && !/^\d{13,19}$/.test(d))
          return E("Card numbers are 13 to 19 digits.");
        const last4 = d.slice(-4);
        if (
          mockDB.linked.some(
            (l) =>
              l.userId === me() &&
              l.provider === v.provider &&
              l.last4 === last4,
          )
        )
          return E("This account is already linked.");
        const holder = esc(v.holder.trim());
        this.form(
          "Verify your account",
          [
            [
              "otp",
              "Enter the 6-digit code sent to your " +
                (kind === "ewallet"
                  ? "mobile number"
                  : kind === "card"
                    ? "bank"
                    : "registered contact") +
                " (demo code: 123456)",
              "",
            ],
          ],
          (o) => {
            if (o.otp.trim() !== "123456") {
              this.toast("Incorrect code. The demo code is 123456.", "error");
              return false;
            }
            const first = !mockDB.linked.some(
              (l) => l.userId === me() && (sel || l.kind === kind) && l.def,
            );
            mockDB.linked.push({
              id: "la" + Date.now(),
              userId: me(),
              kind,
              provider: v.provider,
              holder,
              last4,
              def: first,
              date: TODAY,
            });
            this.audit("Linked Account", v.provider + " ..." + last4);
            this.toast(
              "Account linked (only the last 4 digits are kept)",
              "success",
            );
            this.refresh();
          },
          "Verify & link",
        );
        return false;
      },
      "Continue",
    );
  },
  setDef(id) {
    const x = mockDB.linked.find((l) => l.id === id && l.userId === me());
    if (!x) return;
    const sel = this.role() === "seller";
    mockDB.linked.forEach((l) => {
      if (l.userId === me() && (sel || l.kind === x.kind)) l.def = false;
    });
    x.def = true;
    this.toast("Default updated", "success");
    this.refresh();
  },
  unlink(id) {
    const x = mockDB.linked.find((l) => l.id === id && l.userId === me());
    if (!x) return;
    if (mockDB.payouts.some((p) => p.acctId === id && p.status === "Requested"))
      return this.toast("This account has a payout in progress.", "error");
    this.confirm(
      "Remove " +
        esc(x.provider) +
        " &bull;&bull;&bull;&bull; " +
        x.last4 +
        "?",
      () => {
        mockDB.linked = mockDB.linked.filter((l) => l !== x);
        if (x.def) {
          const n = mockDB.linked.find(
            (l) =>
              l.userId === me() &&
              (this.role() === "seller" || l.kind === x.kind),
          );
          if (n) n.def = true;
        }
        this.toast("Account removed", "success");
        this.refresh();
      },
      "Remove",
    );
  },
  requestPayout() {
    const os = mockDB.orders.filter(
        (o) => o.sellerId === me() && payState(o) === "Available",
      ),
      amt = R2(os.reduce((a, o) => a + o.payout, 0)),
      acct = mockDB.linked.find((x) => x.userId === me() && x.def);
    if (!acct)
      return this.toast(
        "Link a bank or e-wallet and set it as default first.",
        "error",
      );
    if (!os.length || amt < this.settings.minPayout)
      return this.toast(
        "Available balance is below the minimum payout of " +
          fmt(this.settings.minPayout) +
          ".",
        "error",
      );
    this.confirm(
      "Request a payout of <b>" +
        fmt(amt) +
        "</b> (" +
        os.length +
        " order" +
        (os.length > 1 ? "s" : "") +
        ") to <b>" +
        esc(acctLabel(acct)) +
        "</b>?",
      () => {
        const id = "PO-" + (1000 + mockDB.payouts.length + 1);
        mockDB.payouts.push({
          id,
          sellerId: me(),
          amount: amt,
          orderIds: os.map((o) => o.id),
          acctId: acct.id,
          status: "Requested",
          requested: TODAY,
        });
        os.forEach((o) => (o.payoutId = id));
        this.notify(
          "u3",
          "Payout requested",
          this.currentUser.storeName +
            " requested " +
            fmt(amt) +
            " (" +
            id +
            ").",
          "info",
        );
        this.audit("Requested Payout", id, "", fmt(amt));
        this.toast("Payout requested", "success");
        this.refresh();
      },
      "Request payout",
    );
  },
  /* ADMIN FUNCTIONS */
  codRemit(id) {
    const o = mockDB.orders.find((x) => x.id === id);
    this.confirm(
      "Confirm that the courier remitted the cash collected for " +
        id +
        " (" +
        fmt(o.total) +
        ")?",
      () => {
        o.codRemitted = true;
        this.audit("COD Remitted", id, "Pending", "Remitted");
        this.notify(
          o.sellerId,
          "COD remitted",
          "Cash for " +
            id +
            " was received. The earnings are now available for payout.",
          "info",
        );
        this.refresh();
      },
      "Confirm remittance",
    );
  },
  poPay(id) {
    const p = mockDB.payouts.find((x) => x.id === id),
      a = mockDB.linked.find((x) => x.id === p.acctId);
    this.confirm(
      "Send <b>" +
        fmt(p.amount) +
        "</b> to <b>" +
        esc(acctLabel(a)) +
        "</b> (" +
        esc(U(p.sellerId).storeName) +
        ")? This is a simulated transfer.",
      () => {
        p.status = "Paid";
        p.processed = TODAY;
        p.ref = "trf_" + rid();
        this.payEvent("payout.paid", p.ref, p.amount, a ? a.provider : "-");
        this.audit("Paid Payout", p.id, "Requested", "Paid");
        this.notify(
          p.sellerId,
          "Payout sent",
          fmt(p.amount) + " was sent to " + acctLabel(a) + " (" + p.id + ").",
          "info",
        );
        this.toast("Payout marked as paid", "success");
        this.refresh();
      },
      "Send payout",
    );
  },
  poReject(id) {
    const p = mockDB.payouts.find((x) => x.id === id);
    this.form(
      "Reject payout " + id,
      [["r", "Reason", "", "textarea"]],
      (v) => {
        if (!v.r.trim()) return false;
        p.status = "Rejected";
        p.processed = TODAY;
        mockDB.orders.forEach((o) => {
          if (o.payoutId === id) o.payoutId = null;
        });
        this.audit("Rejected Payout", id, "Requested", "Rejected");
        this.notify(
          p.sellerId,
          "Payout rejected",
          id + ": " + esc(v.r),
          "info",
        );
        this.refresh();
      },
      "Reject",
    );
  },
  toggleCourier(i) {
    const c = mockDB.couriers[i];
    if (c.enabled && mockDB.couriers.filter((x) => x.enabled).length < 2)
      return this.toast("Keep at least one courier enabled.", "error");
    c.enabled = !c.enabled;
    this.audit(c.enabled ? "Enabled Courier" : "Disabled Courier", c.name);
    this.refresh();
  },
  setSetting(k, v) {
    const n = +v;
    if (
      v === "" ||
      !(n >= 0) ||
      (k === "commission" && n > 100) ||
      (k === "gatewayFee" && n > 100)
    ) {
      this.toast("Enter a valid number.", "error");
      return this.refresh();
    }
    this.audit("Changed Setting", k, this.settings[k], n);
    this.settings[k] = n;
    this.toast("Saved", "success");
  },
  toggleMethod(m, el) {
    const on = METHODS.filter((x) => this.settings.methods[x]);
    if (!el.checked && on.length < 2 && this.settings.methods[m]) {
      el.checked = true;
      return this.toast("Keep at least one payment method enabled.", "error");
    }
    this.settings.methods[m] = el.checked;
    this.audit(
      el.checked ? "Enabled Payment Method" : "Disabled Payment Method",
      m,
    );
    this.toast("Saved", "success");
  },
  setShipFee(v) {
    const n = +v;
    if (v === "" || !(n >= 0)) {
      this.toast("Enter a valid fee.", "error");
      return this.refresh();
    }
    this.audit("Changed Shipping Fee", "Settings", this.shippingFee, n);
    this.shippingFee = n;
    this.toast("Saved", "success");
  },
  setUser(id, st, verb) {
    const u = U(id);
    this.confirm(
      `Are you sure you want to ${verb} this ${u.role === "seller" ? "seller" : "customer"}?`,
      () => {
        const prev = u.status;
        u.status = st;
        this.audit(
          verb[0].toUpperCase() +
            verb.slice(1) +
            " " +
            (u.role === "seller" ? "Seller" : "Customer"),
          u.storeName || u.name,
          prev,
          st,
        );
        this.notify(
          id,
          "Account " + st,
          "Your account status is now " + st + ".",
        );
        this.toast(u.name + ": " + st, "success");
        this.refresh();
      },
      verb[0].toUpperCase() + verb.slice(1),
    );
  },
  approve(id) {
    const u = U(id);
    u.status = "Active";
    this.audit("Approved Seller", u.storeName, "Pending", "Active");
    this.notify(id, "Application approved", "You can now publish products.");
    this.toast(u.storeName + " approved", "success");
    this.refresh();
  },
  reject(id) {
    const u = U(id);
    this.form(
      "Reject " + u.storeName,
      [["r", "Reason", "", "textarea"]],
      (v) => {
        if (!v.r.trim()) return false;
        u.status = "Rejected";
        this.audit("Rejected Seller", u.storeName, "Pending", "Rejected");
        this.notify(id, "Application rejected", esc(v.r));
        this.refresh();
      },
      "Reject",
    );
  },
  prodStatus(id, st, msg) {
    const p = P(id),
      go = () => {
        this.audit(st + " Product", p.name, p.status, st);
        p.status = st;
        this.toast("Product " + st.toLowerCase(), "success");
        this.refresh();
      };
    msg ? this.confirm(msg, go, st === "Flagged" ? "Flag" : "Remove") : go();
  },
  catForm(old) {
    this.form(
      old ? "Rename Category" : "Add Category",
      [["n", "Name", old || ""]],
      (v) => {
        const n = v.n.trim();
        if (!/^[A-Za-z0-9 &,'-]{2,30}$/.test(n)) {
          this.toast(
            "Category: 2-30 characters, letters, numbers, spaces and & , ' - only",
            "error",
          );
          return false;
        }
        if (mockDB.categories.includes(n)) {
          this.toast("Enter a unique category name", "error");
          return false;
        }
        if (old) {
          mockDB.categories[mockDB.categories.indexOf(old)] = n;
          mockDB.products.forEach((p) => {
            if (p.category === old) p.category = n;
          });
        } else mockDB.categories.push(n);
        this.audit(
          old ? "Renamed Category" : "Added Category",
          n,
          old || "",
          n,
        );
        this.refresh();
      },
    );
  },
  delCat(c) {
    if (mockDB.products.some((p) => p.category === c))
      return this.toast("Cannot delete: category has products", "error");
    this.confirm(
      "Delete category " + c + "?",
      () => {
        mockDB.categories = mockDB.categories.filter((x) => x !== c);
        this.audit("Deleted Category", c);
        this.refresh();
      },
      "Delete",
    );
  },
  voucherForm(code) {
    const shop = this.role() === "seller",
      old = code ? mockDB.vouchers.find((x) => x.code === code) : null;
    if (old && shop && old.seller !== me())
      return this.toast("Not allowed", "error");
    if (old && !shop && old.seller)
      return this.toast("Shop vouchers are edited by their sellers.", "error");
    const v = old || {
      code: "",
      type: "percent",
      value: "",
      min: 0,
      cap: "",
      expiry: "2026-12-31",
      limit: 0,
      perUser: 1,
      firstOrder: false,
      category: "",
    };
    this.form(
      old
        ? "Edit Voucher"
        : shop
          ? "Create Shop Voucher"
          : "Create Platform Voucher",
      [
        ["code", "Code", v.code],
        ["type", "Type", v.type, "select", ["percent", "fixed", "shipping"]],
        [
          "value",
          "Discount (% for percent, PHP for fixed; ignored for shipping)",
          v.value,
          "number",
        ],
        ["min", "Minimum spend (PHP)", v.min, "number"],
        [
          "cap",
          "Max discount cap (PHP, optional; for percent and shipping)",
          v.cap || "",
          "number",
        ],
        ["expiry", "Expiry", v.expiry, "date"],
        ["limit", "Total usage limit (0 = unlimited)", v.limit || 0, "number"],
        [
          "perUser",
          "Uses per customer (0 = unlimited)",
          v.perUser || 0,
          "number",
        ],
        [
          "first",
          "First-order customers only",
          v.firstOrder ? "Yes" : "No",
          "select",
          ["No", "Yes"],
        ],
        [
          "category",
          "Category (optional)",
          v.category || "",
          "select",
          ["", ...mockDB.categories],
        ],
      ],
      (f) => {
        const c = f.code.trim().toUpperCase(),
          val = +f.value,
          min = +f.min || 0,
          cap = +f.cap || 0,
          lim = parseInt(f.limit) || 0,
          pu = parseInt(f.perUser) || 0,
          E = (m) => {
            this.toast(m, "error");
            return false;
          };
        if (!/^[A-Z0-9]{3,20}$/.test(c))
          return E("Code must be 3-20 letters or numbers, no spaces.");
        if (old && c !== old.code)
          return E("A code cannot be changed. Create a new voucher instead.");
        if (!old && mockDB.vouchers.some((x) => x.code === c))
          return E("That code already exists.");
        if (f.type === "percent" && !(val > 0 && val <= 100))
          return E("Percent discount must be between 1 and 100.");
        if (f.type === "fixed" && !(val > 0))
          return E("Enter a fixed discount greater than 0.");
        if (min < 0 || cap < 0 || lim < 0 || pu < 0)
          return E("Numbers cannot be negative.");
        if (!f.expiry || f.expiry < TODAY)
          return E("Expiry must be today or later.");
        const d = {
          code: c,
          type: f.type,
          value: f.type === "shipping" ? 0 : val,
          min,
          cap: cap || undefined,
          expiry: f.expiry,
          limit: lim || undefined,
          perUser: pu || undefined,
          firstOrder: f.first === "Yes" || undefined,
          category: f.category || undefined,
        };
        if (shop) d.seller = me();
        if (old) Object.assign(old, d);
        else mockDB.vouchers.push({ ...d, status: "Active", uses: 0 });
        this.audit(old ? "Edited Voucher" : "Created Voucher", c);
        this.toast("Voucher saved", "success");
        this.refresh();
      },
    );
  },
  vStatus(c) {
    const v = mockDB.vouchers.find((x) => x.code === c);
    if (this.role() === "seller" && v.seller !== me()) return;
    v.status = v.status === "Active" ? "Disabled" : "Active";
    this.audit("Voucher " + v.status, c);
    this.refresh();
  },
  delVoucher(c) {
    const v = mockDB.vouchers.find((x) => x.code === c);
    if (this.role() === "seller" && v.seller !== me()) return;
    this.confirm(
      "Delete voucher " + c + "?",
      () => {
        mockDB.vouchers = mockDB.vouchers.filter((x) => x.code !== c);
        this.audit("Deleted Voucher", c);
        this.refresh();
      },
      "Delete",
    );
  },
  reportAct(id, st) {
    this.confirm(
      st + " this report?",
      () => {
        mockDB.reports.find((r) => r.id === id).status = st;
        this.audit(st + " Report", id);
        this.refresh();
      },
      st,
    );
  },
};
