<?php
include "config.php";

$uid = $_POST['user']; 
$name = $_POST['patient_name'];   // Naya add kiya
$phone = $_POST['patient_phone']; // Naya add kiya
$doctor = $_POST['doctor'];
$date = $_POST['date'];
$time = $_POST['time'];
$status = "Pending"; // Status NULL na ho isliye isko Pending set kiya

// SQL query mein nayi columns add ki gayi hain
$sql = "INSERT INTO bookings (user_id, patient_name, patient_phone, doctor_id, appointment_date, time_slot, status) 
        VALUES ('$uid', '$name', '$phone', '$doctor', '$date', '$time', '$status')";

if(mysqli_query($conn, $sql)){
    echo "Booked Successfully!";
} else {
    echo "Error: " . mysqli_error($conn);
}
?>