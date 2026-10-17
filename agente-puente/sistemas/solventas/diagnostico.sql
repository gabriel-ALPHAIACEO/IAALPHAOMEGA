-- DIAGNOSTICO DE SOLVENTAS (Grupo Sotecsis) - SOLO LEE, no cambia nada.
-- Compatible con SQL Server 2005 Express en adelante.
--   sqlcmd -E -S .\SQLEXPRESS -d master -i diagnostico.sql -v BASE="RRVS2013CA" -W -s"|" -o diagnostico-solventas.txt
-- (diagnostico.bat lo corre solo.) Cada bloque va aparte: si a una version le falta
-- una tabla o una columna, solo falla ese bloque y siguen los demas.
SET NOCOUNT ON;
PRINT '=== 1. EL SERVIDOR ===';
SELECT CAST(SERVERPROPERTY('MachineName') AS varchar(60)) AS equipo,
       CAST(SERVERPROPERTY('ServerName') AS varchar(60)) AS servidor,
       CAST(SERVERPROPERTY('Edition') AS varchar(60)) AS edicion,
       CAST(SERVERPROPERTY('ProductVersion') AS varchar(30)) AS version,
       CAST(SERVERPROPERTY('ProductLevel') AS varchar(30)) AS nivel;
GO
PRINT '';
PRINT '=== 2. LAS BASES: tamano y opciones (AUTO_CLOSE y AUTO_SHRINK deben estar en 0) ===';
SELECT d.name AS base, d.state_desc AS estado,
       CAST(SUM(CASE WHEN f.type = 0 THEN f.size END) * 8 / 1024.0 AS decimal(12,1)) AS datos_MB,
       CAST(SUM(CASE WHEN f.type = 1 THEN f.size END) * 8 / 1024.0 AS decimal(12,1)) AS bitacora_MB,
       d.is_auto_close_on AS auto_close, d.is_auto_shrink_on AS auto_shrink,
       d.recovery_model_desc AS recuperacion, d.page_verify_option_desc AS verificar_paginas,
       d.compatibility_level AS compat
  FROM sys.databases d JOIN sys.master_files f ON f.database_id = d.database_id
 WHERE d.database_id > 4
 GROUP BY d.name, d.state_desc, d.is_auto_close_on, d.is_auto_shrink_on, d.recovery_model_desc, d.page_verify_option_desc, d.compatibility_level;
GO
PRINT '';
PRINT '=== 3. EL ULTIMO RESPALDO DE CADA BASE ===';
SELECT d.name AS base, MAX(b.backup_finish_date) AS ultimo_respaldo
  FROM sys.databases d LEFT JOIN msdb.dbo.backupset b ON b.database_name = d.name AND b.type = 'D'
 WHERE d.database_id > 4 GROUP BY d.name;
GO
PRINT '';
PRINT '=== 4. QUIEN ESTA CONECTADO AHORA (si algo se cuelga, mira si hay bloqueos) ===';
SELECT s.session_id AS sesion, s.host_name AS equipo, s.program_name AS programa, s.login_name AS usuario,
       s.status AS estado, s.last_request_end_time AS ultima_actividad
  FROM sys.dm_exec_sessions s WHERE s.is_user_process = 1;
SELECT r.session_id AS sesion, r.blocking_session_id AS bloqueada_por, r.wait_type AS espera, r.wait_time AS ms_esperando
  FROM sys.dm_exec_requests r WHERE r.blocking_session_id > 0;
GO
USE [$(BASE)];
GO
PRINT '';
PRINT '=== 5. TABLAS SIN NINGUN INDICE (mas filas = mas lenta cada busqueda) ===';
SELECT TOP 25 t.name AS tabla, SUM(p.rows) AS filas
  FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
 WHERE NOT EXISTS (SELECT 1 FROM sys.indexes i WHERE i.object_id = t.object_id AND i.type > 0)
 GROUP BY t.name ORDER BY SUM(p.rows) DESC;
SELECT (SELECT COUNT(*) FROM sys.tables) AS tablas_en_total,
       (SELECT COUNT(*) FROM sys.tables t WHERE NOT EXISTS (SELECT 1 FROM sys.indexes i WHERE i.object_id = t.object_id AND i.type > 0)) AS sin_indice;
GO
PRINT '';
PRINT '=== 6. LAS TABLAS MAS GRANDES ===';
SELECT TOP 15 t.name AS tabla, SUM(p.rows) AS filas
  FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
 GROUP BY t.name ORDER BY SUM(p.rows) DESC;
GO
PRINT '';
PRINT '=== 7. INVENTARIO: lo que hay que revisar (cantidad = 0 es buena senal) ===';
SELECT 'productos en total' AS chequeo, COUNT(*) AS cantidad, 'filas de Productos (una por talla)' AS que_significa FROM Productos
UNION ALL SELECT 'sin codigo de barras', COUNT(*), 'no se pueden buscar ni vender por codigo' FROM Productos WHERE cb IS NULL OR LTRIM(RTRIM(cb)) = ''
UNION ALL SELECT 'codigos de barras repetidos', COUNT(*), 'el mismo codigo en mas de una fila: vende/descuenta el que no es' FROM (SELECT cb FROM Productos WHERE cb IS NOT NULL AND LTRIM(RTRIM(cb)) <> '' GROUP BY cb HAVING COUNT(*) > 1) x
UNION ALL SELECT 'existencia negativa', COUNT(*), 'se vendio mas de lo que habia (o falta una compra)' FROM Productos WHERE ExistProd < 0
UNION ALL SELECT 'con existencia y sin precio', COUNT(*), 'PVP1Prod en 0 o vacio: saldria gratis' FROM Productos WHERE ExistProd > 0 AND (PVP1Prod IS NULL OR PVP1Prod <= 0)
UNION ALL SELECT 'con existencia y sin costo', COUNT(*), 'CostoProd en 0: la ganancia sale mal' FROM Productos WHERE ExistProd > 0 AND (CostoProd IS NULL OR CostoProd <= 0)
UNION ALL SELECT 'marca que no existe', COUNT(*), 'Productos.marca no esta en la tabla marcas' FROM Productos p WHERE p.marca IS NOT NULL AND p.marca <> '' AND NOT EXISTS (SELECT 1 FROM marcas m WHERE m.codigo = p.marca)
UNION ALL SELECT 'sin marca', COUNT(*), '' FROM Productos WHERE marca IS NULL OR marca = ''
UNION ALL SELECT 'sin nombre', COUNT(*), 'DescProd vacio' FROM Productos WHERE DescProd IS NULL OR LTRIM(RTRIM(DescProd)) = ''
UNION ALL SELECT 'sin talla', COUNT(*), '' FROM Productos WHERE TallaProd IS NULL OR LTRIM(RTRIM(TallaProd)) = ''
UNION ALL SELECT 'categoria que no existe', COUNT(*), 'Productos.catego no esta en categorias' FROM Productos p WHERE p.catego IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categorias c WHERE c.seq = p.catego)
UNION ALL SELECT 'codigo de producto repetido', COUNT(*), 'CodProd repetido' FROM (SELECT CodProd FROM Productos WHERE CodProd IS NOT NULL AND CodProd <> '' GROUP BY CodProd HAVING COUNT(*) > 1) y;
GO
PRINT '';
PRINT '=== 8. LOS CODIGOS DE BARRAS REPETIDOS (los 20 peores) ===';
SELECT TOP 20 cb, COUNT(*) AS veces, MAX(DescProd) AS ejemplo FROM Productos
 WHERE cb IS NOT NULL AND LTRIM(RTRIM(cb)) <> '' GROUP BY cb HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC;
GO
PRINT '';
PRINT '=== 9. VENTAS: facturas y renglones que no cuadran ===';
SELECT 'facturas en total' AS chequeo, COUNT(*) AS cantidad FROM ventas
UNION ALL SELECT 'facturas sin renglones', COUNT(*) FROM ventas v WHERE NOT EXISTS (SELECT 1 FROM renglon r WHERE r.factura = v.factura)
UNION ALL SELECT 'renglones sin factura', COUNT(*) FROM renglon r WHERE NOT EXISTS (SELECT 1 FROM ventas v WHERE v.factura = r.factura)
UNION ALL SELECT 'numero de factura repetido (mismo tipo)', COUNT(*) FROM (SELECT tipo, factura FROM ventas GROUP BY tipo, factura HAVING COUNT(*) > 1) z
UNION ALL SELECT 'facturas anuladas', COUNT(*) FROM ventas WHERE anulada IS NOT NULL AND anulada <> '' AND anulada <> 'N'
UNION ALL SELECT 'renglones con un codigo que ya no existe', COUNT(*) FROM renglon r WHERE r.cb IS NOT NULL AND r.cb <> '' AND NOT EXISTS (SELECT 1 FROM Productos p WHERE p.cb = r.cb);
GO
PRINT '';
PRINT '=== 10. FRAGMENTACION de los indices que existen (mas de 30 = reorganizar) ===';
SELECT TOP 15 OBJECT_NAME(s.object_id) AS tabla, i.name AS indice, CAST(s.avg_fragmentation_in_percent AS decimal(5,1)) AS fragmentado_pct, s.page_count AS paginas
  FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') s
  JOIN sys.indexes i ON i.object_id = s.object_id AND i.index_id = s.index_id
 WHERE i.name IS NOT NULL AND s.page_count > 100 ORDER BY s.avg_fragmentation_in_percent DESC;
GO
PRINT '';
PRINT '=== 11. USUARIOS DEL PROGRAMA (solo si la clave es muy corta; nunca se muestran las claves) ===';
SELECT usuario, CASE WHEN LEN(clave) < 6 THEN 'MUY CORTA (menos de 6 caracteres)' ELSE 'ok' END AS clave, CASE WHEN LEN(clave2) < 6 THEN 'MUY CORTA (menos de 6 caracteres)' ELSE 'ok' END AS clave_super FROM usuarios;
GO
PRINT '';
PRINT '=== FIN. Manda este archivo (no tiene contrasenas) para revisarlo. ===';
GO
