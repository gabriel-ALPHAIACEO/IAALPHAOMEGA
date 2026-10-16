-- REPARACION DE LA BASE DE SOLVENTAS (Grupo Sotecsis). Compatible con SQL Server 2005 Express en adelante.
--   sqlcmd -E -S .\SQLEXPRESS -d master -i reparar-base.sql -v BASE="RRVS2013CA" RESPALDO="C:\SSCA\respaldos" -W
-- (reparar-base.bat lo corre solo.)
--
-- QUE HACE (todo seguro: no cambia ni borra ningun dato):
--   1. Hace un RESPALDO completo antes de tocar nada. Si falla, se detiene.
--   2. Apaga AUTO_CLOSE y AUTO_SHRINK: con AUTO_CLOSE la base se cierra al salir el ultimo
--      usuario y se reabre en cada conexion (tarda, falla al conectar, se cuelga); con
--      AUTO_SHRINK se reorganiza sin parar y se fragmenta.
--   3. Activa la verificacion de paginas con CHECKSUM (detecta discos danados).
--   4. Crea los INDICES que le faltan a las consultas del propio programa (hoy casi ninguna
--      tabla tiene uno: cada busqueda por codigo de barras lee la tabla entera).
--   5. Actualiza las estadisticas.
-- Se puede correr mas de una vez: lo que ya esta hecho, lo salta.
-- CIERRA SOLVENTAS EN TODAS LAS PC antes de correrlo.
SET NOCOUNT ON;
:On Error exit
GO
PRINT '=== 1. RESPALDO ANTES DE REPARAR ===';
DECLARE @ruta nvarchar(260), @archivo nvarchar(400);
SET @ruta = N'$(RESPALDO)';
IF RIGHT(@ruta, 1) NOT IN (N'\', N'/') SET @ruta = @ruta + CASE WHEN @ruta LIKE N'%/%' THEN N'/' ELSE N'\' END;
SET @archivo = @ruta + N'$(BASE)_antes_de_reparar_' + CONVERT(nvarchar(8), GETDATE(), 112) + N'_' + REPLACE(CONVERT(nvarchar(8), GETDATE(), 108), N':', N'') + N'.bak';
BEGIN TRY
  BACKUP DATABASE [$(BASE)] TO DISK = @archivo WITH INIT, CHECKSUM;
  PRINT 'Respaldo hecho en: ' + @archivo;
END TRY
BEGIN CATCH
  DECLARE @msg nvarchar(500);
  SET @msg = N'NO SE PUDO HACER EL RESPALDO (por seguridad no se cambia nada): ' + ERROR_MESSAGE() + N' Revisa que la carpeta exista y que el servicio de SQL Server pueda escribir en ella.';
  RAISERROR (@msg, 16, 1);
END CATCH
GO
PRINT '';
PRINT '=== 2 y 3. OPCIONES DE LA BASE ===';
ALTER DATABASE [$(BASE)] SET AUTO_CLOSE OFF;
ALTER DATABASE [$(BASE)] SET AUTO_SHRINK OFF;
ALTER DATABASE [$(BASE)] SET PAGE_VERIFY CHECKSUM;
SELECT name AS base, is_auto_close_on AS auto_close, is_auto_shrink_on AS auto_shrink, page_verify_option_desc AS verificar_paginas FROM sys.databases WHERE name = N'$(BASE)';
GO
USE [$(BASE)];
GO
PRINT '';
PRINT '=== 4. INDICES ===';
DECLARE @lista TABLE (id int IDENTITY(1,1), tabla sysname, indice sysname, columnas nvarchar(200));
INSERT INTO @lista (tabla, indice, columnas)
SELECT 'Productos', 'IX_Productos_cb', 'cb'
UNION ALL SELECT 'Productos', 'IX_Productos_codprov_modelo', 'codprov, modelo'
UNION ALL SELECT 'Productos', 'IX_Productos_marca', 'marca'
UNION ALL SELECT 'Productos', 'IX_Productos_catego_linea_marca', 'catego, linea, marca'
UNION ALL SELECT 'Productos', 'IX_Productos_CodProd', 'CodProd'
UNION ALL SELECT 'ventas', 'IX_ventas_factura', 'factura'
UNION ALL SELECT 'ventas', 'IX_ventas_tipo_fecha', 'tipo, fecha'
UNION ALL SELECT 'ventas', 'IX_ventas_fecha', 'fecha'
UNION ALL SELECT 'ventas', 'IX_ventas_codvende_fecha', 'codvende, fecha'
UNION ALL SELECT 'renglon', 'IX_renglon_factura', 'factura'
UNION ALL SELECT 'renglon', 'IX_renglon_cb', 'cb'
UNION ALL SELECT 'pagos', 'IX_pagos_factura', 'factura'
UNION ALL SELECT 'pagos', 'IX_pagos_recibo', 'recibo'
UNION ALL SELECT 'pagafac', 'IX_pagafac_factura', 'factura'
UNION ALL SELECT 'pagafac', 'IX_pagafac_recibo', 'recibo'
UNION ALL SELECT 'movinv', 'IX_movinv_cb', 'cb'
UNION ALL SELECT 'movinv', 'IX_movinv_fecha', 'fecha'
UNION ALL SELECT 'ajustes', 'IX_ajustes_cb', 'cb'
UNION ALL SELECT 'compras', 'IX_compras_fecha', 'fecha'
UNION ALL SELECT 'compras', 'IX_compras_factura', 'factura'
UNION ALL SELECT 'cxpagos', 'IX_cxpagos_codprov', 'codprov'
UNION ALL SELECT 'existalmacen', 'IX_existalmacen_cb', 'cb'
UNION ALL SELECT 'comisiones', 'IX_comisiones_factura', 'factura'
UNION ALL SELECT 'global', 'IX_global_cb', 'cb'
UNION ALL SELECT 'glototal', 'IX_glototal_cb', 'cb';
DECLARE @i int, @n int, @t sysname, @ix sysname, @c nvarchar(200), @sql nvarchar(600), @hechos int, @ya int, @sin int;
SELECT @i = 1, @n = COUNT(*) FROM @lista;
SELECT @hechos = 0, @ya = 0, @sin = 0;
WHILE @i <= @n
BEGIN
  SELECT @t = tabla, @ix = indice, @c = columnas FROM @lista WHERE id = @i;
  IF OBJECT_ID(@t, 'U') IS NULL
  BEGIN
    PRINT '  (esta version no tiene la tabla ' + @t + ': se salta ' + @ix + ')';
    SET @sin = @sin + 1;
  END
  ELSE IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(@t) AND name = @ix)
    SET @ya = @ya + 1;
  ELSE
  BEGIN
    BEGIN TRY
      SET @sql = N'CREATE NONCLUSTERED INDEX ' + QUOTENAME(@ix) + N' ON ' + QUOTENAME(@t) + N' (' + @c + N')';
      EXEC (@sql);
      PRINT '  creado: ' + @ix + ' en ' + @t + ' (' + @c + ')';
      SET @hechos = @hechos + 1;
    END TRY
    BEGIN CATCH
      -- Casi siempre: a esa version de Solventas le falta una columna. Se salta y sigue.
      PRINT '  (se salta ' + @ix + ': ' + ERROR_MESSAGE() + ')';
      SET @sin = @sin + 1;
    END CATCH
  END
  SET @i = @i + 1;
END
PRINT 'Indices creados: ' + CAST(@hechos AS varchar(10)) + ' - ya estaban: ' + CAST(@ya AS varchar(10)) + ' - saltados: ' + CAST(@sin AS varchar(10));
GO
PRINT '';
PRINT '=== 5. ESTADISTICAS (de las tablas que mas se usan) ===';
DECLARE @tabla sysname, @ok int;
SET @ok = 0;
DECLARE tablas CURSOR LOCAL FAST_FORWARD FOR
  SELECT name FROM sys.tables WHERE name IN ('Productos', 'ventas', 'renglon', 'movinv', 'pagos', 'pagafac', 'compras', 'ajustes', 'clientes');
OPEN tablas;
FETCH NEXT FROM tablas INTO @tabla;
WHILE @@FETCH_STATUS = 0
BEGIN
  BEGIN TRY
    EXEC (N'UPDATE STATISTICS ' + N'[' + @tabla + N'] WITH FULLSCAN');
    SET @ok = @ok + 1;
  END TRY
  BEGIN CATCH
    PRINT '  (no se pudo en ' + @tabla + ': ' + ERROR_MESSAGE() + ')';
  END CATCH
  FETCH NEXT FROM tablas INTO @tabla;
END
CLOSE tablas;
DEALLOCATE tablas;
PRINT 'Estadisticas al dia en ' + CAST(@ok AS varchar(10)) + ' tablas.';
GO
PRINT '';
PRINT 'LISTO. Abre Solventas y comprueba que todo funcione. Si algo se ve raro, el respaldo de arriba deja la base como estaba.';
GO
