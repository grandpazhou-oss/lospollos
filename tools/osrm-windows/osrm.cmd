@echo off
setlocal
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher missing. Install Python 3.10+ or run osrm_local.py with the existing Python runtime.
  exit /b 1
)
py -3 "%~dp0osrm_local.py" %*
exit /b %errorlevel%
