<?php
include "lib.php";

$email = post('email');
$password = $_POST['password'] ?? '';

// 1. Sirf email se user dhoondhein
$row = db_one("SELECT * FROM users WHERE email = ?", "s", [$email]);

if ($row) {
    // 2. Hash password ko verify karein
    if (password_verify($password, $row['password'])) {
        session_regenerate_id(true);
        $_SESSION['user_email'] = $row['email'];
        // User ko turant login, mail uske baad background mein jaata hai
        reply_now(json_encode([
            "status" => "success",
            "name" => $row['name'],
            "email" => $row['email'],
            "phone" => $row['phone'],
            "age" => $row['age'],
            "blood" => $row['blood'],
            "address" => $row['address']
        ]));
        send_login_email($row['name'], $row['email']);
    } else {
        echo "Incorrect Password!";
    }
} else {
    echo "User not found";
}
?>
