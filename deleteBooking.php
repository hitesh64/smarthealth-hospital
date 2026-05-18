<?php
include "config.php";

$id = $_GET['id'];

$sql = "DELETE FROM bookings WHERE id='$id'";

if(mysqli_query($conn, $sql)){
    echo "Booking Deleted Successfully";
} else {
    echo "Error: " . mysqli_error($conn);
}
?>