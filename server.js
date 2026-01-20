require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk');

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
  var auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  sheets = google.sheets({ version: 'v4', auth: auth });
  console.log('Google Sheets configurado');
}

// ============================================
// CACHE DE CÓDIGOS ML
// ============================================

var codigosCache = {}; // CodigoML -> { cuenta, sku, producto }

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

  res.json({
    codigoML: codigoML,
    cuenta: data.cuenta,
    producto: data.producto,
    skuOriginal: data.sku,
    items: items
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

loadCodigosFromSheets().then(function() {
  app.listen(PORT, function() {
    console.log('Servidor corriendo en puerto ' + PORT);
  });
});
