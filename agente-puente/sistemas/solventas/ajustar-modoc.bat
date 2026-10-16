@echo off
setlocal EnableExtensions
rem ============================================================================
rem  Cambia la primera linea de C:\SSCA\modoc.ini (el servidor de SQL que usa
rem  Solventas) por .\SQLEXPRESS, para que use el SQL Server de ESTA PC.
rem  Antes guarda una copia: modoc.ini.copia. Para una caja que se conecta a otra
rem  PC, pasa el nombre:  ajustar-modoc.bat NOMBRE-DE-LA-PC\SQLEXPRESS
rem ============================================================================
set "INI=C:\SSCA\modoc.ini"
set "SERVIDOR=.\SQLEXPRESS"
if not "%~1"=="" set "SERVIDOR=%~1"
if not exist "%INI%" (
  echo No esta %INI%.
  pause
  exit /b 1
)
copy /y "%INI%" "%INI%.copia" >nul
set "SERVIDOR_NUEVO=%SERVIDOR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%INI%'; $l=[IO.File]::ReadAllLines($p); $l[0]=$env:SERVIDOR_NUEVO; [IO.File]::WriteAllLines($p,$l,[Text.Encoding]::Default)"
if errorlevel 1 (
  echo No se pudo cambiar. Copia de seguridad en %INI%.copia
) else (
  echo Listo. Primera linea de modoc.ini:
  powershell -NoProfile -Command "(Get-Content '%INI%')[0]"
  echo Copia de seguridad: %INI%.copia
)
pause
