# Low Level Design (LLD) — Academic & Placement Portal

## 1. Backend modules

| Module | Responsibility |
|--------|----------------|
| `server.js` | HTTP server, middleware, route registration |
| `src/auth.js` | JWT issue/verify, role guards |
| `src/db.js` | Mongoose models, connect, audit helper |
| `src/year-cohort.js` | Year normalize, promote plan, year-lock mask, cohort id |
| `src/cohort-routes.js` | Academic upsert, promote-year, longitudinal stats, portal config |
| `src/placement-routes.js` | Profiles, TADE proxy, batch score, drive match |
| `src/placement-topics.js` | Topic strengths from subject names |
| `src/portal-routes.js` | Shared portal APIs |
| `src/parent-bot.js` | Parent WhatsApp-style query simulation |
| `src/feedback-nlp.js` | Local sentiment / summary |
| `src/admin-master-routes.js` | System admin roster & contacts |

## 2. Identity & longitudinal rules

```text
PRN ──────────────────────── permanent key
admissionYear / cohortId ─── set once at first upload (intake)
yearLevel ────────────────── FY | SY | TY | LY (moves on promote)
yearHistory[] ────────────── audit of stage changes
```

**Promote:** only one step (`FY→SY`, `SY→TY`, `TY→LY`). Dry-run supported.

**Year-lock (ML/TADE):** payload must not include CGPA/stage fields beyond current `yearLevel`.

## 3. Core collections (MongoDB)

| Collection | Key fields |
|------------|------------|
| `users` | id, role, password hash |
| `academicrecords` | prn, yearLevel, admissionYear, cohortId, marks, attendance, batch |
| `placementprofiles` | prn, skills, readiness, tade*, status |
| `studentbackgrounds` | prn, 10th/12th/CET/JEE, contacts |
| `intelligence states` | agent queues, interventions keys |
| `feedback` | year/batch scoped remarks |
| `audits` | actor, action, detail |

## 4. Auth flow

```text
POST /api/login { id, password, role? }
  → verify user → JWT (sub, role, name, exp)
  → client stores token → Authorization: Bearer …
Middleware: requireAuth → requireAdmin | requireStudent | requirePlacementStaff | …
```

## 5. Academic upload sequence

```text
Client parse Excel → POST /api/cohort/sync { students[], academicYearStart? }
  For each student:
    if new PRN → admissionYear, cohortId, yearHistory[first]
    if existing → merge marks/attendance; keep admissionYear
  ensureStudentAccounts(PRNs)
```

## 6. Early-warning ML

- **Service:** `ml-service/serve.py`  
- **Features:** early UT + attendance columns only (see `FEATURE_COLS`)  
- **Endpoints:** `POST /predict`, `POST /predict/batch`, `POST /explain`  
- **Backend proxy:** `/api/ml/*`  
- **Frontend:** `lib/ml-predict.js` (no silent rule status when model-only mode is enabled)

## 7. TADE (placement)

- **Train:** `train_placement_tade.py` → `models/placement/tade_bundle.joblib`  
- **Infer:** `POST /placement/tade/predict`, gap-plan, health  
- **On student profile save:** backend runs TADE, stores domain set + readiness blend  
- **Batch:** `POST /api/placement/tade/batch`

## 8. Messaging

- Env: `BREVO_*`, `TWILIO_*`, `MESSAGE_RATE_MAX`, batch concurrency  
- Agents propose recipients → staff approve → send  
- Placement filter: low readiness / academic risk targets API  

## 9. API map (selected)

| Method | Path | Role |
|--------|------|------|
| POST | `/api/login` | public |
| POST | `/api/cohort/sync` | admin |
| POST | `/api/cohort/promote-year` | admin |
| GET | `/api/cohort/longitudinal` | admin |
| GET/PUT | `/api/placement/me` | student |
| POST | `/api/placement/tade/batch` | placement staff |
| GET | `/api/placement/system-health` | placement staff |
| POST | `/api/ml/predict/batch` | authenticated |

## 10. Frontend structure

- `routes/login.*.jsx` — role entry  
- `routes/admin.*` — HOD  
- `routes/student.*` — student  
- `routes/placement-*` — coordinator / head  
- `lib/upload-stats.js`, `year-batch`, `ml-predict`, `api.js`  

## 11. Error & resilience

- Mongo connect retries / timeouts for weak networks  
- ML down: documented behaviour (loading / error; avoid fake “Good” from rules when disabled)  
- Promote dry-run before destructive year move  
