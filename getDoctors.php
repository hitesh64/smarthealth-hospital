<?php
include "lib.php";

// Public list (patient site par booking ke liye). Password hash kabhi nahi jaata;
// doctor ka login email sirf admin ko dikhta hai.
$columns = "id, doctor_name, specialization, experience, days, image" . (is_admin() ? ", email" : "");

header('Content-Type: application/json');
echo json_encode(db_all("SELECT $columns FROM doctors"));
?>
