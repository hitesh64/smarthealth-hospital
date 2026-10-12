<?php
// Patient logout: ends the server session (health card / prescriptions access).
include "lib.php";

unset($_SESSION['user_email'], $_SESSION['sos_token']);
json_out(["status" => "success"]);
?>
