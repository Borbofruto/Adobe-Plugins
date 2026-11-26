// Executa host.jsx contra um DOM simulado do Illustrator. Rode com: node tests/host.mock.test.js
// Não substitui o teste no Illustrator real: confere a ponte (seleção, chave, movimentos).
var fs = require('fs'), path = require('path'), vm = require('vm');
var dir = path.join(__dirname, '..', 'host');

var PathPointSelection = { ANCHORPOINT: 1, LEFTDIRECTION: 2, RIGHTDIRECTION: 3, LEFTRIGHTPOINT: 4, NOSELECTION: 5 };

function tagList() {
    var list = [];
    list.add = function () {
        var t = { name: '', value: '', remove: function () { list.splice(list.indexOf(t), 1); } };
        list.push(t); return t;
    };
    return list;
}
function pp(x, y, sel) {
    return { anchor: [x, y], leftDirection: [x, y], rightDirection: [x, y], selected: sel || PathPointSelection.NOSELECTION, pointType: 'corner' };
}
var uid = 0;
function pathItem(points, closed, filled) {
    var it = { typename: 'PathItem', uuid: String(++uid), pathPoints: points, closed: closed, filled: filled !== false,
               clipping: false, hidden: false, name: '', tags: tagList() };
    Object.defineProperty(it, 'geometricBounds', { get: function () {
        var xs = points.map(function (p) { return p.anchor[0]; }), ys = points.map(function (p) { return p.anchor[1]; });
        return [Math.min.apply(null, xs), Math.max.apply(null, ys), Math.max.apply(null, xs), Math.min.apply(null, ys)];
    } });
    Object.defineProperty(it, 'position', {
        get: function () { var b = it.geometricBounds; return [b[0], b[1]]; },
        set: function (v) {
            var b = it.geometricBounds, dx = v[0] - b[0], dy = v[1] - b[1];
            points.forEach(function (p) {
                ['anchor', 'leftDirection', 'rightDirection'].forEach(function (k) { p[k] = [p[k][0] + dx, p[k][1] + dy]; });
            });
        }
    });
    function eachPt(fn) { points.forEach(function (p) { ['anchor', 'leftDirection', 'rightDirection'].forEach(function (k) { p[k] = fn(p[k]); }); }); }
    function center() { var b = it.geometricBounds; return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
    it.rotate = function (deg) {
        var c = center(), t = deg * Math.PI / 180, co = Math.cos(t), si = Math.sin(t);
        eachPt(function (q) { var x = q[0] - c[0], y = q[1] - c[1]; return [c[0] + x * co - y * si, c[1] + x * si + y * co]; });
    };
    it.resize = function (sx, sy) {
        var c = center();
        eachPt(function (q) { return [c[0] + (q[0] - c[0]) * sx / 100, c[1] + (q[1] - c[1]) * sy / 100]; });
    };
    return it;
}
function rectPath(x0, y0, x1, y1, sel) {
    return pathItem([pp(x0, y0, sel), pp(x1, y0, sel), pp(x1, y1, sel), pp(x0, y1, sel)], true);
}

var doc = { selection: [], pageItems: [], artboards: [{ artboardRect: [0, 200, 300, 0] }] };
doc.artboards.getActiveArtboardIndex = function () { return 0; };
var sandbox = {
    app: { documents: [doc], activeDocument: doc, coordinateSystem: 'AB' },
    CoordinateSystem: { DOCUMENTCOORDINATESYSTEM: 'DOC' },
    PathPointSelection: PathPointSelection,
    Transformation: { CENTER: 'center' },
    PointType: { SMOOTH: 'smooth', CORNER: 'corner' },
    console: console
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(dir, 'core.jsx'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(dir, 'host.jsx'), 'utf8'), sandbox);
function run(o) { return JSON.parse(sandbox.BIH.run(o)); }

var fails = 0, n = 0;
function check(c, msg, extra) { n++; if (!c) { fails++; console.log('FALHOU: ' + msg, extra || ''); } }

// --- objetos: distribuir com chave no meio, vão 10
var a = rectPath(0, 0, 10, 10), k = rectPath(50, 0, 60, 10), c = rectPath(100, 0, 110, 10);
doc.pageItems = [a, k, c];
doc.selection = [k];
var r = run({ action: 'setKey', target: 'objects' });
check(r.ok && /objeto/.test(r.message), 'definir chave de objeto', r);
doc.selection = [a, k, c];
r = run({ action: 'distribute', target: 'objects', orientation: 'global', axis: 'u', basis: 'gap', mode: 'spacing', spacing: 10 });
check(r.ok, 'distribuir objetos', r);
check(k.geometricBounds[0] === 50, 'chave parada');
check(a.geometricBounds[2] === 40 && c.geometricBounds[0] === 70, 'vãos de 10 em volta da chave', [a.geometricBounds, c.geometricBounds]);
check(sandbox.app.coordinateSystem === 'AB', 'sistema de coordenadas restaurado');

// --- objetos: alinhar topo à prancheta
r = run({ action: 'align', target: 'objects', orientation: 'global', axis: 'v', edge: 'max', basis: 'bounds', reference: 'artboard' });
check(r.ok && a.geometricBounds[1] === 200 && c.geometricBounds[1] === 200, 'topo na prancheta', r);
check(k.geometricBounds[1] === 10, 'chave não se move no alinhamento');

// --- pontos: alinhar pontos selecionados ao ponto-chave
var S = PathPointSelection.ANCHORPOINT;
var p1 = pathItem([pp(0, 0, S), pp(10, 5), pp(20, 30, S)], false, false);
var p2 = pathItem([pp(40, 12, S), pp(50, 50)], false, false);
doc.pageItems = [p1, p2];
doc.selection = [p2];
p2.pathPoints[0].selected = S;
// só um ponto selecionado para definir a chave
var saved = [p1.pathPoints[0].selected, p1.pathPoints[2].selected];
p1.pathPoints[0].selected = p1.pathPoints[2].selected = PathPointSelection.NOSELECTION;
r = run({ action: 'setKey', target: 'anchors' });
check(r.ok && /ponto de ancoragem 1/.test(r.message), 'chave de ponto', r);
p1.pathPoints[0].selected = saved[0]; p1.pathPoints[2].selected = saved[1];
doc.selection = [p1, p2];
r = run({ action: 'align', target: 'anchors', orientation: 'global', axis: 'v', edge: 'center', basis: 'bounds', reference: 'key' });
check(r.ok, 'alinhar pontos', r);
check(p1.pathPoints[0].anchor[1] === 12 && p1.pathPoints[2].anchor[1] === 12, 'pontos na altura do ponto-chave');
check(p1.pathPoints[1].anchor[1] === 5, 'ponto não selecionado não se move');
check(p2.pathPoints[0].anchor[1] === 12 && p2.pathPoints[0].anchor[0] === 40, 'ponto-chave parado');

// --- segmentos: duas cadeias num caminho aberto, distribuição por centros
var L = PathPointSelection.LEFTDIRECTION, R = PathPointSelection.RIGHTDIRECTION, N = PathPointSelection.NOSELECTION;
var sp = pathItem([pp(0, 0, R), pp(10, 0, L), pp(20, 0, N), pp(30, 0, S), pp(40, 0, S), pp(100, 0, S), pp(110, 0, S)], false, false);
doc.pageItems = [sp]; doc.selection = [sp];
r = run({ action: 'clearKey' });
r = run({ action: 'inspect', target: 'segments', orientation: 'global', axis: 'u', basis: 'bounds' });
check(r.ok && r.gaps.length === 1, 'duas cadeias de segmentos', r);
r = run({ action: 'distribute', target: 'segments', orientation: 'global', axis: 'u', basis: 'gap', mode: 'spacing', spacing: 5 });
check(r.ok, 'distribuir segmentos', r);
// cadeia 1 = pontos 0-1 (0..10); cadeia 2 = pontos 3..6 (30..110) => vai para 15..95
check(sp.pathPoints[3].anchor[0] === 15 && sp.pathPoints[6].anchor[0] === 95, 'cadeia movida inteira', sp.pathPoints.map(function (p) { return p.anchor[0]; }));
check(sp.pathPoints[2].anchor[0] === 20, 'ponto fora das cadeias parado');

// --- orientação pelo segmento-chave: alinhar pontos sobre a linha da chave
var line = pathItem([pp(0, 0, S), pp(100, 100, S)], false, false);
var q = pathItem([pp(0, 50, S), pp(80, 0, S)], false, false);
doc.pageItems = [line, q]; doc.selection = [line];
r = run({ action: 'setKey', target: 'segments' });
check(r.ok, 'chave de segmento', r);
doc.selection = [q];
r = run({ action: 'align', target: 'anchors', orientation: 'key', axis: 'v', edge: 'center', basis: 'bounds', reference: 'key' });
check(r.ok, 'alinhar à linha da chave', r);
q.pathPoints.forEach(function (p) { check(Math.abs(p.anchor[0] - p.anchor[1]) < 1e-9, 'ponto sobre y = x', p.anchor); });


// --- transformar: objeto
var box = rectPath(100, 100, 140, 120);
doc.pageItems = [box]; doc.selection = [box];
r = run({ action: 'read', px: 'min', py: 'max' });
check(r.mode === 'object' && r.w === 40 && r.h === 20 && r.x === 100 && r.y === 120, 'ler objeto', r);
r = run({ action: 'applyObject', field: 'w', value: 80, linked: true, px: 'min', py: 'max' });
check(r.ok && Math.abs(r.state.w - 80) < 1e-9 && Math.abs(r.state.h - 40) < 1e-9, 'largura com proporção', r);
check(Math.abs(r.state.x - 100) < 1e-9 && Math.abs(r.state.y - 120) < 1e-9, 'canto de referência parado', r.state);
r = run({ action: 'applyObject', field: 'rotation', value: 30, px: 'center', py: 'center' });
check(r.ok && Math.abs(r.state.rotation - 30) < 1e-9 && r.state.rotationKnown, 'rotação gravada', r.state);
check(Math.abs(r.state.w - 80) < 1e-6 && Math.abs(r.state.h - 40) < 1e-6, 'dimensões nos eixos do objeto girado', r.state);
r = run({ action: 'applyObject', field: 'w', value: 40, linked: false, px: 'center', py: 'center' });
check(Math.abs(r.state.w - 40) < 1e-6 && Math.abs(r.state.h - 40) < 1e-6, 'escala no eixo do objeto girado', r.state);
r = run({ action: 'applyObject', field: 'x', value: 10, px: 'center', py: 'center' });
check(Math.abs(r.state.x - 10) < 1e-9, 'posição X', r.state);

// --- transformar: ponto
var tri = pathItem([pp(0, 0, PathPointSelection.ANCHORPOINT), pp(10, 0), pp(5, 8)], true);
tri.pathPoints[0].rightDirection = [3, 4];
doc.pageItems = [tri]; doc.selection = [tri];
r = run({ action: 'read' });
check(r.mode === 'point' && r.count === 1 && r.right[0] === 3, 'ler ponto', r);
r = run({ action: 'applyPoint', anchor: [1, 1], left: [1, 1], right: [6, 1] });
check(r.ok && tri.pathPoints[0].rightDirection[0] === 6 && r.state.anchor[0] === 1, 'editar ponto', r);

// --- snap de alças em todos os pontos do objeto
var curve = pathItem([pp(0, 0, S), pp(50, 0, S)], false, false);
curve.pathPoints[0].rightDirection = [9.8, 2];   // ~11.5°
curve.pathPoints[1].leftDirection = [50 - 7, 8]; // ~131°
doc.pageItems = [curve]; doc.selection = [curve];
r = run({ action: 'snapHandles', useAngles: true, angles: [0, 90, 45, 135], sense: false, angleTolerance: 15, useLengths: true, lengths: [10], lengthTolerance: 0, keepSmooth: true });
check(r.ok, 'snap de alças', r);
var h0 = curve.pathPoints[0].rightDirection, h1 = curve.pathPoints[1].leftDirection;
check(Math.abs(h0[1]) < 1e-9 && Math.abs(h0[0] - 10) < 1e-9, 'alça 1 em 0° com 10 pt', h0);
var ang1 = Math.atan2(h1[1], h1[0] - 50) * 180 / Math.PI;
check(Math.abs(ang1 - 135) < 1e-9, 'alça 2 em 135°', ang1);


// --- tipos de alça
var A_ = PathPointSelection.ANCHORPOINT;
var sq = pathItem([pp(10, 0, A_), pp(0, 10, A_), pp(-10, 0, A_), pp(0, -10, A_)], true);
doc.pageItems = [sq]; doc.selection = [sq];
r = run({ action: 'setHandleType', type: 'U' });
check(r.ok && /Automática/.test(r.message), 'aplicar automática', r);
check(Math.abs(sq.pathPoints[0].rightDirection[1] - 5.5228475) < 1e-6, 'automática forma o círculo', sq.pathPoints[0].rightDirection);
check(sq.pathPoints[0].pointType === 'smooth', 'automática vira ponto suave no Illustrator');
// Mover um ponto pelo arranjo recalcula ele e os vizinhos
sq.pathPoints.forEach(function (q, i) { q.selected = i === 1 ? A_ : PathPointSelection.NOSELECTION; });
r = run({ action: 'read' });
check(r.mode === 'point' && r.handleType === 'U', 'ler tipo do ponto', r);
r = run({ action: 'applyPoint', edited: 'anchor', anchor: [0, 20], left: [5.52, 20], right: [-5.52, 20] });
var before = sq.pathPoints[0].rightDirection.slice();
check(Math.abs(sq.pathPoints[0].rightDirection[0] - 10) > 1e-6 || Math.abs(sq.pathPoints[0].rightDirection[1] - 5.5228475) > 1e-6, 'vizinho automático recalculado ao mover a âncora', before);
// Editar a alça de uma automática: vira alinhada e a outra gira junto
r = run({ action: 'applyPoint', edited: 'right', anchor: [0, 20], left: sq.pathPoints[1].leftDirection, right: [-8, 26] });
check(/Alinhada/.test(r.message), 'automática editada vira alinhada', r);
var lft = sq.pathPoints[1].leftDirection;
check(Math.abs((lft[1] - 20) / (lft[0] - 0) - (26 - 20) / (-8 - 0)) < 1e-9 && lft[0] > 0, 'alça oposta alinhada', lft);
// Vetor
sq.pathPoints.forEach(function (q) { q.selected = A_; });
r = run({ action: 'setHandleType', type: 'V' });
check(Math.abs(sq.pathPoints[0].rightDirection[0] - (10 + (0 - 10) / 3)) < 1e-9, 'vetor aponta para o vizinho a 1/3', sq.pathPoints[0].rightDirection);
check(sq.pathPoints[0].pointType === 'corner', 'vetor vira ponto de canto');
// Snap numa vetor a deixa livre
r = run({ action: 'snapHandles', useAngles: true, angles: [0, 90], sense: false, angleTolerance: 0, useLengths: false, lengths: [], keepSmooth: true });
sq.pathPoints.forEach(function (q, i) { q.selected = i === 0 ? A_ : PathPointSelection.NOSELECTION; });
r = run({ action: 'read' });
check(r.handleType === 'F', 'vetor ajustado pelo snap vira livre', r);

// --- erros legíveis
doc.selection = [];
r = run({ action: 'align', target: 'objects', axis: 'u', edge: 'min', reference: 'selection' });
check(!r.ok && /Nada selecionado/.test(r.message), 'erro sem seleção', r);

console.log((n - fails) + ' de ' + n + ' verificações passaram.');
if (fails) { process.exit(1); }
