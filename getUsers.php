<?php
include "lib.php";

// Patient directory sirf admin ke liye
require_admin();

// Password hash, QR token aur medical details yahan se bahar nahi jaate
header('Content-Type: application/json');
echo json_encode(db_all("SELECT id, name, email, phone, age, blood FROM users"));
?>
