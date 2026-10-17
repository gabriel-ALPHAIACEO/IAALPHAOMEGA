# Le da al AGENTE PUENTE permiso para LEER (solo leer) la base de Solventas, sin guardar ninguna clave.
# El agente corre como "NT AUTHORITY\SYSTEM" (la tarea programada de Windows): SQL Server 2022 no lo deja
# entrar por defecto. Este script crea ese acceso con el rol db_datareader: puede LEER, no puede escribir,
# borrar ni cambiar nada. Hay que ser administrador. Lo llama dar-lectura-al-agente.bat
param(
  [string]$Servidor = ".\SQLEXPRESS",
  [string]$Base = "RRVS2013CA",
  [string]$Cuenta = "NT AUTHORITY\SYSTEM"
)
$ErrorActionPreference = "Stop"
function Decir([string]$t) { [Console]::WriteLine($t) }
function Abrir([string]$bd) {
  $u = [Environment]::GetEnvironmentVariable("SOLVENTAS_USUARIO"); $c = [Environment]::GetEnvironmentVariable("SOLVENTAS_CLAVE")
  $cad = if ($u) { "Server=$Servidor;Database=$bd;User ID=$u;Password=$c;Connect Timeout=20" } else { "Server=$Servidor;Database=$bd;Integrated Security=SSPI;Connect Timeout=20" }
  $cn = New-Object System.Data.SqlClient.SqlConnection($cad); $cn.Open(); return $cn
}
function Ejecutar($cn, [string]$sql) { $c = $cn.CreateCommand(); $c.CommandText = $sql; [void]$c.ExecuteNonQuery() }
function Escalar($cn, [string]$sql) { $c = $cn.CreateCommand(); $c.CommandText = $sql; return $c.ExecuteScalar() }
function Q([string]$t) { return $t.Replace("'", "''") }
function Corchetes([string]$t) { return "[" + $t.Replace("]", "]]") + "]" }

if ($Base -notmatch '^[A-Za-z0-9_]+$') { Decir "Nombre de base no valido: $Base"; exit 1 }
try {
  Decir "=== Dandole lectura al agente puente ($Cuenta) en $Base ==="
  $cn = Abrir "master"
  try {
    $hay = [int](Escalar $cn "SELECT COUNT(*) FROM sys.server_principals WHERE name = N'$(Q $Cuenta)'")
    if ($hay -eq 0) {
      Ejecutar $cn ("CREATE LOGIN " + (Corchetes $Cuenta) + " FROM WINDOWS")
      Decir "   Acceso al servidor creado para $Cuenta."
    } else { Decir "   $Cuenta ya tenia acceso al servidor." }
  } finally { $cn.Close() }

  $cb = Abrir $Base
  try {
    $hay = [int](Escalar $cb "SELECT COUNT(*) FROM sys.database_principals WHERE name = N'$(Q $Cuenta)'")
    if ($hay -eq 0) {
      Ejecutar $cb ("CREATE USER " + (Corchetes $Cuenta) + " FOR LOGIN " + (Corchetes $Cuenta))
      Decir "   Usuario creado en la base $Base."
    } else { Decir "   $Cuenta ya era usuario de la base $Base." }
    Ejecutar $cb ("EXEC sp_addrolemember N'db_datareader', N'" + (Q $Cuenta) + "'")
    $es = [int](Escalar $cb ("SELECT ISNULL(IS_ROLEMEMBER('db_datareader', N'" + (Q $Cuenta) + "'), 0)"))
    $escribe = [int](Escalar $cb ("SELECT ISNULL(IS_ROLEMEMBER('db_datawriter', N'" + (Q $Cuenta) + "'), 0) + ISNULL(IS_ROLEMEMBER('db_owner', N'" + (Q $Cuenta) + "'), 0)"))
    if ($es -eq 1) { Decir "   Rol de SOLO LECTURA (db_datareader) puesto." } else { Decir "   ATENCION: no quedo en el rol de lectura."; exit 1 }
    if ($escribe -ne 0) { Decir "   ATENCION: esa cuenta ademas puede escribir en la base (db_datawriter o db_owner). Revisalo." }
  } finally { $cb.Close() }
  Decir "LISTO. El agente puente ya puede leer el stock de $Base (y nada mas)."
  exit 0
} catch {
  Decir ("ERROR: " + $_.Exception.Message)
  Decir "Ejecutalo como Administrador. Si sigue igual, copiame este mensaje."
  exit 1
}
