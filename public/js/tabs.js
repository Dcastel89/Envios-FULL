  (function creacionTabsInit() {
    var isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isPWA) return;

    document.querySelectorAll('.creacion-tab').forEach(function(tab) {
      tab.onclick = function() {
        document.querySelectorAll('.creacion-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.creacion-content').forEach(function(c) { c.classList.remove('active'); });
        this.classList.add('active');
        var tabId = this.getAttribute('data-tab');
        var content = document.getElementById('tab' + tabId.charAt(0).toUpperCase() + tabId.slice(1));
        if (content) content.classList.add('active');
      };
    });
  })();
