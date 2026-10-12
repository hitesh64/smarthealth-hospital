<?php
// Sends appointment reminder emails for appointments starting within
// the next REMINDER_HOURS_BEFORE hours. Each appointment is reminded once.
//
// Run it on a schedule, e.g. hourly from Windows Task Scheduler:
//     C:\xampp\php\php.exe C:\xampp\htdocs\hospital\sendReminders.php
// The admin panel also runs it on login and from Notifications > "Send due reminders".
include_once __DIR__ . "/lib.php";

function send_due_reminders() {
    retry_failed_emails(20);

    $due = db_all(
        "SELECT b.*, d.doctor_name,
                STR_TO_DATE(CONCAT(b.appointment_date,' ',b.time_slot), '%Y-%m-%d %h:%i %p') AS starts_at
         FROM bookings b LEFT JOIN doctors d ON d.id=b.doctor_id
         WHERE b.reminder_sent=0 AND b.status IN ('Pending','Accepted')
         HAVING starts_at > NOW() AND starts_at <= NOW() + INTERVAL ? HOUR", "i", [REMINDER_HOURS_BEFORE]);

    foreach ($due as $b) {
        $msg = "SmartHealth reminder: {$b['patient_name']}, you have an appointment with {$b['doctor_name']} "
             . "on {$b['appointment_date']} at {$b['time_slot']}. Token No: {$b['token_no']}. Please arrive 10 minutes early.";
        notify_patient($b['user_id'], "Appointment reminder - Token {$b['token_no']}", $msg);
        db_run("UPDATE bookings SET reminder_sent=1 WHERE id=?", "i", [$b['id']]);
    }
    return count($due);
}

if (PHP_SAPI === 'cli') {
    echo "Reminders processed: " . send_due_reminders() . "\n";
} elseif (basename($_SERVER['SCRIPT_FILENAME']) === basename(__FILE__)) {
    require_admin();
    json_out(["status" => "success", "processed" => send_due_reminders()]);
}
?>
