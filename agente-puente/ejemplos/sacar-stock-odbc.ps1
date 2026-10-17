# EJEMPLO por ODBC con PowerShell. Lo llama sacar-stock-odbc.bat.
# Tablas y columnas de EJEMPLO: cambia la consulta por la de tu sistema.
$ErrorActionPreference = "Stop"
$c = New-Object System.Data.Odbc.OdbcConnection("DSN=MiSistema")
$c.Open()
try {
  $cmd = $c.CreateCommand()
  $cmd.CommandText = "SELECT codigo, nombre AS producto, existencia AS cantidad, precio FROM productos"
  $t = New-Object System.Data.DataTable
  $t.Load($cmd.ExecuteReader())
  $t | ConvertTo-Csv -NoTypeInformation -Delimiter ";"
} finally {
  $c.Close()
}
