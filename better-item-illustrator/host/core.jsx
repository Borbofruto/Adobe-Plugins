/*
 * Better Item para Illustrator - núcleo geométrico.
 *
 * Código puro, sem dependência do Illustrator. Escrito em ES3 para rodar no
 * ExtendScript e também no Node (testes em tests/core.test.js).
 *
 * Convenções
 *  - Coordenadas no sistema de script do Illustrator: X para a direita, Y para cima, em pt.
 *  - Um "nó" é {a:[x,y], l:[x,y], r:[x,y]}: âncora, alça esquerda (de entrada) e
 *    alça direita (de saída), como PathPoint.anchor/leftDirection/rightDirection.
 *  - Um "contorno" é {nodes:[nó...], closed:bool}.
 *  - Uma "parte" é {contours:[contorno...], filled:bool}. Os contornos de uma parte
 *    preenchida formam uma região pela regra par-ímpar (furos de caminhos compostos).
 *  - Uma "forma" é {parts:[parte...]}.
 *  - Uma "unidade" é o que se move junto: {id, shape, isKey}.
 */
var BI = (function () {
    var EPS = 1e-9;

    // ---------------------------------------------------------------- vetores
    function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
    function mul(a, s) { return [a[0] * s, a[1] * s]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
    function cross(a, b) { return a[0] * b[1] - a[1] * b[0]; }
    function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }

    function frame(angleDeg) {
        var t = angleDeg * Math.PI / 180;
        var c = Math.cos(t), s = Math.sin(t);
        if (Math.abs(c) < 1e-15) { c = 0; }
        if (Math.abs(s) < 1e-15) { s = 0; }
        return { u: [c, s], v: [-s, c] };
    }

    // ---------------------------------------------------------------- Bézier
    // Lista de segmentos cúbicos [p0, c1, c2, p1] de um contorno.
    // includeClosing: fecha um contorno aberto com reta (preenchimento implícito).
    function segments(contour, includeClosing) {
        var n = contour.nodes, out = [], i, a, b;
        if (n.length === 0) { return out; }
        for (i = 0; i + 1 < n.length; i++) {
            a = n[i]; b = n[i + 1];
            out.push([a.a, a.r, b.l, b.a]);
        }
        if (n.length > 1) {
            a = n[n.length - 1]; b = n[0];
            if (contour.closed) {
                out.push([a.a, a.r, b.l, b.a]);
            } else if (includeClosing) {
                out.push([a.a, a.a, b.a, b.a]);
            }
        }
        return out;
    }

    function bez(s, t) {
        var m = 1 - t;
        var k0 = m * m * m, k1 = 3 * m * m * t, k2 = 3 * m * t * t, k3 = t * t * t;
        return [k0 * s[0][0] + k1 * s[1][0] + k2 * s[2][0] + k3 * s[3][0],
                k0 * s[0][1] + k1 * s[1][1] + k2 * s[2][1] + k3 * s[3][1]];
    }

    function bezD(s, t) {
        var m = 1 - t;
        var k0 = -3 * m * m, k1 = 3 * m * m - 6 * m * t, k2 = 6 * m * t - 3 * t * t, k3 = 3 * t * t;
        return [k0 * s[0][0] + k1 * s[1][0] + k2 * s[2][0] + k3 * s[3][0],
                k0 * s[0][1] + k1 * s[1][1] + k2 * s[2][1] + k3 * s[3][1]];
    }

    // Raízes em (0,1) de a t^2 + b t + c.
    function quadRoots01(a, b, c) {
        var r = [], d, q, t1, t2;
        if (Math.abs(a) < 1e-12) {
            if (Math.abs(b) > 1e-12) { t1 = -c / b; if (t1 > 0 && t1 < 1) { r.push(t1); } }
            return r;
        }
        d = b * b - 4 * a * c;
        if (d < 0) { return r; }
        q = Math.sqrt(d);
        t1 = (-b + q) / (2 * a); t2 = (-b - q) / (2 * a);
        if (t1 > 0 && t1 < 1) { r.push(t1); }
        if (t2 > 0 && t2 < 1) { r.push(t2); }
        return r;
    }

    // Extensão exata [min, max] de um segmento cúbico projetado em dir.
    function segExtent(s, dir) {
        var p0 = dot(s[0], dir), p1 = dot(s[1], dir), p2 = dot(s[2], dir), p3 = dot(s[3], dir);
        var lo = Math.min(p0, p3), hi = Math.max(p0, p3);
        var roots = quadRoots01(-p0 + 3 * p1 - 3 * p2 + p3, 2 * (p0 - 2 * p1 + p2), p1 - p0);
        var i, v;
        for (i = 0; i < roots.length; i++) {
            v = dot(bez(s, roots[i]), dir);
            if (v < lo) { lo = v; }
            if (v > hi) { hi = v; }
        }
        return [lo, hi];
    }

    function eachContour(shape, fn) {
        var i, j, p;
        for (i = 0; i < shape.parts.length; i++) {
            p = shape.parts[i];
            for (j = 0; j < p.contours.length; j++) { fn(p.contours[j], p); }
        }
    }

    // Extensão exata da forma ao longo de dir (ignora espessura de traço).
    function extent(shape, dir) {
        var lo = Infinity, hi = -Infinity;
        eachContour(shape, function (c) {
            var segs = segments(c, false), i, e, v;
            if (segs.length === 0) {
                for (i = 0; i < c.nodes.length; i++) {
                    v = dot(c.nodes[i].a, dir);
                    if (v < lo) { lo = v; }
                    if (v > hi) { hi = v; }
                }
                return;
            }
            for (i = 0; i < segs.length; i++) {
                e = segExtent(segs[i], dir);
                if (e[0] < lo) { lo = e[0]; }
                if (e[1] > hi) { hi = e[1]; }
            }
        });
        if (lo === Infinity) { throw new Error('Forma sem geometria.'); }
        return [lo, hi];
    }

    function boundsCenter(shape, fr) {
        var eu = extent(shape, fr.u), ev = extent(shape, fr.v);
        return add(mul(fr.u, (eu[0] + eu[1]) / 2), mul(fr.v, (ev[0] + ev[1]) / 2));
    }

    // ---------------------------------------------------------------- achatamento
    // Polilinha de um segmento com desvio máximo <= tol (limite pela 2ª derivada).
    function flattenSeg(s, tol, out) {
        var d1 = len(add(sub(s[0], mul(s[1], 2)), s[2]));
        var d2 = len(add(sub(s[1], mul(s[2], 2)), s[3]));
        var m = 6 * Math.max(d1, d2);
        var n = m < EPS ? 1 : Math.ceil(Math.sqrt(m / (8 * tol)));
        var i;
        if (n > 512) { n = 512; }
        for (i = 1; i <= n; i++) { out.push(bez(s, i / n)); }
    }

    function flattenContour(c, tol, closeOpen) {
        var segs = segments(c, closeOpen), pts, i;
        if (c.nodes.length === 0) { return []; }
        pts = [c.nodes[0].a];
        for (i = 0; i < segs.length; i++) { flattenSeg(segs[i], tol, pts); }
        return pts;
    }

    // ---------------------------------------------------------------- centro de massa
    var GX = [-0.9061798459386640, -0.5384693101056831, 0, 0.5384693101056831, 0.9061798459386640];
    var GW = [0.2369268850561891, 0.4786286704993665, 0.5688888888888889, 0.4786286704993665, 0.2369268850561891];

    // Área com sinal e momentos de um contorno fechado (Green, Gauss-Legendre 5 pontos).
    // O integrando é polinomial de grau 8, então o resultado é exato para Béziers cúbicas.
    function contourMoments(c) {
        var segs = segments(c, true), A = 0, Mx = 0, My = 0, i, k, t, w, p, d;
        for (i = 0; i < segs.length; i++) {
            for (k = 0; k < 5; k++) {
                t = (GX[k] + 1) / 2; w = GW[k] / 2;
                p = bez(segs[i], t); d = bezD(segs[i], t);
                A += w * (p[0] * d[1] - p[1] * d[0]) / 2;
                Mx += w * (p[0] * p[0] * d[1]) / 2;
                My += -w * (p[1] * p[1] * d[0]) / 2;
            }
        }
        return { A: A, Mx: Mx, My: My };
    }

    function pointInPoly(pt, poly) {
        var inside = false, i, j, a, b;
        for (i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            a = poly[i]; b = poly[j];
            if (((a[1] > pt[1]) !== (b[1] > pt[1])) &&
                (pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0])) {
                inside = !inside;
            }
        }
        return inside;
    }

    // Área e momentos de uma parte preenchida, regra par-ímpar entre contornos.
    function partMoments(part) {
        var cs = part.contours, polys = [], i, j, depth, m, sgn, A = 0, Mx = 0, My = 0, probe;
        for (i = 0; i < cs.length; i++) { polys.push(flattenContour(cs[i], 0.05, true)); }
        for (i = 0; i < cs.length; i++) {
            if (cs[i].nodes.length < 2) { continue; }
            m = contourMoments(cs[i]);
            if (Math.abs(m.A) < EPS) { continue; }
            depth = 0;
            probe = polys[i][0];
            for (j = 0; j < cs.length; j++) {
                if (j !== i && polys[j].length > 2 && pointInPoly(probe, polys[j])) { depth++; }
            }
            sgn = (depth % 2 === 0 ? 1 : -1) * (m.A > 0 ? 1 : -1);
            A += sgn * m.A; Mx += sgn * m.Mx; My += sgn * m.My;
        }
        return { A: A, Mx: Mx, My: My };
    }

    // Comprimento e momentos de linha (para traços sem preenchimento).
    function lineMoments(shape) {
        var L = 0, Mx = 0, My = 0;
        eachContour(shape, function (c) {
            var segs = segments(c, false), i, j, k, t, w, p, d, sp;
            for (i = 0; i < segs.length; i++) {
                for (j = 0; j < 8; j++) {
                    for (k = 0; k < 5; k++) {
                        t = (j + (GX[k] + 1) / 2) / 8; w = GW[k] / 16;
                        p = bez(segs[i], t); d = bezD(segs[i], t); sp = len(d) * w;
                        L += sp; Mx += sp * p[0]; My += sp * p[1];
                    }
                }
            }
        });
        return { L: L, Mx: Mx, My: My };
    }

    /*
     * Centro de massa da superfície. Equivalente 2D do "Center of Mass (Surface)" do
     * Better Item: centroide ponderado pela área preenchida. Partes sem preenchimento
     * não pesam enquanto houver área; sem área nenhuma, usa o centroide do traço
     * (ponderado por comprimento) e, por fim, o centro dos limites.
     */
    function massCenter(shape, fr) {
        var A = 0, Mx = 0, My = 0, i, m, lm;
        for (i = 0; i < shape.parts.length; i++) {
            if (!shape.parts[i].filled) { continue; }
            m = partMoments(shape.parts[i]);
            A += m.A; Mx += m.Mx; My += m.My;
        }
        if (Math.abs(A) > 1e-6) { return { point: [Mx / A, My / A], source: 'area', area: A }; }
        lm = lineMoments(shape);
        if (lm.L > 1e-9) { return { point: [lm.Mx / lm.L, lm.My / lm.L], source: 'line', length: lm.L }; }
        return { point: boundsCenter(shape, fr || frame(0)), source: 'bounds' };
    }

    // ---------------------------------------------------------------- contato real
    function shapePolylines(shape, tol) {
        var out = [];
        eachContour(shape, function (c, part) {
            var pts = flattenContour(c, tol, part.filled && !c.closed);
            if (pts.length > 0) { out.push(pts); }
        });
        return out;
    }

    // Índice de segmentos de B por faixas perpendiculares à direção.
    function segIndex(polys, v) {
        var segs = [], lo = Infinity, hi = -Infinity, i, j, a, b, va, vb, nb, bins, k, k0, k1, w;
        for (i = 0; i < polys.length; i++) {
            for (j = 0; j + 1 < polys[i].length; j++) {
                a = polys[i][j]; b = polys[i][j + 1];
                va = dot(a, v); vb = dot(b, v);
                segs.push({ a: a, b: b, lo: Math.min(va, vb), hi: Math.max(va, vb) });
                if (Math.min(va, vb) < lo) { lo = Math.min(va, vb); }
                if (Math.max(va, vb) > hi) { hi = Math.max(va, vb); }
            }
        }
        nb = Math.max(1, Math.min(1024, Math.ceil(Math.sqrt(segs.length))));
        w = (hi - lo) / nb;
        bins = [];
        for (k = 0; k < nb; k++) { bins.push([]); }
        for (i = 0; i < segs.length; i++) {
            if (w <= 0) { bins[0].push(segs[i]); continue; }
            k0 = Math.floor((segs[i].lo - lo) / w); k1 = Math.floor((segs[i].hi - lo) / w);
            if (k0 < 0) { k0 = 0; }
            if (k1 >= nb) { k1 = nb - 1; }
            for (k = k0; k <= k1; k++) { bins[k].push(segs[i]); }
        }
        return { bins: bins, lo: lo, w: w, nb: nb, count: segs.length };
    }

    function binOf(idx, val) {
        var k;
        if (idx.w <= 0) { return idx.bins[0]; }
        k = Math.floor((val - idx.lo) / idx.w);
        if (k < 0 || k >= idx.nb) {
            if (k === idx.nb && val <= idx.lo + idx.w * idx.nb + 1e-9) { return idx.bins[idx.nb - 1]; }
            return null;
        }
        return idx.bins[k];
    }

    // Menor s tal que p + s*dir toca algum segmento do índice (null se nenhum).
    function rayMin(p, dir, v, idx, best) {
        var pv = dot(p, v), bin = binOf(idx, pv), i, sg, e, den, t, s;
        if (!bin) { return best; }
        for (i = 0; i < bin.length; i++) {
            sg = bin[i];
            if (pv < sg.lo - 1e-9 || pv > sg.hi + 1e-9) { continue; }
            e = sub(sg.b, sg.a);
            den = cross(dir, e);
            if (Math.abs(den) < 1e-12) {
                // segmento paralelo à direção: contato nas pontas, se colinear
                if (Math.abs(cross(sub(sg.a, p), dir)) > 1e-9) { continue; }
                s = Math.min(dot(sub(sg.a, p), dir), dot(sub(sg.b, p), dir));
            } else {
                t = cross(sub(sg.a, p), dir) / den;
                if (t < -1e-9 || t > 1 + 1e-9) { continue; }
                s = cross(sub(sg.a, p), e) / den;
            }
            if (best === null || s < best) { best = s; }
        }
        return best;
    }

    /*
     * Vão de contato real entre A (atrás) e B (à frente) ao longo de dir:
     * a distância que A pode avançar, vindo de trás, até o primeiro toque entre os
     * contornos (polilinhas com desvio <= tol). Negativo quando já se sobrepõem.
     * Como o movimento é sempre paralelo a dir, o vão muda exatamente pelo
     * deslocamento relativo, o que torna a distribuição exata e sem iterações.
     * Devolve null quando os contornos nunca se tocam nessa direção.
     */
    function contactGap(A, B, dir, tol) {
        var fr = { u: dir, v: [-dir[1], dir[0]] };
        var pa = shapePolylines(A, tol || 0.02), pb = shapePolylines(B, tol || 0.02);
        var ib = segIndex(pb, fr.v), ia = segIndex(pa, fr.v), best = null, i, j, back, s;
        for (i = 0; i < pa.length; i++) {
            for (j = 0; j < pa[i].length; j++) { best = rayMin(pa[i][j], dir, fr.v, ib, best); }
        }
        back = mul(dir, -1);
        for (i = 0; i < pb.length; i++) {
            for (j = 0; j < pb[i].length; j++) {
                s = rayMin(pb[i][j], back, fr.v, ia, null);
                if (s !== null && (best === null || s < best)) { best = s; }
            }
        }
        return best;
    }

    // ---------------------------------------------------------------- planejamento
    function edgeOf(e, edge) {
        if (edge === 'min') { return e[0]; }
        if (edge === 'max') { return e[1]; }
        return (e[0] + e[1]) / 2;
    }

    function axisVec(fr, axis) { return axis === 'v' ? fr.v : fr.u; }

    /*
     * Alinhamento.
     * opts: {angle, axis:'u'|'v', edge:'min'|'center'|'max', basis:'bounds'|'mass',
     *        reference:'selection'|'artboard'|'key'}
     * ctx:  {artboard: forma (retângulo), key: forma}
     * Devolve [{id, d:[dx,dy]}]. A chave nunca se move.
     */
    function planAlign(units, opts, ctx) {
        var fr = frame(opts.angle || 0), a = axisVec(fr, opts.axis), i, e, vals = [], ref, lo, hi, out = [], v;
        if (units.length === 0) { throw new Error('Nada selecionado para alinhar.'); }
        for (i = 0; i < units.length; i++) {
            if (opts.basis === 'mass') {
                v = dot(massCenter(units[i].shape, fr).point, a);
                vals.push({ value: v, ext: [v, v] });
            } else {
                e = extent(units[i].shape, a);
                vals.push({ value: edgeOf(e, opts.edge), ext: e });
            }
        }
        if (opts.reference === 'artboard') {
            if (!ctx || !ctx.artboard) { throw new Error('Prancheta indisponível.'); }
            ref = edgeOf(extent(ctx.artboard, a), opts.edge);
        } else if (opts.reference === 'key') {
            if (!ctx || !ctx.key) { throw new Error('Defina uma chave antes de alinhar à chave.'); }
            ref = opts.basis === 'mass' ? dot(massCenter(ctx.key, fr).point, a) : edgeOf(extent(ctx.key, a), opts.edge);
        } else {
            if (units.length < 2) { throw new Error('Selecione pelo menos dois itens para alinhar aos limites da seleção.'); }
            lo = Infinity; hi = -Infinity;
            for (i = 0; i < vals.length; i++) {
                if (vals[i].ext[0] < lo) { lo = vals[i].ext[0]; }
                if (vals[i].ext[1] > hi) { hi = vals[i].ext[1]; }
            }
            ref = edgeOf([lo, hi], opts.edge);
        }
        for (i = 0; i < units.length; i++) {
            if (units[i].isKey) { continue; }
            out.push({ id: units[i].id, d: mul(a, ref - vals[i].value) });
        }
        return out;
    }

    /*
     * Mede os itens em ordem ao longo da direção e os vãos entre vizinhos.
     * basis: 'bounds' (centro dos limites) | 'mass' (centro de massa) |
     *        'gap' (vão entre limites projetados) | 'contact' (vão de contato real)
     */
    function measure(units, opts) {
        var fr = frame(opts.angle || 0), d = axisVec(fr, opts.axis), items = [], i, it, gaps = [], g, fallback = 0, prev;
        var pointBasis = opts.basis === 'bounds' || opts.basis === 'mass';
        for (i = 0; i < units.length; i++) {
            it = { unit: units[i], index: i, ext: extent(units[i].shape, d) };
            if (pointBasis) {
                it.pos = dot(opts.basis === 'mass' ? massCenter(units[i].shape, fr).point : boundsCenter(units[i].shape, fr), d);
            } else {
                it.pos = (it.ext[0] + it.ext[1]) / 2;
            }
            items.push(it);
        }
        items.sort(function (x, y) { return x.pos - y.pos || x.index - y.index; });
        for (i = 1; i < items.length; i++) {
            if (Math.abs(items[i].pos - items[i - 1].pos) < 1e-6) {
                throw new Error('Dois itens estão na mesma posição ao longo da direção (' +
                    items[i - 1].unit.id + ', ' + items[i].unit.id + '). Separe-os para definir a ordem.');
            }
        }
        for (i = 1; i < items.length; i++) {
            prev = items[i - 1]; it = items[i];
            if (pointBasis) {
                g = it.pos - prev.pos;
            } else if (opts.basis === 'contact') {
                g = contactGap(prev.unit.shape, it.unit.shape, d, opts.tolerance);
                if (g === null) { g = it.ext[0] - prev.ext[1]; fallback++; }
            } else {
                g = it.ext[0] - prev.ext[1];
            }
            gaps.push(g);
        }
        return { items: items, gaps: gaps, dir: d, frame: fr, pointBasis: pointBasis, fallback: fallback };
    }

    /*
     * Distribuição.
     * opts: {angle, axis, basis, mode:'spacing'|'between', spacing (pt), ends:'selection'|'artboard'}
     * 'spacing': vão/intervalo fixo; o objeto-chave (se estiver na seleção) fica parado,
     *            senão o primeiro item na direção.
     * 'between': primeiro e último ficam nos extremos (seus lugares atuais ou as bordas
     *            da prancheta) e os vãos ficam iguais.
     * Deslocamentos só na direção, então vão_novo = vão_antigo + (d_k - d_{k-1}).
     */
    function planDistribute(units, opts, ctx) {
        var m, n, gaps, deltas = [], target, d0, dn, sum, i, keyPos = -1, shift, out = [], ab, first, last;
        if (units.length < 2) { throw new Error('Selecione pelo menos dois itens para distribuir.'); }
        m = measure(units, opts);
        n = m.items.length; gaps = m.gaps;
        if (opts.mode === 'between') {
            if (n < 3 && opts.ends !== 'artboard') { throw new Error('Entre extremos precisa de pelo menos três itens.'); }
            d0 = 0; dn = 0;
            if (opts.ends === 'artboard') {
                if (!ctx || !ctx.artboard) { throw new Error('Prancheta indisponível.'); }
                ab = extent(ctx.artboard, m.dir);
                first = m.items[0]; last = m.items[n - 1];
                d0 = ab[0] - (m.pointBasis ? first.pos : first.ext[0]);
                dn = ab[1] - (m.pointBasis ? last.pos : last.ext[1]);
            }
            sum = 0;
            for (i = 0; i < gaps.length; i++) { sum += gaps[i]; }
            target = (sum + dn - d0) / (n - 1);
            deltas.push(d0);
            for (i = 1; i < n; i++) { deltas.push(deltas[i - 1] + target - gaps[i - 1]); }
        } else {
            target = opts.spacing;
            if (typeof target !== 'number' || isNaN(target)) { throw new Error('Espaçamento inválido.'); }
            if (m.pointBasis && Math.abs(target) < 1e-6) {
                throw new Error('Com base em pontos, o espaçamento precisa ser diferente de zero.');
            }
            deltas.push(0);
            for (i = 1; i < n; i++) { deltas.push(deltas[i - 1] + target - gaps[i - 1]); }
            for (i = 0; i < n; i++) { if (m.items[i].unit.isKey) { keyPos = i; } }
            shift = keyPos >= 0 ? deltas[keyPos] : 0;
            for (i = 0; i < n; i++) { deltas[i] -= shift; }
        }
        for (i = 0; i < n; i++) {
            if (Math.abs(deltas[i]) < 1e-9) { continue; }
            out.push({ id: m.items[i].unit.id, d: mul(m.dir, deltas[i]) });
        }
        return { moves: out, target: target, fallback: m.fallback };
    }

    // Leitura do espaçamento atual (uniforme ou misto), como a inspeção do Better Item.
    function inspect(units, opts) {
        var m = measure(units, opts), lo = Infinity, hi = -Infinity, i;
        for (i = 0; i < m.gaps.length; i++) {
            if (m.gaps[i] < lo) { lo = m.gaps[i]; }
            if (m.gaps[i] > hi) { hi = m.gaps[i]; }
        }
        return { gaps: m.gaps, uniform: m.gaps.length > 0 && hi - lo < 1e-3, min: lo, max: hi, fallback: m.fallback };
    }

    // Translada uma forma (para testes e verificações).
    function translateShape(shape, d) {
        var parts = [], i, j, k, p, cs, nodes, nd;
        for (i = 0; i < shape.parts.length; i++) {
            p = shape.parts[i]; cs = [];
            for (j = 0; j < p.contours.length; j++) {
                nodes = [];
                for (k = 0; k < p.contours[j].nodes.length; k++) {
                    nd = p.contours[j].nodes[k];
                    nodes.push({ a: add(nd.a, d), l: add(nd.l, d), r: add(nd.r, d) });
                }
                cs.push({ nodes: nodes, closed: p.contours[j].closed });
            }
            parts.push({ contours: cs, filled: p.filled });
        }
        return { parts: parts };
    }

    // Ângulo (graus) de uma corda: usado para orientação pelo segmento-chave.
    function angleOf(p0, p1) {
        var d = sub(p1, p0);
        if (len(d) < 1e-9) { throw new Error('O segmento-chave tem comprimento zero.'); }
        return Math.atan2(d[1], d[0]) * 180 / Math.PI;
    }


    // ---------------------------------------------------------------- alças
    function vecAngle(v) { return Math.atan2(v[1], v[0]) * 180 / Math.PI; }
    function rotate(v, deg) {
        var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
        return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
    }
    function signedMod(x, m) { // resultado em (-m/2, m/2]
        var r = ((x % m) + m) % m;
        return r > m / 2 ? r - m : r;
    }

    /*
     * Ângulo mais próximo de uma lista ordenada. Empate (mesma distância) fica com o
     * item de maior prioridade, isto é, o que aparece antes na lista.
     * opts.sense: false (padrão) trata o ângulo como direção (módulo 180°), então uma
     * alça a 180° conta como 0°; true considera o sentido (módulo 360°).
     * opts.tolerance: distância máxima em graus (0 ou ausente = sem limite).
     * Devolve {angle, index, distance} com angle já na representação mais próxima
     * do original, ou null se nada estiver dentro da tolerância.
     */
    function snapAngle(deg, list, opts) {
        var m = opts && opts.sense ? 360 : 180, best = null, i, sd, dist;
        for (i = 0; i < list.length; i++) {
            sd = signedMod(deg - list[i], m);
            dist = Math.abs(sd);
            if (best === null || dist < best.distance - 1e-9) { best = { angle: deg - sd, index: i, distance: dist }; }
        }
        if (!best) { return null; }
        if (opts && opts.tolerance > 0 && best.distance > opts.tolerance + 1e-9) { return null; }
        return best;
    }

    // Magnitude mais próxima de uma lista ordenada, com o mesmo desempate por prioridade.
    function snapLength(value, list, opts) {
        var best = null, i, dist;
        for (i = 0; i < list.length; i++) {
            if (!(list[i] > 0)) { continue; }
            dist = Math.abs(value - list[i]);
            if (best === null || dist < best.distance - 1e-9) { best = { length: list[i], index: i, distance: dist }; }
        }
        if (!best) { return null; }
        if (opts && opts.tolerance > 0 && best.distance > opts.tolerance + 1e-9) { return null; }
        return best;
    }

    /*
     * Ajusta as alças de um nó.
     * opts: {angles:[], sense, angleTolerance, lengths:[], lengthTolerance, keepSmooth}
     * Alças recolhidas (comprimento zero) ficam como estão. Num ponto suave (alças
     * colineares e opostas) com keepSmooth, as duas giram juntas pelo ajuste da alça
     * mais próxima de um ângulo da lista (empate: prioridade, depois a alça mais longa).
     * A magnitude é ajustada em cada alça sem mudar a direção, então a suavidade se mantém.
     * Devolve {node, angles: n, lengths: n} (quantas alças mudaram).
     */
    function snapNode(nd, opts) {
        var a = nd.a, hin = sub(nd.l, a), hout = sub(nd.r, a), lin = len(hin), lout = len(hout);
        var angles = opts.angles || [], lengths = opts.lengths || [], ao = { sense: opts.sense, tolerance: opts.angleTolerance };
        var nAng = 0, nLen = 0, smooth, si, so, pick, delta, sl;
        var hasIn = lin > 1e-6, hasOut = lout > 1e-6;
        smooth = hasIn && hasOut && Math.abs(signedMod(vecAngle(hin) - vecAngle(hout), 360)) > 179.5;
        if (angles.length) {
            si = hasIn ? snapAngle(vecAngle(hin), angles, ao) : null;
            so = hasOut ? snapAngle(vecAngle(hout), angles, ao) : null;
            if (smooth && opts.keepSmooth !== false) {
                pick = null;
                if (si && so) {
                    if (Math.abs(si.distance - so.distance) > 1e-9) { pick = si.distance < so.distance ? 'in' : 'out'; }
                    else if (si.index !== so.index) { pick = si.index < so.index ? 'in' : 'out'; }
                    else { pick = lin >= lout ? 'in' : 'out'; }
                } else if (si) { pick = 'in'; } else if (so) { pick = 'out'; }
                if (pick) {
                    delta = pick === 'in' ? si.angle - vecAngle(hin) : so.angle - vecAngle(hout);
                    if (Math.abs(delta) > 1e-9) { hin = rotate(hin, delta); hout = rotate(hout, delta); nAng += 2; }
                }
            } else {
                if (si && Math.abs(si.angle - vecAngle(hin)) > 1e-9) { hin = rotate(hin, si.angle - vecAngle(hin)); nAng++; }
                if (so && Math.abs(so.angle - vecAngle(hout)) > 1e-9) { hout = rotate(hout, so.angle - vecAngle(hout)); nAng++; }
            }
        }
        if (lengths.length) {
            if (hasIn) {
                sl = snapLength(lin, lengths, { tolerance: opts.lengthTolerance });
                if (sl && Math.abs(sl.length - lin) > 1e-9) { hin = mul(hin, sl.length / lin); nLen++; }
            }
            if (hasOut) {
                sl = snapLength(lout, lengths, { tolerance: opts.lengthTolerance });
                if (sl && Math.abs(sl.length - lout) > 1e-9) { hout = mul(hout, sl.length / lout); nLen++; }
            }
        }
        return { node: { a: [a[0], a[1]], l: add(a, hin), r: add(a, hout) }, angles: nAng, lengths: nLen };
    }

    // Vetor de alça: {length, angle} em graus anti-horários a partir de +X (Y para cima).
    function handleVector(anchor, handle) {
        var d = sub(handle, anchor);
        return { length: len(d), angle: len(d) > 1e-9 ? vecAngle(d) : 0 };
    }
    function handleFromVector(anchor, length, angle) {
        var t = angle * Math.PI / 180;
        return [anchor[0] + length * Math.cos(t), anchor[1] + length * Math.sin(t)];
    }


    // ---------------------------------------------------------------- tipos de alça (como no Blender)
    // 'F' livre, 'A' alinhada, 'V' vetor, 'U' automática.
    function unit(v) { var L = len(v); return L > 1e-12 ? mul(v, 1 / L) : [0, 0]; }

    // Vetor: cada alça aponta para o vizinho, a 1/3 da distância (recolhida sem vizinho).
    function vectorHandles(prev, p, next) {
        return { l: prev ? add(p, mul(sub(prev, p), 1 / 3)) : [p[0], p[1]],
                 r: next ? add(p, mul(sub(next, p), 1 / 3)) : [p[0], p[1]] };
    }

    /*
     * Automática: tangente pela bissetriz das direções aos vizinhos e comprimento de arco
     * circular em cada lado: L = corda / (3 cos^2(θ/2)), onde θ é o ângulo entre a
     * tangente e a corda. Corda reta dá L = corda/3; quatro pontos num círculo dão o
     * círculo de Bézier padrão (0,5523 r). Pontas de caminho aberto apontam para o vizinho.
     */
    function autoHandles(prev, p, next) {
        var da, db, la, lb, t, ca, cb, out;
        if (!prev && !next) { return { l: [p[0], p[1]], r: [p[0], p[1]] }; }
        if (!prev || !next) {
            out = vectorHandles(prev, p, next);
            return out;
        }
        da = sub(p, prev); db = sub(next, p); la = len(da); lb = len(db);
        if (la < 1e-12 || lb < 1e-12) { return vectorHandles(prev, p, next); }
        t = unit(add(mul(da, 1 / la), mul(db, 1 / lb)));
        if (len(t) < 1e-12) { t = unit([-da[1], da[0]]); } // volta de 180°: perpendicular
        function arcLen(chordLen, chordDir) {
            var c = Math.max(-1, Math.min(1, dot(t, chordDir))), th = Math.acos(Math.abs(c));
            if (th > Math.PI / 2) { th = Math.PI / 2; }
            var h = Math.cos(th / 2);
            return chordLen / (3 * h * h);
        }
        ca = arcLen(la, mul(da, 1 / la)); cb = arcLen(lb, mul(db, 1 / lb));
        return { l: sub(p, mul(t, ca)), r: add(p, mul(t, cb)) };
    }

    // Alinha a alça "other" oposta à "edited", mantendo o comprimento de "other".
    function alignOpposite(anchor, edited, other) {
        var d = unit(sub(edited, anchor)), L = len(sub(other, anchor));
        if (len(d) < 1e-12 || L < 1e-12) { return [other[0], other[1]]; }
        return sub(anchor, mul(d, L));
    }

    // Converte para alinhada: direção média das duas alças, comprimentos preservados.
    function alignBoth(nd) {
        var a = nd.a, dl = sub(nd.l, a), dr = sub(nd.r, a), Ll = len(dl), Lr = len(dr), d;
        if (Ll < 1e-12 || Lr < 1e-12) { return { a: a, l: nd.l, r: nd.r }; }
        d = unit(sub(mul(dr, 1 / Lr), mul(dl, 1 / Ll)));
        if (len(d) < 1e-12) { d = unit(dr); }
        return { a: a, l: sub(a, mul(d, Ll)), r: add(a, mul(d, Lr)) };
    }

    /*
     * Recalcula as alças dos índices pedidos de acordo com os tipos.
     * nodes: [{a,l,r}], closed, types: string com um caractere por nó.
     * Só 'V' e 'U' mudam; devolve a lista de índices alterados.
     */
    function refreshTypes(nodes, closed, types, indices) {
        var n = nodes.length, changed = [], seen = {}, i, k, prev, next, h, ty;
        for (i = 0; i < indices.length; i++) {
            k = indices[i];
            if (k < 0 || k >= n || seen[k]) { continue; }
            seen[k] = true;
            ty = types.charAt(k);
            if (ty !== 'V' && ty !== 'U') { continue; }
            prev = k > 0 ? nodes[k - 1].a : (closed && n > 1 ? nodes[n - 1].a : null);
            next = k < n - 1 ? nodes[k + 1].a : (closed && n > 1 ? nodes[0].a : null);
            h = ty === 'V' ? vectorHandles(prev, nodes[k].a, next) : autoHandles(prev, nodes[k].a, next);
            nodes[k].l = h.l; nodes[k].r = h.r;
            changed.push(k);
        }
        return changed;
    }

    // Índices afetados quando os pontos "moved" se movem: eles e os vizinhos.
    function neighborhood(n, closed, moved) {
        var out = [], i, k;
        for (i = 0; i < moved.length; i++) {
            k = moved[i];
            out.push(k);
            if (k > 0) { out.push(k - 1); } else if (closed) { out.push(n - 1); }
            if (k < n - 1) { out.push(k + 1); } else if (closed) { out.push(0); }
        }
        return out;
    }


    // ---------------------------------------------------------------- rotação inferida
    // Envoltória convexa (cadeia monótona de Andrew).
    function convexHull(points) {
        var pts = points.slice(0), lower = [], upper = [], i, p;
        pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        function turn(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
        for (i = 0; i < pts.length; i++) {
            p = pts[i];
            while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) { lower.pop(); }
            lower.push(p);
        }
        for (i = pts.length - 1; i >= 0; i--) {
            p = pts[i];
            while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) { upper.pop(); }
            upper.push(p);
        }
        lower.pop(); upper.pop();
        return lower.concat(upper);
    }

    /*
     * Retângulo de menor área que envolve os pontos (o ângulo de uma aresta da envoltória
     * sempre define o ótimo). Ângulo normalizado em (-45°, 45°]; em empate de área
     * (diferença < 0,1%), vence o ângulo mais perto de 0, então formas sem orientação
     * clara, como círculos, ficam em 0°.
     */
    function minAreaRect(points) {
        var h = convexHull(points), best = null, i, e, ang, fr, lo, hi, j, pu, pv, area, k, maxArea = 0, zero = null;
        if (h.length < 3) { return { angle: 0, w: 0, h: 0 }; }
        for (i = 0; i < h.length; i++) {
            e = sub(h[(i + 1) % h.length], h[i]);
            if (len(e) < 1e-12) { continue; }
            ang = Math.atan2(e[1], e[0]) * 180 / Math.PI;
            ang = ang - 90 * Math.round(ang / 90);          // (-45, 45]
            if (ang <= -45) { ang += 90; }
            fr = frame(ang); lo = [Infinity, Infinity]; hi = [-Infinity, -Infinity];
            for (j = 0; j < h.length; j++) {
                pu = dot(h[j], fr.u); pv = dot(h[j], fr.v);
                if (pu < lo[0]) { lo[0] = pu; } if (pu > hi[0]) { hi[0] = pu; }
                if (pv < lo[1]) { lo[1] = pv; } if (pv > hi[1]) { hi[1] = pv; }
            }
            area = (hi[0] - lo[0]) * (hi[1] - lo[1]);
            k = { angle: Math.abs(ang) < 1e-9 ? 0 : ang, w: hi[0] - lo[0], h: hi[1] - lo[1], area: area };
            if (area > maxArea) { maxArea = area; }
            if (k.angle === 0 && (!zero || area < zero.area)) { zero = k; }
            if (!best || area < best.area * (1 - 1e-3) ||
                (area <= best.area * (1 + 1e-3) && Math.abs(k.angle) < Math.abs(best.angle))) { best = k; }
        }
        // Sem orientação definida (variação de área < 2% numa varredura de 0° a 90°, como num círculo): 0°.
        for (i = 0; i < 18; i++) {
            fr = frame(i * 5 - 45); lo = [Infinity, Infinity]; hi = [-Infinity, -Infinity];
            for (j = 0; j < h.length; j++) {
                pu = dot(h[j], fr.u); pv = dot(h[j], fr.v);
                if (pu < lo[0]) { lo[0] = pu; } if (pu > hi[0]) { hi[0] = pu; }
                if (pv < lo[1]) { lo[1] = pv; } if (pv > hi[1]) { hi[1] = pv; }
            }
            area = (hi[0] - lo[0]) * (hi[1] - lo[1]);
            if (area > maxArea) { maxArea = area; }
        }
        if (best && (maxArea - best.area) / best.area < 0.02) {
            return zero || { angle: 0, w: best.w, h: best.h, area: best.area };
        }
        return best || { angle: 0, w: 0, h: 0 };
    }

    // Pontos (polilinhas) de uma forma, para a envoltória.
    function shapePoints(shape, tol) {
        var out = [], polys = shapePolylines(shape, tol || 0.25), i, j;
        for (i = 0; i < polys.length; i++) { for (j = 0; j < polys[i].length; j++) { out.push(polys[i][j]); } }
        return out;
    }


    // Segundos momentos de área (em torno da origem) de uma forma: Green com 4 subintervalos x 5 pontos.
    function areaSecondMoments(shape) {
        var tot = { A: 0, Mx: 0, My: 0, Ixx: 0, Iyy: 0, Ixy: 0 }, pi, part, polys, cs, i, j, segs, sg, q, k, t, w, p, d, depth, sgn, acc;
        for (pi = 0; pi < shape.parts.length; pi++) {
            part = shape.parts[pi];
            if (!part.filled) { continue; }
            cs = part.contours; polys = [];
            for (i = 0; i < cs.length; i++) { polys.push(flattenContour(cs[i], 0.05, true)); }
            for (i = 0; i < cs.length; i++) {
                if (cs[i].nodes.length < 2) { continue; }
                acc = { A: 0, Mx: 0, My: 0, Ixx: 0, Iyy: 0, Ixy: 0 };
                segs = segments(cs[i], true);
                for (sg = 0; sg < segs.length; sg++) {
                    for (q = 0; q < 4; q++) {
                        for (k = 0; k < 5; k++) {
                            t = (q + (GX[k] + 1) / 2) / 4; w = GW[k] / 8;
                            p = bez(segs[sg], t); d = bezD(segs[sg], t);
                            acc.A += w * (p[0] * d[1] - p[1] * d[0]) / 2;
                            acc.Mx += w * p[0] * p[0] * d[1] / 2;
                            acc.My += -w * p[1] * p[1] * d[0] / 2;
                            acc.Ixx += w * p[0] * p[0] * p[0] * d[1] / 3;
                            acc.Iyy += -w * p[1] * p[1] * p[1] * d[0] / 3;
                            acc.Ixy += w * p[0] * p[0] * p[1] * d[1] / 2;
                        }
                    }
                }
                if (Math.abs(acc.A) < EPS) { continue; }
                depth = 0;
                for (j = 0; j < cs.length; j++) {
                    if (j !== i && polys[j].length > 2 && pointInPoly(polys[i][0], polys[j])) { depth++; }
                }
                sgn = (depth % 2 === 0 ? 1 : -1) * (acc.A > 0 ? 1 : -1);
                tot.A += sgn * acc.A; tot.Mx += sgn * acc.Mx; tot.My += sgn * acc.My;
                tot.Ixx += sgn * acc.Ixx; tot.Iyy += sgn * acc.Iyy; tot.Ixy += sgn * acc.Ixy;
            }
        }
        return tot;
    }

    function norm90(deg) {
        var a = deg - 90 * Math.round(deg / 90);
        if (a <= -45) { a += 90; }
        return Math.abs(a) < 1e-9 ? 0 : a;
    }

    /*
     * Rotação inferida de um conjunto de formas, módulo 90° em (-45°, 45°]:
     *  - com área e anisotropia clara (> 2%), o eixo principal de inércia da área
     *    (exato, sem depender da amostragem do contorno);
     *  - formas isotrópicas (quadrado, círculo, estrela regular) ou sem área usam o
     *    retângulo de menor área, que dá 0° quando não há orientação definida.
     */
    function inferRotation(shapes) {
        var m = { A: 0, Mx: 0, My: 0, Ixx: 0, Iyy: 0, Ixy: 0 }, i, r, cx, cy, ixx, iyy, ixy, l1, l2, root, pts = [], sp, j;
        for (i = 0; i < shapes.length; i++) {
            r = areaSecondMoments(shapes[i]);
            m.A += r.A; m.Mx += r.Mx; m.My += r.My; m.Ixx += r.Ixx; m.Iyy += r.Iyy; m.Ixy += r.Ixy;
        }
        if (Math.abs(m.A) > 1e-6) {
            cx = m.Mx / m.A; cy = m.My / m.A;
            ixx = m.Ixx / m.A - cx * cx; iyy = m.Iyy / m.A - cy * cy; ixy = m.Ixy / m.A - cx * cy;
            root = Math.sqrt((ixx - iyy) * (ixx - iyy) / 4 + ixy * ixy);
            l1 = (ixx + iyy) / 2 + root; l2 = (ixx + iyy) / 2 - root;
            if (l1 > 0 && (l1 - l2) / (l1 + l2) > 0.02) {
                return { angle: norm90(0.5 * Math.atan2(2 * ixy, ixx - iyy) * 180 / Math.PI), method: 'inertia' };
            }
        }
        for (i = 0; i < shapes.length; i++) {
            sp = shapePoints(shapes[i], 0.05);
            for (j = 0; j < sp.length; j++) { pts.push(sp[j]); }
        }
        return { angle: minAreaRect(pts).angle, method: 'rect' };
    }

    return {
        frame: frame, extent: extent, boundsCenter: boundsCenter, massCenter: massCenter,
        contactGap: contactGap, planAlign: planAlign, planDistribute: planDistribute,
        inspect: inspect, measure: measure, translateShape: translateShape, angleOf: angleOf,
        flattenContour: flattenContour, snapAngle: snapAngle, snapLength: snapLength, snapNode: snapNode,
        handleVector: handleVector, handleFromVector: handleFromVector, rotateVec: rotate,
        vectorHandles: vectorHandles, autoHandles: autoHandles, alignOpposite: alignOpposite, alignBoth: alignBoth,
        refreshTypes: refreshTypes, neighborhood: neighborhood,
        convexHull: convexHull, minAreaRect: minAreaRect, shapePoints: shapePoints, inferRotation: inferRotation
    };
}());

if (typeof module !== 'undefined' && module.exports) { module.exports = BI; }
