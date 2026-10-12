<?php
// Admin API: analytics + reports, medicine stock / store catalogue, medicine orders, notification log.
include "lib.php";
include_once "sendReminders.php";

$action = $_GET['action'] ?? '';

if ($action === 'logout') {
    unset($_SESSION['admin_email']);
    json_out(["status" => "success"]);
}

$adminEmail = require_admin();

// Page refresh par admin ko dobara login na karna pade
if ($action === 'me') {
    $me = db_one("SELECT name, email FROM admins WHERE email=?", "s", [$adminEmail]);
    if (!$me) fail("Admin login required", 401);
    json_out(["status" => "success", "name" => $me['name'], "email" => $me['email']]);
}

function date_param($key, $default) {
    $v = $_GET[$key] ?? '';
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : $default;
}

// Saves an uploaded product photo into uploads/medicines and returns its path ('' when no file was sent).
// The file type is read from the image itself, not from the name the browser sent.
function save_medicine_image() {
    if (empty($_FILES['image']) || $_FILES['image']['error'] === UPLOAD_ERR_NO_FILE) return '';
    $file = $_FILES['image'];
    if ($file['error'] !== UPLOAD_ERR_OK || $file['size'] > 3 * 1024 * 1024) fail("Image upload failed. Please use a photo smaller than 3 MB.");
    $info = @getimagesize($file['tmp_name']);
    $ext = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'][$info[2] ?? 0] ?? null;
    if ($ext === null) fail("The photo must be a JPG, PNG, WEBP or GIF image");
    if (!is_dir(__DIR__ . "/uploads/medicines")) mkdir(__DIR__ . "/uploads/medicines", 0775, true);
    $path = "uploads/medicines/" . new_token() . "." . $ext;
    if (!move_uploaded_file($file['tmp_name'], __DIR__ . "/" . $path)) fail("Could not save the image", 500);
    return $path;
}

function remove_medicine_image($path) {
    if ($path && strpos($path, 'uploads/medicines/') === 0 && is_file(__DIR__ . "/" . $path)) @unlink(__DIR__ . "/" . $path);
}

$from = date_param('from', date('Y-m-d', strtotime('-29 days')));
$to = date_param('to', date('Y-m-d'));
$range = [$from, $to];
$slotOrder = "STR_TO_DATE(time_slot, '%h:%i %p')";

switch ($action) {
    // ------------------------------------------------------------ analytics
    case 'analytics':
        $perDay = db_all("SELECT appointment_date AS day, COUNT(*) AS total FROM bookings
                          WHERE appointment_date BETWEEN ? AND ? GROUP BY appointment_date ORDER BY appointment_date", "ss", $range);
        $busy = db_all("SELECT time_slot, COUNT(*) AS total FROM bookings
                        WHERE appointment_date BETWEEN ? AND ? GROUP BY time_slot ORDER BY $slotOrder", "ss", $range);
        $dept = db_all("SELECT COALESCE(d.specialization,'Unknown') AS department, COUNT(*) AS total
                        FROM bookings b LEFT JOIN doctors d ON d.id=b.doctor_id
                        WHERE b.appointment_date BETWEEN ? AND ? GROUP BY department ORDER BY total DESC", "ss", $range);
        $doctors = db_all("SELECT COALESCE(d.doctor_name, CONCAT('Doctor #', b.doctor_id)) AS doctor, COUNT(*) AS total,
                                  SUM(b.status IN ('Completed','Confirmed')) AS completed
                           FROM bookings b LEFT JOIN doctors d ON d.id=b.doctor_id
                           WHERE b.appointment_date BETWEEN ? AND ? GROUP BY b.doctor_id ORDER BY total DESC", "ss", $range);
        $statuses = db_all("SELECT COALESCE(status,'Pending') AS status, COUNT(*) AS total FROM bookings
                            WHERE appointment_date BETWEEN ? AND ? GROUP BY status", "ss", $range);
        $sum = db_one("SELECT COUNT(*) AS total, COUNT(DISTINCT user_id) AS patients FROM bookings
                       WHERE appointment_date BETWEEN ? AND ?", "ss", $range);
        $today = db_one("SELECT COUNT(*) AS c FROM bookings WHERE appointment_date=CURDATE()");
        $sos = db_one("SELECT COUNT(*) AS c FROM sos_alerts WHERE DATE(created_at) BETWEEN ? AND ?", "ss", $range);

        $days = max(1, (int)((strtotime($to) - strtotime($from)) / 86400) + 1);
        $peak = null;
        foreach ($busy as $slot) if ($peak === null || $slot['total'] > $peak['total']) $peak = $slot;

        json_out(["status" => "success", "from" => $from, "to" => $to,
            "summary" => [
                "today" => (int)$today['c'], "total" => (int)$sum['total'], "patients" => (int)$sum['patients'],
                "avg_per_day" => round($sum['total'] / $days, 1), "sos" => (int)$sos['c'],
                "peak_slot" => $peak ? $peak['time_slot'] : null,
            ],
            "per_day" => $perDay, "busy_hours" => $busy, "departments" => $dept, "doctors" => $doctors, "statuses" => $statuses]);

    case 'export':
        // CSV report of every appointment in the range
        $rows = db_all("SELECT b.id, b.appointment_date, b.time_slot, b.token_no, b.patient_name, b.patient_phone, b.user_id,
                               d.doctor_name, d.specialization, b.status
                        FROM bookings b LEFT JOIN doctors d ON d.id=b.doctor_id
                        WHERE b.appointment_date BETWEEN ? AND ? ORDER BY b.appointment_date, b.doctor_id, b.token_no", "ss", $range);
        header('Content-Type: text/csv');
        header("Content-Disposition: attachment; filename=\"appointments_{$from}_to_{$to}.csv\"");
        $out = fopen('php://output', 'w');
        fputcsv($out, ['ID', 'Date', 'Time Slot', 'Token', 'Patient', 'Phone', 'Email', 'Doctor', 'Department', 'Status']);
        foreach ($rows as $r) {
            // stop spreadsheet apps treating patient-entered text as a formula
            fputcsv($out, array_map(fn($v) => preg_match('/^[=+\-@]/', (string)$v) ? "'" . $v : $v, array_values($r)));
        }
        exit;

    // ------------------------------------------------------------ doctor records
    case 'doctorRecords':
        // every appointment of one doctor; the admin panel splits them into pending / completed
        $doc = db_one("SELECT id, doctor_name, specialization FROM doctors WHERE id=?", "i", [(int)($_GET['id'] ?? 0)]);
        if (!$doc) fail("Doctor not found", 404);
        $rows = db_all("SELECT id, patient_name, patient_phone, appointment_date, time_slot, token_no,
                               COALESCE(status,'Pending') AS status
                        FROM bookings WHERE doctor_id=? ORDER BY appointment_date DESC, token_no, id", "i", [$doc['id']]);
        json_out(["status" => "success", "doctor" => $doc, "records" => $rows]);

    // ------------------------------------------------------------ medicine stock
    case 'medicines':
        $rows = db_all("SELECT *, (stock <= reorder_level) AS low,
                               (expiry_date IS NOT NULL AND expiry_date < CURDATE()) AS expired,
                               (expiry_date IS NOT NULL AND expiry_date >= CURDATE() AND expiry_date <= CURDATE() + INTERVAL 30 DAY) AS expiring
                        FROM medicines ORDER BY (stock <= reorder_level) DESC, name");
        $alerts = 0;
        foreach ($rows as $r) if ($r['low'] || $r['expired'] || $r['expiring']) $alerts++;
        json_out(["status" => "success", "medicines" => $rows, "alerts" => $alerts]);

    case 'saveMedicine':
        $name = post('name');
        if ($name === '') fail("Medicine name is required");
        $id = (int)post('id');
        if (db_one("SELECT id FROM medicines WHERE name=? AND id<>?", "si", [$name, $id])) fail("This medicine is already in the list");
        $price = round((float)post('price'), 2);
        $forSale = post('for_sale') === '1' ? 1 : 0;
        if ($price < 0) fail("Price cannot be negative");
        if ($forSale && $price <= 0) fail("Enter the selling price, or untick \"Show in patient store\"");
        $expiry = preg_match('/^\d{4}-\d{2}-\d{2}$/', post('expiry_date')) ? post('expiry_date') : null;
        $fields = [$name, max(0, (int)post('stock')), max(0, (int)post('reorder_level')), post('unit') ?: 'strips', $expiry,
                   $price, post('category') ?: 'General', substr(post('description'), 0, 500), $forSale];
        $image = save_medicine_image();
        if ($id) {
            $old = db_one("SELECT image FROM medicines WHERE id=?", "i", [$id]);
            if (!$old) fail("Medicine not found", 404);
            db_run("UPDATE medicines SET name=?, stock=?, reorder_level=?, unit=?, expiry_date=?, price=?, category=?, description=?, for_sale=? WHERE id=?",
                "siissdssii", [...$fields, $id]);
            if ($image !== '') {
                db_run("UPDATE medicines SET image=? WHERE id=?", "si", [$image, $id]);
                remove_medicine_image($old['image']);
            }
        } else {
            db_run("INSERT INTO medicines (name, stock, reorder_level, unit, expiry_date, price, category, description, for_sale, image) VALUES (?,?,?,?,?,?,?,?,?,?)",
                "siissdssis", [...$fields, $image !== '' ? $image : null]);
        }
        json_out(["status" => "success"]);

    case 'adjustStock':
        // delta is +received or -dispensed; stock never goes below zero
        $med = db_one("SELECT stock FROM medicines WHERE id=?", "i", [(int)post('id')]);
        if (!$med) fail("Medicine not found", 404);
        $delta = (int)post('delta');
        if ($delta < 0 && -$delta > (int)$med['stock']) {
            fail("Only " . (int)$med['stock'] . " in stock - cannot remove " . (-$delta) . ". Use '+ Received' first to add stock.");
        }
        db_run("UPDATE medicines SET stock=stock + ? WHERE id=?", "ii", [$delta, (int)post('id')]);
        json_out(["status" => "success", "stock" => (int)$med['stock'] + $delta]);

    case 'deleteMedicine':
        $old = db_one("SELECT image FROM medicines WHERE id=?", "i", [(int)post('id')]);
        db_run("DELETE FROM medicines WHERE id=?", "i", [(int)post('id')]);
        if ($old) remove_medicine_image($old['image']);
        json_out(["status" => "success"]);

    // ------------------------------------------------------------ medicine orders
    case 'orders':
        expire_unpaid_orders();
        // Counts for the dashboard come from the whole table, not from the 200 rows listed below,
        // so they stay right however many orders there are. The first six partition every order.
        $stats = db_one("SELECT COUNT(*) AS total,
                COALESCE(SUM(status='Placed' AND payment_status<>'Pending'), 0) AS new_orders,
                COALESCE(SUM(status='Placed' AND payment_status='Pending'), 0) AS awaiting_payment,
                COALESCE(SUM(status IN ('Confirmed','Packed')), 0) AS preparing,
                COALESCE(SUM(status IN ('Out for Delivery','Ready for Pickup')), 0) AS dispatch,
                COALESCE(SUM(status IN ('Delivered','Collected')), 0) AS completed,
                COALESCE(SUM(status='Cancelled'), 0) AS cancelled,
                COALESCE(SUM(status='Placed' AND payment_status='Submitted'), 0) AS to_verify,
                COALESCE(SUM(payment_status='Refund Due'), 0) AS refund_due,
                COALESCE(SUM(DATE(created_at)=CURDATE()), 0) AS today,
                COALESCE(SUM(IF(status IN ('Delivered','Collected'), total, 0)), 0) AS sales,
                COALESCE(SUM(IF(status IN ('Delivered','Collected') AND DATE(updated_at)=CURDATE(), total, 0)), 0) AS sales_today
            FROM medicine_orders");
        foreach ($stats as $k => $v) $stats[$k] = ($k === 'sales' || $k === 'sales_today') ? (float)$v : (int)$v;

        // Orders that still need work are listed first, so the 200-row limit can only cut off old finished ones
        $orders = db_all("SELECT * FROM medicine_orders
                          ORDER BY (status NOT IN ('Delivered','Collected','Cancelled') OR payment_status='Refund Due') DESC, id DESC LIMIT 200");
        usort($orders, fn($a, $b) => $b['id'] <=> $a['id']);
        $waiting = 0;
        foreach ($orders as &$o) {
            $o['items'] = db_all("SELECT name, unit, price, qty, line_total FROM medicine_order_items WHERE order_id=? ORDER BY id", "i", [$o['id']]);
            $flow = order_flow($o['delivery_type']);
            $at = array_search($o['status'], $flow);
            // next_status is null once the order is finished or cancelled
            $o['next_status'] = ($at !== false && $at < count($flow) - 1) ? $flow[$at + 1] : null;
            // the OTP itself is never shown to the admin - only whether it is locked
            $o['otp_locked'] = (int)$o['otp_attempts'] >= DELIVERY_OTP_MAX_TRIES;
            unset($o['delivery_otp_hash']);
            // the badge counts what the pharmacy has to act on: new cash orders, UPI payments to check, refunds to send.
            // A UPI order the patient has not paid yet is not the pharmacy's turn.
        }
        unset($o);
        $waiting = $stats['new_orders'] + $stats['refund_due'];
        json_out(["status" => "success", "orders" => $orders, "waiting" => $waiting, "stats" => $stats, "upi_id" => upi_enabled() ? UPI_ID : '']);

    case 'orderStatus':
        // Moves an order exactly one step forward. The step the admin saw is sent along, so a
        // double click or a second admin cannot push the same order two steps.
        $order = db_one("SELECT id, status, delivery_type, payment_method, payment_status FROM medicine_orders WHERE id=?", "i", [(int)post('id')]);
        if (!$order) fail("Order not found", 404);
        $flow = order_flow($order['delivery_type']);
        $at = array_search($order['status'], $flow);
        $next = ($at !== false && $at < count($flow) - 1) ? $flow[$at + 1] : null;
        if ($next === null || $next !== post('status')) fail("This order was already updated (now: {$order['status']}). The list has been refreshed.", 409);
        // a UPI order is not prepared until its payment has been checked
        if ($order['payment_method'] === 'UPI' && $order['payment_status'] !== 'Paid') fail("This is a UPI order and its payment is not verified yet.", 409);
        $home = $order['delivery_type'] !== 'Pickup';

        // Home delivery is completed only with the OTP the patient received by email.
        if ($home && $next === 'Delivered') {
            $otp = preg_replace('/\D/', '', post('otp'));
            if (strlen($otp) !== 6) fail("Enter the 6-digit delivery OTP that the patient received by email.");
            $row = db_one("SELECT delivery_otp_hash, otp_sent_at, otp_attempts,
                                  (otp_sent_at < NOW() - INTERVAL " . (int)DELIVERY_OTP_HOURS . " HOUR) AS expired
                           FROM medicine_orders WHERE id=?", "i", [$order['id']]);
            if (!$row || empty($row['delivery_otp_hash'])) fail("No delivery OTP was issued for this order. Press \"Resend OTP\" first.", 409);
            if ($row['expired']) fail("The delivery OTP has expired. Press \"Resend OTP\" to email a new one.", 409);
            // the try is counted BEFORE it is checked, so parallel requests cannot guess more than the limit
            $try = db_run("UPDATE medicine_orders SET otp_attempts=otp_attempts+1 WHERE id=? AND otp_attempts<?", "ii", [$order['id'], DELIVERY_OTP_MAX_TRIES]);
            if (mysqli_stmt_affected_rows($try) !== 1) fail("Too many wrong OTPs. Press \"Resend OTP\" to email the patient a new one.", 423);
            if (!password_verify($otp, $row['delivery_otp_hash'])) {
                $left = DELIVERY_OTP_MAX_TRIES - ((int)$row['otp_attempts'] + 1);
                fail($left > 0 ? "Wrong OTP. $left " . ($left === 1 ? "try" : "tries") . " left." : "Wrong OTP. The order is locked - press \"Resend OTP\" to email a new one.", 403);
            }
        }

        $stmt = db_run("UPDATE medicine_orders SET status=? WHERE id=? AND status=? AND (payment_method<>'UPI' OR payment_status='Paid')",
            "sis", [$next, $order['id'], $order['status']]);
        if (mysqli_stmt_affected_rows($stmt) !== 1) fail("This order was already updated. The list has been refreshed.", 409);

        $newOtp = '';
        if ($home && $next === 'Out for Delivery') $newOtp = issue_delivery_otp($order['id']);
        if ($home && $next === 'Delivered') db_run("UPDATE medicine_orders SET delivery_otp_hash=NULL WHERE id=?", "i", [$order['id']]);

        reply_now(json_encode(["status" => "success", "new_status" => $next]));
        notify_order_status($order['id'], '', '', $newOtp);
        exit;

    case 'resendDeliveryOtp':
        // The patient lost the mail, it expired, or it was locked by wrong tries: a fresh OTP replaces the old one
        $order = db_one("SELECT id, delivery_type, status, otp_sent_at, (otp_sent_at > NOW() - INTERVAL 60 SECOND) AS too_soon
                         FROM medicine_orders WHERE id=?", "i", [(int)post('id')]);
        if (!$order) fail("Order not found", 404);
        if ($order['delivery_type'] === 'Pickup' || $order['status'] !== 'Out for Delivery') fail("An OTP can only be sent while a home delivery is out for delivery.", 409);
        if ($order['too_soon']) fail("An OTP was sent less than a minute ago. Please wait a moment.", 429);
        $newOtp = issue_delivery_otp($order['id']);
        reply_now(json_encode(["status" => "success"]));
        notify_order_status($order['id'], 'otp', '', $newOtp);
        exit;

    case 'cancelOrder':
        $order = db_one("SELECT id, delivery_type FROM medicine_orders WHERE id=?", "i", [(int)post('id')]);
        if (!$order) fail("Order not found", 404);
        // any step except the last one; the medicines go back into stock
        $open = array_slice(order_flow($order['delivery_type']), 0, -1);
        if (!cancel_order($order['id'], post('reason') ?: 'Cancelled by the pharmacy', $open, 'pharmacy')) fail("This order is already finished or cancelled.", 409);
        reply_now(json_encode(["status" => "success"]));
        notify_order_status($order['id']);
        exit;

    case 'verifyPayment':
        // The admin has seen the money (with this UTR) in the hospital's UPI / bank statement
        $stmt = db_run("UPDATE medicine_orders SET payment_status='Paid', paid_at=NOW() WHERE id=? AND status<>'Cancelled' AND payment_status='Submitted'",
            "i", [(int)post('id')]);
        if (mysqli_stmt_affected_rows($stmt) !== 1) fail("This payment was already handled. The list has been refreshed.", 409);
        reply_now(json_encode(["status" => "success"]));
        notify_order_status((int)post('id'), 'verified');
        exit;

    case 'rejectPayment':
        // No such payment arrived: the patient is asked for the right UTR and gets a fresh time limit to pay
        $order = db_one("SELECT id, payment_ref FROM medicine_orders WHERE id=? AND status='Placed' AND payment_status='Submitted'", "i", [(int)post('id')]);
        if (!$order) fail("This payment was already handled. The list has been refreshed.", 409);
        $stmt = db_run("UPDATE medicine_orders SET payment_status='Pending', payment_ref=NULL WHERE id=? AND payment_status='Submitted'", "i", [$order['id']]);
        if (mysqli_stmt_affected_rows($stmt) !== 1) fail("This payment was already handled. The list has been refreshed.", 409);
        reply_now(json_encode(["status" => "success"]));
        notify_order_status($order['id'], 'rejected', $order['payment_ref']);
        exit;

    case 'markRefunded':
        // The admin has sent the money back from the hospital's UPI app
        $stmt = db_run("UPDATE medicine_orders SET payment_status='Refunded' WHERE id=? AND payment_status='Refund Due'", "i", [(int)post('id')]);
        if (mysqli_stmt_affected_rows($stmt) !== 1) fail("This refund was already handled. The list has been refreshed.", 409);
        reply_now(json_encode(["status" => "success"]));
        notify_order_status((int)post('id'), 'refunded');
        exit;

    // ------------------------------------------------------------ notifications
    case 'notifications':
        json_out(["status" => "success",
            "email_configured" => MAIL_GMAIL_ADDRESS !== '' && MAIL_GMAIL_APP_PASSWORD !== '',
            "notifications" => db_all("SELECT * FROM notifications ORDER BY id DESC LIMIT 100")]);

    case 'retryEmails':
        // Mails that could not go out (internet / DNS was down) are sent again. The admin panel calls
        // this every minute; the session is released first so the panel does not freeze meanwhile.
        session_write_close();
        expire_unpaid_orders();
        $sent = retry_failed_emails(10);
        $left = db_one("SELECT COUNT(*) AS c FROM notifications WHERE channel='email' AND status='failed' AND subject IS NOT NULL
                        AND attempts < 6 AND created_at > NOW() - INTERVAL 24 HOUR");
        json_out(["status" => "success", "sent" => $sent, "waiting" => (int)$left['c']]);

    case 'sendReminders':
        json_out(["status" => "success", "processed" => send_due_reminders()]);
}

fail("Unknown action", 404);
?>
