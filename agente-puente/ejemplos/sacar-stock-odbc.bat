@echo off
rem EJEMPLO por ODBC (Access, DBF/FoxPro, Firebird, y casi cualquier base que tenga driver ODBC).
rem Primero crea un DSN en "Origenes de datos ODBC" de Windows (aqui se llama MiSistema).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sacar-stock-odbc.ps1"
