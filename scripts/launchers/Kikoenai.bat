@echo off
setlocal
rem Kikoenai portable launcher (Windows)
rem Data folders (config/sqlite/covers/VoiceWork) are created next to this
rem launcher so they sit at the archive root -- matching the legacy pkg build
rem users migrate from (drop your existing config/sqlite/covers here).
set "ROOT=%~dp0"
set "PATH=%ROOT%ffmpeg;%PATH%"
set "KIKO_DATA_DIR=%ROOT%"
if not exist "%ROOT%config" mkdir "%ROOT%config"
if not exist "%ROOT%sqlite" mkdir "%ROOT%sqlite"
if not exist "%ROOT%covers" mkdir "%ROOT%covers"
if not exist "%ROOT%VoiceWork" mkdir "%ROOT%VoiceWork"
rem Open the browser after a short delay (background, minimized window)
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8888"
rem Run the server in the foreground; closing this window stops it.
"%ROOT%node\node.exe" "%ROOT%app\app.js"
