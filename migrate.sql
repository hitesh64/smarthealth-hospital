-- SmartHealth feature migration. Additive only: safe to run more than once.
-- Run:  C:\xampp\mysql\bin\mysql.exe -uroot -P3307 -h127.0.0.1 hospital_db < migrate.sql

-- Appointments: token number + reminder tracking
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS token_no INT NULL,
    ADD COLUMN IF NOT EXISTS reminder_sent TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Patients: medical profile + QR card token
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS allergies TEXT NULL,
    ADD COLUMN IF NOT EXISTS conditions TEXT NULL,
    ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(20) NULL,
    ADD COLUMN IF NOT EXISTS qr_token VARCHAR(64) NULL,
    ADD UNIQUE INDEX IF NOT EXISTS uq_users_qr (qr_token);

-- Google sign-up users: 0 until they choose their own password in the popup
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_set TINYINT(1) NOT NULL DEFAULT 1;

-- Doctors: login for the doctor dashboard
ALTER TABLE doctors
    ADD COLUMN IF NOT EXISTS email VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS password VARCHAR(255) NULL,
    ADD UNIQUE INDEX IF NOT EXISTS uq_doctors_email (email);

CREATE TABLE IF NOT EXISTS prescriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NULL,
    user_email VARCHAR(100) NOT NULL,
    doctor_id INT NOT NULL,
    diagnosis VARCHAR(255) NOT NULL,
    medicines TEXT NOT NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_presc_user (user_email),
    INDEX idx_presc_doctor (doctor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS medicines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    stock INT NOT NULL DEFAULT 0,
    reorder_level INT NOT NULL DEFAULT 10,
    unit VARCHAR(30) NOT NULL DEFAULT 'strips',
    expiry_date DATE NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_medicine_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Medicine store: the stock list is also the product catalogue patients order from
ALTER TABLE medicines
    ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS category VARCHAR(60) NOT NULL DEFAULT 'General',
    ADD COLUMN IF NOT EXISTS description VARCHAR(500) NULL,
    ADD COLUMN IF NOT EXISTS image VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS for_sale TINYINT(1) NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS medicine_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_no VARCHAR(20) NULL,
    user_email VARCHAR(100) NOT NULL,
    customer_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    delivery_type VARCHAR(20) NOT NULL,
    address VARCHAR(255) NULL,
    city VARCHAR(60) NULL,
    pincode VARCHAR(10) NULL,
    payment_method VARCHAR(30) NOT NULL,
    notes VARCHAR(255) NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
    total DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Placed',
    cancel_reason VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_order_no (order_no),
    INDEX idx_order_user (user_email),
    INDEX idx_order_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- who cancelled an order ('patient' or 'pharmacy'), so the cancellation mail can say so
ALTER TABLE medicine_orders
    ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(10) NULL;

-- UPI payment. payment_status: COD (cash), Pending (UPI not paid yet), Submitted (patient gave the UTR,
-- waiting for the pharmacy to check), Paid, Not Paid (cancelled before paying), Refund Due, Refunded
ALTER TABLE medicine_orders
    ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'COD',
    ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(30) NULL,
    ADD COLUMN IF NOT EXISTS paid_at DATETIME NULL,
    ADD INDEX IF NOT EXISTS idx_order_payref (payment_ref);

-- name / unit / price are copied here so an order still reads correctly after the medicine is edited or removed
CREATE TABLE IF NOT EXISTS medicine_order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    medicine_id INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    unit VARCHAR(30) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    qty INT NOT NULL,
    line_total DECIMAL(10,2) NOT NULL,
    INDEX idx_item_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ambulance fleet (the existing `ambulance` table stays as the manual booking list)
CREATE TABLE IF NOT EXISTS ambulances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_no VARCHAR(30) NOT NULL,
    driver_name VARCHAR(100) NOT NULL,
    driver_phone VARCHAR(20) NULL,
    driver_token VARCHAR(64) NOT NULL,
    lat DECIMAL(10,7) NULL,
    lng DECIMAL(10,7) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Offline',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_amb_token (driver_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sos_alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(64) NOT NULL,
    user_email VARCHAR(100) NULL,
    name VARCHAR(100) NULL,
    phone VARCHAR(20) NULL,
    lat DECIMAL(10,7) NULL,
    lng DECIMAL(10,7) NULL,
    accuracy INT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'New',
    ambulance_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sos_token (token),
    INDEX idx_sos_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    channel VARCHAR(10) NOT NULL,
    recipient VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL,
    detail VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Failed mails are retried later: keep the subject and how many times we tried
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS subject VARCHAR(200) NULL,
    ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 1;

-- Back-fill token numbers for appointments booked before this migration
UPDATE bookings b
JOIN (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY doctor_id, appointment_date ORDER BY id) AS rn
    FROM bookings
) x ON x.id = b.id
SET b.token_no = x.rn
WHERE b.token_no IS NULL;

-- Delivery OTP: a home delivery is completed only with the OTP emailed to the patient (only its hash is stored)
ALTER TABLE medicine_orders
    ADD COLUMN IF NOT EXISTS delivery_otp_hash VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS otp_sent_at DATETIME NULL,
    ADD COLUMN IF NOT EXISTS otp_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0;
