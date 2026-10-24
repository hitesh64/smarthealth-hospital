"""Start the SmartHealth Hospital website:

    python app.py            -> http://localhost:5000

Needs MongoDB running (MONGO_URI in .env, default mongodb://localhost:27017/) and the packages in
requirements.txt (pip install -r requirements.txt).
"""
import os

from backend import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    if os.environ.get("FLASK_DEBUG") == "1":
        app.run(host="0.0.0.0", port=port, debug=True)
    else:
        from waitress import serve
        print(f"SmartHealth running on http://localhost:{port}  (press Ctrl+C to stop)")
        serve(app, host="0.0.0.0", port=port, threads=16)
