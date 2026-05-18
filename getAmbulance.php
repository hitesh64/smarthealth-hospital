<?php

include "config.php";

$q=mysqli_query(
$conn,
"SELECT * FROM ambulance"
);

$data=[];

while($row=mysqli_fetch_assoc($q)){

$data[]=$row;

}

echo json_encode($data);

?>