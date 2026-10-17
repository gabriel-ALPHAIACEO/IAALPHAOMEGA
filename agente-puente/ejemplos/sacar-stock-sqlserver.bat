@echo off
rem EJEMPLO para SQL Server (sistemas tipo Profit, Saint y parecidos suelen usarlo; confirmalo con el proveedor).
rem Las tablas y columnas de abajo son de EJEMPLO: cada sistema tiene las suyas.
rem Usa SIEMPRE un usuario de SOLO LECTURA. Con seguridad de Windows, cambia -U ... -P ... por -E
rem En config.json:  "fuente": { "tipo": "comando", "comando": "C:\\agente-puente\\ejemplos\\sacar-stock-sqlserver.bat", "codificacion": "latin1" }
sqlcmd -S SERVIDOR\INSTANCIA -d NombreDeLaBase -U usuario_lectura -P "CLAVE_DE_LA_BASE" -W -s";" -Q "SET NOCOUNT ON; SELECT a.co_art AS codigo, a.art_des AS producto, a.stock_act AS cantidad, a.prec_vta1 AS precio FROM art a WHERE a.stock_act IS NOT NULL"
