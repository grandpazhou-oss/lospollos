@echo off
setlocal
if defined STCT_PYTHON (
  "%STCT_PYTHON%" "%~dp0scripts\local_trial.py" stop %*
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 "%~dp0scripts\local_trial.py" stop %*
  ) else (
    python "%~dp0scripts\local_trial.py" stop %*
  )
)
set "STCT_EXIT=%errorlevel%"
if not "%STCT_NO_PAUSE%"=="1" pause
exit /b %STCT_EXIT%
