@echo off
setlocal EnableExtensions
rem ============================================================================
rem  DIAGNOSTICO DE SOLVENTAS (SOLO LEE, no cambia nada).
rem  Ejecutalo en la PC donde esta SQL Server (la "del servidor"), con doble clic.
rem  Deja el resultado en  diagnostico-solventas.txt  (junto a este archivo).
rem  Envia ESE archivo; no contiene claves.
rem  Ajusta solo si es distinto en tu PC:
rem ============================================================================
set "CARPETA_SOLVENTAS=C:\SSCA"
set "SERVIDOR=.\SQLEXPRESS"
set "BASE=RRVS2013CA"
set "SALIDA=%~dp0diagnostico-solventas.txt"

echo DIAGNOSTICO DE SOLVENTAS  -  %DATE% %TIME%> "%SALIDA%"
echo Equipo: %COMPUTERNAME%   Usuario de Windows: %USERNAME%>> "%SALIDA%"
echo.>> "%SALIDA%"

echo === A. SERVICIOS DE SQL SERVER ===>> "%SALIDA%"
for %%S in ("MSSQL$SQLEXPRESS" "SQLBrowser" "MSSQLSERVER") do (
  sc query %%~S 2>nul | findstr /i "SERVICE_NAME STATE" >> "%SALIDA%"
)
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
where sqlcmd >nul 2>&1
if errorlevel 1 (
  echo   No esta "sqlcmd" en esta PC. Instalalo gratis ^(Microsoft "Command Line Utilities for SQL Server"^)>> "%SALIDA%"
  echo   o abre SQL Server Management Studio y ejecuta diagnostico.sql ahi.>> "%SALIDA%"
  echo.
  echo No se encontro sqlcmd. Mira el archivo %SALIDA%
  goto fin
)
sqlcmd -E -S "%SERVIDOR%" -d master -b -Q "SELECT 1" >nul 2>&1
if errorlevel 1 (
  echo   NO SE PUDO CONECTAR a "%SERVIDOR%" con el usuario de Windows %USERNAME%.>> "%SALIDA%"
  echo   Causas habituales: el servicio MSSQL$SQLEXPRESS esta detenido ^(mira A^), el nombre del>> "%SALIDA%"
  echo   servidor es otro ^(mira C: linea 1^), o este usuario no tiene permiso. Error exacto:>> "%SALIDA%"
  sqlcmd -E -S "%SERVIDOR%" -d master -Q "SELECT 1" >> "%SALIDA%" 2>&1
  goto fin
)
sqlcmd -E -S "%SERVIDOR%" -d master -i "%~dp0diagnostico.sql" -v BASE="%BASE%" -W -s"|" >> "%SALIDA%" 2>&1

:fin
echo.
echo Listo. Resultado en:
echo   %SALIDA%
echo Envia ese archivo (no lleva claves).
echo.
pause
