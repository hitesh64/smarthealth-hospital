<?php
include "config.php";

$id = $_GET['id'];

$sql = "DELETE FROM ambulance WHERE id='$id'";

if(mysqli_query($conn, $sql)){
    echo "Ambulance Record Deleted Successfully";
} else {
    echo "Error: " . mysqli_error($conn);
}
?>