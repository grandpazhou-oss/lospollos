@echo off
setlocal
py -3 "%~dp0build_matrix.py" %*
exit /b %errorlevel%
