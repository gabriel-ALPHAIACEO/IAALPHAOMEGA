@echo off
setlocal EnableExtensions
rem ============================================================================
rem  Registra VMAX.ocx (un componente de Solventas) en Windows de 64 bits.
rem  Solventas es un programa de 32 bits: hay que registrarlo con el regsvr32 de
rem  32 bits (SysWOW64), no con el de System32. Ejecutalo como ADMINISTRADOR.
rem ============================================================================
set "OCX=C:\SSCA\VMAX.ocx"
rem Si VMAX.ocx esta junto a este archivo (por ejemplo en E:\SSCA), se usa ese.
if exist "%~dp0VMAX.ocx" set "OCX=%~dp0VMAX.ocx"
echo Usando: %OCX%
if not "%~1"=="" set "OCX=%~1"
net session >nul 2>&1
if errorlevel 1 (
  echo Ejecutalo como ADMINISTRADOR: clic derecho, "Ejecutar como administrador".
  pause
  exit /b 1
)
if not exist "%OCX%" (
  echo No esta %OCX%. Copia primero la carpeta C:\SSCA, o pasa la ruta: registrar-vmax.bat "D:\ruta\VMAX.ocx"
  pause
  exit /b 1
)
if exist "%windir%\SysWOW64\regsvr32.exe" (set "REG=%windir%\SysWOW64\regsvr32.exe") else (set "REG=%windir%\System32\regsvr32.exe")
"%REG%" /s "%OCX%"
if errorlevel 1 (
  echo No se pudo registrar %OCX%. Copiame el mensaje de error.
) else (
  echo Registrado: %OCX%
)
pause
