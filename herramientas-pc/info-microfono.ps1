# INFORMACION Y PRUEBA DE SENAL DEL MICROFONO (solo lee, NO cambia nada)
# Hace, en orden:
#   1. Datos de la PC (marca, modelo, BIOS, Windows)
#   2. Dispositivos de audio y su controlador (proveedor, version, fecha, ID de hardware)
#   3. Dispositivos con problemas en todo el equipo (los del triangulo amarillo)
#   4. PRUEBA EN VIVO: durante 10 segundos mide si llega SENAL a cada microfono activo. Hay que HABLAR FUERTE.
# Deja todo en info-microfono-resultado.txt (junto a este archivo). No contiene claves ni datos personales.
$ErrorActionPreference = "Continue"
$script:registro = Join-Path $PSScriptRoot "info-microfono-resultado.txt"
try { Set-Content -LiteralPath $script:registro -Value ("Info microfono - " + (Get-Date).ToString("yyyy-MM-dd HH:mm")) -Encoding ASCII } catch { }
function Decir([string]$t) {
  [Console]::WriteLine($t)
  try { Add-Content -LiteralPath $script:registro -Value $t -Encoding ASCII } catch { }
}
function Prop($id, [string]$clave) { try { return [string](Get-PnpDeviceProperty -InstanceId $id -KeyName $clave -ErrorAction Stop).Data } catch { return "?" } }

Decir "=== 1. TU PC ==="
try {
  $cs = Get-CimInstance Win32_ComputerSystem
  Decir ("Marca/modelo : " + $cs.Manufacturer + " / " + $cs.Model)
  $tipo = @{ 1 = "Escritorio"; 2 = "Portatil"; 3 = "Estacion"; 4 = "Escritorio (torre)"; 8 = "Portatil"; 9 = "Portatil"; 10 = "Portatil"; 14 = "Portatil" }
  $ch = (Get-CimInstance Win32_SystemEnclosure).ChassisTypes | Select-Object -First 1
  Decir ("Tipo         : " + $(if ($tipo.ContainsKey([int]$ch)) { $tipo[[int]$ch] } else { "codigo $ch" }))
  $b = Get-CimInstance Win32_BIOS
  Decir ("BIOS         : " + $b.Manufacturer + " " + $b.SMBIOSBIOSVersion + " (" + $b.ReleaseDate + ")")
  $os = Get-CimInstance Win32_OperatingSystem
  Decir ("Windows      : " + $os.Caption + " build " + $os.BuildNumber)
} catch { Decir ("(no se pudo leer: " + $_.Exception.Message + ")") }

Decir ""
Decir "=== 2. DISPOSITIVOS DE AUDIO Y SU CONTROLADOR ==="
try {
  $lista = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.Class -in @("MEDIA", "AudioEndpoint") -or $_.FriendlyName -match "audio|sonido|micr|smart sound|realtek|sst" })
  foreach ($d in ($lista | Sort-Object Class, FriendlyName)) {
    $hw = ""
    try { $hw = [string]((Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName "DEVPKEY_Device_HardwareIds" -ErrorAction Stop).Data | Select-Object -First 1) } catch { }
    Decir ("- [" + $d.Class + "] " + $d.FriendlyName + "   estado=" + $d.Status)
    if ($d.Class -ne "AudioEndpoint") {
      Decir ("     controlador: " + (Prop $d.InstanceId "DEVPKEY_Device_DriverProvider") + "  v" + (Prop $d.InstanceId "DEVPKEY_Device_DriverVersion") + "  (" + (Prop $d.InstanceId "DEVPKEY_Device_DriverDate") + ")")
      if ($hw) { Decir ("     hardware: " + $hw) }
    }
  }
} catch { Decir ("(no se pudo leer: " + $_.Exception.Message + ")") }

Decir ""
Decir "=== 3. DISPOSITIVOS CON PROBLEMAS EN TODO EL EQUIPO ==="
try {
  $mal = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.Status -eq "Error" })
  if ($mal.Count -eq 0) { Decir "Ninguno." }
  foreach ($d in $mal) { Decir ("- [" + $d.Class + "] " + $d.FriendlyName + "  problema=" + $d.Problem) }
} catch { Decir ("(no se pudo leer: " + $_.Exception.Message + ")") }

Decir ""
Decir "=== 4. PRUEBA EN VIVO DE SENAL ==="
$cs2 = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace MicInfo {
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

  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation {
    int GetPeakValue(out float peak);
    int GetMeteringChannelCount(out int count);
    int GetChannelsPeakValues(int count, [Out, MarshalAs(UnmanagedType.LPArray)] float[] peaks);
    int QueryHardwareSupport(out int mask);
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
    public float Pico;
    public IntPtr Medidor;
  }

  public static class Ayuda {
    static object Activar(IMMDevice d, string guid) {
      Guid iid = new Guid(guid);
      object o;
      int r = d.Activate(ref iid, 23, IntPtr.Zero, out o);
      if (r != 0) return null;
      return o;
    }

    // Devuelve los microfonos ACTIVOS con su silencio y volumen.
    public static List<Mic> Listar() {
      List<Mic> lista = new List<Mic>();
      IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDeviceCollection col;
      if (en.EnumAudioEndpoints(1, 1, out col) != 0) return lista;
      int n; col.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IMMDevice d; col.Item(i, out d);
        string id; d.GetId(out id);
        Mic m = new Mic();
        m.Id = id;
        IAudioEndpointVolume v = Activar(d, "5CDF2C82-841E-4546-9722-0CF74078229A") as IAudioEndpointVolume;
        if (v != null) {
          bool mute; float vol;
          v.GetMute(out mute); v.GetMasterVolumeLevelScalar(out vol);
          m.Silenciado = mute; m.Volumen = vol;
        }
        lista.Add(m);
      }
      return lista;
    }

    // Mide el pico de senal (0 a 1) de un microfono durante los segundos indicados.
    public static float MedirPico(string id, int segundos) {
      IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice d;
      if (en.GetDevice(id, out d) != 0) return -1f;
      IAudioMeterInformation me = Activar(d, "C02216F6-8C67-4B5B-9D00-D008E73E0064") as IAudioMeterInformation;
      if (me == null) return -1f;
      float max = 0f;
      DateTime fin = DateTime.Now.AddSeconds(segundos);
      while (DateTime.Now < fin) {
        float p;
        if (me.GetPeakValue(out p) == 0 && p > max) max = p;
        System.Threading.Thread.Sleep(100);
      }
      return max;
    }
  }
}
"@
$cargado = $false
try { Add-Type -TypeDefinition $cs2 -ErrorAction Stop; $cargado = $true } catch { Decir ("(no se pudo cargar el modulo de audio: " + $_.Exception.Message + ")") }
if ($cargado) {
  try {
    $mics = [MicInfo.Ayuda]::Listar()
    if ($mics.Count -eq 0) { Decir "NINGUN microfono ACTIVO en Windows. (Revisa Sonido > Entrada y el Administrador de dispositivos.)" }
    $nombres = @{}
    foreach ($m in $mics) {
      $guid = ($m.Id -split '\.')[-1]
      $nombre = $m.Id
      try {
        $props = Get-ItemProperty -Path ("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture\" + $guid + "\Properties") -ErrorAction Stop
        $n1 = $props."{a45c254e-df1c-4efd-8020-67d146a850e0},2"; $n2 = $props."{b3f8fa53-0004-438e-9003-51a46e139bfc},6"
        if ($n1 -and $n2) { $nombre = "$n1 ($n2)" } elseif ($n1) { $nombre = $n1 } elseif ($n2) { $nombre = $n2 }
      } catch { }
      $nombres[$m.Id] = $nombre
      Decir ("Microfono: " + $nombre + "   volumen " + [Math]::Round($m.Volumen * 100) + " %, " + $(if ($m.Silenciado) { "SILENCIADO" } else { "con sonido" }))
    }
    if ($mics.Count -gt 0) {
      Decir ""
      Decir ">>> HABLA FUERTE (o da palmadas) cerca del microfono durante 10 segundos <<<"
      foreach ($m in $mics) {
        $pico = [MicInfo.Ayuda]::MedirPico($m.Id, 10)
        $txt = if ($pico -lt 0) { "no se pudo medir" } elseif ($pico -lt 0.005) { "SIN SENAL (0 %). No llega nada." } elseif ($pico -lt 0.05) { "senal MUY DEBIL" } else { "LLEGA SENAL" }
        Decir ("  " + $nombres[$m.Id] + " -> pico maximo " + [Math]::Round($pico * 100, 1) + " %  =>  " + $txt)
      }
    }
  } catch { Decir ("(la prueba fallo: " + $_.Exception.Message + ")") }
}
Decir ""
Decir "Listo. Manda el archivo info-microfono-resultado.txt (esta junto a este programa)."
