# Igual que el de EPICELL: una copia de src/ que Node pueda importar.
# Los prompts se cambian por texto suelto (Node no sabe importar un .txt,
# eso lo hace wrangler) y se abren unas funciones para las pruebas.
# No toca NADA de src/.
#
#   python pruebas/preparar.py && node pruebas/pagos.mjs
import os, re, shutil, sys

raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
destino = os.path.join(raiz, "pruebas", ".stub")
shutil.rmtree(destino, ignore_errors=True)
shutil.copytree(os.path.join(raiz, "src"), destino)

# Los prompts se importan como texto en varios archivos, no solo en ia.js
# (datos.js lee la lista del catálogo). Se sustituyen en todos.
for archivo in os.listdir(destino):
    if not archivo.endswith(".js"):
        continue
    ruta = os.path.join(destino, archivo)
    s = open(ruta, encoding="utf-8").read()
    if "prompts/" not in s:
        continue
    nuevo = re.sub(
        r'import (\w+) from "\./prompts/([^"]+)";',
        lambda m: f'const {m.group(1)} = ' + (
            '"Air Force One blancas\\nAdidas Campus negras\\nNike Air Max 270";'
            if "catalogo" in m.group(2) else '"PROMPT {{CATALOGO}}";'
        ),
        s,
    )
    open(ruta, "w", encoding="utf-8").write(nuevo)

ABIERTAS = ["atenderMeta", "PAGOS_CASHEA", "SIN_KRECE", "PREGUNTA_POR_PAGOS", "YA_DIJO_SU_NIVEL"]
indice = os.path.join(destino, "index.js")
s = open(indice, encoding="utf-8").read()
hay = [n for n in ABIERTAS if re.search(rf"\b(function|const|let)\s+{n}\b", s)]
faltan = [n for n in ABIERTAS if n not in hay]
open(indice, "a", encoding="utf-8").write("\n\nexport { " + ", ".join(hay) + " };\n")

print(f"Copia lista en pruebas/.stub ({len(hay)} funciones abiertas)")
if faltan:
    print("OJO, estas ya no existen en index.js:", ", ".join(faltan))
    sys.exit(1)
