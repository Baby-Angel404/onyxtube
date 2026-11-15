@echo off
setlocal
set "APP_DIR=%~dp0"
set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%USERPROFILE%\.local\bin;%PATH%"

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 "%APP_DIR%desktop.py" %*
  exit /b %ERRORLEVEL%
)

where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python "%APP_DIR%desktop.py" %*
  exit /b %ERRORLEVEL%
)

echo OnyxTube: Python 3 tidak ditemukan. Pasang Python 3 dari https://www.python.org/downloads/
pause
exit /b 1
