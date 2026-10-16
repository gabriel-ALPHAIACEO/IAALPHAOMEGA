@echo off
setlocal EnableExtensions
rem Administrar los vendedores de Solventas (ver, eliminar, agregar, deshacer).
rem Ejecutalo como ADMINISTRADOR, con Solventas CERRADO en todas las PC.
net session >nul 2>&1
if errorlevel 1 (
  echo Ejecutalo como ADMINISTRADOR: clic derecho, "Ejecutar como administrador".
  pause
  exit /b 1
)
set "SERVIDOR=.\SQLEXPRESS"
set "BASE=RRVS2013CA"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vendedores.ps1" -Servidor "%SERVIDOR%" -Base "%BASE%"
echo.
pause
