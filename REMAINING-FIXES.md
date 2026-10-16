# Remaining fixes (this pass)

## 1. Excel upload robustness
- Dry-run before Mongo commit: parse → mapping report → user confirms.
- `analyzeUploadMapping()` reports confidence, detected columns, warnings (#N/A, Defaulter, missing PRN).
- Header auto-detection retained; messy cells normalized to empty.
- Empty state: “No data uploaded yet.”

## 2. Admin UIs
- **Announcements** `/admin/announcements` — create / deactivate (Mongo).
- **Timetable** `/admin/timetable` — edit grid / clear; empty = “No timetable uploaded”.
- **TG Assignment** `/admin/tg-assign` — explicit mapping + auto-distribute (uses portal config, no hardcoded batch).
- **PortalConfig** on `/admin/settings` — feedback gate, UT pass, At-Risk/Good cut-offs, TG batch size.

## 3. Scalability & concurrency
- Feedback list already paginated.
- Cohort GET accepts `limit` (default/max 5000) and returns `total`.
- Intelligence state: monotonic `version`; PUT with `expectedVersion` → 409 on conflict (last-write-wins with client awareness).
- Rate limiter remains **process-local** (documented; no Redis claimed).

## 4. UI clarity
- Student AI Insights and Students list label **Current Academic Status** vs **Predicted Status (Early-Warning)**.
- ML down → explicit error source / Model Health page shows service health + metrics.
- Empty states for timetable, announcements, uploads.

## 5. Hardening
- Message body/subject/PRN length limits; roster field length limits.
- DEMO_CREDS emptied in production builds; `/api/auth/status` does not expose default password in production.
- `/api/mock` and nlp-test remain production-restricted; student/feedback endpoints stay auth-protected.

## End-to-end test checklist (university team)

1. **Seed & login** — EMP001, TG001, create student via upload.
2. **Upload Excel** — dry-run shows mapping; fix if confidence low; Commit to MongoDB.
3. **Student login** — dashboard shows Current Academic Status; announcements (or “No announcements yet”); timetable empty message or grid.
4. **HoD thresholds** — Settings → change feedback gate → student below gate blocked.
5. **TG assignment** — explicit map students; TG001 only sees mentees; auto-distribute works.
6. **Feedback** — eligible student submits; admin Feedback list pages.
7. **Parent message** — TG sends (or dry-run); length limits enforced.
8. **Intelligence** — two TGs edit interventions; second concurrent save with stale version gets conflict handling.
9. **ML** — stop ML service → Model Health shows unavailable; AI Insights uses rule fallback with clear label.
10. **Production gates** — NODE_ENV=production: no mock data, no nlp-test, CORS fail-closed without CORS_ORIGINS, no DEMO passwords in UI.

## Final residual fixes (privacy & conflict pass)

1. **TG privacy** — `GET /api/students/:id` allows a Teacher Guide only when an explicit `TgAssignment` matches their `tgIndex`, or (if no assignment row) the student’s `teacherGuideIndex` is set and matches. Unassigned students (`teacherGuideIndex == null`, no assignment) → **403**.
2. **Intelligence conflicts** — `saveRemoteState` 409 → user message “This data was updated by someone else. Reloading the latest version.” + `hydrateIntelligence` via `bvu:intelligence-reload`.
3. **`GET /api/cohort/sample`** — requires `requireAuth`.
4. **Client passwords** — offline `login()` disabled in production builds; LoginForm hides demo credentials and does not prefill passwords in prod; student login subtitle no longer prints a default password.
5. **DEPLOYMENT.md** — MongoDB `mongodump` backup note added.
