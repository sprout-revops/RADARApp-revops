@echo off
:: Channels Dashboard ? Auto Refresh & Push
:: Schedule this with Windows Task Scheduler to run 3x daily

cd /d "C:\Users\LUrbina\Desktop\Desktop Files\AI\Channels Dashboard"

echo [%DATE% %TIME%] Starting data refresh...

:: Run the fetch script
python fetch_data.py
if errorlevel 1 (
    echo [%DATE% %TIME%] ERROR: fetch_data.py failed
    exit /b 1
)

:: Commit and push the updated JSON
git add data/dashboard.json
git diff --staged --quiet && (
    echo [%DATE% %TIME%] No changes to push
    exit /b 0
)

git commit -m "chore: refresh dashboard data [%DATE%]"
git push origin master

echo [%DATE% %TIME%] Done - dashboard data updated
