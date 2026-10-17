@echo off
rem AGENTE PUENTE: instalar en esta PC (doble clic; pide permiso de administrador).
chcp 65001 >nul
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Hace falta permiso de administrador. Te lo pido ahora...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Falta Node.js. Instalalo desde https://nodejs.org - la version LTS - y vuelve a abrir este archivo.
  pause
  exit /b 1
)
if not exist config.json (
  node agente-puente.mjs --configurar
  if errorlevel 1 goto fallo
)
echo.
echo Revisando que todo funcione...
node agente-puente.mjs --doctor
if errorlevel 1 (
  echo.
  echo Hay algo que arreglar antes de instalar: mira las lineas con X de arriba.
  echo Corrige config.json - o borralo y vuelve a abrir este archivo para contestar las preguntas otra vez.
  pause
  exit /b 1
)
echo.
node agente-puente.mjs --instalar
if errorlevel 1 goto fallo
echo.
echo LISTO. El agente puente queda corriendo solo, cada minuto, aunque reinicies la PC.
echo En el panel de la tienda, Inventario - Importar, vas a ver si esta activo.
pause
exit /b 0
:fallo
echo.
echo No se pudo terminar. Mira el mensaje de arriba.
pause
exit /b 1
