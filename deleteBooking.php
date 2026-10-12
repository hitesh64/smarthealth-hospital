<?php
include "lib.php";
require_admin_text();

$id = intval($_GET['id'] ?? 0);
if (!$id) {
    echo "Error: No booking ID provided.";
    exit;
}

db_run("DELETE FROM bookings WHERE id=?", "i", [$id]);
echo "Booking Deleted Successfully";
?>
