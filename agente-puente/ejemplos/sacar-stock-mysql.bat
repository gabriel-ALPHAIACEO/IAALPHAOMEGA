@echo off
rem EJEMPLO para MySQL / MariaDB. Sale separado por tabulaciones: el bot lo entiende.
rem Tablas y columnas de EJEMPLO. Usuario de SOLO LECTURA.
mysql -h servidor -u usuario_lectura -pCLAVE_DE_LA_BASE --batch -e "SELECT codigo, nombre AS producto, existencia AS cantidad, precio FROM productos" nombre_base
