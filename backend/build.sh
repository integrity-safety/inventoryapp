#!/usr/bin/env bash
# Render build step for the backend.
set -o errexit

pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate

# Optionally create the first manager account from env vars. This is how you
# bootstrap a login on Render's free tier, where the Shell tab is unavailable.
# Set DJANGO_SUPERUSER_USERNAME / _PASSWORD / _EMAIL in the service's env.
# The "|| true" keeps redeploys from failing once the user already exists.
if [ -n "$DJANGO_SUPERUSER_USERNAME" ]; then
  python manage.py createsuperuser --noinput || true
fi
