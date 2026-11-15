@echo off
setlocal
set "APP_DIR=%~dp0"

echo [1/3] Memeriksa Python 3...
set "PY_CMD="
where py >nul 2>nul && set "PY_CMD=py -3"
if "%PY_CMD%"=="" (
  where python >nul 2>nul && set "PY_CMD=python"
)
if "%PY_CMD%"=="" (
  echo ERROR: Python 3 belum terpasang. Unduh di https://www.python.org/downloads/
  pause
  exit /b 1
)

echo [2/3] Memasang dependensi Python (yt-dlp, pywebview)...
%PY_CMD% -m pip install --upgrade -r "%APP_DIR%requirements.txt"

echo [3/3] Membuat pintasan Desktop OnyxTube...
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\OnyxTube.lnk'); $s.TargetPath = '%APP_DIR%launch-onyxtube.bat'; $s.WorkingDirectory = '%APP_DIR%'; $s.WindowStyle = 7; $s.Save()"

echo Selesai! Jalankan OnyxTube dari pintasan Desktop atau launch-onyxtube.bat.
pause
