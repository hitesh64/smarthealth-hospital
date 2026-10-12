<?php
include "lib.php";

// Admin ko saare ambulance requests; logged-in patient ko sirf apne; baaki kisi ko kuch nahi
if (is_admin()) {
    $data = db_all("SELECT * FROM ambulance");
} elseif (!empty($_SESSION['user_email'])) {
    $data = db_all("SELECT * FROM ambulance WHERE LOWER(TRIM(user_id)) = LOWER(?)", "s", [trim($_SESSION['user_email'])]);
} else {
    $data = [];
}

header('Content-Type: application/json');
echo json_encode($data);
?>
