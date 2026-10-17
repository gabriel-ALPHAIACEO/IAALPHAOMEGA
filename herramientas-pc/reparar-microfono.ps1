# REPARAR EL MICROFONO DE WINDOWS 10 / 11
# Revisa y arregla, en este orden:
#   1. Privacidad: que Windows deje usar el microfono (usuario, equipo y politica)
#   2. Servicios de audio (Windows Audio y su Endpoint Builder): los reinicia
#   3. Microfonos DESACTIVADOS en Windows (Panel de sonido / Administrador de dispositivos): los activa
#   4. Microfonos SILENCIADOS o con volumen en 0: los activa y sube el volumen
#   5. (Con -Agresivo) reinicia el controlador de sonido
# Uso (PowerShell como ADMINISTRADOR):
#   powershell -ExecutionPolicy Bypass -File reparar-microfono.ps1                 -> diagnostica y repara
#   powershell -ExecutionPolicy Bypass -File reparar-microfono.ps1 -SoloDiagnostico -> solo mira, no cambia nada
#   powershell -ExecutionPolicy Bypass -File reparar-microfono.ps1 -Agresivo        -> ademas reinicia el controlador de audio
# No instala nada, no descarga nada y no toca ningun archivo fuera del registro de privacidad y los servicios de audio.
param(
  [switch]$SoloDiagnostico,
  [switch]$Agresivo
)
$ErrorActionPreference = "Continue"
$script:cambios = New-Object System.Collections.ArrayList
$script:problemas = New-Object System.Collections.ArrayList
$script:registro = Join-Path $PSScriptRoot "reparar-microfono-resultado.txt"
try { Set-Content -LiteralPath $script:registro -Value ("Reparar microfono - " + (Get-Date).ToString("yyyy-MM-dd HH:mm")) -Encoding ASCII } catch { }
function Decir([string]$t) {
  [Console]::WriteLine($t)
  try { Add-Content -LiteralPath $script:registro -Value $t -Encoding ASCII } catch { }
}
function Cambio([string]$t) { [void]$script:cambios.Add($t); Decir ("   [ARREGLADO] " + $t) }
function Problema([string]$t) { [void]$script:problemas.Add($t); Decir ("   [PROBLEMA]  " + $t) }
function Bien([string]$t) { Decir ("   [OK]        " + $t) }

$esAdmin = $false
try { $esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch { }
Decir "=== REPARAR EL MICROFONO ==="
if ($SoloDiagnostico) { Decir "(modo solo diagnostico: no se cambia nada)" }
if (-not $esAdmin) { Decir "ATENCION: no eres administrador. Algunos arreglos no se podran hacer. Abre PowerShell con clic derecho > Ejecutar como administrador." }

# ---------------------------------------------------------------- 1. PRIVACIDAD
Decir ""
Decir "--- 1. Privacidad: permiso de Windows para usar el microfono ---"
$base = "SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone"
foreach ($par in @(@("HKLM", "Todo el equipo"), @("HKCU", "Tu usuario"))) {
  foreach ($sub in @("", "\NonPackaged")) {
    try {
      $ruta = $par[0] + ":\" + $base + $sub
      $nombre = $par[1] + $(if ($sub) { " (programas de escritorio)" } else { " (apps de la Tienda)" })
      if (-not (Test-Path $ruta)) { Bien ("$nombre : sin restricciones guardadas"); continue }
      $v = (Get-ItemProperty -Path $ruta -Name Value -ErrorAction SilentlyContinue).Value
      if ($v -eq "Deny") {
        Problema "$nombre : el microfono esta BLOQUEADO (Deny)"
        if (-not $SoloDiagnostico) {
          if ($par[0] -eq "HKLM" -and -not $esAdmin) { Decir "      (hace falta administrador para cambiar esto)" }
          else { Set-ItemProperty -Path $ruta -Name Value -Value "Allow" -ErrorAction Stop; Cambio "$nombre : ahora esta permitido (Allow)" }
        }
      } else { Bien "$nombre : permitido ($v)" }
    } catch { Decir ("   (no se pudo revisar " + $par[0] + $sub + ": " + $_.Exception.Message + ")") }
  }
}
try {
  $pol = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\AppPrivacy"
  $p = (Get-ItemProperty -Path $pol -Name LetAppsAccessMicrophone -ErrorAction SilentlyContinue).LetAppsAccessMicrophone
  if ($p -eq 2) {
    Problema "Una POLITICA del equipo prohibe a las apps usar el microfono (LetAppsAccessMicrophone = 2)"
    if (-not $SoloDiagnostico -and $esAdmin) { Remove-ItemProperty -Path $pol -Name LetAppsAccessMicrophone -ErrorAction Stop; Cambio "Politica quitada: ahora decide el usuario" }
  } else { Bien "No hay politica que bloquee el microfono" }
} catch { Decir ("   (no se pudo revisar la politica: " + $_.Exception.Message + ")") }

# ---------------------------------------------------------------- 2. SERVICIOS
Decir ""
Decir "--- 2. Servicios de audio de Windows ---"
foreach ($s in @(@("AudioEndpointBuilder", "Windows Audio Endpoint Builder"), @("Audiosrv", "Windows Audio"))) {
  try {
    $svc = Get-Service -Name $s[0] -ErrorAction Stop
    if ($svc.Status -ne "Running") { Problema ($s[1] + " esta " + $svc.Status) } else { Bien ($s[1] + " funcionando") }
    if ($svc.StartType -ne "Automatic" -and -not $SoloDiagnostico -and $esAdmin) { Set-Service -Name $s[0] -StartupType Automatic; Cambio ($s[1] + ": inicio puesto en Automatico") }
  } catch { Problema ("No encuentro el servicio " + $s[1] + ": " + $_.Exception.Message) }
}
if (-not $SoloDiagnostico -and $esAdmin) {
  try {
    Restart-Service -Name AudioEndpointBuilder -Force -ErrorAction Stop
    Start-Sleep -Seconds 1
    Start-Service -Name Audiosrv -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Cambio "Servicios de audio reiniciados"
  } catch { Decir ("   (no se pudieron reiniciar los servicios: " + $_.Exception.Message + ")") }
}

# ---------------------------------------------------------------- 3. DISPOSITIVOS DESACTIVADOS
Decir ""
Decir "--- 3. Microfonos y tarjeta de sonido (Administrador de dispositivos) ---"
try {
  $ends = @(Get-PnpDevice -Class AudioEndpoint -ErrorAction Stop)
  $mics = @($ends | Where-Object { $_.FriendlyName -match "micr|mic\b|entrada|input|array|line in|auricular|headset" })
  if ($mics.Count -eq 0) { Problema "Windows no lista NINGUN microfono (ni activo ni desactivado). Puede ser el cable/conexion o el controlador de sonido." }
  foreach ($d in $mics) {
    Decir ("   - " + $d.FriendlyName + "  [estado: " + $d.Status + "]")
    if ($d.Status -eq "Error" -or $d.Problem -eq "CM_PROB_DISABLED" -or $d.ConfigManagerErrorCode -eq 22) {
      Problema ("'" + $d.FriendlyName + "' esta DESACTIVADO")
      if (-not $SoloDiagnostico -and $esAdmin) {
        try { Enable-PnpDevice -InstanceId $d.InstanceId -Confirm:$false -ErrorAction Stop; Cambio ("'" + $d.FriendlyName + "' activado") }
        catch { Decir ("      (no se pudo activar: " + $_.Exception.Message + ")") }
      }
    }
  }
} catch { Decir ("   (no se pudo leer la lista de dispositivos: " + $_.Exception.Message + ")") }
try {
  $tarjetas = @(Get-PnpDevice -Class MEDIA -ErrorAction Stop | Where-Object { $_.FriendlyName -notmatch "virtual|nvidia|intel.*display|hdmi|amd.*(high|streaming)" -or $_.Status -ne "OK" })
  foreach ($t in $tarjetas) {
    Decir ("   - Controlador: " + $t.FriendlyName + "  [estado: " + $t.Status + "]")
    if ($t.Status -ne "OK") { Problema ("El controlador '" + $t.FriendlyName + "' no esta bien (estado " + $t.Status + "). Prueba -Agresivo o reinstala el controlador del fabricante.") }
  }
  if ($Agresivo -and -not $SoloDiagnostico -and $esAdmin) {
    foreach ($t in ($tarjetas | Where-Object { $_.FriendlyName -notmatch "virtual" })) {
      try {
        Decir ("   Reiniciando el controlador '" + $t.FriendlyName + "' (el sonido se corta unos segundos)...")
        Disable-PnpDevice -InstanceId $t.InstanceId -Confirm:$false -ErrorAction Stop
        Start-Sleep -Seconds 2
        Enable-PnpDevice -InstanceId $t.InstanceId -Confirm:$false -ErrorAction Stop
        Cambio ("Controlador '" + $t.FriendlyName + "' reiniciado")
      } catch { Decir ("      (no se pudo: " + $_.Exception.Message + ")") }
    }
    try { Restart-Service -Name AudioEndpointBuilder -Force; Start-Sleep -Seconds 1; Start-Service Audiosrv -ErrorAction SilentlyContinue } catch { }
  }
} catch { Decir ("   (no se pudo leer la lista de controladores: " + $_.Exception.Message + ")") }

# ---------------------------------------------------------------- 4. SILENCIADO Y VOLUMEN
Decir ""
Decir "--- 4. Microfonos silenciados o con volumen en cero ---"
$cs = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace MicReparar {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorComObject { }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    int RegisterEndpointNotificationCallback(IntPtr client);
    int UnregisterEndpointNotificationCallback(IntPtr client);
  }

  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    int GetCount(out int count);
    int Item(int index, out IMMDevice device);
  }

  [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore { }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    int OpenPropertyStore(int access, out IPropertyStore props);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int state);
  }

  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out int count);
    int SetMasterVolumeLevel(float level, ref Guid context);
    int SetMasterVolumeLevelScalar(float level, ref Guid context);
    int GetMasterVolumeLevel(out float level);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
    int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
    int GetChannelVolumeLevel(uint channel, out float level);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  public class Mic {
    public string Id;
    public bool Silenciado;
    public float Volumen;
  }

  public static class Ayuda {
    const int CAPTURA = 1;      // eCapture
    const int ACTIVOS = 1;      // DEVICE_STATE_ACTIVE

    static IAudioEndpointVolume Volumen(IMMDevice d) {
      Guid iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
      object o;
      int r = d.Activate(ref iid, 23, IntPtr.Zero, out o);
      if (r != 0) return null;
      return (IAudioEndpointVolume)o;
    }

    public static List<Mic> Listar() {
      List<Mic> lista = new List<Mic>();
      IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDeviceCollection col;
      if (en.EnumAudioEndpoints(CAPTURA, ACTIVOS, out col) != 0) return lista;
      int n; col.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IMMDevice d; col.Item(i, out d);
        string id; d.GetId(out id);
        IAudioEndpointVolume v = Volumen(d);
        Mic m = new Mic();
        m.Id = id;
        if (v != null) {
          bool mute; float vol;
          v.GetMute(out mute); v.GetMasterVolumeLevelScalar(out vol);
          m.Silenciado = mute; m.Volumen = vol;
        }
        lista.Add(m);
      }
      return lista;
    }

    public static bool Arreglar(string id, float volumenMinimo) {
      IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice d;
      if (en.GetDevice(id, out d) != 0) return false;
      IAudioEndpointVolume v = Volumen(d);
      if (v == null) return false;
      Guid ctx = Guid.Empty;
      v.SetMute(false, ref ctx);
      float vol; v.GetMasterVolumeLevelScalar(out vol);
      if (vol < volumenMinimo) v.SetMasterVolumeLevelScalar(volumenMinimo, ref ctx);
      return true;
    }
  }
}
"@
$cargado = $false
try { Add-Type -TypeDefinition $cs -ErrorAction Stop; $cargado = $true } catch { Decir ("   (no se pudo cargar el modulo de audio: " + $_.Exception.Message + ")") }
if ($cargado) {
  try {
    $lista = [MicReparar.Ayuda]::Listar()
    if ($lista.Count -eq 0) { Problema "No hay ningun microfono ACTIVO en Windows (los desactivados o desconectados no cuentan)." }
    foreach ($m in $lista) {
      $guid = ($m.Id -split '\.')[-1]
      $nombre = $m.Id
      try {
        $props = Get-ItemProperty -Path ("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture\" + $guid + "\Properties") -ErrorAction Stop
        $n1 = $props."{a45c254e-df1c-4efd-8020-67d146a850e0},2"; $n2 = $props."{b3f8fa53-0004-438e-9003-51a46e139bfc},6"
        if ($n1 -and $n2) { $nombre = "$n1 ($n2)" } elseif ($n1) { $nombre = $n1 } elseif ($n2) { $nombre = $n2 }
      } catch { }
      $pct = [Math]::Round($m.Volumen * 100)
      Decir ("   - " + $nombre + "  [volumen " + $pct + " %, " + $(if ($m.Silenciado) { "SILENCIADO" } else { "con sonido" }) + "]")
      $mal = ($m.Silenciado -or $m.Volumen -lt 0.5)
      if ($m.Silenciado) { Problema "'$nombre' esta SILENCIADO" }
      if ($m.Volumen -lt 0.5) { Problema "'$nombre' tiene el volumen muy bajo ($pct %)" }
      if ($mal -and -not $SoloDiagnostico) {
        if ([MicReparar.Ayuda]::Arreglar($m.Id, [single]0.8)) { Cambio "'$nombre': sin silencio y volumen al 80 % como minimo" }
      }
    }
  } catch { Decir ("   (no se pudo revisar el volumen: " + $_.Exception.Message + ")") }
}

# ---------------------------------------------------------------- RESUMEN
Decir ""
Decir "=============== RESUMEN ==============="
Decir ("Arreglado: " + $script:cambios.Count + "   Problemas encontrados: " + $script:problemas.Count)
if ($script:cambios.Count -gt 0) { $script:cambios | ForEach-Object { Decir ("   + " + $_) } }
Decir ""
Decir "AHORA PRUEBA: Configuracion > Sistema > Sonido > Entrada: elige tu microfono y habla: la barra 'Probar el microfono' debe moverse."
Decir "Si usas una app (Zoom, Teams, Chrome, WhatsApp...), cierrala por completo y vuelve a abrirla."
if ($script:problemas.Count -gt 0 -and $script:cambios.Count -eq 0) {
  Decir ""
  Decir "No pude arreglar el problema solo. Siguientes pasos:"
  Decir "  1) Si Windows no lista ningun microfono: revisa el cable/conector (enchufa en otro puerto) y vuelve a correr con -Agresivo."
  Decir "  2) Actualiza o reinstala el controlador de sonido desde la pagina del fabricante del equipo (Realtek, etc.)."
  Decir "  3) Si es un microfono USB o Bluetooth: pruebalo en otra PC para descartar que este danado."
}
try { Start-Process "ms-settings:sound" } catch { }
