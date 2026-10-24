# SmartHealth Hospital — Flask + MongoDB

Patient website, admin panel, doctor portal and ambulance driver page for a hospital in Mumbai
(Andheri East). The backend is Python (Flask) with MongoDB; the pages are plain HTML / CSS / JS.

## Run it on this computer

1. MongoDB must be running (`mongodb://localhost:27017/`).
2. Install the Python packages once:

   ```bash
   py -3.12 -m pip install -r requirements.txt
   ```

3. Settings live in `.env` (copy `.env.example`; it holds passwords, never commit it).
4. Start the site and open http://localhost:5000:

   ```bash
   py -3.12 app.py
   ```

   Admin panel: http://localhost:5000/admin.html · Doctor portal: http://localhost:5000/doctor.html

### Moving the old MySQL data

`scripts/migrate_mysql_to_mongo.py` reads a MySQL export (`hospital_db.sql`) and copies admins,
patients, doctors, appointments, medicines, orders, SOS alerts, ambulance requests and the mail log
into MongoDB, keeping ids and passwords (old logins keep working). Add `--replace` to overwrite.

```bash
py -3.12 scripts/migrate_mysql_to_mongo.py
```

Appointment reminders (run hourly from Windows Task Scheduler, or from Admin > Notifications):

```bash
py -3.12 scripts/send_reminders.py
```

## What is where

| Part | Files |
| --- | --- |
| Flask app, settings, database | `app.py`, `backend/__init__.py`, `backend/config.py`, `backend/db.py` |
| API routes | `backend/routes/` — `auth`, `clinic` (doctors, appointments, health card, doctor portal), `admin`, `store`, `ai`, `emergency` (ambulance + SOS + drivers), `lab` |
| Lab tests and reference ranges | `backend/lab_catalog.py` |
| Road routes, address search, ambulance position | `backend/routing.py` |
| Patient pages | `index.html`, `lab.js`, `ambulance.js`, `features.js`, … |
| Admin pages | `admin.html`, `admin.js`, `admin-features.js`, `admin-lab.js` |

## Staff roles (Admin > Settings)

* Every staff member gets their own login (Settings > Staff users) and signs in on `admin.html`.
* A role lists the sections it may open (Appointments, Patients, Doctors, Ambulance, SOS, Lab,
  Lab catalogue, Medicine stock, Orders, Analytics, Notifications, Settings). Ready-made roles:
  Super Admin, Receptionist, Lab Technician, Pharmacist, Emergency Desk — change them or add your own.
* The server checks the role on every request, so a hidden section cannot be reached by URL either.
  A switched-off account loses access at once.
* Super Admin always has every section and cannot be deleted; there is always at least one active
  Super Admin, and nobody can switch off, delete or demote their own account.

## Laboratory

* 18 standard tests and 4 health packages with common adult reference ranges (male / female where
  they differ). Check them against your own analysers in Admin > Test Catalogue.
* Patients book with home sample collection (₹100, free above ₹999) or a lab visit, choose a slot and
  get fasting / preparation advice.
* Admin flow: Booked → Sample Collected → Processing → Report Ready. Calculated values (MCV, MCH,
  MCHC, LDL by Friedewald, VLDL, non-HDL, ratios, globulin, A/G, BUN, eAG) fill in automatically and
  every value is flagged High / Low / Abnormal for the patient's gender.
* The report can be printed / saved as PDF by the patient, is emailed as "ready", and doctors see it
  in the patient record (also by scanning the Health Card QR).

## Ambulance routes

* The hospital's fixed point is `HOSPITAL_LAT` / `HOSPITAL_LNG` (default: Cross Road B, MIDC,
  Andheri East, Mumbai 400096).
* The patient sets the pickup point by GPS, address search (OpenStreetMap Nominatim) or by tapping /
  dragging on the map. A road route (OSRM) is drawn from the hospital with distance and time
  (free-flow time × `ROUTE_TRAFFIC_FACTOR` for Mumbai traffic).
* After dispatch the patient follows the ambulance on the route. With the driver page open the
  position is live GPS; otherwise it is an estimate from the time since dispatch, and the page says so.
* The public OSRM and Nominatim servers are for light use. For a busy hospital run your own and set
  `OSRM_URL` / `NOMINATIM_URL`.

## Hosting (Render)

The `Dockerfile` runs the app with gunicorn. The hosted server cannot reach the MongoDB on your own
computer, so it needs an online database:

1. MongoDB Atlas (free M0 cluster) > **Database Access**: add a user with a password.
2. **Network Access**: add `0.0.0.0/0` (Render's IP addresses change).
3. **Connect > Drivers**: copy the `mongodb+srv://...` link and put the user's password in it.
4. Render > the service > **Environment**: `MONGO_URI` = that link, `MONGO_DB` = `hospital_db`,
   `SECRET_KEY` = any long random text, plus the other values from `.env.example`. Save (it redeploys).
5. Open `https://<your-site>/api/health` - it must say `"database": "connected"`. If not, its
   `detail` says why (wrong password, IP not allowed, typo in the link).
6. Copy this computer's data (admins, roles, doctors, patients, lab tests ...) to Atlas:

   ```bash
   py -3.12 scripts/copy_database.py
   ```

Uploaded photos are kept on the container disk and are lost when Render rebuilds it.
