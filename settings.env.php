<?php
// Feature settings for a hosted deployment, read from environment variables.
// Used only when settings.php is absent (it holds the passwords, so it is never committed).
// Set these in the hosting dashboard (Render: service > Environment).

function env_setting($key, $default = '') {
    $v = getenv($key);
    return ($v === false || $v === '') ? $default : $v;
}

// --- Email via Gmail SMTP (leave empty to only log messages in Admin > Notifications) ---
define('MAIL_GMAIL_ADDRESS', env_setting('MAIL_GMAIL_ADDRESS'));
define('MAIL_GMAIL_APP_PASSWORD', env_setting('MAIL_GMAIL_APP_PASSWORD'));
define('MAIL_FROM_NAME', env_setting('MAIL_FROM_NAME', 'SmartHealth Hospital'));

// --- Google Sign-In client id (must match the one in index.html) ---
define('GOOGLE_CLIENT_ID', env_setting('GOOGLE_CLIENT_ID'));

// --- Hospital location: map centre and fallback ambulance base ---
define('HOSPITAL_NAME', env_setting('HOSPITAL_NAME', 'SmartHealth Hospital'));
define('HOSPITAL_LAT', (float)env_setting('HOSPITAL_LAT', 18.5204));
define('HOSPITAL_LNG', (float)env_setting('HOSPITAL_LNG', 73.8567));
define('HOSPITAL_PHONE', env_setting('HOSPITAL_PHONE', '+91 1800-123-4567'));

// How many hours before an appointment the reminder goes out (sendReminders.php)
define('REMINDER_HOURS_BEFORE', (int)env_setting('REMINDER_HOURS_BEFORE', 24));

// --- UPI payment for medicine orders (empty UPI_ID = cash only) ---
define('UPI_ID', env_setting('UPI_ID'));
define('UPI_PAYEE_NAME', env_setting('UPI_PAYEE_NAME', 'SmartHealth Hospital'));
define('UPI_PAY_MINUTES', (int)env_setting('UPI_PAY_MINUTES', 30));
?>
