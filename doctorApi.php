<?php
// Doctor dashboard API: login, appointment queue, patient history, prescriptions, QR lookup.
include "lib.php";

$action = $_GET['action'] ?? '';

if ($action === 'login') {
    $row = db_one("SELECT * FROM doctors WHERE email=?", "s", [post('email')]);
    if (!$row || !$row['password'] || !password_verify($_POST['password'] ?? '', $row['password'])) {
        fail("Invalid email or password", 401);
    }
    session_regenerate_id(true);
    $_SESSION['doctor_id'] = (int)$row['id'];
    json_out(["status" => "success"]);
}

if ($action === 'logout') {
    unset($_SESSION['doctor_id']);
    json_out(["status" => "success"]);
}

$doctorId = require_doctor();

// Full medical record of one patient, as shown to the doctor.
function patient_record($user) {
    $email = $user['email'];
    return [
        "status" => "success",
        "patient" => [
            "name" => $user['name'], "email" => $email, "phone" => $user['phone'],
            "age" => $user['age'], "blood" => $user['blood'], "address" => $user['address'],
            "allergies" => $user['allergies'], "conditions" => $user['conditions'],
            "emergency_contact" => $user['emergency_contact'],
        ],
        "prescriptions" => db_all(
            "SELECT p.id, p.diagnosis, p.medicines, p.notes, p.created_at, d.doctor_name, d.specialization
             FROM prescriptions p LEFT JOIN doctors d ON d.id=p.doctor_id
             WHERE p.user_email=? ORDER BY p.id DESC", "s", [$email]),
        "visits" => db_all(
            "SELECT b.id, b.appointment_date, b.time_slot, b.status, b.token_no, d.doctor_name, d.specialization
             FROM bookings b LEFT JOIN doctors d ON d.id=b.doctor_id
             WHERE b.user_id=? ORDER BY b.appointment_date DESC, b.id DESC", "s", [$email]),
    ];
}

switch ($action) {
    case 'me':
        $me = db_one("SELECT id, doctor_name, specialization, image FROM doctors WHERE id=?", "i", [$doctorId]);
        if (!$me) {
            // doctor was removed by the admin while still logged in
            unset($_SESSION['doctor_id']);
            fail("Doctor login required", 401);
        }
        json_out(["status" => "success", "doctor" => $me]);

    case 'appointments':
        $date = $_GET['date'] ?? '';
        if ($date !== '') {
            $rows = db_all("SELECT * FROM bookings WHERE doctor_id=? AND appointment_date=? ORDER BY token_no, id",
                "is", [$doctorId, $date]);
        } else {
            $rows = db_all("SELECT * FROM bookings WHERE doctor_id=? ORDER BY appointment_date DESC, token_no, id",
                "i", [$doctorId]);
        }
        json_out(["status" => "success", "appointments" => $rows]);

    case 'setStatus':
        $status = post('status');
        if (!in_array($status, ['Accepted', 'Completed', 'Rejected'], true)) fail("Invalid status");
        $bid = (int)post('id');
        $own = db_one("SELECT status FROM bookings WHERE id=? AND doctor_id=?", "ii", [$bid, $doctorId]);
        if (!$own) fail("Appointment not found", 404);
        db_run("UPDATE bookings SET status=? WHERE id=? AND doctor_id=?", "sii", [$status, $bid, $doctorId]);
        // Doctor ko turant jawab; accept / reject ka mail patient ko uske baad jaata hai
        reply_now(json_encode(["status" => "success"]));
        if ($own['status'] !== $status) notify_booking_status($bid, $status);
        exit;

    case 'patient':
        // Only patients who have an appointment with this doctor can be opened by email.
        $email = $_GET['email'] ?? '';
        $seen = db_one("SELECT id FROM bookings WHERE doctor_id=? AND user_id=? LIMIT 1", "is", [$doctorId, $email]);
        if (!$seen) fail("This patient has no appointment with you", 403);
        $user = db_one("SELECT * FROM users WHERE email=?", "s", [$email]);
        if (!$user) fail("Patient has no registered profile", 404);
        json_out(patient_record($user));

    case 'scan':
        // QR card content is "SHQR:<token>"
        $code = trim($_GET['code'] ?? '');
        if (stripos($code, 'SHQR:') === 0) $code = substr($code, 5);
        if (!preg_match('/^[a-f0-9]{32}$/', $code)) fail("This is not a SmartHealth patient card");
        $user = db_one("SELECT * FROM users WHERE qr_token=?", "s", [$code]);
        if (!$user) fail("Card not recognised. It may have been regenerated.", 404);
        json_out(patient_record($user));

    case 'prescribe':
        $email = post('email');
        $diagnosis = post('diagnosis');
        $medicines = post('medicines');
        if ($email === '' || $diagnosis === '' || $medicines === '') fail("Diagnosis and medicines are required");
        if (!db_one("SELECT id FROM users WHERE email=?", "s", [$email])) fail("Patient not found", 404);
        $bookingId = (int)post('booking_id') ?: null;
        db_run("INSERT INTO prescriptions (booking_id, user_email, doctor_id, diagnosis, medicines, notes) VALUES (?,?,?,?,?,?)",
            "isisss", [$bookingId, $email, $doctorId, $diagnosis, $medicines, post('notes')]);
        if ($bookingId) {
            db_run("UPDATE bookings SET status='Completed' WHERE id=? AND doctor_id=?", "ii", [$bookingId, $doctorId]);
        }
        json_out(["status" => "success"]);
}

fail("Unknown action", 404);
?>
