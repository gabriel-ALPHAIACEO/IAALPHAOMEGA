# Prepara una copia de src/ que Node pueda importar tal cual.
#
# POR QUÉ HACE FALTA. El Worker importa los prompts como texto
# (`import promptTexto from "./prompts/texto.txt"`), que es cosa de
# wrangler: Node no sabe hacer eso y se niega a arrancar. Esta copia
# cambia esas tres líneas por una cadena cualquiera —a las pruebas no les
# importa lo que diga el prompt, porque el modelo está simulado— y abre
# para las pruebas unas cuantas funciones de index.js.
#
# No toca NADA de src/. Escribe en pruebas/.stub/, que es desechable.
#
#   python pruebas/preparar.py && node pruebas/turnos.mjs
import os, re, shutil, sys

raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
origen = os.path.join(raiz, "src")
destino = os.path.join(raiz, "pruebas", ".stub")

shutil.rmtree(destino, ignore_errors=True)
shutil.copytree(origen, destino)

ia = os.path.join(destino, "ia.js")
s = open(ia, encoding="utf-8").read()
for linea, valor in [
    ('import promptTexto from "./prompts/texto.txt";', 'const promptTexto = "PROMPT {{CATALOGO}}";'),
    ('import listaCatalogo from "./prompts/catalogo.txt";', 'const listaCatalogo = "CATALOGO";'),
    ('import promptVision from "./prompts/vision.txt";', 'const promptVision = "VISION";'),
]:
    s = s.replace(linea, valor)
open(ia, "w", encoding="utf-8").write(s)

# Lo que las pruebas necesitan mirar por dentro.
ABIERTAS = [
    "atenderMeta", "publicacionDelTurno", "nombraDelCatalogo", "sinListaPegada",
    "precioParaMostrar", "subtituloDeFicha", "minutosParaVolver", "hayQueDecirQueHayMas",
    "fraseSinResultados", "marcarIdentificacion", "marcarPublicacionSinVer",
    "PAGOS_CASHEA", "PAGOS_KRECE", "NO_PUDE_ABRIRLO", "NO_ESE_PERO_MIRA",
    "atenderComentario", "modoComentarios",
]

indice = os.path.join(destino, "index.js")
s = open(indice, encoding="utf-8").read()
hay = [n for n in ABIERTAS if re.search(rf"\b(function|const|let)\s+{n}\b", s)]
faltan = [n for n in ABIERTAS if n not in hay]
open(indice, "a", encoding="utf-8").write("\n\nexport { " + ", ".join(hay) + " };\n")

print(f"Copia lista en pruebas/.stub ({len(hay)} funciones abiertas)")
if faltan:
    print("OJO, estas ya no existen en index.js:", ", ".join(faltan))
    sys.exit(1)
