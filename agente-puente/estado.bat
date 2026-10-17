@echo off
rem AGENTE PUENTE: como le fue la ultima vez (doble clic).
chcp 65001 >nul
cd /d "%~dp0"
node agente-puente.mjs --estado
echo.
pause
