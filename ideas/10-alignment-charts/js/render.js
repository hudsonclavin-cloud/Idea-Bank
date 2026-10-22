/* Alignment Charts — SVG strings from a layout. Pure (no DOM), so the same
 * code draws the live chart, the printable sheet, and the downloadable file. */
(function (root, factory) {
  const cjs = typeof module === 'object' && module.exports;
  const load = (file, name) => (cjs ? require(file) : root[name]);
  const api = factory({  });
  if (cjs) module.exports = api;
  else root.ACRender = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (deps) {
  'use strict';

  const f = (n) => (Math.round(n * 100) / 100).toString();

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const decode = (s) =>
    s.replace(/&(#\d+|amp|lt|gt|quot|thinsp);/g, (m, e) =>
      e[0] === '#' ? String.fromCharCode(+e.slice(1)) : { amp: '&', lt: '<', gt: '>', quot: '"', thinsp: '\u2009' }[e],
    );

  /** Minimal HTML-to-SVG-text: keeps <sub>/<sup>/<em>, drops other tags. */
  function richText(html) {
    const parts = String(html).split(/(<\/?(?:sub|sup|em|i)>)/);
    let out = '';
    for (const p of parts) {
      if (p === '<sub>') out += '<tspan baseline-shift="sub" font-size="72%">';
      else if (p === '<sup>') out += '<tspan baseline-shift="super" font-size="72%">';
      else if (p === '<em>' || p === '<i>') out += '<tspan font-style="italic">';
      else if (/^<\/(sub|sup|em|i)>$/.test(p)) out += '</tspan>';
      else out += esc(decode(p.replace(/<[^>]*>/g, '')));
    }
    return out;
  }

  const polyD = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('');

  /** Scale lines, ticks, labels and titles. */
  function scalesSVG(L, { titleFont = 13, font = 12 } = {}) {
    let s = '<g class="ac-scales">';
    for (const sc of L.scales) s += `<path class="ac-line" d="${polyD(sc.samples)}"/>`;
    const groups = new Map();
    for (const sc of L.scales) {
      for (const t of sc.ticks) {
        const k = `${t.kind}-${Math.min(t.level, 3)}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(t);
      }
    }
    for (const [k, ts] of groups) {
      s += `<path class="ac-tk ac-tk-${k}" d="${ts.map((t) => `M${f(t.x1)} ${f(t.y1)}L${f(t.x2)} ${f(t.y2)}`).join('')}"/>`;
    }
    for (const l of L.labels) {
      s += `<text class="ac-lb ac-lb-${l.kind}" x="${f(l.x)}" y="${f(l.y)}" dy="0.35em" font-size="${l.fs}">${esc(l.text)}</text>`;
    }
    for (const t of L.titles) {
      const [name, unit] = t.lines;
      const top = t.y - t.h / 2;
      const y1 = top + titleFont * 0.6;
      s += `<text class="ac-title" x="${f(t.x)}" y="${f(y1)}" dy="0.35em" font-size="${titleFont}">${esc(name)}</text>`;
      if (unit) {
        const y2 = top + titleFont * 1.2 + (font - 1) * 0.62;
        s += `<text class="ac-unit" x="${f(t.x)}" y="${f(y2)}" dy="0.35em" font-size="${font - 1}">${esc(unit)}</text>`;
      }
    }
    return s + '</g>';
  }

  /** Clip the infinite line through A and B to the box [x0,W]x[y0,H]; null if it misses. */
  function clipLine(A, B, W, H, x0 = 0, y0 = 0) {
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    let t0 = -Infinity;
    let t1 = Infinity;
    const edges = [
      [-dx, A[0] - x0],
      [dx, W - A[0]],
      [-dy, A[1] - y0],
      [dy, H - A[1]],
    ];
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) return null;
        continue;
      }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
    if (!(t1 > t0) || !Number.isFinite(t0) || !Number.isFinite(t1)) return null;
    return [
      [A[0] + dx * t0, A[1] + dy * t0],
      [A[0] + dx * t1, A[1] + dy * t1],
    ];
  }

  /**
   * The straightedge: a translucent ruler whose working edge is the line through
   * the two pins, with millimetre-ish graduations, pin dots, and reading rings.
   * reads: [{ p: [x, y], text }]
   */
  function edgeSVG({ A, B, W, H, reads = [], measure, font = 12, printStyle = false, inset = 0 }) {
    const seg = clipLine(A, B, W - inset, H, inset, 0);
    if (!seg) return '';
    const [E0, E1] = seg;
    const dx = E1[0] - E0[0];
    const dy = E1[1] - E0[1];
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L;
    const uy = dy / L;
    let nx = -uy;
    let ny = ux;
    if (ny < 0 || (ny === 0 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    let s = '<g class="ac-edge">';
    if (!printStyle) {
      const bw = 26;
      s += `<path class="ac-ruler" d="M${f(E0[0])} ${f(E0[1])}L${f(E1[0])} ${f(E1[1])}L${f(E1[0] + nx * bw)} ${f(E1[1] + ny * bw)}L${f(E0[0] + nx * bw)} ${f(E0[1] + ny * bw)}Z"/>`;
      let d = '';
      const step = 5;
      for (let i = 0, k = 0; i <= L; i += step, k++) {
        const len = k % 10 === 0 ? 9 : k % 5 === 0 ? 6.5 : 3.5;
        const x = E0[0] + ux * i;
        const y = E0[1] + uy * i;
        d += `M${f(x)} ${f(y)}L${f(x + nx * len)} ${f(y + ny * len)}`;
      }
      s += `<path class="ac-grad" d="${d}"/>`;
    }
    s += `<path class="ac-hair${printStyle ? ' ac-hair-print' : ''}" d="M${f(E0[0])} ${f(E0[1])}L${f(E1[0])} ${f(E1[1])}"/>`;
    for (const P of [A, B]) s += `<circle class="ac-pin" cx="${f(P[0])}" cy="${f(P[1])}" r="${printStyle ? 3.5 : 6.5}"/>`;
    for (const r of reads) {
      s += `<circle class="ac-read" cx="${f(r.p[0])}" cy="${f(r.p[1])}" r="${printStyle ? 5 : 8.5}"/>`;
      if (!printStyle && r.text) {
        const fs = font + 1;
        const w = (measure ? measure(r.text, fs, 'badge') : r.text.length * fs * 0.6) + 14;
        const h = fs + 10;
        // Badge on the side away from the ruler body, clamped to the canvas.
        let cx = r.p[0] - nx * (14 + h / 2) + ux * 0;
        let cy = r.p[1] - ny * (14 + h / 2);
        cx = Math.min(W - w / 2 - 2, Math.max(w / 2 + 2, cx));
        cy = Math.min(H - h / 2 - 2, Math.max(h / 2 + 2, cy));
        s += `<g class="ac-badge"><rect x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 2)}"/>`;
        s += `<text x="${f(cx)}" y="${f(cy)}" dy="0.35em" font-size="${fs}">${esc(r.text)}</text></g>`;
      }
    }
    return s + '</g>';
  }

  /** Corner handles and the outline of the (possibly warped) sheet. */
  function warpSVG(corners) {
    const d = corners.map((c, i) => `${i ? 'L' : 'M'}${f(c[0])} ${f(c[1])}`).join('') + 'Z';
    let s = `<path class="ac-quad" d="${d}"/>`;
    corners.forEach((c, i) => {
      s += `<rect class="ac-corner" data-corner="${i}" x="${f(c[0] - 8)}" y="${f(c[1] - 8)}" width="16" height="16" rx="3"/>`;
    });
    return s;
  }

  const PRINT_STYLE = `
    .ac-sheet .ac-bg{fill:#fff}
    .ac-sheet .ac-line{fill:none;stroke:#111;stroke-width:1.5;stroke-linecap:round}
    .ac-sheet .ac-tk{fill:none;stroke:#111;stroke-width:0.9}
    .ac-sheet .ac-tk-main-0,.ac-sheet .ac-tk-mark-0{stroke-width:1.3}
    .ac-sheet .ac-tk-alt-0,.ac-sheet .ac-tk-alt-1,.ac-sheet .ac-tk-alt-2,.ac-sheet .ac-tk-alt-3{stroke:#555}
    .ac-sheet .ac-tk-mark-0{stroke:#111}
    .ac-sheet text{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;fill:#111;text-anchor:middle;font-variant-numeric:tabular-nums}
    .ac-sheet .ac-lb-alt{fill:#555}
    .ac-sheet .ac-lb-mark{font-style:italic}
    .ac-sheet .ac-lb-cap{font-style:italic;fill:#444}
    .ac-sheet .ac-title{font-family:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;font-weight:600}
    .ac-sheet .ac-unit{fill:#555;font-style:italic}
    .ac-sheet .ac-hair{stroke:#c0392b;stroke-width:1.2;fill:none}
    .ac-sheet .ac-hair-print{stroke-dasharray:6 4}
    .ac-sheet .ac-pin{fill:#c0392b}
    .ac-sheet .ac-read{fill:none;stroke:#c0392b;stroke-width:1.5}
    .ac-sheet .ac-head{font-family:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;text-anchor:start}
    .ac-sheet .ac-small{text-anchor:start;fill:#333}
    .ac-sheet .ac-key{text-anchor:start;fill:#c0392b}
    .ac-sheet .ac-rule{stroke:#111;stroke-width:0.6}
  `;

  /** Greedy word wrap using a width function. */
  function wrap(text, maxW, width) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (cur && width(t) > maxW) {
        lines.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /**
   * A standalone, printable sheet: header, the chart (as laid out by the caller
   * into a box of chartW x chartH placed at y = top), a dashed worked example,
   * and instructions. Returns a full <svg> document string.
   */
  function sheetSVG({ W, Hh, top, chartLayout, edge, title, kicker, formula, keyLine, credit, measure }) {
    const width = (t, fs) => (measure ? measure(t, fs) : t.length * fs * 0.55);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" class="ac-sheet" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}">`;
    s += `<style>${PRINT_STYLE}</style><rect class="ac-bg" width="${W}" height="${Hh}"/>`;
    s += `<text class="ac-head" x="48" y="58" font-size="28">${esc(title)}</text>`;
    s += `<text class="ac-small" x="48" y="84" font-size="13" font-style="italic">${esc(kicker)}</text>`;
    s += `<text class="ac-small" x="48" y="106" font-size="14">${richText(formula)}</text>`;
    s += `<path class="ac-rule" d="M48 ${top - 6}H${W - 48}"/>`;
    s += `<g transform="translate(0 ${top})">${scalesSVG(chartLayout)}${edge}</g>`;
    const foot = top + chartLayout.height + 8;
    s += `<path class="ac-rule" d="M48 ${foot}H${W - 48}"/>`;
    const how =
      'How to use: lay a ruler or any straight edge across the two values you know. Read the third where the edge crosses its scale. Any two determine the third.';
    let y = foot + 22;
    for (const line of wrap(how, W - 96, (t) => width(t, 12.5))) {
      s += `<text class="ac-small" x="48" y="${y}" font-size="12.5">${esc(line)}</text>`;
      y += 17;
    }
    if (keyLine) {
      for (const line of wrap(keyLine, W - 96, (t) => width(t, 12.5))) {
        s += `<text class="ac-key" x="48" y="${y}" font-size="12.5">${esc(line)}</text>`;
        y += 17;
      }
    }
    s += `<text class="ac-small" x="48" y="${Hh - 22}" font-size="10.5" fill="#666">${esc(credit)}</text>`;
    return s + '</svg>';
  }

  return { esc, richText, scalesSVG, clipLine, edgeSVG, warpSVG, PRINT_STYLE, wrap, sheetSVG };
});
