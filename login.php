<?php
include "config.php";

$email = trim($_POST['email']);
$password = $_POST['password'];

// 1. Sirf email se user dhoondhein
$sql = "SELECT * FROM users WHERE email = '$email'";
$result = mysqli_query($conn, $sql);

if(mysqli_num_rows($result) > 0) {
    $row = mysqli_fetch_assoc($result);
    
    // 2. Hash password ko verify karein
    if(password_verify($password, $row['password'])) {
        echo json_encode([
            "status" => "success",
            "name" => $row['name'],
            "email" => $row['email']
        ]);
    } else {
        echo "Incorrect Password!";
    }
} else {
    echo "User not found";
}
?>