# What was fixed (production readiness)

## 1. Data persistence (Mongo-first)
- Intelligence state already flowed through `/api/intelligence/:key` → `IntelligenceState`; localStorage is mirror-only.
- New collections: `portalconfigs`, `announcements`, `timetables`, `tgassignments`.
- Feedback is Mongo-only (in-memory array removed).
- `DATA-STORED.md` updated.

## 2. Privacy & security
- `GET /api/students/:id` requires auth; student=self; TG=assigned; admin=all.
- `GET /api/feedback` requires auth (non-student).
- `/api/feedback/nlp-test` admin-only, blocked in production.
- `/api/mock` empty/404 in production.
- CORS fails closed when `CORS_ORIGINS` empty in production.
- Rate limiter uses `X-Forwarded-For`; documents process-local limitation.

## 3. Broken endpoints
- `/api/feedback/summary` queries MongoDB.
- Dead in-memory feedbacks removed.

## 4. Teacher Guide assignment
- Removed hardcoded BATCH_SIZE/TG_COUNT.
- Dynamic assignment via explicit map, teacherGuideIndex, or configurable auto-split.
- Admin APIs for explicit + auto assignment.

## 5. Academic status
- Single source: `frontend/src/lib/academic-status.js` used by upload-stats and ml-predict.

## 6. Demo data
- mock-data.js production-safe empties; announcements/timetable from Mongo APIs.

## 7. Configurable thresholds
- PortalConfig in Mongo; feedback gate and status cut-offs admin-editable.

## 8–10. Other
- Feedback pagination; no localhost API fallbacks; input length limits; docs updated.

## Test checklist
1. Login EMP001 / TG001 / student after seed.
2. Upload Excel → AcademicRecord + accounts.
3. Portal config → feedback gate.
4. TG assign → mentee isolation.
5. Intelligence save visible across users.
6. Announcements + empty timetable message.
7. Feedback pagination.
8. Production CORS fail-closed.
9. mock/nlp-test blocked in production.
10. Early-warning vs Current Academic Status labels.
