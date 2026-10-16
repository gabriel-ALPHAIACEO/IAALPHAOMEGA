# Ejecuta un archivo .sql contra SQL Server SIN necesitar sqlcmd (usa lo que Windows ya trae: .NET).
# Lo usan diagnostico.bat y reparar-base.bat. Entiende lo que usan esos .sql:
#   - lineas "GO" que separan bloques
#   - $(NOMBRE) que se reemplaza por una variable   (se pasan como NOMBRE=valor)
#   - ":On Error exit" -> al primer error se detiene (si no esta, sigue con el siguiente bloque)
# Uso:  powershell -File ejecutar-sql.ps1 -Servidor ".\SQLEXPRESS" -Archivo x.sql BASE=RRVS2013CA RESPALDO=C:\SSCA\respaldos
# Con -Probar solo comprueba que conecta y dice la version.
# Seguridad de Windows por defecto. Con un usuario de SQL: variables de entorno SOLVENTAS_USUARIO y SOLVENTAS_CLAVE.
# Codigo de salida: 0 = bien, 1 = fallo, 2 = no conecto.
param(
  [string]$Servidor = ".\SQLEXPRESS",
  [string]$Archivo = "",
  [switch]$Probar,
  [Parameter(ValueFromRemainingArguments = $true)] [string[]]$Var
)
$ErrorActionPreference = "Stop"

$script:salida = [Console]::OpenStandardOutput()
function Escribir([string]$texto) {
  $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($texto + "`r`n")
  $script:salida.Write($bytes, 0, $bytes.Length)
  $script:salida.Flush()
}

$usuario = [Environment]::GetEnvironmentVariable("SOLVENTAS_USUARIO")
$clave = [Environment]::GetEnvironmentVariable("SOLVENTAS_CLAVE")
if ($usuario) {
  $cadena = "Server=$Servidor;Database=master;User ID=$usuario;Password=$clave;Connect Timeout=20"
} else {
  $cadena = "Server=$Servidor;Database=master;Integrated Security=SSPI;Connect Timeout=20"
}

$conexion = New-Object System.Data.SqlClient.SqlConnection($cadena)
$conexion.add_InfoMessage({ param($s, $e) Escribir $e.Message })
try {
  $conexion.Open()
} catch {
  Escribir ("NO SE PUDO CONECTAR a '" + $Servidor + "': " + $_.Exception.Message)
  Escribir "Mira: que el servicio de SQL Server este iniciado, que el nombre del servidor sea el correcto, y ejecuta este archivo como Administrador."
  exit 2
}

try {
  if ($Probar) {
    $c = $conexion.CreateCommand()
    $c.CommandText = "SELECT CAST(SERVERPROPERTY('ProductVersion') AS varchar(30)) + ' ' + CAST(SERVERPROPERTY('Edition') AS varchar(60))"
    Escribir ("Conectado: SQL Server " + $c.ExecuteScalar())
    exit 0
  }

  if (-not (Test-Path -LiteralPath $Archivo)) { Escribir "No existe el archivo $Archivo"; exit 1 }
  $texto = [IO.File]::ReadAllText($Archivo)
  foreach ($par in $Var) {
    $i = $par.IndexOf("=")
    if ($i -gt 0) { $texto = $texto.Replace('$(' + $par.Substring(0, $i) + ')', $par.Substring($i + 1)) }
  }
  $parar = $texto -match '(?im)^\s*:on\s+error\s+exit'
  $texto = [regex]::Replace($texto, '(?im)^\s*:on\s+error\s+\w+\s*$', '')
  $bloques = [regex]::Split($texto, '(?im)^\s*GO\s*$')

  $hubo = 0
  foreach ($b in $bloques) {
    if ([string]::IsNullOrWhiteSpace($b)) { continue }
    try {
      $orden = $conexion.CreateCommand()
      $orden.CommandText = $b
      $orden.CommandTimeout = 0
      $lector = $orden.ExecuteReader()
      do {
        if ($lector.FieldCount -gt 0) {
          $nombres = @(); for ($i = 0; $i -lt $lector.FieldCount; $i++) { $nombres += $lector.GetName($i) }
          Escribir ($nombres -join "|")
          Escribir (($nombres | ForEach-Object { "-" * [Math]::Max(3, $_.Length) }) -join "|")
          while ($lector.Read()) {
            $f = @()
            for ($i = 0; $i -lt $lector.FieldCount; $i++) {
              $v = $lector.GetValue($i)
              if ($v -is [System.DBNull]) { $f += "NULL" }
              elseif ($v -is [bool]) { $f += [int]$v }
              elseif ($v -is [datetime]) { $f += $v.ToString("yyyy-MM-dd HH:mm:ss") }
              else { $f += ([string]$v).Trim() }
            }
            Escribir ($f -join "|")
          }
          Escribir ""
        }
      } while ($lector.NextResult())
      $lector.Close()
    } catch {
      $hubo++
      $m = $_.Exception.Message
      if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
      Escribir ("ERROR: " + $m)
      if ($parar) { Escribir "Se detiene aqui."; exit 1 }
    }
  }
  if ($hubo -gt 0 -and $parar) { exit 1 }
  exit 0
} finally {
  $conexion.Close()
}
