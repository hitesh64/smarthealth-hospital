<?php
include "lib.php";

$email = post('email');
$password = $_POST['password'] ?? '';

$row = db_one("SELECT * FROM admins WHERE email=?", "s", [$email]);

if ($row) {
    if (password_verify($password, $row['password'])) {
        session_regenerate_id(true);
        $_SESSION['admin_email'] = $row['email'];
        echo json_encode([
            "status" => "success",
            "name" => $row['name'],
            "email" => $row['email']
        ]);
    } else {
        echo "Incorrect Password!";
    }
} else {
    echo "Admin not found!";
}
?>
