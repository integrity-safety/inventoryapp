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

# Optionally seed realistic demo data (tools, consumables, jobs, field users,
# spread across every state) so the dashboard looks like a real warehouse.
# Set SEED_DEMO=true in the service's env to turn it on. The command is
# idempotent: it seeds once and skips on later deploys, so leaving the var on is
# harmless. Remove the data later with `seed_demo --wipe` (needs shell access).
if [ "$SEED_DEMO" = "true" ]; then
  python manage.py seed_demo || true
fi
