# Run BVU Portal with Docker (any machine)

## Requirements

- Docker Desktop (Windows/Mac) or Docker Engine (Linux)
- MongoDB Atlas URI in `backend/.env` (recommended)

## 1. Env file

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
MONGODB_URI=mongodb+srv://USER:PASS@CLUSTER.mongodb.net/bvu_portal?retryWrites=true&w=majority
JWT_SECRET=long-random-string
PARENT_DEFAULT_PASSWORD=parent123
ML_SERVICE_URL=http://ml:8001
```

(`ML_SERVICE_URL` is overridden to `http://ml:8001` by docker-compose.)

## 2. Start everything

From `starter/`:

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| Website | http://localhost:8080 |
| Backend API | http://localhost:4000 |
| ML | http://localhost:8001 |

## 3. Other devices on the same network

1. Find host IP (`ipconfig` / `ifconfig`)
2. Website: `http://HOST_IP:8080`
3. Parent APK Server settings / apiBaseUrl: `http://HOST_IP:4000`

## 4. Production (any network)

- Put HTTPS reverse proxy (Caddy/Nginx) in front of ports 8080/4000
- Or deploy the same images on Render/Railway/VPS
- Parent APK: `apiBaseUrl=https://your-api-domain`

## 5. Stop

```bash
docker compose down
```

## Services

| Container | Image source |
|-----------|----------------|
| bvu-backend | `deploy/Dockerfile.backend` |
| bvu-ml | `deploy/Dockerfile.ml` |
| bvu-frontend | `deploy/Dockerfile.frontend` + nginx |

Parent mobile app is **not** inside Docker — build APK with EAS and point it at the API URL.
