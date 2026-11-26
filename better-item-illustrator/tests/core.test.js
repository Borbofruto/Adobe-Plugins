// Testes do núcleo geométrico. Rode com: node tests/core.test.js
var BI = require('../host/core.jsx');
var failures = 0, count = 0;

function near(a, b, tol, msg) {
    count++;
    if (Math.abs(a - b) > tol) { failures++; console.log('FALHOU: ' + msg + ' (obtido ' + a + ', esperado ' + b + ')'); }
}
function ok(c, msg) { count++; if (!c) { failures++; console.log('FALHOU: ' + msg); } }
function throws(fn, msg) { count++; try { fn(); failures++; console.log('FALHOU (não lançou): ' + msg); } catch (e) { } }

function node(x, y) { return { a: [x, y], l: [x, y], r: [x, y] }; }
function rect(x0, y0, x1, y1) {
    return { parts: [{ filled: true, contours: [{ closed: true, nodes: [node(x0, y0), node(x1, y0), node(x1, y1), node(x0, y1)] }] }] };
}
// Círculo com 4 cúbicas (aproximação padrão do Illustrator, k = 0.5523)
function circleContour(cx, cy, r, reverse) {
    var k = 0.5522847498 * r;
    var n = [
        { a: [cx + r, cy], l: [cx + r, cy - k], r: [cx + r, cy + k] },
        { a: [cx, cy + r], l: [cx + k, cy + r], r: [cx - k, cy + r] },
        { a: [cx - r, cy], l: [cx - r, cy + k], r: [cx - r, cy - k] },
        { a: [cx, cy - r], l: [cx - k, cy - r], r: [cx + k, cy - r] }
    ];
    if (reverse) {
        n.reverse();
        n = n.map(function (q) { return { a: q.a, l: q.r, r: q.l }; });
    }
    return { closed: true, nodes: n };
}
function circle(cx, cy, r) { return { parts: [{ filled: true, contours: [circleContour(cx, cy, r)] }] }; }
function u(id, shape, isKey) { return { id: id, shape: shape, isKey: !!isKey }; }
function apply(units, moves) {
    var map = {};
    moves.forEach(function (m) { map[m.id] = m.d; });
    return units.map(function (x) { return u(x.id, map[x.id] ? BI.translateShape(x.shape, map[x.id]) : x.shape, x.isKey); });
}

// --- extensão e centro de massa
var c = circle(10, 20, 5);
var ex = BI.extent(c, [1, 0]);
near(ex[0], 5, 1e-9, 'extensão do círculo em X (min)');
near(ex[1], 15, 1e-9, 'extensão do círculo em X (max)');
var ed = BI.extent(c, [Math.SQRT1_2, Math.SQRT1_2]);
near(ed[1] - ed[0], 10, 0.01, 'extensão do círculo na diagonal');
var mc = BI.massCenter(c);
near(mc.point[0], 10, 1e-9, 'centro de massa do círculo X');
near(mc.point[1], 20, 1e-9, 'centro de massa do círculo Y');
near(mc.area, Math.PI * 25, 0.05, 'área do círculo aproximado');

// Forma em L: centroide conhecido. L = [0,2]x[0,1] ∪ [0,1]x[1,2] => área 3, cx = cy = 5/6
var L = { parts: [{ filled: true, contours: [{ closed: true, nodes: [node(0, 0), node(2, 0), node(2, 1), node(1, 1), node(1, 2), node(0, 2)] }] }] };
var mL = BI.massCenter(L);
near(mL.point[0], 5 / 6, 1e-12, 'centroide do L (x)');
near(mL.point[1], 5 / 6, 1e-12, 'centroide do L (y)');
near(BI.boundsCenter(L, BI.frame(0))[0], 1, 1e-12, 'centro dos limites do L difere do centro de massa');

// Quadrado com furo (caminho composto), mesma direção dos dois contornos: par-ímpar
var holed = { parts: [{ filled: true, contours: [
    { closed: true, nodes: [node(0, 0), node(10, 0), node(10, 10), node(0, 10)] },
    { closed: true, nodes: [node(5, 2), node(9, 2), node(9, 8), node(5, 8)] }
] }] };
var mh = BI.massCenter(holed);
// área 100 - 24 = 76; Mx = 100*5 - 24*7 = 332
near(mh.area, 76, 1e-9, 'área do quadrado com furo');
near(mh.point[0], 332 / 76, 1e-9, 'centroide do quadrado com furo (x)');
// Mesmo com o furo em direção oposta
var holedRev = JSON.parse(JSON.stringify(holed));
holedRev.parts[0].contours[1].nodes.reverse();
near(BI.massCenter(holedRev).point[0], 332 / 76, 1e-9, 'furo em sentido oposto dá o mesmo centroide');

// Linha aberta sem preenchimento: centroide do traço
var line = { parts: [{ filled: false, contours: [{ closed: false, nodes: [node(0, 0), node(4, 0), node(4, 2)] }] }] };
var ml = BI.massCenter(line);
ok(ml.source === 'line', 'traço aberto usa centroide de linha');
near(ml.point[0], (4 * 2 + 2 * 4) / 6, 1e-9, 'centroide do traço (x)');

// --- contato real
// Dois círculos r=5, centros (0,0) e (20,6). Ao avançar A em +X, toque quando a distância
// entre centros = 10: dx = sqrt(100 - 36) = 8 => vão = 20 - 8 = 12. Pelos limites, o vão seria 10.
var A = circle(0, 0, 5), B = circle(20, 6, 5);
near(BI.contactGap(A, B, [1, 0], 0.005), 12, 0.02, 'vão de contato entre círculos deslocados');
// Sem sobreposição perpendicular, não há contato: null
ok(BI.contactGap(circle(0, 0, 5), circle(20, 30, 5), [1, 0]) === null, 'sem contato possível devolve null');
// Retângulos: contato = vão entre limites
near(BI.contactGap(rect(0, 0, 10, 10), rect(15, 5, 25, 20), [1, 0]), 5, 1e-9, 'contato entre retângulos');
// Já sobrepostos: negativo
near(BI.contactGap(rect(0, 0, 10, 10), rect(8, 0, 18, 10), [1, 0]), -2, 1e-9, 'sobreposição dá vão negativo');
// Triângulo apontando para um quadrado: o vértice toca primeiro
var tri = { parts: [{ filled: true, contours: [{ closed: true, nodes: [node(0, 0), node(10, 5), node(0, 10)] }] }] };
near(BI.contactGap(tri, rect(13, -5, 20, 15), [1, 0]), 3, 1e-9, 'ponta do triângulo até o quadrado');
near(BI.contactGap(tri, rect(13, 8, 20, 15), [1, 0]), 13 - 4, 1e-9, 'aresta inclinada do triângulo até o quadrado');

// --- distribuição até contato
var units = [u('a', circle(0, 0, 5)), u('b', circle(30, 6, 5)), u('c', circle(70, -6, 5))];
var plan = BI.planDistribute(units, { axis: 'u', basis: 'contact', mode: 'spacing', spacing: 0, tolerance: 0.005 });
var after = apply(units, plan.moves);
var ins = BI.inspect(after, { axis: 'u', basis: 'contact', tolerance: 0.005 });
near(ins.gaps[0], 0, 0.02, 'contato 0 entre a e b');
near(ins.gaps[1], 0, 0.02, 'contato 0 entre b e c');
ok(!plan.moves.some(function (m) { return m.id === 'a'; }), 'o primeiro item fica parado');

// Entre extremos por contato: vãos iguais e pontas paradas
plan = BI.planDistribute(units, { axis: 'u', basis: 'contact', mode: 'between', tolerance: 0.005 });
after = apply(units, plan.moves);
ins = BI.inspect(after, { axis: 'u', basis: 'contact', tolerance: 0.005 });
near(ins.gaps[0], ins.gaps[1], 0.03, 'vãos de contato iguais entre extremos');
ok(plan.moves.length === 1 && plan.moves[0].id === 'b', 'só o item do meio se move');

// Espaçamento fixo com objeto-chave no meio: a chave fica parada
units = [u('a', rect(0, 0, 10, 10)), u('k', rect(40, 0, 50, 10), true), u('c', rect(100, 0, 110, 10))];
plan = BI.planDistribute(units, { axis: 'u', basis: 'gap', mode: 'spacing', spacing: 5 });
ok(!plan.moves.some(function (m) { return m.id === 'k'; }), 'chave não se move na distribuição');
after = apply(units, plan.moves);
ins = BI.inspect(after, { axis: 'u', basis: 'gap' });
near(ins.gaps[0], 5, 1e-9, 'vão 5 antes da chave');
near(ins.gaps[1], 5, 1e-9, 'vão 5 depois da chave');

// Distribuição por centro de massa: formas em L com intervalos iguais de centroide
units = [u('a', L), u('b', BI.translateShape(L, [7, 0])), u('c', BI.translateShape(L, [10, 0]))];
plan = BI.planDistribute(units, { axis: 'u', basis: 'mass', mode: 'between' });
after = apply(units, plan.moves);
ins = BI.inspect(after, { axis: 'u', basis: 'mass' });
near(ins.gaps[0], 5, 1e-9, 'centros de massa igualmente espaçados');
ok(ins.uniform, 'inspeção marca espaçamento uniforme');

// Entre extremos da prancheta (vãos de limites)
var ab = rect(0, 0, 100, 50);
units = [u('a', rect(10, 0, 20, 10)), u('b', rect(30, 0, 40, 10)), u('c', rect(50, 0, 60, 10))];
plan = BI.planDistribute(units, { axis: 'u', basis: 'gap', mode: 'between', ends: 'artboard' }, { artboard: ab });
after = apply(units, plan.moves);
near(BI.extent(after[0].shape, [1, 0])[0], 0, 1e-9, 'primeiro encosta na borda da prancheta');
near(BI.extent(after[2].shape, [1, 0])[1], 100, 1e-9, 'último encosta na outra borda');
ins = BI.inspect(after, { axis: 'u', basis: 'gap' });
near(ins.gaps[0], 35, 1e-9, 'vãos iguais na prancheta');

// Direção girada (45°): distribuição ao longo da diagonal
units = [u('a', circle(0, 0, 1)), u('b', circle(3, 3, 1)), u('c', circle(10, 10, 1))];
plan = BI.planDistribute(units, { angle: 45, axis: 'u', basis: 'bounds', mode: 'spacing', spacing: 2 });
after = apply(units, plan.moves);
var cB = BI.massCenter(after[1].shape).point, cC = BI.massCenter(after[2].shape).point;
near(cB[0], Math.SQRT2, 1e-9, 'diagonal: b a 2 pt de a');
near(cC[1], 2 * Math.SQRT2, 1e-9, 'diagonal: c a 4 pt de a');

// Empate na ordem é recusado
throws(function () {
    BI.planDistribute([u('a', rect(0, 0, 10, 10)), u('b', rect(0, 20, 10, 30))], { axis: 'u', basis: 'bounds', mode: 'spacing', spacing: 5 });
}, 'itens na mesma posição recusados');

// --- alinhamento
units = [u('a', rect(0, 0, 10, 10)), u('b', rect(20, 5, 40, 30)), u('k', rect(50, -10, 60, 0), true)];
var al = BI.planAlign(units, { axis: 'v', edge: 'max', basis: 'bounds', reference: 'selection' });
after = apply(units, al);
near(BI.extent(after[0].shape, [0, 1])[1], 30, 1e-9, 'alinhar topo à seleção');
al = BI.planAlign(units, { axis: 'u', edge: 'min', basis: 'bounds', reference: 'key' }, { key: units[2].shape });
after = apply(units, al);
near(BI.extent(after[1].shape, [1, 0])[0], 50, 1e-9, 'alinhar à esquerda da chave');
ok(!al.some(function (m) { return m.id === 'k'; }), 'chave não se move no alinhamento');
al = BI.planAlign(units, { axis: 'u', edge: 'center', basis: 'bounds', reference: 'artboard' }, { artboard: ab });
after = apply(units, al);
near(BI.boundsCenter(after[0].shape, BI.frame(0))[0], 50, 1e-9, 'centralizar na prancheta');
// Alinhar pontos (vértices) numa linha girada: projeção perpendicular
var pts = [u('p1', { parts: [{ filled: false, contours: [{ closed: false, nodes: [node(0, 3)] }] }] }),
           u('p2', { parts: [{ filled: false, contours: [{ closed: false, nodes: [node(5, -1)] }] }] })];
al = BI.planAlign(pts, { angle: 30, axis: 'v', edge: 'center', basis: 'bounds', reference: 'key' },
    { key: { parts: [{ filled: false, contours: [{ closed: false, nodes: [node(0, 0), node(Math.cos(Math.PI / 6), Math.sin(Math.PI / 6))] }] }] } });
after = apply(pts, al);
var p1 = after[0].shape.parts[0].contours[0].nodes[0].a;
near(p1[1], Math.tan(Math.PI / 6) * p1[0], 1e-9, 'ponto projetado sobre a linha do segmento-chave');
// Alinhar por centro de massa
al = BI.planAlign([u('L', L), u('r', rect(10, 0, 12, 2))], { axis: 'u', basis: 'mass', reference: 'key' }, { key: rect(20, 0, 22, 2) });
after = apply([u('L', L)], al);
near(BI.massCenter(after[0].shape).point[0], 21, 1e-9, 'centro de massa do L alinhado ao da chave');

// --- snap de ângulo e magnitude das alças
var LIST = [0, 90, 45, 60, 30];
near(BI.snapAngle(50, LIST).angle, 45, 1e-9, '50° vai para 45°');
near(BI.snapAngle(52.5, LIST).angle, 45, 1e-9, 'empate 45/60 fica com 45 (prioridade)');
near(BI.snapAngle(37.5, [30, 45]).angle, 30, 1e-9, 'empate 30/45 fica com o primeiro da lista');
near(BI.snapAngle(37.5, [45, 30]).angle, 45, 1e-9, 'trocar a ordem troca o desempate');
near(BI.snapAngle(178, LIST).angle, 180, 1e-9, 'direção: 178° vira 180° (equivale a 0°)');
near(BI.snapAngle(-88, LIST).angle, -90, 1e-9, 'direção: -88° vira -90°');
near(BI.snapAngle(178, [0, 90], { sense: true }).angle, 90, 1e-9, 'com sentido: 178° vai para 90°, não 180°');
ok(BI.snapAngle(20, [0, 90], { tolerance: 15 }) === null, 'fora da tolerância não ajusta');
near(BI.snapLength(11, [10, 12]).length, 10, 1e-9, 'empate de magnitude fica com o primeiro');
near(BI.snapLength(11.4, [10, 12]).length, 12, 1e-9, 'magnitude mais próxima');
ok(BI.snapLength(30, [10, 12], { tolerance: 5 }) === null, 'magnitude fora da tolerância');

function hnode(a, l, r) { return { a: a, l: l, r: r }; }
// Ponto de canto: cada alça vai para o seu ângulo
var corner = BI.snapNode(hnode([0, 0], [10 * Math.cos(Math.PI * 92 / 180), 10 * Math.sin(Math.PI * 92 / 180)], [10 * Math.cos(Math.PI * 3 / 180), 10 * Math.sin(Math.PI * 3 / 180)]), { angles: LIST });
near(BI.handleVector([0, 0], corner.node.l).angle, 90, 1e-9, 'canto: alça de entrada a 90°');
near(BI.handleVector([0, 0], corner.node.r).angle, 0, 1e-9, 'canto: alça de saída a 0°');
near(BI.handleVector([0, 0], corner.node.r).length, 10, 1e-9, 'ângulo preserva a magnitude');
// Ponto suave: as duas giram juntas e continuam colineares
var sm = BI.snapNode(hnode([5, 5], BI.handleFromVector([5, 5], 20, 222), BI.handleFromVector([5, 5], 8, 42)), { angles: LIST });
var vin = BI.handleVector([5, 5], sm.node.l), vout = BI.handleVector([5, 5], sm.node.r);
near(vout.angle, 45, 1e-9, 'suave: saída a 45°');
near(vin.angle, -135, 1e-9, 'suave: entrada continua oposta');
near(vin.length, 20, 1e-9, 'suave: comprimentos preservados');
// Sem manter suavidade, cada alça vai sozinha
sm = BI.snapNode(hnode([0, 0], BI.handleFromVector([0, 0], 10, 190), BI.handleFromVector([0, 0], 10, 2)), { angles: [0, 45], keepSmooth: false });
near(Math.abs(BI.handleVector([0, 0], sm.node.l).angle), 180, 1e-9, 'livre: entrada a 180°');
// Magnitude
var ml2 = BI.snapNode(hnode([0, 0], [-9, 0], [0, 23]), { lengths: [10, 20, 25] });
near(BI.handleVector([0, 0], ml2.node.l).length, 10, 1e-9, 'magnitude de entrada para 10');
near(BI.handleVector([0, 0], ml2.node.r).length, 25, 1e-9, 'magnitude de saída para 25');
near(BI.handleVector([0, 0], ml2.node.r).angle, 90, 1e-9, 'magnitude preserva o ângulo');
ok(ml2.lengths === 2 && ml2.angles === 0, 'contagem de alças alteradas');
// Alça recolhida não muda
var rc = BI.snapNode(hnode([3, 3], [3, 3], [10, 4]), { angles: [0], lengths: [5] });
ok(rc.node.l[0] === 3 && rc.node.l[1] === 3, 'alça recolhida fica recolhida');

// --- tipos de alça
var vh = BI.vectorHandles([0, 0], [9, 0], [9, 12]);
near(vh.l[0], 6, 1e-12, 'vetor: entrada a 1/3 do vizinho anterior');
near(vh.r[1], 4, 1e-12, 'vetor: saída a 1/3 do próximo');
// Quatro pontos automáticos num círculo de raio 10 => alça 0,5523*10 tangente
var cn = [[10, 0], [0, 10], [-10, 0], [0, -10]].map(function (q) { return { a: q, l: q, r: q }; });
BI.refreshTypes(cn, true, 'UUUU', [0, 1, 2, 3]);
near(cn[0].r[0], 10, 1e-9, 'auto: tangente vertical no ponto (10,0)');
near(cn[0].r[1], 5.5228475, 1e-6, 'auto: comprimento do círculo de Bézier');
near(cn[0].l[1], -5.5228475, 1e-6, 'auto: alça oposta simétrica');
var circ = { parts: [{ filled: true, contours: [{ closed: true, nodes: cn }] }] };
near(BI.massCenter(circ).area, Math.PI * 100, 0.6, 'auto: área de um círculo');
// Pontos colineares: alças retas com 1/3
var ln = [[0, 0], [3, 0], [9, 0]].map(function (q) { return { a: q, l: q, r: q }; });
BI.refreshTypes(ln, false, 'UUU', [1]);
near(ln[1].l[0], 2, 1e-9, 'auto colinear: entrada 1/3');
near(ln[1].r[0], 5, 1e-9, 'auto colinear: saída 1/3');
// Só V e U mudam
var fr2 = [{ a: [0, 0], l: [1, 1], r: [2, 2] }, { a: [5, 0], l: [5, 0], r: [5, 0] }];
var ch = BI.refreshTypes(fr2, false, 'FA', [0, 1]);
ok(ch.length === 0 && fr2[0].l[0] === 1, 'livre e alinhada não são recalculadas');
// Alinhar oposta
var op = BI.alignOpposite([0, 0], [0, 5], [3, 0]);
near(op[0], 0, 1e-12, 'alinhada: x da oposta'); near(op[1], -3, 1e-12, 'alinhada: oposta mantém o comprimento');
var ab2 = BI.alignBoth({ a: [0, 0], l: [-4, 1], r: [6, 1] });
var vl = BI.handleVector([0, 0], ab2.l), vr = BI.handleVector([0, 0], ab2.r);
near(Math.abs(((vl.angle - vr.angle) % 360 + 360) % 360 - 180), 0, 1e-9, 'converter para alinhada deixa colinear');
near(vr.length, Math.sqrt(37), 1e-9, 'converter para alinhada preserva comprimentos');
var nb = BI.neighborhood(4, true, [0]).sort();
ok(nb.join(',') === '0,1,3', 'vizinhança em caminho fechado');

console.log((count - failures) + ' de ' + count + ' verificações passaram.');
if (failures) { process.exit(1); }
