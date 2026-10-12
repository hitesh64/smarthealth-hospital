<?php
// Medicine store API (patient side): product list, place an order, pay by UPI QR, own orders, cancel.
include "lib.php";

const DELIVERY_FEE = 40;          // home delivery charge in rupees
const FREE_DELIVERY_ABOVE = 500;  // no delivery charge from this subtotal
const MAX_QTY_PER_ITEM = 20;

$action = $_GET['action'] ?? '';

// What the browser needs to show the "Pay by UPI" screen for an order that is still unpaid; null otherwise.
function pay_info($o) {
    if ($o['payment_method'] !== 'UPI' || $o['status'] !== 'Placed' || $o['payment_status'] !== 'Pending' || !upi_enabled()) return null;
    return ["upi_link" => upi_link($o), "upi_id" => UPI_ID, "payee" => UPI_PAYEE_NAME,
            "seconds_left" => max(0, strtotime($o['updated_at']) + UPI_PAY_MINUTES * 60 - time())];
}

// Unpaid UPI orders that ran out of time give their medicines back before anything is listed or ordered
expire_unpaid_orders();

// The catalogue is open to everyone; ordering needs a login.
if ($action === 'products') {
    // Expired medicines and ones without a price are never sold
    $rows = db_all("SELECT id, name, unit, price, category, description, image, LEAST(stock, " . MAX_QTY_PER_ITEM . ") AS available
                    FROM medicines
                    WHERE for_sale=1 AND price > 0 AND (expiry_date IS NULL OR expiry_date >= CURDATE())
                    ORDER BY category, name");
    json_out(["status" => "success", "products" => $rows,
        "delivery_fee" => DELIVERY_FEE, "free_delivery_above" => FREE_DELIVERY_ABOVE, "max_qty" => MAX_QTY_PER_ITEM,
        "upi_enabled" => upi_enabled(), "upi_pay_minutes" => UPI_PAY_MINUTES]);
}

$email = require_user();

switch ($action) {
    case 'placeOrder':
        $name = post('name');
        $phone = preg_replace('/\D/', '', post('phone'));
        $pickup = post('delivery_type') === 'Pickup';
        $address = post('address');
        $city = post('city');
        $pincode = post('pincode');
        $upi = post('payment') === 'UPI';
        if ($upi && !upi_enabled()) fail("UPI payment is not available right now. Please choose cash.");

        if (mb_strlen($name) < 2) fail("Please enter your full name");
        if (!preg_match('/^[6-9]\d{9}$/', $phone)) fail("Please enter a valid 10-digit mobile number");
        if (!$pickup) {
            if (mb_strlen($address) < 8) fail("Please enter your full delivery address");
            if ($city === '') fail("Please enter your city");
            if (!preg_match('/^[1-9]\d{5}$/', $pincode)) fail("Please enter a valid 6-digit PIN code");
        }

        // Cart arrives as [{id, qty}]; the same medicine sent twice is added up
        $cart = [];
        foreach ((array)json_decode($_POST['items'] ?? '', true) as $row) {
            $id = (int)($row['id'] ?? 0);
            $qty = (int)($row['qty'] ?? 0);
            if ($id > 0 && $qty > 0) $cart[$id] = ($cart[$id] ?? 0) + $qty;
        }
        if (!$cart) fail("Your cart is empty");

        // Prices and stock are read from the database here, never trusted from the browser.
        // FOR UPDATE holds the rows so two people cannot buy the last strip at the same time.
        mysqli_begin_transaction($conn);
        $ids = array_keys($cart);
        $marks = implode(',', array_fill(0, count($ids), '?'));
        $found = [];
        foreach (db_all("SELECT id, name, unit, price, stock, for_sale, (expiry_date IS NOT NULL AND expiry_date < CURDATE()) AS expired
                         FROM medicines WHERE id IN ($marks) FOR UPDATE", str_repeat('i', count($ids)), $ids) as $m) {
            $found[$m['id']] = $m;
        }

        $items = [];
        $subtotal = 0;
        $problem = '';
        foreach ($cart as $id => $qty) {
            $m = $found[$id] ?? null;
            if (!$m || !$m['for_sale'] || $m['expired'] || $m['price'] <= 0) $problem = ($m['name'] ?? 'A medicine in your cart') . " is no longer available";
            elseif ($qty > MAX_QTY_PER_ITEM) $problem = "You can order at most " . MAX_QTY_PER_ITEM . " {$m['unit']} of {$m['name']}";
            elseif ($m['stock'] < $qty) $problem = $m['stock'] > 0 ? "Only {$m['stock']} {$m['unit']} of {$m['name']} left in stock" : "{$m['name']} is out of stock";
            if ($problem !== '') {
                mysqli_rollback($conn);
                fail($problem . ". Please update your cart.", 409);
            }
            $line = round($m['price'] * $qty, 2);
            $subtotal += $line;
            $items[] = [$id, $m['name'], $m['unit'], $m['price'], $qty, $line];
        }
        $subtotal = round($subtotal, 2);
        $fee = ($pickup || $subtotal >= FREE_DELIVERY_ABOVE) ? 0 : DELIVERY_FEE;
        $total = $subtotal + $fee;

        db_run("INSERT INTO medicine_orders (user_email, customer_name, phone, delivery_type, address, city, pincode, payment_method, payment_status, notes, subtotal, delivery_fee, total)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", "ssssssssssddd",
            [$email, $name, $phone, $pickup ? 'Pickup' : 'Home Delivery', $pickup ? null : $address, $pickup ? null : $city, $pickup ? null : $pincode,
             $upi ? 'UPI' : ($pickup ? 'Pay at Pickup' : 'Cash on Delivery'), $upi ? 'Pending' : 'COD', substr(post('notes'), 0, 255), $subtotal, $fee, $total]);
        $orderId = mysqli_insert_id($conn);
        $orderNo = 'MED' . date('ymd') . str_pad($orderId, 4, '0', STR_PAD_LEFT);
        db_run("UPDATE medicine_orders SET order_no=? WHERE id=?", "si", [$orderNo, $orderId]);
        foreach ($items as $i) {
            db_run("INSERT INTO medicine_order_items (order_id, medicine_id, name, unit, price, qty, line_total) VALUES (?,?,?,?,?,?,?)",
                "iissdid", [$orderId, ...$i]);
            db_run("UPDATE medicines SET stock=stock-? WHERE id=?", "ii", [$i[4], $i[0]]);
        }
        mysqli_commit($conn);

        // Reply first, the confirmation mail goes out afterwards
        $order = db_one("SELECT * FROM medicine_orders WHERE id=?", "i", [$orderId]);
        reply_now(json_encode(["status" => "success", "id" => $orderId, "order_no" => $orderNo, "total" => $total, "email" => $email,
            "payment_method" => $order['payment_method'], "pay" => pay_info($order)]));
        notify_order_status($orderId);
        exit;

    case 'submitPayment':
        // The patient has paid in their UPI app and types the 12-digit UTR; the pharmacy then checks it.
        $utr = preg_replace('/\D/', '', post('utr'));
        if (!preg_match('/^\d{12}$/', $utr)) fail("Please enter the 12-digit UTR / UPI reference number from your UPI app");
        $order = db_one("SELECT id, status, payment_method, payment_status FROM medicine_orders WHERE id=? AND user_email=?", "is", [(int)post('id'), $email]);
        if (!$order || $order['payment_method'] !== 'UPI') fail("Order not found", 404);
        if ($order['status'] === 'Cancelled') fail("This order was cancelled, so it cannot be paid. If money was taken, call " . HOSPITAL_PHONE . ".", 409);
        if (!in_array($order['payment_status'], ['Pending', 'Submitted'])) fail("The payment for this order is already recorded.", 409);
        // one payment cannot pay for two orders
        if (db_one("SELECT id FROM medicine_orders WHERE payment_ref=? AND id<>?", "si", [$utr, $order['id']])) fail("This UTR has already been used for another order. Please check the number.", 409);
        db_run("UPDATE medicine_orders SET payment_status='Submitted', payment_ref=? WHERE id=? AND status='Placed' AND payment_status IN ('Pending','Submitted')",
            "si", [$utr, $order['id']]);
        $now = db_one("SELECT payment_status, payment_ref FROM medicine_orders WHERE id=?", "i", [$order['id']]);
        if ($now['payment_status'] !== 'Submitted' || $now['payment_ref'] !== $utr) fail("This order can no longer be paid. Please refresh My Orders.", 409);
        reply_now(json_encode(["status" => "success"]));
        notify_order_status($order['id'], 'submitted');
        exit;

    case 'myOrders':
        $orders = db_all("SELECT * FROM medicine_orders WHERE user_email=? ORDER BY id DESC", "s", [$email]);
        foreach ($orders as &$o) {
            $o['items'] = db_all("SELECT name, unit, price, qty, line_total FROM medicine_order_items WHERE order_id=? ORDER BY id", "i", [$o['id']]);
            unset($o['delivery_otp_hash']);
            $o['flow'] = order_flow($o['delivery_type']);
            $o['can_cancel'] = in_array($o['status'], ['Placed', 'Confirmed']);
            $o['pay'] = pay_info($o);
        }
        unset($o);
        // While the patient is looking at their orders, send any order mail that failed earlier (internet was down)
        reply_now(json_encode(["status" => "success", "orders" => $orders]));
        if (db_one("SELECT id FROM notifications WHERE channel='email' AND status='failed' AND recipient=? AND attempts < 6
                    AND created_at > NOW() - INTERVAL 24 HOUR LIMIT 1", "s", [$email])) retry_failed_emails(5);
        exit;

    case 'cancelOrder':
        $order = db_one("SELECT id FROM medicine_orders WHERE id=? AND user_email=?", "is", [(int)post('id'), $email]);
        if (!$order) fail("Order not found", 404);
        // Once it is packed the pharmacy has to be called instead
        if (!cancel_order($order['id'], 'Cancelled by patient', ['Placed', 'Confirmed'], 'patient')) {
            fail("This order can no longer be cancelled here (it is already packed, finished or cancelled). For help call " . HOSPITAL_PHONE . ".", 409);
        }
        reply_now(json_encode(["status" => "success"]));
        notify_order_status($order['id']);
        exit;
}

fail("Unknown action", 404);
?>
