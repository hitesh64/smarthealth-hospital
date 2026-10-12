<?php
// Shared helpers for the feature APIs: session, JSON output, auth guards, notifications.
include_once __DIR__ . "/config.php";
// settings.php is the local file with the real passwords (not in git); a hosted copy reads the same settings from environment variables
include_once __DIR__ . (is_file(__DIR__ . "/settings.php") ? "/settings.php" : "/settings.env.php");

// XAMPP defaults to Europe/Berlin; dates in mails and "today" checks must be Indian time
date_default_timezone_set('Asia/Kolkata');

if (session_status() === PHP_SESSION_NONE && PHP_SAPI !== 'cli') {
    // behind a hosting proxy (Render) the original request is HTTPS: the cookie is then sent over HTTPS only
    $https = ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' || !empty($_SERVER['HTTPS']);
    session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => $https]);
    session_start();
}

function json_out($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

// Sends the reply to the browser right now and lets the script keep running, so slow
// work afterwards (sending email takes several seconds) does not make the user wait.
function reply_now($body, $contentType = 'application/json') {
    ignore_user_abort(true);
    set_time_limit(60);
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    while (ob_get_level() > 0) ob_end_clean();
    header('Content-Type: ' . $contentType);
    header('Content-Encoding: none');
    header('Content-Length: ' . strlen($body));
    header('Connection: close');
    echo $body;
    flush();
}

function fail($message, $code = 400) {
    json_out(["status" => "error", "message" => $message], $code);
}

function post($key, $default = '') {
    return isset($_POST[$key]) ? trim((string)$_POST[$key]) : $default;
}

function require_admin() {
    if (empty($_SESSION['admin_email'])) fail("Admin login required", 401);
    return $_SESSION['admin_email'];
}

// Same guard for the older endpoints that answer in plain text instead of JSON
function require_admin_text() {
    if (!empty($_SESSION['admin_email'])) return $_SESSION['admin_email'];
    http_response_code(401);
    header('Content-Type: text/plain');
    echo "Error: Admin login required. Please sign in again.";
    exit;
}

function is_admin() {
    return !empty($_SESSION['admin_email']);
}

// Saves an uploaded doctor photo into uploads/ under a generated name and returns its path.
// Returns '' when no file was sent and null when the file is not a real image (a renamed script, too large...).
// The type is read from the image itself, never from the name the browser sent.
function save_doctor_image() {
    if (empty($_FILES['image']) || $_FILES['image']['error'] === UPLOAD_ERR_NO_FILE) return '';
    $file = $_FILES['image'];
    if ($file['error'] !== UPLOAD_ERR_OK || $file['size'] > 5 * 1024 * 1024) return null;
    $info = @getimagesize($file['tmp_name']);
    $ext = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'][$info[2] ?? 0] ?? null;
    if ($ext === null) return null;
    if (!is_dir(__DIR__ . "/uploads")) mkdir(__DIR__ . "/uploads", 0775, true);
    $path = "uploads/" . time() . "_" . new_token() . "." . $ext;
    return move_uploaded_file($file['tmp_name'], __DIR__ . "/" . $path) ? $path : null;
}

function require_doctor() {
    if (empty($_SESSION['doctor_id'])) fail("Doctor login required", 401);
    return (int)$_SESSION['doctor_id'];
}

function require_user() {
    if (empty($_SESSION['user_email'])) fail("Please log in again", 401);
    return $_SESSION['user_email'];
}

// Prepared-statement shortcut: db_all("... WHERE id=?", "i", [$id])
function db_run($sql, $types = '', $params = []) {
    global $conn;
    $stmt = mysqli_prepare($conn, $sql);
    if (!$stmt) fail("Database error: " . mysqli_error($conn), 500);
    if ($types !== '') mysqli_stmt_bind_param($stmt, $types, ...$params);
    if (!mysqli_stmt_execute($stmt)) fail("Database error: " . mysqli_stmt_error($stmt), 500);
    return $stmt;
}

function db_all($sql, $types = '', $params = []) {
    $res = mysqli_stmt_get_result(db_run($sql, $types, $params));
    return $res ? mysqli_fetch_all($res, MYSQLI_ASSOC) : [];
}

function db_one($sql, $types = '', $params = []) {
    $rows = db_all($sql, $types, $params);
    return $rows ? $rows[0] : null;
}

function new_token() {
    return bin2hex(random_bytes(16));
}

function distance_km($lat1, $lng1, $lat2, $lng2) {
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
    return 6371 * 2 * atan2(sqrt($a), sqrt(1 - $a));
}

// ---------------------------------------------------------------- notifications

function log_notification($channel, $recipient, $message, $status, $detail = '', $subject = null, $attempts = 1) {
    db_run("INSERT INTO notifications (channel, recipient, subject, message, status, detail, attempts) VALUES (?,?,?,?,?,?,?)",
        "ssssssi", [$channel, $recipient, $subject, $message, $status, substr($detail, 0, 255), $attempts]);
}

// Opens the TLS connection to Gmail. On a weak connection the name lookup for smtp.gmail.com often
// fails while the internet itself still works ("No such host is known"), so the address that worked
// last time is remembered and used directly when the lookup fails.
function smtp_connect(&$errstr) {
    $cache = sys_get_temp_dir() . "/smarthealth_smtp_ip.txt";
    $fp = @stream_socket_client("ssl://smtp.gmail.com:465", $errno, $errstr, 10);
    if ($fp) {
        $ip = gethostbyname("smtp.gmail.com");
        if (filter_var($ip, FILTER_VALIDATE_IP)) @file_put_contents($cache, $ip);
        return $fp;
    }
    $ip = trim((string)@file_get_contents($cache));
    if (!filter_var($ip, FILTER_VALIDATE_IP)) return false;
    // the certificate is still checked against the real host name
    $tls = stream_context_create(['ssl' => ['peer_name' => 'smtp.gmail.com', 'SNI_enabled' => true]]);
    return @stream_socket_client("ssl://$ip:465", $errno, $errstr, 10, STREAM_CLIENT_CONNECT, $tls);
}

// Minimal Gmail SMTP client (SSL on 465, AUTH LOGIN) so no library is needed.
// One delivery attempt. Returns '' on success, otherwise the error text.
function smtp_send($to, $subject, $message) {
    $fp = smtp_connect($errstr);
    if (!$fp) return "Connect failed: $errstr";

    stream_set_timeout($fp, 10);
    $read = function () use ($fp) {
        $data = '';
        while (($line = fgets($fp, 515)) !== false) {
            $data .= $line;
            if (isset($line[3]) && $line[3] === ' ') break;
        }
        return $data;
    };
    $subject = str_replace(["\r", "\n"], ' ', $subject);
    $body = str_replace("\n.", "\n..", str_replace(["\r\n", "\r"], "\n", $message));
    $steps = [
        [null, '220'],
        ["EHLO localhost", '250'],
        ["AUTH LOGIN", '334'],
        [base64_encode(MAIL_GMAIL_ADDRESS), '334'],
        [base64_encode(str_replace(' ', '', MAIL_GMAIL_APP_PASSWORD)), '235'],
        ["MAIL FROM:<" . MAIL_GMAIL_ADDRESS . ">", '250'],
        ["RCPT TO:<$to>", '250'],
        ["DATA", '354'],
        ["From: " . MAIL_FROM_NAME . " <" . MAIL_GMAIL_ADDRESS . ">\r\nTo: <$to>\r\nSubject: $subject\r\n"
            . "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
            . str_replace("\n", "\r\n", $body) . "\r\n.", '250'],
    ];
    $error = '';
    foreach ($steps as [$cmd, $expect]) {
        if ($cmd !== null) fwrite($fp, $cmd . "\r\n");
        $reply = $read();
        if (strpos($reply, $expect) !== 0) {
            $error = "SMTP error: " . (trim($reply) ?: 'no reply from mail server');
            break;
        }
    }
    @fwrite($fp, "QUIT\r\n");
    fclose($fp);
    return $error;
}

// A brief internet / DNS drop must not lose a mail: try up to 3 times now, and if it still
// fails the mail stays in the notifications table as "failed" and retry_failed_emails()
// sends it later.
// $secret (e.g. a delivery OTP) is hidden in the notification log, which the admin can read, and a
// mail carrying it is never re-sent by retry_failed_emails (the admin issues a fresh OTP instead).
function send_email($to, $subject, $message, $secret = '') {
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) return false;
    $logged = $secret === '' ? $message : str_replace($secret, '******', $message);

    if (MAIL_GMAIL_ADDRESS === '' || MAIL_GMAIL_APP_PASSWORD === '') {
        log_notification('email', $to, $logged, 'logged', 'Gmail SMTP not configured in settings.php', $secret === '' ? $subject : null);
        return false;
    }
    $error = '';
    for ($attempt = 1; $attempt <= 3; $attempt++) {
        $error = smtp_send($to, $subject, $message);
        // wrong password / rejected address will not fix itself, so only network errors are retried
        if ($error === '' || strpos($error, 'Connect failed') !== 0) break;
        if ($attempt < 3) sleep(3);
    }
    log_notification('email', $to, $logged, $error === '' ? 'sent' : 'failed', $error, ($secret !== '' && $error !== '') ? null : $subject, min($attempt, 3));

    // The connection works right now, so also deliver anything that failed earlier
    if ($error === '') retry_failed_emails(5);
    return $error === '';
}

// Re-sends mails that failed in the last 24 hours (max 6 attempts each). Returns how many went out.
function retry_failed_emails($limit = 10) {
    static $running = false;
    if ($running || MAIL_GMAIL_ADDRESS === '' || MAIL_GMAIL_APP_PASSWORD === '') return 0;
    // only one request retries at a time, otherwise the same mail could go out twice
    // (the lock frees itself if this request dies half way)
    $lock = db_one("SELECT GET_LOCK('smarthealth_mail_retry', 0) AS ok");
    if (!$lock || !$lock['ok']) return 0;
    $running = true;

    $sent = 0;
    $failed = db_all("SELECT * FROM notifications
                      WHERE channel='email' AND status='failed' AND subject IS NOT NULL AND attempts < 6
                        AND created_at > NOW() - INTERVAL 24 HOUR
                      ORDER BY id LIMIT " . (int)$limit);
    foreach ($failed as $n) {
        $error = smtp_send($n['recipient'], $n['subject'], $n['message']);
        // still offline: stop for now, and do not count it as an attempt so the mail is not given up on
        if (strpos($error, 'Connect failed') === 0) break;
        db_run("UPDATE notifications SET status=?, detail=?, attempts=attempts+1 WHERE id=?",
            "ssi", [$error === '' ? 'sent' : 'failed', substr($error === '' ? 'Delivered on retry' : $error, 0, 255), $n['id']]);
        if ($error === '') $sent++;
    }
    db_one("SELECT RELEASE_LOCK('smarthealth_mail_retry')");
    $running = false;
    return $sent;
}

// Emails for an appointment status change, whoever made it (admin, doctor or the patient).
//   Accepted / Rejected -> patient
//   Cancelled           -> patient (confirmation) + doctor (so the slot is known to be free)
function notify_booking_status($bookingId, $status) {
    $b = db_one("SELECT b.*, d.doctor_name, d.email AS doctor_email
                 FROM bookings b LEFT JOIN doctors d ON d.id=b.doctor_id WHERE b.id=?", "i", [$bookingId]);
    if (!$b) return;
    $doctor = $b['doctor_name'] ?: 'the doctor';
    $when = "{$b['appointment_date']} at {$b['time_slot']} (Token {$b['token_no']})";
    $hello = "Hi {$b['patient_name']},\n\n";
    $bye = "\n\n- " . HOSPITAL_NAME;

    if ($status === 'Accepted') {
        notify_patient($b['user_id'], "Appointment accepted - Token {$b['token_no']}",
            $hello . "Good news! Your appointment with $doctor on $when has been ACCEPTED.\n\nPlease arrive 10 minutes early and carry your Smart Patient QR Card." . $bye);
    } elseif ($status === 'Rejected') {
        notify_patient($b['user_id'], "Appointment not accepted",
            $hello . "We are sorry. Your appointment with $doctor on $when has been REJECTED and will not take place.\n\n"
            . "You can book another date or another doctor from the SmartHealth site. For help call " . HOSPITAL_PHONE . "." . $bye);
    } elseif ($status === 'Cancelled') {
        notify_patient($b['user_id'], "Appointment cancelled",
            $hello . "Your appointment with $doctor on $when has been CANCELLED.\n\n"
            . "If you did not cancel it, please contact us at " . HOSPITAL_PHONE . ". You can book a new appointment any time." . $bye);
        if (!empty($b['doctor_email'])) {
            send_email($b['doctor_email'], "Appointment cancelled - {$b['patient_name']}, {$b['appointment_date']}",
                "Hello $doctor,\n\nThis appointment has been cancelled:\n\n"
                . "Patient: {$b['patient_name']}\nPhone: {$b['patient_phone']}\nEmail: {$b['user_id']}\n"
                . "Date: {$b['appointment_date']}\nTime: {$b['time_slot']}\nToken No: {$b['token_no']}" . $bye);
        }
    }
}

// Login alert mail, sent each time a patient signs in.
function send_login_email($name, $email) {
    $when = date('d M Y, h:i A');
    return send_email($email, "SmartHealth login alert",
        "Hi $name,\n\nYou have successfully logged in to your SmartHealth account on $when.\n\n"
        . "You can now book appointments, view your Health Card and prescriptions.\n\n"
        . "If this was not you, please change your password immediately or contact " . HOSPITAL_NAME . " at " . HOSPITAL_PHONE . ".\n\n"
        . "- " . HOSPITAL_NAME);
}

// Patient notifications go by email (to the address the patient logged in with).
function notify_patient($email, $subject, $message, $secret = '') {
    if ($email) send_email($email, $subject, $message, $secret);
}

// ---------------------------------------------------------------- medicine orders

// UPI settings live in settings.php; these keep an older settings.php (without them) working.
if (!defined('UPI_ID')) define('UPI_ID', '');
if (!defined('UPI_PAYEE_NAME')) define('UPI_PAYEE_NAME', HOSPITAL_NAME);
if (!defined('UPI_PAY_MINUTES')) define('UPI_PAY_MINUTES', 30);

function upi_enabled() {
    return (bool)preg_match('/^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9]{2,}$/', UPI_ID);
}

// The link every UPI app understands (it is also what the QR code holds). The amount and the
// order number are fixed in it, so the patient cannot pay the wrong amount by mistake.
function upi_link($order) {
    return "upi://pay?" . http_build_query([
        'pa' => UPI_ID, 'pn' => UPI_PAYEE_NAME, 'am' => number_format($order['total'], 2, '.', ''),
        'cu' => 'INR', 'tn' => "Order {$order['order_no']}", 'tr' => $order['order_no'],
    ], '', '&', PHP_QUERY_RFC3986);
}

// The steps an order moves through, in order. The last one means the patient has the medicines.
function order_flow($deliveryType) {
    return $deliveryType === 'Pickup'
        ? ['Placed', 'Confirmed', 'Packed', 'Ready for Pickup', 'Collected']
        : ['Placed', 'Confirmed', 'Packed', 'Out for Delivery', 'Delivered'];
}

function order_with_items($orderId) {
    $order = db_one("SELECT * FROM medicine_orders WHERE id=?", "i", [$orderId]);
    if ($order) $order['items'] = db_all("SELECT medicine_id, name, unit, price, qty, line_total FROM medicine_order_items WHERE order_id=? ORDER BY id", "i", [$orderId]);
    return $order;
}

// Cancels an order and puts its medicines back in stock. $fromStatuses limits when it is allowed
// (a patient may only cancel early; the admin any time before the order is finished).
// $by is 'patient', 'pharmacy' or 'system' and decides the wording of the cancellation mail.
// $onlyUnpaid: cancel only while the UPI payment has not been made (used when the time to pay runs out).
// Money already paid by UPI becomes "Refund Due".
// Returns false when the order had already moved on, so stock is never returned twice.
function cancel_order($orderId, $reason, $fromStatuses, $by, $onlyUnpaid = false) {
    global $conn;
    mysqli_begin_transaction($conn);
    $marks = implode(',', array_fill(0, count($fromStatuses), '?'));
    $stmt = db_run("UPDATE medicine_orders SET status='Cancelled', cancel_reason=?, cancelled_by=?,
                        payment_status = CASE WHEN payment_status IN ('Submitted','Paid') THEN 'Refund Due'
                                              WHEN payment_status='Pending' THEN 'Not Paid' ELSE payment_status END
                    WHERE id=? AND status IN ($marks)" . ($onlyUnpaid ? " AND payment_status='Pending'" : ""),
        "ssi" . str_repeat('s', count($fromStatuses)), [substr($reason, 0, 255), $by, $orderId, ...$fromStatuses]);
    if (mysqli_stmt_affected_rows($stmt) !== 1) {
        mysqli_rollback($conn);
        return false;
    }
    foreach (db_all("SELECT medicine_id, qty FROM medicine_order_items WHERE order_id=?", "i", [$orderId]) as $item) {
        db_run("UPDATE medicines SET stock=stock+? WHERE id=?", "ii", [$item['qty'], $item['medicine_id']]);
    }
    mysqli_commit($conn);
    return true;
}

// A UPI order holds its medicines while it waits for payment. If the patient does not pay in
// UPI_PAY_MINUTES the order is cancelled, the stock is released and the patient is told by mail.
// The clock restarts when the pharmacy asks for the payment reference again. Returns how many were cancelled.
function expire_unpaid_orders() {
    $late = db_all("SELECT id FROM medicine_orders WHERE status='Placed' AND payment_method='UPI' AND payment_status='Pending'
                    AND updated_at < NOW() - INTERVAL " . (int)UPI_PAY_MINUTES . " MINUTE");
    $done = 0;
    foreach ($late as $o) {
        if (cancel_order($o['id'], "Payment was not completed within " . UPI_PAY_MINUTES . " minutes", ['Placed'], 'system', true)) {
            notify_order_status($o['id']);
            $done++;
        }
    }
    return $done;
}

// Subject and text of the mail for the order's current status, as [to, subject, body]; null when there is nothing to send.
// $event sends a payment mail instead: 'submitted', 'verified', 'rejected' (with the reference that was not found) or 'refunded'.
function order_email($orderId, $event = '', $ref = '', $otp = '') {
    $o = order_with_items($orderId);
    if (!$o) return null;
    $pickup = $o['delivery_type'] === 'Pickup';
    $upi = $o['payment_method'] === 'UPI';
    $paid = $o['payment_status'] === 'Paid';
    $lines = '';
    foreach ($o['items'] as $i) $lines .= "  {$i['name']} x {$i['qty']} {$i['unit']} = Rs. {$i['line_total']}\n";
    $payment = !$upi ? $o['payment_method']
        : "UPI - " . (['Pending' => 'NOT PAID YET', 'Submitted' => "paid, being verified (UTR {$o['payment_ref']})",
                      'Paid' => "PAID (UTR {$o['payment_ref']})"][$o['payment_status']] ?? $o['payment_status']);
    $bill = $lines . "\nSubtotal: Rs. {$o['subtotal']}\n" . ($pickup ? "Pickup" : "Delivery") . ": " . ($o['delivery_fee'] > 0 ? "Rs. {$o['delivery_fee']}" : "Free")
        . "\n" . ($paid ? "TOTAL" : "TOTAL TO PAY") . ": Rs. {$o['total']}\nPayment: $payment";
    $where = $pickup ? "Pickup at the " . HOSPITAL_NAME . " pharmacy counter" : "Delivery to: {$o['address']}, {$o['city']} - {$o['pincode']}";
    $placedOn = date('d M Y, h:i A', strtotime($o['created_at']));
    $details = "ORDER DETAILS\n-------------\nOrder number: {$o['order_no']}\nPlaced on: $placedOn\n\nMEDICINES\n---------\n$bill\n\n"
        . ($pickup ? "PICKUP" : "DELIVERY") . "\n--------\n$where\nName: {$o['customer_name']}\nMobile: {$o['phone']}"
        . ($o['notes'] !== '' && $o['notes'] !== null ? "\nYour note: {$o['notes']}" : '');
    $hello = "Hi {$o['customer_name']},\n\n";
    $bye = "\n\n- " . HOSPITAL_NAME;
    $payNow = "Open Medicine Store > My Orders and press \"Pay now\" on order {$o['order_no']}";

    $otpBox = $otp === '' ? '' : "\n\nDELIVERY OTP: $otp\n"
        . "Give this OTP to the delivery person ONLY when the medicines are in your hand. The order is marked delivered only after the OTP is entered. "
        . "Never share it before that - not even on a phone call. It is valid for " . DELIVERY_OTP_HOURS . " hours.";

    if ($event !== '') {
        $mail = [
            'otp' => ["New delivery OTP - {$o['order_no']}",
                "Here is a NEW delivery OTP for your order {$o['order_no']}. The earlier OTP no longer works.$otpBox"],
            'submitted' => ["Payment reference received - {$o['order_no']}",
                "Thank you. We have received your UPI payment reference for order {$o['order_no']}.\n\nAmount: Rs. {$o['total']}\nUTR / reference: {$o['payment_ref']}\n\n"
                . "The pharmacy will now check the payment and confirm your order. You will get an email as soon as it is verified."],
            'verified' => ["Payment received - {$o['order_no']}",
                "We have RECEIVED your UPI payment for order {$o['order_no']}.\n\nAmount paid: Rs. {$o['total']}\nUTR / reference: {$o['payment_ref']}\n\n"
                . "Your order is now being prepared. " . ($pickup ? "We will email you when it is ready for pickup." : "Nothing more has to be paid on delivery.")],
            'rejected' => ["Payment not found - {$o['order_no']}",
                "We could NOT find a UPI payment of Rs. {$o['total']} with the reference you entered ($ref) for order {$o['order_no']}.\n\n"
                . "If you have paid, please check the 12-digit UTR in your UPI app (under transaction details) and enter it again:\n$payNow.\n\n"
                . "If you have not paid yet, you can pay from the same place. Please do it within " . UPI_PAY_MINUTES . " minutes, otherwise the order is cancelled automatically.\n"
                . "For help call " . HOSPITAL_PHONE . "."],
            'refunded' => ["Refund sent - {$o['order_no']}",
                "The refund of Rs. {$o['total']} for your cancelled order {$o['order_no']} has been sent back to the account you paid from"
                . ($o['payment_ref'] ? " (payment UTR {$o['payment_ref']})" : "") . ".\n\nIt can take up to 3-5 working days to show in your bank account. For help call " . HOSPITAL_PHONE . "."],
        ][$event] ?? null;
        return $mail ? [$o['user_email'], $mail[0], $hello . $mail[1] . $bye] : null;
    }

    $collect = $paid ? "It is already paid online - nothing more to pay." : "Please keep Rs. {$o['total']} ready.";
    $refund = $o['payment_status'] === 'Refund Due'
        ? "Your UPI payment of Rs. {$o['total']}" . ($o['payment_ref'] ? " (UTR {$o['payment_ref']})" : "") . " will be REFUNDED to the account you paid from. We will email you when the refund is sent."
        : "You do not have to pay anything for this order" . ($pickup ? "" : " and nothing will be delivered") . ".";
    $text = [
        'Placed' => "Thank you! We have received your medicine order.\n\n$details\n\n"
            . ($upi && !$paid
                ? "PAYMENT PENDING\n---------------\nYour order is reserved for " . UPI_PAY_MINUTES . " minutes. To pay Rs. {$o['total']} by UPI:\n$payNow, scan the QR code with any UPI app "
                  . "(Google Pay, PhonePe, Paytm, BHIM) and then enter the 12-digit UTR shown in your UPI app.\nIf it is not paid in time the order is cancelled automatically.\n\n"
                : "")
            . "WHAT HAPPENS NEXT\n-----------------\n" . ($upi ? "1. The pharmacy verifies your payment and confirms your order." : "1. The pharmacy confirms your order.") . "\n2. Your medicines are packed.\n"
            . ($pickup ? "3. We email you when the order is ready - collect it at the pharmacy counter" . ($upi ? "." : " and pay Rs. {$o['total']} in cash.")
                       : "3. The order is sent out for delivery" . ($upi ? "." : " - pay Rs. {$o['total']} in cash when it arrives."))
            . "\n\nYou will get an email at every step. You can track the order, or cancel it before it is packed, under Medicine Store > My Orders."
            . "\nFor help call " . HOSPITAL_PHONE . ".",
        'Confirmed' => "Your medicine order {$o['order_no']} has been CONFIRMED by the pharmacy and is being prepared.",
        'Packed' => "Your medicine order {$o['order_no']} has been PACKED.",
        'Out for Delivery' => "Your medicine order {$o['order_no']} is OUT FOR DELIVERY.\n\n$where\n\n$collect$otpBox",
        'Ready for Pickup' => "Your medicine order {$o['order_no']} is READY FOR PICKUP at the " . HOSPITAL_NAME . " pharmacy counter.\n\nPlease bring this order number. $collect",
        'Delivered' => "Your medicine order {$o['order_no']} has been DELIVERED. Thank you!",
        'Collected' => "Your medicine order {$o['order_no']} has been COLLECTED. Thank you!",
        'Cancelled' => ($o['cancelled_by'] === 'patient'
                ? "As you asked, your medicine order {$o['order_no']} has been CANCELLED."
                : ($o['cancelled_by'] === 'system'
                    ? "Your medicine order {$o['order_no']} has been CANCELLED because the UPI payment was not completed in time."
                    : "We are sorry - your medicine order {$o['order_no']} has been CANCELLED by the " . HOSPITAL_NAME . " pharmacy.\n\nReason: {$o['cancel_reason']}"))
            . "\n\n$refund\n\n"
            . "CANCELLED ORDER\n---------------\nOrder number: {$o['order_no']}\nPlaced on: $placedOn\nCancelled on: " . date('d M Y, h:i A', strtotime($o['updated_at']))
            . "\n\n{$lines}\nOrder total was: Rs. {$o['total']}\n\n"
            . ($o['cancelled_by'] === 'patient'
                ? "If you did not cancel this order yourself, please contact us at " . HOSPITAL_PHONE . "."
                : ($o['cancelled_by'] === 'system' && $o['payment_status'] === 'Not Paid'
                    ? "If money was taken from your account for this order, call " . HOSPITAL_PHONE . " with the UTR and we will sort it out. You can place a new order any time under Medicine Store."
                    : "You can place a new order any time under Medicine Store. For help call " . HOSPITAL_PHONE . ".")),
    ][$o['status']] ?? null;
    if ($text === null) return null;

    return [$o['user_email'], "Medicine order {$o['order_no']} - {$o['status']}", $hello . $text . $bye];
}

// Email to the patient (the account the order was placed from) for the order's current status,
// or for a payment event (see order_email).
function notify_order_status($orderId, $event = '', $ref = '', $otp = '') {
    $mail = order_email($orderId, $event, $ref, $otp);
    if ($mail) notify_patient($mail[0], $mail[1], $mail[2], $otp);
}

// ---------------------------------------------------------------- delivery OTP
// A home delivery can only be completed with a 6-digit OTP that is emailed to the patient when the
// order goes out. The patient tells it to the delivery person, who gives it to the admin. Only a
// hash is stored, 5 wrong tries lock it, and the admin can issue a fresh one.
if (!defined('DELIVERY_OTP_HOURS')) define('DELIVERY_OTP_HOURS', 24);
if (!defined('DELIVERY_OTP_MAX_TRIES')) define('DELIVERY_OTP_MAX_TRIES', 5);

// Makes a new OTP for the order (resetting the tries) and returns it in plain text for the email.
function issue_delivery_otp($orderId) {
    $otp = (string)random_int(100000, 999999);
    db_run("UPDATE medicine_orders SET delivery_otp_hash=?, otp_sent_at=NOW(), otp_attempts=0 WHERE id=?",
        "si", [password_hash($otp, PASSWORD_DEFAULT), $orderId]);
    return $otp;
}
?>
