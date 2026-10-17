@echo off
rem EJEMPLO para PostgreSQL. La clave va en la variable PGPASSWORD (no en el comando).
rem Tablas y columnas de EJEMPLO. Usuario de SOLO LECTURA.
set PGPASSWORD=CLAVE_DE_LA_BASE
psql -h servidor -U usuario_lectura -d nombre_base -A -F ";" -P footer=off -c "SELECT codigo, nombre AS producto, existencia AS cantidad, precio FROM productos"
