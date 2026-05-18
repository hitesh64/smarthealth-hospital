<?php
include "config.php";

$email = mysqli_real_escape_string($conn, $_POST['email']);
$password = $_POST['password'];

$sql = "SELECT * FROM admins WHERE email='$email'";
$result = mysqli_query($conn, $sql);

if(mysqli_num_rows($result) > 0) {
    $row = mysqli_fetch_assoc($result);
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
    echo "Admin not found!";
}
?>