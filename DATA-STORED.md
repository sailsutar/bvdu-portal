# What the database stores (essential production data)

## MongoDB collections

| Collection | Purpose |
|------------|---------|
| **users** | Login accounts: students, Head of Department, Teacher Guides. Fields: id (PRN or employee id), role, password hash, name, email, phone, className, attendance, teacherGuideIndex |
| **sessions** | Active login tokens (for logout and expiry) |
| **feedbacks** | Student feedback with yearLevel, programme, batch, className, displayGroup, course, text, sentiment |
| **assignments** | Published assignments |
| **submissions** | Student assignment submissions |
| **notifications** | Per-user notifications |
| **usersettings** | Notification preferences |
| **messagelogs** | Parent message send log |
| **auditlogs** | Who changed what (login, roster update, sync, config) |
| **academicrecords** | Full cohort with marks, attendance, subjects (source of truth after Excel upload) |
| **intelligencestates** | Shared key-value intelligence: interventions, agent drafts, OBE maps, drift snapshots, peer pairs, curriculum graph, coaching notes, MLOps registry |
| **portalconfigs** | Admin-configurable thresholds: feedback attendance gate, UT pass mark, At-Risk / Good cut-offs, TG batch size, auto-distribute flag |
| **announcements** | Admin-managed student dashboard announcements |
| **timetables** | Admin-uploaded timetable slots |
| **tgassignments** | Explicit student → Teacher Guide assignments (preferred over auto-split) |

## Updated from the website

1. **Upload Academic Data** (Head of Department) → creates/updates AcademicRecord + student users + attendance + class
2. **Student first login** → creates student user if missing
3. **Settings → change password** → updates password hash
4. **PATCH /api/students/:id/roster** → Head of Department can update attendance/class/name in MongoDB
5. **Feedback submit** → stored only in MongoDB (paginated list API)
6. **Assignments** → create + submit
7. **Intelligence modules** → all state persisted via `/api/intelligence/:key` (Mongo-first; localStorage is offline cache only)
8. **Portal config / TG assignments / announcements / timetable** → admin APIs → MongoDB

## Browser-side only

- Transient UI cache (`bvu.remote.*` localStorage mirrors) — **always overwritten** when the authenticated client loads state from MongoDB.
- No demo/mock student records are used in production builds.

## Concurrent safety

- Intelligence and config writes go through MongoDB upserts; multiple Teacher Guides and the HoD can work concurrently.
- TG mentee lists prefer **explicit** `tgassignments` documents; optional auto-distribution is an admin action.
