@echo off
setlocal
title SocialGrab installer
REM Installs SocialGrab for Premiere Pro and After Effects (Windows).

set "SRC=%~dp0SocialGrab"
set "DEST=%APPDATA%\Adobe\CEP\extensions\SocialGrab"

if not exist "%SRC%\CSXS\manifest.xml" (
  echo.
  echo  Can't find the SocialGrab folder next to this installer.
  echo  Right-click the zip file, choose "Extract All...", then run this installer from the extracted folder.
  echo.
  pause
  exit /b 1
)

if exist "%DEST%" rmdir /s /q "%DEST%"
xcopy "%SRC%" "%DEST%\" /e /i /q /y >nul
if errorlevel 1 (
  echo  Copy failed. Close Premiere Pro / After Effects and try again.
  pause
  exit /b 1
)

REM Allow unsigned extensions to load in Premiere Pro / After Effects.
for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

echo.
echo  SocialGrab installed.
echo.
echo  Next:
echo    1. Close and reopen Premiere Pro (or After Effects).
echo    2. Window ^> Extensions ^> SocialGrab - Video Downloader
echo    3. Click "Install tools" at the bottom of the panel (one time).
echo       It downloads yt-dlp, ffmpeg and Deno automatically.
echo.
pause
