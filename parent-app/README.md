# BVU Parent App — full demo

Expo React Native app: attendance, marks, placement, notices, and device notifications.

## 1. Backend

```bash
cd starter
npm run dev
```

Ensure:

- Academic data committed
- Parent mobile saved under **Contact details** for at least one PRN
- User role `parent` is allowed (included in this build)

## 2. Parent app

```bash
cd starter/parent-app
npm install
```

Set API URL in `app.json` → `extra.apiBaseUrl`:

| Device | apiBaseUrl |
|--------|------------|
| Expo web / some simulators | `http://127.0.0.1:4000` |
| Android emulator | `http://10.0.2.2:4000` |
| Physical phone | `http://YOUR_PC_LAN_IP:4000` |

```bash
npx expo start
```

Install **Expo Go** → scan QR.

## 3. Login

- Mobile: number from Contact details  
- Password: `parent123`

On login the app requests notification permission and registers an Expo push token.

## 4. Demo flow to show someone

1. Sign in → welcome notification  
2. **My children** → open a student  
3. See attendance, marks, placement  
4. If attendance &lt; 75% → automatic alert notification  
5. Tap **Show demo notification** on home  
6. **Notices** tab for college announcements  
7. Optional staff push:  
   `POST /api/parent/demo-notify` with HOD/admin token  
   `{ "title": "PTM reminder", "body": "Meeting on Monday 10 AM" }`

## 5. What works offline-of-Twilio

| Feature | Works |
|---------|--------|
| Live data from MongoDB | Yes |
| Local notifications (device banner) | Yes |
| Expo push to phone (after token register) | Yes (Expo free push service) |
| Twilio WhatsApp | Not required |

## Login (web still available)

`http://localhost:5173/login/parent`
