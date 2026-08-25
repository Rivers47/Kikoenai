@echo off
setlocal
rem Kikoenai portable launcher (Windows)
rem Data folders (config/sqlite/covers/images/VoiceWork) are created next to this
rem launcher so they sit at the archive root -- matching the legacy pkg build
rem users migrate from (drop your existing config/sqlite/covers here).
set "ROOT=%~dp0"
set "PATH=%ROOT%ffmpeg;%PATH%"
set "KIKO_DATA_DIR=%ROOT%"
if not exist "%ROOT%config" mkdir "%ROOT%config"
if not exist "%ROOT%sqlite" mkdir "%ROOT%sqlite"
if not exist "%ROOT%covers" mkdir "%ROOT%covers"
if not exist "%ROOT%images" mkdir "%ROOT%images"
if not exist "%ROOT%VoiceWork" mkdir "%ROOT%VoiceWork"
rem Open the browser after a short delay (background, minimized window)
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8888"
rem Run the server in the foreground; closing this window stops it.
rem Two layouts share this launcher: the portable zip (node.exe + app/) and
rem the single-exe build (Kikoenai.exe). Detect which is present.
if exist "%ROOT%Kikoenai.exe" (
  "%ROOT%Kikoenai.exe"
) else (
  "%ROOT%node\node.exe" "%ROOT%app\app.js"
)
rem If we reach here the server exited (crash or error). Keep the window open
rem so the user can read the message; closing the window stops everything.
echo.
echo ============================================================
echo  Kikoenai exited with code %errorlevel%
echo  The server stopped. Do not close this window until you've copied
echo  any error message above to share with support.
echo ============================================================
echo.
pause
