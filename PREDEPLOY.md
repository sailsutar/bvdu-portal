# Pre-deploy checklist (fixed for production)

## Required env (backend)

- [ ] `MONGODB_URI` — Atlas with `bvu_portal` in path
- [ ] `JWT_SECRET` — long random string
- [ ] `CORS_ORIGINS` — `*` for pilot, or your Vercel URL
- [ ] `PARENT_DEFAULT_PASSWORD`
- [ ] `ML_SERVICE_URL` — `http://ml:8001` in Docker, or public ML URL

## Atlas

- [ ] Network Access allows your server IP (or `0.0.0.0/0` for pilot)

## Parent APK

- [ ] `apiBaseUrl` = **HTTPS public API** (not `192.168.x.x` for real parents)
- [ ] FCM V1 key on Expo credentials
- [ ] Rebuild APK after URL change

## Verify after deploy

```bash
curl https://YOUR_API/api/health
```

Website login → upload academic data → parent app login → HOD push.

## Known non-blockers

- Transformer NLP enabled in Docker ML image (first call downloads model; local NLP still fallback)
- FY has dedicated pipeline files (retrain with FY Excel for best calibration)
- Free Render sleep → first request slow
