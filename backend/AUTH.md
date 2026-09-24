# Authentication and authorization

## Database
MongoDB via Mongoose. Connection string: `MONGODB_URI` (default `mongodb://127.0.0.1:27017/bvu_portal`).

Collections: `users`, `sessions`, `feedbacks`, `messagelogs`, `auditlogs`.

## Login rules
| Role | Identifier | Default password |
|------|------------|------------------|
| Student | Permanent Registration Number | `abc@123` |
| Head of Department | `EMP001` | `admin123` |
| Teacher Guide | `TG001` / `TG002` / `TG003` | `tg123` |

Students unknown to the database who use password `abc@123` are **auto-registered** on first login.

## Middleware
- `requireAuth` — any valid Bearer token
- `requireAdmin` — Head of Department only
- `requireTeacherGuide` — Teacher Guide or Head of Department
- `requireStudent` — student only
- `optionalAuth` — attaches user if token present

Protected examples: `GET /api/me`, `POST /api/auth/sync-students` (admin), `POST /api/messages/send` (Teacher Guide or admin).

## Start MongoDB
```bash
# Docker
docker run -d --name bvu-mongo -p 27017:27017 mongo:7

# Then
cd backend && npm install && npm run seed && npm run dev
```
