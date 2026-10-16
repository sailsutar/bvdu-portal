# High Level Design (HLD) — Academic & Placement Portal

## 1. Purpose

College academic operations portal: upload marks/attendance, early-warning risk, Teacher Guide mentoring, parent messaging, placement profiles, and longitudinal student journeys (First Year → Last Year under one Permanent Registration Number).

## 2. Context diagram

```text
                    ┌─────────────────────────────────────┐
                    │     Users (Browser / Mobile)          │
                    │  Student · HOD · TG · Placement · SA  │
                    └──────────────────┬──────────────────┘
                                       │ HTTPS
                                       ▼
                    ┌─────────────────────────────────────┐
                    │  Presentation: React (Vite)           │
                    │  Role-based portals, year/batch UI    │
                    └──────────────────┬──────────────────┘
                                       │ REST JSON (/api)
                                       ▼
                    ┌─────────────────────────────────────┐
                    │  Application: Express (Node.js)       │
                    │  Auth · Cohort · Placement · Agents   │
                    │  Messaging · Intelligence · Audit     │
                    └─────────┬───────────────────┬───────┘
                              │                   │
               MongoDB Atlas  │                   │  HTTP
                              ▼                   ▼
                    ┌──────────────────┐  ┌──────────────────┐
                    │  Persistence     │  │  ML Service        │
                    │  Users, cohort,  │  │  FastAPI           │
                    │  placement,      │  │  RF early-warning  │
                    │  feedback, audit │  │  SHAP · TADE       │
                    └──────────────────┘  └──────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  External notify │
                    │  Brevo · Twilio  │
                    └──────────────────┘
```

## 3. Quality attributes

| Attribute | Approach |
|-----------|----------|
| Scalability | Stateless JWT API; MongoDB Atlas; ML process isolated; batch messaging with concurrency limits |
| Maintainability | Clear modules (`cohort-routes`, `placement-routes`, `year-cohort`, `ml-service`) |
| Security | Role middleware, password hashing on seed users, CORS allowlist in production, rate limits on messaging |
| Reliability | Graceful ML fallback where designed; audit log; dry-run promote |
| Longitudinal integrity | PRN stable; `admissionYear` / `cohortId` fixed at intake; `yearLevel` promoted annually |

## 4. Logical layers

1. **UI** — React routes per role; TanStack Query for cached predictions where used.  
2. **API** — Express routers; JWT auth; business rules.  
3. **Domain services** — Year/cohort rules, readiness, TADE orchestration, feedback NLP.  
4. **Data** — MongoDB collections (see LLD).  
5. **Intelligence** — FastAPI models (per-year RF + placement TADE).  

## 5. Key use cases (system level)

1. HOD uploads VMedulife attendance / marks Excel → cohort upsert by PRN.  
2. Annual **promote-year** FY→SY→TY→LY (same PRN).  
3. New admission year → new PRNs, new `admissionYear`.  
4. Early-warning predict/explain for current stage.  
5. Student placement profile → TADE domain set + readiness.  
6. Placement head batch TADE + shortlist export.  
7. Approved bulk parent notify (email / SMS / WhatsApp).  

## 6. Deployment view

```text
[CDN / static host] Frontend build (dist)
        │
[App host / VM]     Backend :4000  +  ML :8001
        │
[MongoDB Atlas]     Managed cluster
```

CI builds frontend and validates backend syntax; CD is environment-specific (see `docs/CICD.md`).

## 7. Out of scope (current)

- Institutional SSO (can replace demo login later)  
- Real-time websocket collaboration  
- Multi-tenant SaaS billing  
