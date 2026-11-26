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
    return { anchor: [x, y], leftDirection: [x, y], rightDirection: [x, y], selected: sel || PathPointSelection.NOSELECTION };
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

// --- erros legíveis
doc.selection = [];
r = run({ action: 'align', target: 'objects', axis: 'u', edge: 'min', reference: 'selection' });
check(!r.ok && /Nada selecionado/.test(r.message), 'erro sem seleção', r);

console.log((n - fails) + ' de ' + n + ' verificações passaram.');
if (fails) { process.exit(1); }
