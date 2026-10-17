// QUE CORRA SOLO: la tarea del Programador de tareas de Windows (cada minuto,
// para siempre, sin pararse con la batería, sin ventana, una sola a la vez y
// cortada si pasa de 30 min) o una línea de cron en Linux y Mac.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NOMBRE_DE_LA_TAREA = "Agente puente";
// La carpeta del agente (la de arriba de lib/).
const AQUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function ejecutarPrograma(programa, args = [], { heredar = false } = {}) {
  return new Promise((resolve) => {
    const hijo = spawn(programa, args, { stdio: heredar ? "inherit" : "pipe", windowsHide: true });
    let salida = "";
    hijo.stdout?.on("data", (d) => (salida += d));
    hijo.stderr?.on("data", (d) => (salida += d));
    hijo.on("error", (error) => resolve({ codigo: -1, salida: error.message }));
    hijo.on("close", (codigo) => resolve({ codigo, salida }));
  });
}

function xml(texto) {
  return String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// La tarea de Windows en XML: cada minuto, para siempre, sin pararse con la
// batería, sin ventana, una sola a la vez, y cortada si pasa de 30 min.
export function tareaDeWindows({ node = process.execPath, script = path.join(AQUI, "agente-puente.mjs"), config = path.join(AQUI, "config.json"), usuario = "" } = {}) {
  const principal = usuario
    ? `<UserId>${xml(usuario)}</UserId><LogonType>Password</LogonType><RunLevel>HighestAvailable</RunLevel>`
    : `<UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel>`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Agente puente: le pasa el stock del sistema de inventario al bot de la tienda.</Description></RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals><Principal id="Author">${principal}</Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(node)}</Command>
      <Arguments>${xml(`"${script}" --vuelta --config "${config}"`)}</Arguments>
      <WorkingDirectory>${xml(path.dirname(script))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

// La línea de cron (Linux y Mac): cada minuto.
export function lineaDeCron({ node = process.execPath, script = path.join(AQUI, "agente-puente.mjs"), config = path.join(AQUI, "config.json") } = {}) {
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  return `* * * * * ${q(node)} ${q(script)} --vuelta --config ${q(config)} >/dev/null 2>&1 # agente-puente`;
}

export async function estaInstalado({ ejecutar = ejecutarPrograma, plataforma = process.platform } = {}) {
  if (plataforma === "win32") return (await ejecutar("schtasks", ["/Query", "/TN", NOMBRE_DE_LA_TAREA])).codigo === 0;
  const r = await ejecutar("crontab", ["-l"]);
  return r.codigo === 0 && /# agente-puente/.test(r.salida);
}

export async function instalar({ rutaConfig, usuario = "", ejecutar = ejecutarPrograma, plataforma = process.platform, escribir = console.log, carpetaTemporal = os.tmpdir() } = {}) {
  const script = path.join(AQUI, "agente-puente.mjs");
  const config = path.resolve(rutaConfig);
  if (plataforma === "win32") {
    const archivo = path.join(carpetaTemporal, "agente-puente-tarea.xml");
    // schtasks lee bien el XML en UTF-16 con su marca (BOM).
    fs.writeFileSync(archivo, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tareaDeWindows({ script, config, usuario }), "utf16le")]));
    const args = ["/Create", "/F", "/TN", NOMBRE_DE_LA_TAREA, "/XML", archivo];
    if (usuario) args.push("/RU", usuario, "/RP", "*");
    const r = await ejecutar("schtasks", args, { heredar: Boolean(usuario) });
    try {
      fs.unlinkSync(archivo);
    } catch {}
    if (r.codigo !== 0) {
      escribir(`No se pudo crear la tarea: ${String(r.salida || "").trim()}\n¿Abriste la ventana como administrador? (clic derecho › Ejecutar como administrador)`);
      return false;
    }
    escribir(`Listo: la tarea «${NOMBRE_DE_LA_TAREA}» corre cada minuto${usuario ? ` con la cuenta ${usuario}` : " como SYSTEM"}, aunque nadie inicie sesión y aunque se reinicie la PC.`);
    if (!usuario) escribir("Ojo: como SYSTEM no ve las unidades de red con letra (Z:\\…). Si tu archivo está en una, usa la ruta \\\\servidor\\carpeta o instala con --usuario TU_USUARIO.");
    await ejecutar("schtasks", ["/Run", "/TN", NOMBRE_DE_LA_TAREA]);
    return true;
  }
  const actual = await ejecutar("crontab", ["-l"]);
  const lineas = (actual.codigo === 0 ? actual.salida : "").split("\n").filter((l) => l.trim() && !/# agente-puente/.test(l));
  lineas.push(lineaDeCron({ script, config }));
  const r = await escribirCrontab(lineas.join("\n") + "\n", ejecutar);
  if (r.codigo !== 0) {
    escribir(`No se pudo instalar en cron: ${r.salida}. Añade a mano esta línea con «crontab -e»:\n${lineaDeCron({ script, config })}`);
    return false;
  }
  escribir("Listo: quedó en cron, cada minuto.");
  return true;
}

function escribirCrontab(contenido, ejecutar) {
  if (ejecutar !== ejecutarPrograma) return ejecutar("crontab", ["-"], { entrada: contenido });
  return new Promise((resolve) => {
    const hijo = spawn("crontab", ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    let salida = "";
    hijo.stderr.on("data", (d) => (salida += d));
    hijo.on("error", (error) => resolve({ codigo: -1, salida: error.message }));
    hijo.on("close", (codigo) => resolve({ codigo, salida }));
    hijo.stdin.end(contenido);
  });
}

export async function desinstalar({ ejecutar = ejecutarPrograma, plataforma = process.platform, escribir = console.log } = {}) {
  if (plataforma === "win32") {
    const r = await ejecutar("schtasks", ["/Delete", "/F", "/TN", NOMBRE_DE_LA_TAREA]);
    escribir(r.codigo === 0 ? `Listo: se quitó la tarea «${NOMBRE_DE_LA_TAREA}».` : `No estaba instalada o no se pudo quitar: ${String(r.salida || "").trim()}`);
    return r.codigo === 0;
  }
  const actual = await ejecutar("crontab", ["-l"]);
  const lineas = (actual.codigo === 0 ? actual.salida : "").split("\n").filter((l) => l.trim() && !/# agente-puente/.test(l));
  const r = await escribirCrontab(lineas.length ? lineas.join("\n") + "\n" : "", ejecutar);
  escribir(r.codigo === 0 ? "Listo: se quitó de cron." : `No se pudo: ${r.salida}`);
  return r.codigo === 0;
}
