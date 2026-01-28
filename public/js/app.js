    // ============================================
    // AUTENTICACIÓN
    // ============================================
    (function authInit() {
      var loginOverlay = document.getElementById('loginOverlay');
      var loginForm = document.getElementById('loginForm');
      var loginUser = document.getElementById('loginUser');
      var loginPassword = document.getElementById('loginPassword');
      var loginError = document.getElementById('loginError');
      var loginBtn = document.getElementById('loginBtn');
      var logoutBtn = document.getElementById('logoutBtn');

      function checkAuth() {
        return fetch('/api/auth/check', { credentials: 'include' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.authenticated) {
              showApp();
              return true;
            } else {
              showLogin();
              return false;
            }
          })
          .catch(function() {
            showLogin();
            return false;
          });
      }

      function showLogin() {
        loginOverlay.classList.remove('hidden');
        logoutBtn.classList.add('hidden');
        loginUser.focus();
      }

      function showApp() {
        loginOverlay.classList.add('hidden');
        logoutBtn.classList.remove('hidden');
        if (typeof initMainApp === 'function') {
          initMainApp();
        }
      }

      loginForm.onsubmit = function(e) {
        e.preventDefault();
        loginError.classList.remove('show');
        loginBtn.disabled = true;
        loginBtn.textContent = 'Ingresando...';

        fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            username: loginUser.value,
            password: loginPassword.value
          })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          loginBtn.disabled = false;
          loginBtn.textContent = 'Iniciar Sesion';
          if (data.success) {
            loginPassword.value = '';
            showApp();
          } else {
            loginError.textContent = data.error || 'Error al iniciar sesion';
            loginError.classList.add('show');
          }
        })
        .catch(function(err) {
          loginBtn.disabled = false;
          loginBtn.textContent = 'Iniciar Sesion';
          loginError.textContent = 'Error de conexion';
          loginError.classList.add('show');
        });
      };

      logoutBtn.onclick = function() {
        fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
        .then(function() { showLogin(); })
        .catch(function() { showLogin(); });
      };

      checkAuth();
    })();

    // ============================================
    // APP PRINCIPAL
    // ============================================
    var mainAppInitialized = false;
    function initMainApp() {
      if (mainAppInitialized) return;
      mainAppInitialized = true;

      var currentItems = [];
      var unitChecks = {};
      var codeReader = null;
      var isScanning = false;
      var currentCodigo = null;
      var photoItemIndex = null;

      var codigoInput = document.getElementById('codigoInput');
      var searchBtn = document.getElementById('searchBtn');
      var cameraBtn = document.getElementById('cameraBtn');
      var cameraContainer = document.getElementById('cameraContainer');
      var closeCameraBtn = document.getElementById('closeCamera');
      var video = document.getElementById('video');
      var statusMessage = document.getElementById('statusMessage');
      var itemsSection = document.getElementById('itemsSection');
      var itemsList = document.getElementById('itemsList');
      var itemsCount = document.getElementById('itemsCount');
      var itemsCuenta = document.getElementById('itemsCuenta');
      var itemsProducto = document.getElementById('itemsProducto');
      var completeBanner = document.getElementById('completeBanner');
      var resetBtn = document.getElementById('resetBtn');
      var visionResult = document.getElementById('visionResult');

      // Vision camera elements
      var visionCameraModal = document.getElementById('visionCameraModal');
      var visionCameraClose = document.getElementById('visionCameraClose');
      var visionVideo = document.getElementById('visionVideo');
      var visionAnalyzeBtn = document.getElementById('visionAnalyzeBtn');
      var visionProductInfo = document.getElementById('visionProductInfo');
      var visionProductName = document.getElementById('visionProductName');
      var visionCanvas = document.getElementById('visionCanvas');
      var visionStream = null;

      // Scanned items dropdown elements
      var scannedDropdown = document.getElementById('scannedDropdown');
      var scannedDropdownHeader = document.getElementById('scannedDropdownHeader');
      var scannedBadge = document.getElementById('scannedBadge');
      var scannedList = document.getElementById('scannedList');
      var scannedItems = {}; // { codigoML: { cantidad, cantidadVerificada, descripcion } }

      // Toast elements (web con lector)
      var scanToast = document.getElementById('scanToast');
      var scanToastMessage = document.getElementById('scanToastMessage');
      var scanToastCode = document.getElementById('scanToastCode');
      var scanToastCount = document.getElementById('scanToastCount');
      var lastVerifiedCode = null; // Para confirmación con segundo escaneo
      var toastTimeout = null;

      // Web scanner elements (input dedicado para lector)
      var webScannerSection = document.getElementById('webScannerSection');
      var webScannerInput = document.getElementById('webScannerInput');
      var webScannerStatus = document.getElementById('webScannerStatus');

      // Panel de verificación de producto (web)
      var verifyPanel = document.getElementById('verifyPanel');
      var verifyPanelCode = document.getElementById('verifyPanelCode');
      var verifyPanelTitle = document.getElementById('verifyPanelTitle');
      var verifyPanelSku = document.getElementById('verifyPanelSku');
      var verifyPanelItems = document.getElementById('verifyPanelItems');
      var verifyPanelProgressFill = document.getElementById('verifyPanelProgressFill');
      var verifyPanelProgressText = document.getElementById('verifyPanelProgressText');
      var currentVerifyCode = null; // Código actual en el panel
      var currentVerifyItems = []; // Items del producto actual
      var confirmedCount = 0; // Cantidad de items confirmados
      var fastModeEnabled = false; // Modo rápido: marcar todo con un solo escaneo

      window.toggleFastMode = function() {
        fastModeEnabled = !fastModeEnabled;
        var toggle = document.getElementById('fastModeToggle');
        if (toggle) {
          toggle.classList.toggle('active', fastModeEnabled);
        }
      };

      // ============================================
      // MAIN TABS (solo web, no PWA)
      // ============================================
      var mainTabs = document.getElementById('mainTabs');
      var mainHeader = document.getElementById('mainHeader');
      var sectionCreacion = document.getElementById('sectionCreacion');
      var sectionSeguimiento = document.getElementById('sectionSeguimiento');

      // Detectar PWA
      var isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
      var activeMainSection = 'seguimiento'; // 'creacion' o 'seguimiento'

      // ============================================
      // CELEBRACIÓN DE COLECTA COMPLETADA
      // ============================================
      var celebrationOverlay = document.getElementById('celebrationOverlay');
      var celebrationText = document.getElementById('celebrationText');
      var celebrationSubtext = document.getElementById('celebrationSubtext');
      var confettiContainer = document.getElementById('confettiContainer');
      var celebratedColectas = {}; // Registro de colectas ya celebradas (solo una vez por colecta)

      // ============================================
      // ALERTA DE TODAS LAS UNIDADES ESCANEADAS
      // ============================================
      var allScannedOverlay = document.getElementById('allScannedOverlay');
      var allScannedSubtext = document.getElementById('allScannedSubtext');

      function showAllScannedAlert(codigo, cantidad) {
        allScannedSubtext.textContent = codigo + ' (' + cantidad + '/' + cantidad + ' unidades)';
        allScannedOverlay.classList.add('show');

        // Vibración de alerta
        if (navigator.vibrate) {
          navigator.vibrate([300, 100, 300]);
        }

        // Cerrar automáticamente después de 2.5 segundos
        setTimeout(function() {
          hideAllScannedAlert();
        }, 2500);
      }

      function hideAllScannedAlert() {
        allScannedOverlay.classList.remove('show');
      }

      // Cerrar alerta al hacer click
      allScannedOverlay.onclick = function() {
        hideAllScannedAlert();
      };

      // ============================================
      // ALERTA DE ITEM COMPLETO (VERDE)
      // ============================================
      var itemCompleteOverlay = document.getElementById('itemCompleteOverlay');
      var itemCompleteSubtext = document.getElementById('itemCompleteSubtext');

      function showItemCompleteAlert(codigo, cantidad) {
        itemCompleteSubtext.textContent = codigo + ' (' + cantidad + '/' + cantidad + ' unidades)';
        itemCompleteOverlay.classList.add('show');

        // Vibración de éxito
        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100, 50, 200]);
        }

        // Cerrar automáticamente después de 2 segundos
        setTimeout(function() {
          hideItemCompleteAlert();
        }, 2000);
      }

      function hideItemCompleteAlert() {
        itemCompleteOverlay.classList.remove('show');
      }

      // Cerrar alerta al hacer click
      itemCompleteOverlay.onclick = function() {
        hideItemCompleteAlert();
      };

      function createConfetti() {
        var colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
        var confettiCount = 150;

        confettiContainer.innerHTML = '';

        for (var i = 0; i < confettiCount; i++) {
          var confetti = document.createElement('div');
          confetti.className = 'confetti';
          confetti.style.left = Math.random() * 100 + '%';
          confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
          confetti.style.width = (Math.random() * 10 + 5) + 'px';
          confetti.style.height = (Math.random() * 10 + 5) + 'px';
          confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
          confetti.style.animation = 'confettiFall ' + (Math.random() * 2 + 2) + 's linear forwards';
          confetti.style.animationDelay = Math.random() * 0.5 + 's';
          confettiContainer.appendChild(confetti);
        }
      }

      function showCelebration(colectaNombre) {
        celebrationSubtext.textContent = colectaNombre || '';
        celebrationOverlay.classList.add('show');
        createConfetti();

        // Vibración de celebración
        if (navigator.vibrate) {
          navigator.vibrate([200, 100, 200, 100, 400]);
        }

        // Cerrar automáticamente después de 4 segundos
        setTimeout(function() {
          hideCelebration();
        }, 4000);
      }

      function hideCelebration() {
        celebrationOverlay.classList.remove('show');
        setTimeout(function() {
          confettiContainer.innerHTML = '';
        }, 500);
      }

      // Cerrar celebración al hacer click
      celebrationOverlay.onclick = function() {
        hideCelebration();
      };

      if (!isPWA) {
        // Mostrar tabs solo en web
        mainTabs.classList.add('show');
        mainHeader.classList.add('with-tabs');

        // Event listeners para main tabs
        document.querySelectorAll('.main-tab').forEach(function(tab) {
          tab.onclick = function() {
            document.querySelectorAll('.main-tab').forEach(function(t) { t.classList.remove('active'); });
            this.classList.add('active');
            var section = this.getAttribute('data-section');
            activeMainSection = section;

            // Ocultar todas las secciones
            sectionCreacion.classList.remove('active');
            sectionSeguimiento.classList.remove('active');

            // Mostrar la sección seleccionada
            if (section === 'creacion') {
              sectionCreacion.classList.add('active');
              // Ocultar botón cámara y banner en sección creación
              cameraBtn.classList.add('hidden');
              completeBanner.classList.remove('show');
            } else {
              sectionSeguimiento.classList.add('active');
              // Mostrar botón cámara si estamos en pestaña verificar
              if (typeof currentView !== 'undefined' && currentView === 'verificar') {
                cameraBtn.classList.remove('hidden');
              }
            }
          };
        });
      } else {
        // En PWA: ocultar sección creación, mostrar solo seguimiento
        sectionCreacion.style.display = 'none';
        sectionSeguimiento.classList.add('active');
      }

      // En web: mostrar pestaña Lista activa por defecto, pero mantener Verificar visible
      var tabVerificar = document.getElementById('tabVerificar');
      var tabLista = document.getElementById('tabLista');
      if (!isPWA && tabVerificar && tabLista) {
        // Poner Lista como activa por defecto en web
        tabVerificar.classList.remove('active');
        tabLista.classList.add('active');
      }

      // ============================================
      // COLECTAS (múltiples)
      // ============================================
      var colectasLista = document.getElementById('colectasLista');
      var colectasCalendario = document.getElementById('colectasCalendario');
      var colectasCount = document.getElementById('colectasCount');
      var colectaUpload = document.getElementById('colectaUpload');
      var colectaForm = document.getElementById('colectaForm');
      var colectaFechaInput = document.getElementById('colectaFechaInput');
      var colectaCuentaInput = document.getElementById('colectaCuentaInput');
      var colectaPdfInput = document.getElementById('colectaPdfInput');
      var colectaUploadBtn = document.getElementById('colectaUploadBtn');
      var toggleUploadBtn = document.getElementById('toggleUploadBtn');

      var colectasData = [];
      var currentView = isPWA ? 'verificar' : 'lista';

      function loadColectas() {
        fetch('/api/colectas', { credentials: 'include' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            colectasData = data.colectas || [];
            colectasCount.textContent = data.total;
            renderColectas();
            // Recargar items si hay colecta activa
            if (colectaActivaId) {
              cargarItemsColectaActiva();
              // Verificar si la colecta activa llegó al 100% por primera vez
              var colectaActiva = colectasData.find(function(c) { return c.id === colectaActivaId; });
              if (colectaActiva && colectaActiva.progreso === 100 && !celebratedColectas[colectaActivaId]) {
                // Colecta llegó al 100% por primera vez, celebrar!
                celebratedColectas[colectaActivaId] = true;
                var nombreColecta = colectaActiva.cuenta || colectaActiva.nombre || '';
                showCelebration(nombreColecta);
              }
            }
          })
          .catch(function(err) {
            console.error('Error cargando colectas:', err);
          });
      }
      loadColectas();

      var colectasVerificar = document.getElementById('colectasVerificar');
      var colectaActivaSelect = document.getElementById('colectaActivaSelect');
      var verificarColectaInfo = document.getElementById('verificarColectaInfo');
      var colectaActivaId = null;

      function renderColectas() {
        // Ocultar todas las vistas
        colectasLista.classList.add('hidden');
        colectasCalendario.classList.add('hidden');
        colectasVerificar.classList.add('hidden');

        // Mostrar/ocultar secciones de escaneo según contexto
        var scanSection = document.querySelector('.scan-section');
        if (currentView === 'verificar' && activeMainSection === 'seguimiento') {
          if (isPWA) {
            // PWA: mostrar buscador con cámara
            scanSection.classList.remove('hidden');
            cameraBtn.classList.remove('hidden');
            webScannerSection.classList.add('hidden');
          } else {
            // Web: ocultar buscador, mostrar input dedicado para lector
            scanSection.classList.add('hidden');
            cameraBtn.classList.add('hidden');
            webScannerSection.classList.remove('hidden');
            actualizarEstadoWebScanner();
            // Auto-foco en el input del lector
            setTimeout(function() { webScannerInput.focus(); }, 100);
          }
        } else {
          cameraBtn.classList.add('hidden');
          scanSection.classList.add('hidden');
          webScannerSection.classList.add('hidden');
          // Ocultar también resultados si cambiamos de pestaña
          itemsSection.classList.add('hidden');
          resetBtn.classList.add('hidden');
          completeBanner.classList.remove('show');
        }

        // Mostrar/ocultar botón Nueva Colecta
        if (currentView === 'verificar') {
          toggleUploadBtn.classList.add('hidden');
          colectaUpload.classList.add('hidden');
        } else {
          toggleUploadBtn.classList.remove('hidden');
        }

        if (currentView === 'lista') {
          renderListaColectas();
          colectasLista.classList.remove('hidden');
        } else if (currentView === 'calendario') {
          renderCalendarioColectas();
          colectasCalendario.classList.remove('hidden');
        } else if (currentView === 'verificar') {
          renderVerificarColectas();
          colectasVerificar.classList.remove('hidden');
        }
      }

      function actualizarEstadoWebScanner() {
        if (colectaActivaId) {
          var col = colectasData.find(function(c) { return c.id === colectaActivaId; });
          var nombre = col ? (col.cuenta || col.nombre) : '';
          webScannerStatus.className = 'web-scanner-status ready';
          webScannerStatus.textContent = '✓ Listo - ' + nombre;
          webScannerInput.disabled = false;
          webScannerInput.placeholder = 'Esperando escaneo...';
        } else {
          webScannerStatus.className = 'web-scanner-status no-colecta';
          webScannerStatus.textContent = '⚠ Seleccioná una colecta primero';
          webScannerInput.disabled = true;
          webScannerInput.placeholder = 'Seleccioná una colecta...';
        }
      }

      function renderVerificarColectas() {
        // Llenar el selector con las colectas
        var html = '<option value="">-- Elegir colecta --</option>';
        colectasData.forEach(function(col) {
          var estado = col.progreso === 100 ? '✓' : col.progreso + '%';
          var selected = col.id === colectaActivaId ? ' selected' : '';
          html += '<option value="' + col.id + '"' + selected + '>';
          html += (col.cuenta || 'Sin cuenta') + ' - ' + formatearFecha(col.fechaColecta) + ' (' + estado + ')';
          html += '</option>';
        });
        colectaActivaSelect.innerHTML = html;

        // Mostrar info de colecta seleccionada
        if (colectaActivaId) {
          mostrarInfoColectaActiva();
        } else {
          verificarColectaInfo.classList.add('hidden');
        }
      }

      function mostrarInfoColectaActiva() {
        var col = colectasData.find(function(c) { return c.id === colectaActivaId; });
        if (!col) {
          verificarColectaInfo.classList.add('hidden');
          return;
        }

        var isComplete = col.progreso === 100;
        var estadoClass = isComplete ? 'complete' : 'pending';
        var estadoTexto = isComplete ? '✓ Terminada' : '⏳ En proceso';

        var html = '<div class="verificar-colecta-header">';
        html += '<div>';
        html += '<div class="verificar-colecta-cuenta">' + (col.cuenta || 'Sin cuenta') + '</div>';
        html += '<div class="verificar-colecta-fecha">' + formatearFecha(col.fechaColecta) + ' - ' + col.nombre + '</div>';
        html += '</div>';
        html += '<span class="verificar-colecta-estado ' + estadoClass + '">' + estadoTexto + '</span>';
        html += '</div>';

        html += '<div class="verificar-progress">';
        html += '<div class="verificar-progress-bar"><div class="verificar-progress-fill" style="width:' + col.progreso + '%"></div></div>';
        html += '<div class="verificar-progress-text">' + (col.unidadesVerificadas || 0) + ' / ' + col.totalUnidades + ' unidades</div>';
        html += '</div>';

        if (!isComplete) {
          html += '<div class="verificar-mensaje">Escaneá o ingresá un código ML para verificar</div>';
        } else {
          html += '<div class="verificar-mensaje" style="color:#16a34a">¡Colecta completada!</div>';
        }

        // Botón de reinicio (solo si hay algo verificado)
        if (col.unidadesVerificadas > 0) {
          html += '<button type="button" class="reset-colecta-btn" onclick="resetearColecta(\'' + col.id + '\')">🔄 Reiniciar colecta</button>';
        }

        verificarColectaInfo.innerHTML = html;
        verificarColectaInfo.classList.remove('hidden');
      }

      colectaActivaSelect.addEventListener('change', function() {
        colectaActivaId = this.value || null;
        // Si la colecta seleccionada ya está al 100%, marcarla como celebrada para no celebrar al seleccionar
        var colectaSeleccionada = colectasData.find(function(c) { return c.id === colectaActivaId; });
        if (colectaSeleccionada && colectaSeleccionada.progreso === 100) {
          celebratedColectas[colectaActivaId] = true;
        }
        mostrarInfoColectaActiva();
        // Limpiar búsqueda anterior
        itemsSection.classList.add('hidden');
        resetBtn.classList.add('hidden');
        completeBanner.classList.remove('show');
        codigoInput.value = '';
        // Cargar items de la colecta activa
        cargarItemsColectaActiva();
        // Actualizar estado del scanner web
        if (!isPWA) {
          actualizarEstadoWebScanner();
          webScannerInput.value = '';
          setTimeout(function() { webScannerInput.focus(); }, 100);
        }
      });

      // Event listener para el input del lector web
      webScannerInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          verificarCodigoWeb(webScannerInput.value);
        }
      });

      // ============================================
      // LISTA DESPLEGABLE DE ITEMS ESCANEADOS
      // ============================================
      scannedDropdownHeader.onclick = function() {
        scannedDropdown.classList.toggle('open');
      };

      function cargarItemsColectaActiva() {
        if (!colectaActivaId) {
          scannedDropdown.classList.add('hidden');
          scannedItems = {};
          return;
        }

        fetch('/api/colecta/' + colectaActivaId, { credentials: 'include' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            scannedItems = {};
            if (data.items && data.items.length > 0) {
              data.items.forEach(function(item) {
                scannedItems[item.codigoML] = {
                  cantidad: item.cantidad,
                  cantidadVerificada: item.cantidadVerificada || 0,
                  descripcion: item.descripcion || item.sku || item.codigoML
                };
              });
            }
            actualizarListaEscaneados();
          })
          .catch(function(err) {
            console.error('Error cargando items de colecta:', err);
          });
      }

      function actualizarListaEscaneados() {
        var codigos = Object.keys(scannedItems);
        if (codigos.length === 0) {
          scannedDropdown.classList.add('hidden');
          return;
        }

        scannedDropdown.classList.remove('hidden');
        scannedDropdown.classList.add('open'); // Siempre expandida

        var totalItems = codigos.length;
        var completados = 0;
        var html = '';

        codigos.forEach(function(codigo) {
          var item = scannedItems[codigo];
          var esCompleto = item.cantidadVerificada >= item.cantidad;
          var esParcial = item.cantidadVerificada > 0 && !esCompleto;
          if (esCompleto) completados++;

          var statusClass = esCompleto ? 'complete' : (esParcial ? 'partial' : 'pending');
          var tieneVerificacion = item.cantidadVerificada > 0;
          var puedeAgregar = item.cantidadVerificada < item.cantidad;

          html += '<div class="scanned-item">';
          html += '<div class="scanned-item-info">';
          html += '<div class="scanned-item-code">' + codigo + '</div>';
          html += '<div class="scanned-item-desc">' + item.descripcion + '</div>';
          html += '</div>';
          html += '<div class="scanned-item-actions">';
          html += '<button class="scanned-item-btn minus" onclick="window.decrementarItem(\'' + codigo + '\')"' + (!tieneVerificacion ? ' disabled' : '') + '>-</button>';
          html += '<span class="scanned-item-count ' + statusClass + '">' + item.cantidadVerificada + '/' + item.cantidad + '</span>';
          html += '<button class="scanned-item-btn plus" onclick="window.incrementarItem(\'' + codigo + '\')"' + (!puedeAgregar ? ' disabled' : '') + '>+</button>';
          html += '<button class="scanned-item-btn delete" onclick="window.eliminarItemColecta(\'' + codigo + '\')" title="Eliminar ítem">🗑</button>';
          html += '</div>';
          html += '</div>';
        });

        scannedList.innerHTML = html;
        scannedBadge.textContent = completados + '/' + totalItems;
        scannedBadge.className = 'scanned-dropdown-badge' + (completados < totalItems ? ' pending' : '');
      }

      // ============================================
      // TOAST Y FLUJO WEB (lector de código de barras)
      // ============================================
      function showToast(message, type, code, count) {
        if (toastTimeout) clearTimeout(toastTimeout);

        scanToastMessage.textContent = message;
        scanToastCode.textContent = code || '';
        scanToastCount.textContent = count || '';
        scanToast.className = 'scan-toast show' + (type ? ' ' + type : '');

        toastTimeout = setTimeout(function() {
          scanToast.classList.remove('show');
        }, 1500);
      }

      var webScannerBusy = false; // Prevenir escaneos mientras se procesa

      function verificarCodigoWeb(codigo) {
        if (!codigo || codigo.trim() === '') return;

        // Limpiar input INMEDIATAMENTE para el próximo escaneo
        webScannerInput.value = '';

        if (!colectaActivaId) {
          showToast('Elegí una colecta', 'error');
          webScannerInput.focus();
          return;
        }

        codigo = codigo.trim().toUpperCase();

        // Si hay panel abierto con el mismo código: confirmar siguiente item
        if (currentVerifyCode === codigo) {
          confirmarSiguienteItem();
          webScannerInput.focus();
          return;
        }

        // Si hay panel abierto con otro código: cerrarlo primero
        if (currentVerifyCode && currentVerifyCode !== codigo) {
          cerrarPanelVerificacion();
        }

        // Verificar primero si el código está en la colecta
        var itemEnColecta = scannedItems[codigo];
        if (!itemEnColecta) {
          showToast('NO EN COLECTA', 'error', codigo);
          webScannerInput.focus();
          return;
        }

        // Verificar si ya tiene todas las unidades escaneadas
        if (itemEnColecta.cantidad > 0 && itemEnColecta.cantidadVerificada >= itemEnColecta.cantidad) {
          showAllScannedAlert(codigo, itemEnColecta.cantidad);
          webScannerInput.focus();
          return;
        }

        // MODO RÁPIDO: verificar directamente sin abrir panel
        if (fastModeEnabled) {
          fetch('/api/colecta/' + colectaActivaId + '/verificar/' + encodeURIComponent(codigo), {
            method: 'POST',
            credentials: 'include'
          }).then(function() {
            loadColectas();
            cargarItemsColectaActiva();

            // Verificar si el item ahora está completo
            var cantidadTotal = itemEnColecta.cantidad;
            var verificadasAntes = itemEnColecta.cantidadVerificada;
            if (cantidadTotal > 0 && (verificadasAntes + 1) >= cantidadTotal) {
              setTimeout(function() {
                showItemCompleteAlert(codigo, cantidadTotal);
              }, 300);
            }
          });
          showToast('✓ OK', 'success', codigo, (itemEnColecta.cantidadVerificada + 1) + '/' + itemEnColecta.cantidad);
          webScannerInput.focus();
          return;
        }

        // Prevenir doble procesamiento
        if (webScannerBusy) return;
        webScannerBusy = true;

        // Buscar información detallada del producto
        fetch('/api/codigo/' + encodeURIComponent(codigo), { credentials: 'include' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.error) {
              // Si no está en el cache general, usar datos de la colecta
              mostrarPanelVerificacion(codigo, {
                producto: itemEnColecta.descripcion,
                items: [{ sku: codigo, description: itemEnColecta.descripcion, quantity: itemEnColecta.cantidad }]
              });
              return;
            }
            // Mostrar panel de verificación con datos completos
            mostrarPanelVerificacion(codigo, data);
          })
          .catch(function(err) {
            // Fallback a datos de colecta
            mostrarPanelVerificacion(codigo, {
              producto: itemEnColecta.descripcion,
              items: [{ sku: codigo, description: itemEnColecta.descripcion, quantity: itemEnColecta.cantidad }]
            });
          })
          .finally(function() {
            webScannerBusy = false;
            webScannerInput.focus();
          });
      }

      function mostrarPanelVerificacion(codigo, data) {
        currentVerifyCode = codigo;
        currentVerifyItems = data.items || [];
        confirmedCount = 0;

        // Llenar header
        verifyPanelCode.textContent = codigo;
        verifyPanelTitle.textContent = data.producto || 'Producto';
        verifyPanelSku.textContent = data.items && data.items[0] ? 'SKU: ' + data.items[0].sku : '';

        // Generar items
        var html = '';
        currentVerifyItems.forEach(function(item, index) {
          var isCurrent = index === 0;
          html += '<div class="verify-panel-item' + (isCurrent ? ' current' : '') + '" data-index="' + index + '">';
          html += '<div class="verify-panel-item-check"></div>';
          html += '<div class="verify-panel-item-info">';
          html += '<div class="verify-panel-item-name">' + (item.description || item.sku) + '</div>';
          html += '<div class="verify-panel-item-detail">SKU: ' + item.sku + '</div>';
          html += '</div>';
          html += '<div class="verify-panel-item-qty">x' + item.quantity + '</div>';
          html += '</div>';
        });
        verifyPanelItems.innerHTML = html;

        // Actualizar progreso
        actualizarProgresoPanel();

        // Mostrar panel
        verifyPanel.classList.remove('hidden');
      }

      function confirmarSiguienteItem() {
        if (confirmedCount >= currentVerifyItems.length) {
          // Ya todo confirmado, cerrar
          cerrarPanelVerificacion();
          return;
        }

        var items = verifyPanelItems.querySelectorAll('.verify-panel-item');

        // Marcar item actual como confirmado
        if (items[confirmedCount]) {
          items[confirmedCount].classList.remove('current');
          items[confirmedCount].classList.add('confirmed');
          items[confirmedCount].querySelector('.verify-panel-item-check').textContent = '✓';
        }
        confirmedCount++;

        // Marcar siguiente como current si hay más
        if (confirmedCount < currentVerifyItems.length) {
          if (items[confirmedCount]) {
            items[confirmedCount].classList.add('current');
          }
          actualizarProgresoPanel();
          showToast('✓ ITEM ' + confirmedCount, '', '', confirmedCount + '/' + currentVerifyItems.length);
          return; // No completar aún, esperar siguiente escaneo
        }

        // Kit completo! Verificar en el servidor
        var codigoVerificado = currentVerifyCode;
        var itemAntes = scannedItems[codigoVerificado];
        var cantidadTotal = itemAntes ? itemAntes.cantidad : 0;
        var verificadasAntes = itemAntes ? itemAntes.cantidadVerificada : 0;

        fetch('/api/colecta/' + colectaActivaId + '/verificar/' + encodeURIComponent(currentVerifyCode), {
          method: 'POST',
          credentials: 'include'
        }).then(function() {
          loadColectas();
          cargarItemsColectaActiva();

          // Verificar si el item ahora está completo (era la última unidad)
          if (cantidadTotal > 0 && (verificadasAntes + 1) >= cantidadTotal) {
            setTimeout(function() {
              showItemCompleteAlert(codigoVerificado, cantidadTotal);
            }, 300);
          }
        });

        actualizarProgresoPanel();
        showToast('✓ COMPLETO', '', currentVerifyCode);
        // Cerrar panel después de 1.5 segundos
        setTimeout(function() {
          cerrarPanelVerificacion();
        }, 1500);
      }

      function actualizarProgresoPanel() {
        var total = currentVerifyItems.length;
        var porcentaje = total > 0 ? Math.round((confirmedCount / total) * 100) : 0;
        verifyPanelProgressFill.style.width = porcentaje + '%';
        verifyPanelProgressText.textContent = confirmedCount + '/' + total;
      }

      function cerrarPanelVerificacion() {
        verifyPanel.classList.add('hidden');
        currentVerifyCode = null;
        currentVerifyItems = [];
        confirmedCount = 0;
        webScannerInput.focus();
      }

      window.borrarVerificacion = function() {
        if (!currentVerifyCode || !colectaActivaId) {
          cerrarPanelVerificacion();
          return;
        }

        // Llamar al endpoint de desverificar
        fetch('/api/colecta/' + colectaActivaId + '/desverificar/' + encodeURIComponent(currentVerifyCode), {
          method: 'POST',
          credentials: 'include'
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.success) {
            showToast('BORRADO', 'error', currentVerifyCode);
            loadColectas();
            cargarItemsColectaActiva();
          }
        })
        .catch(function(err) {
          showToast('ERROR', 'error', 'No se pudo borrar');
        })
        .finally(function() {
          cerrarPanelVerificacion();
        });
      };

      // Funciones globales para +/- en lista de items
      window.decrementarItem = function(codigo) {
        if (!codigo || !colectaActivaId) return;

        fetch('/api/colecta/' + colectaActivaId + '/decrementar/' + encodeURIComponent(codigo), {
          method: 'POST',
          credentials: 'include'
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.success) {
            showToast('-1', 'error', codigo);
            loadColectas();
            cargarItemsColectaActiva();
          }
        })
        .catch(function(err) {
          showToast('ERROR', 'error', 'No se pudo decrementar');
        });
      };

      window.incrementarItem = function(codigo) {
        if (!codigo || !colectaActivaId) return;

        var itemAntes = scannedItems[codigo];
        var cantidadTotal = itemAntes ? itemAntes.cantidad : 0;
        var verificadasAntes = itemAntes ? itemAntes.cantidadVerificada : 0;

        fetch('/api/colecta/' + colectaActivaId + '/verificar/' + encodeURIComponent(codigo), {
          method: 'POST',
          credentials: 'include'
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.success) {
            showToast('+1', '', codigo);
            loadColectas();
            cargarItemsColectaActiva();

            // Verificar si el item ahora está completo
            if (cantidadTotal > 0 && (verificadasAntes + 1) >= cantidadTotal) {
              setTimeout(function() {
                showItemCompleteAlert(codigo, cantidadTotal);
              }, 300);
            }
          }
        })
        .catch(function(err) {
          showToast('ERROR', 'error', 'No se pudo incrementar');
        });
      };

      window.eliminarItemColecta = function(codigo) {
        if (!codigo || !colectaActivaId) return;

        if (!confirm('¿Eliminar "' + codigo + '" de la colecta?')) return;

        fetch('/api/colecta/' + colectaActivaId + '/item/' + encodeURIComponent(codigo), {
          method: 'DELETE',
          credentials: 'include'
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.success) {
            showToast('Eliminado', 'error', codigo);
            loadColectas();
            cargarItemsColectaActiva();
          } else {
            showToast('ERROR', 'error', data.error || 'No se pudo eliminar');
          }
        })
        .catch(function(err) {
          showToast('ERROR', 'error', 'No se pudo eliminar');
        });
      };

      function renderListaColectas() {
        if (colectasData.length === 0) {
          colectasLista.innerHTML = '<div class="empty-state"><p>No hay colectas activas</p></div>';
          return;
        }

        var html = '';
        colectasData.forEach(function(col) {
          html += '<div class="colecta-item" data-id="' + col.id + '">';
          html += '<div class="colecta-item-header">';
          html += '<div class="colecta-item-principal">';
          if (col.cuenta) html += '<span class="colecta-item-cuenta-grande">' + col.cuenta + '</span>';
          html += '<span class="colecta-item-fecha-grande">' + formatearFecha(col.fechaColecta) + '</span>';
          html += '</div>';
          html += '<span class="colecta-item-envio">' + col.nombre + '</span>';
          html += '</div>';
          html += '<div class="colecta-item-progress"><div class="colecta-item-progress-bar" style="width:' + col.progreso + '%"></div></div>';
          html += '<div class="colecta-item-stats">';
          html += '<span>' + (col.unidadesVerificadas || 0) + '/' + col.totalUnidades + ' unidades (' + col.progreso + '%)</span>';
          html += '</div>';
          html += '<div class="colecta-item-actions">';
          html += '<button class="colecta-item-btn delete" onclick="eliminarColecta(\'' + col.id + '\')">Eliminar</button>';
          html += '</div>';
          html += '</div>';
        });
        colectasLista.innerHTML = html;
      }

      var calendarioMesActual = new Date();
      var calendarioColectasPorFecha = {};
      var calendarioFechaSeleccionada = null;

      function renderCalendarioColectas() {
        fetch('/api/colectas/calendario', { credentials: 'include' })
          .then(function(res) { return res.json(); })
          .then(function(porFecha) {
            calendarioColectasPorFecha = porFecha;
            renderCalendarioMes();
          });
      }

      function renderCalendarioMes() {
        var year = calendarioMesActual.getFullYear();
        var month = calendarioMesActual.getMonth();
        var hoy = new Date();

        var meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        var diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

        var html = '';

        // Navegación
        html += '<div class="calendar-nav">';
        html += '<button class="calendar-nav-btn" onclick="cambiarMesCalendario(-1)">◀</button>';
        html += '<span class="calendar-month">' + meses[month] + ' ' + year + '</span>';
        html += '<button class="calendar-nav-btn" onclick="cambiarMesCalendario(1)">▶</button>';
        html += '</div>';

        // Grilla
        html += '<div class="calendar-grid">';

        // Días de la semana
        diasSemana.forEach(function(dia) {
          html += '<div class="calendar-weekday">' + dia + '</div>';
        });

        // Primer día del mes y cantidad de días
        var primerDia = new Date(year, month, 1);
        var ultimoDia = new Date(year, month + 1, 0);
        var diasEnMes = ultimoDia.getDate();
        var primerDiaSemana = primerDia.getDay();

        // Días del mes anterior
        var diasMesAnterior = new Date(year, month, 0).getDate();
        for (var i = primerDiaSemana - 1; i >= 0; i--) {
          html += '<div class="calendar-cell other-month"><span class="calendar-cell-day">' + (diasMesAnterior - i) + '</span></div>';
        }

        // Días del mes actual
        for (var dia = 1; dia <= diasEnMes; dia++) {
          var fechaStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
          var colectasDelDia = calendarioColectasPorFecha[fechaStr] || [];
          var esHoy = hoy.getFullYear() === year && hoy.getMonth() === month && hoy.getDate() === dia;
          var tieneColectas = colectasDelDia.length > 0;

          var clases = 'calendar-cell';
          if (esHoy) clases += ' today';
          if (tieneColectas) clases += ' has-colecta';

          html += '<div class="' + clases + '" onclick="seleccionarDiaCalendario(\'' + fechaStr + '\')">';
          html += '<span class="calendar-cell-day">' + dia + '</span>';

          if (tieneColectas) {
            html += '<div class="calendar-cell-colectas">';
            colectasDelDia.slice(0, 3).forEach(function(col) {
              var estado = col.progreso === 100 ? 'complete' : 'pending';
              var estadoTexto = col.progreso === 100 ? '✓' : col.progreso + '%';
              var cuenta = col.cuenta || '?';
              html += '<div class="calendar-cell-colecta ' + estado + '">' + cuenta + ' ' + estadoTexto + '</div>';
            });
            if (colectasDelDia.length > 3) {
              html += '<div class="calendar-cell-colecta pending">+' + (colectasDelDia.length - 3) + ' más</div>';
            }
            html += '</div>';
          }

          html += '</div>';
        }

        // Días del mes siguiente
        var celdasRestantes = 42 - (primerDiaSemana + diasEnMes);
        for (var i = 1; i <= celdasRestantes; i++) {
          html += '<div class="calendar-cell other-month"><span class="calendar-cell-day">' + i + '</span></div>';
        }

        html += '</div>';

        // Detalle del día seleccionado
        if (calendarioFechaSeleccionada && calendarioColectasPorFecha[calendarioFechaSeleccionada]) {
          var colectas = calendarioColectasPorFecha[calendarioFechaSeleccionada];
          html += '<div class="calendar-day-detail">';
          html += '<div class="calendar-day-detail-header">' + formatearFecha(calendarioFechaSeleccionada) + '</div>';
          html += '<div class="calendar-day-detail-items">';
          colectas.forEach(function(col) {
            var isComplete = col.progreso === 100;
            var estadoTexto = isComplete ? '✓ Terminada' : '⏳ En proceso';
            html += '<div class="calendar-detail-item' + (isComplete ? ' complete' : '') + '" onclick="abrirModalColecta(\'' + col.id + '\')">';
            html += '<div class="calendar-detail-item-header">';
            html += '<span class="calendar-detail-item-cuenta">' + (col.cuenta || 'Sin cuenta') + '</span>';
            html += '<span class="calendar-detail-item-envio">' + estadoTexto + '</span>';
            html += '</div>';
            html += '<div class="calendar-detail-item-stats">' + (col.unidadesVerificadas || 0) + '/' + col.totalUnidades + ' uds (' + col.progreso + '%) - ' + col.nombre + '</div>';
            html += '</div>';
          });
          html += '</div></div>';
        }

        colectasCalendario.innerHTML = html;
      }

      window.cambiarMesCalendario = function(delta) {
        calendarioMesActual.setMonth(calendarioMesActual.getMonth() + delta);
        renderCalendarioMes();
      };

      window.seleccionarDiaCalendario = function(fecha) {
        calendarioFechaSeleccionada = fecha;
        renderCalendarioMes();
      };

      function formatearFecha(fechaStr) {
        var fecha = new Date(fechaStr + 'T00:00:00');
        var dias = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
        var meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        return dias[fecha.getDay()] + ' ' + fecha.getDate() + ' ' + meses[fecha.getMonth()];
      }

      // Tabs de vista
      document.querySelectorAll('.colectas-tab').forEach(function(tab) {
        tab.onclick = function() {
          document.querySelectorAll('.colectas-tab').forEach(function(t) { t.classList.remove('active'); });
          this.classList.add('active');
          currentView = this.getAttribute('data-view');
          renderColectas();
        };
      });

      // Toggle upload form
      toggleUploadBtn.onclick = function() {
        colectaUpload.classList.toggle('hidden');
        if (!colectaUpload.classList.contains('hidden')) {
          var tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          colectaFechaInput.value = tomorrow.toISOString().split('T')[0];
        }
      };

      // Form submit
      colectaForm.onsubmit = function(e) {
        e.preventDefault();
        var fechaColecta = colectaFechaInput.value;
        var pdfFile = colectaPdfInput.files[0];

        if (!fechaColecta || !pdfFile) {
          showStatus('Completa fecha y PDF', 'error');
          return;
        }

        colectaUploadBtn.disabled = true;
        colectaUploadBtn.textContent = 'Procesando...';
        showStatus('Procesando PDF...', 'loading');

        var formData = new FormData();
        formData.append('fechaColecta', fechaColecta);
        formData.append('pdf', pdfFile);
        if (colectaCuentaInput.value) formData.append('cuenta', colectaCuentaInput.value);

        fetch('/api/colecta/upload', {
          method: 'POST',
          credentials: 'include',
          body: formData
        })
        .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
        .then(function(result) {
          colectaUploadBtn.disabled = false;
          colectaUploadBtn.textContent = 'Cargar colecta';
          if (result.ok) {
            showStatus(result.data.nombre + ': ' + result.data.totalUnidades + ' unidades', 'success');
            colectaPdfInput.value = '';
            colectaCuentaInput.value = '';
            colectaUpload.classList.add('hidden');
            loadColectas();
          } else {
            showStatus(result.data.error || 'Error cargando colecta', 'error');
          }
        })
        .catch(function(err) {
          colectaUploadBtn.disabled = false;
          colectaUploadBtn.textContent = 'Cargar colecta';
          showStatus('Error de conexion', 'error');
        });
      };

      // Eliminar colecta (global function)
      window.eliminarColecta = function(colectaId) {
        if (!confirm('Eliminar esta colecta?')) return;
        fetch('/api/colecta/' + colectaId, { method: 'DELETE', credentials: 'include' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.success) {
              showStatus(data.mensaje, 'success');
              loadColectas();
            }
          })
          .catch(function(err) { showStatus('Error eliminando', 'error'); });
      };

      // Reiniciar colecta (global function)
      window.resetearColecta = function(colectaId) {
        if (!confirm('¿Reiniciar esta colecta? Se volverán a 0 todas las unidades verificadas.')) return;
        fetch('/api/colecta/' + colectaId + '/reset', { method: 'POST', credentials: 'include' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.success) {
              showStatus(data.mensaje, 'success');
              loadColectas();
              cargarItemsColectaActiva();
            } else {
              showStatus(data.error || 'Error al reiniciar', 'error');
            }
          })
          .catch(function(err) { showStatus('Error de conexión', 'error'); });
      };

      // Modal de detalle de colecta
      var colectaModal = document.getElementById('colectaModal');
      var modalClose = document.getElementById('modalClose');
      var modalColectaNombre = document.getElementById('modalColectaNombre');
      var modalColectaInfo = document.getElementById('modalColectaInfo');
      var modalProgressFill = document.getElementById('modalProgressFill');
      var modalProgressText = document.getElementById('modalProgressText');
      var modalColectaItems = document.getElementById('modalColectaItems');

      // Click en colecta para abrir modal
      colectasLista.addEventListener('click', function(e) {
        var colectaItem = e.target.closest('.colecta-item');
        if (colectaItem && !e.target.closest('.colecta-item-btn')) {
          var colectaId = colectaItem.getAttribute('data-id');
          abrirModalColecta(colectaId);
        }
      });

      // Cerrar modal
      modalClose.onclick = function() {
        colectaModal.classList.add('hidden');
      };
      colectaModal.onclick = function(e) {
        if (e.target === colectaModal) {
          colectaModal.classList.add('hidden');
        }
      };

      window.abrirModalColecta = function(colectaId) {
        fetch('/api/colecta/' + colectaId, { credentials: 'include' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.error) {
              showStatus(data.error, 'error');
              return;
            }

            modalColectaNombre.textContent = data.nombre;
            var colectaIdActual = colectaId;

            var infoHtml = '<p><strong>Cuenta:</strong> ' + (data.cuenta || 'Sin asignar') + '</p>';
            infoHtml += '<p><strong>Fecha colecta:</strong> <input type="date" id="modalFechaColecta" value="' + (data.fechaColecta || '') + '" style="padding:4px;border-radius:4px;border:1px solid #ccc;"></p>';
            infoHtml += '<p><strong>Productos:</strong> ' + data.totalCodigos + '</p>';
            infoHtml += '<p><strong>Unidades totales:</strong> ' + data.totalUnidades + '</p>';
            infoHtml += '<button onclick="guardarFechaColecta(\'' + colectaIdActual + '\')" style="margin-top:8px;padding:6px 12px;background:#4f46e5;color:white;border:none;border-radius:4px;cursor:pointer;">Guardar fecha</button>';
            modalColectaInfo.innerHTML = infoHtml;

            // Usar datos del backend (ya calculados)
            modalProgressFill.style.width = data.progreso + '%';
            modalProgressText.textContent = data.unidadesVerificadas + '/' + data.totalUnidades + ' unidades verificadas (' + data.progreso + '%)';

            // Renderizar items
            var items = data.items || [];
            var itemsHtml = '';
            items.forEach(function(item) {
              var verificadoClass = item.verificado ? ' verificado' : '';
              var statusIcon = item.verificado ? '✅' : '⏳';
              var nombreProducto = item.descripcion || item.sku || item.codigoML;
              itemsHtml += '<div class="colecta-modal-item' + verificadoClass + '">';
              itemsHtml += '<div class="colecta-modal-item-info">';
              itemsHtml += '<span class="colecta-modal-item-nombre">' + nombreProducto + '</span>';
              itemsHtml += '<span class="colecta-modal-item-codigo">' + item.codigoML + '</span>';
              itemsHtml += '</div>';
              itemsHtml += '<span class="colecta-modal-item-cant">' + item.cantidad + ' uds</span>';
              itemsHtml += '<span class="colecta-modal-item-status">' + statusIcon + '</span>';
              itemsHtml += '</div>';
            });
            modalColectaItems.innerHTML = itemsHtml;

            colectaModal.classList.remove('hidden');
          })
          .catch(function(err) {
            showStatus('Error cargando detalle', 'error');
          });
      };

      window.guardarFechaColecta = function(colectaId) {
        var nuevaFecha = document.getElementById('modalFechaColecta').value;
        if (!nuevaFecha) {
          showStatus('Seleccioná una fecha', 'error');
          return;
        }

        fetch('/api/colecta/' + colectaId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ fechaColecta: nuevaFecha })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.success) {
            showStatus('Fecha actualizada', 'success');
            loadColectas();
            colectaModal.classList.add('hidden');
          } else {
            showStatus(data.error || 'Error al guardar', 'error');
          }
        })
        .catch(function(err) {
          showStatus('Error al guardar fecha', 'error');
        });
      };

      // Marcar en la colecta activa seleccionada
      function marcarVerificadoEnColectaActiva(codigoML) {
        if (!colectaActivaId) {
          showStatus('Seleccioná una colecta primero', 'error');
          return;
        }

        var itemAntes = scannedItems[codigoML];
        var cantidadTotal = itemAntes ? itemAntes.cantidad : 0;
        var verificadasAntes = itemAntes ? itemAntes.cantidadVerificada : 0;

        fetch('/api/colecta/' + colectaActivaId + '/verificar/' + encodeURIComponent(codigoML), {
          method: 'POST',
          credentials: 'include'
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.success) {
            loadColectas();
            // Actualizar lista de escaneados
            if (scannedItems[codigoML]) {
              scannedItems[codigoML].cantidadVerificada = data.itemVerificado || (scannedItems[codigoML].cantidadVerificada + 1);
              actualizarListaEscaneados();
            } else {
              // Recargar items si no está en la lista
              cargarItemsColectaActiva();
            }
            if (data.yaVerificado) {
              showStatus(data.mensaje || 'Este código ya estaba verificado', 'loading');
            } else {
              showStatus(data.mensaje || 'Verificado', 'success');

              // Verificar si el item ahora está completo
              if (cantidadTotal > 0 && (verificadasAntes + 1) >= cantidadTotal) {
                setTimeout(function() {
                  showItemCompleteAlert(codigoML, cantidadTotal);
                }, 300);
              }
            }
          }
        })
        .catch(function(err) {
          console.error('Error marcando verificado:', err);
        });
      }

      function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = 'status-message show ' + type;
        if (type === 'success') {
          setTimeout(hideStatus, 3000);
        }
      }

      function hideStatus() {
        statusMessage.className = 'status-message';
      }

      function isItemComplete(index) {
        var item = currentItems[index];
        var checks = unitChecks[index] || [];
        for (var i = 0; i < item.quantity; i++) {
          var check = checks[i];
          var isChecked = check && (check === true || check.checked === true);
          if (!isChecked) return false;
        }
        return true;
      }

      function countCompletedItems() {
        var count = 0;
        for (var i = 0; i < currentItems.length; i++) {
          if (isItemComplete(i)) count++;
        }
        return count;
      }

      function updateItemsCount() {
        var total = currentItems.length;
        var checked = countCompletedItems();
        itemsCount.textContent = checked + '/' + total;
        if (checked === total && total > 0) {
          completeBanner.classList.add('show');
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
          // Marcar en la colecta activa
          if (currentCodigo && currentCodigo.codigoML && colectaActivaId) {
            marcarVerificadoEnColectaActiva(currentCodigo.codigoML);
          }
        } else {
          completeBanner.classList.remove('show');
        }
      }

      function updateCard(index) {
        var card = document.querySelector('.item-card[data-index="' + index + '"]');
        if (!card) return;
        var mainCheckbox = card.querySelector('.item-main-checkbox');
        var complete = isItemComplete(index);
        mainCheckbox.checked = complete;
        card.className = 'item-card' + (complete ? ' checked' : '') + (currentItems[index].isVerificationOnly ? ' verification-only' : '');
        updateItemsCount();
      }

      function highlightCard(index) {
        var card = document.querySelector('.item-card[data-index="' + index + '"]');
        if (!card) return;
        card.classList.add('just-scanned');
        setTimeout(function() {
          card.classList.remove('just-scanned');
        }, 2000);
      }

      function renderItems() {
        itemsList.innerHTML = '';
        for (var i = 0; i < currentItems.length; i++) {
          var item = currentItems[i];
          unitChecks[i] = [];

          var card = document.createElement('div');
          card.className = 'item-card' + (item.isVerificationOnly ? ' verification-only' : '');
          card.setAttribute('data-index', i);
          card.setAttribute('data-sku', item.sku);

          var mainCheckbox = document.createElement('input');
          mainCheckbox.type = 'checkbox';
          mainCheckbox.className = 'item-main-checkbox';
          mainCheckbox.checked = false;

          var info = document.createElement('div');
          info.className = 'item-info';

          var descDiv = document.createElement('div');
          descDiv.className = 'item-description';
          descDiv.textContent = item.description || item.sku;
          if (item.isKit) {
            var badge = document.createElement('span');
            badge.className = 'item-kit-badge';
            badge.textContent = 'KIT';
            descDiv.appendChild(badge);
          }

          var skuDiv = document.createElement('div');
          skuDiv.className = 'item-sku';
          skuDiv.textContent = item.isVerificationOnly ? '⚠️ Verificacion adicional' : 'SKU: ' + item.sku;

          var qtyDiv = document.createElement('div');
          qtyDiv.className = 'item-quantity';
          var displayQty = item.displayQuantity !== undefined ? item.displayQuantity : item.quantity;
          qtyDiv.textContent = 'Cantidad: ' + displayQty;

          var unitsDiv = document.createElement('div');
          unitsDiv.className = 'unit-checkboxes';

          for (var j = 0; j < item.quantity; j++) {
            var unitCb = document.createElement('input');
            unitCb.type = 'checkbox';
            unitCb.className = 'unit-checkbox';
            unitCb.setAttribute('data-item', i);
            unitCb.setAttribute('data-unit', j);
            unitsDiv.appendChild(unitCb);
          }

          info.appendChild(descDiv);
          info.appendChild(skuDiv);
          info.appendChild(qtyDiv);
          info.appendChild(unitsDiv);
          card.appendChild(mainCheckbox);
          card.appendChild(info);

          // Botón de foto para verificación (solo items normales)
          if (!item.isVerificationOnly) {
            var verifyBtn = document.createElement('button');
            verifyBtn.className = 'verify-photo-btn';
            verifyBtn.textContent = '📷';
            verifyBtn.title = 'Verificar con foto';
            verifyBtn.setAttribute('data-index', i);
            verifyBtn.onclick = function(e) {
              e.stopPropagation();
              var idx = parseInt(this.getAttribute('data-index'));
              iniciarVerificacionFoto(idx);
            };
            card.appendChild(verifyBtn);
          }

          itemsList.appendChild(card);
        }
        updateItemsCount();
      }

      itemsList.addEventListener('click', function(e) {
        if (e.target.classList.contains('unit-checkbox')) {
          var itemIndex = parseInt(e.target.getAttribute('data-item'));
          var unitIndex = parseInt(e.target.getAttribute('data-unit'));
          if (!unitChecks[itemIndex]) unitChecks[itemIndex] = [];
          unitChecks[itemIndex][unitIndex] = e.target.checked ? { checked: true, method: 'manual' } : null;
          updateCard(itemIndex);
        }
      });

      function searchCodigo(codigo) {
        if (!codigo || codigo.trim() === '') {
          showStatus('Ingresa un codigo ML', 'error');
          return;
        }
        if (!colectaActivaId) {
          showStatus('Seleccioná una colecta primero', 'error');
          return;
        }
        codigo = codigo.trim().toUpperCase();

        // Verificar si ya tiene todas las unidades escaneadas
        var itemEnColecta = scannedItems[codigo];
        if (itemEnColecta && itemEnColecta.cantidad > 0 && itemEnColecta.cantidadVerificada >= itemEnColecta.cantidad) {
          showAllScannedAlert(codigo, itemEnColecta.cantidad);
          stopCamera();
          return;
        }

        showStatus('Buscando...', 'loading');
        searchBtn.disabled = true;

        fetch('/api/codigo/' + encodeURIComponent(codigo), { credentials: 'include' })
          .then(function(response) {
            return response.json().then(function(data) {
              if (!response.ok) throw new Error(data.error || 'Codigo no encontrado');
              return data;
            });
          })
          .then(function(data) {
            currentCodigo = data;
            currentItems = data.items;
            unitChecks = {};
            hideStatus();
            itemsSection.classList.remove('hidden');
            resetBtn.classList.remove('hidden');
            itemsCuenta.textContent = data.cuenta;

            // Mostrar estado de colectas (múltiples)
            var colectaBadges = '';
            if (data.colectas && data.colectas.length > 0) {
              data.colectas.forEach(function(col) {
                if (col.verificado) {
                  colectaBadges += '<span class="colecta-status-badge verificado">VERIFICADO</span>';
                } else {
                  colectaBadges += '<span class="colecta-status-badge en-colecta">EN COLECTA</span>';
                }
              });
            } else if (colectasData.length > 0) {
              colectaBadges = '<span class="colecta-status-badge no-colecta">NO EN COLECTAS</span>';
            }

            itemsProducto.innerHTML = (data.producto ? ' - ' + data.producto.substring(0, 30) + '...' : '') + colectaBadges;
            renderItems();
            stopCamera();
            visionResult.classList.add('hidden');
          })
          .catch(function(error) {
            showStatus(error.message, 'error');
            itemsSection.classList.add('hidden');
          })
          .finally(function() {
            searchBtn.disabled = false;
          });
      }

      // Event listeners
      searchBtn.onclick = function() {
        searchCodigo(codigoInput.value);
      };

      codigoInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          searchCodigo(codigoInput.value);
        }
      });

      resetBtn.onclick = function() {
        currentItems = [];
        unitChecks = {};
        currentCodigo = null;
        itemsSection.classList.add('hidden');
        resetBtn.classList.add('hidden');
        completeBanner.classList.remove('show');
        visionResult.classList.add('hidden');
        codigoInput.value = '';
        codigoInput.focus();
      };

      // ============================================
      // ESCÁNER DE CÓDIGO DE BARRAS
      // ============================================
      cameraBtn.onclick = function() {
        if (isScanning) {
          stopCamera();
        } else {
          startCamera();
        }
      };

      closeCameraBtn.onclick = stopCamera;

      function startCamera() {
        cameraContainer.classList.add('active');
        isScanning = true;
        cameraBtn.textContent = 'Cerrar camara';

        if (!codeReader) {
          // Configuración mejorada para mejor lectura de códigos
          var hints = new Map();
          hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
          hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
            ZXing.BarcodeFormat.QR_CODE,
            ZXing.BarcodeFormat.CODE_128,
            ZXing.BarcodeFormat.CODE_39,
            ZXing.BarcodeFormat.EAN_13,
            ZXing.BarcodeFormat.EAN_8,
            ZXing.BarcodeFormat.UPC_A,
            ZXing.BarcodeFormat.UPC_E,
            ZXing.BarcodeFormat.DATA_MATRIX
          ]);
          codeReader = new ZXing.BrowserMultiFormatReader(hints);
        }

        // Usar cámara trasera con mayor resolución
        var constraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            focusMode: 'continuous'
          }
        };

        codeReader.decodeFromConstraints(constraints, video, function(result, err) {
          if (result) {
            var code = result.getText();
            if (navigator.vibrate) navigator.vibrate(100);
            codigoInput.value = code;
            searchCodigo(code);
          }
        }).catch(function(err) {
          console.error('Error iniciando camara:', err);
          showStatus('Error al acceder a la camara', 'error');
          stopCamera();
        });
      }

      function stopCamera() {
        if (codeReader) {
          codeReader.reset();
        }
        cameraContainer.classList.remove('active');
        isScanning = false;
        cameraBtn.textContent = 'Escanear codigo';
      }

      // ============================================
      // VERIFICACIÓN CON CÁMARA (Claude Vision)
      // ============================================
      function iniciarVerificacionFoto(itemIndex) {
        photoItemIndex = itemIndex;
        var item = currentItems[itemIndex];
        visionProductName.textContent = item.description || item.sku || 'Producto';
        abrirVisionCamera();
      }

      function abrirVisionCamera() {
        visionCameraModal.classList.remove('hidden');
        visionAnalyzeBtn.disabled = false;
        visionAnalyzeBtn.innerHTML = '<span>🔍</span> Analizar';

        var constraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        };

        navigator.mediaDevices.getUserMedia(constraints)
          .then(function(stream) {
            visionStream = stream;
            visionVideo.srcObject = stream;
          })
          .catch(function(err) {
            console.error('Error accediendo a camara:', err);
            cerrarVisionCamera();
            showStatus('Error al acceder a la camara', 'error');
          });
      }

      function cerrarVisionCamera() {
        visionCameraModal.classList.add('hidden');
        if (visionStream) {
          visionStream.getTracks().forEach(function(track) { track.stop(); });
          visionStream = null;
        }
        visionVideo.srcObject = null;
        photoItemIndex = null;
      }

      visionCameraClose.onclick = cerrarVisionCamera;

      visionAnalyzeBtn.onclick = function() {
        if (photoItemIndex === null) return;
        var item = currentItems[photoItemIndex];

        // Capturar frame del video
        visionCanvas.width = visionVideo.videoWidth;
        visionCanvas.height = visionVideo.videoHeight;
        var ctx = visionCanvas.getContext('2d');
        ctx.drawImage(visionVideo, 0, 0);
        var base64 = visionCanvas.toDataURL('image/jpeg', 0.9);

        // Deshabilitar botón mientras analiza
        visionAnalyzeBtn.disabled = true;
        visionAnalyzeBtn.innerHTML = '<span>⏳</span> Analizando...';

        fetch('/api/vision/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            image: base64,
            producto: {
              sku: item.sku,
              descripcion: item.description,
              producto: currentCodigo ? currentCodigo.producto : ''
            }
          })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          cerrarVisionCamera();
          mostrarResultadoVision(data, photoItemIndex);
        })
        .catch(function(err) {
          visionAnalyzeBtn.disabled = false;
          visionAnalyzeBtn.innerHTML = '<span>🔍</span> Analizar';
          showStatus('Error analizando imagen', 'error');
        });
      };

      function mostrarResultadoVision(data, itemIndex) {
        var isCorrect = data.correcto !== false;
        visionResult.className = 'vision-result ' + (isCorrect ? 'correct' : 'incorrect');

        var html = '<h4>' + (isCorrect ? '✅ Verificado' : '❌ No coincide') + '</h4>';
        if (data.modeloDetectado) html += '<p><strong>Modelo:</strong> ' + data.modeloDetectado + '</p>';
        if (data.colorDetectado) html += '<p><strong>Color:</strong> ' + data.colorDetectado + '</p>';
        if (data.productoDetectado) html += '<p><strong>Detectado:</strong> ' + data.productoDetectado + '</p>';
        if (data.motivo) html += '<p><strong>Motivo:</strong> ' + data.motivo + '</p>';
        html += '<p><strong>Confianza:</strong> ' + (data.confianza || 'N/A') + '</p>';

        visionResult.innerHTML = html;
        visionResult.classList.remove('hidden');

        // Auto-marcar si es correcto
        if (isCorrect && itemIndex !== null) {
          var item = currentItems[itemIndex];
          if (!unitChecks[itemIndex]) unitChecks[itemIndex] = [];
          // Marcar primera unidad no marcada
          for (var i = 0; i < item.quantity; i++) {
            if (!unitChecks[itemIndex][i]) {
              unitChecks[itemIndex][i] = { checked: true, method: 'photo' };
              var checkbox = document.querySelector('.unit-checkbox[data-item="' + itemIndex + '"][data-unit="' + i + '"]');
              if (checkbox) checkbox.checked = true;
              break;
            }
          }
          updateCard(itemIndex);
          highlightCard(itemIndex);
        }

        photoItemIndex = null;
      }
    }
