<?php
include "config.php";

$name = mysqli_real_escape_string($conn, $_POST['name']);
$email = mysqli_real_escape_string($conn, $_POST['email']);
// Google users ke liye ek secure encrypted dummy password set kar rahe hain
$dummy_pass = password_hash("google_sso_secured_token", PASSWORD_BCRYPT);

// Check karein ki user pehle se database mein hai ya nahi
$check = mysqli_query($conn, "SELECT * FROM users WHERE email='$email'");

if(mysqli_num_rows($check) == 0) {
    // Agar naya user hai, toh phpMyAdmin ke 'users' table mein insert karein
    $sql = "INSERT INTO users (name, email, password) VALUES ('$name', '$email', '$dummy_pass')";
    if(mysqli_query($conn, $sql)) {
        echo "New Google User Stored in Database Successfully";
    } else {
        echo "Error: " . mysqli_error($conn);
    }
} else {
    echo "User already exists in Database";
}
?>