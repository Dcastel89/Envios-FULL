(function transferInit() {
  // Detectar si es PWA instalada
  var isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  // En PWA no inicializar
  if (isPWA) return;

  // Estado
  var pdfSlots = [];       // Array de hasta 3 slots: { shipmentData, pdfTotals, fileName, validacion }
  var stockData = [];
  var stockHeaders = [];
  var transferResults = null;

  // Elementos
  var transferPdfInput = document.getElementById('transferPdfInput2');
  var transferPdfList = document.getElementById('transferPdfList2');
  var transferPdfCombined = document.getElementById('transferPdfCombined2');
  var transferStockInput = document.getElementById('transferStockInput2');
  var transferStockStatus = document.getElementById('transferStockStatus2');
  var transferProcessBtn = document.getElementById('transferProcessBtn2');
  var transferResultsDiv = document.getElementById('transferResults2');
  var transferSuccess = document.getElementById('transferSuccess2');
  var transferErrors = document.getElementById('transferErrors2');
  var transferNotFound = document.getElementById('transferNotFound2');
  var transferSuccessList = document.getElementById('transferSuccessList2');
  var transferErrorsList = document.getElementById('transferErrorsList2');
  var transferNotFoundList = document.getElementById('transferNotFoundList2');
  var transferDownloadBtn = document.getElementById('transferDownloadBtn2');
  var transferValidationDiv = document.getElementById('transferValidation2');
  var transferValidationContent = document.getElementById('transferValidationContent2');

  if (!transferPdfInput) return;

  // Verificar si es ubicación de depósito (empieza con número)
  function isUbicacion(str) {
    if (!str) return false;
    var firstChar = str.trim().charAt(0);
    return firstChar >= '0' && firstChar <= '9';
  }

  // Parsear SKU: manejar "/" separadores y (n) multiplicadores
  function parseSkuString(skuStr, baseQty) {
    if (!skuStr) return [];
    var segments = skuStr.split('/').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    var skuMap = {};

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (isUbicacion(seg)) continue;

      var cleanSeg = seg.replace(/\s+/g, '');
      var match = cleanSeg.match(/^(.+?)\((\d+)\)$/);
      var sku, multiplier;

      if (match) {
        sku = match[1].trim();
        multiplier = parseInt(match[2], 10);
      } else {
        sku = cleanSeg;
        multiplier = 1;
      }

      if (isUbicacion(sku)) continue;

      if (!skuMap[sku]) {
        skuMap[sku] = baseQty * multiplier;
      }
    }

    return Object.keys(skuMap).map(function(sku) {
      return { sku: sku, qty: skuMap[sku] };
    });
  }

  // Renderizar la lista de PDFs cargados y su resumen combinado
  function renderPdfList() {
    transferPdfList.innerHTML = '';

    if (pdfSlots.length === 0) {
      transferPdfCombined.classList.add('hidden');
      return;
    }

    for (var i = 0; i < pdfSlots.length; i++) {
      var slot = pdfSlots[i];
      var div = document.createElement('div');
      div.style.marginTop = '8px';

      // Status line
      var status = document.createElement('div');
      status.className = 'transfer-step-status show';
      var units = slot.shipmentData.reduce(function(s, item) { return s + item.qty; }, 0);
      status.textContent = '✓ PDF ' + (i + 1) + ': ' + slot.fileName + ' — ' + slot.shipmentData.length + ' productos, ' + units + ' uds';

      // Validation per PDF
      var val = document.createElement('div');
      if (slot.validacion.ok) {
        val.className = 'transfer-validation ok';
        val.textContent = '✓ Validación OK';
      } else {
        val.className = 'transfer-validation error';
        val.textContent = '✗ ' + slot.validacion.error;
      }

      // Remove button
      var removeBtn = document.createElement('button');
      removeBtn.textContent = '✕';
      removeBtn.title = 'Quitar este PDF';
      removeBtn.style.cssText = 'margin-left: 8px; background: #ef4444; color: white; border: none; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px;';
      removeBtn.setAttribute('data-idx', i);
      removeBtn.addEventListener('click', function() {
        var idx = parseInt(this.getAttribute('data-idx'), 10);
        pdfSlots.splice(idx, 1);
        renderPdfList();
        resetResults();
        updateProcessButton();
      });

      status.appendChild(removeBtn);
      div.appendChild(status);
      div.appendChild(val);
      transferPdfList.appendChild(div);
    }

    // Resumen combinado + detección de duplicados entre PDFs
    if (pdfSlots.length > 1) {
      var allItems = getMergedShipmentData();
      var totalProducts = allItems.length;
      var totalUnits = allItems.reduce(function(s, item) { return s + item.qty; }, 0);

      // Detectar SKUs duplicados entre PDFs (mismo SKU en distintos PDFs)
      var skusByPdf = {};
      var duplicates = [];
      for (var p = 0; p < pdfSlots.length; p++) {
        var items = pdfSlots[p].shipmentData;
        for (var j = 0; j < items.length; j++) {
          var parsed = parseSkuString(items[j].rawSku, items[j].qty);
          for (var k = 0; k < parsed.length; k++) {
            var skuKey = parsed[k].sku.toLowerCase().trim();
            if (!skusByPdf[skuKey]) skusByPdf[skuKey] = [];
            skusByPdf[skuKey].push({ pdfIdx: p + 1, qty: parsed[k].qty });
          }
        }
      }
      for (var skuKey in skusByPdf) {
        var appearances = skusByPdf[skuKey];
        if (appearances.length > 1) {
          var pdfs = appearances.map(function(a) { return 'PDF' + a.pdfIdx + '(' + a.qty + ')'; }).join(', ');
          duplicates.push(skuKey.toUpperCase() + ' aparece en ' + pdfs);
        }
      }

      var combinedHtml = '📦 Combinado: ' + pdfSlots.length + ' PDFs → ' + totalProducts + ' líneas, ' + totalUnits + ' unidades totales';
      if (duplicates.length > 0) {
        combinedHtml += '<br><br>⚠ SKUs en múltiples PDFs (se sumarán las cantidades):<br>';
        combinedHtml += duplicates.map(function(d) { return '• ' + d; }).join('<br>');
      }

      transferPdfCombined.innerHTML = combinedHtml;
      transferPdfCombined.className = 'transfer-validation ' + (duplicates.length > 0 ? 'warning' : 'ok');
      transferPdfCombined.classList.remove('hidden');
    } else {
      transferPdfCombined.classList.add('hidden');
    }
  }

  // Obtener todos los items de todos los PDFs combinados
  function getMergedShipmentData() {
    var merged = [];
    for (var i = 0; i < pdfSlots.length; i++) {
      merged = merged.concat(pdfSlots[i].shipmentData);
    }
    return merged;
  }

  // Obtener totales combinados de todos los PDFs
  function getCombinedTotals() {
    var totalProductos = 0;
    var totalUnidades = 0;
    for (var i = 0; i < pdfSlots.length; i++) {
      if (pdfSlots[i].pdfTotals) {
        totalProductos += pdfSlots[i].pdfTotals.productos;
        totalUnidades += pdfSlots[i].pdfTotals.unidades;
      } else {
        var items = pdfSlots[i].shipmentData;
        totalProductos += items.length;
        totalUnidades += items.reduce(function(s, item) { return s + item.qty; }, 0);
      }
    }
    return { productos: totalProductos, unidades: totalUnidades };
  }

  // Limpiar resultados previos
  function resetResults() {
    transferResults = null;
    transferResultsDiv.classList.add('hidden');
    transferSuccess.classList.add('hidden');
    transferErrors.classList.add('hidden');
    transferNotFound.classList.add('hidden');
    transferValidationDiv.classList.add('hidden');
    transferDownloadBtn.classList.add('hidden');
  }

  // Cargar PDFs usando nuestro backend
  transferPdfInput.addEventListener('change', async function(e) {
    var files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Validar máximo 3 PDFs en total
    var totalAfter = pdfSlots.length + files.length;
    if (totalAfter > 3) {
      alert('Máximo 3 PDFs. Ya tenés ' + pdfSlots.length + ' cargados y estás intentando agregar ' + files.length + '.');
      transferPdfInput.value = '';
      return;
    }

    resetResults();

    for (var f = 0; f < files.length; f++) {
      var file = files[f];

      // Mostrar progreso temporal
      var tempDiv = document.createElement('div');
      tempDiv.className = 'transfer-step-status show';
      tempDiv.textContent = 'Procesando ' + file.name + '...';
      transferPdfList.appendChild(tempDiv);

      var formData = new FormData();
      formData.append('pdf', file);

      try {
        var response = await fetch('/api/colecta/debug-pdf', {
          method: 'POST',
          body: formData,
          credentials: 'include'
        });

        var data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Error procesando PDF');
        }

        var shipmentData = data.items.map(function(item) {
          return { rawSku: item.sku || item.codigo, qty: item.cantidad };
        });

        var pdfTotals = {
          productos: data.productosDeclarados,
          unidades: data.unidadesDeclaradas
        };

        var extractedUnits = shipmentData.reduce(function(sum, item) { return sum + item.qty; }, 0);

        var valError = '';
        if (!data.validacion.ok) {
          valError = 'PDF declara ' + pdfTotals.productos + ' productos y ' + pdfTotals.unidades + ' uds, se extrajeron ' + shipmentData.length + ' productos y ' + extractedUnits + ' uds';
        }

        pdfSlots.push({
          shipmentData: shipmentData,
          pdfTotals: pdfTotals,
          fileName: file.name,
          validacion: {
            ok: data.validacion.ok,
            error: valError
          }
        });
      } catch (err) {
        // Mostrar error pero no bloquear los demás PDFs
        pdfSlots.push({
          shipmentData: [],
          pdfTotals: null,
          fileName: file.name,
          validacion: { ok: false, error: err.message }
        });
      }

      // Quitar el mensaje temporal
      if (tempDiv.parentNode) tempDiv.parentNode.removeChild(tempDiv);
    }

    // Limpiar input para permitir re-seleccionar
    transferPdfInput.value = '';
    renderPdfList();
    updateProcessButton();
  });

  // Cargar Excel de stock
  transferStockInput.addEventListener('change', async function(e) {
    var file = e.target.files[0];
    if (!file) return;

    transferStockStatus.textContent = 'Leyendo archivo...';
    transferStockStatus.classList.remove('error');
    transferStockStatus.classList.add('show');
    resetResults();

    try {
      var ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'csv') {
        var text = await file.text();
        var lines = text.split('\n');
        var headers = lines[0].split(',').map(function(h) { return h.trim().replace(/^"|"$/g, ''); });
        stockHeaders = headers;
        stockData = [];

        for (var i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          var values = lines[i].split(',').map(function(v) { return v.trim().replace(/^"|"$/g, ''); });
          var row = {};
          for (var j = 0; j < headers.length; j++) {
            row[headers[j]] = values[j] || '';
          }
          if (row.sku || row.sku_variante) {
            stockData.push(row);
          }
        }
      } else if (typeof XLSX !== 'undefined') {
        var buffer = await file.arrayBuffer();
        var wb = XLSX.read(buffer, { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

        if (data.length > 0) {
          stockHeaders = Object.keys(data[0]);
          stockData = data.filter(function(row) {
            return Object.keys(row).some(function(key) {
              return key.toLowerCase().includes('sku') && row[key] && row[key].toString().trim() !== '';
            });
          });
        }
      }

      transferStockStatus.textContent = '✓ ' + stockData.length + ' productos en stock';
      transferStockStatus.classList.remove('error');
      updateProcessButton();
    } catch (err) {
      transferStockStatus.textContent = '✗ Error: ' + err.message;
      transferStockStatus.classList.add('error');
      stockData = [];
      updateProcessButton();
    }
  });

  function updateProcessButton() {
    var hasValidPdfs = pdfSlots.some(function(slot) { return slot.shipmentData.length > 0; });
    transferProcessBtn.disabled = !(hasValidPdfs && stockData.length > 0);
  }

  // Buscar fila en stock por SKU
  function findStockRow(sku, data) {
    var skuLower = sku.toLowerCase().trim();

    var idx = data.findIndex(function(row) {
      return row.sku_variante && row.sku_variante.toString().trim().toLowerCase() === skuLower;
    });

    if (idx === -1) {
      idx = data.findIndex(function(row) {
        return row.sku && row.sku.toString().trim().toLowerCase() === skuLower;
      });
    }

    if (idx === -1) {
      idx = data.findIndex(function(row) {
        var variante = row.sku_variante ? row.sku_variante.toString().trim().toLowerCase() : '';
        // Solo hacer match si variante tiene contenido (evitar match con strings vacíos)
        if (variante.length === 0) return false;
        return variante.includes(skuLower) || skuLower.includes(variante);
      });
    }

    return idx;
  }

  // Procesar transferencia (combina todos los PDFs)
  transferProcessBtn.addEventListener('click', function() {
    var mergedData = getMergedShipmentData();
    if (mergedData.length === 0 || stockData.length === 0) return;

    var updatedStock = JSON.parse(JSON.stringify(stockData));
    var log = [];
    var errors = [];
    var notFound = [];

    for (var i = 0; i < mergedData.length; i++) {
      var item = mergedData[i];
      var parsedSkus = parseSkuString(item.rawSku, item.qty);

      for (var j = 0; j < parsedSkus.length; j++) {
        var parsed = parsedSkus[j];
        var sku = parsed.sku;
        var qty = parsed.qty;

        var rowIdx = findStockRow(sku, updatedStock);

        if (rowIdx === -1) {
          notFound.push({ sku: sku, qty: qty, rawSku: item.rawSku });
          continue;
        }

        var row = updatedStock[rowIdx];
        var currentStock = parseInt(row.deposito_cantidad1, 10) || 0;

        if (currentStock < qty) {
          errors.push({ sku: sku, requested: qty, available: currentStock });
          continue;
        }

        var currentDep2 = parseInt(row.deposito_cantidad3, 10) || 0;

        row.deposito_cantidad1 = currentStock - qty;
        row.deposito_cantidad3 = currentDep2 + qty;

        log.push({
          sku: sku,
          qty: qty,
          dep1Before: currentStock,
          dep1After: row.deposito_cantidad1,
          dep2Before: currentDep2,
          dep2After: row.deposito_cantidad3
        });
      }
    }

    transferResults = { updatedStock: updatedStock, log: log, errors: errors, notFound: notFound };
    showResults();
  });

  function validateTransfer(results, originalUnits) {
    var checksOk = 0;
    var checksFail = 0;
    var errores = [];
    var log = results.log;
    var updatedStock = results.updatedStock;

    // Check 1: la aritmética de cada entrada del log es correcta
    for (var i = 0; i < log.length; i++) {
      var entry = log[i];
      var esperadoDep1 = entry.dep1Before - entry.qty;
      var esperadoDep2 = entry.dep2Before + entry.qty;

      if (entry.dep1After !== esperadoDep1 || entry.dep2After !== esperadoDep2) {
        checksFail++;
        errores.push(entry.sku + ': log incorrecto - esperado Dep1=' + esperadoDep1 + ' Dep2=' + esperadoDep2 + ', log tiene Dep1=' + entry.dep1After + ' Dep2=' + entry.dep2After);
      } else {
        checksOk++;
      }
    }

    // Check 2: el updatedStock tiene los valores finales correctos
    // Un SKU puede aparecer varias veces en el log (múltiples líneas en el PDF o entre PDFs),
    // así que solo comparamos el estado final (última entrada de cada SKU)
    var lastEntryBySku = {};
    for (var k = 0; k < log.length; k++) {
      lastEntryBySku[log[k].sku] = log[k];
    }
    var skus = Object.keys(lastEntryBySku);
    for (var s = 0; s < skus.length; s++) {
      var lastEntry = lastEntryBySku[skus[s]];
      var rowIdx = findStockRow(lastEntry.sku, updatedStock);
      if (rowIdx === -1) {
        checksFail++;
        errores.push(lastEntry.sku + ': no encontrado en stock actualizado');
      } else {
        var row = updatedStock[rowIdx];
        var realDep1 = parseInt(row.deposito_cantidad1, 10) || 0;
        var realDep2 = parseInt(row.deposito_cantidad3, 10) || 0;
        if (realDep1 !== lastEntry.dep1After || realDep2 !== lastEntry.dep2After) {
          checksFail++;
          errores.push(lastEntry.sku + ': stock no coincide - esperado Dep1=' + lastEntry.dep1After + ' Dep2=' + lastEntry.dep2After + ', real Dep1=' + realDep1 + ' Dep2=' + realDep2);
        } else {
          checksOk++;
        }
      }
    }

    // Check 3: totales generales
    var totalUnidadesMovidas = 0;
    var totalDep1Reducido = 0;
    var totalDep2Aumentado = 0;
    for (var j = 0; j < log.length; j++) {
      totalUnidadesMovidas += log[j].qty;
      totalDep1Reducido += (log[j].dep1Before - log[j].dep1After);
      totalDep2Aumentado += (log[j].dep2After - log[j].dep2Before);
    }

    if (totalUnidadesMovidas !== totalDep1Reducido || totalUnidadesMovidas !== totalDep2Aumentado) {
      checksFail++;
      errores.push('Totales inconsistentes: movidas=' + totalUnidadesMovidas + ', Dep1 reducido=' + totalDep1Reducido + ', Dep2 aumentado=' + totalDep2Aumentado);
    } else {
      checksOk++;
    }

    // Check 4 (nuevo): verificar contra stock original que ningún valor quedó negativo
    for (var n = 0; n < updatedStock.length; n++) {
      var dep1Val = parseInt(updatedStock[n].deposito_cantidad1, 10);
      if (!isNaN(dep1Val) && dep1Val < 0) {
        checksFail++;
        var skuNeg = updatedStock[n].sku_variante || updatedStock[n].sku || '(fila ' + n + ')';
        errores.push(skuNeg + ': stock negativo en Dep1 = ' + dep1Val);
      }
    }
    if (checksFail === 0) checksOk++; // Si pasó check 4 sin errores

    return { ok: checksFail === 0, checksOk: checksOk, checksFail: checksFail, errores: errores, itemsEnvio: originalUnits, stockMovido: totalUnidadesMovidas, totalOperaciones: log.length };
  }

  function showResults() {
    if (!transferResults) return;

    transferResultsDiv.classList.remove('hidden');

    // Exitosos
    if (transferResults.log.length > 0) {
      transferSuccess.classList.remove('hidden');
      transferSuccessList.innerHTML = transferResults.log.map(function(l) {
        return '<li><strong>' + l.sku + '</strong>: ' + l.qty + ' uds (Dep1: ' + l.dep1Before + '→' + l.dep1After + ', Dep2: ' + l.dep2Before + '→' + l.dep2After + ')</li>';
      }).join('');
    } else {
      transferSuccess.classList.add('hidden');
    }

    // Errores stock
    if (transferResults.errors.length > 0) {
      transferErrors.classList.remove('hidden');
      transferErrorsList.innerHTML = transferResults.errors.map(function(e) {
        return '<li><strong>' + e.sku + '</strong>: necesita ' + e.requested + ', tiene ' + e.available + '</li>';
      }).join('');
    } else {
      transferErrors.classList.add('hidden');
    }

    // No encontrados
    if (transferResults.notFound.length > 0) {
      transferNotFound.classList.remove('hidden');
      transferNotFoundList.innerHTML = transferResults.notFound.map(function(n) {
        return '<li><strong>' + n.sku + '</strong> (cant: ' + n.qty + ')</li>';
      }).join('');
    } else {
      transferNotFound.classList.add('hidden');
    }

    // Verificación de integridad post-transferencia
    if (transferResults.log.length > 0) {
      var combinedTotals = getCombinedTotals();
      var originalUnits = combinedTotals.unidades;
      var validation = validateTransfer(transferResults, originalUnits);
      transferValidationDiv.classList.remove('hidden');
      if (validation.ok) {
        transferValidationDiv.className = 'transfer-result-box success';
        var summaryHtml = '✓ Verificación OK: ' + validation.totalOperaciones + ' operaciones, ' + validation.stockMovido + ' unidades transferidas';
        if (pdfSlots.length > 1) {
          summaryHtml += ' (de ' + pdfSlots.length + ' PDFs combinados, ' + validation.itemsEnvio + ' uds declaradas)';
        } else {
          summaryHtml += ' (' + validation.itemsEnvio + ' items del envío)';
        }
        transferValidationContent.innerHTML = summaryHtml;
      } else {
        transferValidationDiv.className = 'transfer-result-box error';
        transferValidationContent.innerHTML = '✗ ' + validation.checksFail + ' errores encontrados (' + validation.checksOk + ' checks OK)<ul>' + validation.errores.map(function(e) { return '<li>' + e + '</li>'; }).join('') + '</ul>';
      }
    } else {
      transferValidationDiv.classList.add('hidden');
    }

    // Mostrar botón descarga si hay cambios
    if (transferResults.log.length > 0) {
      transferDownloadBtn.classList.remove('hidden');
    } else {
      transferDownloadBtn.classList.add('hidden');
    }
  }

  // Descargar Excel actualizado
  transferDownloadBtn.addEventListener('click', function() {
    if (!transferResults || typeof XLSX === 'undefined') return;

    var wb = XLSX.utils.book_new();
    var headers = stockHeaders.length > 0 ? stockHeaders : Object.keys(transferResults.updatedStock[0] || {});

    // Filtrar solo filas modificadas
    var modifiedSkus = {};
    transferResults.log.forEach(function(l) {
      modifiedSkus[l.sku.toLowerCase().trim()] = true;
    });

    var modifiedRows = transferResults.updatedStock.filter(function(row) {
      var sku = row.sku ? row.sku.toString().trim().toLowerCase() : '';
      var variante = row.sku_variante ? row.sku_variante.toString().trim().toLowerCase() : '';

      for (var modSku in modifiedSkus) {
        if (sku === modSku || variante === modSku) return true;
        if (variante && (variante.includes(modSku) || modSku.includes(variante))) return true;
      }
      return false;
    });

    var wsData = [headers];
    modifiedRows.forEach(function(row) {
      var rowData = headers.map(function(h) { return row[h] !== undefined ? row[h] : ''; });
      wsData.push(rowData);
    });

    var ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Stock Modificado');

    XLSX.writeFile(wb, 'stock_actualizado.xlsx');
  });
})();
