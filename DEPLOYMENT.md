# Bharati Vidyapeeth University Portal — Deployment Guide

## Services

| Service | Default port | Purpose |
|---------|--------------|---------|
| Frontend (Vite / static build) | 5173 (dev) / 80 (prod) | User interface |
| Backend (Express) | 4000 | Auth, cohort, feedback, messaging, intelligence |
| Machine Learning service (FastAPI) | 8001 | Early-warning predict and explain |

## Environment

Copy `backend/.env.example` to `backend/.env` and set:

- `NODE_ENV=production` in production
- `CORS_ORIGINS` — **required in production**; comma-separated frontend origins. Empty value fails closed.
- `MONGODB_URI` — MongoDB connection string
- `BREVO_API_KEY` / `BREVO_FROM_EMAIL` — electronic mail
- `TWILIO_*` — text and WhatsApp
- `MESSAGE_RATE_MAX` — max parent messages per client IP per minute (default 30). Rate limiter is in-process; for multi-instance use sticky sessions or Redis.
- `ML_SERVICE_URL` — machine learning service base URL
- `LOVABLE_API_KEY` — optional LLM feedback analysis

Frontend: set `VITE_API_URL` to the public backend URL (empty = same-origin / reverse-proxy).

## Run (development)

From the `starter` folder (Windows):

```text
cd starter\backend
npm install
# ensure .env has MONGODB_URI
cd ..\frontend
npm install
cd ..\ml-service
python -m pip install -r requirements.txt
cd ..
npm run dev
```

Optional: `cd starter\backend` then `npm run seed` once.

Open http://localhost:5173

Linux / macOS equivalent: use `/` instead of `\` and `pip install -r requirements.txt` the same way; then `npm run dev` from `starter`.

## Production notes

1. Build frontend: `cd frontend && npm run build` — serve `dist` behind HTTPS.
2. Process-manage backend and ML service.
3. Reverse proxy with TLS; forward `X-Forwarded-For` for rate-limit keys.
4. Set `CORS_ORIGINS` to exact browser origin(s).
5. Replace demo login with institutional SSO before campus-wide rollout.
6. `/api/mock` and `/api/feedback/nlp-test` are disabled or restricted in production.

## Roles

- **Student** — own academics, feedback (attendance gate from portal config), AI insights
- **Teacher Guide** — assigned mentees (explicit or auto), interventions, parent messaging
- **Head of Department** — full administration, uploads, portal config, TG assignment, announcements, timetable

## Academic status

See `frontend/src/lib/academic-status.js` for the single shared rule set (Current Academic Status).
ML **Predicted Status (Early-Warning)** is separate and must not mix full-term signals.

## Backup

Before major Excel uploads, PortalConfig changes, or TG re-assignment, take a MongoDB backup:

```bash
# Replace URI / db name as needed
mongodump --uri="$MONGODB_URI" --out="/var/backups/bvu_portal_$(date +%Y%m%d_%H%M)"
```

Restore with `mongorestore --uri="$MONGODB_URI" /path/to/backup/bvu_portal` (or your database name). Keep at least one recent dump off the application server.


## Longitudinal year operations

1. **Promote** (HOD → Settings → Longitudinal cohorts): `POST /api/cohort/promote-year` with dry-run first.
2. Upload new year Excel for **existing PRNs** (marks/attendance merge).
3. Upload **new First Year** file → new PRNs receive new `admissionYear` / `cohortId`.
4. Re-run batch TADE / risk filters for the current `yearLevel`.

## Health checks

- ML: `GET http://127.0.0.1:8001/health`
- TADE: `GET http://127.0.0.1:8001/placement/tade/health`
- Placement staff: `GET /api/placement/system-health`
