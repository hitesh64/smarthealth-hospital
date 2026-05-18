<?php
include "config.php";

$id = $_GET['id'];
$status = $_GET['status'];

$sql = "UPDATE ambulance SET status='$status' WHERE id='$id'";

if(mysqli_query($conn, $sql)){
    echo "Ambulance Status Updated to " . $status;
} else {
    echo "Error";
}
?>