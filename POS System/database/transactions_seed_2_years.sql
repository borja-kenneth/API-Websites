-- SaleSync sample history: 200 completed physical-store transactions
-- Period: 2024-10-24 through 2026-10-24 (Asia/Manila project date)
--
-- Import this only into the SaleSync database after the schema is installed.
-- This is synthetic reporting data. New image-backed sample products are given
-- opening stock; the historical transactions do not reduce current stock.
-- Products without a saved image are deleted only when no sale history refers
-- to them; if history exists, they are kept but hidden from active listings.
-- Prices and opening quantities for newly created products are sample values.

USE salesync;

DELIMITER $$

DROP PROCEDURE IF EXISTS seed_salesync_two_year_transactions$$

CREATE PROCEDURE seed_salesync_two_year_transactions()
BEGIN
    DECLARE v_i INT DEFAULT 1;
    DECLARE v_product_count INT DEFAULT 0;
    DECLARE v_product_id INT UNSIGNED;
    DECLARE v_category_id INT UNSIGNED;
    DECLARE v_unit_price DECIMAL(12,2);
    DECLARE v_unit_cost DECIMAL(12,2);
    DECLARE v_quantity INT;
    DECLARE v_subtotal DECIMAL(12,2);
    DECLARE v_tax DECIMAL(12,2);
    DECLARE v_total DECIMAL(12,2);
    DECLARE v_created_at DATETIME;
    DECLARE v_receipt VARCHAR(50);
    DECLARE v_transaction_id BIGINT UNSIGNED;
    DECLARE v_cashier_id INT UNSIGNED DEFAULT NULL;
    DECLARE v_payment_method VARCHAR(10);
    DECLARE v_cash_received DECIMAL(12,2);
    DECLARE v_offset INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        DROP TEMPORARY TABLE IF EXISTS tmp_seed_photo_products;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- Add categories needed by the uploaded product photos.
    INSERT INTO categories (category_name)
    VALUES ('Accessories'), ('Home & Bedding'), ('Electronics'), ('Footwear')
    ON DUPLICATE KEY UPDATE category_name = VALUES(category_name);

    -- Add one catalog item for each currently uploaded product photo that
    -- does not already have a matching product row. The currency is PHP.
    INSERT INTO products
        (product_name, image_path, description, category_id, cost_price,
         selling_price, reorder_point, is_active)
    SELECT 'Everyday Backpack', 'uploads/products/bag.jfif',
           'Sample product created from the uploaded backpack photo.',
           c.category_id, 450.00, 899.00, 10, TRUE
    FROM categories c
    WHERE c.category_name = 'Accessories'
      AND NOT EXISTS (SELECT 1 FROM products WHERE image_path = 'uploads/products/bag.jfif');

    INSERT INTO products
        (product_name, image_path, description, category_id, cost_price,
         selling_price, reorder_point, is_active)
    SELECT 'Striped Bedsheet Set', 'uploads/products/bedsheet.webp',
           'Sample product created from the uploaded bedsheet photo.',
           c.category_id, 650.00, 1299.00, 10, TRUE
    FROM categories c
    WHERE c.category_name = 'Home & Bedding'
      AND NOT EXISTS (SELECT 1 FROM products WHERE image_path = 'uploads/products/bedsheet.webp');

    INSERT INTO products
        (product_name, image_path, description, category_id, cost_price,
         selling_price, reorder_point, is_active)
    SELECT 'Wireless Headphones', 'uploads/products/headphones.jfif',
           'Sample product created from the uploaded headphones photo.',
           c.category_id, 750.00, 1499.00, 10, TRUE
    FROM categories c
    WHERE c.category_name = 'Electronics'
      AND NOT EXISTS (SELECT 1 FROM products WHERE image_path = 'uploads/products/headphones.jfif');

    INSERT INTO products
        (product_name, image_path, description, category_id, cost_price,
         selling_price, reorder_point, is_active)
    SELECT 'Kids Sneakers', 'uploads/products/shoes.jfif',
           'Sample product created from the uploaded shoes photo.',
           c.category_id, 600.00, 1199.00, 10, TRUE
    FROM categories c
    WHERE c.category_name = 'Footwear'
      AND NOT EXISTS (SELECT 1 FROM products WHERE image_path = 'uploads/products/shoes.jfif');

    INSERT INTO products
        (product_name, image_path, description, category_id, cost_price,
         selling_price, reorder_point, is_active)
    SELECT 'Decorative Throw Pillow', 'uploads/products/throw pillow.jfif',
           'Sample product created from the uploaded throw pillow photo.',
           c.category_id, 220.00, 449.00, 10, TRUE
    FROM categories c
    WHERE c.category_name = 'Home & Bedding'
      AND NOT EXISTS (SELECT 1 FROM products WHERE image_path = 'uploads/products/throw pillow.jfif');

    INSERT INTO products
        (product_name, image_path, description, category_id, cost_price,
         selling_price, reorder_point, is_active)
    SELECT 'Gold-tone Wristwatch', 'uploads/products/watch.jfif',
           'Sample product created from the uploaded wristwatch photo.',
           c.category_id, 1800.00, 3499.00, 5, TRUE
    FROM categories c
    WHERE c.category_name = 'Accessories'
      AND NOT EXISTS (SELECT 1 FROM products WHERE image_path = 'uploads/products/watch.jfif');

    -- Give each newly added catalog item a sample opening quantity so it can
    -- appear in checkout and be used in the seeded transaction history.
    INSERT INTO inventory (product_id, quantity_on_hand, quantity_reserved)
    SELECT p.product_id, 200, 0
    FROM products p
    WHERE p.image_path IN (
        'uploads/products/bag.jfif',
        'uploads/products/bedsheet.webp',
        'uploads/products/headphones.jfif',
        'uploads/products/shoes.jfif',
        'uploads/products/throw pillow.jfif',
        'uploads/products/watch.jfif'
    )
      AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.product_id = p.product_id);

    DROP TEMPORARY TABLE IF EXISTS tmp_seed_photo_products;
    CREATE TEMPORARY TABLE tmp_seed_photo_products AS
        SELECT product_id, category_id, selling_price, cost_price
        FROM products
        WHERE is_active = TRUE
          AND image_path IS NOT NULL
          AND TRIM(image_path) <> '';

    SELECT COUNT(*) INTO v_product_count FROM tmp_seed_photo_products;
    IF v_product_count = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'No active products with saved photos. Add product photos before importing this seed file.';
    END IF;

    SELECT u.user_id INTO v_cashier_id
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
    WHERE r.role_name = 'CASHIER' AND u.is_active = TRUE
    ORDER BY u.user_id
    LIMIT 1;

    -- Allow safe re-import: remove only records created by this seed file.
    DELETE FROM digital_receipts
    WHERE transaction_id IN (
        SELECT transaction_id FROM sales_transactions
        WHERE receipt_number LIKE 'SEED2Y-20241024-%'
    );
    DELETE FROM payments
    WHERE transaction_id IN (
        SELECT transaction_id FROM sales_transactions
        WHERE receipt_number LIKE 'SEED2Y-20241024-%'
    );
    DELETE FROM sale_items
    WHERE transaction_id IN (
        SELECT transaction_id FROM sales_transactions
        WHERE receipt_number LIKE 'SEED2Y-20241024-%'
    );
    DELETE FROM sales_transactions
    WHERE receipt_number LIKE 'SEED2Y-20241024-%';

    -- Remove photo-less products that have no historical sale references.
    -- Keep and deactivate any product needed to preserve older records.
    DELETE FROM inventory_movements
    WHERE product_id IN (
        SELECT p.product_id FROM products p
        WHERE (p.image_path IS NULL OR TRIM(p.image_path) = '')
          AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.product_id = p.product_id)
          AND NOT EXISTS (SELECT 1 FROM sales_return_items sri WHERE sri.product_id = p.product_id)
    );
    DELETE FROM inventory
    WHERE product_id IN (
        SELECT p.product_id FROM products p
        WHERE (p.image_path IS NULL OR TRIM(p.image_path) = '')
          AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.product_id = p.product_id)
          AND NOT EXISTS (SELECT 1 FROM sales_return_items sri WHERE sri.product_id = p.product_id)
    );
    DELETE FROM products
    WHERE (image_path IS NULL OR TRIM(image_path) = '')
      AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.product_id = products.product_id)
      AND NOT EXISTS (SELECT 1 FROM sales_return_items sri WHERE sri.product_id = products.product_id);
    UPDATE products
    SET is_active = FALSE
    WHERE (image_path IS NULL OR TRIM(image_path) = '');

    WHILE v_i <= 200 DO
        SET v_offset = MOD(v_i - 1, v_product_count);
        SELECT product_id, category_id, selling_price, cost_price
        INTO v_product_id, v_category_id, v_unit_price, v_unit_cost
        FROM tmp_seed_photo_products
        ORDER BY product_id
        LIMIT v_offset, 1;

        SET v_quantity = 1 + MOD(v_i * 7, 3);
        SET v_subtotal = v_unit_price * v_quantity;
        SET v_tax = ROUND(v_subtotal * 0.12, 2);
        SET v_total = v_subtotal + v_tax;
        SET v_created_at = DATE_ADD(
            DATE_ADD('2024-10-24 00:00:00', INTERVAL MOD(v_i * 137, 731) DAY),
            INTERVAL MOD(v_i * 7919, 86400) SECOND
        );
        SET v_receipt = CONCAT('SEED2Y-20241024-', LPAD(v_i, 3, '0'));
        SET v_payment_method = CASE MOD(v_i, 3)
            WHEN 0 THEN 'CASH'
            WHEN 1 THEN 'CARD'
            ELSE 'ONLINE'
        END;
        SET v_cash_received = IF(v_payment_method = 'CASH', v_total + 500.00, NULL);

        INSERT INTO sales_transactions
            (receipt_number, source_channel, user_id, customer_name,
             subtotal, discount_amount, tax_amount, total_amount, status,
             notes, created_at, completed_at)
        VALUES
            (v_receipt, 'PHYSICAL', v_cashier_id, 'Sample Customer',
             v_subtotal, 0.00, v_tax, v_total, 'COMPLETED',
             'Synthetic two-year demo transaction', v_created_at, v_created_at);

        SET v_transaction_id = LAST_INSERT_ID();

        INSERT INTO sale_items
            (transaction_id, product_id, category_id, quantity,
             unit_price, unit_cost, discount_amount, line_total)
        VALUES
            (v_transaction_id, v_product_id, v_category_id, v_quantity,
             v_unit_price, v_unit_cost, 0.00, v_subtotal);

        INSERT INTO payments
            (transaction_id, payment_method, payment_provider, amount, status,
             cash_received, change_amount, paid_at)
        VALUES
            (v_transaction_id, v_payment_method,
             IF(v_payment_method = 'ONLINE', 'DEMO', NULL),
             v_total, 'PAID', v_cash_received,
             IF(v_payment_method = 'CASH', 500.00, NULL), v_created_at);

        SET v_i = v_i + 1;
    END WHILE;

    COMMIT;
    DROP TEMPORARY TABLE IF EXISTS tmp_seed_photo_products;
END$$

DELIMITER ;

CALL seed_salesync_two_year_transactions();
DROP PROCEDURE IF EXISTS seed_salesync_two_year_transactions;

