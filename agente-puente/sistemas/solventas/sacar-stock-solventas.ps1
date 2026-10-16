# Saca el stock de Solventas (SSCA) en CSV para el agente puente.
# SOLO LEE la base: un SELECT. No escribe nada en Solventas.
#
# Lo llama sacar-stock-solventas.bat. Se configura con variables de entorno
# (así la clave NO queda escrita en un archivo del agente):
#   SOLVENTAS_SERVIDOR   por defecto  .\SQLEXPRESS   (el de la primera línea de C:\SSCA\modoc.ini)
#   SOLVENTAS_BASE       por defecto  RRVS2013CA
#   SOLVENTAS_USUARIO    vacío = seguridad integrada de Windows (lo recomendado)
#   SOLVENTAS_CLAVE      solo si se usa usuario (mejor uno de SOLO LECTURA, nunca "sa")
#   SOLVENTAS_PRECIO     PVP1Prod (por defecto) | PVP2Prod | PVP3Prod | cifus | PVPBSF
#   SOLVENTAS_SOLO_CON_STOCK  "si" para no mandar lo que está en 0 (por defecto manda todo:
#                        un producto en 0 tiene que llegar como 0, si no la tienda cree que sigue igual)
#
# Salida: CSV en UTF-8, separado por ";", con encabezados codigo;producto;talla;color;cantidad;precio;marca;categoria;foto
# NO saca el costo (la tienda no lo necesita y no debe salir de la PC).
$ErrorActionPreference = "Stop"

function Variable($nombre, $porDefecto) {
  $v = [Environment]::GetEnvironmentVariable($nombre)
  if ([string]::IsNullOrWhiteSpace($v)) { return $porDefecto }
  return $v.Trim()
}

$servidor = Variable "SOLVENTAS_SERVIDOR" ".\SQLEXPRESS"
$base     = Variable "SOLVENTAS_BASE" "RRVS2013CA"
$usuario  = Variable "SOLVENTAS_USUARIO" ""
$clave    = Variable "SOLVENTAS_CLAVE" ""
$precio   = Variable "SOLVENTAS_PRECIO" "PVP1Prod"
$soloStock = (Variable "SOLVENTAS_SOLO_CON_STOCK" "no").ToLower() -in @("si", "sí", "1", "true")

# Solo estas columnas de precio (el nombre va dentro de la consulta: no se acepta cualquier cosa).
$preciosValidos = @("PVP1Prod", "PVP2Prod", "PVP3Prod", "cifus", "PVPBSF", "psiva")
$columnaPrecio = $preciosValidos | Where-Object { $_ -ieq $precio } | Select-Object -First 1
if (-not $columnaPrecio) { throw "SOLVENTAS_PRECIO no es válido ($precio). Usa uno de: $($preciosValidos -join ', ')." }

if ($usuario) {
  $cadena = "Server=$servidor;Database=$base;User ID=$usuario;Password=$clave;Connect Timeout=15;ApplicationIntent=ReadOnly"
} else {
  $cadena = "Server=$servidor;Database=$base;Integrated Security=SSPI;Connect Timeout=15;ApplicationIntent=ReadOnly"
}

$consulta = @"
SET NOCOUNT ON;
SELECT
  RTRIM(p.cb)                       AS codigo,
  RTRIM(p.DescProd)                 AS producto,
  RTRIM(p.TallaProd)                AS talla,
  RTRIM(p.ncolor)                   AS color,
  ISNULL(p.ExistProd, 0)            AS cantidad,
  p.$columnaPrecio                  AS precio,
  RTRIM(ISNULL(m.titulo, p.marca))  AS marca,
  RTRIM(c.titulo)                   AS categoria,
  RTRIM(p.foto)                     AS foto
FROM Productos p
LEFT JOIN marcas m     ON m.codigo = p.marca
LEFT JOIN categorias c ON c.seq = p.catego
WHERE p.cb IS NOT NULL AND LTRIM(RTRIM(p.cb)) <> ''
  AND p.DescProd IS NOT NULL
$(if ($soloStock) { "  AND ISNULL(p.ExistProd, 0) > 0" })
ORDER BY p.DescProd, p.ncolor, p.TallaProd
"@

# El dato va entre comillas solo cuando hace falta; ";" y saltos de línea dentro de un texto no rompen la fila.
function Celda($valor) {
  if ($null -eq $valor -or $valor -is [System.DBNull]) { return "" }
  if ($valor -is [decimal] -or $valor -is [double] -or $valor -is [single]) {
    return ([decimal]$valor).ToString("0.####", [Globalization.CultureInfo]::InvariantCulture)
  }
  $t = [string]$valor
  $t = $t -replace "[\r\n]+", " "
  if ($t.Contains(";") -or $t.Contains('"')) { return '"' + $t.Replace('"', '""') + '"' }
  return $t
}

$conexion = New-Object System.Data.SqlClient.SqlConnection($cadena)
$conexion.Open()
try {
  $orden = $conexion.CreateCommand()
  $orden.CommandText = $consulta
  $orden.CommandTimeout = 100
  $lector = $orden.ExecuteReader()
  $sb = New-Object System.Text.StringBuilder
  $encabezados = @()
  for ($i = 0; $i -lt $lector.FieldCount; $i++) { $encabezados += $lector.GetName($i) }
  [void]$sb.Append(($encabezados -join ";") + "`n")
  while ($lector.Read()) {
    $celdas = New-Object string[] $lector.FieldCount
    for ($i = 0; $i -lt $lector.FieldCount; $i++) { $celdas[$i] = Celda $lector.GetValue($i) }
    [void]$sb.Append(($celdas -join ";") + "`n")
  }
  $lector.Close()
} finally {
  $conexion.Close()
}

# UTF-8 SIN marca (BOM) por la salida estándar: así las ñ y las tildes llegan bien (con sqlcmd no).
$salida = [Console]::OpenStandardOutput()
$bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($sb.ToString())
$salida.Write($bytes, 0, $bytes.Length)
$salida.Flush()
