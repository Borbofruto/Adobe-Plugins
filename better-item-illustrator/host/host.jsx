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

    function collectParts(item, parts) {
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
                collectParts(clip, c);
                for (i = 0; i < c.length; i++) { c[i].filled = true; parts.push(c[i]); }
            } else {
                for (i = 0; i < item.pageItems.length; i++) { collectParts(item.pageItems[i], parts); }
            }
            break;
        case 'TextFrame':
            // Contornos reais dos glifos: duplica, converte em contornos, lê e descarta.
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

    function itemShape(item) {
        var parts = [];
        collectParts(item, parts);
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
        var byId = {}, i, j, u, d, it, p, pp, seen, k, n = 0, worst = 0, b0, b1, err;
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
                }
            }
            n++;
        }
        return { moved: n, residual: worst };
    }

    function artboardShape(doc) {
        var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
        return rectShape(ab.artboardRect);
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
