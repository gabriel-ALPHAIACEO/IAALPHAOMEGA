@echo off
setlocal EnableExtensions
rem Repara el microfono de Windows 10/11. Ejecutalo como ADMINISTRADOR (clic derecho > Ejecutar como administrador).
rem   reparar-microfono.bat                  repara
rem   reparar-microfono.bat -SoloDiagnostico solo mira, no cambia nada
rem   reparar-microfono.bat -Agresivo        ademas reinicia el controlador de sonido
net session >nul 2>&1
if errorlevel 1 (
  echo Ejecutalo como ADMINISTRADOR: clic derecho, "Ejecutar como administrador".
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reparar-microfono.ps1" %*
echo.
pause
