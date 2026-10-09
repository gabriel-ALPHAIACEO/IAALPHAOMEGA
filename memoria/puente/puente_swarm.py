# Puente entre el Worker "memoria" (Cloudflare) y tu SwarmUI.
#
# Cloudflare no puede entrar a tu computadora, asi que es al reves: este
# programa corre en tu equipo y cada pocos segundos le pregunta al Worker
# "¿hay algo para generar?". Si hay, lo genera en tu SwarmUI con tus
# modelos y LoRA, sube las imagenes al Worker y avisa que termino. Los
# archivos de modelos y LoRA nunca salen de tu equipo.
#
# Uso (con SwarmUI abierto):
#   python puente_swarm.py                          deja el puente trabajando
#   python puente_swarm.py cargar-fichas fichas.json  sube las fichas de las modelos
#
# Solo usa la libreria estandar de Python: no hay que instalar nada.

import json
import os
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
ESPERA_SIN_TRABAJO = 5      # segundos entre preguntas cuando no hay nada
GENERACION_MAXIMA = 30 * 60  # una tanda de 10 imagenes SDXL tarda unos minutos


def leer_config():
    ruta = os.path.join(AQUI, "config.json")
    if not os.path.exists(ruta):
        sys.exit(f"Falta {ruta}. Copia config.ejemplo.json como config.json y completalo.")
    with open(ruta, encoding="utf-8") as f:
        config = json.load(f)
    for clave in ("memoria_url", "memoria_token", "swarm_url"):
        if not config.get(clave) or "PEGA" in str(config[clave]):
            sys.exit(f'Completa "{clave}" en config.json')
    config["memoria_url"] = config["memoria_url"].rstrip("/")
    config["swarm_url"] = config["swarm_url"].rstrip("/")
    return config


def pedir(url, metodo="GET", datos=None, token=None, crudo=None, tipo=None, espera=60):
    cabeceras = {"User-Agent": "puente-swarm/1.0"}
    cuerpo = None
    if token:
        cabeceras["Authorization"] = f"Bearer {token}"
    if datos is not None:
        cuerpo = json.dumps(datos).encode("utf-8")
        cabeceras["Content-Type"] = "application/json"
    elif crudo is not None:
        cuerpo = crudo
        cabeceras["Content-Type"] = tipo or "application/octet-stream"
    req = urllib.request.Request(url, data=cuerpo, method=metodo, headers=cabeceras)
    try:
        with urllib.request.urlopen(req, timeout=espera) as res:
            contenido = res.read()
    except urllib.error.HTTPError as e:
        detalle = e.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"{metodo} {url} -> {e.code}: {detalle}") from None
    if crudo is None and datos is None and metodo == "GET":
        return contenido
    return json.loads(contenido or b"null")


# --- Worker ---------------------------------------------------------------

def memoria(config, ruta, metodo="POST", datos=None, **extra):
    return pedir(config["memoria_url"] + ruta, metodo, datos, token=config["memoria_token"], **extra)


# --- SwarmUI ----------------------------------------------------------------

def sesion_swarm(config):
    return pedir(config["swarm_url"] + "/API/GetNewSession", "POST", {})["session_id"]


def generar_en_swarm(config, trabajo):
    p = trabajo["parametros"]
    prompt = trabajo["prompt"]
    # SwarmUI entiende <lora:archivo:peso> dentro del prompt.
    for lora in trabajo["loras"]:
        prompt += f" <lora:{lora['archivo']}:{lora['escala']}>"
    entrada = {
        "images": p["images"],
        "prompt": prompt,
        "negativeprompt": "",
        "model": p["model"],
        "steps": p["steps"],
        "cfgscale": p["cfgscale"],
        "width": p["width"],
        "height": p["height"],
        "seed": p["seed"],
    }
    for intento in range(2):
        entrada["session_id"] = sesion_swarm(config)
        r = pedir(config["swarm_url"] + "/API/GenerateText2Image", "POST", entrada, espera=GENERACION_MAXIMA)
        if r.get("error_id") == "invalid_session_id" and intento == 0:
            continue
        if r.get("error"):
            raise RuntimeError(f"SwarmUI: {r['error']}")
        return r.get("images") or []
    return []


def descargar_de_swarm(config, ruta):
    # SwarmUI devuelve rutas tipo "View/local/raw/2026-10-08/xxx.png".
    url = config["swarm_url"] + "/" + urllib.parse.quote(ruta.lstrip("/"), safe="/")
    return pedir(url)


def semilla_de_png(datos):
    # SwarmUI guarda los parametros en el PNG (bloque de texto "parameters").
    # De ahi sale la semilla real cuando se pidio una al azar (-1).
    i = 8
    while i + 8 <= len(datos):
        largo = struct.unpack(">I", datos[i:i + 4])[0]
        tipo = datos[i + 4:i + 8]
        bloque = datos[i + 8:i + 8 + largo]
        i += 12 + largo
        if tipo == b"tEXt" and bloque.startswith(b"parameters\0"):
            try:
                return json.loads(bloque.split(b"\0", 1)[1])["sui_image_params"]["seed"]
            except (ValueError, KeyError):
                return None
    return None


# --- Bucle ------------------------------------------------------------------

def atender(config, trabajo):
    print(f"\n[{time.strftime('%H:%M:%S')}] Generando {trabajo['parametros']['images']} imagen(es): {trabajo['escena']}")
    rutas = generar_en_swarm(config, trabajo)
    if not rutas:
        raise RuntimeError("SwarmUI no devolvio imagenes")
    semilla = None
    subir = trabajo.get("subir_imagenes", True)
    for n, ruta in enumerate(rutas):
        png = descargar_de_swarm(config, ruta)
        if semilla is None:
            semilla = semilla_de_png(png)
        if not subir:
            continue
        tipo = "image/jpeg" if ruta.lower().endswith((".jpg", ".jpeg")) else "image/png"
        memoria(config, f"/trabajos/{trabajo['id']}/imagen/{n}", "PUT", crudo=png, tipo=tipo, espera=120)
        print(f"  subida {n + 1}/{len(rutas)}")
    final = {"semilla": semilla}
    if not subir:
        # Sin R2 en Cloudflare: las imagenes se quedan en tu PC. Se guarda la
        # direccion con la que SwarmUI las muestra en el navegador.
        final["rutas_locales"] = [config["swarm_url"] + "/" + urllib.parse.quote(r.lstrip("/"), safe="/") for r in rutas]
        print(f"  {len(rutas)} imagen(es) guardadas en tu PC (SwarmUI)")
    memoria(config, f"/trabajos/{trabajo['id']}/terminar", datos=final)
    print(f"  lista (semilla {semilla})")


def trabajar(config):
    print("Puente encendido. SwarmUI:", config["swarm_url"], "| Worker:", config["memoria_url"])
    print("Deja esta ventana abierta. Ctrl+C para apagar.")
    while True:
        try:
            trabajo = memoria(config, "/trabajos/tomar")
        except Exception as e:
            print("No pude hablar con el Worker:", e)
            time.sleep(30)
            continue
        if not trabajo:
            time.sleep(ESPERA_SIN_TRABAJO)
            continue
        try:
            atender(config, trabajo)
        except Exception as e:
            print("  ERROR:", e)
            try:
                memoria(config, f"/trabajos/{trabajo['id']}/terminar", datos={"error": str(e)[:1500]})
            except Exception as e2:
                print("  Tampoco pude avisar el error al Worker:", e2)


def cargar_fichas(config, archivo):
    with open(archivo, encoding="utf-8") as f:
        fichas = json.load(f)
    for ficha in fichas:
        r = memoria(config, "/modelos", datos=ficha)
        print("Ficha guardada:", r["nombre"])


if __name__ == "__main__":
    configuracion = leer_config()
    if len(sys.argv) >= 3 and sys.argv[1] == "cargar-fichas":
        cargar_fichas(configuracion, sys.argv[2])
    else:
        try:
            trabajar(configuracion)
        except KeyboardInterrupt:
            print("\nPuente apagado.")
