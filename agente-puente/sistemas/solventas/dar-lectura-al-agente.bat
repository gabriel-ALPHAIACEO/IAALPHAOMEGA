@echo off
setlocal EnableExtensions
rem Le da al agente puente permiso de SOLO LECTURA sobre la base de Solventas (sin claves).
rem Ejecutalo como ADMINISTRADOR. Servidor y base: los de modoc.ini de Rodrigo.
net session >nul 2>&1
if errorlevel 1 (
  echo Ejecutalo como ADMINISTRADOR: clic derecho, "Ejecutar como administrador".
  pause
  exit /b 1
)
set "SERVIDOR=.\SQLEXPRESS"
set "BASE=RRVS2013CA"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dar-lectura-al-agente.ps1" -Servidor "%SERVIDOR%" -Base "%BASE%"
echo.
pause
