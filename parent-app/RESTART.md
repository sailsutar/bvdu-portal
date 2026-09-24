# Clean restart (website + parent app)

## 1. Website
```powershell
cd starter\backend
npm install
# ensure .env has MONGODB_URI and PARENT_DEFAULT_PASSWORD=parent123

cd ..\frontend
npm install

cd ..\ml-service
python -m pip install -r requirements.txt

cd ..
npm run dev
```
Browser: http://localhost:5173  
Admin → academic upload + Contact details (your phone on a PRN).

## 2. Parent app
```powershell
cd starter\parent-app
# set app.json extra.apiBaseUrl to http://YOUR_PC_IP:4000

Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install
npx expo start -c
```
Expo Go → scan QR → login mobile + parent123  
Tap **Show demo notification** → in-app popup (guaranteed in Expo Go).

Remote lock-screen push only after APK build (not Expo Go).
