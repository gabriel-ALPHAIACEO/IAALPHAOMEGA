@echo off
setlocal EnableExtensions
rem Enciende Named Pipes, TCP/IP y SQL Server Browser para el conector viejo de Solventas.
rem Ejecutalo como ADMINISTRADOR. Si la instancia no se llama SQLEXPRESS: habilitar-red-sql.bat NOMBRE
net session >nul 2>&1
if errorlevel 1 (
  echo Ejecutalo como ADMINISTRADOR: clic derecho, "Ejecutar como administrador".
  pause
  exit /b 1
)
set "INST=SQLEXPRESS"
if not "%~1"=="" set "INST=%~1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0habilitar-red-sql.ps1" -Instancia "%INST%"
echo.
pause
