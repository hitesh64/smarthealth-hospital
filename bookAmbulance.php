<?php
include "lib.php";

// Logged-in patient ki booking uske apne account se judti hai, form mein bheje gaye email se nahi
$uid = $_SESSION['user_email'] ?? post('user');
$name = post('name');
$phone = post('phone');
$pickup = post('pickup');
$destination = post('destination');

if ($name === '' || $phone === '' || $pickup === '') {
    echo "Error: Name, phone and pickup address are required.";
    exit;
}

db_run("INSERT INTO ambulance (user_id, patient_name, phone, address, emergency_type, status) VALUES (?,?,?,?,?,'Pending')",
    "sssss", [$uid, substr($name, 0, 100), substr($phone, 0, 20), $pickup, substr($destination, 0, 100)]);
echo "Ambulance Booked Successfully";
?>
