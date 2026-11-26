/*
 * Better Item para Illustrator - ponte com o DOM do Illustrator (ExtendScript).
 * Lê a seleção, monta as formas para o núcleo (core.jsx) e aplica os deslocamentos.
 * O painel chama BIH.run({...}) e recebe uma string JSON.
 */
var BIH = (function () {
    var KEY_TAG = 'BetterItemKey';

    // ------------------------------------------------------------ JSON mínimo (ES3)
    function q(s) {
        return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '') + '"';
    }
    function toJSON(v) {
        var i, out, k;
        if (v === null || v === undefined) { return 'null'; }
        if (typeof v === 'number') { return isFinite(v) ? String(v) : 'null'; }
        if (typeof v === 'boolean') { return v ? 'true' : 'false'; }
        if (typeof v === 'string') { return q(v); }
        if (v instanceof Array) {
            out = [];
            for (i = 0; i < v.length; i++) { out.push(toJSON(v[i])); }
            return '[' + out.join(',') + ']';
        }
        out = [];
        for (k in v) { if (v.hasOwnProperty(k)) { out.push(q(k) + ':' + toJSON(v[k])); } }
        return '{' + out.join(',') + '}';
    }

    // ------------------------------------------------------------ geometria do DOM
    function nodeOf(pp) {
        return { a: [pp.anchor[0], pp.anchor[1]], l: [pp.leftDirection[0], pp.leftDirection[1]], r: [pp.rightDirection[0], pp.rightDirection[1]] };
    }
    function contourOf(pi) {
        var nodes = [], i, pts = pi.pathPoints;
        for (i = 0; i < pts.length; i++) { nodes.push(nodeOf(pts[i])); }
        return { nodes: nodes, closed: pi.closed };
    }
    function rectShape(b) { // b = [left, top, right, bottom]
        function n(x, y) { return { a: [x, y], l: [x, y], r: [x, y] }; }
        return { parts: [{ filled: true, contours: [{ closed: true, nodes: [n(b[0], b[3]), n(b[2], b[3]), n(b[2], b[1]), n(b[0], b[1])] }] }] };
    }

    function clippingPathOf(group) {
        var i, it;
        for (i = 0; i < group.pageItems.length; i++) {
            it = group.pageItems[i];
            if (it.typename === 'PathItem' && it.clipping) { return it; }
            if (it.typename === 'CompoundPathItem' && it.pathItems.length > 0 && it.pathItems[0].clipping) { return it; }
        }
        return null;
    }

    function collectParts(item, parts, fast) {
        var i, c, cs, clip, dup, outl;
        if (item.hidden) { return; }
        switch (item.typename) {
        case 'PathItem':
            parts.push({ filled: item.filled || item.clipping, contours: [contourOf(item)] });
            break;
        case 'CompoundPathItem':
            cs = [];
            for (i = 0; i < item.pathItems.length; i++) { cs.push(contourOf(item.pathItems[i])); }
            parts.push({ filled: item.pathItems.length > 0 && (item.pathItems[0].filled || item.pathItems[0].clipping), contours: cs });
            break;
        case 'GroupItem':
            clip = item.clipped ? clippingPathOf(item) : null;
            if (clip) {
                c = [];
                collectParts(clip, c, fast);
                for (i = 0; i < c.length; i++) { c[i].filled = true; parts.push(c[i]); }
            } else {
                for (i = 0; i < item.pageItems.length; i++) { collectParts(item.pageItems[i], parts, fast); }
            }
            break;
        case 'TextFrame':
            // Contornos reais dos glifos: duplica, converte em contornos, lê e descarta.
            if (fast) { parts.push(rectShape(item.geometricBounds).parts[0]); break; }
            try {
                dup = item.duplicate();
                outl = dup.createOutline();
                collectParts(outl, parts);
                outl.remove();
            } catch (e) {
                parts.push(rectShape(item.geometricBounds).parts[0]);
            }
            break;
        default:
            parts.push(rectShape(item.geometricBounds).parts[0]);
        }
    }

    function itemShape(item, fast) {
        var parts = [];
        collectParts(item, parts, fast);
        if (parts.length === 0) { parts.push(rectShape(item.geometricBounds).parts[0]); }
        return { parts: parts };
    }

    // ------------------------------------------------------------ chave
    function keyTagOf(item) {
        var i;
        try {
            for (i = 0; i < item.tags.length; i++) { if (item.tags[i].name === KEY_TAG) { return item.tags[i]; } }
        } catch (e) { }
        return null;
    }

    function findKey(doc) {
        var i, it, t;
        for (i = 0; i < doc.pageItems.length; i++) {
            it = doc.pageItems[i];
            t = keyTagOf(it);
            if (t) { return { item: it, value: t.value }; }
        }
        return null;
    }

    function clearKey(doc) {
        var i, t, n = 0;
        for (i = 0; i < doc.pageItems.length; i++) {
            t = keyTagOf(doc.pageItems[i]);
            if (t) { t.remove(); n++; }
        }
        return n;
    }

    function parseKeyValue(v) { // 'object' | 'anchor:3' | 'segment:2,3,4'
        var p = String(v).split(':'), idx = [], parts, i;
        if (p.length > 1 && p[1] !== '') {
            parts = p[1].split(',');
            for (i = 0; i < parts.length; i++) { idx.push(parseInt(parts[i], 10)); }
        }
        return { type: p[0], indices: idx };
    }

    function chainShape(pi, indices) {
        var nodes = [], i, closed = false;
        for (i = 0; i < indices.length; i++) { nodes.push(nodeOf(pi.pathPoints[indices[i]])); }
        if (pi.closed && indices.length === pi.pathPoints.length && indices.length > 1) { closed = true; }
        return { parts: [{ filled: false, contours: [{ nodes: nodes, closed: closed }] }] };
    }

    function describeKey(k) {
        var kv;
        if (!k) { return null; }
        kv = parseKeyValue(k.value);
        var name = k.item.name ? '"' + k.item.name + '"' : k.item.typename;
        if (kv.type === 'anchor') { return 'ponto de ancoragem ' + (kv.indices[0] + 1) + ' de ' + name; }
        if (kv.type === 'segment') { return 'segmento (' + kv.indices.length + ' pontos) de ' + name; }
        return 'objeto ' + name;
    }

    function keyShape(k) {
        var kv = parseKeyValue(k.value);
        if (kv.type === 'object') { return itemShape(k.item); }
        if (kv.indices.length === 0 || kv.indices[kv.indices.length - 1] >= k.item.pathPoints.length) {
            throw new Error('A chave aponta para pontos que não existem mais. Defina a chave de novo.');
        }
        return chainShape(k.item, kv.indices);
    }

    function keyAngle(k) {
        var kv, pts, a, b;
        if (!k) { throw new Error('A orientação pelo segmento-chave precisa de uma chave.'); }
        kv = parseKeyValue(k.value);
        if (kv.type === 'segment' && kv.indices.length >= 2) {
            a = k.item.pathPoints[kv.indices[0]].anchor; b = k.item.pathPoints[kv.indices[kv.indices.length - 1]].anchor;
            if (kv.indices.length === k.item.pathPoints.length && k.item.closed) {
                b = k.item.pathPoints[kv.indices[1]].anchor;
            }
            return BI.angleOf(a, b);
        }
        if (kv.type === 'object' && k.item.typename === 'PathItem' && k.item.pathPoints.length >= 2) {
            pts = k.item.pathPoints;
            return BI.angleOf(pts[0].anchor, pts[k.item.closed ? 1 : pts.length - 1].anchor);
        }
        throw new Error('Para orientar pela chave, defina como chave um segmento ou uma linha.');
    }

    // ------------------------------------------------------------ seleção
    function collectPaths(items, out) {
        var i, it;
        for (i = 0; i < items.length; i++) {
            it = items[i];
            if (it.typename === 'PathItem') { out.push(it); }
            else if (it.typename === 'CompoundPathItem') { collectPaths(it.pathItems, out); }
            else if (it.typename === 'GroupItem') { collectPaths(it.pageItems, out); }
        }
        return out;
    }

    function sameItem(a, b) {
        if (!a || !b) { return false; }
        try { if (a.uuid !== undefined && b.uuid !== undefined) { return a.uuid === b.uuid; } } catch (e) { }
        return a === b;
    }

    // Segmentos selecionados de um caminho, agrupados em cadeias contíguas de pontos.
    // Suposição a confirmar no Illustrator: um segmento conta como selecionado quando
    // os seus dois pontos têm algum estado de seleção (âncora ou alça).
    function segmentChains(pi) {
        var pts = pi.pathPoints, n = pts.length, sel = [], segs = [], i, chains = [], cur, start, j, NS = PathPointSelection.NOSELECTION;
        for (i = 0; i < n; i++) { sel.push(pts[i].selected !== NS); }
        var m = pi.closed ? n : n - 1;
        for (i = 0; i < m; i++) { segs.push(sel[i] && sel[(i + 1) % n]); }
        if (m <= 0) { return chains; }
        // começa depois de um segmento não selecionado para não partir uma cadeia que dá a volta
        start = 0;
        if (pi.closed) {
            for (i = 0; i < m; i++) { if (!segs[i]) { start = (i + 1) % m; break; } }
            if (i === m) { // todos selecionados: o caminho inteiro
                cur = [];
                for (j = 0; j < n; j++) { cur.push(j); }
                return [cur];
            }
        }
        cur = null;
        for (j = 0; j < m; j++) {
            i = (start + j) % m;
            if (segs[i]) {
                if (!cur) { cur = [i]; }
                cur.push((i + 1) % n);
            } else if (cur) { chains.push(cur); cur = null; }
        }
        if (cur) { chains.push(cur); }
        return chains;
    }

    function sameIndices(a, b) {
        var i;
        if (a.length !== b.length) { return false; }
        for (i = 0; i < a.length; i++) { if (a[i] !== b[i]) { return false; } }
        return true;
    }

    function gatherUnits(doc, target, key) {
        var sel = doc.selection, units = [], i, j, paths, pi, pts, chains, kv = key ? parseKeyValue(key.value) : null;
        if (!sel || sel.length === 0 || sel.typename === 'TextRange') { throw new Error('Nada selecionado.'); }
        if (target === 'objects') {
            for (i = 0; i < sel.length; i++) {
                units.push({ id: 'o' + i, shape: itemShape(sel[i]), isKey: !!(key && kv.type === 'object' && sameItem(sel[i], key.item)),
                             move: { kind: 'object', item: sel[i] } });
            }
            return units;
        }
        paths = collectPaths(sel, []);
        for (i = 0; i < paths.length; i++) {
            pi = paths[i]; pts = pi.pathPoints;
            if (target === 'anchors') {
                for (j = 0; j < pts.length; j++) {
                    if (pts[j].selected === PathPointSelection.ANCHORPOINT) {
                        units.push({ id: 'p' + i + '.' + j, shape: chainShape(pi, [j]),
                                     isKey: !!(key && kv.type === 'anchor' && sameItem(pi, key.item) && kv.indices[0] === j),
                                     move: { kind: 'points', path: pi, indices: [j] } });
                    }
                }
            } else {
                chains = segmentChains(pi);
                for (j = 0; j < chains.length; j++) {
                    units.push({ id: 's' + i + '.' + j, shape: chainShape(pi, chains[j]),
                                 isKey: !!(key && kv.type === 'segment' && sameItem(pi, key.item) && sameIndices(kv.indices, chains[j])),
                                 move: { kind: 'points', path: pi, indices: chains[j] } });
                }
            }
        }
        if (units.length === 0) {
            throw new Error(target === 'anchors'
                ? 'Nenhum ponto de ancoragem selecionado. Use a Seleção Direta (A).'
                : 'Nenhum segmento selecionado. Use a Seleção Direta (A) sobre as linhas.');
        }
        return units;
    }

    // ------------------------------------------------------------ aplicação
    function applyMoves(units, moves) {
        var byId = {}, i, j, u, d, it, p, pp, seen, k, n = 0, worst = 0, b0, b1, err, movedPts = [];
        for (i = 0; i < units.length; i++) { byId[units[i].id] = units[i]; }
        for (i = 0; i < moves.length; i++) {
            u = byId[moves[i].id]; d = moves[i].d;
            if (u.move.kind === 'object') {
                it = u.move.item;
                b0 = it.geometricBounds;
                p = it.position;
                it.position = [p[0] + d[0], p[1] + d[1]];
                b1 = it.geometricBounds;
                err = Math.max(Math.abs(b1[0] - b0[0] - d[0]), Math.abs(b1[1] - b0[1] - d[1]));
                if (err > worst) { worst = err; }
            } else {
                seen = {};
                for (j = 0; j < u.move.indices.length; j++) {
                    k = u.move.indices[j];
                    if (seen[k]) { continue; }
                    seen[k] = true;
                    pp = u.move.path.pathPoints[k];
                    var a = pp.anchor, l = pp.leftDirection, r = pp.rightDirection;
                    pp.anchor = [a[0] + d[0], a[1] + d[1]];
                    pp.leftDirection = [l[0] + d[0], l[1] + d[1]];
                    pp.rightDirection = [r[0] + d[0], r[1] + d[1]];
                    movedPts.push({ path: u.move.path, index: k });
                }
            }
            n++;
        }
        if (movedPts.length) { refreshAfterMove(groupByPath(movedPts)); }
        return { moved: n, residual: worst };
    }


    // ------------------------------------------------------------ tipos de alça
    // Um caractere por ponto, guardado numa etiqueta do caminho: F livre, A alinhada,
    // V vetor, U automática. Sem etiqueta (ou se o número de pontos mudou), o tipo vem
    // do Illustrator: ponto suave = A, de canto = F.
    var TYPE_TAG = 'BIHandleTypes';
    var TYPE_NAME = { F: 'Livre', A: 'Alinhada', V: 'Vetor', U: 'Automática' };

    function typeTag(pi) {
        var i;
        try { for (i = 0; i < pi.tags.length; i++) { if (pi.tags[i].name === TYPE_TAG) { return pi.tags[i]; } } } catch (e) { }
        return null;
    }

    function readTypes(pi) {
        var t = typeTag(pi), n = pi.pathPoints.length, parts, out = '', i, smooth;
        if (t) {
            parts = String(t.value).split(':');
            if (parts.length === 2 && parseInt(parts[0], 10) === n && parts[1].length === n) { return parts[1]; }
        }
        for (i = 0; i < n; i++) {
            smooth = false;
            try { smooth = pi.pathPoints[i].pointType === PointType.SMOOTH; } catch (e2) { }
            out += smooth ? 'A' : 'F';
        }
        return out;
    }

    function writeTypes(pi, types, indices) {
        var t = typeTag(pi), i, k, ch;
        if (!t) { t = pi.tags.add(); t.name = TYPE_TAG; }
        t.value = pi.pathPoints.length + ':' + types;
        for (i = 0; i < indices.length; i++) {
            k = indices[i]; ch = types.charAt(k);
            try { pi.pathPoints[k].pointType = (ch === 'A' || ch === 'U') ? PointType.SMOOTH : PointType.CORNER; } catch (e) { }
        }
    }

    function setChar(str, k, ch) { return str.substring(0, k) + ch + str.substring(k + 1); }

    function pathNodes(pi) { return contourOf(pi).nodes; }

    // Recalcula alças Vetor/Automática nos índices pedidos e grava no caminho.
    function refreshPath(pi, types, indices) {
        var nodes = pathNodes(pi), ch = BI.refreshTypes(nodes, pi.closed, types, indices), i, k;
        for (i = 0; i < ch.length; i++) {
            k = ch[i];
            pi.pathPoints[k].leftDirection = nodes[k].l;
            pi.pathPoints[k].rightDirection = nodes[k].r;
        }
        return ch.length;
    }

    function hasDynamic(types) { return types.indexOf ? (types.indexOf('V') >= 0 || types.indexOf('U') >= 0) : true; }

    // Agrupa [{path, index}] por caminho.
    function groupByPath(targets) {
        var groups = [], i, j, g;
        for (i = 0; i < targets.length; i++) {
            g = null;
            for (j = 0; j < groups.length; j++) { if (groups[j].path === targets[i].path) { g = groups[j]; break; } }
            if (!g) { g = { path: targets[i].path, indices: [] }; groups.push(g); }
            g.indices.push(targets[i].index);
        }
        return groups;
    }

    // Pontos que mudam numa ação de alças: selecionados (Seleção Direta) ou todos do objeto.
    function handleTargets(sel) {
        var s = anchorSelection(sel), targets = [], i, j, pts;
        if (s.partial && s.anchors.length > 0) { return s.anchors; }
        for (i = 0; i < s.paths.length; i++) {
            pts = s.paths[i].pathPoints;
            for (j = 0; j < pts.length; j++) { targets.push({ path: s.paths[i], index: j }); }
        }
        return targets;
    }

    function setHandleType(doc, o) {
        var sel = doc.selection, targets, groups, g, i, j, k, types, pp, nd, cnt = 0;
        if (!sel || sel.length === 0) { throw new Error('Nada selecionado.'); }
        if (!TYPE_NAME[o.type]) { throw new Error('Tipo de alça desconhecido.'); }
        targets = handleTargets(sel);
        if (targets.length === 0) { throw new Error('Nenhum caminho na seleção.'); }
        groups = groupByPath(targets);
        for (i = 0; i < groups.length; i++) {
            g = groups[i]; types = readTypes(g.path);
            for (j = 0; j < g.indices.length; j++) {
                k = g.indices[j];
                types = setChar(types, k, o.type);
                if (o.type === 'A') {
                    pp = g.path.pathPoints[k];
                    nd = BI.alignBoth(nodeOf(pp));
                    pp.leftDirection = nd.l; pp.rightDirection = nd.r;
                }
                cnt++;
            }
            writeTypes(g.path, types, g.indices);
            refreshPath(g.path, types, g.indices);
        }
        return { ok: true, message: 'Tipo ' + TYPE_NAME[o.type] + ' aplicado a ' + cnt + ' ponto(s).' };
    }

    function recalcHandles(doc) {
        var sel = doc.selection, groups, i, n = 0, types;
        if (!sel || sel.length === 0) { throw new Error('Nada selecionado.'); }
        groups = groupByPath(handleTargets(sel));
        for (i = 0; i < groups.length; i++) {
            types = readTypes(groups[i].path);
            n += refreshPath(groups[i].path, types, groups[i].indices);
        }
        return { ok: true, message: n ? 'Alças Vetor e Automática recalculadas em ' + n + ' ponto(s).'
                                      : 'Nenhum ponto Vetor ou Automática na seleção.' };
    }

    // Depois de mover pontos: recalcula os Vetor/Automática movidos e os vizinhos deles.
    function refreshAfterMove(movedByPath) {
        var i, g, types;
        for (i = 0; i < movedByPath.length; i++) {
            g = movedByPath[i]; types = readTypes(g.path);
            if (!hasDynamic(types)) { continue; }
            refreshPath(g.path, types, BI.neighborhood(g.path.pathPoints.length, g.path.closed, g.indices));
        }
    }

    function artboardShape(doc) {
        var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
        return rectShape(ab.artboardRect);
    }


    // ------------------------------------------------------------ transformar
    var ROT_TAG = 'BBAccumRotation'; // rotação acumulada que o Illustrator guarda (radianos)

    function rotationOf(item) {
        var i;
        try {
            for (i = 0; i < item.tags.length; i++) {
                if (item.tags[i].name === ROT_TAG) { return { deg: parseFloat(item.tags[i].value) * 180 / Math.PI, known: true }; }
            }
        } catch (e) { }
        return { deg: 0, known: false };
    }

    function addRotation(item, deltaDeg) {
        var i, t = null, v;
        try {
            for (i = 0; i < item.tags.length; i++) { if (item.tags[i].name === ROT_TAG) { t = item.tags[i]; } }
            if (!t) { t = item.tags.add(); t.name = ROT_TAG; t.value = '0'; }
            v = parseFloat(t.value) + deltaDeg * Math.PI / 180;
            v = Math.atan2(Math.sin(v), Math.cos(v));
            t.value = String(Math.abs(v) < 1e-12 ? 0 : v);
        } catch (e) { }
    }

    // Seleção parcial de pontos? Devolve a lista de pontos selecionados (âncoras) e se é parcial.
    function anchorSelection(sel) {
        var paths = collectPaths(sel, []), i, j, pts, list = [], partial = false, cnt;
        for (i = 0; i < paths.length; i++) {
            pts = paths[i].pathPoints; cnt = 0;
            for (j = 0; j < pts.length; j++) {
                if (pts[j].selected === PathPointSelection.ANCHORPOINT) { list.push({ path: paths[i], index: j }); cnt++; }
            }
            if (cnt > 0 && cnt < pts.length) { partial = true; }
        }
        return { paths: paths, anchors: list, partial: partial };
    }

    function frameBox(items, angle) {
        var fr = BI.frame(angle), lo = [Infinity, Infinity], hi = [-Infinity, -Infinity], i, sh, eu, ev;
        for (i = 0; i < items.length; i++) {
            sh = itemShape(items[i], true);
            eu = BI.extent(sh, fr.u); ev = BI.extent(sh, fr.v);
            if (eu[0] < lo[0]) { lo[0] = eu[0]; } if (eu[1] > hi[0]) { hi[0] = eu[1]; }
            if (ev[0] < lo[1]) { lo[1] = ev[0]; } if (ev[1] > hi[1]) { hi[1] = ev[1]; }
        }
        return { fr: fr, lo: lo, hi: hi, w: hi[0] - lo[0], h: hi[1] - lo[1] };
    }

    function pick(lo, hi, k) { return k === 'min' ? lo : (k === 'max' ? hi : (lo + hi) / 2); }

    function boxPoint(box, px, py) {
        var cu = pick(box.lo[0], box.hi[0], px), cv = pick(box.lo[1], box.hi[1], py);
        return [box.fr.u[0] * cu + box.fr.v[0] * cv, box.fr.u[1] * cu + box.fr.v[1] * cv];
    }

    function readObject(sel, o) {
        var items = [], i, rot, box, p;
        for (i = 0; i < sel.length; i++) { items.push(sel[i]); }
        rot = items.length === 1 ? rotationOf(items[0]) : { deg: 0, known: false };
        box = frameBox(items, rot.deg);
        p = boxPoint(box, o.px || 'center', o.py || 'center');
        return { mode: 'object', count: items.length, x: p[0], y: p[1], w: box.w, h: box.h,
                 rotation: rot.deg, rotationKnown: rot.known, single: items.length === 1 };
    }

    function moveItem(item, d) {
        var p = item.position;
        item.position = [p[0] + d[0], p[1] + d[1]];
    }

    function itemCenter(item, angle) {
        var b = frameBox([item], angle);
        return boxPoint(b, 'center', 'center');
    }

    function applyObject(sel, o) {
        var items = [], i, rot, theta, box, P0, it, c0, c1, target, sx, sy, d, rel, delta;
        for (i = 0; i < sel.length; i++) { items.push(sel[i]); }
        rot = items.length === 1 ? rotationOf(items[0]) : { deg: 0, known: false };
        theta = rot.deg;
        box = frameBox(items, theta);
        P0 = boxPoint(box, o.px || 'center', o.py || 'center');

        if (o.field === 'x' || o.field === 'y') {
            d = [o.field === 'x' ? o.value - P0[0] : 0, o.field === 'y' ? o.value - P0[1] : 0];
            for (i = 0; i < items.length; i++) { moveItem(items[i], d); }
            return 'Posição aplicada.';
        }
        if (o.field === 'w' || o.field === 'h') {
            if (!(o.value > 0)) { throw new Error('A dimensão precisa ser maior que zero.'); }
            sx = 1; sy = 1;
            if (o.field === 'w' || o.linked) {
                if (box.w < 1e-9) { throw new Error('A largura atual é zero e não pode ser escalada.'); }
                sx = (o.field === 'w' ? o.value : o.value * box.w / box.h) / box.w;
            }
            if (o.field === 'h' || o.linked) {
                if (box.h < 1e-9) { throw new Error('A altura atual é zero e não pode ser escalada.'); }
                sy = (o.field === 'h' ? o.value : o.value * box.h / box.w) / box.h;
            }
            if (o.linked) { if (o.field === 'w') { sy = sx; } else { sx = sy; } }
            for (i = 0; i < items.length; i++) {
                it = items[i];
                c0 = itemCenter(it, theta);
                // escala nos eixos do quadro: desfaz a rotação, escala, refaz
                if (Math.abs(theta) > 1e-9) { it.rotate(-theta, true, true, true, true, Transformation.CENTER); }
                it.resize(sx * 100, sy * 100, true, true, true, true, 100, Transformation.CENTER);
                if (Math.abs(theta) > 1e-9) { it.rotate(theta, true, true, true, true, Transformation.CENTER); }
                c1 = itemCenter(it, theta);
                rel = BI.rotateVec([c0[0] - P0[0], c0[1] - P0[1]], -theta);
                rel = BI.rotateVec([rel[0] * sx, rel[1] * sy], theta);
                target = [P0[0] + rel[0], P0[1] + rel[1]];
                moveItem(it, [target[0] - c1[0], target[1] - c1[1]]);
            }
            return 'Dimensões aplicadas.';
        }
        if (o.field === 'rotation') {
            delta = o.value - theta;
            if (Math.abs(delta) < 1e-9) { return 'Rotação sem mudança.'; }
            for (i = 0; i < items.length; i++) {
                it = items[i];
                c0 = itemCenter(it, theta);
                it.rotate(delta, true, true, true, true, Transformation.CENTER);
                c1 = itemCenter(it, theta + delta);
                rel = BI.rotateVec([c0[0] - P0[0], c0[1] - P0[1]], delta);
                moveItem(it, [P0[0] + rel[0] - c1[0], P0[1] + rel[1] - c1[1]]);
                addRotation(it, delta);
            }
            return 'Rotação aplicada.';
        }
        throw new Error('Campo desconhecido.');
    }

    function readPoint(sel) {
        var s = anchorSelection(sel), first, pp;
        if (s.anchors.length === 0) { return null; }
        first = s.anchors[0]; pp = first.path.pathPoints[first.index];
        var groups = groupByPath(s.anchors), i, j, ty, kind = null;
        for (i = 0; i < groups.length && kind !== 'mixed'; i++) {
            ty = readTypes(groups[i].path);
            for (j = 0; j < groups[i].indices.length; j++) {
                var c = ty.charAt(groups[i].indices[j]);
                if (kind === null) { kind = c; } else if (kind !== c) { kind = 'mixed'; break; }
            }
        }
        return { mode: 'point', count: s.anchors.length, anchor: [pp.anchor[0], pp.anchor[1]],
                 left: [pp.leftDirection[0], pp.leftDirection[1]], right: [pp.rightDirection[0], pp.rightDirection[1]],
                 handleType: kind };
    }

    function applyPoint(sel, o) {
        var s = anchorSelection(sel), pp;
        if (s.anchors.length !== 1) { throw new Error('Selecione um único ponto de ancoragem para editar.'); }
        var pi = s.anchors[0].path, k = s.anchors[0].index, types = readTypes(pi), t = types.charAt(k), nt = t;
        var left = o.left, right = o.right, msg = 'Ponto atualizado.';
        pp = pi.pathPoints[k];
        if (o.edited === 'left' || o.edited === 'right') {
            if (t === 'A' || t === 'U') {
                if (o.edited === 'left') { right = BI.alignOpposite(o.anchor, left, right); }
                else { left = BI.alignOpposite(o.anchor, right, left); }
                if (t === 'U') { nt = 'A'; }
            } else if (t === 'V') { nt = 'F'; }
        }
        pp.anchor = o.anchor; pp.leftDirection = left; pp.rightDirection = right;
        if (nt !== t) {
            types = setChar(types, k, nt);
            writeTypes(pi, types, [k]);
            msg = 'Ponto atualizado; a alça virou ' + TYPE_NAME[nt] + '.';
        }
        if (o.edited === 'anchor' && hasDynamic(types)) {
            refreshPath(pi, types, BI.neighborhood(pi.pathPoints.length, pi.closed, [k]));
        }
        return msg;
    }

    function readTransform(doc, o) {
        var sel = doc.selection, ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect, res, s;
        if (!sel || sel.length === 0 || sel.typename === 'TextRange') { return { ok: true, mode: 'none', artboard: ab }; }
        s = anchorSelection(sel);
        res = (s.partial && s.anchors.length > 0) ? readPoint(sel) : readObject(sel, o);
        res.ok = true; res.artboard = ab;
        return res;
    }

    function snapHandles(doc, o) {
        var sel = doc.selection, s, i, j, targets = [], pts, nd, r, nA = 0, nL = 0, nPts = 0, demoted = [];
        if (!sel || sel.length === 0) { throw new Error('Nada selecionado.'); }
        s = anchorSelection(sel);
        if (s.partial && s.anchors.length > 0) {
            targets = s.anchors;
        } else {
            for (i = 0; i < s.paths.length; i++) {
                pts = s.paths[i].pathPoints;
                for (j = 0; j < pts.length; j++) { targets.push({ path: s.paths[i], index: j }); }
            }
        }
        if (targets.length === 0) { throw new Error('Nenhum caminho na seleção.'); }
        for (i = 0; i < targets.length; i++) {
            pts = targets[i].path.pathPoints;
            nd = nodeOf(pts[targets[i].index]);
            r = BI.snapNode(nd, { angles: o.useAngles ? o.angles : [], sense: o.sense, angleTolerance: o.angleTolerance,
                                  lengths: o.useLengths ? o.lengths : [], lengthTolerance: o.lengthTolerance, keepSmooth: o.keepSmooth });
            if (r.angles || r.lengths) {
                pts[targets[i].index].leftDirection = r.node.l;
                pts[targets[i].index].rightDirection = r.node.r;
                nA += r.angles; nL += r.lengths; nPts++;
                demoted.push(targets[i]);
            }
        }
        // Como no Blender: mexer numa Automática a deixa Alinhada; numa Vetor, Livre.
        var dg = groupByPath(demoted), gi, gj, ty, ch, idx, changed;
        for (gi = 0; gi < dg.length; gi++) {
            ty = readTypes(dg[gi].path); changed = [];
            for (gj = 0; gj < dg[gi].indices.length; gj++) {
                idx = dg[gi].indices[gj]; ch = ty.charAt(idx);
                if (ch === 'U') { ty = setChar(ty, idx, 'A'); changed.push(idx); }
                else if (ch === 'V') { ty = setChar(ty, idx, 'F'); changed.push(idx); }
            }
            if (changed.length) { writeTypes(dg[gi].path, ty, changed); }
        }
        return { ok: true, message: 'Alças ajustadas em ' + nPts + ' de ' + targets.length + ' ponto(s): ' +
                 (o.useAngles ? nA + ' por ângulo' : 'ângulos desligados') + ', ' +
                 (o.useLengths ? nL + ' por magnitude' : 'magnitudes desligadas') + '.' +
                 (nPts === 0 ? ' As alças já estavam nos valores da lista (alças recolhidas não mudam).' : '') };
    }

    // ------------------------------------------------------------ ações
    var WHAT = { objects: 'objeto(s)', anchors: 'ponto(s)', segments: 'segmento(s)' };

    function setKey(doc, target) {
        var sel = doc.selection, paths, i, j, pi, pts, picked = null, count = 0, chains, t;
        if (!sel || sel.length === 0) { throw new Error('Selecione o item que será a chave.'); }
        if (target === 'objects') {
            if (sel.length !== 1) { throw new Error('Selecione só um objeto para ser a chave.'); }
            picked = { item: sel[0], value: 'object' };
        } else {
            paths = collectPaths(sel, []);
            for (i = 0; i < paths.length; i++) {
                pi = paths[i]; pts = pi.pathPoints;
                if (target === 'anchors') {
                    for (j = 0; j < pts.length; j++) {
                        if (pts[j].selected === PathPointSelection.ANCHORPOINT) { count++; picked = { item: pi, value: 'anchor:' + j }; }
                    }
                } else {
                    chains = segmentChains(pi);
                    for (j = 0; j < chains.length; j++) { count++; picked = { item: pi, value: 'segment:' + chains[j].join(',') }; }
                }
            }
            if (count !== 1) {
                throw new Error(target === 'anchors' ? 'Selecione exatamente um ponto de ancoragem para ser a chave.'
                                                     : 'Selecione exatamente um segmento (ou uma cadeia contínua) para ser a chave.');
            }
        }
        clearKey(doc);
        t = picked.item.tags.add();
        t.name = KEY_TAG;
        t.value = picked.value;
        return { ok: true, key: describeKey(picked), message: 'Chave definida: ' + describeKey(picked) + '.' };
    }

    function resolveAngle(o, key) {
        if (o.orientation === 'key') { return keyAngle(key); }
        if (o.orientation === 'angle') { return Number(o.angle) || 0; }
        return 0;
    }

    function run(o) {
        var doc, prevCS, res, key, units, ctx, angle, moves, ap, plan, ins;
        if (app.documents.length === 0) { return toJSON({ ok: false, message: 'Abra um documento primeiro.' }); }
        doc = app.activeDocument;
        prevCS = app.coordinateSystem;
        try {
            app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
            if (o.action === 'setKey') { return toJSON(setKey(doc, o.target)); }
            key = findKey(doc);
            if (o.action === 'clearKey') { clearKey(doc); return toJSON({ ok: true, key: null, message: 'Chave removida.' }); }
            if (o.action === 'keyInfo') { return toJSON({ ok: true, key: describeKey(key) }); }
            if (o.action === 'read') { return toJSON(readTransform(doc, o)); }
            if (o.action === 'snapHandles') { return toJSON(snapHandles(doc, o)); }
            if (o.action === 'setHandleType') { return toJSON(setHandleType(doc, o)); }
            if (o.action === 'recalcHandles') { return toJSON(recalcHandles(doc)); }
            if (o.action === 'applyObject' || o.action === 'applyPoint') {
                if (!doc.selection || doc.selection.length === 0) { throw new Error('Nada selecionado.'); }
                res = { ok: true, message: o.action === 'applyObject' ? applyObject(doc.selection, o) : applyPoint(doc.selection, o) };
                res.state = readTransform(doc, o);
                return toJSON(res);
            }

            angle = resolveAngle(o, key);
            units = gatherUnits(doc, o.target, key);
            ctx = { artboard: artboardShape(doc), key: key ? keyShape(key) : null };

            if (o.action === 'align') {
                moves = BI.planAlign(units, { angle: angle, axis: o.axis, edge: o.edge, basis: o.basis, reference: o.reference }, ctx);
                ap = applyMoves(units, moves);
                res = { ok: true, message: 'Alinhado: ' + ap.moved + ' ' + WHAT[o.target] + ' movido(s).' };
            } else if (o.action === 'distribute') {
                plan = BI.planDistribute(units, { angle: angle, axis: o.axis, basis: o.basis, mode: o.mode,
                                                  spacing: Number(o.spacing), ends: o.ends, tolerance: o.tolerance }, ctx);
                ap = applyMoves(units, plan.moves);
                res = { ok: true, target: plan.target,
                        message: 'Distribuído: ' + ap.moved + ' ' + WHAT[o.target] + ' movido(s).' +
                                 (plan.fallback ? ' ' + plan.fallback + ' par(es) sem contato possível nessa direção usaram os limites.' : '') };
            } else if (o.action === 'inspect') {
                ins = BI.inspect(units, { angle: angle, axis: o.axis, basis: o.basis, tolerance: o.tolerance });
                res = { ok: true, gaps: ins.gaps, uniform: ins.uniform, min: ins.min, max: ins.max, fallback: ins.fallback };
            } else {
                res = { ok: false, message: 'Ação desconhecida.' };
            }
            if (ap && ap.residual > 0.01) {
                res.message += ' Atenção: diferença de ' + ap.residual.toFixed(3) + ' pt na verificação da posição.';
            }
            if (key) { res.key = describeKey(key); }
            return toJSON(res);
        } catch (e) {
            return toJSON({ ok: false, message: e.message || String(e) });
        } finally {
            app.coordinateSystem = prevCS;
        }
    }

    return { run: run, toJSON: toJSON };
}());
