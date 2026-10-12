<?php
include "lib.php";

// Lets a Google-verified user choose a password once, so they can also log in with email + password.
$email = require_user();
$password = $_POST['password'] ?? '';

if (strlen($password) < 6) fail("Password must be at least 6 characters");

$row = db_one("SELECT password_set FROM users WHERE email=?", "s", [$email]);
if (!$row) fail("User not found", 404);
if ((int)$row['password_set'] === 1) fail("Password is already set", 409);

db_run("UPDATE users SET password=?, password_set=1 WHERE email=?", "ss",
    [password_hash($password, PASSWORD_BCRYPT), $email]);

json_out(["status" => "success"]);
