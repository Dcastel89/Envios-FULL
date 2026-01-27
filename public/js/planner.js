  (function plannerInit() {
    var isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isPWA) return;

    var MIN_STOCK_RESERVE = 10;
    var meliFiles = [{ name: null, data: null }, { name: null, data: null }, { name: null, data: null }];
    var stockData = null;
    var mayoristaData = null;
    var plannerResultsData = null;
    var plannerErrors = [];

    // Elementos
    var meliInputs = [
      document.getElementById('plannerMeli1'),
      document.getElementById('plannerMeli2'),
      document.getElementById('plannerMeli3')
    ];
    var meliStatuses = [
      document.getElementById('plannerMeli1Status'),
      document.getElementById('plannerMeli2Status'),
      document.getElementById('plannerMeli3Status')
    ];
    var stockInput = document.getElementById('plannerStock');
    var stockStatus = document.getElementById('plannerStockStatus');
    var mayoristaInput = document.getElementById('plannerMayorista');
    var mayoristaStatus = document.getElementById('plannerMayoristaStatus');
    var processBtn = document.getElementById('plannerProcessBtn');
    var exportBtn = document.getElementById('plannerExportBtn');
    var warningsDiv = document.getElementById('plannerWarnings');
    var warningsList = document.getElementById('plannerWarningsList');
    var resultsDiv = document.getElementById('plannerResults');
    var resultsCount = document.getElementById('plannerResultsCount');
    var sugeridas = document.getElementById('plannerSugeridas');
    var aEnviar = document.getElementById('plannerAEnviar');
    var validationDiv = document.getElementById('plannerValidation');
    var tableBody = document.getElementById('plannerTableBody');

    if (!processBtn) return;

    function parseNumber(value) {
      if (value === null || value === undefined || value === '' || value === '-') return 0;
      var str = value.toString().trim();
      if (str === '-' || str === '') return 0;
      var cleaned = str.replace(/[^\d]/g, '');
      var num = parseInt(cleaned);
      return isNaN(num) ? 0 : num;
    }

    function categorizeItem(item) {
      var recLower = (item.recommendation || '').toLowerCase().trim();
      if (recLower.includes('desvinculaste') || recLower.includes('no tenés recomendación')) return 'desvinculado';
      if (recLower.includes('no enviar') || recLower.includes('recomendamos no') || recLower.includes('desactivaste')) return 'excluir';
      if (!recLower.includes('envi') && item.suggestedUnits > 0) return 'sinRecomendacion';
      if (!recLower.includes('envi')) return 'excluir';
      if (item.unitsToSend === 0) return 'excluir';
      if (item.unitsToSend < item.suggestedUnits) return 'insuficiente';
      return 'ok';
    }

    function parseSkuComponent(component) {
      if (!component) return { sku: '', quantity: 1 };
      var trimmed = component.trim();
      var packMatch = trimmed.match(/^(.+)\((\d+)\)$/);
      if (packMatch) return { sku: packMatch[1].trim(), quantity: parseInt(packMatch[2]) || 1 };
      return { sku: trimmed, quantity: 1 };
    }

    function isAnilloSegment(segment) {
      if (!segment) return false;
      var upper = segment.toUpperCase().trim();
      return upper === 'ANILLO' || upper === 'ANILLO+V';
    }

    function parseSku(sku) {
      if (!sku || typeof sku !== 'string') return [];
      var workingSku = sku.trim();
      if (!workingSku) return [];
      if (workingSku.startsWith('5') && workingSku.indexOf('/') !== -1) {
        var parts = workingSku.split('/');
        return parts.slice(1).map(parseSkuComponent).filter(function(c) { return c.sku.length > 0 && !isAnilloSegment(c.sku); });
      }
      if (workingSku.indexOf('/') !== -1) {
        return workingSku.split('/').map(parseSkuComponent).filter(function(c) { return c.sku.length > 0 && !isAnilloSegment(c.sku); });
      }
      if (isAnilloSegment(workingSku)) return [];
      var parsed = parseSkuComponent(workingSku);
      return parsed.sku.length > 0 ? [parsed] : [];
    }

    function findStockForSku(skuToFind, stockRows) {
      if (!skuToFind || !stockRows) return { found: false, stock: 0, matchType: null };
      for (var i = 0; i < stockRows.length; i++) {
        var row = stockRows[i];
        var sku = (row.sku || '').toString().trim();
        var skuVariante = (row.sku_variante || '').toString().trim();
        if (sku === skuToFind) return { found: true, stock: parseNumber(row.stock_disponible), matchType: 'sku' };
        if (skuVariante === skuToFind) return { found: true, stock: parseNumber(row.stock_disponible), matchType: 'sku_variante' };
      }
      return { found: false, stock: 0, matchType: null };
    }

    function getMayoristaVentas(skuToFind, mayoristaRows) {
      if (!mayoristaRows || !skuToFind) return 0;
      for (var i = 0; i < mayoristaRows.length; i++) {
        var row = mayoristaRows[i];
        var sku = (row.sku || '').toString().trim();
        var skuVariante = (row.sku_variante || '').toString().trim();
        if (sku === skuToFind || skuVariante === skuToFind) return parseNumber(row.Vendidos);
      }
      return 0;
    }

    function getCategoryLabel(cat) {
      var labels = {
        'insuficiente': '🔴 Insuf.',
        'ok': '🟢 OK',
        'noEncontrado': '⚫ No enc.',
        'sinRecomendacion': '🟡 Sin rec.',
        'sinSku': '🟣 Sin SKU',
        'excluir': '⚪ Excluido',
        'desvinculado': '🔵 Desvinc.'
      };
      return labels[cat] || cat || '';
    }

    function updateProcessButton() {
      var hasMeli = meliFiles.some(function(f) { return f.data; });
      processBtn.disabled = !(stockData && hasMeli);
    }

    function readExcelFile(file, callback, skipRows) {
      var reader = new FileReader();
      reader.onload = function(evt) {
        try {
          var wb = XLSX.read(evt.target.result, { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var data;
          if (skipRows) {
            data = XLSX.utils.sheet_to_json(ws, { range: skipRows });
          } else {
            data = XLSX.utils.sheet_to_json(ws);
          }
          callback(null, data);
        } catch (err) {
          callback(err, null);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    function readMeliFile(file, callback) {
      var reader = new FileReader();
      reader.onload = function(evt) {
        try {
          var wb = XLSX.read(evt.target.result, { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var allData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true, raw: false });

          var headerRowIndex = -1;
          for (var i = 0; i < Math.min(allData.length, 20); i++) {
            if (allData[i] && allData[i].some(function(cell) { return cell && cell.toString().trim() === 'SKU'; })) {
              headerRowIndex = i;
              break;
            }
          }
          if (headerRowIndex === -1) { callback(new Error('No se encontró encabezado SKU'), null); return; }

          var headers = allData[headerRowIndex].map(function(h) {
            return h ? h.toString().trim().replace(/\n/g, ' ').replace(/\s+/g, ' ') : '';
          });
          var data = [];
          for (var i = headerRowIndex + 1; i < allData.length; i++) {
            var row = allData[i];
            if (!row || !row.some(function(cell) { return cell && cell.toString().trim(); })) continue;
            var obj = {};
            headers.forEach(function(h, j) { if (h) obj[h] = row[j] !== undefined ? row[j] : ''; });
            data.push(obj);
          }
          callback(null, data);
        } catch (err) {
          callback(err, null);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    // Event listeners para archivos
    meliInputs.forEach(function(input, index) {
      if (!input) return;
      input.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        meliStatuses[index].textContent = 'Leyendo...';
        meliStatuses[index].classList.remove('error');
        readMeliFile(file, function(err, data) {
          if (err) {
            meliStatuses[index].textContent = '✗ ' + err.message;
            meliStatuses[index].classList.add('error');
            meliFiles[index] = { name: null, data: null };
          } else {
            meliStatuses[index].textContent = '✓ ' + data.length + ' filas';
            meliFiles[index] = { name: file.name, data: data };
          }
          updateProcessButton();
        });
      });
    });

    if (stockInput) {
      stockInput.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        stockStatus.textContent = 'Leyendo...';
        readExcelFile(file, function(err, data) {
          if (err) {
            stockStatus.textContent = '✗ Error';
            stockStatus.classList.add('error');
            stockData = null;
          } else {
            stockStatus.textContent = '✓ ' + data.length + ' productos';
            stockData = data;
          }
          updateProcessButton();
        });
      });
    }

    if (mayoristaInput) {
      mayoristaInput.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        mayoristaStatus.textContent = 'Leyendo...';
        readExcelFile(file, function(err, data) {
          if (err) {
            mayoristaStatus.textContent = '✗ Error';
            mayoristaData = null;
          } else {
            mayoristaStatus.textContent = '✓ ' + data.length + ' productos';
            mayoristaData = data;
          }
        }, 2);
      });
    }

    // Procesar
    processBtn.addEventListener('click', function() {
      if (!stockData || meliFiles.every(function(f) { return !f.data; })) {
        alert('Falta cargar archivos: Stock y al menos un reporte de Meli');
        return;
      }

      var allPublicaciones = [];
      var notFound = [];
      var validacionPorCuenta = {};

      meliFiles.forEach(function(file, cuentaIndex) {
        if (!file.data) return;
        var cuentaName = file.name ? file.name.replace(/\.(xlsx|xls)$/i, '') : 'Cuenta ' + (cuentaIndex + 1);
        var sumaVerificacion = 0;

        for (var i = 0; i < file.data.length; i++) {
          var val = file.data[i]['Unidades sugeridas para enviar'];
          var num = parseNumber(val);
          if (num > 0) sumaVerificacion += num;
        }

        validacionPorCuenta[cuentaName] = { totalMeli: sumaVerificacion, totalProcesado: 0 };

        for (var i = 0; i < file.data.length; i++) {
          var meliRow = file.data[i];
          var originalSku = (meliRow['SKU'] || '').toString().trim();
          var suggestedUnits = parseNumber(meliRow['Unidades sugeridas para enviar']);
          var codigoUniversal = (meliRow['Código universal'] || '').toString().trim();
          var codigoML = (meliRow['Código ML'] || '').toString().trim();
          var numeroProducto = (meliRow['Número de producto'] || '').toString().trim();
          var publicacionesRaw = (meliRow['Publicaciones con este producto'] || '').toString().trim();
          var numeroPublicacion = publicacionesRaw.split(',')[0].trim();
          var recommendation = (meliRow['Recomendación'] || '').toString().trim();
          var vendidas30d = parseNumber(meliRow['Unidades vendidas Últ. 30 días']);
          var aptasParaVender = parseNumber(meliRow['Unidades aptas para vender']);
          var enCamino = parseNumber(meliRow['Unidades en camino']);

          if (!originalSku) {
            if (suggestedUnits > 0) {
              allPublicaciones.push({
                originalSku: '(SIN SKU)', codigoUniversal: codigoUniversal, codigoML: codigoML,
                numeroProducto: numeroProducto, numeroPublicacion: numeroPublicacion,
                recommendation: recommendation, suggestedUnits: suggestedUnits,
                vendidas30d: vendidas30d, aptasParaVender: aptasParaVender, enCamino: enCamino,
                skuComponents: [], cuenta: cuentaName, cuentaIndex: cuentaIndex, sinSku: true
              });
            }
            continue;
          }

          var skuComponents = parseSku(originalSku);
          if (skuComponents.length === 0) {
            notFound.push({ sku: originalSku, cuenta: cuentaName, reason: 'SKU inválido', unidades: suggestedUnits });
            continue;
          }

          allPublicaciones.push({
            originalSku: originalSku, codigoUniversal: codigoUniversal, codigoML: codigoML,
            numeroProducto: numeroProducto, numeroPublicacion: numeroPublicacion,
            recommendation: recommendation, suggestedUnits: suggestedUnits,
            vendidas30d: vendidas30d, aptasParaVender: aptasParaVender, enCamino: enCamino,
            skuComponents: skuComponents, cuenta: cuentaName, cuentaIndex: cuentaIndex
          });
        }
      });

      // Agrupar por SKU
      var demandaPorSku = {};
      var processed = [];

      for (var i = 0; i < allPublicaciones.length; i++) {
        var pub = allPublicaciones[i];
        if (pub.sinSku) {
          processed.push({
            originalSku: pub.originalSku, codigoUniversal: pub.codigoUniversal, codigoML: pub.codigoML,
            numeroProducto: pub.numeroProducto, numeroPublicacion: pub.numeroPublicacion,
            isKit: false, components: [], recommendation: pub.recommendation,
            suggestedUnits: pub.suggestedUnits, availableStock: 0, unitsToSend: 0, stockAfterSend: 0,
            vendidas30d: pub.vendidas30d, aptasParaVender: pub.aptasParaVender, enCamino: pub.enCamino,
            alerts: ['Sin SKU'], matchType: 'sin SKU',
            cuenta: pub.cuenta, cuentaIndex: pub.cuentaIndex, mayoristaReservado: 0, category: 'sinSku'
          });
          continue;
        }

        var mainComponent = pub.skuComponents[0];
        if (!mainComponent) continue;
        var skuKey = mainComponent.sku;

        if (!demandaPorSku[skuKey]) {
          demandaPorSku[skuKey] = { publicaciones: [], totalDemandaMeli: 0, mayoristaVentas: 0, stockInfo: null, multiplier: mainComponent.quantity };
        }
        demandaPorSku[skuKey].publicaciones.push(pub);
        demandaPorSku[skuKey].totalDemandaMeli += pub.suggestedUnits * mainComponent.quantity;
      }

      // Buscar stock
      Object.keys(demandaPorSku).forEach(function(skuKey) {
        demandaPorSku[skuKey].stockInfo = findStockForSku(skuKey, stockData);
        demandaPorSku[skuKey].mayoristaVentas = getMayoristaVentas(skuKey, mayoristaData);

        if (!demandaPorSku[skuKey].stockInfo.found) {
          demandaPorSku[skuKey].publicaciones.forEach(function(pub) {
            notFound.push({ sku: pub.originalSku, component: skuKey, cuenta: pub.cuenta, reason: 'SKU no encontrado', unidades: pub.suggestedUnits });
          });
        }
      });

      // Procesar cada grupo
      Object.keys(demandaPorSku).forEach(function(skuKey) {
        var grupo = demandaPorSku[skuKey];

        if (!grupo.stockInfo || !grupo.stockInfo.found) {
          grupo.publicaciones.forEach(function(pub) {
            processed.push({
              originalSku: pub.originalSku, codigoUniversal: pub.codigoUniversal, codigoML: pub.codigoML,
              numeroProducto: pub.numeroProducto, numeroPublicacion: pub.numeroPublicacion,
              isKit: pub.skuComponents.length > 1,
              components: pub.skuComponents.map(function(c) { return { sku: c.sku, quantity: c.quantity, matchType: 'no encontrado' }; }),
              recommendation: pub.recommendation,
              suggestedUnits: pub.suggestedUnits, availableStock: 0, unitsToSend: 0, stockAfterSend: 0,
              vendidas30d: pub.vendidas30d, aptasParaVender: pub.aptasParaVender, enCamino: pub.enCamino,
              alerts: ['SKU ' + skuKey + ' no encontrado'], matchType: 'no encontrado',
              cuenta: pub.cuenta, cuentaIndex: pub.cuentaIndex, mayoristaReservado: 0, category: 'noEncontrado'
            });
          });
          return;
        }

        var stockDisponible = grupo.stockInfo.stock;
        var stockUtilizable = Math.max(0, stockDisponible - MIN_STOCK_RESERVE);
        var demandaTotal = grupo.totalDemandaMeli + grupo.mayoristaVentas;

        var ratio = 1;
        if (demandaTotal > stockUtilizable && demandaTotal > 0) ratio = stockUtilizable / demandaTotal;

        var stockUsadoMeli = 0;
        var itemsDelGrupo = [];

        grupo.publicaciones.forEach(function(pub) {
          var multiplier = pub.skuComponents[0] ? pub.skuComponents[0].quantity : 1;
          var asignadoStock = Math.floor(pub.suggestedUnits * multiplier * ratio);
          var unitsToSend = Math.floor(asignadoStock / multiplier);
          stockUsadoMeli += unitsToSend * multiplier;

          var item = {
            originalSku: pub.originalSku, codigoUniversal: pub.codigoUniversal, codigoML: pub.codigoML,
            numeroProducto: pub.numeroProducto, numeroPublicacion: pub.numeroPublicacion,
            isKit: pub.skuComponents.length > 1,
            components: pub.skuComponents.map(function(c) { return { sku: c.sku, quantity: c.quantity, matchType: grupo.stockInfo.matchType }; }),
            recommendation: pub.recommendation,
            suggestedUnits: pub.suggestedUnits, availableStock: Math.floor(stockDisponible / multiplier),
            unitsToSend: unitsToSend, stockAfterSend: 0, alerts: [],
            vendidas30d: pub.vendidas30d, aptasParaVender: pub.aptasParaVender, enCamino: pub.enCamino,
            matchType: grupo.stockInfo.matchType,
            cuenta: pub.cuenta, cuentaIndex: pub.cuentaIndex, mayoristaReservado: 0
          };
          if (unitsToSend < pub.suggestedUnits && unitsToSend > 0) {
            item.alerts.push('Ratio: ' + (ratio * 100).toFixed(0) + '%');
          }
          itemsDelGrupo.push(item);
          processed.push(item);
        });

        var stockParaMayorista = Math.floor(grupo.mayoristaVentas * ratio);
        var stockRestante = stockDisponible - stockUsadoMeli - stockParaMayorista;

        itemsDelGrupo.forEach(function(item) {
          item.stockAfterSend = stockRestante;
          item.mayoristaReservado = stockParaMayorista;
          item.category = categorizeItem(item);
        });
      });

      // Validación
      processed.forEach(function(item) {
        if (validacionPorCuenta[item.cuenta]) {
          validacionPorCuenta[item.cuenta].totalProcesado += item.suggestedUnits;
        }
      });

      // Clasificar y ordenar
      var urgencyOrder = function(a, b) {
        var getUrgency = function(rec) { var r = (rec || '').toLowerCase(); return r.includes('urgencia') ? 1 : r.includes('envi') ? 2 : 3; };
        return getUrgency(a.recommendation) - getUrgency(b.recommendation);
      };

      var insuficiente = processed.filter(function(p) { return p.category === 'insuficiente'; }).sort(urgencyOrder);
      var ok = processed.filter(function(p) { return p.category === 'ok'; }).sort(urgencyOrder);
      var noEncontrado = processed.filter(function(p) { return p.category === 'noEncontrado'; });
      var sinRecomendacion = processed.filter(function(p) { return p.category === 'sinRecomendacion'; });
      var sinSku = processed.filter(function(p) { return p.category === 'sinSku'; });
      var desvinculados = processed.filter(function(p) { return p.category === 'desvinculado'; });
      var excluidos = processed.filter(function(p) { return p.category === 'excluir'; });

      var finalResults = insuficiente.concat(ok, noEncontrado, sinRecomendacion, sinSku, excluidos);

      // Guardar resultados
      plannerResultsData = { main: finalResults, desvinculados: desvinculados, validacion: validacionPorCuenta };
      plannerErrors = notFound;

      // Mostrar resultados
      renderResults();
    });

    function renderResults() {
      if (!plannerResultsData) return;

      var main = plannerResultsData.main;
      var validacion = plannerResultsData.validacion;

      // Warnings
      if (plannerErrors.length > 0) {
        warningsDiv.classList.remove('hidden');
        warningsList.innerHTML = plannerErrors.map(function(e) {
          return '<div>[' + e.cuenta + '] ' + e.sku + ' - ' + e.unidades + ' uds</div>';
        }).join('');
      } else {
        warningsDiv.classList.add('hidden');
      }

      // Results
      resultsDiv.classList.remove('hidden');
      exportBtn.classList.remove('hidden');

      var totalSugeridas = main.reduce(function(s, r) { return s + r.suggestedUnits; }, 0);
      var totalEnviar = main.reduce(function(s, r) { return s + r.unitsToSend; }, 0);

      resultsCount.textContent = main.length + ' productos';
      sugeridas.textContent = totalSugeridas;
      aEnviar.textContent = totalEnviar;

      // Validación
      var valHtml = '';
      Object.keys(validacion).forEach(function(c) {
        var v = validacion[c];
        var icon = v.totalMeli === v.totalProcesado ? '✓' : '⚠️ Diff=' + (v.totalMeli - v.totalProcesado);
        valHtml += c + ': Meli=' + v.totalMeli + ' Proc=' + v.totalProcesado + ' ' + icon + ' | ';
      });
      validationDiv.innerHTML = valHtml;

      // Tabla
      tableBody.innerHTML = main.map(function(r) {
        return '<tr>' +
          '<td><span class="planner-cat ' + r.category + '">' + getCategoryLabel(r.category) + '</span></td>' +
          '<td>' + r.cuenta + '</td>' +
          '<td class="font-mono">' + r.originalSku.substring(0, 25) + '</td>' +
          '<td>' + (r.recommendation || '').substring(0, 15) + '</td>' +
          '<td class="text-right">' + r.suggestedUnits + '</td>' +
          '<td class="text-right">' + r.availableStock + '</td>' +
          '<td class="text-right font-bold">' + r.unitsToSend + '</td>' +
          '<td class="text-right">' + r.mayoristaReservado + '</td>' +
          '<td class="text-right">' + r.stockAfterSend + '</td>' +
          '</tr>';
      }).join('');
    }

    // Función para nombres de hoja únicos
    function getUniqueSheetName(wb, name) {
      var n = (name || 'Hoja').substring(0, 31).replace(/[\\/*?:\[\]]/g, '');
      if (!n) n = 'Hoja';
      if (n.length > 31) n = n.substring(0, 31);
      var f = n, c = 1;
      while (wb.SheetNames.indexOf(f) !== -1) {
        var suffix = ' (' + c++ + ')';
        f = n.substring(0, 31 - suffix.length) + suffix;
      }
      return f;
    }

    // Exportar
    exportBtn.addEventListener('click', function() {
      if (!plannerResultsData || typeof XLSX === 'undefined') return;

      var wb = XLSX.utils.book_new();
      var omit = ['BLZT71495', 'CVKL95360', 'BJOJ43528', 'DOHU01052', 'JUSE20802', 'LKLY20388', 'TQSC20480', 'UTRJ19883', 'XALA20576'];

      var cuentas = [];
      plannerResultsData.main.forEach(function(r) {
        if (cuentas.indexOf(r.cuenta) === -1) cuentas.push(r.cuenta);
      });

      cuentas.forEach(function(cuenta) {
        var data = plannerResultsData.main.filter(function(r) { return r.cuenta === cuenta; }).map(function(r) {
          return {
            'Estado': getCategoryLabel(r.category),
            'SKU': r.originalSku,
            'Código universal': r.codigoUniversal,
            'Código ML': r.codigoML,
            'Número de publicación': r.numeroPublicacion,
            'Número de producto': r.numeroProducto,
            'Componentes': r.components ? r.components.map(function(c) { return c.quantity > 1 ? c.sku + '(' + c.quantity + ')' : c.sku; }).join('/') : '',
            'Recomendación': r.recommendation,
            'Unidades Sugeridas': r.suggestedUnits,
            'Stock Disponible': r.availableStock,
            'Unidades a Enviar': r.unitsToSend,
            'Reservado Mayorista': r.mayoristaReservado,
            'Stock Restante': r.stockAfterSend
          };
        });
        if (data.length) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), getUniqueSheetName(wb, cuenta));
        }
      });

      // Pestaña Colecta Reducida: 20 días de cobertura basado en ventas reales
      var DIAS_COBERTURA = 20;
      var reducidaData = plannerResultsData.main.filter(function(r) {
        return r.suggestedUnits > 0;
      }).map(function(r) {
        var v30 = r.vendidas30d || 0;
        var aptas = r.aptasParaVender || 0;
        var camino = r.enCamino || 0;
        var enviarReducida = Math.max(0, Math.ceil(v30 / 30 * DIAS_COBERTURA) - aptas - camino);
        // Mínimo 1 si tiene ventas y no tiene stock
        if (enviarReducida === 0 && v30 > 0 && aptas === 0 && camino === 0) enviarReducida = 1;
        // Piso: nunca menos del 30% de lo que ML sugiere
        var pisoML = Math.ceil(r.suggestedUnits * 0.3);
        if (enviarReducida < pisoML) enviarReducida = pisoML;
        // No enviar más de lo que el stock permite (mismas reglas que colecta normal)
        if (r.unitsToSend >= 0) enviarReducida = Math.min(enviarReducida, r.unitsToSend);
        return {
          'Cuenta': r.cuenta,
          'Estado': getCategoryLabel(r.category),
          'SKU': r.originalSku,
          'Código universal': r.codigoUniversal,
          'Código ML': r.codigoML,
          'Número de publicación': r.numeroPublicacion,
          'Número de producto': r.numeroProducto,
          'Componentes': r.components ? r.components.map(function(c) { return c.quantity > 1 ? c.sku + '(' + c.quantity + ')' : c.sku; }).join('/') : '',
          'Recomendación': r.recommendation,
          'Vendidas Últ. 30 días': v30,
          'Aptas en Full': aptas,
          'En Camino': camino,
          'Stock Disponible': r.availableStock,
          'Sugeridas ML': r.suggestedUnits,
          'Enviar Normal': r.unitsToSend,
          'Enviar (20 días)': enviarReducida
        };
      }).filter(function(r) { return r['Enviar (20 días)'] > 0; });
      if (reducidaData.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reducidaData), 'Colecta Reducida');
      }

      if (plannerResultsData.desvinculados && plannerResultsData.desvinculados.length > 0) {
        var desvData = plannerResultsData.desvinculados.filter(function(r) {
          return omit.indexOf(r.codigoML) === -1;
        }).map(function(r) {
          return { 'Cuenta': r.cuenta, 'SKU': r.originalSku, 'Código ML': r.codigoML };
        });
        if (desvData.length) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(desvData), 'Desvinculados');
        }
      }

      if (plannerErrors.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(plannerErrors), 'No Encontrados');
      }

      if (!wb.SheetNames.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Info: 'Sin datos' }]), 'Info');
      }

      var blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'envio_full_' + new Date().toISOString().split('T')[0] + '.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  })();
