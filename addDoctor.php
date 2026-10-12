<?php
include "lib.php";
require_admin_text();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo "Invalid Request Method.";
    exit;
}

$doctor_name = post('doctor_name');
$specialization = post('specialization');
$experience = max(0, intval(post('experience')));
$days = post('days');
if ($doctor_name === '' || $specialization === '' || $days === '') {
    echo "Error: Doctor name, specialization and available days are required.";
    exit;
}

// Doctor dashboard login (optional)
$email = post('email') !== '' ? post('email') : null;
if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    echo "Error: The login email is not a valid email address.";
    exit;
}
if ($email !== null && db_one("SELECT id FROM doctors WHERE email=?", "s", [$email])) {
    echo "Error: This login email is already used by another doctor.";
    exit;
}
$hash = !empty($_POST['password']) ? password_hash($_POST['password'], PASSWORD_BCRYPT) : null;

$image = save_doctor_image();
if ($image === '' || $image === null) {
    echo "Error: Please upload a profile photo (JPG, PNG, WEBP or GIF, up to 5 MB).";
    exit;
}

db_run("INSERT INTO doctors (doctor_name, specialization, experience, days, image, email, password) VALUES (?,?,?,?,?,?,?)",
    "ssissss", [$doctor_name, $specialization, $experience, $days, $image, $email, $hash]);
echo "Doctor Added Successfully to Live Database!";
?>
