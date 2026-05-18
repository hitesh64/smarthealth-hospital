<?php

include "config.php";

$name=$_POST['doctor_name'];
$spec=$_POST['specialization'];
$exp=$_POST['experience'];
$days=$_POST['days'];

$imageName=$_FILES['image']['name'];

$tmp=$_FILES['image']['tmp_name'];

move_uploaded_file(
$tmp,
"uploads/".$imageName
);

$image="uploads/".$imageName;

$sql="INSERT INTO doctors
(doctor_name,specialization,experience,days,image)

VALUES
('$name','$spec','$exp','$days','$image')";

if(mysqli_query($conn,$sql)){

echo "Doctor Added";

}else{

echo "Error";

}

?>