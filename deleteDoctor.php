<?php
include "lib.php";
require_admin_text();

$doctor_id = intval($_GET['id'] ?? 0);
if (!$doctor_id) {
    echo "No Doctor ID provided.";
    exit;
}

// STEP 1: Pehle is doctor ki jitni bhi appointments/bookings hain unhe delete karo (Foreign Key Fix)
db_run("DELETE FROM bookings WHERE doctor_id=?", "i", [$doctor_id]);

// STEP 2: Ab doctor ko doctors table se permanently remove karo
db_run("DELETE FROM doctors WHERE id=?", "i", [$doctor_id]);
echo "Doctor and associated bookings removed successfully!";
?>
