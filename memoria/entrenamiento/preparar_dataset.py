"""Prepara las imagenes de una modelo para entrenar su LoRA.

Busca en la carpeta de salida de SwarmUI las imagenes cuyo nombre contenga
el de la modelo, las copia a una carpeta de entrenamiento y escribe, junto a
cada una, un .txt con la palabra clave (el "nombre" del LoRA). Solo libreria
estandar de Python.

Uso (desde cualquier carpeta):
  python preparar_dataset.py Camila "Camila Reyes Ortega" camilareyes
  python preparar_dataset.py Ines "Ines" inesporto

Argumentos: nombre-corto  texto-que-esta-en-el-archivo  palabra-clave
Salida: <carpeta del script>\\dataset\\<nombre-corto>\\10_<palabra-clave>\\
(el "10_" es lo que kohya_ss usa como repeticiones por imagen).
"""
import shutil
import sys
import unicodedata
from pathlib import Path

SALIDA_SWARM = Path(r"C:\ia comfy y swarm\ComfyUI_V137\ComfyUI\output")


def sin_acentos(t):
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn").lower()


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    corto, texto, clave = sys.argv[1], sys.argv[2], sys.argv[3]
    buscar = sin_acentos(texto)
    destino = Path(__file__).resolve().parent / "dataset" / corto / f"10_{clave}"
    destino.mkdir(parents=True, exist_ok=True)

    n = 0
    for ruta in sorted(SALIDA_SWARM.rglob("*")):
        if ruta.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
            continue
        if buscar not in sin_acentos(ruta.name):
            continue
        n += 1
        copia = destino / f"{clave}_{n:03d}{ruta.suffix.lower()}"
        shutil.copy2(ruta, copia)
        # Pie de foto minimo: solo la palabra clave. Asi el LoRA aprende
        # "esta persona = la palabra", y lo demas (ropa, lugar) lo da la escena.
        copia.with_suffix(".txt").write_text(f"{clave}, a woman\n", encoding="utf-8")
    print(f"{n} imagenes copiadas a {destino}")
    if n < 15:
        print("Aviso: son pocas. Lo ideal son 20-30 buenas (cara nitida, distintos angulos y luz).")
    print("Ahora ABRE esa carpeta, borra las que salgan mal (cara deformada, manos raras, otra persona)")
    print("y deja solo las mejores. Ver GUIA_LORA.md.")


if __name__ == "__main__":
    main()
