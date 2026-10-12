<?php
include "lib.php";

// Admin ko saari bookings (doctor ke naam ke saath); logged-in patient ko sirf apni; baaki kisi ko kuch nahi
$sql = "SELECT b.*, d.doctor_name, d.specialization
        FROM bookings b LEFT JOIN doctors d ON d.id = b.doctor_id";

if (is_admin()) {
    $data = db_all("$sql ORDER BY b.id DESC");
} elseif (!empty($_SESSION['user_email'])) {
    $data = db_all("$sql WHERE LOWER(TRIM(b.user_id)) = LOWER(?) ORDER BY b.id DESC", "s", [trim($_SESSION['user_email'])]);
} else {
    $data = [];
}

header('Content-Type: application/json');
echo json_encode($data);
?>
