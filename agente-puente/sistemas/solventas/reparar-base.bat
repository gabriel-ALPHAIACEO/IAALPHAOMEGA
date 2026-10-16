@echo off
setlocal EnableExtensions
rem ============================================================================
rem  REPARAR LA BASE DE SOLVENTAS (rapida y estable). Primero hace un RESPALDO.
rem  Ejecutalo en la PC del servidor, como ADMINISTRADOR, con Solventas CERRADO
rem  en todas las PC. No borra ni cambia ningun dato: apaga AUTO_CLOSE/AUTO_SHRINK,
rem  activa CHECKSUM y crea indices. Se puede repetir sin problema.
rem ============================================================================
set "SERVIDOR=.\SQLEXPRESS"
set "BASE=RRVS2013CA"
set "RESPALDO=C:\SSCA\respaldos"
set "SALIDA=%~dp0reparar-base-resultado.txt"

where sqlcmd >nul 2>&1
if errorlevel 1 (
  echo No se encontro "sqlcmd". Instalalo ^(gratis, Microsoft "Command Line Utilities for SQL Server"^) y repite.
  pause
  exit /b 1
)

echo Vas a reparar la base %BASE% en %SERVIDOR%.
echo   1) Cierra Solventas en TODAS las PC.
echo   2) Se hace un respaldo en %RESPALDO% antes de tocar nada.
echo.
set /p OK=Escribe SI para continuar: 
if /i not "%OK%"=="SI" (
  echo Cancelado. No se cambio nada.
  pause
  exit /b 1
)

if not exist "%RESPALDO%" mkdir "%RESPALDO%"
if not exist "%RESPALDO%" (
  echo No se pudo crear la carpeta %RESPALDO%. Cambia RESPALDO dentro de este archivo.
  pause
  exit /b 1
)

echo Reparando... ^(puede tardar varios minutos^)
sqlcmd -E -S "%SERVIDOR%" -d master -b -i "%~dp0reparar-base.sql" -v BASE="%BASE%" RESPALDO="%RESPALDO%" -W > "%SALIDA%" 2>&1
set "CODIGO=%errorlevel%"
type "%SALIDA%"
echo.
if not "%CODIGO%"=="0" (
  echo *** HUBO UN ERROR ^(codigo %CODIGO%^). Mira arriba. Si fue en el respaldo, no se cambio nada. ***
  echo Envia el archivo %SALIDA%
) else (
  echo LISTO. Ya puedes abrir Solventas. Respaldo en %RESPALDO%
  echo Resultado completo en %SALIDA%
)
echo.
pause
exit /b %CODIGO%
