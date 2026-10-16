# Portal upgrades (consolidated)

## Data / UT-3
- Unit tests: UT-1, UT-2, UT-3; mean uses only filled UTs (blanks ignored).
- Combine attendance + marks: college CLASS/DIVISION sheets + VMedulife attendance.
- Faculty Incharge names carried into combined export and teacher performance.

## Attendance
- VMedulife HTML `.xls` and real `.xlsx` attendance grids.
- Year/batch from group labels (FY/SY/TY/Final Year → LY).

## ML
- Early-warning features use mean of available UTs (including UT-3).
- Optional `POST /sentiment` transformer on ML service; hybrid with local NLP.

## Feedback NLP
- `backend/src/feedback-nlp.js` — local domain NLP (good/average/bad, themes, extractive summary).
- Hybrid: transformer when ML is up, else local. No Lovable API.

## Frontend stability
- `api()` returns parsed JSON.
- `getCachedCohort`, `downloadTextFile`, `toCsv` exports restored.
- Cohort localStorage cache for weak networks.

## Messaging
- Bulk send ready via Brevo/Twilio when keys set in `.env` (live, not dry-run by default in production config).

## Longitudinal cohorts (2026-09)
- admissionYear + cohortId on AcademicRecord / PlacementProfile
- POST /api/cohort/promote-year (FY→SY→TY→LY, same PRN)
- GET /api/cohort/longitudinal
- Year-lock on TADE payload
- HOD Settings: promote + cohort table

## System design package
- docs/HLD.md LLD.md CICD.md SYSTEM-DESIGN.md
- .github/workflows/ci.yml
- deploy/Dockerfiles + compose example
- npm run ci
