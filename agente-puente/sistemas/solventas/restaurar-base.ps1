# Restaura la base de Solventas (un respaldo .bak) en un SQL Server NUEVO (por ejemplo, el de Windows 11).
# Lo llama restaurar-base.bat. Hace, en orden:
#   1. restaura el respaldo (la base queda con el nombre -Base)
#   2. apaga AUTO_CLOSE y AUTO_SHRINK, activa CHECKSUM y revisa que no haya paginas danadas
#   3. crea los indices (llama a reparar-base.sql con ejecutar-sql.ps1, que deben estar en esta carpeta)
#   4. deja listo el usuario "sa" (modo mixto + la clave que usa Solventas, que se escribe aqui, NO queda en ningun archivo)
#   5. comprueba que Solventas podra entrar con "sa"
# Uso:  powershell -File restaurar-base.ps1 -Respaldo "C:\ruta\RRVS2013CA-hoy.bak" [-Servidor ".\SQLEXPRESS"] [-Base RRVS2013CA] [-Reemplazar] [-SinSa]
#   -Reemplazar : la base ya existe aqui; se hace antes un respaldo de ella y se sustituye.
#   -SinSa      : no toca el usuario sa.
#   -NoCopiar   : no copia el .bak a la carpeta de respaldos de SQL Server (solo para pruebas).
# Seguridad de Windows por defecto (hay que ser administrador). Codigo de salida: 0 bien, 1 fallo, 2 no conecto, 3 la base ya existe.
# Deja un registro (sin claves) en restaurar-base-resultado.txt, junto a este archivo.
param(
  [string]$Respaldo = "",
  [string]$Servidor = ".\SQLEXPRESS",
  [string]$Base = "RRVS2013CA",
  [switch]$Reemplazar,
  [switch]$SinSa,
  [switch]$NoCopiar
)
$ErrorActionPreference = "Stop"

$script:registro = Join-Path $PSScriptRoot "restaurar-base-resultado.txt"
try { Set-Content -LiteralPath $script:registro -Value ("Traslado de Solventas - " + (Get-Date).ToString("yyyy-MM-dd HH:mm")) -Encoding ASCII } catch { }
function Decir([string]$t) {
  [Console]::WriteLine($t)
  try { Add-Content -LiteralPath $script:registro -Value $t -Encoding ASCII } catch { }
}
function Cadena([string]$bd, [string]$usuario, [string]$clave) {
  if ($usuario) { return "Server=$Servidor;Database=$bd;User ID=$usuario;Password=$clave;Connect Timeout=20" }
  return "Server=$Servidor;Database=$bd;Integrated Security=SSPI;Connect Timeout=20"
}
function Abrir([string]$bd, [string]$usuario, [string]$clave) {
  $cn = New-Object System.Data.SqlClient.SqlConnection((Cadena $bd $usuario $clave))
  $cn.add_InfoMessage({ param($s, $e) Decir ("   " + $e.Message) })
  $cn.Open()
  return $cn
}
function Tabla($cn, [string]$sql) {
  $c = $cn.CreateCommand(); $c.CommandText = $sql; $c.CommandTimeout = 0
  $t = New-Object System.Data.DataTable
  $t.Load($c.ExecuteReader())
  return ,$t
}
function Escalar($cn, [string]$sql) {
  $c = $cn.CreateCommand(); $c.CommandText = $sql; $c.CommandTimeout = 0
  $v = $c.ExecuteScalar()
  if ($v -is [System.DBNull]) { return $null }
  return $v
}
function Ejecutar($cn, [string]$sql) {
  $c = $cn.CreateCommand(); $c.CommandText = $sql; $c.CommandTimeout = 0
  [void]$c.ExecuteNonQuery()
}
function Q([string]$t) { return $t.Replace("'", "''") }
function Carpeta([string]$ruta) {
  $i = [Math]::Max($ruta.LastIndexOf('\'), $ruta.LastIndexOf('/'))
  if ($i -lt 0) { return "" }
  return $ruta.Substring(0, $i + 1)
}
function ConBarra([string]$ruta) {
  if ($ruta.EndsWith('\') -or $ruta.EndsWith('/')) { return $ruta }
  if ($ruta.Contains('/') -and -not $ruta.Contains('\')) { return $ruta + '/' }
  return $ruta + '\'
}

$usuario = [Environment]::GetEnvironmentVariable("SOLVENTAS_USUARIO")
$claveEnv = [Environment]::GetEnvironmentVariable("SOLVENTAS_CLAVE")

if ($Base -notmatch '^[A-Za-z0-9_]+$') { Decir "El nombre de la base solo puede llevar letras, numeros y _ ($Base)."; exit 1 }
if (-not $Respaldo) { Decir "Falta -Respaldo (la ruta del archivo .bak)."; exit 1 }
if (-not (Test-Path -LiteralPath $Respaldo)) { Decir "No existe el archivo: $Respaldo"; exit 1 }

Decir "=== 1. CONECTANDO A $Servidor ==="
try { $cn = Abrir "master" $usuario $claveEnv }
catch {
  Decir ("NO SE PUDO CONECTAR a '" + $Servidor + "': " + $_.Exception.Message)
  Decir "Mira: que SQL Server este instalado e iniciado, que la instancia se llame asi, y ejecuta esto como Administrador."
  exit 2
}
try {
  Decir ("SQL Server " + (Escalar $cn "SELECT CAST(SERVERPROPERTY('ProductVersion') AS varchar(30)) + ' ' + CAST(SERVERPROPERTY('Edition') AS varchar(60))"))

  # --- carpetas de la instancia
  $dirDatos = Escalar $cn "SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(260))"
  if (-not $dirDatos) { $dirDatos = Carpeta ([string](Escalar $cn "SELECT physical_name FROM master.sys.database_files WHERE file_id = 1")) }
  $dirLog = Escalar $cn "SELECT CAST(SERVERPROPERTY('InstanceDefaultLogPath') AS nvarchar(260))"
  if (-not $dirLog) { $dirLog = $dirDatos }
  $dirDatos = ConBarra $dirDatos; $dirLog = ConBarra $dirLog
  $dirResp = $null
  try {
    $t = Tabla $cn "EXEC master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer', N'BackupDirectory'"
    if ($t.Rows.Count -gt 0) { $dirResp = [string]$t.Rows[0][1] }
  } catch { }
  if (-not $dirResp) { $dirResp = $dirDatos }
  $dirResp = ConBarra $dirResp

  # --- la base ya existe?
  $existe = [int](Escalar $cn "SELECT COUNT(*) FROM sys.databases WHERE name = N'$Base'")
  if ($existe -gt 0 -and -not $Reemplazar) {
    Decir "Ya existe una base llamada $Base en este servidor. No se toca."
    Decir "Si quieres sustituirla por este respaldo, repite agregando -Reemplazar (antes se hace un respaldo de la actual)."
    exit 3
  }
  if ($existe -gt 0) {
    $sello = (Get-Date).ToString("yyyyMMdd_HHmmss")
    $previo = $dirResp + $Base + "_antes_de_reemplazar_" + $sello + ".bak"
    Decir "=== Respaldo de la base actual antes de reemplazarla ==="
    Ejecutar $cn ("BACKUP DATABASE [" + $Base + "] TO DISK = N'" + (Q $previo) + "' WITH INIT, CHECKSUM")
    Decir "   Guardado en: $previo"
  }

  # --- el .bak tiene que poder leerlo el servicio de SQL Server: se deja en su carpeta de respaldos
  $archivo = $Respaldo
  if (-not $NoCopiar) {
    $archivo = $dirResp + "RRVS_traslado_" + (Get-Date).ToString("yyyyMMdd_HHmmss") + ".bak"
    Copy-Item -LiteralPath $Respaldo -Destination $archivo -Force
    Decir "   El respaldo se copio a: $archivo"
  }

  Decir "=== 2. RESTAURANDO ==="
  $lista = Tabla $cn ("RESTORE FILELISTONLY FROM DISK = N'" + (Q $archivo) + "'")
  if ($lista.Rows.Count -eq 0) { Decir "El archivo no parece un respaldo de SQL Server."; exit 1 }
  $mueve = @(); $nd = 0; $nl = 0
  foreach ($f in $lista.Rows) {
    if ($f["Type"] -eq "L") {
      $nl++; $nombre = if ($nl -eq 1) { "${Base}_log.ldf" } else { "${Base}_log$nl.ldf" }
      $mueve += ("MOVE N'" + (Q $f["LogicalName"]) + "' TO N'" + (Q ($dirLog + $nombre)) + "'")
    } elseif ($f["Type"] -eq "D") {
      $nd++; $nombre = if ($nd -eq 1) { "$Base.mdf" } else { "${Base}_$nd.ndf" }
      $mueve += ("MOVE N'" + (Q $f["LogicalName"]) + "' TO N'" + (Q ($dirDatos + $nombre)) + "'")
    }
  }
  if ($existe -gt 0) { Ejecutar $cn ("ALTER DATABASE [" + $Base + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE") }
  $sql = "RESTORE DATABASE [" + $Base + "] FROM DISK = N'" + (Q $archivo) + "' WITH " + ($mueve -join ", ") + ", STATS = 25"
  if ($existe -gt 0) { $sql += ", REPLACE" }
  Ejecutar $cn $sql
  Ejecutar $cn ("ALTER DATABASE [" + $Base + "] SET MULTI_USER")
  Decir "   Base restaurada."

  Decir "=== 3. OPCIONES Y REVISION ==="
  Ejecutar $cn ("ALTER DATABASE [" + $Base + "] SET AUTO_CLOSE OFF")
  Ejecutar $cn ("ALTER DATABASE [" + $Base + "] SET AUTO_SHRINK OFF")
  Ejecutar $cn ("ALTER DATABASE [" + $Base + "] SET PAGE_VERIFY CHECKSUM")
  try {
    Ejecutar $cn ("DBCC CHECKDB ([" + $Base + "]) WITH NO_INFOMSGS")
    Decir "   Revision de paginas: sin problemas."
  } catch {
    Decir ("   ADVERTENCIA en la revision de la base: " + $_.Exception.Message)
  }
}
finally { $cn.Close() }

# --- indices y estadisticas (reusa reparar-base.sql)
Decir "=== 4. INDICES Y ESTADISTICAS ==="
$runner = Join-Path $PSScriptRoot "ejecutar-sql.ps1"
$repara = Join-Path $PSScriptRoot "reparar-base.sql"
if ((Test-Path -LiteralPath $runner) -and (Test-Path -LiteralPath $repara)) {
  $yo = (Get-Process -Id $PID).Path
  $dirRespHijo = $dirResp
  & $yo -NoProfile -ExecutionPolicy Bypass -File $runner -Servidor $Servidor -Archivo $repara "BASE=$Base" "RESPALDO=$dirRespHijo" | ForEach-Object { Decir ("   " + $_) }
  if ($LASTEXITCODE -ne 0) { Decir "   (los indices no se pudieron crear; la base esta restaurada. Corre reparar-base.bat despues.)" }
} else {
  Decir "   No estan ejecutar-sql.ps1 y reparar-base.sql junto a este archivo: se salta. Corre reparar-base.bat despues."
}

# --- usuario sa
$sa = "no se toco"
if (-not $SinSa) {
  Decir "=== 5. USUARIO sa (el que usa Solventas) ==="
  $cn = Abrir "master" $usuario $claveEnv
  $reinicio = $false
  try {
    $soloWindows = [int](Escalar $cn "SELECT CAST(SERVERPROPERTY('IsIntegratedSecurityOnly') AS int)")
    $claveSa = [Environment]::GetEnvironmentVariable("SOLVENTAS_SA_NUEVA")
    if (-not $claveSa) {
      $a = Read-Host "Escribe la clave de sa (la que usa Solventas)" -AsSecureString
      $b = Read-Host "Escribela otra vez" -AsSecureString
      $pa = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($a))
      $pb = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($b))
      if ($pa -ne $pb -or -not $pa) { Decir "Las dos claves no coinciden (o estan vacias). No se toco sa."; $pa = $null; $claveSa = $null }
      else { $claveSa = $pa }
    }
    if ($claveSa) {
      if ($soloWindows -eq 1) {
        Ejecutar $cn "EXEC master.dbo.xp_instance_regwrite N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer', N'LoginMode', REG_DWORD, 2"
        $reinicio = $true
        Decir "   Se activo el modo mixto (entrar con usuario y clave de SQL)."
      }
      Ejecutar $cn "ALTER LOGIN sa ENABLE"
      Ejecutar $cn ("ALTER LOGIN sa WITH PASSWORD = N'" + (Q $claveSa) + "', CHECK_POLICY = OFF, CHECK_EXPIRATION = OFF")
      Decir "   sa activado con la clave que escribiste."
    }
  }
  finally { $cn.Close() }

  if ($claveSa) {
    if ($reinicio) {
      $inst = $null
      if ($Servidor -match '\\(.+)$') { $inst = $Matches[1] }
      $servicio = if ($inst) { 'MSSQL$' + $inst } else { 'MSSQLSERVER' }
      Decir "   Reiniciando el servicio $servicio (para que el modo mixto cuente)..."
      Restart-Service -Name $servicio -Force
    }
    $ok = $false
    for ($i = 0; $i -lt 15 -and -not $ok; $i++) {
      try {
        $cs = Abrir $Base "sa" $claveSa
        try {
          $n = Escalar $cs "SELECT COUNT(*) FROM Productos"
          $v = Escalar $cs "SELECT CONVERT(varchar(10), MAX(fecha), 120) FROM ventas"
          Decir "   COMPRUEBA: entrando como sa a ${Base}: $n productos, ultima venta $v."
          $ok = $true
        } finally { $cs.Close() }
      } catch { Start-Sleep -Seconds 4; $ultimo = $_.Exception.Message }
    }
    if ($ok) { $sa = "listo y comprobado" } else { $sa = "NO se pudo comprobar: $ultimo"; }
  }
}

Decir ""
Decir "================ RESUMEN ================"
Decir "Base restaurada: $Base en $Servidor"
Decir "Usuario sa: $sa"
Decir "Siguiente: ajustar-modoc.bat, registrar-vmax.bat y abrir Solventas."
if ($sa -like "NO se pudo*") { exit 1 }
exit 0
