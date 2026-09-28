# -*- coding: utf-8 -*-
"""Comprueba que el prompt habla de ESTA tienda y de ninguna otra.

POR QUÉ EXISTE (26-sep-2026). El prompt venía de una plantilla escrita
para otra tienda y nadie lo revisó: tenía 115 menciones de "iPhone", una
tabla de términos con Motorola, Pixel y Huawei, y ejemplos con AirPods y
Galaxy S24. EPICELL no vende nada de eso.

Un modelo contesta con lo que tiene delante. Con el prompt lleno de
iPhone, el bot ofrecía iPhone — y ahí nacían la mitad de las
alucinaciones: modelos que no existen, precios inventados para ellos, y
clientes viniendo a la tienda a buscar algo que nunca hubo.

Se corre solo, sin instalar nada:

    python comprobar-prompt.py
"""

import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
PROMPT = os.path.join(AQUI, "src", "prompts", "texto.txt")
CATALOGO = os.path.join(AQUI, "src", "prompts", "catalogo.txt")

# Los marcadores que SÍ se rellenan al arrancar (ia.js). Cualquier otro
# {{...}} es un hueco de la plantilla que el modelo lee como si fuera texto.
MARCADORES_QUE_SE_RELLENAN = {"{{CATALOGO}}", "{{TUS HORARIOS}}"}

# Marcas de teléfono conocidas. Si el prompt nombra una que no está en
# catalogo.txt, es de la plantilla: la tienda no la vende.
MARCAS = [
    "iphone", "ipad", "airpods", "macbook", "apple", "motorola", "moto g",
    "pixel", "huawei", "oppo", "vivo", "realme", "oneplus", "nokia", "lg",
    "alcatel", "zte", "blu", "lenovo", "asus", "nothing", "galaxy s24",
    "galaxy s23", "s24 ultra", "a54", "laptop", "macbook",
]

# Dentro de este bloque SÍ se pueden nombrar: es donde se le dice al
# modelo qué NO vendemos, y para eso hay que nombrarlo.
BLOQUE_PERMITIDO = "LO QUE ESTA TIENDA NO VENDE"


def leer(ruta):
    with open(ruta, encoding="utf-8") as f:
        return f.read()


def main():
    problemas = []
    prompt = leer(PROMPT)
    catalogo = leer(CATALOGO).lower()

    # 1. Huecos de la plantilla sin rellenar.
    for marcador in sorted(set(re.findall(r"\{\{[^}]{0,80}\}\}", prompt))):
        if marcador not in MARCADORES_QUE_SE_RELLENAN:
            linea = prompt[: prompt.index(marcador)].count("\n") + 1
            problemas.append(
                f"linea {linea}: {marcador}\n"
                "    Es un hueco de la plantilla. El modelo lo lee tal cual y se lo\n"
                "    contesta al cliente, o se inventa lo que iba ahi."
            )

    # 2. Marcas que esta tienda no vende.
    #    Se mira fuera del bloque donde justamente se dice que no las hay.
    corte = prompt.find(BLOQUE_PERMITIDO)
    fuera = prompt if corte == -1 else prompt[:corte]
    # El bloque permitido termina en el siguiente titulo en mayusculas.
    if corte != -1:
        resto = prompt[corte:]
        siguiente = re.search(r"\n\n[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ,:().\"—-]{10,}\n", resto)
        fuera += resto[siguiente.start():] if siguiente else ""

    bajo = fuera.lower()
    for marca in MARCAS:
        if marca in catalogo:
            continue  # la tienda SÍ la vende
        # Como palabra entera: si no, "lg" aparece dentro de "algo" y
        # "moto" dentro de "motor".
        patron = re.compile(r"(?<![a-z0-9])" + re.escape(marca) + r"(?![a-z0-9])")
        encontradas = list(patron.finditer(bajo))
        cuantas = len(encontradas)
        if cuantas:
            linea = fuera[: encontradas[0].start()].count("\n") + 1
            problemas.append(
                f'linea {linea}: "{marca}" aparece {cuantas} vez/veces y NO esta en '
                "catalogo.txt\n"
                "    El modelo lo va a ofrecer. Cambialo por un producto real de la\n"
                "    tienda (los nombres estan en src/prompts/catalogo.txt)."
            )

    if problemas:
        print("PROBLEMAS EN EL PROMPT:\n")
        for problema in problemas:
            print(f"  · {problema}\n")
        print(f"{len(problemas)} cosa(s) que corregir antes de desplegar.")
        return 1

    nombres = [l for l in leer(CATALOGO).split("\n") if l.strip() and not l.startswith("#")]
    print("✓ el prompt habla solo de productos de esta tienda")
    print(f"  {len(nombres)} nombres en catalogo.txt · sin huecos de plantilla")
    return 0


if __name__ == "__main__":
    sys.exit(main())
