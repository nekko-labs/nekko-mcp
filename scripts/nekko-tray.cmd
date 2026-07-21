@echo off
rem Launch the NekkoMCP tray icon hidden (no console window).
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0nekko-tray.ps1"
