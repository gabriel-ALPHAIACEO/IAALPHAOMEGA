# Enciende lo que el conector viejo de Solventas (SQLOLEDB / DBNETLIB) necesita para hablar con SQL Server:
#   - protocolo Named Pipes y TCP/IP de la instancia
#   - el servicio "SQL Server Browser" (en automatico)
# y reinicia SQL Server. No toca ninguna base de datos. Hay que ser administrador.
# Lo llama habilitar-red-sql.bat
param([string]$Instancia = "SQLEXPRESS")
$ErrorActionPreference = "Stop"
function Decir([string]$t) { [Console]::WriteLine($t) }
try {
  $nombres = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
  $id = $nombres.$Instancia
  if (-not $id) { Decir "No encontre la instancia $Instancia. Instancias que hay:"; $nombres.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { Decir ("  " + $_.Name + " -> " + $_.Value) }; exit 1 }
  Decir "Instancia $Instancia = $id"
  $red = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$id\MSSQLServer\SuperSocketNetLib"
  foreach ($p in @("Np", "Tcp")) {
    $antes = (Get-ItemProperty "$red\$p").Enabled
    Set-ItemProperty -Path "$red\$p" -Name Enabled -Value 1
    Decir ("Protocolo " + $p + ": estaba " + $antes + ", ahora 1 (activado)")
  }
  Set-Service -Name SQLBrowser -StartupType Automatic
  if ((Get-Service SQLBrowser).Status -ne "Running") { Start-Service SQLBrowser }
  Decir "Servicio SQL Server Browser: automatico y funcionando."
  $servicio = 'MSSQL$' + $Instancia
  Decir "Reiniciando $servicio (tarda unos segundos)..."
  Restart-Service -Name $servicio -Force
  Start-Sleep -Seconds 3
  Decir ("Estado de " + $servicio + ": " + (Get-Service $servicio).Status)
  Decir "LISTO. Ahora corre probar-conexion.bat y despues abre Solventas."
  exit 0
} catch {
  Decir ("ERROR: " + $_.Exception.Message)
  Decir "Ejecutalo como Administrador. Si sigue igual, copiame este mensaje."
  exit 1
}
