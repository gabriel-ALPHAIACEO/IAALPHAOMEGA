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

ia = os.path.join(destino, "ia.js")
s = open(ia, encoding="utf-8").read()
s = re.sub(r'import (\w+) from "\./prompts/[^"]+";', r'const \1 = "PROMPT {{CATALOGO}}";', s)
open(ia, "w", encoding="utf-8").write(s)

ABIERTAS = ["atenderMeta", "PAGOS_CASHEA", "PAGOS_KRECE", "PREGUNTA_POR_PAGOS", "YA_DIJO_SU_NIVEL"]
indice = os.path.join(destino, "index.js")
s = open(indice, encoding="utf-8").read()
hay = [n for n in ABIERTAS if re.search(rf"\b(function|const|let)\s+{n}\b", s)]
faltan = [n for n in ABIERTAS if n not in hay]
open(indice, "a", encoding="utf-8").write("\n\nexport { " + ", ".join(hay) + " };\n")

print(f"Copia lista en pruebas/.stub ({len(hay)} funciones abiertas)")
if faltan:
    print("OJO, estas ya no existen en index.js:", ", ".join(faltan))
    sys.exit(1)
