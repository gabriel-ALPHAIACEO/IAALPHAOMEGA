# Administrar los VENDEDORES de Solventas desde fuera del programa (Solventas no trae como borrarlos).
#   1) Ver vendedores     2) Eliminar vendedores     3) Agregar vendedor     4) Deshacer la ultima eliminacion
# Medidas de seguridad:
#   - antes de la primera eliminacion hace un RESPALDO de la base
#   - NO deja eliminar al ultimo vendedor (Solventas necesita al menos uno para facturar)
#   - guarda lo eliminado en una tabla propia (puente_vendedores_borrados): se puede DESHACER
#   - las facturas viejas NO cambian: cada factura guarda el nombre de su vendedor
# Solo toca la tabla Vendedor (y crea la tabla puente_vendedores_borrados). Hay que ser administrador.
# Lo llama vendedores.bat. Cierra Solventas en todas las PC antes de usarlo.
param(
  [string]$Servidor = ".\SQLEXPRESS",
  [string]$Base = "RRVS2013CA"
)
$ErrorActionPreference = "Stop"
function Decir([string]$t) { [Console]::WriteLine($t) }
function Q([string]$t) { return $t.Replace("'", "''") }

if ($Base -notmatch '^[A-Za-z0-9_]+$') { Decir "Nombre de base no valido: $Base"; exit 1 }
$u = [Environment]::GetEnvironmentVariable("SOLVENTAS_USUARIO"); $c0 = [Environment]::GetEnvironmentVariable("SOLVENTAS_CLAVE")
$cad = if ($u) { "Server=$Servidor;Database=$Base;User ID=$u;Password=$c0;Connect Timeout=20" } else { "Server=$Servidor;Database=$Base;Integrated Security=SSPI;Connect Timeout=20" }
$cn = New-Object System.Data.SqlClient.SqlConnection($cad)
try { $cn.Open() } catch {
  Decir ("NO SE PUDO CONECTAR a '" + $Servidor + "': " + $_.Exception.Message)
  Decir "Ejecutalo como Administrador y con SQL Server funcionando."
  exit 2
}
function Tabla([string]$sql) { $c = $cn.CreateCommand(); $c.CommandText = $sql; $c.CommandTimeout = 120; $t = New-Object System.Data.DataTable; $t.Load($c.ExecuteReader()); return ,$t }
function Escalar([string]$sql) { $c = $cn.CreateCommand(); $c.CommandText = $sql; $c.CommandTimeout = 120; $v = $c.ExecuteScalar(); if ($v -is [System.DBNull]) { return $null }; return $v }
function Ejecutar([string]$sql, $tx = $null) { $c = $cn.CreateCommand(); $c.CommandText = $sql; $c.CommandTimeout = 600; if ($tx) { $c.Transaction = $tx }; return $c.ExecuteNonQuery() }

# tabla propia para poder deshacer (no toca ninguna tabla de Solventas)
[void](Ejecutar "IF OBJECT_ID('dbo.puente_vendedores_borrados') IS NULL CREATE TABLE dbo.puente_vendedores_borrados (id int IDENTITY(1,1) PRIMARY KEY, lote uniqueidentifier NOT NULL, borrado datetime NOT NULL DEFAULT GETDATE(), quien nvarchar(128) NULL DEFAULT SUSER_SNAME(), restaurado bit NOT NULL DEFAULT 0, NroVend int, NomVend varchar(40), PorcComVend money, FechaCreaVend datetime, tipocomi varchar(1), montoxunidad money, usuario varchar(30), rif varchar(30), email varchar(50), ulventa datetime, ambos varchar(50))")

$script:respaldado = $false
$COLS = "NroVend, NomVend, PorcComVend, FechaCreaVend, tipocomi, montoxunidad, usuario, rif, email, ulventa, ambos"

function Mostrar {
  $t = Tabla "SELECT v.NroVend, v.NomVend, v.PorcComVend, (SELECT COUNT(*) FROM ventas s WHERE s.codvende = v.NroVend) AS Facturas, (SELECT CONVERT(varchar(10), MAX(s.fecha), 120) FROM ventas s WHERE s.codvende = v.NroVend) AS Ultima FROM Vendedor v ORDER BY v.NroVend"
  Decir ""
  Decir ("  Nro  Nombre                                    Comision  Facturas  Ultima venta")
  Decir ("  ---  ----------------------------------------  --------  --------  ------------")
  foreach ($r in $t.Rows) {
    $com = if ($r["PorcComVend"] -is [System.DBNull]) { "" } else { ([decimal]$r["PorcComVend"]).ToString("0.##") + " %" }
    $ult = if ($r["Ultima"] -is [System.DBNull]) { "-" } else { [string]$r["Ultima"] }
    Decir ("  " + ([string]$r["NroVend"]).PadLeft(3) + "  " + ([string]$r["NomVend"]).PadRight(40).Substring(0, 40) + "  " + $com.PadLeft(8) + "  " + ([string]$r["Facturas"]).PadLeft(8) + "  " + $ult)
  }
  Decir ("  Total: " + $t.Rows.Count + " vendedores")
  return $t.Rows.Count
}

function Respaldar {
  if ($script:respaldado) { return $true }
  $dir = $null
  try { $t = Tabla "EXEC master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer', N'BackupDirectory'"; if ($t.Rows.Count -gt 0) { $dir = [string]$t.Rows[0][1] } } catch { }
  if (-not $dir) { $d = [string](Escalar "SELECT physical_name FROM master.sys.database_files WHERE file_id = 1"); $i = [Math]::Max($d.LastIndexOf('\'), $d.LastIndexOf('/')); $dir = $d.Substring(0, $i + 1) }
  if (-not ($dir.EndsWith('\') -or $dir.EndsWith('/'))) { $dir = $dir + $(if ($dir.Contains('/') -and -not $dir.Contains('\')) { '/' } else { '\' }) }
  $arch = $dir + $Base + "_antes_de_quitar_vendedores_" + (Get-Date).ToString("yyyyMMdd_HHmmss") + ".bak"
  try {
    [void](Ejecutar ("BACKUP DATABASE [" + $Base + "] TO DISK = N'" + (Q $arch) + "' WITH INIT, CHECKSUM"))
    Decir "  Respaldo hecho en: $arch"
    $script:respaldado = $true
    return $true
  } catch {
    Decir ("  NO SE PUDO HACER EL RESPALDO: " + $_.Exception.Message)
    Decir "  Por seguridad no se elimina nada."
    return $false
  }
}

function Eliminar {
  $n = Mostrar
  Decir ""
  $txt = Read-Host "Numeros de los vendedores a ELIMINAR, separados por coma (ej: 3,5,7). Enter = cancelar"
  if (-not $txt -or -not $txt.Trim()) { Decir "  Cancelado."; return }
  $nums = @()
  foreach ($p in $txt.Split(',')) { $p = $p.Trim(); if ($p -eq "") { continue }; if ($p -notmatch '^\d{1,9}$') { Decir "  '$p' no es un numero. No se elimino nada."; return }; $nums += [int]$p }
  $nums = @($nums | Select-Object -Unique)
  $lista = $nums -join ","
  $t = Tabla "SELECT v.NroVend, v.NomVend, (SELECT COUNT(*) FROM ventas s WHERE s.codvende = v.NroVend) AS Facturas FROM Vendedor v WHERE v.NroVend IN ($lista) ORDER BY v.NroVend"
  $faltan = @($nums | Where-Object { $x = $_; -not ($t.Rows | Where-Object { [int]$_["NroVend"] -eq $x }) })
  if ($faltan.Count -gt 0) { Decir ("  No existen los vendedores: " + ($faltan -join ", ") + ". No se elimino nada."); return }
  if ($t.Rows.Count -ge $n) { Decir "  No se puede eliminar a TODOS: Solventas necesita al menos un vendedor para facturar. Deja uno."; return }
  Decir ""
  Decir "  Se van a eliminar:"
  foreach ($r in $t.Rows) { Decir ("    " + $r["NroVend"] + "  " + $r["NomVend"] + "   (" + $r["Facturas"] + " facturas; esas facturas conservan su nombre)") }
  Decir ("  Quedaran " + ($n - $t.Rows.Count) + " vendedores.")
  $ok = Read-Host "Escribe SI para eliminar"
  if ($ok.Trim().ToUpper() -ne "SI") { Decir "  Cancelado. No se elimino nada."; return }
  if (-not (Respaldar)) { return }
  $tx = $cn.BeginTransaction()
  try {
    $lote = [guid]::NewGuid().ToString()
    [void](Ejecutar "INSERT INTO puente_vendedores_borrados (lote, $COLS) SELECT '$lote', $COLS FROM Vendedor WHERE NroVend IN ($lista)" $tx)
    $b = Ejecutar "DELETE FROM Vendedor WHERE NroVend IN ($lista)" $tx
    $tx.Commit()
    Decir "  LISTO: eliminados $b vendedor(es). (Se puede deshacer con la opcion 4.)"
  } catch { $tx.Rollback(); Decir ("  ERROR, no se cambio nada: " + $_.Exception.Message) }
}

function Agregar {
  $nom = (Read-Host "Nombre del vendedor nuevo (Enter = cancelar)").Trim().ToUpper()
  if (-not $nom) { Decir "  Cancelado."; return }
  if ($nom.Length -gt 40) { Decir "  Maximo 40 letras."; return }
  $ya = [int](Escalar ("SELECT COUNT(*) FROM Vendedor WHERE UPPER(LTRIM(RTRIM(NomVend))) = N'" + (Q $nom) + "'"))
  if ($ya -gt 0) { Decir "  Ya existe un vendedor con ese nombre."; return }
  $pct = Read-Host "Porcentaje de comision (Enter = 0)"
  $p = 0
  if ($pct -and $pct.Trim()) { if (-not [decimal]::TryParse($pct.Trim().Replace(",", "."), [Globalization.NumberStyles]::Number, [Globalization.CultureInfo]::InvariantCulture, [ref]$p) -or $p -lt 0 -or $p -gt 100) { Decir "  Porcentaje no valido."; return } }
  $nro = [int](Escalar "SELECT ISNULL(MAX(NroVend), 0) + 1 FROM Vendedor")
  $pinv = $p.ToString([Globalization.CultureInfo]::InvariantCulture)
  [void](Ejecutar ("INSERT INTO Vendedor (NroVend, NomVend, PorcComVend, FechaCreaVend, tipocomi, montoxunidad, usuario, rif, email, ulventa, ambos) VALUES (" + $nro + ", N'" + (Q $nom) + "', " + $pinv + ", GETDATE(), 'P', 0, 'N', '', NULL, NULL, N'" + (Q ([string]$nro + " " + $nom)) + "')"))
  Decir "  LISTO: agregado el vendedor $nro  $nom  ($pinv %)."
}

function Deshacer {
  $l = Escalar "SELECT TOP 1 CONVERT(varchar(36), lote) FROM puente_vendedores_borrados WHERE restaurado = 0 ORDER BY id DESC"
  if (-not $l) { Decir "  No hay nada que deshacer."; return }
  $t = Tabla "SELECT NroVend, NomVend FROM puente_vendedores_borrados WHERE lote = '$l' AND restaurado = 0 ORDER BY NroVend"
  Decir "  La ultima eliminacion fue de:"
  foreach ($r in $t.Rows) { Decir ("    " + $r["NroVend"] + "  " + $r["NomVend"]) }
  $ok = Read-Host "Escribe SI para volver a ponerlos"
  if ($ok.Trim().ToUpper() -ne "SI") { Decir "  Cancelado."; return }
  $tx = $cn.BeginTransaction()
  try {
    $b = Ejecutar "INSERT INTO Vendedor ($COLS) SELECT $COLS FROM puente_vendedores_borrados p WHERE p.lote = '$l' AND p.restaurado = 0 AND NOT EXISTS (SELECT 1 FROM Vendedor v WHERE v.NroVend = p.NroVend)" $tx
    [void](Ejecutar "UPDATE puente_vendedores_borrados SET restaurado = 1 WHERE lote = '$l'" $tx)
    $tx.Commit()
    Decir "  LISTO: vueltos a poner $b vendedor(es)."
  } catch { $tx.Rollback(); Decir ("  ERROR, no se cambio nada: " + $_.Exception.Message) }
}

Decir "=== VENDEDORES DE SOLVENTAS ($Base en $Servidor) ==="
Decir "Cierra Solventas en todas las PC antes de cambiar vendedores."
try {
  for (;;) {
    Decir ""
    Decir "  1 = Ver vendedores    2 = Eliminar vendedores    3 = Agregar un vendedor    4 = Deshacer la ultima eliminacion    0 = Salir"
    $op = (Read-Host "Que quieres hacer").Trim()
    switch ($op) {
      "1" { [void](Mostrar) }
      "2" { Eliminar }
      "3" { Agregar }
      "4" { Deshacer }
      "0" { Decir "Hasta luego."; exit 0 }
      default { Decir "  Escribe 1, 2, 3, 4 o 0." }
    }
  }
} finally { $cn.Close() }
