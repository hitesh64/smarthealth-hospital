<?php

$conn=new mysqli(
"localhost",
"root",
"",
"hospital_db"
);

$id=$_GET['id'];

$sql=
"DELETE FROM doctors
WHERE id='$id'";

if($conn->query($sql)){

echo "Doctor Removed";

}else{

echo "Error";

}

?>