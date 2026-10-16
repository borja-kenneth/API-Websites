-- ============================================================
-- ShopHub schema v4 (MySQL 8.0.16+)  -  CONSOLIDATED, fresh install
-- = schema v3 (updated front end) + the new inventory architecture, merged into ONE script.
-- To move an existing v3 database instead, use shophub_inventory_migration.sql.
-- Enum values match the strings used in the JS so the app can use them as-is.
--
-- v4 INVENTORY CHANGES (vs v3)
--   * products.stock is GONE: quantity now lives in `inventory` (on_hand, reserved, generated available).
--     The website still sees "stock" (= available) through the views v_live_products / v_inventory_status.
--   * stock_adjustments is GONE: merged into the append-only ledger `inventory_movements`.
--   * product_costs (new): seller-only cost_price, kept out of products so SELECT p.* can never leak it.
--   * categories gain is_active + created_at; products gain a derived is_active (from status).
--   * sp_inventory_move / sp_inventory_ship are the ONLY way to change stock (updates inventory + writes the ledger).
--   * A trigger gives every new product its inventory row.
--
-- CARRIED OVER FROM v3
--   Admin roles (Management / Maintenance) and their screens; customer profile, address book, notification prefs;
--   PH shipping (regions + couriers); vouchers (limited-time, claiming, redemption/returns, 1 discount + 1 shipping
--   per order); per-product alert level; 43 typed settings + history + roles/permissions matrix; login lockout;
--   immutable audit trail; backups and integrations.
-- ============================================================
CREATE DATABASE IF NOT EXISTS shophub
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE shophub;

-- ------------------------------------------------------------
-- 1. LOOKUPS: ADMIN ROLES, REGIONS, COURIERS
-- ------------------------------------------------------------
-- ADM_ACCESS in upgrade.js: each admin role may open only certain admin screens
CREATE TABLE admin_roles (
  admin_role_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(40) NOT NULL UNIQUE,             -- 'Management Admin' | 'Maintenance Admin'
  description   VARCHAR(255) NULL
) ENGINE=InnoDB;

CREATE TABLE admin_role_areas (
  admin_role_id TINYINT UNSIGNED NOT NULL,
  area_key      VARCHAR(30) NOT NULL,                    -- route id, e.g. 'a-orders', 'a-settings'
  PRIMARY KEY (admin_role_id, area_key),
  CONSTRAINT fk_ara_role FOREIGN KEY (admin_role_id) REFERENCES admin_roles(admin_role_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- REGIONS in upgrade.js: shipping fee = default fee x region multiplier x courier multiplier
CREATE TABLE regions (
  region_id           TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(60) NOT NULL UNIQUE,       -- 'NCR (Metro Manila)', 'Region VII (Central Visayas)'
  island_group        ENUM('Metro Manila','Luzon','Visayas','Mindanao') NOT NULL,
  shipping_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.80
) ENGINE=InnoDB;

-- COURIERS in upgrade.js
CREATE TABLE couriers (
  courier_id     TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(60) NOT NULL UNIQUE,
  fee_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  eta_min_days   TINYINT UNSIGNED NOT NULL,
  eta_max_days   TINYINT UNSIGNED NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 2. USERS, PROFILES, SELLERS, ADDRESS BOOK
-- ------------------------------------------------------------
CREATE TABLE users (
  user_id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(150) NOT NULL,
  username      VARCHAR(20)  NULL UNIQUE,                -- customer profile (3-20 chars, unique)
  email         VARCHAR(255) NOT NULL UNIQUE,            -- stored lower-case
  password_hash VARCHAR(255) NOT NULL,                   -- length >= settings.pwMin is checked by the app
  phone         VARCHAR(30)  NULL,
  role          ENUM('customer','seller','admin') NOT NULL DEFAULT 'customer',
  admin_role_id TINYINT UNSIGNED NULL,                   -- only for role = 'admin'
  status        ENUM('Active','Suspended','Pending','Rejected') NOT NULL DEFAULT 'Active',
  birthday      DATE NULL,                               -- must not be in the future (app/procedure check)
  gender        ENUM('Prefer not to say','Female','Male','Other') NOT NULL DEFAULT 'Prefer not to say',
  avatar_url    VARCHAR(500) NULL,                       -- uploaded images (max 2 MB): store the file path/URL
  banner_url    VARCHAR(500) NULL,
  failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,   -- lockout after settings.maxAttempts
  locked_at     DATETIME NULL,
  last_login_at DATETIME NULL,
  password_changed_at DATETIME NULL,                     -- for settings.pwExpiryDays
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- "registered"
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_admin_role FOREIGN KEY (admin_role_id) REFERENCES admin_roles(admin_role_id),
  CONSTRAINT chk_users_admin_role CHECK ((role = 'admin' AND admin_role_id IS NOT NULL)
                                      OR (role <> 'admin' AND admin_role_id IS NULL)),
  CONSTRAINT chk_users_username CHECK (username IS NULL OR CHAR_LENGTH(username) BETWEEN 3 AND 20),
  INDEX idx_users_role_status (role, status)
) ENGINE=InnoDB;

-- Account Settings > Notifications (push toggles)
CREATE TABLE user_notification_prefs (
  user_id       BIGINT UNSIGNED PRIMARY KEY,
  push_orders   BOOLEAN NOT NULL DEFAULT TRUE,
  push_vouchers BOOLEAN NOT NULL DEFAULT TRUE,
  push_promos   BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_unp_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Seller application form: store, owner, email, contact, address, description, permit/ID number
CREATE TABLE seller_profiles (
  seller_id           BIGINT UNSIGNED PRIMARY KEY,       -- = users.user_id (1:1)
  store_name          VARCHAR(150) NOT NULL UNIQUE,
  description         TEXT NULL,
  business_address    VARCHAR(255) NULL,
  verification_number VARCHAR(100) NULL,                 -- "permit / ID number"
  id_document_url     VARCHAR(500) NULL,
  CONSTRAINT fk_sp_user FOREIGN KEY (seller_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Address book (Account Settings) - the default one pre-fills checkout
CREATE TABLE addresses (
  address_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        BIGINT UNSIGNED NOT NULL,
  recipient_name VARCHAR(150) NOT NULL,
  phone          VARCHAR(30)  NOT NULL,
  region_id      TINYINT UNSIGNED NOT NULL,
  province       VARCHAR(100) NOT NULL,
  city           VARCHAR(100) NOT NULL,                  -- city / municipality
  barangay       VARCHAR(100) NOT NULL,
  street         VARCHAR(255) NOT NULL,                  -- street, building, house no.
  postal_code    CHAR(4) NOT NULL,                       -- PH ZIP = 4 digits
  is_default     BOOLEAN NOT NULL DEFAULT FALSE,
  default_flag   TINYINT GENERATED ALWAYS AS (IF(is_default, 1, NULL)) STORED,
  CONSTRAINT fk_addr_user   FOREIGN KEY (user_id)   REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_addr_region FOREIGN KEY (region_id) REFERENCES regions(region_id),
  CONSTRAINT chk_addr_phone CHECK (phone REGEXP '^(09|\\+639)[0-9]{2} ?[0-9]{3} ?[0-9]{4}$'),
  CONSTRAINT chk_addr_zip   CHECK (postal_code REGEXP '^[0-9]{4}$'),
  UNIQUE KEY uq_addr_one_default (user_id, default_flag),          -- at most one default per user
  INDEX idx_addr_user (user_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 3. CATALOG & INVENTORY
-- ------------------------------------------------------------
CREATE TABLE categories (
  category_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  icon        VARCHAR(16) NULL,                          -- emoji shown on the home page (CATI map)
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,             -- hide a category without deleting it
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE products (
  product_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  seller_id      BIGINT UNSIGNED NOT NULL,
  category_id    INT UNSIGNED NOT NULL,
  sku            VARCHAR(64)  NOT NULL UNIQUE,           -- unique platform-wide
  name           VARCHAR(255) NOT NULL,
  description    TEXT NULL,
  price          DECIMAL(12,2) NOT NULL,
  original_price DECIMAL(12,2) NOT NULL,                 -- drives the "-xx%" badge
  threshold      INT UNSIGNED NULL,                      -- seller's own low-stock level (reorder point); NULL = settings.lowStock
  image          VARCHAR(500) NOT NULL DEFAULT '📦',
  status         ENUM('Draft','Active','Archived','Flagged','Removed') NOT NULL DEFAULT 'Draft',
  is_active      BOOLEAN GENERATED ALWAYS AS (status = 'Active') VIRTUAL,   -- derived from status, never edited
  rating_avg     DECIMAL(2,1) NOT NULL DEFAULT 0.0,      -- cached
  review_count   INT UNSIGNED NOT NULL DEFAULT 0,        -- cached
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_seller   FOREIGN KEY (seller_id)   REFERENCES seller_profiles(seller_id),
  CONSTRAINT fk_prod_category FOREIGN KEY (category_id) REFERENCES categories(category_id),
  CONSTRAINT chk_prod_price CHECK (price > 0),
  CONSTRAINT chk_prod_orig  CHECK (original_price >= price),
  INDEX idx_prod_seller (seller_id, status),
  INDEX idx_prod_category (category_id, status),
  FULLTEXT INDEX ft_prod_search (name)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 3b. INVENTORY (owns every quantity; products no longer has a stock column)
-- ------------------------------------------------------------
-- cost_price lives here, NOT in products. Seller-only financial data: never join it into storefront/admin views.
-- A missing row = "cost not entered" (not a fake 0.00 cost).
CREATE TABLE product_costs (
  product_id BIGINT UNSIGNED PRIMARY KEY,
  cost_price DECIMAL(12,2) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_product_costs_product FOREIGN KEY (product_id) REFERENCES products(product_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_product_costs CHECK (cost_price >= 0)
) ENGINE=InnoDB;

-- One row per product (created automatically by trigger trg_products_create_inventory).
--   quantity_on_hand   = physical units held by the seller
--   quantity_reserved  = units committed to open orders (Pending / Processing / Packed)
--   quantity_available = on_hand - reserved  (generated)  -> what the website calls "stock"
CREATE TABLE inventory (
  product_id         BIGINT UNSIGNED PRIMARY KEY,
  quantity_on_hand   INT NOT NULL DEFAULT 0,
  quantity_reserved  INT NOT NULL DEFAULT 0,
  quantity_available INT GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_inventory_quantity CHECK (quantity_on_hand >= 0),
  CONSTRAINT chk_inventory_reserved CHECK (quantity_reserved >= 0 AND quantity_reserved <= quantity_on_hand),
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(product_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  INDEX idx_inventory_available (quantity_available)
) ENGINE=InnoDB;

-- Append-only ledger of every stock change. RULE: each row changes exactly ONE counter.
--   RESTOCK / PURCHASE / RETURN / SALE / ADJUSTMENT -> quantity_on_hand
--   RESERVATION / RELEASE                           -> quantity_reserved
--   quantity_before / quantity_after are the values of THAT counter.
--   Order placed = RESERVATION | order cancelled = RELEASE | order shipped = RELEASE then SALE.
--   Seller's manual edits (Restock / Correction / Damaged / Returned) keep their label in `reason`.
CREATE TABLE inventory_movements (
  movement_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id      BIGINT UNSIGNED NOT NULL,
  movement_type   ENUM('PURCHASE','SALE','RETURN','ADJUSTMENT','RESTOCK','RESERVATION','RELEASE') NOT NULL,
  quantity_change INT NOT NULL,
  quantity_before INT NOT NULL,
  quantity_after  INT NOT NULL,
  reference_type  VARCHAR(50)  NULL,                    -- 'ORDER', ...
  reference_id    VARCHAR(100) NULL,                    -- e.g. order_number 'ORD-9990'
  reason          VARCHAR(255) NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_movement_product FOREIGN KEY (product_id) REFERENCES products(product_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_movement_user FOREIGN KEY (created_by) REFERENCES users(user_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT chk_movement_math CHECK (quantity_after = quantity_before + quantity_change AND quantity_after >= 0),
  CONSTRAINT chk_movement_sign CHECK (
       (movement_type IN ('PURCHASE','RESTOCK','RETURN','RESERVATION') AND quantity_change > 0)
    OR (movement_type IN ('SALE','RELEASE') AND quantity_change < 0)
    OR (movement_type = 'ADJUSTMENT' AND quantity_change <> 0)),
  INDEX idx_inventory_movements_product_date (product_id, created_at),
  INDEX idx_inventory_movements_ref (reference_type, reference_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 4. CUSTOMER SHOPPING STATE
-- ------------------------------------------------------------
CREATE TABLE cart_items (
  user_id         BIGINT UNSIGNED NOT NULL,
  product_id      BIGINT UNSIGNED NOT NULL,
  saved_for_later BOOLEAN NOT NULL DEFAULT FALSE,
  quantity        INT UNSIGNED NOT NULL DEFAULT 1,       -- capped by settings.maxQty and product stock
  added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, product_id, saved_for_later),
  CONSTRAINT fk_ci_user    FOREIGN KEY (user_id)    REFERENCES users(user_id)       ON DELETE CASCADE,
  CONSTRAINT fk_ci_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
  CONSTRAINT chk_ci_qty CHECK (quantity > 0)
) ENGINE=InnoDB;

CREATE TABLE wishlist_items (
  user_id    BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  added_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, product_id),
  CONSTRAINT fk_wl_user    FOREIGN KEY (user_id)    REFERENCES users(user_id)       ON DELETE CASCADE,
  CONSTRAINT fk_wl_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE product_views (
  view_id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  viewed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pv_user    FOREIGN KEY (user_id)    REFERENCES users(user_id)       ON DELETE CASCADE,
  CONSTRAINT fk_pv_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
  INDEX idx_pv_user (user_id, viewed_at)
) ENGINE=InnoDB;

CREATE TABLE search_history (
  search_id   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  term        VARCHAR(150) NOT NULL,
  searched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sh_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_sh_user (user_id, searched_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 5. VOUCHERS: definition, claiming (Marketing Centre), redemption/return
-- ------------------------------------------------------------
CREATE TABLE vouchers (
  voucher_id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code           VARCHAR(40) NOT NULL UNIQUE,            -- upper-case
  discount_type  ENUM('percent','fixed','shipping') NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL DEFAULT 0,       -- 0 only for 'shipping'
  min_purchase   DECIMAL(12,2) NOT NULL DEFAULT 0,
  expires_on     DATE NOT NULL,
  category_id    INT UNSIGNED NULL,                      -- optional restriction
  seller_id      BIGINT UNSIGNED NULL,                   -- optional restriction
  is_limited     BOOLEAN NOT NULL DEFAULT FALSE,         -- "Limited-time voucher" badge
  status         ENUM('Active','Disabled') NOT NULL DEFAULT 'Active',   -- "Expired" is derived from expires_on
  uses           INT UNSIGNED NOT NULL DEFAULT 0,        -- cached counter
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vo_category FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE SET NULL,
  CONSTRAINT fk_vo_seller   FOREIGN KEY (seller_id)   REFERENCES seller_profiles(seller_id) ON DELETE CASCADE,
  CONSTRAINT chk_vo_value CHECK (discount_type = 'shipping' OR discount_value > 0),
  CONSTRAINT chk_vo_pct   CHECK (discount_type <> 'percent' OR discount_value <= 100)
) ENGINE=InnoDB;

-- A customer must claim a voucher before using it (app.claimed). Two are auto-claimed on first visit.
CREATE TABLE voucher_claims (
  user_id    BIGINT UNSIGNED NOT NULL,
  voucher_id INT UNSIGNED NOT NULL,
  claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, voucher_id),
  CONSTRAINT fk_vc_user    FOREIGN KEY (user_id)    REFERENCES users(user_id)       ON DELETE CASCADE,
  CONSTRAINT fk_vc_voucher FOREIGN KEY (voucher_id) REFERENCES vouchers(voucher_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 6. PAYMENT METHODS & ORDERS
-- ------------------------------------------------------------
CREATE TABLE payment_methods (
  payment_method_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(20) NOT NULL UNIQUE,                -- the PAY_METHODS key: pay_cod, pay_gcash, ...
  name       VARCHAR(40) NOT NULL UNIQUE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE               -- toggled in Settings > Payment methods
) ENGINE=InnoDB;

-- One order per seller. Up to TWO vouchers per checkout: 1 discount + 1 shipping.
CREATE TABLE orders (
  order_id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_number        VARCHAR(20) NOT NULL UNIQUE,       -- 'ORD-12345'
  customer_id         BIGINT UNSIGNED NOT NULL,
  seller_id           BIGINT UNSIGNED NOT NULL,
  courier_id          TINYINT UNSIGNED NOT NULL DEFAULT 1,
  payment_method_id   TINYINT UNSIGNED NOT NULL,
  payment_status      ENUM('Unpaid','Paid') NOT NULL DEFAULT 'Unpaid',
  status              ENUM('Pending','Processing','Packed','Shipped','Out for Delivery','Completed','Cancelled')
                      NOT NULL DEFAULT 'Pending',
  discount_voucher_id INT UNSIGNED NULL,                 -- app: order.voucher
  shipping_voucher_id INT UNSIGNED NULL,                 -- app: order.voucher2
  subtotal            DECIMAL(12,2) NOT NULL,
  shipping_fee        DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount            DECIMAL(12,2) NOT NULL DEFAULT 0,
  total               DECIMAL(12,2) NOT NULL,
  -- delivery address snapshot
  ship_name           VARCHAR(150) NOT NULL,
  ship_phone          VARCHAR(30)  NOT NULL,
  ship_region         VARCHAR(100) NOT NULL,
  ship_province       VARCHAR(100) NOT NULL,
  ship_city           VARCHAR(100) NOT NULL,
  ship_barangay       VARCHAR(100) NOT NULL,
  ship_street         VARCHAR(255) NOT NULL,
  ship_zip            VARCHAR(10)  NOT NULL,
  placed_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ord_customer FOREIGN KEY (customer_id)         REFERENCES users(user_id),
  CONSTRAINT fk_ord_seller   FOREIGN KEY (seller_id)           REFERENCES seller_profiles(seller_id),
  CONSTRAINT fk_ord_courier  FOREIGN KEY (courier_id)          REFERENCES couriers(courier_id),
  CONSTRAINT fk_ord_payment  FOREIGN KEY (payment_method_id)   REFERENCES payment_methods(payment_method_id),
  CONSTRAINT fk_ord_dvoucher FOREIGN KEY (discount_voucher_id) REFERENCES vouchers(voucher_id) ON DELETE SET NULL,
  CONSTRAINT fk_ord_svoucher FOREIGN KEY (shipping_voucher_id) REFERENCES vouchers(voucher_id) ON DELETE SET NULL,
  CONSTRAINT chk_ord_total   CHECK (ABS(total - (subtotal - discount + shipping_fee)) < 0.01),
  CONSTRAINT chk_ord_disc    CHECK (discount <= subtotal),
  INDEX idx_ord_customer (customer_id, placed_at),
  INDEX idx_ord_seller   (seller_id, status),
  INDEX idx_ord_status   (status)
) ENGINE=InnoDB;

CREATE TABLE order_items (
  order_id   BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity   INT UNSIGNED NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,                     -- price snapshot
  PRIMARY KEY (order_id, product_id),
  CONSTRAINT fk_oi_order   FOREIGN KEY (order_id)   REFERENCES orders(order_id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_product FOREIGN KEY (product_id) REFERENCES products(product_id),
  CONSTRAINT chk_oi_qty CHECK (quantity > 0)
) ENGINE=InnoDB;

-- 7-step tracking: Order Placed, Payment Confirmed, Processing, Packed, Shipped, Out for Delivery, Delivered
-- (escrow banner on the tracking page is derived: Completed = released, Cancelled = refunding, else held)
CREATE TABLE order_status_history (
  history_id   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id     BIGINT UNSIGNED NOT NULL,
  status_label VARCHAR(40) NOT NULL,
  event_time   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_osh_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
  INDEX idx_osh_order (order_id, event_time)
) ENGINE=InnoDB;

-- A customer may use a voucher code once. Cancelling an order can give it back:
--   returned_at set                       -> voucher returned to the wallet
--   returned_at NULL + return_note set    -> cancellation happened but it was NOT returned (reason in note)
CREATE TABLE voucher_redemptions (
  redemption_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  voucher_id    INT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  redeemed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returned_at   DATETIME NULL,
  return_note   VARCHAR(255) NULL,
  active_flag   TINYINT GENERATED ALWAYS AS (IF(returned_at IS NULL, 1, NULL)) STORED,
  CONSTRAINT fk_vr_voucher FOREIGN KEY (voucher_id) REFERENCES vouchers(voucher_id) ON DELETE CASCADE,
  CONSTRAINT fk_vr_user    FOREIGN KEY (user_id)    REFERENCES users(user_id)       ON DELETE CASCADE,
  UNIQUE KEY uq_vr_one_active (voucher_id, user_id, active_flag),
  INDEX idx_vr_user (user_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 7. REVIEWS, REPORTS, NOTIFICATIONS
-- ------------------------------------------------------------
CREATE TABLE reviews (
  review_id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id   BIGINT UNSIGNED NOT NULL,
  customer_id  BIGINT UNSIGNED NOT NULL,
  rating       TINYINT UNSIGNED NOT NULL,
  review_text  TEXT NOT NULL,
  seller_reply TEXT NULL,
  replied_at   DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rev_product  FOREIGN KEY (product_id)  REFERENCES products(product_id) ON DELETE CASCADE,
  CONSTRAINT fk_rev_customer FOREIGN KEY (customer_id) REFERENCES users(user_id)       ON DELETE CASCADE,
  CONSTRAINT chk_rev_rating CHECK (rating BETWEEN 1 AND 5),
  INDEX idx_rev_product (product_id)
) ENGINE=InnoDB;

-- Exactly one target; RESTRICT FKs because MySQL forbids CHECK on SET NULL/CASCADE columns
CREATE TABLE reports (
  report_id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_number     VARCHAR(20) NOT NULL UNIQUE,         -- 'RPT-101'
  reporter_id       BIGINT UNSIGNED NOT NULL,
  target_product_id BIGINT UNSIGNED NULL,
  target_seller_id  BIGINT UNSIGNED NULL,
  reason            TEXT NOT NULL,
  status            ENUM('Open','Resolved','Dismissed') NOT NULL DEFAULT 'Open',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by       BIGINT UNSIGNED NULL,
  resolved_at       DATETIME NULL,
  CONSTRAINT fk_rep_reporter FOREIGN KEY (reporter_id)       REFERENCES users(user_id),
  CONSTRAINT fk_rep_product  FOREIGN KEY (target_product_id) REFERENCES products(product_id),
  CONSTRAINT fk_rep_seller   FOREIGN KEY (target_seller_id)  REFERENCES seller_profiles(seller_id),
  CONSTRAINT fk_rep_resolver FOREIGN KEY (resolved_by)       REFERENCES users(user_id),
  CONSTRAINT chk_rep_one_target CHECK ((target_product_id IS NOT NULL) + (target_seller_id IS NOT NULL) = 1),
  INDEX idx_rep_status (status)
) ENGINE=InnoDB;

-- type 'stock' is new (low / out-of-stock alerts to sellers)
CREATE TABLE notifications (
  notification_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(150) NOT NULL,
  description VARCHAR(500) NOT NULL,
  type        ENUM('info','order','promo','stock') NOT NULL DEFAULT 'info',
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_notif_user (user_id, is_read, created_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 8. AUDIT TRAIL (read-only: see triggers at the bottom)
-- ------------------------------------------------------------
-- Audit screen columns: timestamp, who acted (+email), actor role, action, account affected, target, before -> after
CREATE TABLE audit_logs (
  log_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id        BIGINT UNSIGNED NULL,
  actor_role      ENUM('customer','seller','admin') NOT NULL,
  actor_email     VARCHAR(255) NULL,                     -- snapshot
  action          VARCHAR(80)  NOT NULL,                 -- 'Signed In','Approved Seller','Changed Setting','Blocked Access Attempt',...
  target          VARCHAR(255) NOT NULL,
  subject_user_id BIGINT UNSIGNED NULL,                  -- account affected
  subject_label   VARCHAR(255) NULL,                     -- 'Name · role · email' or 'System (platform-wide)'
  previous_value  VARCHAR(255) NULL,
  new_value       VARCHAR(255) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor   FOREIGN KEY (actor_id)        REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_subject FOREIGN KEY (subject_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_audit_time (created_at),
  INDEX idx_audit_actor (actor_id),
  INDEX idx_audit_action (action)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 9. SETTINGS, HISTORY, ROLES & PERMISSIONS (SETTINGS_SCHEMA in config.js)
-- ------------------------------------------------------------
CREATE TABLE settings (
  setting_key    VARCHAR(40) PRIMARY KEY,                -- same keys the JS uses via S('key')
  section        ENUM('general','notifications','vouchers','stock','security') NOT NULL,
  group_name     VARCHAR(40) NOT NULL,                   -- heading inside the section
  label          VARCHAR(160) NOT NULL,
  value_type     ENUM('text','number','select','toggle') NOT NULL,
  setting_value  VARCHAR(255) NOT NULL,                  -- toggles are '1' / '0'
  default_value  VARCHAR(255) NOT NULL,                  -- "Restore defaults"
  options        JSON NULL,                              -- choices for 'select'
  required_level ENUM('ops','platform','system') NOT NULL DEFAULT 'ops',
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by     BIGINT UNSIGNED NULL,
  CONSTRAINT fk_set_user FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_set_section (section, sort_order)
) ENGINE=InnoDB;

-- "Change history" table + rollback (every change needs a reason; rollbacks are logged too)
CREATE TABLE setting_history (
  history_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_key    VARCHAR(40) NOT NULL,
  label          VARCHAR(160) NOT NULL,                  -- snapshot
  previous_value VARCHAR(255) NOT NULL,
  new_value      VARCHAR(255) NOT NULL,
  reason         VARCHAR(255) NOT NULL,                  -- 'Rollback' for reverts
  changed_by     BIGINT UNSIGNED NULL,
  changed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sh2_setting FOREIGN KEY (setting_key) REFERENCES settings(setting_key),
  CONSTRAINT fk_sh2_user    FOREIGN KEY (changed_by)  REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_sh2_time (changed_at)
) ENGINE=InnoDB;

-- Roles & Permissions matrix (PERMS in config.js). Locked rows can never be granted.
CREATE TABLE permissions (
  permission_key VARCHAR(30) PRIMARY KEY,
  label          VARCHAR(160) NOT NULL,
  is_locked      BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE=InnoDB;

CREATE TABLE role_permissions (
  permission_key VARCHAR(30) NOT NULL,
  role           ENUM('customer','seller','admin') NOT NULL,
  is_granted     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (permission_key, role),
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_key) REFERENCES permissions(permission_key) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 10. SYSTEM HEALTH: BACKUPS & INTEGRATIONS
-- ------------------------------------------------------------
CREATE TABLE backup_runs (
  backup_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_by    BIGINT UNSIGNED NULL,
  run_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status    ENUM('Completed','Failed') NOT NULL DEFAULT 'Completed',
  note      VARCHAR(255) NULL,
  CONSTRAINT fk_bk_user FOREIGN KEY (run_by) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_bk_time (run_at)
) ENGINE=InnoDB;

CREATE TABLE integrations (
  integration_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(60) NOT NULL UNIQUE,
  status         ENUM('Connected','Not configured') NOT NULL DEFAULT 'Not configured',
  last_sync_at   DATETIME NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 11. VIEWS
-- ------------------------------------------------------------
-- Storefront (live() in utils.js): Active product + Active seller + active category, and sold-out items
-- hidden when settings.hideOutOfStock = 1. Explicit columns (no p.*): on_hand, reserved and cost never leak.
-- "stock" = available quantity, so the website contract is unchanged.
CREATE OR REPLACE VIEW v_live_products AS
SELECT p.product_id, p.seller_id, p.category_id, p.sku, p.name, p.description, p.price, p.original_price,
       i.quantity_available AS stock, p.threshold, p.image, p.status, p.rating_avg, p.review_count,
       p.created_at, p.updated_at, sp.store_name AS seller_name, c.name AS category_name
FROM products p
JOIN inventory i         ON i.product_id = p.product_id
JOIN seller_profiles sp  ON sp.seller_id = p.seller_id
JOIN users u             ON u.user_id = p.seller_id
JOIN categories c        ON c.category_id = p.category_id
WHERE p.status = 'Active' AND u.status = 'Active' AND c.is_active = 1
  AND NOT (i.quantity_available = 0
           AND COALESCE((SELECT setting_value FROM settings WHERE setting_key = 'hideOutOfStock'), '0') = '1');

-- Seller > Inventory screen. alert_level = the product's own threshold, else the platform default (settings.lowStock).
CREATE OR REPLACE VIEW v_inventory_status AS
SELECT p.product_id, p.seller_id, p.sku, p.name,
       i.quantity_on_hand, i.quantity_reserved, i.quantity_available,
       COALESCE(p.threshold, CAST((SELECT setting_value FROM settings WHERE setting_key = 'lowStock') AS UNSIGNED), 10) AS alert_level,
       CASE WHEN i.quantity_available = 0 THEN 'Out of Stock'
            WHEN i.quantity_available <= COALESCE(p.threshold, CAST((SELECT setting_value FROM settings WHERE setting_key = 'lowStock') AS UNSIGNED), 10)
                 THEN 'Low Stock'
            ELSE 'In Stock' END AS stock_status
FROM products p JOIN inventory i ON i.product_id = p.product_id
WHERE p.status <> 'Removed';

-- Seller > Inventory > "Recent stock changes" (manual changes only)
CREATE OR REPLACE VIEW v_stock_changes AS
SELECT m.movement_id, p.seller_id, p.product_id, p.name AS product_name, m.movement_type,
       m.quantity_before AS previous_stock, m.quantity_after AS new_stock, m.quantity_change,
       COALESCE(m.reason, m.movement_type) AS reason, m.created_by, m.created_at AS adjusted_at
FROM inventory_movements m JOIN products p ON p.product_id = m.product_id
WHERE m.movement_type IN ('PURCHASE','RESTOCK','RETURN','ADJUSTMENT');

-- ============================================================
-- REFERENCE DATA (from config.js, upgrade.js and data.js)
-- ============================================================
INSERT INTO admin_roles (name, description) VALUES
 ('Management Admin',  'Seller approvals, disputes, reports and orders. Cannot open system settings.'),
 ('Maintenance Admin', 'Site settings, toggles and system health. Cannot view sales data.');

INSERT INTO admin_role_areas (admin_role_id, area_key) VALUES
 (1,'a-dash'),(1,'a-customers'),(1,'a-sellers'),(1,'a-approval'),(1,'a-products'),(1,'a-orders'),(1,'a-reports'),(1,'a-analytics'),
 (2,'a-dash'),(2,'a-categories'),(2,'a-vouchers'),(2,'a-audit'),(2,'a-health'),(2,'a-settings');

INSERT INTO regions (name, island_group, shipping_multiplier) VALUES
 ('NCR (Metro Manila)','Metro Manila',1.00),('CAR (Cordillera)','Luzon',1.80),('Region I (Ilocos)','Luzon',1.80),
 ('Region II (Cagayan Valley)','Luzon',1.80),('Region III (Central Luzon)','Luzon',1.80),('Region IV-A (CALABARZON)','Luzon',1.80),
 ('MIMAROPA','Luzon',2.00),('Region V (Bicol)','Luzon',2.00),('Region VI (Western Visayas)','Visayas',2.40),
 ('Region VII (Central Visayas)','Visayas',2.40),('Region VIII (Eastern Visayas)','Visayas',2.40),
 ('Region IX (Zamboanga Peninsula)','Mindanao',3.00),('Region X (Northern Mindanao)','Mindanao',3.00),('Region XI (Davao)','Mindanao',3.00),
 ('Region XII (SOCCSKSARGEN)','Mindanao',3.00),('Region XIII (Caraga)','Mindanao',3.00),('BARMM','Mindanao',3.20);

INSERT INTO couriers (name, fee_multiplier, eta_min_days, eta_max_days) VALUES
 ('Standard Delivery',1.00,3,7),('J&T Express',1.15,2,5),('Flash Express',1.30,1,3);

INSERT INTO payment_methods (code, name) VALUES
 ('pay_cod','Cash on Delivery'),('pay_gcash','GCash'),('pay_card','Credit/Debit Card'),('pay_bank','Bank Transfer');

INSERT INTO categories (name, icon) VALUES
 ('Electronics','💻'),('Fashion','👗'),('Home & Living','🛋️'),('Beauty','💄'),('Sports','⚽'),('Accessories','👜');

INSERT INTO integrations (name, status, last_sync_at) VALUES
 ('Payment gateway','Not configured',NULL),('Shipping provider','Not configured',NULL),('Email service','Connected',NOW()),
 ('SMS provider','Not configured',NULL),('Analytics','Not configured',NULL),('Cloud storage','Not configured',NULL);

-- Permissions matrix ([customer, seller, admin] as in PERMS)
INSERT INTO permissions (permission_key, label, is_locked) VALUES
 ('shop','Browse, order and pay',0),('voucher','Use and receive vouchers',0),('cancel','Cancel own orders',0),
 ('products','Manage own products',0),('inventory','Manage own inventory and alert thresholds',0),('ownReports','View own shop sales reports',0),
 ('accounts','Approve, suspend and reactivate accounts',0),('audit','View the audit trail',0),('sysReports','View system-wide reports',0),
 ('settings','Change system settings (needs the right admin level)',0),
 ('sellerFinance','View any seller''s sales or financial data',1),('auditEdit','Edit or delete audit entries',1);

INSERT INTO role_permissions (permission_key, role, is_granted) VALUES
 ('shop','customer',1),('shop','seller',0),('shop','admin',0),
 ('voucher','customer',1),('voucher','seller',0),('voucher','admin',0),
 ('cancel','customer',1),('cancel','seller',0),('cancel','admin',0),
 ('products','customer',0),('products','seller',1),('products','admin',0),
 ('inventory','customer',0),('inventory','seller',1),('inventory','admin',0),
 ('ownReports','customer',0),('ownReports','seller',1),('ownReports','admin',0),
 ('accounts','customer',0),('accounts','seller',0),('accounts','admin',1),
 ('audit','customer',0),('audit','seller',0),('audit','admin',1),
 ('sysReports','customer',0),('sysReports','seller',0),('sysReports','admin',1),
 ('settings','customer',0),('settings','seller',0),('settings','admin',1),
 ('sellerFinance','customer',0),('sellerFinance','seller',0),('sellerFinance','admin',0),
 ('auditEdit','customer',0),('auditEdit','seller',0),('auditEdit','admin',0);

-- Settings (setting_key, section, group_name, label, value_type, value, default, options, required_level, sort_order)
INSERT INTO settings (setting_key, section, group_name, label, value_type, setting_value, default_value, options, required_level, sort_order) VALUES
 ('siteName','general','Store identity','Website name','text','ShopHub','ShopHub',NULL,'platform',1),
 ('tagline','general','Store identity','Tagline','text','Shop smarter, live better','Shop smarter, live better',NULL,'platform',2),
 ('contactEmail','general','Store identity','Support email','text','support@shophub.com','support@shophub.com',NULL,'platform',3),
 ('contactPhone','general','Store identity','Support phone','text','0917 000 0000','0917 000 0000',NULL,'platform',4),
 ('currency','general','Localization','Currency','select','PHP','PHP','["PHP","USD","SGD"]','platform',5),
 ('timezone','general','Localization','Time zone','select','Asia/Manila','Asia/Manila','["Asia/Manila","Asia/Singapore","UTC"]','platform',6),
 ('dateFormat','general','Localization','Date format','select','MMM D, YYYY','MMM D, YYYY','["MMM D, YYYY","DD/MM/YYYY","YYYY-MM-DD"]','platform',7),
 ('language','general','Localization','Language','select','English','English','["English","Filipino"]','platform',8),
 ('shippingFee','general','Ordering rules','Default shipping fee (₱)','number','50','50',NULL,'platform',9),
 ('freeShipMin','general','Ordering rules','Free shipping above subtotal (₱, 0 = off)','number','0','0',NULL,'platform',10),
 ('minOrder','general','Ordering rules','Minimum order subtotal (₱)','number','0','0',NULL,'platform',11),
 ('maxQty','general','Ordering rules','Maximum quantity per product per order','number','20','20',NULL,'platform',12),
 ('sellerApproval','general','Ordering rules','Require admin approval for new sellers','toggle','1','1',NULL,'platform',13),
 ('maintenance','general','Availability','Maintenance mode (blocks customers and sellers from signing in)','toggle','0','0',NULL,'platform',14),

 ('notifyLowStock','notifications','Stock alerts','Alert sellers when a product reaches its low-stock level','toggle','1','1',NULL,'ops',20),
 ('notifyOutOfStock','notifications','Stock alerts','Alert sellers when a product is out of stock','toggle','1','1',NULL,'ops',21),
 ('alertRepeat','notifications','Stock alerts','Repeat an unread stock alert','select','Once','Once','["Once","Daily"]','ops',22),
 ('notifyOrderStatus','notifications','Orders','Notify customers on every order status change','toggle','1','1',NULL,'ops',23),
 ('notifyVoucherExpiry','notifications','Vouchers','Remind customers before a voucher expires','toggle','1','1',NULL,'ops',24),
 ('voucherRemindHours','notifications','Vouchers','Reminder lead time (hours before expiry)','number','24','24',NULL,'ops',25),
 ('notifyEmail','notifications','Channels','Email channel (simulated)','toggle','1','1',NULL,'ops',26),
 ('notifySMS','notifications','Channels','SMS channel (no provider connected)','toggle','0','0',NULL,'ops',27),
 ('notifyAdminSecurity','notifications','Channels','Notify system admins about lockouts and failed sign-ins','toggle','1','1',NULL,'ops',28),

 ('returnVoucher','vouchers','Cancellation','Return an unused, non-expired voucher when its order is cancelled','toggle','1','1',NULL,'ops',40),
 ('returnExpired','vouchers','Cancellation','Also return vouchers that expired before the cancellation','toggle','0','0',NULL,'ops',41),
 ('voucherStack','vouchers','Redemption','Allow more than one voucher per order','toggle','0','0',NULL,'ops',42),
 ('voucherMaxPct','vouchers','Redemption','Maximum discount per order (% of subtotal)','number','50','50',NULL,'ops',43),
 ('voucherOncePerUser','vouchers','Redemption','Each customer can use a code only once','toggle','1','1',NULL,'ops',44),
 ('voucherDefaultDays','vouchers','Validity','Default validity for new vouchers (days)','number','30','30',NULL,'ops',45),
 ('limitedMaxDays','vouchers','Validity','Longest limited-time voucher window (days)','number','7','7',NULL,'ops',46),
 ('showCountdown','vouchers','Validity','Show live expiry countdown to customers','toggle','1','1',NULL,'ops',47),

 ('lowStock','stock','Alert levels','Default low-stock level (units)','number','10','10',NULL,'ops',60),
 ('allowSellerThreshold','stock','Alert levels','Let sellers set their own level per product','toggle','1','1',NULL,'ops',61),
 ('minThreshold','stock','Alert levels','Lowest level a seller may set (units)','number','1','1',NULL,'ops',62),
 ('hideOutOfStock','stock','Storefront','Hide out-of-stock products from the catalog','toggle','0','0',NULL,'ops',63),
 ('lowBadgeCustomers','stock','Storefront','Show "Only N left" to customers at low stock','toggle','1','1',NULL,'ops',64),

 ('pwMin','security','Passwords','Minimum password length','number','8','8',NULL,'system',80),
 ('pwExpiryDays','security','Passwords','Password expiry (days, 0 = never)','number','0','0',NULL,'system',81),
 ('maxAttempts','security','Sign-in','Failed sign-ins before lockout','number','5','5',NULL,'system',82),
 ('sessionTimeout','security','Sign-in','Idle session timeout (minutes)','number','30','30',NULL,'system',83),
 ('adminMfa','security','Sign-in','Require a second step for admin sign-in','toggle','0','0',NULL,'system',84),
 ('maskContacts','security','Privacy','Mask customer contact details in admin views','toggle','1','1',NULL,'system',85),
 ('auditRetention','security','Privacy','Audit trail retention (days)','number','730','730',NULL,'system',86);

-- ------------------------------------------------------------
-- AUDIT TRAIL IS READ-ONLY ("cannot be edited or deleted by anyone, including administrators")
-- Retention purge job may delete after: SET @allow_audit_purge = 1;
-- ------------------------------------------------------------
DELIMITER $$
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit entries are read-only.';
END$$

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW
BEGIN
  IF COALESCE(@allow_audit_purge, 0) <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit entries cannot be deleted.';
  END IF;
END$$
DELIMITER ;

-- ------------------------------------------------------------
-- INVENTORY: triggers + the single entry point for changing stock
-- ------------------------------------------------------------
DELIMITER $$

-- Every product gets its inventory row automatically. Post opening stock with:
--   CALL sp_inventory_move(<product_id>, 'RESTOCK', <qty>, NULL, NULL, 'Initial stock', <seller_id>);
CREATE TRIGGER trg_products_create_inventory AFTER INSERT ON products FOR EACH ROW
BEGIN
  INSERT INTO inventory (product_id, quantity_on_hand, quantity_reserved) VALUES (NEW.product_id, 0, 0);
END$$

-- The ledger is append-only (like audit_logs): corrections are new ADJUSTMENT rows.
CREATE TRIGGER trg_movements_no_update BEFORE UPDATE ON inventory_movements FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Inventory movements are append-only. Post an ADJUSTMENT instead.';
END$$

CREATE TRIGGER trg_movements_no_delete BEFORE DELETE ON inventory_movements FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Inventory movements cannot be deleted.';
END$$

-- Updates inventory AND writes the ledger row together. It does not COMMIT: call it inside the caller's transaction, e.g.
--   START TRANSACTION; CALL sp_inventory_move(@pid,'RESERVATION',2,'ORDER','ORD-12345','Order placed',@user); COMMIT;
-- p_qty is a positive amount for every type except ADJUSTMENT, where it is signed (+5 / -3).
CREATE PROCEDURE sp_inventory_move(
  IN p_product_id BIGINT UNSIGNED, IN p_type VARCHAR(12), IN p_qty INT,
  IN p_ref_type VARCHAR(50), IN p_ref_id VARCHAR(100), IN p_reason VARCHAR(255), IN p_user BIGINT UNSIGNED)
BEGIN
  DECLARE v_on INT; DECLARE v_res INT; DECLARE v_change INT; DECLARE v_before INT; DECLARE v_after INT;

  IF p_qty IS NULL OR p_qty = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Quantity must not be zero.';
  END IF;
  IF p_type NOT IN ('PURCHASE','SALE','RETURN','ADJUSTMENT','RESTOCK','RESERVATION','RELEASE') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unknown movement type.';
  END IF;

  SELECT quantity_on_hand, quantity_reserved INTO v_on, v_res
  FROM inventory WHERE product_id = p_product_id FOR UPDATE;          -- row lock: no overselling
  IF v_on IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This product has no inventory row.';
  END IF;

  SET v_change = CASE WHEN p_type IN ('PURCHASE','RESTOCK','RETURN','RESERVATION') THEN ABS(p_qty)
                      WHEN p_type IN ('SALE','RELEASE') THEN -ABS(p_qty)
                      ELSE p_qty END;

  IF p_type IN ('RESERVATION','RELEASE') THEN                         -- reserved counter
    SET v_before = v_res, v_after = v_res + v_change;
    IF p_type = 'RESERVATION' AND (v_on - v_res) < v_change THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Not enough stock available.';
    END IF;
    IF v_after < 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot release more than is reserved.';
    END IF;
    UPDATE inventory SET quantity_reserved = v_after WHERE product_id = p_product_id;
  ELSE                                                                -- on-hand counter
    SET v_before = v_on, v_after = v_on + v_change;
    IF v_after < v_res THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'On-hand stock cannot drop below the units already reserved.';
    END IF;
    UPDATE inventory SET quantity_on_hand = v_after WHERE product_id = p_product_id;
  END IF;

  INSERT INTO inventory_movements (product_id, movement_type, quantity_change, quantity_before, quantity_after,
                                   reference_type, reference_id, reason, created_by)
  VALUES (p_product_id, p_type, v_change, v_before, v_after, p_ref_type, p_ref_id, p_reason, p_user);
END$$

-- Shipping an order: the reservation is consumed and the goods leave the shelf.
-- RELEASE first, then SALE, so reserved never exceeds on_hand in between.
CREATE PROCEDURE sp_inventory_ship(IN p_product_id BIGINT UNSIGNED, IN p_qty INT,
                                   IN p_order_number VARCHAR(20), IN p_user BIGINT UNSIGNED)
BEGIN
  CALL sp_inventory_move(p_product_id, 'RELEASE', p_qty, 'ORDER', p_order_number, 'Order shipped: reservation consumed', p_user);
  CALL sp_inventory_move(p_product_id, 'SALE',    p_qty, 'ORDER', p_order_number, 'Order shipped', p_user);
END$$

DELIMITER ;
