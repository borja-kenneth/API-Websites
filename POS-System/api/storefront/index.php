<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$dbConfig = require dirname(__DIR__) . '/config.php';
$localPath = __DIR__ . '/config.local.php';
$localConfig = is_file($localPath) ? require $localPath : [];
$apiKey = (string)($localConfig['api_key'] ?? '');
$imageBasePath = (string)($localConfig['image_base_path'] ?? '');

function out(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
function bad(string $message, int $status = 400): never { out(['error' => $message], $status); }
function input(): array {
    $raw = file_get_contents('php://input');
    if (strlen($raw) > 262144) bad('Request is too large.', 413);
    $data = json_decode($raw ?: '{}', true);
    if (!is_array($data)) bad('Send a valid JSON request.');
    return $data;
}
function db(array $c): PDO {
    return new PDO(sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], $c['port'], $c['database']), $c['username'], $c['password'], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES=>false]);
}
function rows(PDO $p, string $sql, array $args=[]): array { $s=$p->prepare($sql); $s->execute($args); return $s->fetchAll(); }
function row(PDO $p, string $sql, array $args=[]): ?array { return rows($p,$sql,$args)[0] ?? null; }
function run(PDO $p, string $sql, array $args=[]): int { $s=$p->prepare($sql); $s->execute($args); return $s->rowCount(); }
function bodyText(array $d,string $key,int $max): string { $v=trim((string)($d[$key]??'')); if ($v==='' || mb_strlen($v)>$max) bad('The order is missing valid customer details.'); return $v; }
function imageUrl(string $path, string $imageBasePath): ?string {
    if (!preg_match('#^uploads/products/([A-Za-z0-9._ -]+\.(?:jpg|jpeg|jfif|png|webp))$#iD',$path,$m)) return null;
    $host=(string)($_SERVER['HTTP_HOST']??''); if (!preg_match('/^[a-z0-9.:-]+$/iD',$host)) return null;
    if (!preg_match('#^/[A-Za-z0-9/_-]+$#D',$imageBasePath)) return null;
    $https=!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off';
    return ($https?'https':'http').'://'.$host.rtrim($imageBasePath,'/').'/uploads/products/'.rawurlencode($m[1]);
}
function ensureSchema(PDO $p): void {
    $p->exec("CREATE TABLE IF NOT EXISTS online_orders (
      order_number VARCHAR(50) PRIMARY KEY, customer_name VARCHAR(150) NOT NULL, customer_email VARCHAR(150) NOT NULL,
      subtotal DECIMAL(12,2) NOT NULL, item_discount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00, shipping_discount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      total_amount DECIMAL(12,2) NOT NULL, status ENUM('RESERVED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'RESERVED',
      transaction_id BIGINT UNSIGNED NULL UNIQUE, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL,
      CONSTRAINT fk_online_order_transaction FOREIGN KEY (transaction_id) REFERENCES sales_transactions(transaction_id) ON UPDATE CASCADE ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $p->exec("CREATE TABLE IF NOT EXISTS online_order_items (
      order_number VARCHAR(50) NOT NULL, product_id INT UNSIGNED NOT NULL, quantity INT UNSIGNED NOT NULL,
      unit_price DECIMAL(12,2) NOT NULL, unit_cost DECIMAL(12,2) NOT NULL, item_discount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      PRIMARY KEY(order_number,product_id), CONSTRAINT fk_online_item_order FOREIGN KEY(order_number) REFERENCES online_orders(order_number) ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT fk_online_item_product FOREIGN KEY(product_id) REFERENCES products(product_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT chk_online_item_qty CHECK(quantity>0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
function move(PDO $p,int $pid,string $type,int $qty,string $order): void {
    $inv=row($p,'SELECT quantity_on_hand,quantity_reserved FROM inventory WHERE product_id=? FOR UPDATE',[$pid]);
    if(!$inv) throw new RuntimeException('Inventory record missing.');
    $on=(int)$inv['quantity_on_hand']; $reserved=(int)$inv['quantity_reserved'];
    if($type==='RESERVATION'){
        if($on-$reserved<$qty) throw new DomainException('There is not enough stock for one or more items.');
        run($p,'UPDATE inventory SET quantity_reserved=quantity_reserved+? WHERE product_id=?',[$qty,$pid]);
        run($p,"INSERT INTO inventory_movements(product_id,movement_type,quantity_change,quantity_before,quantity_after,reference_type,reference_id,reason) VALUES (?,'RESERVATION',?,?,?,?,?,'Online order reserved')",[$pid,$qty,$reserved,$reserved+$qty,'ONLINE_ORDER',$order]); return;
    }
    if($type==='RELEASE'){
        if($reserved<$qty) throw new RuntimeException('The stock reservation does not match.');
        run($p,'UPDATE inventory SET quantity_reserved=quantity_reserved-? WHERE product_id=?',[$qty,$pid]);
        run($p,"INSERT INTO inventory_movements(product_id,movement_type,quantity_change,quantity_before,quantity_after,reference_type,reference_id,reason) VALUES (?,'RELEASE',?,?,?,?,?,'Online reservation released')",[$pid,-$qty,$reserved,$reserved-$qty,'ONLINE_ORDER',$order]); return;
    }
    if($on<$qty) throw new DomainException('There is not enough physical stock to complete this order.');
    run($p,'UPDATE inventory SET quantity_on_hand=quantity_on_hand-? WHERE product_id=?',[$qty,$pid]);
    run($p,"INSERT INTO inventory_movements(product_id,movement_type,quantity_change,quantity_before,quantity_after,reference_type,reference_id,reason) VALUES (?,'SALE',?,?,?,?,?,'Online order payment completed')",[$pid,-$qty,$on,$on-$qty,'ONLINE_ORDER',$order]);
}
function reserve(PDO $p,array $d): array {
    $number=trim((string)($d['orderNumber']??'')); if(!preg_match('/^EC-[A-F0-9-]{36}$/D',$number)) bad('Invalid online order reference.');
    $name=bodyText($d,'customerName',150); $email=bodyText($d,'customerEmail',150); if(!filter_var($email,FILTER_VALIDATE_EMAIL)) bad('Invalid customer email.');
    $items=$d['items']??null; if(!is_array($items)||!count($items)||count($items)>100) bad('The order has no valid products.');
    $p->beginTransaction();
    try {
        $old=row($p,'SELECT status,transaction_id FROM online_orders WHERE order_number=? FOR UPDATE',[$number]);
        if($old){$p->commit(); if($old['status']==='CANCELLED') bad('This order was already cancelled.',409); return ['ok'=>true,'orderNumber'=>$number,'status'=>$old['status'],'transactionId'=>$old['transaction_id']?(int)$old['transaction_id']:null,'replayed'=>true];}
        $normalized=[]; foreach($items as $i){$sku=strtoupper(trim((string)($i['sku']??'')));$qty=filter_var($i['quantity']??null,FILTER_VALIDATE_INT); if($sku===''||strlen($sku)>64||!$qty||$qty<1||$qty>99) bad('A product code or quantity is invalid.');$normalized[$sku]=($normalized[$sku]??0)+$qty;}
        $skus=array_keys($normalized); sort($skus,SORT_STRING); $products=[];
        foreach($skus as $sku){$v=row($p,"SELECT pr.product_id,pr.product_name,pr.category_id,pr.cost_price,pr.selling_price,i.quantity_on_hand,i.quantity_reserved FROM products pr JOIN inventory i ON i.product_id=pr.product_id WHERE (pr.barcode=? OR (COALESCE(pr.barcode,'')='' AND CAST(pr.product_id AS CHAR)=?)) AND pr.is_active=TRUE FOR UPDATE",[$sku,$sku]);if(!$v) throw new DomainException('A selected product is no longer available.');$products[$sku]=$v;}
        $subtotal=0.0; $lines=[]; foreach($skus as $sku){$v=$products[$sku];$qty=$normalized[$sku];if((int)$v['quantity_on_hand']-(int)$v['quantity_reserved']<$qty)throw new DomainException($v['product_name'].' does not have enough available stock.');$price=(float)$v['selling_price'];$subtotal+=$price*$qty;$lines[]=['sku'=>$sku,'product'=>$v,'qty'=>$qty,'line'=>$price*$qty];}
        $subtotal=round($subtotal,2);$discount=round((float)($d['itemDiscount']??0),2);$shipping=round((float)($d['shippingFee']??0),2);$shipDiscount=round((float)($d['shippingDiscount']??0),2);
        if(!is_finite($discount)||!is_finite($shipping)||!is_finite($shipDiscount)||min($discount,$shipping,$shipDiscount)<0||$discount>$subtotal||$shipDiscount>$shipping)bad('Invalid order totals.');
        $total=round($subtotal-$discount+$shipping-$shipDiscount,2);
        run($p,"INSERT INTO online_orders(order_number,customer_name,customer_email,subtotal,item_discount,shipping_fee,shipping_discount,total_amount,status) VALUES (?,?,?,?,?,?,?,?,'RESERVED')",[$number,$name,$email,$subtotal,$discount,$shipping,$shipDiscount,$total]);
        $left=$discount;
        foreach($lines as $idx=>$line){$share=$idx===count($lines)-1?$left:($subtotal>0?round($discount*$line['line']/$subtotal,2):0);$share=min($share,$left,$line['line']);$left=round($left-$share,2);$v=$line['product'];run($p,'INSERT INTO online_order_items(order_number,product_id,quantity,unit_price,unit_cost,item_discount) VALUES (?,?,?,?,?,?)',[$number,(int)$v['product_id'],$line['qty'],$v['selling_price'],$v['cost_price'],$share]);move($p,(int)$v['product_id'],'RESERVATION',$line['qty'],$number);}
        $p->commit(); return ['ok'=>true,'orderNumber'=>$number,'status'=>'RESERVED','total'=>$total,'replayed'=>false];
    } catch(Throwable $e){if($p->inTransaction())$p->rollBack();throw $e;}
}
function updateOrder(PDO $p,string $number,string $action,array $d=[]): array {
    if(!preg_match('/^EC-[A-F0-9-]{36}$/D',$number))bad('Invalid online order reference.');$p->beginTransaction();
    try{$o=row($p,'SELECT * FROM online_orders WHERE order_number=? FOR UPDATE',[$number]);if(!$o)throw new DomainException('Online order not found.');
        if($action==='cancel'){
            if($o['status']==='CANCELLED'){$p->commit();return ['ok'=>true,'status'=>'CANCELLED'];}if($o['status']!=='RESERVED')throw new DomainException('Only a reserved order can be cancelled.');
            foreach(rows($p,'SELECT product_id,quantity FROM online_order_items WHERE order_number=? ORDER BY product_id FOR UPDATE',[$number]) as $i)move($p,(int)$i['product_id'],'RELEASE',(int)$i['quantity'],$number);
            run($p,"UPDATE online_orders SET status='CANCELLED' WHERE order_number=?",[$number]);$p->commit();return ['ok'=>true,'status'=>'CANCELLED'];
        }
        if($o['status']==='COMPLETED'){$p->commit();return ['ok'=>true,'status'=>'COMPLETED','transactionId'=>(int)$o['transaction_id']];}if($o['status']!=='RESERVED')throw new DomainException('Only a reserved order can be completed.');
        $items=rows($p,'SELECT oi.*,pr.category_id,pr.product_name FROM online_order_items oi JOIN products pr ON pr.product_id=oi.product_id WHERE oi.order_number=? ORDER BY oi.product_id FOR UPDATE',[$number]);if(!$items)throw new RuntimeException('Order has no item lines.');
        $settings=row($p,'SELECT receipt_prefix FROM system_settings WHERE settings_id=1');$receipt=(string)($settings['receipt_prefix']??'POS').'-WEB-'.$number;
        $discount=round((float)$o['item_discount']+(float)$o['shipping_discount'],2);$notes='SaleSync Online order '.$number.'; shipping '.number_format((float)$o['shipping_fee']-(float)$o['shipping_discount'],2,'.','').' PHP';
        run($p,"INSERT INTO sales_transactions(receipt_number,source_channel,external_order_id,customer_name,customer_email,subtotal,discount_amount,tax_amount,total_amount,status,notes,completed_at) VALUES (?,'ECOMMERCE',?,?,?,?,?,?,?,'COMPLETED',?,NOW())",[$receipt,$number,$o['customer_name'],$o['customer_email'],$o['subtotal'],$discount,0,$o['total_amount'],$notes]);$tx=(int)$p->lastInsertId();
        foreach($items as $i){$line=round((float)$i['unit_price']*(int)$i['quantity']-(float)$i['item_discount'],2);run($p,'INSERT INTO sale_items(transaction_id,product_id,category_id,quantity,unit_price,unit_cost,discount_amount,line_total) VALUES (?,?,?,?,?,?,?,?)',[$tx,(int)$i['product_id'],(int)$i['category_id'],(int)$i['quantity'],$i['unit_price'],$i['unit_cost'],$i['item_discount'],$line]);move($p,(int)$i['product_id'],'RELEASE',(int)$i['quantity'],$number);move($p,(int)$i['product_id'],'SALE',(int)$i['quantity'],$number);}
        $provider=trim((string)($d['provider']??'SaleSync Online'));$providerId=trim((string)($d['providerPaymentId']??''));if(strlen($providerId)>150)$providerId='';
        run($p,"INSERT INTO payments(transaction_id,payment_method,payment_provider,provider_payment_id,amount,status,paid_at) VALUES (?,'ONLINE',?,?,?,'PAID',NOW())",[$tx,$provider,$providerId?:null,$o['total_amount']]);
        run($p,"INSERT INTO audit_logs(action,entity_type,entity_id,new_value) VALUES ('ONLINE_ORDER_COMPLETED','SALE',?,?)",[(string)$tx,json_encode(['orderNumber'=>$number,'source'=>'SaleSync Online'])]);
        run($p,"UPDATE online_orders SET status='COMPLETED',transaction_id=?,completed_at=NOW() WHERE order_number=?",[$tx,$number]);$p->commit();return ['ok'=>true,'status'=>'COMPLETED','transactionId'=>$tx,'receiptNumber'=>$receipt];
    }catch(Throwable $e){if($p->inTransaction())$p->rollBack();throw $e;}
}

if($apiKey===''||strlen($apiKey)<32)bad('SaleSync Online API key is not configured.',503);
$provided=(string)($_SERVER['HTTP_X_SALESYNC_KEY']??'');if($provided===''||!hash_equals($apiKey,$provided))bad('Not authorized.',401);
try{$p=db($dbConfig);ensureSchema($p);$route=trim((string)($_GET['route']??''),'/');$method=strtoupper((string)($_SERVER['REQUEST_METHOD']??'GET'));
    if($method==='GET'&&$route==='health'){rows($p,'SELECT 1');out(['ok'=>true,'service'=>'salesync-online']);}
    if($method==='GET'&&$route==='catalog'){
        $products=rows($p,"SELECT pr.product_id,pr.product_name,pr.barcode,pr.image_path,pr.description,pr.category_id,c.category_name,pr.selling_price,i.quantity_on_hand,i.quantity_reserved FROM products pr JOIN categories c ON c.category_id=pr.category_id JOIN inventory i ON i.product_id=pr.product_id WHERE pr.is_active=TRUE ORDER BY pr.product_id");
        $settings=row($p,'SELECT store_name FROM system_settings WHERE settings_id=1');
        out(['ok'=>true,'storeName'=>$settings['store_name']??'SaleSync','products'=>array_map(static fn($x)=>['productId'=>(int)$x['product_id'],'name'=>$x['product_name'],'sku'=>(string)($x['barcode']?:$x['product_id']),'category'=>$x['category_name'],'price'=>(float)$x['selling_price'],'stock'=>max(0,(int)$x['quantity_on_hand']-(int)$x['quantity_reserved']),'image'=>imageUrl((string)($x['image_path']??''),$imageBasePath),'description'=>$x['description']??''], $products)]);
    }
    if($method==='POST'&&$route==='orders')out(reserve($p,input()),201);
    if($method==='POST'&&preg_match('~^orders/(EC-[A-F0-9-]{36})/(complete|cancel)$~D',$route,$m))out(updateOrder($p,$m[1],$m[2],input()));
    bad('Endpoint not found.',404);
}catch(DomainException $e){bad($e->getMessage(),409);}catch(Throwable $e){error_log('SaleSync Online API: '.$e->getMessage());bad('SaleSync could not process the online order.',500);}
