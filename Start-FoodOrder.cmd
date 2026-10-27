@echo off
cd /d "%~dp0"
where dotnet >nul 2>&1
if errorlevel 1 (
  echo .NET 10 SDK is required. Install it, then run this file again.
  pause
  exit /b 1
)
echo Starting Crave at http://localhost:5000
echo Keep this window open while using the app. Press Ctrl+C to stop it.
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Open-FoodOrder.ps1"
dotnet run --urls http://localhost:5000
pause
