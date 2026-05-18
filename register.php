<?php

include "config.php";

$name=$_POST['name'];
$email=$_POST['email'];

$password=password_hash(
$_POST['password'],
PASSWORD_DEFAULT
);

$check=mysqli_query(
$conn,
"SELECT * FROM users WHERE email='$email'"
);

if(mysqli_num_rows($check)>0){

echo "User Already Exists";

}else{

$sql=
"INSERT INTO users
(name,email,password)

VALUES(
'$name',
'$email',
'$password'
)";

if(mysqli_query(
$conn,
$sql
)){

echo "Registered";

}

}

?>