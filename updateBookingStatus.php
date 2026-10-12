<?php
include "lib.php";

$id = (int)($_GET['id'] ?? 0);
$status = trim($_GET['status'] ?? '');
$allowed = ['Pending', 'Accepted', 'Confirmed', 'Completed', 'Rejected', 'Cancelled'];

if (!$id || !in_array($status, $allowed, true)) {
    echo "Error";
    exit;
}

$before = db_one("SELECT status, user_id FROM bookings WHERE id=?", "i", [$id]);
if (!$before) {
    echo "Error";
    exit;
}

// Admin koi bhi status set kar sakta hai. Patient sirf apni booking cancel kar sakta hai,
// aur wo bhi tab tak jab tak visit ho nahi chuki / pehle se band nahi hai.
if (!is_admin()) {
    $me = strtolower(trim($_SESSION['user_email'] ?? ''));
    $own = $me !== '' && strtolower(trim((string)$before['user_id'])) === $me;
    $open = in_array($before['status'] ?: 'Pending', ['Pending', 'Accepted'], true);
    if (!$own || $status !== 'Cancelled' || !$open) {
        http_response_code($me === '' ? 401 : 403);
        echo $me === '' ? "Error: Please log in again." : "Error: You cannot change this booking.";
        exit;
    }
}
db_run("UPDATE bookings SET status=? WHERE id=?", "si", [$status, $id]);

// Admin ko turant jawab, patient ka email uske baad jaata hai
reply_now("Status Updated to " . $status, "text/plain");

// Same status dobara set ho to dobara mail nahi
if ($before['status'] === $status) exit;

// Status change ka email: accept / reject par patient ko, cancel par patient + doctor ko
notify_booking_status($id, $status);
?>
