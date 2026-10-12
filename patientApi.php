<?php
// Patient API: smart QR health card, medical profile, own prescriptions.
include "lib.php";

$action = $_GET['action'] ?? '';
$email = require_user();

switch ($action) {
    case 'card':
        $user = db_one("SELECT name, email, phone, age, blood, allergies, conditions, emergency_contact, qr_token
                        FROM users WHERE email=?", "s", [$email]);
        if (!$user) fail("User not found", 404);
        if (empty($user['qr_token'])) {
            $user['qr_token'] = new_token();
            db_run("UPDATE users SET qr_token=? WHERE email=?", "ss", [$user['qr_token'], $email]);
        }
        $user['qr_text'] = "SHQR:" . $user['qr_token'];
        unset($user['qr_token']);
        json_out(["status" => "success", "card" => $user]);

    case 'saveMedical':
        db_run("UPDATE users SET allergies=?, conditions=?, emergency_contact=? WHERE email=?",
            "ssss", [post('allergies'), post('conditions'), post('emergency_contact'), $email]);
        json_out(["status" => "success"]);

    case 'regenerate':
        // Old printed cards stop working
        db_run("UPDATE users SET qr_token=? WHERE email=?", "ss", [new_token(), $email]);
        json_out(["status" => "success"]);

    case 'prescriptions':
        json_out(["status" => "success", "prescriptions" => db_all(
            "SELECT p.id, p.diagnosis, p.medicines, p.notes, p.created_at, d.doctor_name, d.specialization
             FROM prescriptions p LEFT JOIN doctors d ON d.id=p.doctor_id
             WHERE p.user_email=? ORDER BY p.id DESC", "s", [$email])]);
}

fail("Unknown action", 404);
?>
