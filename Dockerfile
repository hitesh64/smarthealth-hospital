# Image for hosting SmartHealth on Render (or any Docker host): Python 3.12 + Flask + gunicorn.
# MongoDB is external (e.g. MongoDB Atlas); its address comes from MONGO_URI (see .env.example).
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# doctor and medicine photos are written here
RUN mkdir -p uploads/medicines

# Render tells the container which port to listen on through $PORT
CMD ["sh", "-c", "gunicorn --workers 2 --threads 8 --timeout 90 --bind 0.0.0.0:${PORT:-5000} app:app"]
