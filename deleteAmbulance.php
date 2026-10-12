<?php
include "lib.php";
require_admin_text();

$id = intval($_GET['id'] ?? 0);
if (!$id) {
    echo "Error: No record ID provided.";
    exit;
}

db_run("DELETE FROM ambulance WHERE id=?", "i", [$id]);
echo "Ambulance Record Deleted Successfully";
?>
