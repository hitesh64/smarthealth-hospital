<?php
include "lib.php";
require_admin_text();

$id = intval($_GET['id'] ?? 0);
$status = trim($_GET['status'] ?? '');

if (!$id || !in_array($status, ['Pending', 'Dispatched'], true)) {
    echo "Error";
    exit;
}

db_run("UPDATE ambulance SET status=? WHERE id=?", "si", [$status, $id]);
echo "Ambulance Status Updated to " . $status;
?>
