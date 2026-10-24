#!/bin/sh
# Starts the website in the Docker container. When MONGO_URI is empty or points to this machine
# (mongodb://localhost:27017/), MongoDB is started here first; any other MONGO_URI (Atlas) is used as it is.
set -e

URI="${MONGO_URI:-mongodb://localhost:27017/}"
case "$URI" in
    *localhost*|*127.0.0.1*)
        mkdir -p "$MONGO_DATA_DIR"
        echo "[start] MONGO_URI is local: starting MongoDB in this container (data in $MONGO_DATA_DIR)"
        # a small cache keeps MongoDB + the website inside a 512 MB server; --fork returns once it accepts connections
        mongod --dbpath "$MONGO_DATA_DIR" --bind_ip 127.0.0.1 --port 27017 \
               --wiredTigerCacheSizeGB 0.25 --quiet --fork --logpath /tmp/mongod.log \
            || { echo "[start] MongoDB did not start:"; tail -n 40 /tmp/mongod.log; exit 1; }
        export MONGO_URI="mongodb://127.0.0.1:27017/"
        ;;
    *)
        echo "[start] using the external MongoDB from MONGO_URI"
        ;;
esac

exec gunicorn --workers "${WEB_WORKERS:-1}" --threads 12 --timeout 90 --bind "0.0.0.0:${PORT:-5000}" app:app
