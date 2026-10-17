@echo off
setlocal EnableExtensions
rem Mide si llega senal al microfono y recoge datos de tu PC. SOLO LEE, no cambia nada.
rem Ejecutalo como ADMINISTRADOR y cuando diga "HABLA FUERTE", habla cerca del microfono 10 segundos.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0info-microfono.ps1"
echo.
pause
