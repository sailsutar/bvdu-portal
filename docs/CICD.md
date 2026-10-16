# Continuous Integration & Delivery (CI/CD)

## Goals

1. **CI:** Every push/PR proves the frontend builds and backend/ML packages are installable.  
2. **CD:** Manual or tag-based deploy to a host (college VM / Render / Railway) — not forced on every commit.

## GitHub Actions

Workflow file: `.github/workflows/ci.yml`

Jobs:

| Job | Steps |
|-----|--------|
| `frontend` | Node 20 → `npm ci` in `frontend` → `npm run build` |
| `backend` | Node 20 → `npm ci` in `backend` → syntax check `node --check server.js` |
| `ml-service` | Python 3.11 → pip install requirements (core, no heavy torch if skipped) → import check |

## Local CI parity

From repo `starter/`:

```bash
npm run ci
```

(Defined in root `package.json` — runs frontend build + backend check.)

## Environments

| Env | MongoDB | ML | Notes |
|-----|---------|-----|--------|
| Development | Atlas or local | localhost:8001 | `npm run dev` |
| Staging | Atlas staging DB | container or process | Same images as prod |
| Production | Atlas prod DB | process manager | `CORS_ORIGINS` required |

## Secrets (CD)

Store in host or GitHub Environments — **never commit**:

- `MONGODB_URI`
- `JWT_SECRET`
- `BREVO_API_KEY` / Twilio keys
- `ML_SERVICE_URL` (internal URL in prod)

## Suggested CD path (manual)

1. CI green on `main`  
2. SSH/VM: `git pull`  
3. `frontend`: `npm ci && npm run build` — serve `dist`  
4. `backend`: `npm ci --omit=dev && npm start` (pm2/systemd)  
5. `ml-service`: venv + `uvicorn serve:app`  
6. Health: backend `/api/placement/system-health` or ML `/health`  

## Optional containers

See `deploy/Dockerfile.backend` and `deploy/Dockerfile.ml` for process isolation. Compose file is optional for lab demos only.
