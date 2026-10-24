# Image for hosting SmartHealth on Render (or any Docker host): Python 3.12 + Flask + gunicorn,
# with MongoDB 8.0 inside the same container.
#
# * MONGO_URI not set, or pointing to localhost / 127.0.0.1  ->  MongoDB is started in this container
#   (data in /data/db - add a persistent disk at /data on Render, otherwise the data is lost
#   whenever the service restarts or is redeployed).
# * MONGO_URI pointing to another server (e.g. MongoDB Atlas)  ->  that database is used and the
#   built-in MongoDB is not started.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MONGO_DATA_DIR=/data/db

# MongoDB server from the official MongoDB repository for Debian 12 (bookworm)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && curl -fsSL https://pgp.mongodb.com/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg \
    && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/8.0 main" \
        > /etc/apt/sources.list.d/mongodb-org-8.0.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends mongodb-org-server \
    && apt-get purge -y gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# doctor and medicine photos are written here; the start script must have Unix line endings
RUN mkdir -p uploads/medicines /data/db && sed -i 's/\r$//' docker-start.sh

# Render tells the container which port to listen on through $PORT
CMD ["sh", "/app/docker-start.sh"]
