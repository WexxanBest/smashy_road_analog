@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js with npm, then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Installing project dependencies...
  call npm.cmd ci
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
echo Game: http://127.0.0.1:5180/
echo Press Ctrl+C to stop the server.
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5180 --strictPort
pause
