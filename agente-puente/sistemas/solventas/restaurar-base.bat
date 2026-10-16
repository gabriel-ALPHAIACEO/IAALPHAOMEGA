@echo off
setlocal EnableExtensions
rem ============================================================================
rem  RESTAURAR LA BASE DE SOLVENTAS EN ESTA PC (traslado a Windows 11)
rem  Ejecutalo como ADMINISTRADOR (clic derecho, "Ejecutar como administrador").
rem  Antes: instalar SQL Server 2019 Express (instancia SQLEXPRESS) y tener el
rem  respaldo (.bak). Ver PASOS-TRASLADO-WINDOWS11.txt
rem  Uso: doble clic y pega la ruta del .bak cuando la pida; o arrastra el .bak
rem  encima de este archivo.
rem  Deja el registro (sin claves) en restaurar-base-resultado.txt
rem ============================================================================
set "SERVIDOR=.\SQLEXPRESS"
set "BASE=RRVS2013CA"

net session >nul 2>&1
if errorlevel 1 (
  echo Ejecutalo como ADMINISTRADOR: clic derecho sobre este archivo, "Ejecutar como administrador".
  pause
  exit /b 1
)

set "BAK=%~1"
if "%BAK%"=="" set /p BAK=Ruta del archivo .bak (el ARCHIVO, por ejemplo C:\SSCA\RRVS2013CA-hoy.bak): 
set BAK=%BAK:"=%
if not exist "%BAK%" (
  echo No existe el archivo "%BAK%".
  pause
  exit /b 1
)

echo.
echo Se va a restaurar "%BAK%" en %SERVIDOR% como la base %BASE%.
set /p OK=Escribe SI para continuar: 
if /i not "%OK%"=="SI" goto cancelado

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restaurar-base.ps1" -Respaldo "%BAK%" -Servidor "%SERVIDOR%" -Base "%BASE%"
set "CODIGO=%errorlevel%"
if not "%CODIGO%"=="3" goto fin

echo.
set /p R=Quieres REEMPLAZARLA con este respaldo? Antes se guarda una copia de la actual. Escribe SI: 
if /i not "%R%"=="SI" goto fin
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restaurar-base.ps1" -Respaldo "%BAK%" -Servidor "%SERVIDOR%" -Base "%BASE%" -Reemplazar
set "CODIGO=%errorlevel%"

:fin
echo.
if not "%CODIGO%"=="0" (echo *** Hubo un problema ^(codigo %CODIGO%^). Copiame lo que salio arriba. ***) else (echo LISTO.)
pause
exit /b %CODIGO%

:cancelado
echo Cancelado. No se cambio nada.
pause
exit /b 1
