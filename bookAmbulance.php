<?php
include "config.php";

$uid = $_POST['user']; // Active logged-in user ki email
$name = $_POST['name'];
$phone = $_POST['phone'];
$pickup = $_POST['pickup'];
$destination = $_POST['destination'];
$status = "Pending";

$sql = "INSERT INTO ambulance (user_id, patient_name, phone, address, emergency_type, status) 
        VALUES ('$uid', '$name', '$phone', '$pickup', '$destination', '$status')";

if(mysqli_query($conn, $sql)){
    echo "Ambulance Booked Successfully";
} else {
    echo "Error: " . mysqli_error($conn);
}
?>