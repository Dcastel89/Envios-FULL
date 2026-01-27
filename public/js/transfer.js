  (function transferInit() {
    // Detectar si es PWA instalada
    var isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    // En PWA no inicializar
    if (isPWA) return;

    // Estado
    var shipmentData = [];
    var stockData = [];
    var stockHeaders = [];
    var transferResults = null;
    var pdfTotals = null;

    // Elementos (con sufijo 2 para los nuevos IDs)
    var transferPdfInput = document.getElementById('transferPdfInput2');
    var transferStockInput = document.getElementById('transferStockInput2');
    var transferPdfStatus = document.getElementById('transferPdfStatus2');
    var transferStockStatus = document.getElementById('transferStockStatus2');
    var transferPdfValidation = document.getElementById('transferPdfValidation2');
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

    // Parsear SKU: manejar "/" separadores y (n) multiplicadores
    function parseSkuString(skuStr, baseQty) {
      if (!skuStr) return [];
      var segments = skuStr.split('/').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
      var skuMap = {};

      for (var i = 0; i < segments.length; i++) {
        var seg = segments[i];
        if (seg.match(/^5A/i)) continue;

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

        if (sku.match(/^5A/i)) continue;

        if (!skuMap[sku]) {
          skuMap[sku] = baseQty * multiplier;
        }
      }

      return Object.keys(skuMap).map(function(sku) {
        return { sku: sku, qty: skuMap[sku] };
      });
    }

    // Cargar PDF usando nuestro backend
    transferPdfInput.addEventListener('change', async function(e) {
      var file = e.target.files[0];
      if (!file) return;

      transferPdfStatus.textContent = 'Procesando PDF...';
      transferPdfStatus.classList.remove('error');
      transferPdfStatus.classList.add('show');
      transferPdfValidation.classList.add('hidden');

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

        // Convertir items a formato shipmentData (usar SKU para match con stock)
        shipmentData = data.items.map(function(item) {
          return { rawSku: item.sku || item.codigo, qty: item.cantidad };
        });

        pdfTotals = {
          productos: data.productosDeclarados,
          unidades: data.unidadesDeclaradas
        };

        var extractedUnits = shipmentData.reduce(function(sum, item) { return sum + item.qty; }, 0);

        transferPdfStatus.textContent = '✓ ' + shipmentData.length + ' productos, ' + extractedUnits + ' unidades';
        transferPdfStatus.classList.remove('error');

        // Mostrar validación
        if (data.validacion.ok) {
          transferPdfValidation.className = 'transfer-validation ok';
          transferPdfValidation.textContent = '✓ Validación OK: ' + shipmentData.length + ' productos / ' + extractedUnits + ' unidades (coincide con PDF)';
        } else {
          transferPdfValidation.className = 'transfer-validation error';
          transferPdfValidation.textContent = '✗ PDF declara ' + pdfTotals.productos + ' productos y ' + pdfTotals.unidades + ' uds, se extrajeron ' + shipmentData.length + ' productos y ' + extractedUnits + ' uds';
        }
        transferPdfValidation.classList.remove('hidden');

        updateProcessButton();
      } catch (err) {
        transferPdfStatus.textContent = '✗ ' + err.message;
        transferPdfStatus.classList.add('error');
        shipmentData = [];
        updateProcessButton();
      }
    });

    // Cargar Excel de stock
    transferStockInput.addEventListener('change', async function(e) {
      var file = e.target.files[0];
      if (!file) return;

      transferStockStatus.textContent = 'Leyendo archivo...';
      transferStockStatus.classList.remove('error');
      transferStockStatus.classList.add('show');

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
      transferProcessBtn.disabled = !(shipmentData.length > 0 && stockData.length > 0);
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
          return variante.includes(skuLower) || skuLower.includes(variante);
        });
      }

      return idx;
    }

    // Procesar transferencia
    transferProcessBtn.addEventListener('click', function() {
      if (shipmentData.length === 0 || stockData.length === 0) return;

      var updatedStock = JSON.parse(JSON.stringify(stockData));
      var log = [];
      var errors = [];
      var notFound = [];

      for (var i = 0; i < shipmentData.length; i++) {
        var item = shipmentData[i];
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

          var currentDep2 = parseInt(row.deposito_cantidad2, 10) || 0;

          row.deposito_cantidad1 = currentStock - qty;
          row.deposito_cantidad2 = currentDep2 + qty;

          log.push({
            sku: sku,
            qty: qty,
            dep1Before: currentStock,
            dep1After: row.deposito_cantidad1,
            dep2Before: currentDep2,
            dep2After: row.deposito_cantidad2
          });
        }
      }

      transferResults = { updatedStock: updatedStock, log: log, errors: errors, notFound: notFound };
      showResults();
    });

    function validateTransfer(results) {
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
      // Un SKU puede aparecer varias veces en el log (múltiples líneas en el PDF),
      // así que solo comparamos el estado final (última entrada de cada SKU)
      var lastEntroBySku = {};
      for (var k = 0; k < log.length; k++) {
        lastEntroBySku[log[k].sku] = log[k];
      }
      var skus = Object.keys(lastEntroBySku);
      for (var s = 0; s < skus.length; s++) {
        var lastEntry = lastEntroBySku[skus[s]];
        var rowIdx = findStockRow(lastEntry.sku, updatedStock);
        if (rowIdx === -1) {
          checksFail++;
          errores.push(lastEntry.sku + ': no encontrado en stock actualizado');
        } else {
          var row = updatedStock[rowIdx];
          var realDep1 = parseInt(row.deposito_cantidad1, 10) || 0;
          var realDep2 = parseInt(row.deposito_cantidad2, 10) || 0;
          if (realDep1 !== lastEntry.dep1After || realDep2 !== lastEntry.dep2After) {
            checksFail++;
            errores.push(lastEntry.sku + ': stock no coincide - esperado Dep1=' + lastEntry.dep1After + ' Dep2=' + lastEntry.dep2After + ', real Dep1=' + realDep1 + ' Dep2=' + realDep2);
          } else {
            checksOk++;
          }
        }
      }

      // Check 3: totales
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

      return { ok: checksFail === 0, checksOk: checksOk, checksFail: checksFail, errores: errores, totalUnidades: totalUnidadesMovidas, totalOperaciones: log.length };
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
        var validation = validateTransfer(transferResults);
        transferValidationDiv.classList.remove('hidden');
        if (validation.ok) {
          transferValidationDiv.className = 'transfer-result-box success';
          transferValidationContent.innerHTML = '✓ Verificación OK: ' + validation.totalOperaciones + ' operaciones validadas (' + validation.checksOk + ' checks), ' + validation.totalUnidades + ' unidades transferidas correctamente';
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
