# Inventory Field App

Warehouse and jobsite asset tracking with tag scanning, two-party chain of
custody, step photos, and offline support.

- **Backend:** Django + Django REST Framework + JWT (`backend/`)
- **Frontend:** React PWA (Vite + vite-plugin-pwa), offline outbox via Dexie/IndexedDB (`frontend/`)
- **Deploy:** Render blueprint (`render.yaml`) provisions the API, a Postgres DB, and the static PWA

## What it does

Assets move through a state machine backed by an append-only transaction
ledger (the audit trail / chain of custody):

```
available → assigned → checked_out → returned_pending → available
```

Each transition records who, when, GPS, an optional photo (hashed for
tamper-evidence), and the counterparty for two-party handoffs. Manager-only
actions (accept return, send to maintenance, mark lost) are role-gated.

## Scanning: read this first

- **NFC tap works on Chrome for Android only**, over HTTPS. iOS Safari and
  Chrome-on-iOS cannot read NFC from the web, at all.
- The **QR/barcode scanner works everywhere** (Android + iPhone) using the
  camera. On iPhones this is the entire scan path, which is why every physical
  label should carry both an NFC chip and a printed QR/barcode (a "combo tag").
- There is also a manual tag-ID entry fallback.

## Local development

Backend:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # optional; defaults work
python manage.py migrate
python manage.py createsuperuser   # your manager login (is_staff = manager)
python manage.py runserver         # http://localhost:8000  (admin at /admin)
```

Frontend (in a second terminal):

```bash
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

The dev PWA points at `http://localhost:8000` by default. To test NFC/camera on
a real phone you need HTTPS, so the easiest path is to deploy to Render (below)
and test against the live URL.

## Deploy to Render

1. Push this repo to GitHub/GitLab.
2. In Render: **New + → Blueprint**, select the repo. `render.yaml` provisions:
   - `inventory-db` (Postgres)
   - `inventory-api` (Django, auto-migrates on deploy)
   - `inventory-pwa` (the built React app)
3. After the first deploy, wire the two URLs together:
   - On **inventory-pwa**, set `VITE_API_BASE` to the API URL
     (e.g. `https://inventory-api.onrender.com`), then redeploy it.
   - On **inventory-api**, set `FRONTEND_ORIGINS` to the PWA URL
     (e.g. `https://inventory-pwa.onrender.com`).
4. Create your first manager account (shell on the API service):
   `python manage.py createsuperuser`
5. Open the PWA URL on your Android phone in Chrome, install it to the home
   screen, and scan.

### Important: photo storage on Render

Render's default filesystem is **ephemeral**, so uploaded step photos are lost
on redeploy. Before real use, either attach a **Render persistent disk** mounted
at the `MEDIA_ROOT` path, or switch to S3/Cloudinary via `django-storages`.
See the note in `backend/config/settings.py`.

## First data

In `/admin`: create an Asset (give it a `code` like `TOOL-001`), then add a
`Tag` with the NFC UID or the value encoded in its QR. The `uid` is what the
scanner looks up. Managers are users with `is_staff` on, or in a `Managers`
group.

## API quick reference

- `POST /api/auth/token/` → `{access, refresh}`
- `GET  /api/auth/me/` → current user + `is_manager`
- `GET  /api/assets/` , `GET /api/assets/{id}/`
- `GET  /api/assets/by-tag/{uid}/` → resolve a scanned tag to its asset
- `GET  /api/assets/{id}/history/` → the transaction ledger
- `POST /api/assets/{id}/transition/` → multipart: `action`, optional `photo`,
  `counterparty`, `job_ref`, `note`, `latitude`, `longitude`, `client_uuid`
- `GET  /api/users/` → for the assign-to picker
