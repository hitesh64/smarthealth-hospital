<?php
include "lib.php";

$name = post('name');
$email = post('email');
// Google users ke liye ek secure encrypted dummy password set kar rahe hain
$dummy_pass = password_hash(new_token(), PASSWORD_BCRYPT);

// Google ID token ko Google se verify karte hain. Sirf verified login ko hi
// server session milta hai (health card / prescriptions isi session se khulte hain).
$verified = false;
$credential = post('credential');
if ($credential !== '') {
    $info = json_decode((string)@file_get_contents("https://oauth2.googleapis.com/tokeninfo?id_token=" . urlencode($credential)), true);
    if (is_array($info) && ($info['aud'] ?? '') === GOOGLE_CLIENT_ID
        && ($info['email_verified'] ?? '') === 'true' && !empty($info['email'])) {
        $verified = true;
        $email = $info['email'];
        if (!empty($info['name'])) $name = $info['name'];
    }
}
if ($email === '') fail("Email is required");

// Check karein ki user pehle se database mein hai ya nahi
$row = db_one("SELECT * FROM users WHERE email=?", "s", [$email]);

if (!$row) {
    db_run("INSERT INTO users (name, email, password, password_set) VALUES (?,?,?,0)", "sss", [$name, $email, $dummy_pass]);
    $row = db_one("SELECT * FROM users WHERE email=?", "s", [$email]);
}

if ($verified) {
    session_regenerate_id(true);
    $_SESSION['user_email'] = $row['email'];
}

reply_now(json_encode([
    "status" => "success",
    "name" => $row['name'],
    "email" => $row['email'],
    "phone" => $row['phone'],
    "age" => $row['age'],
    "blood" => $row['blood'],
    "address" => $row['address'],
    // popup asks Google users to choose their own password until they have done so
    "needs_password" => $verified && (int)$row['password_set'] === 0
]));

// Login mail sirf Google-verified login par, warna koi bhi kisi ke email par mail bhijwa sakta hai
if ($verified) send_login_email($row['name'], $row['email']);
?>
