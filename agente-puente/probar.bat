@echo off
rem AGENTE PUENTE: revisar todo sin guardar nada (doble clic).
chcp 65001 >nul
cd /d "%~dp0"
node agente-puente.mjs --doctor
echo.
pause
