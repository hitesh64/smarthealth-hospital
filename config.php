<?php
// Database connection. On a hosting service (Render etc.) the DB_* environment variables are set;
// without them the local XAMPP defaults below are used.
$servername = getenv('DB_HOST') ?: "127.0.0.1";
$username = getenv('DB_USER') ?: "root";
$password = getenv('DB_PASS') ?: "";
$dbname = getenv('DB_NAME') ?: "hospital_db";
$port = (int)(getenv('DB_PORT') ?: 3307);
// Cloud MySQL (Aiven etc.) only accepts encrypted connections: set DB_SSL=1 there
$ssl = getenv('DB_SSL') === '1';

$conn = mysqli_init();
if ($ssl) mysqli_ssl_set($conn, null, null, null, null, null);

try {
    $connected = @mysqli_real_connect($conn, $servername, $username, $password, $dbname, $port, null, $ssl ? MYSQLI_CLIENT_SSL : 0);
} catch (mysqli_sql_exception $e) {
    $connected = false;
}
if (!$connected) {
    http_response_code(500);
    die("Connection failed: " . mysqli_connect_error());
}

// Cloud servers run on UTC; "today" in reports and dashboards must be Indian time
mysqli_query($conn, "SET time_zone = '+05:30'");
?>
