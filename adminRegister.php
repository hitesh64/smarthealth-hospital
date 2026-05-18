<?php
include "config.php";

$name = mysqli_real_escape_string($conn, $_POST['name']);
$email = mysqli_real_escape_string($conn, $_POST['email']);
$password = password_hash($_POST['password'], PASSWORD_BCRYPT);

$check = mysqli_query($conn, "SELECT * FROM admins WHERE email='$email'");

if(mysqli_num_rows($check) > 0) {
    echo "Admin email already registered!";
} else {
    $sql = "INSERT INTO admins (name, email, password) VALUES ('$name', '$email', '$password')";
    if(mysqli_query($conn, $sql)) {
        echo "success";
    } else {
        echo "Error: " . mysqli_error($conn);
    }
}
?>