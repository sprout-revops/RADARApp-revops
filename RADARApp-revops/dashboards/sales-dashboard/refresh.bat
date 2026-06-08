@echo off
echo ============================================
echo  Sales Dashboard — Data Refresh
echo ============================================
echo.

echo [1/3] Fetching data from Databricks...
python fetch_data.py
if errorlevel 1 (
    echo ERROR: fetch_data.py failed. Check your .env file and Databricks connection.
    pause
    exit /b 1
)

echo.
echo [2/3] Staging data file...
git add data/dashboard.json

echo [3/3] Committing and pushing to GitHub...
git commit -m "Data refresh %date% %time%"
git push origin master

echo.
echo ============================================
echo  Done! Dashboard will update in ~1 minute.
echo  https://sprout-revops.github.io/sales-dashboard/
echo ============================================
pause
