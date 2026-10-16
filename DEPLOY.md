# BVU Portal — real-world deployment

Parents use their own mobile data or home Wi‑Fi. They do not need college Wi‑Fi or your PC.

## Architecture

1. Public HTTPS **backend API**
2. Public HTTPS **website** (HOD / Admin / students)
3. **MongoDB Atlas** (cloud)
4. **ML service** on the same host or private network
5. **Parent APK** → public API + Expo/FCM push (global)

## Backend

- Bind `0.0.0.0` (already set)
- `.env`: `MONGODB_URI`, strong `JWT_SECRET`, `PARENT_DEFAULT_PASSWORD`, `CORS_ORIGINS=https://your-frontend`
- TLS via Nginx/Caddy or platform HTTPS
- Example API: `https://api.yourcollege.edu`

## Frontend

```bash
cd frontend && npm run build
```

Host `dist/` on HTTPS.

## Parent APK

Set in `parent-app/app.json`:

```json
"apiBaseUrl": "https://api.yourcollege.edu"
```

Then:

```bash
cd parent-app
eas build -p android --profile preview
```

Alternatively, parents/IT open **Server settings** on the login screen and enter the HTTPS API once (saved on the device).

## Push

FCM V1 on Expo credentials must remain configured. HOD → Parent bot → push works on any network after the parent registers the token.
