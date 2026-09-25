# Revisa el wrangler.toml ANTES de que lo haga wrangler.
#
# POR QUÉ EXISTE. Los archivos se copian a mano, y el fallo más fácil de
# cometer es pegar el nuevo DEBAJO del viejo en vez de reemplazarlo. El
# archivo queda con todo duplicado y wrangler corta con:
#
#   Invalid TOML document: trying to redefine an already defined table
#   or value
#
# Eso dice la línea del segundo, no la del primero, así que hay que ir a
# buscarlo. Esto lo dice en un segundo, con las dos líneas.
#
# Y de paso comprueba lo demás: que estén todas las variables que el
# código lee, que no sobre ninguna, y qué falta por rellenar.
#
#   python comprobar-config.py
import os, re, sys

ARCHIVO = "wrangler.toml"
SECRETOS = {
    "OPENAI_API_KEY", "SHOPIFY_TOKEN", "SLACK_WEBHOOK",
    "META_APP_SECRET_IG", "META_APP_SECRET", "IG_TOKEN",
}

if not os.path.exists(ARCHIVO):
    print(f"✗ No encuentro {ARCHIVO}. ¿Estás en la carpeta del bot?")
    sys.exit(1)

lineas = open(ARCHIVO, encoding="utf-8").read().split("\n")

# ── 1. Claves repetidas, con las dos líneas ──────────────────────────
vistas = {}
repetidas = []
seccion = ""

for numero, linea in enumerate(lineas, 1):
    limpia = linea.strip()
    if not limpia or limpia.startswith("#"):
        continue
    if limpia.startswith("["):
        # Las tablas repetidas ([[d1_databases]]) son legítimas; las
        # normales ([vars] dos veces) no.
        if not limpia.startswith("[["):
            if limpia in vistas.get("__tablas__", set()):
                repetidas.append((limpia, vistas["__lineas__"][limpia], numero))
            vistas.setdefault("__tablas__", set()).add(limpia)
            vistas.setdefault("__lineas__", {})[limpia] = numero
        seccion = limpia
        continue

    igual = re.match(r"([A-Za-z0-9_]+)\s*=", limpia)
    if not igual:
        continue
    clave = f"{seccion}::{igual.group(1)}"
    if clave in vistas:
        repetidas.append((igual.group(1), vistas[clave], numero))
    else:
        vistas[clave] = numero

if repetidas:
    print("✗ HAY COSAS REPETIDAS — esto es lo que hace fallar el deploy:\n")
    for nombre, primera, segunda in repetidas:
        print(f"    {nombre}   está en la línea {primera} y otra vez en la {segunda}")
    print(
        "\n  Casi siempre pasa por pegar el archivo nuevo DEBAJO del viejo.\n"
        "  Borra el archivo entero y pega el nuevo, en vez de añadirlo."
    )
    sys.exit(1)

# ── 2. Que sea TOML válido ───────────────────────────────────────────
try:
    import tomllib
    config = tomllib.load(open(ARCHIVO, "rb"))
except ModuleNotFoundError:
    print("✓ Sin claves repetidas (con Python 3.11+ además se valida el TOML)")
    sys.exit(0)
except Exception as error:
    print(f"✗ El archivo no es un TOML válido: {error}")
    sys.exit(1)

variables = config.get("vars", {})
bindings = {d.get("binding") for d in config.get("d1_databases", [])}

# ── 3. Lo que el código lee ──────────────────────────────────────────
leidos = set()
for archivo in os.listdir("src"):
    if archivo.endswith(".js"):
        texto = open(os.path.join("src", archivo), encoding="utf-8").read()
        leidos |= set(re.findall(r"env[?]?\.([A-Z][A-Z0-9_]+)", texto))

faltan = sorted(leidos - set(variables) - bindings - SECRETOS)
sobran = sorted(set(variables) - leidos)
pendientes = sorted(
    k for k, v in variables.items()
    if isinstance(v, str) and re.search(r"PENDIENTE|CAMBIA-ESTO|PON_AQUI", v, re.I)
)

print("✓ TOML válido y sin repetidos")
print(f"  {len(variables)} variables · {len(SECRETOS & leidos)} secretos · base: {', '.join(bindings) or '—'}")

if faltan:
    print("\n✗ El código lee estas y no están en el archivo:")
    for f in faltan:
        print(f"    {f}")

if sobran:
    print("\n·  Estas están en el archivo y el código no las lee (no rompe nada):")
    for s in sobran:
        print(f"    {s}")

if pendientes:
    print("\n·  Sin rellenar todavía:")
    for p in pendientes:
        print(f"    {p} = {variables[p]!r}")

sys.exit(1 if faltan else 0)
