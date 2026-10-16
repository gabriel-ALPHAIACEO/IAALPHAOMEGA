@echo off
rem AGENTE PUENTE: quitar la tarea programada (doble clic; pide permiso de administrador).
chcp 65001 >nul
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
node agente-puente.mjs --desinstalar
echo La carpeta y config.json se quedan: borralos a mano si ya no los usas.
pause
