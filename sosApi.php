<?php
// Emergency SOS API.
//  Public  : create, track, updateLocation, cancel   (anyone can raise an SOS, no login)
//  Driver  : driver, driverLocation, driverStatus     (authorised by the driver link token)
//  Admin   : list, dispatch, resolve, addAmbulance, deleteAmbulance
include "lib.php";

$action = $_GET['action'] ?? '';

function coord($key) {
    $v = post($key);
    return ($v !== '' && is_numeric($v)) ? (float)$v : null;
}

function valid_coords($lat, $lng) {
    return $lat !== null && $lng !== null && abs($lat) <= 90 && abs($lng) <= 180;
}

function alert_view($a) {
    $amb = $a['ambulance_id'] ? db_one(
        "SELECT vehicle_no, driver_name, driver_phone, lat, lng, updated_at FROM ambulances WHERE id=?", "i", [$a['ambulance_id']]) : null;
    $eta = null;
    if ($amb && $amb['lat'] !== null && $a['lat'] !== null) {
        $km = distance_km($amb['lat'], $amb['lng'], $a['lat'], $a['lng']);
        // rough city estimate at 30 km/h
        $eta = ["km" => round($km, 2), "minutes" => max(1, (int)ceil($km / 30 * 60))];
    }
    return [
        "status" => "success",
        "alert" => ["id" => (int)$a['id'], "state" => $a['status'], "lat" => $a['lat'], "lng" => $a['lng'], "accuracy" => $a['accuracy'], "created_at" => $a['created_at']],
        "ambulance" => $amb, "eta" => $eta,
        "hospital" => ["name" => HOSPITAL_NAME, "phone" => HOSPITAL_PHONE, "lat" => HOSPITAL_LAT, "lng" => HOSPITAL_LNG],
    ];
}

// Nearest ambulance that is online and free (straight-line distance).
// An ambulance that has not reported a position yet is assumed to be at the hospital.
function nearest_ambulance($lat, $lng) {
    $best = null;
    foreach (db_all("SELECT * FROM ambulances WHERE status='Available'") as $amb) {
        $aLat = $amb['lat'] ?? HOSPITAL_LAT;
        $aLng = $amb['lng'] ?? HOSPITAL_LNG;
        $km = ($lat === null) ? 0 : distance_km($aLat, $aLng, $lat, $lng);
        if ($best === null || $km < $best['km']) $best = ["amb" => $amb, "km" => $km];
    }
    return $best;
}

switch ($action) {
    // ------------------------------------------------------------ public
    case 'create':
        // One open alert per browser session: pressing again returns the same alert
        if (!empty($_SESSION['sos_token'])) {
            $open = db_one("SELECT * FROM sos_alerts WHERE token=? AND status IN ('New','Dispatched','Arrived')", "s", [$_SESSION['sos_token']]);
            if ($open) json_out(["status" => "success", "token" => $open['token']]);
        }
        $lat = coord('lat');
        $lng = coord('lng');
        if (!valid_coords($lat, $lng)) { $lat = null; $lng = null; }
        $acc = post('accuracy') !== '' ? (int)post('accuracy') : null;
        $token = new_token();
        db_run("INSERT INTO sos_alerts (token, user_email, name, phone, lat, lng, accuracy) VALUES (?,?,?,?,?,?,?)",
            "ssssddi", [$token, $_SESSION['user_email'] ?? null, substr(post('name'), 0, 100) ?: null,
                        substr(post('phone'), 0, 20) ?: null, $lat, $lng, $acc]);
        $_SESSION['sos_token'] = $token;
        json_out(["status" => "success", "token" => $token]);

    case 'track':
        $a = db_one("SELECT * FROM sos_alerts WHERE token=?", "s", [$_GET['token'] ?? '']);
        if (!$a) fail("Alert not found", 404);
        json_out(alert_view($a));

    case 'updateLocation':
        $lat = coord('lat');
        $lng = coord('lng');
        $phone = substr(post('phone'), 0, 20);
        $open = "token=? AND status IN ('New','Dispatched','Arrived')";
        if (valid_coords($lat, $lng)) {
            db_run("UPDATE sos_alerts SET lat=?, lng=?, accuracy=? WHERE $open", "ddis", [$lat, $lng, (int)post('accuracy'), post('token')]);
        }
        if ($phone !== '') {
            db_run("UPDATE sos_alerts SET phone=? WHERE $open", "ss", [$phone, post('token')]);
        }
        json_out(["status" => "success"]);

    case 'cancel':
        $a = db_one("SELECT * FROM sos_alerts WHERE token=? AND status IN ('New','Dispatched','Arrived')", "s", [post('token')]);
        if ($a) {
            db_run("UPDATE sos_alerts SET status='Cancelled' WHERE id=?", "i", [$a['id']]);
            if ($a['ambulance_id']) db_run("UPDATE ambulances SET status='Available' WHERE id=? AND status='Busy'", "i", [$a['ambulance_id']]);
        }
        unset($_SESSION['sos_token']);
        json_out(["status" => "success"]);

    // ------------------------------------------------------------ driver
    case 'driver':
    case 'driverLocation':
    case 'driverStatus':
        $amb = db_one("SELECT * FROM ambulances WHERE driver_token=?", "s", [$_REQUEST['t'] ?? '']);
        if (!$amb) fail("Invalid driver link", 403);

        if ($action === 'driverLocation') {
            $lat = coord('lat');
            $lng = coord('lng');
            if (!valid_coords($lat, $lng)) fail("Invalid location");
            // Going online: Offline -> Available. A busy ambulance stays busy.
            db_run("UPDATE ambulances SET lat=?, lng=?, status=IF(status='Offline','Available',status) WHERE id=?",
                "ddi", [$lat, $lng, $amb['id']]);
        }
        if ($action === 'driverStatus') {
            $state = post('state');
            $job = db_one("SELECT * FROM sos_alerts WHERE ambulance_id=? AND status IN ('Dispatched','Arrived')", "i", [$amb['id']]);
            if ($state === 'Offline' && !$job) {
                db_run("UPDATE ambulances SET status='Offline' WHERE id=?", "i", [$amb['id']]);
            } elseif ($job && $state === 'Arrived') {
                db_run("UPDATE sos_alerts SET status='Arrived' WHERE id=?", "i", [$job['id']]);
            } elseif ($job && $state === 'Resolved') {
                db_run("UPDATE sos_alerts SET status='Resolved' WHERE id=?", "i", [$job['id']]);
                db_run("UPDATE ambulances SET status='Available' WHERE id=?", "i", [$amb['id']]);
            }
        }
        $amb = db_one("SELECT id, vehicle_no, driver_name, lat, lng, status FROM ambulances WHERE id=?", "i", [$amb['id']]);
        $job = db_one("SELECT id, name, phone, lat, lng, status, created_at FROM sos_alerts
                       WHERE ambulance_id=? AND status IN ('Dispatched','Arrived')", "i", [$amb['id']]);
        json_out(["status" => "success", "ambulance" => $amb, "job" => $job,
                  "hospital" => ["lat" => HOSPITAL_LAT, "lng" => HOSPITAL_LNG]]);
}

// ---------------------------------------------------------------- admin
require_admin();

switch ($action) {
    case 'list':
        $alerts = db_all(
            "SELECT s.*, a.vehicle_no, a.driver_name, a.driver_phone, a.lat AS amb_lat, a.lng AS amb_lng
             FROM sos_alerts s LEFT JOIN ambulances a ON a.id=s.ambulance_id
             ORDER BY FIELD(s.status,'New','Dispatched','Arrived','Resolved','Cancelled'), s.id DESC LIMIT 50");
        foreach ($alerts as &$a) unset($a['token']);
        unset($a);
        // Dashboard counts come from the whole tables, not from the 50 alerts listed above.
        // The five alert statuses partition every alert.
        $stats = db_one("SELECT COUNT(*) AS total,
                COALESCE(SUM(status='New'), 0) AS waiting,
                COALESCE(SUM(status='Dispatched'), 0) AS dispatched,
                COALESCE(SUM(status='Arrived'), 0) AS arrived,
                COALESCE(SUM(status='Resolved'), 0) AS resolved,
                COALESCE(SUM(status='Cancelled'), 0) AS cancelled,
                COALESCE(SUM(DATE(created_at)=CURDATE()), 0) AS today
            FROM sos_alerts");
        $fleetStats = db_one("SELECT COUNT(*) AS fleet,
                COALESCE(SUM(status='Available'), 0) AS available,
                COALESCE(SUM(status='Busy'), 0) AS busy,
                COALESCE(SUM(status='Offline'), 0) AS offline
            FROM ambulances");
        $stats = array_map('intval', $stats + $fleetStats);
        json_out(["status" => "success", "alerts" => $alerts, "stats" => $stats,
                  "fleet" => db_all("SELECT id, vehicle_no, driver_name, driver_phone, driver_token, lat, lng, status, updated_at FROM ambulances ORDER BY id"),
                  "hospital" => ["lat" => HOSPITAL_LAT, "lng" => HOSPITAL_LNG, "name" => HOSPITAL_NAME]]);

    case 'dispatch':
        $a = db_one("SELECT * FROM sos_alerts WHERE id=? AND status='New'", "i", [(int)post('id')]);
        if (!$a) fail("Alert is no longer waiting for dispatch");
        $ambId = (int)post('ambulance_id');
        if ($ambId) {
            $amb = db_one("SELECT * FROM ambulances WHERE id=? AND status='Available'", "i", [$ambId]);
            if (!$amb) fail("That ambulance is not available");
        } else {
            $best = nearest_ambulance($a['lat'], $a['lng']);
            if (!$best) fail("No ambulance is online and available. Ask a driver to open their driver link.");
            $amb = $best['amb'];
        }
        db_run("UPDATE ambulances SET status='Busy' WHERE id=?", "i", [$amb['id']]);
        db_run("UPDATE sos_alerts SET status='Dispatched', ambulance_id=? WHERE id=?", "ii", [$amb['id'], $a['id']]);
        // Admin ko turant jawab; logged-in caller ko email uske baad jaata hai
        reply_now(json_encode(["status" => "success", "vehicle_no" => $amb['vehicle_no']]));
        if ($a['user_email']) {
            send_email($a['user_email'], "SmartHealth SOS - ambulance on the way", "SmartHealth SOS: Ambulance {$amb['vehicle_no']} (driver {$amb['driver_name']} {$amb['driver_phone']}) is on the way to you.");
        }
        exit;

    case 'resolve':
        $a = db_one("SELECT * FROM sos_alerts WHERE id=?", "i", [(int)post('id')]);
        if (!$a) fail("Alert not found", 404);
        db_run("UPDATE sos_alerts SET status='Resolved' WHERE id=?", "i", [$a['id']]);
        if ($a['ambulance_id']) db_run("UPDATE ambulances SET status='Available' WHERE id=? AND status='Busy'", "i", [$a['ambulance_id']]);
        json_out(["status" => "success"]);

    case 'addAmbulance':
        if (post('vehicle_no') === '' || post('driver_name') === '') fail("Vehicle number and driver name are required");
        db_run("INSERT INTO ambulances (vehicle_no, driver_name, driver_phone, driver_token) VALUES (?,?,?,?)",
            "ssss", [post('vehicle_no'), post('driver_name'), post('driver_phone'), new_token()]);
        json_out(["status" => "success"]);

    case 'deleteAmbulance':
        $id = (int)post('id');
        if (db_one("SELECT id FROM sos_alerts WHERE ambulance_id=? AND status IN ('Dispatched','Arrived')", "i", [$id])) {
            fail("This ambulance is on an active emergency");
        }
        db_run("DELETE FROM ambulances WHERE id=?", "i", [$id]);
        json_out(["status" => "success"]);
}

fail("Unknown action", 404);
?>
