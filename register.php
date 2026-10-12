<?php

include "lib.php";

$name = post('name');
$email = post('email');

if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || ($_POST['password'] ?? '') === '') {
    echo "Please enter your name, a valid email and a password";
    exit;
}

$password = password_hash($_POST['password'], PASSWORD_DEFAULT);

if (db_one("SELECT id FROM users WHERE email=?", "s", [$email])) {

    echo "User Already Exists";

} else {

    db_run("INSERT INTO users (name,email,password) VALUES (?,?,?)", "sss", [$name, $email, $password]);

    // User ko turant jawab, welcome mail uske baad background mein jaata hai
    reply_now("Registered", "text/plain");

    send_email($email, "Welcome to " . HOSPITAL_NAME,
        "Hi $name,\n\nWelcome to SmartHealth! Your account has been created successfully.\n\n"
        . "With your account you can:\n"
        . "- Book doctor appointments online and get a token number\n"
        . "- Get your Smart Patient QR Card for quick check-in\n"
        . "- See your prescriptions and medical history\n"
        . "- Use Emergency SOS to call an ambulance to your live location\n\n"
        . "Log in with this email address to get started.\n\n"
        . "If you did not create this account, please contact us at " . HOSPITAL_PHONE . ".\n\n"
        . "- " . HOSPITAL_NAME);

}

?>
