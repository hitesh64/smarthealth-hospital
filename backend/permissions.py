"""The sections of the admin panel a role can be given.

Each key is checked by the server on every admin request (not only hidden in the menu), so a staff
member can never read or change data of a section their role does not include.
"""

SECTIONS = [
    # key, label, admin.html tabs it opens, short description
    ("appointments", "Appointments", ["booking-tab"], "See, accept, reject and delete doctor appointments"),
    ("patients", "Patients", ["registered-users-tab"], "Patient directory"),
    ("doctors", "Doctors", ["doctor-list-tab", "doctor-tab"], "Add, edit and remove doctors, see their records"),
    ("ambulance", "Ambulance Bookings", ["ambulance-bookings-tab"], "Dispatch booked ambulances and follow them on the map"),
    ("sos", "SOS Alerts & Fleet", ["sos-tab"], "Emergency SOS alerts, dispatch and the ambulance fleet"),
    ("lab", "Lab Bookings", ["lab-tab"], "Sample collection, result entry and lab reports"),
    ("lab_catalogue", "Lab Test Catalogue", ["lab-tests-tab"], "Lab test prices and reference ranges"),
    ("medicines", "Medicine Stock", ["medicine-tab"], "Pharmacy stock and the store catalogue"),
    ("orders", "Medicine Orders", ["orders-tab"], "Medicine orders, payments and delivery"),
    ("analytics", "Analytics & Reports", ["analytics-tab"], "Charts and the appointment CSV report"),
    ("notifications", "Notifications", ["notifications-tab"], "Email log, resending mails and reminders"),
    ("settings", "Settings: Roles & Users", ["settings-tab"], "Create roles and staff logins (full control)"),
]

ALL = [s[0] for s in SECTIONS]
LABELS = {s[0]: s[1] for s in SECTIONS}

SUPER_ADMIN = "Super Admin"

# Roles a new installation starts with; the admin can change or remove them (except Super Admin)
DEFAULT_ROLES = [
    (SUPER_ADMIN, "Full access to every section, including roles and users.", ALL),
    ("Receptionist", "Front desk: appointments, patients and doctors.", ["appointments", "patients", "doctors"]),
    ("Lab Technician", "Laboratory bookings, results and reports.", ["lab"]),
    ("Pharmacist", "Medicine stock and medicine orders.", ["medicines", "orders"]),
    ("Emergency Desk", "Ambulance bookings, SOS alerts and the fleet.", ["ambulance", "sos"]),
]

# which section each action of /api/admin belongs to
ADMIN_ACTIONS = {
    "analytics": "analytics", "export": "analytics",
    "doctorRecords": "doctors",
    "medicines": "medicines", "saveMedicine": "medicines", "adjustStock": "medicines", "deleteMedicine": "medicines",
    "orders": "orders", "orderStatus": "orders", "resendDeliveryOtp": "orders", "cancelOrder": "orders",
    "verifyPayment": "orders", "rejectPayment": "orders", "markRefunded": "orders",
    # sendReminders is also run quietly at every admin sign-in, so any signed-in staff member may trigger it
    "notifications": "notifications", "retryEmails": "notifications",
}

LAB_ADMIN_ACTIONS = {"list": "lab", "advance": "lab", "saveResults": "lab", "cancel": "lab",
                     "tests": "lab_catalogue", "saveTest": "lab_catalogue", "toggleTest": "lab_catalogue"}


def tabs_for(perms):
    """admin.html tabs a list of sections opens."""
    return [tab for key, _label, tabs, _d in SECTIONS if key in perms for tab in tabs]
