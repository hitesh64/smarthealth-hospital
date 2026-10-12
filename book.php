<?php
include "lib.php";

$uid = post('user');
$name = post('patient_name');
$phone = post('patient_phone');
$doctor = (int)post('doctor');
$date = post('date');
$time = post('time');
$status = "Pending"; // Status NULL na ho isliye isko Pending set kiya

if ($uid === '' || $name === '' || $phone === '' || !$doctor || $time === '') fail("Please fill all booking details.");
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || $date < date('Y-m-d')) fail("Please choose today or a future date.");

$doc = db_one("SELECT doctor_name, email FROM doctors WHERE id=?", "i", [$doctor]);
if (!$doc) fail("Doctor not found.");

// Token number = position in this doctor's queue for the day. Locked so two
// patients booking at the same moment cannot get the same token.
mysqli_begin_transaction($conn);
$next = db_one("SELECT COALESCE(MAX(token_no),0)+1 AS t FROM bookings WHERE doctor_id=? AND appointment_date=? FOR UPDATE",
    "is", [$doctor, $date]);
$token = (int)$next['t'];
db_run("INSERT INTO bookings (user_id, patient_name, patient_phone, doctor_id, appointment_date, time_slot, status, token_no)
        VALUES (?,?,?,?,?,?,?,?)", "sssisssi", [$uid, $name, $phone, $doctor, $date, $time, $status, $token]);
mysqli_commit($conn);

// Patient ko turant jawab, email uske baad background mein jaata hai
reply_now(json_encode(["status" => "success", "token_no" => $token, "message" => "Booked Successfully! Your token number is $token."]));

$msg = "SmartHealth: Hi $name, your appointment with {$doc['doctor_name']} on $date at $time is booked. Token No: $token.";
notify_patient($uid, "Appointment booked - Token $token", $msg);

// Doctor ko bhi nayi appointment ka mail (agar admin ne doctor ka email set kiya hai)
if (!empty($doc['email'])) {
    // Kis user ne book kiya hai, uski profile bhi doctor ko dikhe
    $p = db_one("SELECT age, blood, allergies, conditions FROM users WHERE email=?", "s", [$uid]) ?: [];
    $profile = "Age: " . (($p['age'] ?? '') ?: '-') . "\nBlood Group: " . (($p['blood'] ?? '') ?: '-')
             . "\nAllergies: " . (($p['allergies'] ?? '') ?: 'None recorded')
             . "\nPast diseases: " . (($p['conditions'] ?? '') ?: 'None recorded');

    send_email($doc['email'], "New appointment - $name, $date, Token $token",
        "Hello {$doc['doctor_name']},\n\nA new appointment has been booked with you.\n\n"
        . "BOOKED BY\nPatient: $name\nPhone: $phone\nEmail: $uid\n$profile\n\n"
        . "APPOINTMENT\nDate: $date\nTime: $time\nToken No: $token\n\n"
        . "Open your Doctor Dashboard to accept it and see the patient's history.\n\n- " . HOSPITAL_NAME);
}
?>

