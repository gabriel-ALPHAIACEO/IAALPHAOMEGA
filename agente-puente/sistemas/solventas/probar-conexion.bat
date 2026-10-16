@echo off
setlocal EnableExtensions
rem Prueba la conexion a SQL Server igual que lo hace Solventas (conector viejo, 32 bits).
rem No cambia nada. Se puede ejecutar normal (sin administrador).
if exist "%windir%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" (
  "%windir%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0probar-conexion.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0probar-conexion.ps1"
)
echo.
pause
