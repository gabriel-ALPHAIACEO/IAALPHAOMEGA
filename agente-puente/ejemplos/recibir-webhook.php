<?php
// EJEMPLO: recibir el stock del agente puente en cualquier página con PHP
// (WooCommerce, una tienda propia, un hosting cualquiera). Ver PROTOCOLO.md.
//
// En config.json del agente:
//   "destinos": [{ "tipo": "webhook", "url": "https://tu-pagina.com/recibir-webhook.php",
//                  "cabeceras": { "X-Api-Key": "${ENV:CLAVE_DE_MI_PAGINA}" },
//                  "secretoFirma": "${ENV:FIRMA_DE_MI_PAGINA}" }]
//
// Los dos secretos van en el servidor como variables de entorno, no en este archivo.

$CLAVE = getenv('CLAVE_DE_MI_PAGINA');
$FIRMA = getenv('FIRMA_DE_MI_PAGINA');

$cuerpo = file_get_contents('php://input');   // los bytes tal cual: la firma es sobre esto

// 1. La clave.
if (!$CLAVE || !hash_equals($CLAVE, $_SERVER['HTTP_X_API_KEY'] ?? '')) {
  http_response_code(401);
  exit(json_encode(['error' => 'clave incorrecta']));
}

// 2. La firma (y que no sea un envío viejo repetido).
$tiempo = $_SERVER['HTTP_X_PUENTE_TIEMPO'] ?? '';
$firma  = $_SERVER['HTTP_X_PUENTE_FIRMA'] ?? '';
$esperada = 'sha256=' . hash_hmac('sha256', $tiempo . '.' . $cuerpo, $FIRMA);
if (!$FIRMA || !hash_equals($esperada, $firma) || abs(microtime(true) * 1000 - (float)$tiempo) > 5 * 60 * 1000) {
  http_response_code(401);
  exit(json_encode(['error' => 'firma inválida']));
}

$datos = json_decode($cuerpo, true);

// 3a. Una foto (llega aparte, solo si es nueva o cambió).
if (($datos['tipo'] ?? '') === 'foto') {
  $bytes = base64_decode($datos['datos'] ?? '', true);
  if ($bytes === false || hash('sha256', $bytes) !== ($datos['huella'] ?? '')) {
    http_response_code(422);
    exit(json_encode(['error' => 'foto dañada']));
  }
  $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][$datos['contentType']] ?? 'jpg';
  $nombre = preg_replace('/[^\w.-]+/', '_', $datos['codigo'] ?? $datos['producto']) . '-' . ((int)$datos['posicion'] + 1) . '.' . $ext;
  @mkdir(__DIR__ . '/fotos');
  file_put_contents(__DIR__ . '/fotos/' . $nombre, $bytes);
  // Con WooCommerce: subirla a la biblioteca y ponerla al producto de ese SKU.
  http_response_code(200);
  exit(json_encode(['recibida' => $nombre]));
}

// 3b. Los productos.
if (!is_array($datos['productos'] ?? null)) {
  http_response_code(422);
  exit(json_encode(['error' => 'sin productos']));
}
foreach ($datos['productos'] as $p) {
  // La cantidad es la que CONTÓ el sistema: se PONE, no se suma
  // (si llega dos veces, queda igual).
  // Ejemplo con WooCommerce: buscar por SKU y poner el stock.
  //   $id = wc_get_product_id_by_sku($p['codigo']);
  //   if ($id) { $prod = wc_get_product($id); $prod->set_stock_quantity((int)$p['cantidad']); $prod->save(); }
}

http_response_code(200);
echo json_encode(['recibido' => count($datos['productos']), 'parte' => $datos['parte'], 'partes' => $datos['partes']]);
