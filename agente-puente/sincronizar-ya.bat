@echo off
rem AGENTE PUENTE: mandar el stock AHORA (doble clic).
chcp 65001 >nul
cd /d "%~dp0"
node agente-puente.mjs --una-vez
echo.
pause
