<?php
include "lib.php";

// Sirf logged-in patient apni hi profile badal sakta hai (email session se aata hai, form se nahi)
if (empty($_SESSION['user_email'])) {
    http_response_code(401);
    echo "Error: Please log in again.";
    exit;
}
$email = $_SESSION['user_email'];

$name = post('name');
$age = post('age');
if ($name === '') {
    echo "Error: Name is required";
    exit;
}

db_run("UPDATE users SET name=?, phone=?, age=?, blood=?, address=? WHERE email=?", "ssisss",
    [substr($name, 0, 100), substr(post('phone'), 0, 20), $age === '' ? null : max(0, min(130, (int)$age)),
     substr(post('blood'), 0, 10), post('address'), $email]);
echo "success";
?>
