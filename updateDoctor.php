<?php
include "lib.php";
require_admin_text();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo "Invalid request method.";
    exit;
}

$id = intval(post('id'));
$doctor_name = post('doctor_name');
$specialization = post('specialization');
$experience = max(0, intval(post('experience')));
$days = post('days');
if (!$id || !db_one("SELECT id FROM doctors WHERE id=?", "i", [$id])) {
    echo "Error: Doctor not found.";
    exit;
}
if ($doctor_name === '' || $specialization === '' || $days === '') {
    echo "Error: Doctor name, specialization and available days are required.";
    exit;
}

// Doctor dashboard login: email / password sirf tab badlein jab admin ne bhara ho
$email = post('email');
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    echo "Error: The login email is not a valid email address.";
    exit;
}
if ($email !== '' && db_one("SELECT id FROM doctors WHERE email=? AND id<>?", "si", [$email, $id])) {
    echo "Error: This login email is already used by another doctor.";
    exit;
}

$image = save_doctor_image();
if ($image === null) {
    echo "Error: The photo must be a JPG, PNG, WEBP or GIF image up to 5 MB.";
    exit;
}

db_run("UPDATE doctors SET doctor_name=?, specialization=?, experience=?, days=? WHERE id=?",
    "ssisi", [$doctor_name, $specialization, $experience, $days, $id]);
if ($image !== '') db_run("UPDATE doctors SET image=? WHERE id=?", "si", [$image, $id]);
if ($email !== '') db_run("UPDATE doctors SET email=? WHERE id=?", "si", [$email, $id]);
if (!empty($_POST['password'])) {
    db_run("UPDATE doctors SET password=? WHERE id=?", "si", [password_hash($_POST['password'], PASSWORD_BCRYPT), $id]);
}

echo "Doctor details updated successfully in the database!";
?>
