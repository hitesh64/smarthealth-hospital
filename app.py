"""Start the SmartHealth Hospital website:

    python app.py            -> http://127.0.0.1:5000      (or: npm start)

Needs MongoDB running (MONGO_URI in .env, default mongodb://localhost:27017/) and the packages in
requirements.txt (pip install -r requirements.txt).

HOST and PORT can be changed in .env. HOST=0.0.0.0 lets other devices on the same Wi-Fi (e.g. a
driver's phone) open the site at http://<this-computer's-IP>:5000.
"""
import os

from backend import create_app

app = create_app()

if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", 5000))
    shown = "127.0.0.1" if host in ("0.0.0.0", "") else host
    if os.environ.get("FLASK_DEBUG") == "1":
        app.run(host=host, port=port, debug=True)
    else:
        from waitress import serve
        print(f"SmartHealth running on http://{shown}:{port}  (press Ctrl+C to stop)")
        serve(app, host=host, port=port, threads=16)
