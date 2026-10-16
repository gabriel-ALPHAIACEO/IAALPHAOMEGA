@echo off
rem EJEMPLO para SQLite (un archivo .db). Tablas y columnas de EJEMPLO.
sqlite3 -readonly -header -csv "C:\datos\sistema.db" "SELECT codigo, nombre AS producto, existencia AS cantidad, precio FROM productos"
