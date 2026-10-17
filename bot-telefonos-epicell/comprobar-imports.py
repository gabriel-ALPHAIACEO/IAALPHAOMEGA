# Comprueba que TODO lo que un archivo importa de otro exista de verdad.
# Es justo el fallo que rompió el despliegue: index.js pedía dos cosas que
# el estado.js de la carpeta no tenía.
import re, os, sys

carpeta = "src"
archivos = [f for f in os.listdir(carpeta) if f.endswith(".js")]
exporta = {}

for f in archivos:
    s = open(os.path.join(carpeta, f), encoding="utf-8").read()
    nombres = set()
    for m in re.finditer(r"export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)", s):
        nombres.add(m.group(1))
    for m in re.finditer(r"export\s*\{([^}]*)\}", s):
        for parte in m.group(1).split(","):
            parte = parte.strip().split(" as ")[-1].strip()
            if parte:
                nombres.add(parte)
    exporta[f] = nombres

fallos = 0
for f in archivos:
    s = open(os.path.join(carpeta, f), encoding="utf-8").read()
    for m in re.finditer(r'import\s*\{([^}]*)\}\s*from\s*"\./([^"]+)"', s, re.S):
        destino = m.group(2)
        if not destino.endswith(".js"):
            continue
        pedidos = [p.strip().split(" as ")[0].strip() for p in m.group(1).split(",") if p.strip()]
        if destino not in exporta:
            print(f"✗ {f} importa de {destino}, que no existe")
            fallos += 1
            continue
        for p in pedidos:
            if p not in exporta[destino]:
                print(f"✗ {f} importa \"{p}\" de {destino}, que no lo exporta")
                fallos += 1

print("✓ todos los imports cuadran" if not fallos else f"\n{fallos} import(s) rotos")
sys.exit(1 if fallos else 0)
