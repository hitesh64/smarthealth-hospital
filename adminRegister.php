<?php
include "lib.php";

// A new administrator can only be created by an administrator who is signed in.
// The single exception is a brand-new installation with no administrator at all.
$first = (int)db_one("SELECT COUNT(*) AS c FROM admins")['c'] === 0;
if (!$first && !is_admin()) {
    http_response_code(401);
    echo "Error: Only a signed-in administrator can create administrator accounts.";
    exit;
}

$name = post('name');
$email = post('email');
$password = $_POST['password'] ?? '';

if (strlen($name) < 3 || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8) {
    echo "Error: Enter a name, a valid email and a password of at least 8 characters.";
    exit;
}

if (db_one("SELECT id FROM admins WHERE email=?", "s", [$email])) {
    echo "Admin email already registered!";
    exit;
}

db_run("INSERT INTO admins (name, email, password) VALUES (?,?,?)", "sss", [$name, $email, password_hash($password, PASSWORD_BCRYPT)]);
echo "success";
?>
