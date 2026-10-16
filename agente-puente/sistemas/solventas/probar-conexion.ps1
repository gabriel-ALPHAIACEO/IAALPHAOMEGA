# Prueba la conexion IGUAL que lo hace Solventas: conector SQLOLEDB (el viejo), de 32 bits, usuario sa,
# con el servidor y la base de la 1a y 2a linea de modoc.ini. La clave se escribe aqui y no se guarda.
# Lo llama probar-conexion.bat
param([string]$Ini = "")
$ErrorActionPreference = "Stop"
function Decir([string]$t) { [Console]::WriteLine($t) }
if (-not $Ini) {
  $Ini = Join-Path $PSScriptRoot "modoc.ini"
  if (-not (Test-Path -LiteralPath $Ini)) { $Ini = "C:\SSCA\modoc.ini" }
}
if (-not (Test-Path -LiteralPath $Ini)) { Decir "No encuentro modoc.ini (busque junto a este archivo y en C:\SSCA)."; exit 1 }
$lineas = [IO.File]::ReadAllLines($Ini)
$servidor = $lineas[0].Trim()
$base = $lineas[1].Trim()
Decir "modoc.ini usado: $Ini"
Decir "   servidor = $servidor"
Decir "   base     = $base"
Decir ("Esta prueba corre en " + $(if ([Environment]::Is64BitProcess) { "64 bits (Solventas usa 32)" } else { "32 bits (igual que Solventas)" }))
$a = Read-Host "Clave de sa (la que usa Solventas)" -AsSecureString
$clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($a))
$cs = "Provider=SQLOLEDB.1;Password=$clave;Persist Security Info=False;User ID=sa;Initial Catalog=$base;Data Source=$servidor"
$c = New-Object System.Data.OleDb.OleDbConnection($cs)
try {
  $c.Open()
  $cmd = $c.CreateCommand()
  $cmd.CommandText = "SELECT COUNT(*) FROM Productos"
  $n = $cmd.ExecuteScalar()
  Decir ""
  Decir "CONECTO BIEN. Productos en la base: $n"
  Decir "Solventas deberia poder abrir ahora."
  exit 0
} catch {
  Decir ""
  Decir "NO CONECTO. Error exacto:"
  Decir ("   " + $_.Exception.Message)
  Decir ""
  Decir "Que mirar:"
  Decir "  - servidor en la 1a linea de modoc.ini: debe ser  .\SQLEXPRESS  (ajustar-modoc.bat lo pone)"
  Decir "  - habilitar-red-sql.bat (como administrador) si no lo corriste"
  Decir "  - la clave de sa: si dice 'Error de inicio de sesion' el servidor SI se alcanzo y la clave o el usuario no coinciden"
  exit 1
} finally {
  if ($c.State -eq 'Open') { $c.Close() }
}
