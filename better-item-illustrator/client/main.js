/* Better Item para Illustrator - painel CEP. Fala com o ExtendScript por __adobe_cep__. */
(function () {
  'use strict';
  var cep = window.__adobe_cep__;
  var UNIT = { pt: 1, px: 1, mm: 72 / 25.4 };
  var STORE = 'betterItem.settings.v2';
  var state = {
    tab: 'arrange', target: 'objects', orientation: 'global', mode: 'spacing', pointView: 'coords',
    angles: [0, 90, 45, 60, 30], lengths: []
  };
  var tf = null;        // última leitura do painel Transformar (coordenadas do documento, pt)
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function extensionPath() {
    var p = decodeURI(cep.getSystemPath('extension'));
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

  function call(payload, done, quiet) {
    evalScript('BIH.run(' + JSON.stringify(payload) + ')', function (raw) {
      var res;
      try { res = JSON.parse(raw); } catch (e) {
        if (!quiet) { status('Resposta inesperada do Illustrator: ' + raw, true); }
        return;
      }
      if (res.key !== undefined) { $('keyInfo').textContent = res.key ? 'Chave: ' + res.key : 'Nenhuma chave.'; }
      if (!res.ok) { if (!quiet) { status(res.message, true); } return; }
      if (res.message && !quiet) { status(res.message, false); }
      if (done) { done(res); }
    });
  }

  function unitFactor() { return UNIT[$('unit').value] || 1; }
  function round(v, d) { var k = Math.pow(10, d); return Math.round(v * k) / k; }
  function fmt(pt) { return String(round(pt / unitFactor(), 3)) + ' ' + $('unit').value; }

  // ---------------------------------------------------------------- abas e segmentos
  function bindSeg(name, selector) {
    var box = document.querySelector(selector || '.seg[data-name="' + name + '"]');
    var buttons = Array.prototype.slice.call(box.querySelectorAll('button'));
    function paint() {
      buttons.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-value') === state[name]); });
      refresh();
    }
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        state[name] = b.getAttribute('data-value');
        save(); paint();
        if (name === 'tab' && state.tab === 'transform') { readTransform(); }
        if (name === 'pointView') { renderTransform(); }
      });
    });
    paint();
  }

  function refresh() {
    all('.page').forEach(function (p) { p.classList.toggle('on', p.id === 'page-' + state.tab); });
    document.body.classList.toggle('view-coords', state.pointView === 'coords');
    document.body.classList.toggle('view-vector', state.pointView === 'vector');
    $('angleRow').classList.toggle('hidden', state.orientation !== 'angle');
    $('spacingRow').classList.toggle('hidden', state.mode !== 'spacing');
    $('endsRow').classList.toggle('hidden', state.mode !== 'between');
    all('.unitLabel').forEach(function (s) { s.textContent = $('unit').value; });
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

  // ---------------------------------------------------------------- persistência
  var FIELDS = ['angle', 'alignRef', 'alignBasis', 'distAxis', 'distBasis', 'spacing', 'unit', 'ends', 'pivot',
               ];
  var CHECKS = ['linkWH', 'moveHandles', 'useAngles', 'useLengths', 'sense', 'keepSmooth'];
  function save() {
    var s = { tab: state.tab, target: state.target, orientation: state.orientation, mode: state.mode,
              pointView: state.pointView, angles: state.angles, lengths: state.lengths };
    FIELDS.forEach(function (f) { s[f] = $(f).value; });
    CHECKS.forEach(function (f) { s[f] = $(f).checked; });
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) {}
  }
  function load() {
    var s;
    try { s = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { s = null; }
    if (!s) { return; }
    ['tab', 'target', 'orientation', 'mode', 'pointView', 'angles', 'lengths'].forEach(function (k) {
      if (s[k] !== undefined) { state[k] = s[k]; }
    });
    FIELDS.forEach(function (f) { if (s[f] !== undefined) { $(f).value = s[f]; } });
    CHECKS.forEach(function (f) { if (s[f] !== undefined) { $(f).checked = s[f]; } });
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

  // ---------------------------------------------------------------- arranjar
  function common() {
    return { target: state.target, orientation: state.orientation, angle: parseFloat($('angle').value) || 0 };
  }

  function bindArrange() {
    all('button.align').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = common();
        p.action = 'align';
        p.axis = b.getAttribute('data-axis');
        p.edge = b.getAttribute('data-edge');
        p.reference = $('alignRef').value;
        p.basis = $('alignBasis').value;
        call(p);
      });
    });
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
  }

  // ---------------------------------------------------------------- transformar
  // Prancheta: X = x - esquerda, Y = topo - y (Y para baixo, como o painel Transformar).
  function toAbX(x) { return x - tf.artboard[0]; }
  function toAbY(y) { return tf.artboard[1] - y; }
  function fromAbX(x) { return x + tf.artboard[0]; }
  function fromAbY(y) { return tf.artboard[1] - y; }

  function pivot() { var p = $('pivot').value.split(','); return { px: p[0], py: p[1] }; }

  function setVal(input, v) {
    if (document.activeElement === input) { return; }
    input.value = v === null || v === undefined || isNaN(v) ? '' : String(v);
  }

  function vec(anchor, h) {
    var dx = h[0] - anchor[0], dy = h[1] - anchor[1], L = Math.sqrt(dx * dx + dy * dy);
    return { len: L, ang: L > 1e-9 ? Math.atan2(dy, dx) * 180 / Math.PI : 0 };
  }

  function renderTransform() {
    var f = unitFactor();
    $('tfObject').classList.add('hidden');
    $('tfPoint').classList.add('hidden');
    if (!tf || tf.mode === 'none') { $('tfTitle').textContent = 'Nada selecionado'; return; }
    if (tf.mode === 'object') {
      $('tfTitle').textContent = tf.count === 1 ? 'Objeto' : tf.count + ' objetos';
      $('tfObject').classList.remove('hidden');
      all('#tfObject input.tf').forEach(function (inp) {
        var k = inp.getAttribute('data-field'), v;
        if (k === 'x') { v = toAbX(tf.x) / f; }
        else if (k === 'y') { v = toAbY(tf.y) / f; }
        else if (k === 'w') { v = tf.w / f; }
        else if (k === 'h') { v = tf.h / f; }
        else { v = tf.rotation; }
        setVal(inp, round(v, 3));
      });
      $('rotNote').textContent = !tf.single ? 'Com vários objetos, a rotação é aplicada ao conjunto em volta do ponto de referência.'
        : (tf.rotationKnown ? 'Largura e altura medidas nos eixos do objeto girado.'
                            : 'O Illustrator não guardou uma rotação para este objeto: ela aparece como 0°.');
      return;
    }
    $('tfTitle').textContent = tf.count === 1 ? 'Ponto de ancoragem' : 'Ponto 1 de ' + tf.count;
    $('tfPoint').classList.remove('hidden');
    all('#tfPoint input.pt').forEach(function (inp) {
      var part = inp.getAttribute('data-part'), c = inp.getAttribute('data-c'), p = tf[part], v;
      if (c === '0') { v = toAbX(p[0]) / f; }
      else if (c === '1') { v = toAbY(p[1]) / f; }
      else if (c === 'len') { v = vec(tf.anchor, p).len / f; }
      else { v = vec(tf.anchor, p).ang; }
      setVal(inp, round(v, 3));
      inp.disabled = tf.count !== 1;
    });
    $('pointNote').textContent = tf.count !== 1 ? 'Para editar, selecione um único ponto.' : '';
  }

  function readTransform(quiet) {
    if (busy) { return; }
    var p = pivot();
    p.action = 'read';
    call(p, function (res) { tf = res; renderTransform(); }, quiet !== false);
  }

  function bindTransform() {
    $('tfRefresh').addEventListener('click', function () { readTransform(false); });
    $('pivot').addEventListener('change', function () { save(); readTransform(); });

    all('#tfObject input.tf').forEach(function (inp) {
      inp.addEventListener('change', function () {
        if (!tf || tf.mode !== 'object') { return; }
        var k = inp.getAttribute('data-field'), raw = parseFloat(inp.value), p = pivot(), v;
        if (isNaN(raw)) { renderTransform(); return; }
        if (k === 'x') { v = fromAbX(raw * unitFactor()); }
        else if (k === 'y') { v = fromAbY(raw * unitFactor()); }
        else if (k === 'w' || k === 'h') { v = raw * unitFactor(); }
        else { v = raw; }
        p.action = 'applyObject'; p.field = k; p.value = v; p.linked = $('linkWH').checked;
        busy = true;
        call(p, function (res) { busy = false; tf = res.state; renderTransform(); });
        setTimeout(function () { busy = false; }, 3000);
      });
    });

    all('#tfPoint input.pt').forEach(function (inp) {
      inp.addEventListener('change', function () {
        if (!tf || tf.mode !== 'point' || tf.count !== 1) { return; }
        var part = inp.getAttribute('data-part'), c = inp.getAttribute('data-c'), raw = parseFloat(inp.value), f = unitFactor();
        var anchor = tf.anchor.slice(), left = tf.left.slice(), right = tf.right.slice(), cur, d, v, t;
        if (isNaN(raw)) { renderTransform(); return; }
        var obj = { anchor: anchor, left: left, right: right };
        if (c === '0' || c === '1') {
          cur = obj[part].slice();
          if (c === '0') { obj[part][0] = fromAbX(raw * f); } else { obj[part][1] = fromAbY(raw * f); }
          if (part === 'anchor' && $('moveHandles').checked) {
            d = [obj.anchor[0] - cur[0], obj.anchor[1] - cur[1]];
            left[0] += d[0]; left[1] += d[1]; right[0] += d[0]; right[1] += d[1];
          }
        } else {
          v = vec(anchor, obj[part]);
          if (c === 'len') { v.len = Math.max(0, raw * f); } else { v.ang = raw; }
          t = v.ang * Math.PI / 180;
          obj[part][0] = anchor[0] + v.len * Math.cos(t);
          obj[part][1] = anchor[1] + v.len * Math.sin(t);
        }
        busy = true;
        call({ action: 'applyPoint', anchor: anchor, left: left, right: right }, function (res) {
          busy = false; tf = res.state; renderTransform();
        });
        setTimeout(function () { busy = false; }, 3000);
      });
    });

    // Atualiza com a seleção: evento do Illustrator, se houver, e leitura leve periódica.
    try { cep.addEventListener('afterSelectionChanged', function () { if (state.tab === 'transform') { readTransform(); } }); } catch (e) {}
    setInterval(function () {
      if (state.tab !== 'transform' || document.hidden) { return; }
      var a = document.activeElement;
      if (a && a.tagName === 'INPUT') { return; }
      readTransform();
    }, 800);
  }

  // ---------------------------------------------------------------- alças
  function renderLists() {
    function draw(listEl, arr, fmtItem, key) {
      listEl.innerHTML = '';
      arr.forEach(function (v, i) {
        var li = document.createElement('li');
        var span = document.createElement('span'); span.textContent = fmtItem(v); li.appendChild(span);
        [['↑', -1, 'Subir prioridade'], ['↓', 1, 'Descer prioridade'], ['✕', 0, 'Remover']].forEach(function (b) {
          var btn = document.createElement('button');
          btn.textContent = b[0]; btn.title = b[2]; btn.className = 'ghost';
          btn.addEventListener('click', function () {
            var list = state[key];
            if (b[1] === 0) { list.splice(i, 1); }
            else {
              var j = i + b[1];
              if (j < 0 || j >= list.length) { return; }
              var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
            }
            save(); renderLists();
          });
          li.appendChild(btn);
        });
        listEl.appendChild(li);
      });
    }
    draw($('angleList'), state.angles, function (v) { return v + '°'; }, 'angles');
    draw($('lengthList'), state.lengths, function (v) { return fmt(v); }, 'lengths');
    $('angleEmpty').classList.toggle('hidden', state.angles.length > 0);
    $('lengthEmpty').classList.toggle('hidden', state.lengths.length > 0);
  }

  function bindHandles() {
    function addAngle() {
      var v = parseFloat($('angleAdd').value);
      if (isNaN(v)) { return; }
      state.angles.push(v); $('angleAdd').value = ''; $('useAngles').checked = true; save(); renderLists();
    }
    function addLength() {
      var v = parseFloat($('lengthAdd').value);
      if (isNaN(v) || v <= 0) { status('A magnitude precisa ser maior que zero.', true); return; }
      state.lengths.push(v * unitFactor()); $('lengthAdd').value = ''; $('useLengths').checked = true; save(); renderLists();
    }
    $('angleAddBtn').addEventListener('click', addAngle);
    $('lengthAddBtn').addEventListener('click', addLength);
    $('angleAdd').addEventListener('keydown', function (e) { if (e.key === 'Enter') { addAngle(); } });
    $('lengthAdd').addEventListener('keydown', function (e) { if (e.key === 'Enter') { addLength(); } });
    $('snap').addEventListener('click', function () {
      var wantA = $('useAngles').checked, wantL = $('useLengths').checked;
      if (wantA && !state.angles.length) { status('A lista de ângulos está marcada mas vazia.', true); return; }
      if (wantL && !state.lengths.length) { status('A lista de magnitudes está marcada mas vazia.', true); return; }
      if (!wantA && !wantL) { status('Marque pelo menos uma lista (ângulos ou magnitudes).', true); return; }
      call({ action: 'snapHandles', useAngles: wantA, angles: state.angles, sense: $('sense').checked,
             angleTolerance: 0, keepSmooth: $('keepSmooth').checked,
             useLengths: wantL, lengths: state.lengths, lengthTolerance: 0 });
    });
  }

  // ---------------------------------------------------------------- início
  function init() {
    load();
    bindSeg('tab', '.tabs'); bindSeg('target'); bindSeg('orientation'); bindSeg('mode'); bindSeg('pointView');
    FIELDS.forEach(function (f) { $(f).addEventListener('change', function () { save(); refresh(); }); });
    CHECKS.forEach(function (f) { $(f).addEventListener('change', save); });
    $('unit').addEventListener('change', function () { renderLists(); renderTransform(); });
    bindArrange(); bindTransform(); bindHandles();
    renderLists();

    if (!cep) { status('Este painel precisa rodar dentro do Illustrator.', true); return; }
    applySkin();
    var base = extensionPath() + '/host/';
    evalScript('$.evalFile(' + JSON.stringify(base + 'core.jsx') + ');$.evalFile(' + JSON.stringify(base + 'host.jsx') + ');"pronto"',
      function (r) {
        if (r !== 'pronto') { status('Falha ao carregar os scripts: ' + r, true); return; }
        call({ action: 'keyInfo' });
        if (state.tab === 'transform') { readTransform(); }
      });
  }

  document.addEventListener('DOMContentLoaded', init);
}());
