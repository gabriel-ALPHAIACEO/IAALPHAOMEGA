@echo off
setlocal EnableExtensions
rem ============================================================================
rem  DIAGNOSTICO DE SOLVENTAS (SOLO LEE, no cambia nada).
rem  Ejecutalo en la PC donde esta SQL Server (la "del servidor"), con doble clic.
rem  No necesita instalar nada (no usa sqlcmd).
rem  Deja el resultado en  diagnostico-solventas.txt  (junto a este archivo).
rem  Envia ESE archivo; no contiene claves.
rem  Ajusta solo si es distinto en tu PC:
rem ============================================================================
set "CARPETA_SOLVENTAS=C:\SSCA"
set "SERVIDOR=.\SQLEXPRESS"
set "BASE=RRVS2013CA"
set "SALIDA=%~dp0diagnostico-solventas.txt"
set "PS=powershell -NoProfile -ExecutionPolicy Bypass -File"

echo DIAGNOSTICO DE SOLVENTAS  -  %DATE% %TIME%> "%SALIDA%"
echo Equipo: %COMPUTERNAME%   Usuario de Windows: %USERNAME%>> "%SALIDA%"
ver >> "%SALIDA%"
echo.>> "%SALIDA%"

echo === A. SERVICIOS DE SQL SERVER (todos los que hay en esta PC) ===>> "%SALIDA%"
sc query type= service state= all 2>nul | findstr /i /c:"SERVICE_NAME: MSSQL" /c:"SERVICE_NAME: SQLBrowser" /c:"SERVICE_NAME: SQLAgent" >> "%SALIDA%"
echo   (los que estan funcionando ahora:)>> "%SALIDA%"
net start 2>nul | findstr /i "sql" >> "%SALIDA%"
echo.>> "%SALIDA%"

echo === B. ARCHIVOS DEL PROGRAMA en %CARPETA_SOLVENTAS% ===>> "%SALIDA%"
for %%F in (Solventas.exe VMAX.ocx modoc.ini impf.exe tfhkaif.dll) do (
  if exist "%CARPETA_SOLVENTAS%\%%F" (echo   [OK]   %%F>> "%SALIDA%") else (echo   [FALTA] %%F>> "%SALIDA%")
)
if exist "%ProgramFiles(x86)%\Common Files\Borland Shared\BDE\IDAPI32.DLL" (echo   [OK]   BDE: IDAPI32.DLL>> "%SALIDA%") else if exist "%ProgramFiles%\Common Files\Borland Shared\BDE\IDAPI32.DLL" (echo   [OK]   BDE: IDAPI32.DLL>> "%SALIDA%") else if exist "%windir%\SysWOW64\IDAPI32.DLL" (echo   [OK]   BDE: IDAPI32.DLL>> "%SALIDA%") else if exist "%windir%\System32\IDAPI32.DLL" (echo   [OK]   BDE: IDAPI32.DLL>> "%SALIDA%") else (echo   [FALTA] BDE: IDAPI32.DLL - sin el, Solventas puede no abrir>> "%SALIDA%")
echo.>> "%SALIDA%"

echo === C. modoc.ini (primeras lineas; se tapa lo que parezca una clave) ===>> "%SALIDA%"
if exist "%CARPETA_SOLVENTAS%\modoc.ini" (
  for /f "usebackq tokens=* delims=" %%L in (`type "%CARPETA_SOLVENTAS%\modoc.ini" ^| findstr /v /i "clave pass pwd password"`) do echo   %%L>> "%SALIDA%"
) else (
  echo   no se encontro modoc.ini>> "%SALIDA%"
)
echo   (la linea 1 es el servidor que usa Solventas; esta PC se llama %COMPUTERNAME%)>> "%SALIDA%"
echo.>> "%SALIDA%"

echo === D. LA BASE DE DATOS ===>> "%SALIDA%"
%PS% "%~dp0ejecutar-sql.ps1" -Servidor "%SERVIDOR%" -Probar >> "%SALIDA%" 2>&1
if errorlevel 1 (
  echo   Si dice "no se pudo conectar": mira la seccion A ^(servicio detenido?^) y la C ^(nombre del servidor^).>> "%SALIDA%"
  echo   Si el nombre de la instancia es otro, cambia SERVIDOR dentro de este archivo.>> "%SALIDA%"
  goto fin
)
%PS% "%~dp0ejecutar-sql.ps1" -Servidor "%SERVIDOR%" -Archivo "%~dp0diagnostico.sql" BASE=%BASE% >> "%SALIDA%" 2>&1

:fin
echo.
echo Listo. Resultado en:
echo   %SALIDA%
echo Envia ese archivo (no lleva claves).
echo.
pause
