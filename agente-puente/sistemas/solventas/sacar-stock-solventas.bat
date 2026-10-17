@echo off
rem Saca el stock de Solventas para el agente puente. SOLO LEE la base (un SELECT).
rem En config.json:  "fuente": { "tipo": "comando", "comando": "C:\\agente-puente\\sistemas\\solventas\\sacar-stock-solventas.bat", "codificacion": "utf8", "timeoutSegundos": 180 }
rem
rem Ajusta SOLO lo que haga falta (las otras lineas ya vienen bien para la tienda de Rodrigo):
set "SOLVENTAS_SERVIDOR=.\SQLEXPRESS"
set "SOLVENTAS_BASE=RRVS2013CA"
rem Seguridad de Windows (lo recomendado): deja USUARIO vacio. Con usuario de SOLO LECTURA (nunca "sa"), llenalo:
set "SOLVENTAS_USUARIO="
set "SOLVENTAS_CLAVE="
rem Que columna es el precio de venta: PVP1Prod, PVP2Prod, PVP3Prod, cifus (dolares) o PVPBSF (bolivares)
set "SOLVENTAS_PRECIO=PVP1Prod"
rem "si" = no manda lo que esta en 0 (no recomendado: un producto en 0 debe llegar como 0)
set "SOLVENTAS_SOLO_CON_STOCK=no"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sacar-stock-solventas.ps1"
exit /b %errorlevel%
