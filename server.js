require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const pdfParse = require('pdf-parse');

// Configurar multer para archivos en memoria
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// ============================================
// SISTEMA DE AUTENTICACIÓN
// ============================================

const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'admin123';

var sessions = {};

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

app.use(function(req, res, next) {
  var cookies = {};
  var cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach(function(cookie) {
      var parts = cookie.split('=');
      var key = parts[0].trim();
      var value = parts.slice(1).join('=').trim();
      cookies[key] = value;
    });
  }
  req.cookies = cookies;
  next();
});

function requireAuth(req, res, next) {
  var token = req.cookies.session_token || req.headers['x-session-token'];

  if (!token || !sessions[token]) {
    return res.status(401).json({ error: 'No autorizado', requireLogin: true });
  }

  var session = sessions[token];
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    delete sessions[token];
    return res.status(401).json({ error: 'Sesión expirada', requireLogin: true });
  }

  req.user = session.user;
  next();
}

app.post('/api/auth/login', function(req, res) {
  var username = req.body.username;
  var password = req.body.password;

  if (username === AUTH_USER && password === AUTH_PASSWORD) {
    var token = generateSessionToken();
    sessions[token] = {
      user: username,
      createdAt: Date.now()
    };

    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    console.log('Login exitoso para usuario: ' + username);
    res.json({ success: true, user: username });
  } else {
    console.log('Intento de login fallido para usuario: ' + username);
    res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
});

app.post('/api/auth/logout', function(req, res) {
  var token = req.cookies.session_token || req.headers['x-session-token'];
  if (token && sessions[token]) {
    delete sessions[token];
  }
  res.clearCookie('session_token');
  res.json({ success: true });
});

app.get('/api/auth/check', function(req, res) {
  var token = req.cookies.session_token || req.headers['x-session-token'];
  if (!token || !sessions[token]) {
    return res.json({ authenticated: false });
  }
  var session = sessions[token];
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    delete sessions[token];
    return res.json({ authenticated: false });
  }
  res.json({ authenticated: true, user: session.user });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', function(req, res, next) {
  if (req.path.startsWith('/auth/')) {
    return next();
  }
  requireAuth(req, res, next);
});

// ============================================
// ANTHROPIC (CLAUDE) SETUP
// ============================================

var anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  console.log('Claude API configurada');
}

// ============================================
// GOOGLE SHEETS SETUP
// ============================================

var sheets = null;
var SHEET_ID = process.env.GOOGLE_SHEET_ID;

if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
  // Limpiar la private key: quitar comillas y convertir \n literales a saltos de línea
  var privateKey = process.env.GOOGLE_PRIVATE_KEY;
  privateKey = privateKey.replace(/^["']|["']$/g, ''); // Quitar comillas al inicio/fin
  privateKey = privateKey.replace(/\\n/g, '\n'); // Convertir \n literal a salto de línea

  var auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  sheets = google.sheets({ version: 'v4', auth: auth });
  console.log('Google Sheets configurado');
}

// ============================================
// CACHE DE CÓDIGOS ML
// ============================================

var codigosCache = {}; // CodigoML -> { cuenta, sku, producto }

// ============================================
// COLECTAS (múltiples)
// ============================================

var colectas = {}; // id -> colecta
// Estructura de cada colecta: {
//   id: string,
//   nombre: string (opcional),
//   fecha: string (YYYY-MM-DD de carga),
//   fechaColecta: string (fecha de la colecta FULL),
//   items: { codigoML: { cantidad: number, verificado: boolean, fechaVerificacion: string } }
//   totalItems: number,
//   totalUnits: number,
//   verificados: number
// }

function generarIdColecta() {
  return 'col_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

// Helper: calcular estadísticas de una colecta (centralizado)
function calcularEstadisticasColecta(colecta) {
  var verificados = 0;
  var unidadesVerificadas = 0;
  var pendientes = 0;
  var listaPendientes = [];

  Object.keys(colecta.items).forEach(function(codigoML) {
    var item = colecta.items[codigoML];
    if (item.verificado) {
      verificados++;
      unidadesVerificadas += item.cantidad;
    } else {
      pendientes++;
      listaPendientes.push(codigoML);
    }
  });

  var progreso = colecta.totalUnits > 0
    ? Math.round((unidadesVerificadas / colecta.totalUnits) * 100)
    : 0;

  return {
    verificados: verificados,
    unidadesVerificadas: unidadesVerificadas,
    pendientes: pendientes,
    listaPendientes: listaPendientes,
    progreso: progreso
  };
}

async function loadCodigosFromSheets() {
  if (!sheets || !SHEET_ID) {
    console.log('Sheets no configurado');
    return;
  }

  try {
    var response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Hoja 1!A:D'
    });

    var rows = response.data.values || [];
    codigosCache = {};

    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (!row[1]) continue; // CodigoML está en columna B (índice 1)

      var cuenta = row[0] || '';
      var codigoML = row[1].toString().trim();
      var sku = row[2] || '';
      var producto = row[3] || '';

      codigosCache[codigoML] = { cuenta, sku, producto };
    }

    console.log('Cargados ' + Object.keys(codigosCache).length + ' códigos ML');
  } catch (error) {
    console.error('Error cargando códigos desde Sheets:', error.message);
  }
}

// ============================================
// FUNCIONES DE SKU (igual al verificador original)
// ============================================

function describeSKU(sku) {
  if (!sku) return '';

  if (sku.startsWith('VF')) {
    var resto = sku.substring(2);
    if (resto.startsWith('i')) {
      return 'Vidrio iPhone ' + resto.substring(1);
    }
    return 'Vidrio ' + resto;
  }

  if (sku.startsWith('FT')) {
    return 'Funda Transparente ' + sku.substring(2);
  }

  if (sku.startsWith('FAN')) {
    var colors = { 'N': 'Negra', 'R': 'Roja', 'A': 'Azul' };
    var colorCode = sku.charAt(sku.length - 1);
    var color = colors[colorCode] || colorCode;
    var modelo = sku.substring(3, sku.length - 1);
    return 'Funda Anillo ' + color + ' ' + modelo;
  }

  return sku;
}

function parseSKU(sku) {
  if (!sku) return [];
  var parts = sku.split('/');
  var components = [];
  var seen = {};

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (part.match(/^5[A-Z0-9]/)) continue; // Ignorar códigos internos
    if (part === '') continue;

    var quantityMatch = part.match(/\s*\((\d+)\)\s*$/);
    var quantity = 1;
    var cleanSku = part;
    if (quantityMatch) {
      quantity = parseInt(quantityMatch[1], 10);
      cleanSku = part.replace(/\s*\(\d+\)\s*$/, '').trim();
    }

    if (cleanSku === '') continue;
    if (seen[cleanSku]) {
      for (var j = 0; j < components.length; j++) {
        if (components[j].sku === cleanSku) {
          components[j].quantity += quantity;
          break;
        }
      }
      continue;
    }
    seen[cleanSku] = true;
    components.push({ sku: cleanSku, quantity: quantity });
  }
  return components;
}

// ============================================
// FUNCIONES DE COLECTA
// ============================================

// Buscar combinación de N números que sumen el total (backtracking)
function buscarCombinacion(cantidades, n, objetivo) {
  var resultado = null;

  function backtrack(inicio, seleccionados, sumaActual) {
    if (resultado) return; // Ya encontramos una solución

    if (seleccionados.length === n) {
      if (sumaActual === objetivo) {
        resultado = seleccionados.slice();
      }
      return;
    }

    // Podar: si no hay suficientes elementos restantes
    if (cantidades.length - inicio < n - seleccionados.length) return;

    for (var i = inicio; i < cantidades.length && !resultado; i++) {
      seleccionados.push(cantidades[i]);
      backtrack(i + 1, seleccionados, sumaActual + cantidades[i]);
      seleccionados.pop();
    }
  }

  backtrack(0, [], 0);
  return resultado;
}

// Parsear PDF de colecta FULL (extrae códigos ML y cantidades)
async function parseColectaPDF(pdfBuffer) {
  var data = await pdfParse(pdfBuffer);
  var text = data.text;

  console.log('========== DEBUG PDF PARSER ==========');
  console.log('Texto total length:', text.length);
  console.log('Primeros 500 chars:', JSON.stringify(text.substring(0, 500)));

  var items = {};
  var totalUnits = 0;
  var envioId = '';
  var totalProductos = 0;
  var totalUnidadesDeclaradas = 0;

  // Extraer número de envío (ej: "Envío #59627418")
  var envioMatch = text.match(/Envío\s*#(\d+)/i);
  if (envioMatch) {
    envioId = envioMatch[1];
  }
  console.log('Envío ID:', envioId);

  // Extraer totales declarados (ej: "Productos del envío: 28 | Total de unidades: 162")
  var totalesMatch = text.match(/Productos del envío:\s*(\d+)\s*\|\s*Total de unidades:\s*(\d+)/i);
  if (totalesMatch) {
    totalProductos = parseInt(totalesMatch[1], 10);
    totalUnidadesDeclaradas = parseInt(totalesMatch[2], 10);
  }
  console.log('Totales declarados:', totalProductos, 'productos,', totalUnidadesDeclaradas, 'unidades');

  // Extraer todos los códigos ML en orden de aparición
  var codigoMLRegex = /Código\s*ML:\s*([A-Z]{4}\d{5})/gi;
  var match;
  var codigosOrdenados = [];

  while ((match = codigoMLRegex.exec(text)) !== null) {
    codigosOrdenados.push(match[1].toUpperCase());
  }
  console.log('Códigos ML encontrados:', codigosOrdenados.length);

  // =====================================================
  // ESTRATEGIA MEJORADA: Extraer cantidades del formato tabular
  // =====================================================

  // Normalizar saltos de línea (Linux vs Windows)
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  var lines = text.split('\n');
  console.log('Total de líneas:', lines.length);

  var cantidades = [];
  var lineasConNumeroSolo = [];

  // MÉTODO 1: Buscar números en líneas propias o con bullets
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    // Ignorar líneas que son parte del encabezado de tabla
    if (line.includes('PRODUCTO') && line.includes('UNIDADES')) continue;
    if (line.includes('IDENTIFICACIÓN') || line.includes('INSTRUCCIONES')) continue;
    // Ignorar la línea del header con totales
    if (line.includes('Productos del envío') || line.includes('Total de unidades')) continue;

    // Buscar números solos de 1-3 dígitos en línea propia
    if (/^\d{1,3}$/.test(line)) {
      var num = parseInt(line, 10);
      if (num > 0 && num < 500) {
        cantidades.push(num);
        lineasConNumeroSolo.push({ linea: i, valor: num });
      }
    }

    // Buscar números al inicio de línea seguidos de bullet point (ej: "2 • La fecha...")
    var matchBullet = line.match(/^(\d{1,3})\s*•/);
    if (matchBullet) {
      var numBullet = parseInt(matchBullet[1], 10);
      if (numBullet > 0 && numBullet < 500) {
        cantidades.push(numBullet);
        lineasConNumeroSolo.push({ linea: i, valor: numBullet, tipo: 'bullet' });
      }
    }
  }

  console.log('MÉTODO 1 - Números en líneas propias:', cantidades.length);
  console.log('Primeras 10 líneas con número:', JSON.stringify(lineasConNumeroSolo.slice(0, 10)));
  console.log('Suma método 1:', cantidades.reduce(function(a,b){return a+b;}, 0));

  // MÉTODO 2: Si no encontramos suficientes, buscar patrón "obligatorio" seguido de número
  if (cantidades.length < codigosOrdenados.length) {
    console.log('Método 1 insuficiente (' + cantidades.length + '), probando método 2...');
    cantidades = [];

    // Buscar patrón: "obligatorio" seguido eventualmente por un número
    var obligatorioRegex = /obligatorio\s*(\d{1,3})\b/gi;
    var matchObl;
    while ((matchObl = obligatorioRegex.exec(text)) !== null) {
      var numObl = parseInt(matchObl[1], 10);
      if (numObl > 0 && numObl < 500) {
        cantidades.push(numObl);
      }
    }
    console.log('MÉTODO 2 - obligatorio+número:', cantidades.length, 'suma:', cantidades.reduce(function(a,b){return a+b;}, 0));
  }

  // MÉTODO 3: Buscar patrón "Etiquetado obligatorio" + número en siguiente contexto
  if (cantidades.length < codigosOrdenados.length) {
    console.log('Método 2 insuficiente (' + cantidades.length + '), probando método 3...');
    cantidades = [];

    // Dividir por cada código ML y extraer el número que sigue
    var secciones = text.split(/Código\s*ML:/i);
    console.log('Secciones por Código ML:', secciones.length);
    for (var s = 1; s < secciones.length; s++) {
      var seccion = secciones[s];
      // Buscar número después de "obligatorio" o "universal"
      var matchSeccion = seccion.match(/(?:obligatorio|universal)\s*(\d{1,3})\b/i);
      if (matchSeccion) {
        var numSec = parseInt(matchSeccion[1], 10);
        if (numSec > 0 && numSec < 500) {
          cantidades.push(numSec);
        }
      } else {
        // Fallback: buscar primer número aislado en la sección
        var matchNum = seccion.match(/\b(\d{1,3})\b/);
        if (matchNum) {
          var numFallback = parseInt(matchNum[1], 10);
          if (numFallback > 0 && numFallback < 500) {
            cantidades.push(numFallback);
          }
        }
      }
    }
    console.log('MÉTODO 3 - por secciones:', cantidades.length, 'suma:', cantidades.reduce(function(a,b){return a+b;}, 0));
  }

  console.log('========== FIN DEBUG ==========');

  console.log('Códigos ML encontrados: ' + codigosOrdenados.length);
  console.log('Cantidades extraídas: ' + cantidades.length);
  console.log('Suma de cantidades: ' + cantidades.reduce(function(a,b){return a+b;}, 0));
  if (cantidades.length <= 60) {
    console.log('Cantidades: ' + cantidades.join(', '));
  }

  // =====================================================
  // VALIDACIÓN TEMPRANA - Fallar rápido si no hay datos
  // =====================================================

  if (codigosOrdenados.length === 0) {
    return {
      items: {},
      totalItems: 0,
      totalUnits: 0,
      envioId: envioId,
      totalDeclarado: { productos: totalProductos, unidades: totalUnidadesDeclaradas },
      validacion: { ok: false, error: 'No se encontraron códigos ML en el PDF' }
    };
  }

  if (cantidades.length === 0) {
    return {
      items: {},
      totalItems: 0,
      totalUnits: 0,
      envioId: envioId,
      totalDeclarado: { productos: totalProductos, unidades: totalUnidadesDeclaradas },
      validacion: {
        ok: false,
        error: 'No se pudieron extraer las cantidades del PDF. El formato puede ser diferente al esperado.'
      }
    };
  }

  // =====================================================
  // ESTRATEGIA DE MATCHING - Solo aceptar si suma correctamente
  // =====================================================

  var cantidadesValidas = [];
  var numCodigos = codigosOrdenados.length;

  if (totalUnidadesDeclaradas > 0 && numCodigos > 0) {

    // Estrategia 1: Buscar secuencia contigua que sume exactamente
    for (var start = 0; start <= cantidades.length - numCodigos; start++) {
      var subset = cantidades.slice(start, start + numCodigos);
      var suma = subset.reduce(function(a, b) { return a + b; }, 0);
      if (suma === totalUnidadesDeclaradas) {
        cantidadesValidas = subset;
        console.log('✓ Secuencia contigua encontrada en posición ' + start);
        break;
      }
    }

    // Estrategia 2: Filtrar números sospechosos (como el total de productos) y buscar de nuevo
    if (cantidadesValidas.length === 0) {
      var cantidadesFiltradas = cantidades.filter(function(c) {
        return c !== totalProductos;
      });

      for (var start = 0; start <= cantidadesFiltradas.length - numCodigos; start++) {
        var subset = cantidadesFiltradas.slice(start, start + numCodigos);
        var suma = subset.reduce(function(a, b) { return a + b; }, 0);
        if (suma === totalUnidadesDeclaradas) {
          cantidadesValidas = subset;
          console.log('✓ Secuencia encontrada después de filtrar (pos ' + start + ')');
          break;
        }
      }
    }

    // Estrategia 3: Backtracking para encontrar N números que sumen el total
    if (cantidadesValidas.length === 0 && cantidades.length >= numCodigos) {
      console.log('Intentando backtracking con ' + cantidades.length + ' cantidades...');
      var encontrada = buscarCombinacion(cantidades, numCodigos, totalUnidadesDeclaradas);
      if (encontrada) {
        cantidadesValidas = encontrada;
        console.log('✓ Combinación válida encontrada con backtracking');
      }
    }

    // Estrategia 4: Si hay exactamente la cantidad correcta de números, verificar suma
    if (cantidadesValidas.length === 0 && cantidades.length === numCodigos) {
      var suma = cantidades.reduce(function(a, b) { return a + b; }, 0);
      if (suma === totalUnidadesDeclaradas) {
        cantidadesValidas = cantidades;
        console.log('✓ Usando todas las cantidades (coinciden exactamente)');
      }
    }
  }

  // =====================================================
  // FALLAR SI NO SE PUDO HACER MATCH CORRECTO
  // =====================================================

  if (cantidadesValidas.length !== numCodigos) {
    var sumaExtraida = cantidades.reduce(function(a, b) { return a + b; }, 0);
    return {
      items: {},
      totalItems: 0,
      totalUnits: 0,
      envioId: envioId,
      totalDeclarado: { productos: totalProductos, unidades: totalUnidadesDeclaradas },
      validacion: {
        ok: false,
        error: 'No se pudo asociar las cantidades correctamente. Extraídas: ' + cantidades.length +
               ' cantidades (suma=' + sumaExtraida + '), esperadas: ' + numCodigos +
               ' productos con ' + totalUnidadesDeclaradas + ' unidades totales.'
      }
    };
  }

  // Crear items asociando código con cantidad (ya validado que son correctos)
  for (var i = 0; i < codigosOrdenados.length; i++) {
    var codigo = codigosOrdenados[i];
    items[codigo] = { cantidad: cantidadesValidas[i], verificado: false };
  }

  // Calcular total de unidades
  totalUnits = 0;
  Object.keys(items).forEach(function(k) {
    totalUnits += items[k].cantidad;
  });

  console.log('PDF parseado OK - Envío: ' + envioId + ', Productos: ' + Object.keys(items).length + ', Unidades: ' + totalUnits);

  // Validación final (debería pasar siempre si llegamos acá)
  var validacion = { ok: true, error: null };

  if (totalUnidadesDeclaradas > 0 && totalUnits !== totalUnidadesDeclaradas) {
    validacion.ok = false;
    validacion.error = 'Las unidades extraídas (' + totalUnits + ') no coinciden con las declaradas (' + totalUnidadesDeclaradas + ')';
  }

  if (totalProductos > 0 && Object.keys(items).length !== totalProductos) {
    validacion.ok = false;
    validacion.error = 'Los productos extraídos (' + Object.keys(items).length + ') no coinciden con los declarados (' + totalProductos + ')';
  }

  return {
    items: items,
    totalItems: Object.keys(items).length,
    totalUnits: totalUnits,
    envioId: envioId,
    totalDeclarado: {
      productos: totalProductos,
      unidades: totalUnidadesDeclaradas
    },
    validacion: validacion
  };
}

// Asegurar que existe la hoja Colectas
async function ensureColectasSheet() {
  if (!sheets || !SHEET_ID) return;

  try {
    var spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    var colectasSheet = spreadsheet.data.sheets.find(function(s) {
      return s.properties.title === 'Colectas';
    });

    if (!colectasSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        resource: {
          requests: [{
            addSheet: {
              properties: { title: 'Colectas' }
            }
          }]
        }
      });
      console.log('Hoja Colectas creada');
    }
  } catch (error) {
    console.error('Error verificando hoja Colectas:', error.message);
  }
}

// Guardar TODAS las colectas en Google Sheets
async function saveColectasToSheets() {
  if (!sheets || !SHEET_ID) return;

  try {
    await ensureColectasSheet();

    // Preparar datos para guardar (todas las colectas)
    var rows = [['ColectaID', 'CodigoML', 'Cantidad', 'Verificado', 'FechaVerificacion', 'FechaColecta', 'FechaCarga', 'Nombre', 'Cuenta', 'FechaRetiro']];

    Object.keys(colectas).forEach(function(colectaId) {
      var colecta = colectas[colectaId];
      Object.keys(colecta.items).forEach(function(codigoML) {
        var item = colecta.items[codigoML];
        rows.push([
          colectaId,
          codigoML,
          item.cantidad,
          item.verificado ? 'SI' : 'NO',
          item.fechaVerificacion || '',
          colecta.fechaColecta,
          colecta.fecha,
          colecta.nombre || '',
          colecta.cuenta || '',
          colecta.fechaRetiro || ''
        ]);
      });
    });

    // Limpiar y escribir datos
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: 'Colectas!A:J'
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: 'Colectas!A1',
      valueInputOption: 'RAW',
      resource: { values: rows }
    });

    console.log('Colectas guardadas en Sheets: ' + Object.keys(colectas).length + ' colectas');
  } catch (error) {
    console.error('Error guardando colectas:', error.message);
  }
}

// Cargar TODAS las colectas desde Google Sheets
async function loadColectasFromSheets() {
  if (!sheets || !SHEET_ID) return;

  try {
    var response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Colectas!A:J'
    });

    var rows = response.data.values || [];
    if (rows.length <= 1) {
      colectas = {};
      return;
    }

    colectas = {};
    var hoy = new Date();
    var colectasExpiradas = [];

    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      var colectaId = row[0];
      var codigoML = row[1];
      var cantidad = parseInt(row[2], 10) || 1;
      var verificado = row[3] === 'SI';
      var fechaVerificacion = row[4] || '';
      var fechaColecta = row[5] || '';
      var fechaCarga = row[6] || '';
      var nombre = row[7] || '';
      var cuenta = row[8] || '';
      var fechaRetiro = row[9] || '';

      // Verificar si está expirada (más de 1 día después de la colecta)
      if (fechaColecta) {
        var fechaCol = new Date(fechaColecta + 'T00:00:00');
        var diferenciaDias = Math.floor((hoy - fechaCol) / (1000 * 60 * 60 * 24));
        if (diferenciaDias > 1) {
          if (!colectasExpiradas.includes(colectaId)) {
            colectasExpiradas.push(colectaId);
          }
          continue; // Saltear items de colectas expiradas
        }
      }

      // Crear colecta si no existe
      if (!colectas[colectaId]) {
        colectas[colectaId] = {
          id: colectaId,
          nombre: nombre,
          fecha: fechaCarga,
          fechaColecta: fechaColecta,
          cuenta: cuenta,
          fechaRetiro: fechaRetiro,
          items: {},
          totalItems: 0,
          totalUnits: 0,
          verificados: 0
        };
      }

      // Agregar item
      colectas[colectaId].items[codigoML] = { cantidad, verificado, fechaVerificacion };
      colectas[colectaId].totalItems++;
      colectas[colectaId].totalUnits += cantidad;
      if (verificado) colectas[colectaId].verificados++;
    }

    // Si hubo colectas expiradas, guardar sin ellas
    if (colectasExpiradas.length > 0) {
      console.log('Colectas expiradas eliminadas: ' + colectasExpiradas.join(', '));
      await saveColectasToSheets();
    }

    console.log('Colectas cargadas: ' + Object.keys(colectas).length + ' colectas activas');
  } catch (error) {
    if (error.message.includes('Unable to parse range')) {
      colectas = {};
    } else {
      console.error('Error cargando colectas:', error.message);
    }
  }
}

// Eliminar una colecta específica
async function deleteColecta(colectaId) {
  if (colectas[colectaId]) {
    delete colectas[colectaId];
    await saveColectasToSheets();
    return true;
  }
  return false;
}

// ============================================
// ENDPOINTS
// ============================================

// Buscar por Código ML
app.get('/api/codigo/:codigoML', function(req, res) {
  var codigoML = req.params.codigoML.trim().toUpperCase();

  var data = codigosCache[codigoML];
  if (!data) {
    return res.status(404).json({ error: 'Código ML no encontrado: ' + codigoML });
  }

  var components = parseSKU(data.sku);
  var items = [];

  // Contar vidrios e hidrogeles
  var glassCount = 0;
  var hydrogelCount = 0;

  if (components.length > 1) {
    // Es un kit
    for (var j = 0; j < components.length; j++) {
      var component = components[j];
      if (component.sku.startsWith('VF')) {
        glassCount += component.quantity;
      }
      if (component.sku.toLowerCase().includes('hidrogel')) {
        hydrogelCount += component.quantity;
      }
      items.push({
        id: codigoML + '-' + component.sku,
        title: data.producto,
        sku: component.sku,
        description: describeSKU(component.sku),
        quantity: component.quantity,
        isKit: true,
        originalSku: data.sku
      });
    }
  } else if (components.length === 1) {
    var comp = components[0];
    if (comp.sku.startsWith('VF')) {
      glassCount += comp.quantity;
    }
    if (comp.sku.toLowerCase().includes('hidrogel')) {
      hydrogelCount += comp.quantity;
    }
    items.push({
      id: codigoML,
      title: data.producto,
      sku: comp.sku,
      description: describeSKU(comp.sku),
      quantity: comp.quantity,
      isKit: false
    });
  } else {
    items.push({
      id: codigoML,
      title: data.producto,
      sku: data.sku || 'SIN SKU',
      description: '',
      quantity: 1,
      isKit: false
    });
  }

  // Agregar verificación "Papelitos 1y2" si hay vidrio o hidrogel
  var papelitosCount = glassCount + hydrogelCount;
  if (papelitosCount > 0) {
    items.push({
      id: 'verification-papelitos',
      title: 'Verificación adicional',
      sku: 'PAPELITOS',
      description: 'Papelitos 1y2',
      quantity: 1,
      displayQuantity: papelitosCount,
      isKit: false,
      isVerificationOnly: true
    });
  }

  // Agregar "Cartoncito Colocador" si hay hidrogel
  if (hydrogelCount > 0) {
    items.push({
      id: 'verification-cartoncito',
      title: 'Verificación adicional',
      sku: 'CARTONCITO',
      description: 'Cartoncito Colocador',
      quantity: 1,
      displayQuantity: hydrogelCount,
      isKit: false,
      isVerificationOnly: true
    });
  }

  // Buscar en qué colectas está este código
  var colectasInfo = [];
  Object.keys(colectas).forEach(function(colectaId) {
    var colecta = colectas[colectaId];
    if (colecta.items[codigoML]) {
      var itemColecta = colecta.items[codigoML];
      colectasInfo.push({
        colectaId: colectaId,
        fechaColecta: colecta.fechaColecta,
        nombre: colecta.nombre,
        cantidad: itemColecta.cantidad,
        verificado: itemColecta.verificado,
        fechaVerificacion: itemColecta.fechaVerificacion
      });
    }
  });

  res.json({
    codigoML: codigoML,
    cuenta: data.cuenta,
    producto: data.producto,
    skuOriginal: data.sku,
    items: items,
    colectas: colectasInfo, // Array de colectas donde está este código
    enColectas: colectasInfo.length > 0
  });
});

// Recargar códigos desde Sheets
app.post('/api/reload', async function(req, res) {
  await loadCodigosFromSheets();
  res.json({ success: true, count: Object.keys(codigosCache).length });
});

// Estadísticas
app.get('/api/stats', function(req, res) {
  var cuentas = {};
  Object.values(codigosCache).forEach(function(v) {
    cuentas[v.cuenta] = (cuentas[v.cuenta] || 0) + 1;
  });
  res.json({
    totalCodigos: Object.keys(codigosCache).length,
    porCuenta: cuentas
  });
});

// ============================================
// ENDPOINTS DE COLECTA (múltiples)
// ============================================

// DEBUG: Ver qué extrae del PDF (para diagnosticar)
app.post('/api/colecta/debug-pdf', upload.single('pdf'), async function(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió archivo PDF' });
    }

    // Usar el parser real para ver qué extrae
    var resultado = await parseColectaPDF(req.file.buffer);

    // Convertir items a lista para mostrar
    var itemsList = Object.keys(resultado.items).map(function(codigo) {
      return {
        codigo: codigo,
        cantidad: resultado.items[codigo].cantidad
      };
    });

    res.json({
      envioId: resultado.envioId,
      productosDeclarados: resultado.totalDeclarado.productos,
      unidadesDeclaradas: resultado.totalDeclarado.unidades,
      productosExtraidos: resultado.totalItems,
      unidadesExtraidas: resultado.totalUnits,
      validacion: resultado.validacion,
      items: itemsList
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Subir PDF de colecta
app.post('/api/colecta/upload', upload.single('pdf'), async function(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió archivo PDF' });
    }

    var fechaColecta = req.body.fechaColecta;
    if (!fechaColecta) {
      return res.status(400).json({ error: 'Falta la fecha de colecta' });
    }

    // Verificar límite de 5 colectas
    if (Object.keys(colectas).length >= 5) {
      return res.status(400).json({ error: 'Máximo 5 colectas activas. Eliminá una para agregar otra.' });
    }

    // Parsear el PDF
    var resultado = await parseColectaPDF(req.file.buffer);

    if (resultado.totalItems === 0) {
      return res.status(400).json({ error: 'No se encontraron códigos ML en el PDF' });
    }

    // Detectar colectas duplicadas (mismo envioId o mismos códigos)
    var codigosNuevos = Object.keys(resultado.items).sort().join(',');
    var colectaDuplicada = null;
    Object.values(colectas).forEach(function(col) {
      // Comparar por nombre de envío
      if (resultado.envioId && col.nombre === 'Envío #' + resultado.envioId) {
        colectaDuplicada = col;
        return;
      }
      // Comparar por códigos (si tienen exactamente los mismos)
      var codigosExistentes = Object.keys(col.items).sort().join(',');
      if (codigosExistentes === codigosNuevos) {
        colectaDuplicada = col;
      }
    });

    if (colectaDuplicada) {
      return res.status(400).json({
        error: 'Esta colecta ya existe: ' + colectaDuplicada.nombre,
        colectaExistente: colectaDuplicada.id
      });
    }

    // Validar que las unidades extraídas coincidan con las declaradas
    if (!resultado.validacion.ok) {
      return res.status(400).json({
        error: resultado.validacion.error,
        detalle: {
          productosExtraidos: resultado.totalItems,
          productosDeclarados: resultado.totalDeclarado.productos,
          unidadesExtraidas: resultado.totalUnits,
          unidadesDeclaradas: resultado.totalDeclarado.unidades
        }
      });
    }

    // Crear nueva colecta
    var colectaId = generarIdColecta();
    var hoy = new Date();
    var nombre = resultado.envioId ? 'Envío #' + resultado.envioId : 'Colecta ' + fechaColecta;
    var cuenta = req.body.cuenta || '';
    var fechaRetiro = req.body.fechaRetiro || '';

    colectas[colectaId] = {
      id: colectaId,
      nombre: nombre,
      fecha: hoy.toISOString().split('T')[0],
      fechaColecta: fechaColecta,
      cuenta: cuenta,
      fechaRetiro: fechaRetiro,
      items: resultado.items,
      totalItems: resultado.totalItems,
      totalUnits: resultado.totalUnits
      // verificados se calcula dinámicamente con calcularEstadisticasColecta()
    };

    // Guardar en Sheets
    await saveColectasToSheets();

    res.json({
      success: true,
      mensaje: 'Colecta cargada correctamente',
      colectaId: colectaId,
      nombre: nombre,
      totalCodigos: resultado.totalItems,
      totalUnidades: resultado.totalUnits,
      fechaColecta: fechaColecta
    });
  } catch (error) {
    console.error('Error procesando PDF:', error);
    res.status(500).json({ error: 'Error procesando PDF: ' + error.message });
  }
});

// Obtener todas las colectas (lista)
app.get('/api/colectas', function(req, res) {
  var lista = Object.values(colectas).map(function(col) {
    var stats = calcularEstadisticasColecta(col);
    return {
      id: col.id,
      nombre: col.nombre,
      cuenta: col.cuenta || '',
      fechaColecta: col.fechaColecta,
      fechaRetiro: col.fechaRetiro || '',
      fechaCarga: col.fecha,
      totalCodigos: col.totalItems,
      totalUnidades: col.totalUnits,
      verificados: stats.verificados,
      unidadesVerificadas: stats.unidadesVerificadas,
      pendientes: stats.pendientes,
      progreso: stats.progreso
    };
  });

  // Ordenar por fecha de colecta
  lista.sort(function(a, b) {
    return new Date(a.fechaColecta) - new Date(b.fechaColecta);
  });

  res.json({
    total: lista.length,
    colectas: lista
  });
});

// Obtener una colecta específica
app.get('/api/colecta/:id', function(req, res) {
  var colectaId = req.params.id;
  var colecta = colectas[colectaId];

  if (!colecta) {
    return res.status(404).json({ error: 'Colecta no encontrada' });
  }

  var stats = calcularEstadisticasColecta(colecta);

  // Construir lista de items para el response
  var itemsList = Object.keys(colecta.items).map(function(codigoML) {
    var item = colecta.items[codigoML];
    return {
      codigoML: codigoML,
      cantidad: item.cantidad,
      verificado: item.verificado,
      fechaVerificacion: item.fechaVerificacion || ''
    };
  });

  // Ordenar items: pendientes primero, luego verificados
  itemsList.sort(function(a, b) {
    if (a.verificado === b.verificado) return a.codigoML.localeCompare(b.codigoML);
    return a.verificado ? 1 : -1;
  });

  res.json({
    id: colecta.id,
    nombre: colecta.nombre,
    cuenta: colecta.cuenta || '',
    fechaColecta: colecta.fechaColecta,
    fechaRetiro: colecta.fechaRetiro || '',
    fechaCarga: colecta.fecha,
    totalCodigos: colecta.totalItems,
    totalUnidades: colecta.totalUnits,
    verificados: stats.verificados,
    unidadesVerificadas: stats.unidadesVerificadas,
    pendientes: stats.pendientes,
    listaPendientes: stats.listaPendientes,
    progreso: stats.progreso,
    items: itemsList
  });
});

// Marcar código como verificado en una colecta específica
app.post('/api/colecta/:id/verificar/:codigoML', async function(req, res) {
  var colectaId = req.params.id;
  var codigoML = req.params.codigoML.trim().toUpperCase();

  var colecta = colectas[colectaId];
  if (!colecta) {
    return res.status(404).json({ error: 'Colecta no encontrada' });
  }

  if (!colecta.items[codigoML]) {
    return res.status(404).json({ error: 'Código no está en esta colecta' });
  }

  if (colecta.items[codigoML].verificado) {
    var statsYa = calcularEstadisticasColecta(colecta);
    return res.json({
      success: true,
      yaVerificado: true,
      mensaje: 'Este código ya fue verificado',
      verificados: statsYa.verificados,
      unidadesVerificadas: statsYa.unidadesVerificadas,
      pendientes: statsYa.pendientes,
      progreso: statsYa.progreso
    });
  }

  colecta.items[codigoML].verificado = true;
  colecta.items[codigoML].fechaVerificacion = new Date().toISOString();

  await saveColectasToSheets();

  var stats = calcularEstadisticasColecta(colecta);

  res.json({
    success: true,
    verificados: stats.verificados,
    unidadesVerificadas: stats.unidadesVerificadas,
    pendientes: stats.pendientes,
    progreso: stats.progreso
  });
});

// Marcar código en TODAS las colectas donde aparece
app.post('/api/colectas/verificar/:codigoML', async function(req, res) {
  var codigoML = req.params.codigoML.trim().toUpperCase();
  var colectasAfectadas = [];

  Object.keys(colectas).forEach(function(colectaId) {
    var colecta = colectas[colectaId];
    if (colecta.items[codigoML] && !colecta.items[codigoML].verificado) {
      colecta.items[codigoML].verificado = true;
      colecta.items[codigoML].fechaVerificacion = new Date().toISOString();
      colectasAfectadas.push(colectaId);
    }
  });

  if (colectasAfectadas.length > 0) {
    await saveColectasToSheets();
  }

  res.json({
    success: true,
    colectasAfectadas: colectasAfectadas.length,
    mensaje: colectasAfectadas.length > 0
      ? 'Marcado en ' + colectasAfectadas.length + ' colecta(s)'
      : 'Código no encontrado en ninguna colecta pendiente'
  });
});

// Desmarcar código en una colecta
app.post('/api/colecta/:id/desverificar/:codigoML', async function(req, res) {
  var colectaId = req.params.id;
  var codigoML = req.params.codigoML.trim().toUpperCase();

  var colecta = colectas[colectaId];
  if (!colecta) {
    return res.status(404).json({ error: 'Colecta no encontrada' });
  }

  if (!colecta.items[codigoML]) {
    return res.status(404).json({ error: 'Código no está en esta colecta' });
  }

  if (!colecta.items[codigoML].verificado) {
    var statsYa = calcularEstadisticasColecta(colecta);
    return res.json({
      success: true,
      mensaje: 'Este código no estaba verificado',
      verificados: statsYa.verificados,
      unidadesVerificadas: statsYa.unidadesVerificadas,
      pendientes: statsYa.pendientes,
      progreso: statsYa.progreso
    });
  }

  colecta.items[codigoML].verificado = false;
  colecta.items[codigoML].fechaVerificacion = '';

  await saveColectasToSheets();

  var stats = calcularEstadisticasColecta(colecta);

  res.json({
    success: true,
    verificados: stats.verificados,
    unidadesVerificadas: stats.unidadesVerificadas,
    pendientes: stats.pendientes,
    progreso: stats.progreso
  });
});

// Eliminar una colecta específica
app.delete('/api/colecta/:id', async function(req, res) {
  var colectaId = req.params.id;

  if (!colectas[colectaId]) {
    return res.status(404).json({ error: 'Colecta no encontrada' });
  }

  var nombre = colectas[colectaId].nombre;
  delete colectas[colectaId];
  await saveColectasToSheets();

  res.json({ success: true, mensaje: 'Colecta "' + nombre + '" eliminada' });
});

// Actualizar datos de una colecta (cuenta, fecha retiro, nombre)
app.patch('/api/colecta/:id', async function(req, res) {
  var colectaId = req.params.id;
  var colecta = colectas[colectaId];

  if (!colecta) {
    return res.status(404).json({ error: 'Colecta no encontrada' });
  }

  // Actualizar campos opcionales
  if (req.body.cuenta !== undefined) {
    colecta.cuenta = req.body.cuenta;
  }
  if (req.body.fechaRetiro !== undefined) {
    colecta.fechaRetiro = req.body.fechaRetiro;
  }
  if (req.body.nombre !== undefined) {
    colecta.nombre = req.body.nombre;
  }
  if (req.body.fechaColecta !== undefined) {
    colecta.fechaColecta = req.body.fechaColecta;
  }

  await saveColectasToSheets();

  res.json({
    success: true,
    colecta: {
      id: colecta.id,
      nombre: colecta.nombre,
      cuenta: colecta.cuenta,
      fechaColecta: colecta.fechaColecta,
      fechaRetiro: colecta.fechaRetiro
    }
  });
});

// Datos para vista calendario (agrupa por fecha de colecta)
app.get('/api/colectas/calendario', function(req, res) {
  var porFecha = {};

  Object.values(colectas).forEach(function(col) {
    var fecha = col.fechaColecta;
    if (!porFecha[fecha]) {
      porFecha[fecha] = [];
    }

    var stats = calcularEstadisticasColecta(col);

    porFecha[fecha].push({
      id: col.id,
      nombre: col.nombre,
      cuenta: col.cuenta || '',
      fechaRetiro: col.fechaRetiro || '',
      totalCodigos: col.totalItems,
      totalUnidades: col.totalUnits,
      verificados: stats.verificados,
      unidadesVerificadas: stats.unidadesVerificadas,
      progreso: stats.progreso
    });
  });

  res.json(porFecha);
});

// ============================================
// VISION API - Verificación con Claude
// ============================================

app.post('/api/vision/analyze', async function(req, res) {
  if (!anthropic) {
    return res.status(500).json({ error: 'Claude API no configurada' });
  }

  var imageBase64 = req.body.image;
  var productoEsperado = req.body.producto;

  if (!imageBase64) {
    return res.status(400).json({ error: 'No se recibió imagen' });
  }

  var mediaType = 'image/jpeg';
  if (imageBase64.includes('data:image/')) {
    var matches = imageBase64.match(/data:(image\/[a-z]+);base64,/);
    if (matches) {
      mediaType = matches[1];
    }
    imageBase64 = imageBase64.split('base64,')[1];
  }

  try {
    var prompt = '';

    if (productoEsperado) {
      prompt = `Sos un verificador de pedidos. Tu trabajo es confirmar si el producto en la foto coincide con lo que se pidió.

PRODUCTO ESPERADO DEL PEDIDO:
${typeof productoEsperado === 'string' ? productoEsperado : JSON.stringify(productoEsperado, null, 2)}

REGLAS DE COMPARACIÓN DE MODELOS:

1. IGNORAR TEXTO EXTRA EN ETIQUETAS - Solo importa el código de modelo:
   - Ignorar marcas: "MOTO G15" = "G15", "Samsung A25" = "A25"
   - Ignorar texto adicional: "SX", "For", "Galaxy", "Phone case", etc.

2. SUFIJOS IMPORTANTES QUE DEBEN COINCIDIR EXACTAMENTE:
   Plus (o +), Ultra, Pro, Pro Max, Air, Fusion, Neo
   - A15 ≠ A15 Plus
   - iPhone 15 ≠ iPhone 15 Pro Max

3. OTROS SUFIJOS TAMBIÉN SON DIFERENTES:
   - A03 ≠ A03s ≠ A03 Core
   - G24 ≠ G24 Power
   - Redmi 14 ≠ Redmi Note 14

4. REGLA ESPECIAL PARA FUNDAS Y 4G/5G:
   - IGNORAR "4G" o "5G" esté separado O PEGADO al modelo
   - "A265G", "A26 5G" → es "A26"
   - EXCEPCIÓN ÚNICA: A22 (sí distinguir A22 4G vs A22 5G)

INSTRUCCIONES:
1. Extraé el CÓDIGO DE MODELO de la etiqueta (ignorá la marca)
2. Compará el código con el pedido usando las reglas anteriores
3. Verificá que el COLOR coincida

IMPORTANTE:
- El fondo suele ser madera, ignoralo
- Las fundas vienen en bolsas transparentes con etiquetas

Respondé SOLO con este JSON:
{
  "correcto": true/false,
  "productoDetectado": "descripción breve de lo que ves",
  "modeloDetectado": "código del modelo sin marca",
  "colorDetectado": "color del producto",
  "motivo": "si es incorrecto, explicá por qué",
  "confianza": "alta/media/baja"
}`;
    } else {
      prompt = `Analizá esta imagen de un producto (funda de celular).

Extraé:
1. **Modelo/SKU**: Buscá códigos en etiquetas (A25, A36, B12, "For A06", etc.)
2. **Color**: Color real del producto
3. **Tipo**: Qué tipo de producto es

IGNORAR: "Fashion Case", "New", "Phone case", "Made in China", "SX", "For", marcas

REGLA 4G/5G: IGNORAR "4G" o "5G" (excepto A22)

Respondé SOLO con este JSON:
{
  "modeloDetectado": "código encontrado o null",
  "colorDetectado": "color del producto",
  "tipoProducto": "funda silicona/funda transparente/vidrio/etc",
  "confianza": "alta/media/baja"
}`;
    }

    var response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBase64
            }
          },
          { type: 'text', text: prompt }
        ]
      }]
    });

    var claudeText = response.content[0].text.trim();
    console.log('Claude response:', claudeText);

    var jsonMatch = claudeText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({
        error: 'Claude no devolvió JSON válido',
        rawResponse: claudeText
      });
    }

    var result = JSON.parse(jsonMatch[0]);
    res.json({ success: true, ...result });

  } catch (error) {
    console.error('Error en Claude Vision:', error.message);
    res.status(500).json({ error: 'Error procesando imagen: ' + error.message });
  }
});

// ============================================
// INICIO DEL SERVIDOR
// ============================================

var PORT = process.env.PORT || 3000;

// Cargar datos iniciales y arrancar servidor
Promise.all([
  loadCodigosFromSheets(),
  loadColectasFromSheets()
]).then(function() {
  app.listen(PORT, function() {
    console.log('Servidor corriendo en puerto ' + PORT);
  });
});
