/* Better Item para Illustrator - painel CEP. Fala com o ExtendScript por __adobe_cep__. */
(function () {
  'use strict';
  var cep = window.__adobe_cep__;
  var UNIT = { pt: 1, px: 1, mm: 72 / 25.4 };
  var STORE = 'betterItem.settings.v1';
  var state = { target: 'objects', orientation: 'global', mode: 'spacing' };

  function $(id) { return document.getElementById(id); }

  function extensionPath() {
    var p = cep.getSystemPath('extension');
    p = decodeURI(p);
    if (navigator.platform.indexOf('Win') === 0) { return p.replace('file:///', ''); }
    return p.replace('file://', '');
  }

  function evalScript(code, cb) {
    if (!cep) { status('Este painel precisa rodar dentro do Illustrator.', true); return; }
    cep.evalScript(code, cb || function () {});
  }

  function status(msg, isError) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (isError ? ' error' : '');
  }

  function call(payload, done) {
    evalScript('BIH.run(' + JSON.stringify(payload) + ')', function (raw) {
      var res;
      try { res = JSON.parse(raw); } catch (e) {
        status('Resposta inesperada do Illustrator: ' + raw, true); return;
      }
      if (res.key !== undefined) { $('keyInfo').textContent = res.key ? 'Chave: ' + res.key : 'Nenhuma chave.'; }
      if (!res.ok) { status(res.message, true); return; }
      if (res.message) { status(res.message, false); }
      if (done) { done(res); }
    });
  }

  function unitFactor() { return UNIT[$('unit').value] || 1; }
  function fmt(pt) { return (pt / unitFactor()).toFixed(3).replace(/\.?0+$/, '') + ' ' + $('unit').value; }

  function common() {
    return { target: state.target, orientation: state.orientation, angle: parseFloat($('angle').value) || 0 };
  }

  // ---------------------------------------------------------------- interface
  function bindSeg(name) {
    var box = document.querySelector('.seg[data-name="' + name + '"]');
    var buttons = box.querySelectorAll('button');
    function paint() {
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].classList.toggle('on', buttons[i].getAttribute('data-value') === state[name]);
      }
      refresh();
    }
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (ev) {
        state[name] = ev.currentTarget.getAttribute('data-value');
        save(); paint();
      });
    }
    paint();
  }

  function refresh() {
    $('angleRow').classList.toggle('hidden', state.orientation !== 'angle');
    $('spacingRow').classList.toggle('hidden', state.mode !== 'spacing');
    $('endsRow').classList.toggle('hidden', state.mode !== 'between');
    var basis = $('distBasis').value, hint = '';
    if (basis === 'contact') {
      hint = 'Até contato mede a geometria real dos contornos (sem a espessura do traço). Com valor 0, os itens se encostam.';
    } else if (basis === 'gap') {
      hint = 'Vão entre limites: distância entre as caixas projetadas na direção.';
    } else if (basis === 'mass') {
      hint = 'Centro de massa: centroide da área preenchida; traços sem preenchimento usam o centroide da linha.';
    }
    if (state.mode === 'spacing') { hint += (hint ? ' ' : '') + 'A chave, se estiver na seleção, fica parada.'; }
    $('spacingHint').textContent = hint;
  }

  var FIELDS = ['angle', 'alignRef', 'alignBasis', 'distAxis', 'distBasis', 'spacing', 'unit', 'ends'];
  function save() {
    var s = { target: state.target, orientation: state.orientation, mode: state.mode }, i;
    for (i = 0; i < FIELDS.length; i++) { s[FIELDS[i]] = $(FIELDS[i]).value; }
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) {}
  }
  function load() {
    var s, i;
    try { s = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { s = null; }
    if (!s) { return; }
    state.target = s.target || state.target;
    state.orientation = s.orientation || state.orientation;
    state.mode = s.mode || state.mode;
    for (i = 0; i < FIELDS.length; i++) { if (s[FIELDS[i]] !== undefined) { $(FIELDS[i]).value = s[FIELDS[i]]; } }
  }

  function applySkin() {
    try {
      var env = JSON.parse(cep.getHostEnvironment());
      var c = env.appSkinInfo.panelBackgroundColor.color;
      var r = Math.round(c.red), g = Math.round(c.green), b = Math.round(c.blue);
      var root = document.documentElement.style;
      root.setProperty('--bg', 'rgb(' + r + ',' + g + ',' + b + ')');
      if ((r + g + b) / 3 > 128) {
        root.setProperty('--panel', '#ffffff'); root.setProperty('--line', '#c8c8c8');
        root.setProperty('--text', '#222222'); root.setProperty('--muted', '#666666'); root.setProperty('--error', '#b3261e');
      } else {
        root.setProperty('--panel', 'rgb(' + Math.min(255, r + 12) + ',' + Math.min(255, g + 12) + ',' + Math.min(255, b + 12) + ')');
        root.setProperty('--line', 'rgb(' + Math.min(255, r + 28) + ',' + Math.min(255, g + 28) + ',' + Math.min(255, b + 28) + ')');
        root.setProperty('--text', '#e6e6e6'); root.setProperty('--muted', '#a8a8a8'); root.setProperty('--error', '#ff8a80');
      }
    } catch (e) {}
  }

  // ---------------------------------------------------------------- ações
  function init() {
    load();
    bindSeg('target'); bindSeg('orientation'); bindSeg('mode');
    FIELDS.forEach(function (f) { $(f).addEventListener('change', function () { save(); refresh(); }); });

    var all = document.querySelectorAll('button.align');
    for (var i = 0; i < all.length; i++) {
      all[i].addEventListener('click', function (ev) {
        var b = ev.currentTarget, p = common();
        p.action = 'align';
        p.axis = b.getAttribute('data-axis');
        p.edge = b.getAttribute('data-edge');
        p.reference = $('alignRef').value;
        p.basis = $('alignBasis').value;
        call(p);
      });
    }

    $('distribute').addEventListener('click', function () {
      var p = common();
      p.action = 'distribute';
      p.axis = $('distAxis').value;
      p.basis = $('distBasis').value;
      p.mode = state.mode;
      p.ends = $('ends').value;
      p.spacing = (parseFloat($('spacing').value) || 0) * unitFactor();
      p.tolerance = 0.02;
      call(p);
    });

    $('inspect').addEventListener('click', function () {
      var p = common();
      p.action = 'inspect';
      p.axis = $('distAxis').value;
      p.basis = $('distBasis').value;
      p.tolerance = 0.02;
      call(p, function (res) {
        if (!res.gaps || res.gaps.length === 0) { status('Selecione pelo menos dois itens para medir.'); return; }
        var txt = res.uniform ? 'Espaçamento atual uniforme: ' + fmt(res.gaps[0]) + '.'
                              : 'Espaçamento misto: de ' + fmt(res.min) + ' a ' + fmt(res.max) + ' (' + res.gaps.map(fmt).join(', ') + ').';
        if (res.fallback) { txt += ' ' + res.fallback + ' par(es) sem contato possível usaram os limites.'; }
        status(txt);
      });
    });

    $('setKey').addEventListener('click', function () { call({ action: 'setKey', target: state.target }); });
    $('clearKey').addEventListener('click', function () { call({ action: 'clearKey' }); });

    if (!cep) { status('Este painel precisa rodar dentro do Illustrator.', true); return; }
    applySkin();
    var base = extensionPath() + '/host/';
    evalScript('$.evalFile(' + JSON.stringify(base + 'core.jsx') + ');$.evalFile(' + JSON.stringify(base + 'host.jsx') + ');"pronto"',
      function (r) {
        if (r !== 'pronto') { status('Falha ao carregar os scripts: ' + r, true); return; }
        call({ action: 'keyInfo' });
      });
  }

  document.addEventListener('DOMContentLoaded', init);
}());
