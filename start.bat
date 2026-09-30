@echo off
rem ============================================================
rem  Cow Meadow - bat server game + ngrok (choi qua Internet)
rem  - Neu co file ngrok-domain.txt (vd: ten-cua-ban.ngrok-free.app)
rem    thi dung domain co dinh do, link se khong doi.
rem ============================================================
cd /d "%~dp0"
title Cow Meadow

where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua cai Node.js. Tai tai: https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Dang cai thu vien lan dau...
  call npm install --omit=dev
)

echo Dang bat server game...
rem .env (neu co) chua MONGODB_URI de luu tai khoan len MongoDB
start "Cow Meadow - Server" cmd /k node --env-file-if-exists=.env server.js
timeout /t 2 /nobreak >nul

where ngrok >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Chua cai ngrok - chi choi duoc trong mang LAN.
  echo     Cai ngrok:  winget install ngrok.ngrok
  echo     Gan token:  ngrok config add-authtoken ^<TOKEN^>
  echo     Roi chay lai start.bat
  echo.
  start "" http://localhost:5173
  pause
  exit /b 0
)

start "" http://localhost:5173

set "DOMAIN="
if exist ngrok-domain.txt set /p DOMAIN=<ngrok-domain.txt

echo.
echo Dang mo tunnel ngrok... (dong cua so nay de tat choi qua Internet)
echo Link cong khai se hien o dong "Forwarding" va trong nut "Moi ban" trong game.
echo.
if defined DOMAIN (
  ngrok http 5173 --url=%DOMAIN%
) else (
  ngrok http 5173
)
pause
