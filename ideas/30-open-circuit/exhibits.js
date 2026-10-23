/* exhibits.js — the collection: how each switch is drawn, how it is handled,
 * and what its plaque says. The mechanisms themselves live in switches.js.
 *
 * Every exhibit is { title, meta, text, credit, model, build(svg), render(),
 * zones, sounds, key }. A zone is an SVG element marked data-zone that the
 * page routes pointer events to; its handler has down / move / up, each
 * returning a list of mechanism events. */
window.Exhibits = (function () {
  'use strict';
  const S = window.Switches;
  const NS = 'http://www.w3.org/2000/svg';
  const W = 240;
  const H = 170;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const DEG = 180 / Math.PI;

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }
  function txt(x, y, s, attrs = {}) {
    return el('text', { x, y, 'text-anchor': 'middle', class: 'legend', ...attrs }, s);
  }
  function zone(e, name, cursor = 'grab') {
    e.setAttribute('data-zone', name);
    e.setAttribute('class', `zone ${cursor}`);
    return e;
  }
  function hit(x, y, w, h, name, cursor) {
    return zone(el('rect', { x, y, width: w, height: h, fill: 'transparent' }), name, cursor);
  }
  const angleAround = (cx, cy, pt) => Math.atan2(pt.x - cx, -(pt.y - cy)) * DEG; // 0 = up, clockwise

  /* ------------------------------------------------- zone handler helpers */
  // A handle you drag along one axis. value(pt) maps a pointer to the model's
  // units; the drag is relative to where you grabbed.
  function dragZone(model, value, tapArg) {
    let v0 = 0;
    let p0 = 0;
    return {
      down(pt) {
        v0 = model.pos;
        p0 = value(pt);
        return model.grab();
      },
      move(pt) {
        return model.drag(v0 + value(pt) - p0);
      },
      up(pt, info) {
        const ev = model.release();
        if (info.tap) ev.push(...model.tap(typeof tapArg === 'function' ? tapArg(pt) : tapArg));
        return ev;
      },
    };
  }
  // A knob you turn: angle is accumulated so turning past the dead zone is sane.
  function turnZone(model, cx, cy, tapArg) {
    let last = 0;
    let acc = 0;
    return {
      down(pt) {
        last = angleAround(cx, cy, pt);
        acc = model.pos;
        return model.grab();
      },
      move(pt) {
        const a = angleAround(cx, cy, pt);
        let d = a - last;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        last = a;
        acc += d;
        return model.drag(acc);
      },
      up(pt, info) {
        const ev = model.release();
        if (info.tap) ev.push(...model.tap(typeof tapArg === 'function' ? tapArg(pt) : tapArg));
        return ev;
      },
    };
  }
  // A button you push. A very quick tap is held down long enough to click.
  function pressZone(model) {
    return {
      down() {
        return model.press();
      },
      up(pt, info) {
        if (info.held < 0.1) return model.tap(0.11 - info.held);
        return model.release();
      },
    };
  }

  /* ----------------------------------------------------- shared drawings */
  // A bat-handle toggle seen from the front. The lever points at you and tips
  // up or down; the ball looks bigger when it points straight out.
  function batHandle(g, cx, cy, r, throwY, legends) {
    const s = r / 36;
    g.append(
      el('circle', { cx, cy, r, fill: 'url(#gMetal)', stroke: 'var(--metal-lo)', 'stroke-width': 1 }),
      el('circle', { cx, cy, r: r * 0.74, fill: 'url(#gMetalDown)' }),
      el('circle', { cx, cy, r: r * 0.5, fill: '#15161a' }),
    );
    if (legends) {
      g.append(txt(cx, cy - throwY - r * 0.42 - 9, 'ON'), txt(cx, cy + throwY + r * 0.42 + 16, 'OFF'));
    }
    const lever = el('g', { filter: 'url(#fShadow)' });
    const shaft = el('path', { fill: 'url(#gMetalH)', stroke: 'var(--metal-lo)', 'stroke-width': 0.6 });
    const ball = el('circle', { cx, cy, r: r * 0.36, fill: 'url(#rBall)' });
    lever.append(shaft, ball);
    g.append(lever);
    return {
      render(pos) {
        const ty = cy - throwY * pos;
        shaft.setAttribute('d', `M${cx - 7 * s} ${cy} L${cx - 5 * s} ${ty} L${cx + 5 * s} ${ty} L${cx + 7 * s} ${cy} Z`);
        ball.setAttribute('cy', ty);
        ball.setAttribute('r', r * 0.36 * (1 + 0.28 * (1 - Math.abs(pos))));
      },
    };
  }

  /* ================================================================ 1 toggle */
  function toggle() {
    const model = new S.Toggle();
    let draw;
    return {
      title: 'Toggle switch, bat handle',
      meta: 'Nickel-plated brass, phenolic. Single pole, single throw. 15 A at 125 V.',
      text: 'Push the lever slowly. Nothing happens until it passes the middle, and then the contacts change over whether you have finished or not. This is called over-centre action, and it is why a toggle cannot be left half on. Wired to nothing.',
      credit: 'Gift of the maker',
      model,
      sounds: {},
      build(svg) {
        const g = el('g');
        draw = batHandle(g, 120, 86, 36, 40, true);
        g.append(hit(60, 18, 120, 140, 'lever'));
        svg.append(g);
      },
      render() {
        draw.render(model.pos);
      },
      zones: { lever: dragZone(model, (pt) => -pt.y / 40) },
      key(k) {
        if (k === 'up') return model.set(true);
        if (k === 'down') return model.set(false);
        return model.tap();
      },
      state: () => (model.on ? 'on' : 'off'),
    };
  }

  /* ================================================================ 2 rotary */
  function rotary() {
    const model = new S.Detented({ positions: 8, spacing: 30, index: 0 });
    const cx = 120;
    const cy = 92;
    let knob;
    const screenAngle = (a) => a - model.sweep / 2;
    return {
      title: 'Rotary selector',
      meta: 'Bakelite knob, chromed skirt. 8 positions, 1 pole.',
      text: 'Eight rest positions, each with a detent, so the switch is never found between two settings. A previous owner labelled them 1 to 8 and left no note of what they selected. Wired to nothing.',
      credit: 'Purchased, 1974',
      model,
      sounds: { detent: 'detent' },
      build(svg) {
        const g = el('g');
        g.append(el('circle', { cx, cy, r: 60, fill: 'url(#gMetalH)', stroke: 'var(--metal-lo)', 'stroke-width': 1 }));
        for (let i = 0; i < model.n; i++) {
          const a = (screenAngle(i * model.spacing) * Math.PI) / 180;
          const sx = Math.sin(a);
          const cyy = -Math.cos(a);
          g.append(
            el('line', { x1: cx + 63 * sx, y1: cy + 63 * cyy, x2: cx + 70 * sx, y2: cy + 70 * cyy, stroke: 'var(--ink-soft)', 'stroke-width': 1.5 }),
            txt(cx + 80 * sx, cy + 80 * cyy + 3.5, String(i + 1), { class: 'legend small' }),
          );
        }
        g.append(el('circle', { cx, cy, r: 44, fill: '#0e0e10' }));
        knob = el('g');
        knob.append(
          el('circle', { cx, cy, r: 42, fill: 'url(#rBakelite)', stroke: '#000', 'stroke-width': 0.5 }),
          el('circle', { cx, cy, r: 38, fill: 'none', stroke: '#000', 'stroke-opacity': 0.5, 'stroke-width': 3, 'stroke-dasharray': '2.5 3.4' }),
          el('rect', { x: cx - 2.5, y: cy - 38, width: 5, height: 20, rx: 2, fill: '#f3f0e6' }),
          el('circle', { cx: cx - 12, cy: cy - 14, r: 10, fill: '#fff', 'fill-opacity': 0.06 }),
        );
        g.append(knob, zone(el('circle', { cx, cy, r: 58, fill: 'transparent' }), 'knob'));
        svg.append(g);
      },
      render() {
        knob.setAttribute('transform', `rotate(${screenAngle(model.pos)} ${cx} ${cy})`);
      },
      zones: { knob: turnZone(model, cx, cy, (pt) => (pt.x >= cx ? 1 : -1)) },
      key(k) {
        if (k === 'left' || k === 'down') return model.tap(-1);
        return model.tap(1);
      },
      state: () => `position ${model.index + 1} of ${model.n}`,
    };
  }

  /* ========================================================= 3 light switch */
  function lightSwitch() {
    const model = new S.Toggle({ on: !document.documentElement.classList.contains('dark') });
    let top;
    let bottom;
    let mark;
    const cx = 120;
    const cy = 84;
    return {
      title: 'Light switch',
      meta: 'White urea plastic, 10 AX, c. 1985.',
      text: 'Connected to the gallery lighting, one of two exhibits connected to the building. Visitors ask whether it is part of the collection. It is.',
      credit: 'On loan from the building',
      model,
      sounds: { snap: 'rocker' },
      lighting: true,
      build(svg) {
        const g = el('g');
        g.append(
          el('rect', { x: 70, y: 34, width: 100, height: 100, rx: 5, fill: 'url(#gPlastic)', stroke: 'var(--plastic-lo)', 'stroke-width': 1, filter: 'url(#fShadow)' }),
          el('circle', { cx: 84, cy, r: 3, fill: 'var(--plastic-lo)' }),
          el('circle', { cx: 156, cy, r: 3, fill: 'var(--plastic-lo)' }),
          el('rect', { x: cx - 19, y: cy - 33, width: 38, height: 66, rx: 2, fill: '#000', 'fill-opacity': 0.25 }),
        );
        top = el('polygon', { fill: 'url(#gPlastic)', stroke: 'var(--plastic-lo)', 'stroke-width': 0.7 });
        bottom = el('polygon', { fill: 'url(#gPlastic)', stroke: 'var(--plastic-lo)', 'stroke-width': 0.7 });
        mark = el('rect', { x: cx - 9, y: cy + 2, width: 18, height: 3, rx: 1, fill: 'var(--red)' });
        g.append(top, bottom, mark, txt(cx, 156, 'LIGHTING'), hit(70, 34, 100, 100, 'rocker'));
        svg.append(g);
      },
      render() {
        const p = model.pos; // +1: bottom pressed in (lights on), -1: top pressed in
        const ht = 32 * (1 + 0.22 * p);
        const hb = 32 * (1 - 0.22 * p);
        const wt = 18 * (1 + 0.07 * p);
        const wb = 18 * (1 - 0.07 * p);
        top.setAttribute('points', `${cx - wt},${cy - ht} ${cx + wt},${cy - ht} ${cx + 18},${cy} ${cx - 18},${cy}`);
        bottom.setAttribute('points', `${cx - 18},${cy} ${cx + 18},${cy} ${cx + wb},${cy + hb} ${cx - wb},${cy + hb}`);
        top.setAttribute('fill-opacity', 1 - 0.18 * Math.max(0, -p));
        bottom.setAttribute('fill-opacity', 1 - 0.18 * Math.max(0, p));
        mark.setAttribute('opacity', clamp(p, 0, 1));
      },
      zones: { rocker: dragZone(model, (pt) => pt.y / 30) },
      key(k) {
        if (k === 'up') return model.set(false);
        if (k === 'down') return model.set(true);
        return model.tap();
      },
      state: () => (model.on ? 'lights on' : 'lights off'),
    };
  }

  /* =========================================================== 4 slide (sound) */
  function slide() {
    const model = new S.Detented({ positions: 3, spacing: 1, index: 2 });
    const xs = [72, 120, 168];
    let thumb;
    return {
      title: 'Slide switch',
      meta: 'Three positions, DPDT, from a transistor radio.',
      text: 'Connected to the museum loudspeakers: OFF, QUIET, FULL. Also part of the collection, and also on loan.',
      credit: 'On loan from the building',
      model,
      sounds: { detent: 'slide' },
      loudspeakers: true,
      build(svg) {
        const g = el('g');
        g.append(
          txt(120, 46, 'LOUDSPEAKERS'),
          el('rect', { x: 45, y: 60, width: 150, height: 46, rx: 4, fill: 'url(#gMetal)', stroke: 'var(--metal-lo)', 'stroke-width': 1, filter: 'url(#fShadow)' }),
          el('rect', { x: 60, y: 78, width: 120, height: 10, rx: 2, fill: '#101114' }),
        );
        thumb = el('g', { filter: 'url(#fShadow)' });
        thumb.append(
          el('rect', { x: -12, y: -17, width: 24, height: 34, rx: 3, fill: 'url(#rBakelite)', stroke: '#000', 'stroke-width': 0.5 }),
          el('line', { x1: -5, y1: -10, x2: -5, y2: 10, stroke: '#000', 'stroke-opacity': 0.6 }),
          el('line', { x1: 0, y1: -10, x2: 0, y2: 10, stroke: '#000', 'stroke-opacity': 0.6 }),
          el('line', { x1: 5, y1: -10, x2: 5, y2: 10, stroke: '#000', 'stroke-opacity': 0.6 }),
        );
        g.append(thumb);
        ['OFF', 'QUIET', 'FULL'].forEach((s, i) => g.append(txt(xs[i], 128, s, { class: 'legend small' })));
        g.append(hit(45, 56, 150, 54, 'thumb'));
        svg.append(g);
      },
      render() {
        thumb.setAttribute('transform', `translate(${72 + model.pos * 48} 83)`);
      },
      zones: { thumb: dragZone(model, (pt) => pt.x / 48, (pt) => (pt.x > 72 + model.pos * 48 ? 1 : -1)) },
      key(k) {
        if (k === 'left' || k === 'down') return model.tap(-1);
        return model.tap(1);
      },
      state: () => ['sound off', 'sound quiet', 'sound full'][model.index],
    };
  }

  /* ============================================================ 5 bell push */
  function bellPush() {
    const model = new S.Momentary();
    let cap;
    let capShade;
    const cx = 120;
    const cy = 74;
    return {
      title: 'Bell push',
      meta: 'Brass, ivory button, c. 1910.',
      text: 'Momentary: closed while pressed, open the instant you let go. The chime it once rang is in another museum.',
      credit: 'Found in a drawer',
      model,
      sounds: { down: 'down', up: 'up' },
      build(svg) {
        const g = el('g');
        g.append(
          el('rect', { x: 82, y: 22, width: 76, height: 120, rx: 7, fill: 'url(#gBrass)', stroke: 'var(--brass-lo)', 'stroke-width': 1, filter: 'url(#fShadow)' }),
          el('rect', { x: 86, y: 26, width: 68, height: 112, rx: 5, fill: 'none', stroke: 'var(--brass-hi)', 'stroke-opacity': 0.5, 'stroke-width': 0.8 }),
          ...[
            [91, 31],
            [149, 31],
            [91, 133],
            [149, 133],
          ].map(([x, y]) => el('circle', { cx: x, cy: y, r: 2.4, fill: 'var(--brass-lo)' })),
          el('circle', { cx, cy, r: 25, fill: 'var(--brass-lo)' }),
          el('circle', { cx, cy, r: 23, fill: 'url(#gBrassDown)' }),
          txt(cx, 125, 'PRESS', { class: 'legend engraved' }),
        );
        capShade = el('circle', { cx, cy, r: 18, fill: '#000', 'fill-opacity': 0.35 });
        cap = el('circle', { cx, cy, r: 18, fill: 'url(#rIvory)', stroke: 'var(--ivory-lo)', 'stroke-width': 0.5 });
        g.append(capShade, cap, zone(el('circle', { cx, cy, r: 28, fill: 'transparent' }), 'button', 'press'));
        svg.append(g);
      },
      render() {
        const d = model.depth;
        cap.setAttribute('r', 18 - 2.5 * d);
        cap.setAttribute('cy', cy + 1.5 * d);
        capShade.setAttribute('cy', cy + 2.5 - 2 * d);
      },
      zones: { button: pressZone(model) },
      key() {
        return model.tap();
      },
      state: () => (model.closed ? 'pressed' : 'released'),
    };
  }

  /* ======================================================== 6 push-on push-off */
  function pushOnOff() {
    const model = new S.Latching();
    let cap;
    let lamp;
    const cx = 120;
    const cy = 82;
    return {
      title: 'Push-on, push-off button',
      meta: 'From an instrument panel. Cam and ratchet, lamp in the cap.',
      text: 'The mechanism inside is the one in a retractable ballpoint pen: push once and it stays down; push again and it comes up. It does not take unless you push it all the way. The lamp is wired to nothing, like the rest of it.',
      credit: 'Deaccessioned by a laboratory',
      model,
      sounds: { click: 'click', latch: 'latch', unlatch: 'unlatch', seat: 'unlatch' },
      build(svg) {
        const g = el('g');
        g.append(
          el('rect', { x: 66, y: 28, width: 108, height: 108, rx: 6, fill: 'var(--panel)', stroke: 'var(--panel-edge)', 'stroke-width': 1, filter: 'url(#fShadow)' }),
          el('rect', { x: cx - 30, y: cy - 30, width: 60, height: 60, rx: 4, fill: 'url(#gMetal)', stroke: 'var(--metal-lo)', 'stroke-width': 1 }),
          el('rect', { x: cx - 24, y: cy - 24, width: 48, height: 48, rx: 3, fill: '#101114' }),
          txt(cx, 128, 'PUSH ON · PUSH OFF', { class: 'legend small onpanel' }),
        );
        cap = el('g', { filter: 'url(#fShadow)' });
        lamp = el('rect', { x: cx - 20, y: cy - 20, width: 40, height: 40, rx: 3, fill: 'var(--lamp-off)', stroke: '#000', 'stroke-opacity': 0.4, 'stroke-width': 0.8 });
        cap.append(lamp, el('rect', { x: cx - 16, y: cy - 16, width: 32, height: 12, rx: 2, fill: '#fff', 'fill-opacity': 0.12 }));
        g.append(cap, hit(cx - 28, cy - 28, 56, 56, 'button', 'press'));
        svg.append(g);
      },
      render() {
        const d = model.depth;
        cap.setAttribute('transform', `translate(0 ${4 * d}) translate(${cx} ${cy}) scale(${1 - 0.05 * d}) translate(${-cx} ${-cy})`);
      },
      zones: { button: pressZone(model) },
      key() {
        return model.tap();
      },
      state: () => (model.latched ? 'latched down' : 'up'),
    };
  }

  /* ========================================================== 7 keyboard key */
  function anyKey() {
    const model = new S.Momentary({ closeAt: 0.55, openAt: 0.4, bottom: true });
    let top;
    let front;
    let side;
    let label;
    const x = 92;
    const y = 40;
    const w = 56;
    const travel = 8;
    return {
      title: 'Keyboard key, “Any”',
      meta: 'Removed from a 1987 keyboard at the request of a help desk.',
      text: 'Tactile and clicky: it clicks at 2.2 mm of its 4 mm travel, then bottoms out. Types nothing.',
      credit: 'Gift of a help desk',
      model,
      sounds: { down: 'keydown', up: 'keyup', bottom: 'bottom' },
      build(svg) {
        const g = el('g');
        g.append(el('rect', { x: x - 12, y: y - 8, width: w + 24, height: w + 32, rx: 4, fill: 'var(--panel)', stroke: 'var(--panel-edge)', 'stroke-width': 1, filter: 'url(#fShadow)' }));
        g.append(el('rect', { x: x - 2, y: y + 2, width: w + 4, height: w + 10, rx: 3, fill: '#0e0f12' }));
        side = el('polygon', { fill: 'var(--key-side)' });
        front = el('polygon', { fill: 'var(--key-front)' });
        top = el('rect', { x, y, width: w, height: w, rx: 6, fill: 'url(#gKey)', stroke: 'var(--key-edge)', 'stroke-width': 0.8 });
        label = txt(x + w / 2, y + w / 2 + 6, 'Any', { class: 'keylegend' });
        g.append(side, front, top, label, hit(x - 6, y - 6, w + 12, w + 26, 'key', 'press'));
        svg.append(g);
      },
      render() {
        const d = model.depth * travel;
        const h = travel + 4 - d; // height of the visible front face
        top.setAttribute('y', y + d);
        label.setAttribute('y', y + d + w / 2 + 6);
        front.setAttribute('points', `${x + 2},${y + d + w - 2} ${x + w - 2},${y + d + w - 2} ${x + w - 2},${y + d + w + h - 2} ${x + 2},${y + d + w + h - 2}`);
        side.setAttribute('points', `${x + w - 4},${y + d + 6} ${x + w + 2},${y + d + 10} ${x + w + 2},${y + d + w + h - 6} ${x + w - 4},${y + d + w - 2}`);
      },
      zones: { key: pressZone(model) },
      key() {
        return model.tap();
      },
      state: () => (model.closed ? 'actuated' : 'up'),
    };
  }

  /* ================================================================== 8 dip */
  function dip() {
    const model = new S.Dip({ ways: 8, bits: [0, 1, 0, 1, 1, 0, 1, 0] });
    const nubs = [];
    let sel;
    const x0 = 52;
    const pitch = 17;
    return {
      title: 'DIP switch',
      meta: '8 way, from a modem.',
      text: 'Set with a fingernail or a small screwdriver. The setting configures nothing.',
      credit: 'Salvaged',
      model,
      sounds: { tick: 'tick' },
      build(svg) {
        const g = el('g');
        g.append(
          el('rect', { x: 40, y: 56, width: 160, height: 58, rx: 3, fill: 'var(--dip)', stroke: 'var(--dip-edge)', 'stroke-width': 1, filter: 'url(#fShadow)' }),
          txt(46, 70, 'ON', { class: 'legend tiny ondip', 'text-anchor': 'start' }),
          el('path', { d: 'M62 69 l3 -5 l3 5 z', fill: 'var(--dip-ink)' }),
        );
        for (let i = 0; i < 8; i++) {
          const sx = x0 + i * pitch;
          g.append(el('rect', { x: sx, y: 72, width: 12, height: 34, rx: 1.5, fill: '#0b1226' }));
          const nub = el('rect', { x: sx + 1, y: 73, width: 10, height: 14, rx: 1.2, fill: 'url(#gPlastic)', stroke: '#000', 'stroke-opacity': 0.3, 'stroke-width': 0.5 });
          nubs.push(nub);
          g.append(nub, txt(sx + 6, 124, String(i + 1), { class: 'legend small' }));
          g.append(hit(sx - 2, 60, pitch, 54, `way${i}`, 'press'));
        }
        g.append(txt(120, 44, 'SETTINGS'));
        // the way the keyboard is pointing at; shown only while focused from the keyboard
        sel = el('rect', { y: 69, width: 16, height: 62, rx: 2.5, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 1.5, class: 'kbd-only' });
        g.append(sel);
        svg.append(g);
      },
      render() {
        model.bits.forEach((b, i) => nubs[i].setAttribute('y', b ? 73 : 91));
        sel.setAttribute('x', x0 + model.selected * pitch - 2);
      },
      zones: Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [
          `way${i}`,
          {
            up(pt, info) {
              return info.tap || info.held < 0.6 ? model.flip(i) : [];
            },
          },
        ]),
      ),
      // Left and Right choose a way; Up puts it ON, Down OFF; Enter or Space flips it.
      key(k) {
        if (k === 'left') return model.select(-1);
        if (k === 'right') return model.select(1);
        if (k === 'up') return model.set(model.selected, true);
        if (k === 'down') return model.set(model.selected, false);
        return model.flip(model.selected);
      },
      note: () => `Present setting: ${model.toString()}.`,
      state: () => `set to ${model.toString()}; way ${model.selected + 1} selected, ${model.bits[model.selected] ? 'on' : 'off'}`,
    };
  }

  /* =========================================================== 9 pull chain */
  function pullChain() {
    const model = new S.PullChain();
    let chain;
    let chainHi;
    let link;
    let bob;
    const cx = 150;
    const top = 64;
    const rest = 100;
    const reach = 40;
    return {
      title: 'Pull-chain lamp holder',
      meta: 'Brass, with beaded chain.',
      text: 'Each full pull advances the ratchet one tooth: pull, and it changes; pull again, and it changes back. A short pull changes nothing, and hanging on changes nothing more. The lamp is in storage.',
      credit: 'From a stairwell',
      model,
      sounds: { bead: 'tick', clunk: 'clunk' },
      build(svg) {
        const g = el('g');
        g.append(
          el('rect', { x: 90, y: 14, width: 60, height: 12, rx: 2, fill: 'url(#gBrass)', stroke: 'var(--brass-lo)', 'stroke-width': 0.8 }),
          el('rect', { x: 94, y: 26, width: 52, height: 40, rx: 3, fill: 'url(#gBrassH)', stroke: 'var(--brass-lo)', 'stroke-width': 0.8, filter: 'url(#fShadow)' }),
          ...[34, 42, 50, 58].map((yy) => el('line', { x1: 96, y1: yy, x2: 144, y2: yy, stroke: 'var(--brass-lo)', 'stroke-opacity': 0.5 })),
          el('ellipse', { cx: 120, cy: 66, rx: 22, ry: 6, fill: '#15161a' }),
          el('ellipse', { cx: 120, cy: 66, rx: 16, ry: 4, fill: '#000' }),
          el('rect', { x: cx - 6, y: 54, width: 12, height: 10, rx: 2, fill: 'url(#gBrass)', stroke: 'var(--brass-lo)', 'stroke-width': 0.8 }),
          txt(30, 160, 'LAMP IN STORAGE', { class: 'legend small', 'text-anchor': 'start' }),
        );
        link = el('line', { x1: cx, y1: top, x2: cx, y2: rest, stroke: 'var(--brass-lo)', 'stroke-width': 1.4 });
        chain = el('line', { x1: cx, y1: top, x2: cx, y2: rest, stroke: 'var(--brass)', 'stroke-width': 5.5, 'stroke-linecap': 'round', 'stroke-dasharray': '0 7' });
        chainHi = el('line', { x1: cx - 1, y1: top, x2: cx - 1, y2: rest, stroke: 'var(--brass-hi)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-dasharray': '0 7' });
        bob = el('g', { filter: 'url(#fShadow)' });
        bob.append(
          el('rect', { x: cx - 5, y: 0, width: 10, height: 16, rx: 4, fill: 'url(#gBrassH)', stroke: 'var(--brass-lo)', 'stroke-width': 0.6 }),
          el('circle', { cx, cy: 19, r: 5, fill: 'url(#gBrass)', stroke: 'var(--brass-lo)', 'stroke-width': 0.6 }),
        );
        g.append(link, chain, chainHi, bob, hit(cx - 24, 60, 48, 110, 'chain'));
        svg.append(g);
      },
      render() {
        const y = rest + reach * model.pos;
        link.setAttribute('y2', y);
        chain.setAttribute('y2', y);
        chainHi.setAttribute('y2', y);
        chain.setAttribute('stroke-dashoffset', -reach * model.pos);
        chainHi.setAttribute('stroke-dashoffset', -reach * model.pos);
        bob.setAttribute('transform', `translate(0 ${y - 2})`);
      },
      zones: { chain: dragZone(model, (pt) => pt.y / reach) },
      key() {
        return model.tap();
      },
      state: () => (model.on ? 'ratchet on' : 'ratchet off'),
    };
  }

  /* ========================================================== 10 knife switch */
  function knife() {
    const model = new S.Knife({ open: true });
    let blade;
    const hx = 56;
    const hy = 112;
    const OPEN = 52; // degrees lifted when fully open
    return {
      title: 'Knife switch',
      meta: 'Copper, slate base, single pole.',
      text: 'The switch a film villain throws. Let go of it anywhere on the lower half and it drops home with a clack. Thrown, it connects two terminals to each other, and both to nothing.',
      credit: 'From a school physics cupboard',
      model,
      sounds: { clack: 'clack', open: 'open' },
      build(svg) {
        const g = el('g');
        g.append(
          el('rect', { x: 26, y: 118, width: 188, height: 24, rx: 2, fill: 'var(--slate)', stroke: 'var(--slate-edge)', 'stroke-width': 1, filter: 'url(#fShadow)' }),
          el('rect', { x: 26, y: 118, width: 188, height: 3, fill: '#fff', 'fill-opacity': 0.12 }),
          // hinge block and terminal
          el('rect', { x: hx - 12, y: hy - 4, width: 24, height: 22, rx: 2, fill: 'url(#gCopper)', stroke: 'var(--copper-lo)', 'stroke-width': 0.8 }),
          el('circle', { cx: hx - 20, cy: 128, r: 4, fill: 'url(#gBrass)', stroke: 'var(--brass-lo)', 'stroke-width': 0.6 }),
          // jaws and terminal
          el('rect', { x: 172, y: 96, width: 5, height: 22, fill: 'url(#gCopper)', stroke: 'var(--copper-lo)', 'stroke-width': 0.6 }),
          el('rect', { x: 185, y: 96, width: 5, height: 22, fill: 'url(#gCopper)', stroke: 'var(--copper-lo)', 'stroke-width': 0.6 }),
          el('circle', { cx: 202, cy: 128, r: 4, fill: 'url(#gBrass)', stroke: 'var(--brass-lo)', 'stroke-width': 0.6 }),
        );
        blade = el('g', { filter: 'url(#fShadow)' });
        blade.append(
          el('rect', { x: hx - 4, y: hy - 5, width: 134, height: 10, rx: 2, fill: 'url(#gCopper)', stroke: 'var(--copper-lo)', 'stroke-width': 0.8 }),
          el('rect', { x: hx + 96, y: hy - 27, width: 14, height: 24, rx: 3, fill: 'url(#rBakelite)', stroke: '#000', 'stroke-width': 0.5 }),
          el('circle', { cx: hx, cy: hy, r: 3, fill: 'var(--copper-lo)' }),
        );
        g.append(blade, hit(26, 10, 188, 108, 'blade'));
        svg.append(g);
      },
      render() {
        blade.setAttribute('transform', `rotate(${-OPEN * model.pos} ${hx} ${hy})`);
      },
      zones: { blade: turnZone({ // adapter: the Knife's pos is 0..1, the turn zone works in degrees
        get pos() { return -model.pos * OPEN; },
        grab: () => model.grab(),
        drag: (a) => model.drag(-a / OPEN),
        release: () => model.release(),
        tap: () => model.tap(),
      }, hx, hy) },
      key(k) {
        if (k === 'up' && model.target === 0) return model.tap();
        if (k === 'down' && model.target === 1) return model.tap();
        if (k === 'up' || k === 'down') return [];
        return model.tap();
      },
      state: () => (model.closed ? 'closed' : 'open'),
    };
  }

  /* ============================================================= 11 breaker */
  function breaker() {
    const model = new S.Breaker({ state: 'on' });
    let lever;
    let testBtn;
    const test = new S.Momentary({ closeAt: 0.6, openAt: 0.3 });
    const wx = 105;
    const wy = 48;
    const wh = 60;
    return {
      title: 'Miniature circuit breaker',
      meta: '16 A, type B, DIN rail, with the TEST button of an RCBO.',
      text: 'The small button is TEST and trips it. A tripped breaker will not go ON, however hard it is pushed: it must first be pushed fully OFF, then ON. This protects nothing.',
      credit: 'Replaced, and kept',
      model,
      extra: [test],
      sounds: { snap: 'snap', reset: 'reset', trip: 'trip', refuse: 'refuse', click: 'click' },
      build(svg) {
        const g = el('g');
        g.append(
          el('rect', { x: 82, y: 16, width: 76, height: 140, rx: 4, fill: 'url(#gPlastic)', stroke: 'var(--plastic-lo)', 'stroke-width': 1, filter: 'url(#fShadow)' }),
          el('rect', { x: 82, y: 16, width: 76, height: 14, rx: 4, fill: 'var(--plastic-lo)', 'fill-opacity': 0.5 }),
          el('rect', { x: 82, y: 142, width: 76, height: 14, rx: 4, fill: 'var(--plastic-lo)', 'fill-opacity': 0.5 }),
          el('rect', { x: wx, y: wy, width: 30, height: wh, rx: 3, fill: '#1a1b1f' }),
          txt(96, wy + 10, 'ON', { class: 'legend tiny onplastic', 'text-anchor': 'middle' }),
          txt(96, wy + wh - 3, 'OFF', { class: 'legend tiny onplastic', 'text-anchor': 'middle' }),
          txt(120, 126, 'B16', { class: 'legend small onplastic' }),
          txt(145, 140, 'TEST', { class: 'legend tiny onplastic' }),
        );
        lever = el('rect', { x: wx + 3, width: 24, height: 26, rx: 3, fill: 'url(#rBakelite)', stroke: '#000', 'stroke-width': 0.5, filter: 'url(#fShadow)' });
        testBtn = el('circle', { cx: 145, cy: 126, r: 6, fill: 'var(--red)', stroke: 'var(--red-lo)', 'stroke-width': 0.8 });
        g.append(lever, testBtn, hit(wx - 4, wy - 4, 38, wh + 8, 'lever'), zone(el('circle', { cx: 145, cy: 126, r: 11, fill: 'transparent' }), 'test', 'press'));
        svg.append(g);
      },
      render() {
        lever.setAttribute('y', wy + 2 + (1 - model.pos) * (wh - 30));
        testBtn.setAttribute('r', 6 - 1.2 * test.depth);
      },
      zones: {
        lever: dragZone(model, (pt) => -pt.y / (wh - 30)),
        test: {
          down() {
            return test.press();
          },
          up(pt, info) {
            const ev = info.held < 0.1 ? test.tap(0.11 - info.held) : test.release();
            return ev;
          },
        },
      },
      // The TEST button's own 'down' event is what trips the breaker.
      onEvent(e, source) {
        if (source === test && e === 'down') return model.test();
        return null;
      },
      // Left and Right press TEST; Up pushes the lever toward ON, Down toward OFF
      // (which is how a tripped breaker is reset); Enter or Space flips it.
      key(k) {
        if (k === 'left' || k === 'right') return test.tap();
        if (k === 'up') return model.push(1);
        if (k === 'down') return model.push(-1);
        return model.tap();
      },
      state: () => (model.state === 'tripped' ? 'tripped; push it fully OFF to reset' : model.state),
    };
  }

  /* ======================================================= 12 guarded toggle */
  function guarded() {
    const model = new S.Guarded();
    let draw;
    let cover;
    let coverFace;
    const cx = 120;
    const cy = 92;
    const hingeY = 36;
    const coverH = 100;
    const OPEN = 112; // degrees the cover flips back when open
    const coverModel = {
      get pos() { return model.cover; },
      grab: () => model.coverGrab(),
      drag: (c) => model.coverDrag(c),
      release: () => model.coverRelease(),
      tap: () => model.coverTap(),
    };
    return {
      title: 'Guarded toggle',
      meta: 'Red safety cover, from a cockpit.',
      text: 'The cover must be lifted before the switch can be moved, and closing the cover forces the switch OFF. Nothing is armed.',
      credit: 'Surplus',
      model,
      sounds: { snap: 'snap', lift: 'lift', drop: 'drop', blocked: 'blocked' },
      build(svg) {
        const g = el('g');
        g.append(el('rect', { x: 68, y: 22, width: 104, height: 132, rx: 6, fill: 'var(--panel)', stroke: 'var(--panel-edge)', 'stroke-width': 1, filter: 'url(#fShadow)' }));
        draw = batHandle(g, cx, cy, 30, 34, false);
        g.append(txt(84, 61, 'ARM', { class: 'legend small onpanel' }), txt(84, 130, 'SAFE', { class: 'legend small onpanel' }));
        g.append(hit(88, 46, 64, 94, 'lever'));
        // hinge pins on the panel; the cover flips up and back about the hinge line
        g.append(el('rect', { x: cx - 30, y: hingeY - 4, width: 60, height: 8, rx: 3, fill: 'url(#gMetal)', stroke: 'var(--metal-lo)', 'stroke-width': 0.6 }));
        cover = el('g', { filter: 'url(#fShadow)' });
        coverFace = el('rect', { x: cx - 24, y: hingeY, width: 48, height: coverH, rx: 8, fill: 'url(#gRed)', stroke: 'var(--red-lo)', 'stroke-width': 1 });
        cover.append(
          coverFace,
          el('rect', { x: cx - 18, y: hingeY + 10, width: 36, height: coverH - 18, rx: 6, fill: 'none', stroke: '#fff', 'stroke-opacity': 0.25, 'stroke-width': 1 }),
          el('rect', { x: cx - 24, y: hingeY, width: 48, height: 6, rx: 2, fill: 'var(--red-lo)' }),
          hit(cx - 30, hingeY - 2, 60, coverH + 4, 'cover'),
        );
        g.append(cover);
        svg.append(g);
      },
      render() {
        draw.render(model.toggle.pos);
        // Seen from the front, a cover hinged along its top edge foreshortens as it
        // lifts, passes edge-on at 90 degrees, then shows its underside above the hinge.
        const k = Math.cos((OPEN * model.cover * Math.PI) / 180);
        const sy = Math.abs(k) < 0.04 ? (k < 0 ? -0.04 : 0.04) : k;
        cover.setAttribute('transform', `translate(0 ${hingeY}) scale(1 ${sy}) translate(0 ${-hingeY})`);
        coverFace.setAttribute('fill', k < 0 ? 'var(--red-lo)' : 'url(#gRed)');
      },
      zones: {
        lever: dragZone(model, (pt) => -pt.y / 34),
        // lifting the cover: drag it upward
        cover: dragZone(coverModel, (pt) => -pt.y / 70),
      },
      key(k) {
        if (k === 'left' || k === 'right') return model.coverTap();
        if (k === 'up') return model.toggleUsable ? model.toggle.set(true) : ['blocked'];
        if (k === 'down') return model.toggleUsable ? model.toggle.set(false) : ['blocked'];
        return model.tap();
      },
      state: () => `${model.coverOpen ? 'cover up' : 'cover down'}, ${model.toggle.on ? 'armed' : 'safe'}`,
    };
  }

  /* ================================================================ 13 e-stop */
  function estop() {
    const model = new S.EStop();
    let head;
    let shadow;
    const cx = 120;
    const cy = 88;
    return {
      title: 'Emergency stop',
      meta: 'Red mushroom head on a yellow collar.',
      text: 'Push to latch. Twist to release. Stops nothing. Please do not use in an emergency.',
      credit: 'From a machine that no longer exists',
      model,
      sounds: { thunk: 'thunk', pop: 'pop', dead: 'dead' },
      build(svg) {
        const g = el('g');
        g.append(
          el('circle', { cx, cy, r: 58, fill: 'url(#gYellow)', stroke: 'var(--yellow-lo)', 'stroke-width': 1, filter: 'url(#fShadow)' }),
          el('circle', { cx, cy, r: 48, fill: 'none', stroke: '#000', 'stroke-opacity': 0.25, 'stroke-width': 1 }),
          txt(cx, cy - 50, 'EMERGENCY', { class: 'legend tiny oncollar' }),
          txt(cx, cy + 54, 'STOP', { class: 'legend tiny oncollar' }),
          el('circle', { cx, cy, r: 40, fill: '#14100f' }),
        );
        shadow = el('ellipse', { cx, cy: cy + 8, rx: 36, ry: 36, fill: '#000', 'fill-opacity': 0.4 });
        head = el('g');
        head.append(
          el('circle', { cx, cy, r: 36, fill: 'url(#rRed)', stroke: 'var(--red-lo)', 'stroke-width': 1 }),
          el('path', { d: `M${cx - 20} ${cy - 6} a 22 22 0 0 1 14 -14`, fill: 'none', stroke: '#fff', 'stroke-opacity': 0.8, 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
          el('path', { d: `M${cx + 20} ${cy + 6} a 22 22 0 0 1 -14 14`, fill: 'none', stroke: '#fff', 'stroke-opacity': 0.8, 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
          el('path', { d: `M${cx - 9} ${cy - 24} l 4 5 l -6 2 z`, fill: '#fff', 'fill-opacity': 0.8 }),
          el('path', { d: `M${cx + 9} ${cy + 24} l -4 -5 l 6 -2 z`, fill: '#fff', 'fill-opacity': 0.8 }),
        );
        g.append(shadow, head, zone(el('circle', { cx, cy, r: 42, fill: 'transparent' }), 'head', 'press'));
        svg.append(g);
      },
      render() {
        const d = model.depth;
        head.setAttribute('transform', `translate(0 ${7 * d}) rotate(${model.twist} ${cx} ${cy})`);
        shadow.setAttribute('cy', cy + 8 - 6 * d);
        shadow.setAttribute('fill-opacity', 0.4 - 0.25 * d);
      },
      zones: {
        // Pressing the head latches it at once, tapped or held, however the
        // finger wanders; dragging across it twists it.
        head: {
          down(pt) {
            this.x0 = pt.x;
            return model.grab();
          },
          move(pt) {
            // 60 user units across the head for 45 degrees of twist.
            return model.drag(((pt.x - this.x0) / 60) * 45);
          },
          up() {
            return model.release();
          },
        },
      },
      key(k) {
        if (k === 'left' || k === 'right') {
          model.twistGrab();
          const ev = model.twistTo(45);
          model.twistRelease();
          return ev;
        }
        return model.press();
      },
      state: () => (model.latched ? 'latched' : 'released'),
    };
  }

  /* ========================================================= 14 useless box */
  function uselessBox() {
    const model = new S.UselessBox({ seed: (Date.now() % 100000) + 1 });
    let draw;
    let lid;
    let arm;
    let hand;
    const tx = 72;
    const ty = 70; // toggle centre on the lid
    const throwY = 18;
    const boxTop = 84;
    const shoulder = { x: 170, y: 104 };
    const L = 66;
    const tipFrom = { x: 150, y: 92 };
    const tipTo = { x: tx + 3, y: ty - throwY + 2 };
    const ctrl = { x: 150, y: 20 };
    return {
      title: 'Useless machine',
      meta: 'After Minsky and Shannon, 1952. Wood, brass, one toggle.',
      text: 'Wired to one thing only: itself. Switch it on. Conservators note that in more than seventy years it has never once failed to switch itself off, though it has been known to take its time.',
      credit: 'Bequest',
      model,
      sounds: { snap: 'snap', motor: 'motor', creak: 'creak' },
      build(svg) {
        const g = el('g');
        g.append(
          el('rect', { x: 34, y: boxTop, width: 172, height: 64, rx: 4, fill: 'url(#gWood)', stroke: 'var(--wood-lo)', 'stroke-width': 1, filter: 'url(#fShadow)' }),
          el('rect', { x: 34, y: boxTop, width: 172, height: 4, fill: '#fff', 'fill-opacity': 0.15 }),
          el('rect', { x: 118, y: boxTop - 2, width: 84, height: 8, rx: 1, fill: '#0c0a08' }),
        );
        // the arm, visible only above the box
        const clip = el('clipPath', { id: 'cArm' });
        clip.append(el('rect', { x: 0, y: 0, width: W, height: boxTop + 1 }));
        g.append(clip);
        const armG = el('g', { 'clip-path': 'url(#cArm)' });
        arm = el('polyline', { fill: 'none', stroke: 'url(#gMetalH)', 'stroke-width': 7, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
        hand = el('g');
        hand.append(
          el('rect', { x: -6, y: -4, width: 12, height: 9, rx: 3, fill: 'var(--red)', stroke: 'var(--red-lo)', 'stroke-width': 0.6 }),
        );
        armG.append(el('polyline', { fill: 'none', stroke: '#000', 'stroke-opacity': 0.35, 'stroke-width': 9, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'data-shadow': 1 }), arm, hand);
        g.append(armG);
        // lid, hinged at its far end so it stands clear of the arm when open
        lid = el('g', { filter: 'url(#fShadow)' });
        lid.append(
          el('rect', { x: 116, y: boxTop - 6, width: 88, height: 9, rx: 1.5, fill: 'url(#gWood)', stroke: 'var(--wood-lo)', 'stroke-width': 0.8 }),
          el('rect', { x: 116, y: boxTop - 6, width: 88, height: 2, fill: '#fff', 'fill-opacity': 0.2 }),
        );
        g.append(lid);
        const tg = el('g');
        draw = batHandle(tg, tx, ty + 10, 17, throwY, false);
        // The zone covers the lever's whole travel: switched off, its ball hangs
        // down over the front of the box (y ~ 98), and that is where people grab it.
        g.append(tg, hit(40, 24, 64, 90, 'lever'));
        svg.append(g);
        this._armShadow = armG.querySelector('[data-shadow]');
      },
      render() {
        draw.render(model.toggle.pos);
        lid.setAttribute('transform', `rotate(${96 * model.lid} 204 ${boxTop - 1})`);
        const a = model.arm;
        // the hand travels along a curve from the opening to the lever
        const u = 1 - a;
        const tip = {
          x: u * u * tipFrom.x + 2 * u * a * ctrl.x + a * a * tipTo.x,
          y: u * u * tipFrom.y + 2 * u * a * ctrl.y + a * a * tipTo.y,
        };
        // two-link arm from a shoulder inside the box, elbow up
        let dx = tip.x - shoulder.x;
        let dy = tip.y - shoulder.y;
        let d = Math.hypot(dx, dy);
        if (d > 2 * L - 0.01) {
          dx *= (2 * L - 0.01) / d;
          dy *= (2 * L - 0.01) / d;
          d = 2 * L - 0.01;
        }
        const mx = shoulder.x + dx / 2;
        const my = shoulder.y + dy / 2;
        const h = Math.sqrt(Math.max(0, L * L - (d / 2) * (d / 2)));
        const ex = mx + (dy / d) * h;
        const ey = my - (dx / d) * h;
        const pts = `${shoulder.x},${shoulder.y} ${ex},${ey} ${shoulder.x + dx},${shoulder.y + dy}`;
        arm.setAttribute('points', pts);
        this._armShadow.setAttribute('points', pts);
        hand.setAttribute('transform', `translate(${shoulder.x + dx} ${shoulder.y + dy}) rotate(${(Math.atan2(dy, dx) * DEG) + 90})`);
        const show = a > 0.001 ? 1 : 0;
        arm.setAttribute('opacity', show);
        hand.setAttribute('opacity', show);
        this._armShadow.setAttribute('opacity', show);
      },
      zones: { lever: dragZone(model, (pt) => -pt.y / throwY) },
      key(k) {
        if (k === 'up') {
          const ev = model.toggle.set(true);
          if (ev.length) model.provoked();
          return ev;
        }
        if (k === 'down') return model.toggle.set(false);
        return model.tap();
      },
      note: () => (model.flips ? `It has switched itself off ${model.flips} time${model.flips === 1 ? '' : 's'} this visit.` : ''),
      state: () => (model.toggle.on ? 'on (for now)' : 'off'),
    };
  }

  /* ============================================================== 15 tally */
  function tally() {
    const model = new S.Tally();
    const thumb = new S.Momentary({ closeAt: 0.6, openAt: 0.3 });
    const drums = [];
    let thumbG;
    const wx = 84;
    const wy = 86;
    const dw = 18;
    const dh = 28;
    return {
      title: 'Tally counter',
      meta: 'Chromed steel, four drums.',
      text: 'Counts every operation of every exhibit during your visit, including the machine’s and its own. Returns to 0000 after 9999. The total is not kept.',
      credit: 'Museum equipment',
      model,
      extra: [thumb],
      tally: true,
      sounds: { click: 'tally' },
      build(svg) {
        const g = el('g');
        g.append(
          el('circle', { cx: 64, cy: 100, r: 18, fill: 'none', stroke: 'url(#gMetal)', 'stroke-width': 5 }),
          el('rect', { x: 66, y: 66, width: 110, height: 66, rx: 10, fill: 'url(#gChrome)', stroke: 'var(--metal-lo)', 'stroke-width': 1, filter: 'url(#fShadow)' }),
          el('rect', { x: wx - 3, y: wy - 3, width: dw * 4 + 6, height: dh + 6, rx: 3, fill: 'var(--metal-lo)' }),
          el('rect', { x: wx, y: wy, width: dw * 4, height: dh, fill: '#f4f1e8' }),
          el('circle', { cx: 182, cy: 100, r: 7, fill: 'url(#gMetal)', stroke: 'var(--metal-lo)', 'stroke-width': 0.8 }),
          txt(121, 148, 'OPERATIONS', { class: 'legend small' }),
        );
        const clip = el('clipPath', { id: 'cDrums' });
        clip.append(el('rect', { x: wx, y: wy, width: dw * 4, height: dh }));
        g.append(clip);
        const dg = el('g', { 'clip-path': 'url(#cDrums)' });
        for (let i = 0; i < 4; i++) {
          const a = el('text', { x: wx + dw * i + dw / 2, 'text-anchor': 'middle', class: 'drum', 'data-drum': i });
          const b = el('text', { x: wx + dw * i + dw / 2, 'text-anchor': 'middle', class: 'drum', 'data-drum': i });
          dg.append(a, b);
          drums.push([a, b]);
        }
        for (let i = 1; i < 4; i++) dg.append(el('line', { x1: wx + dw * i, y1: wy, x2: wx + dw * i, y2: wy + dh, stroke: '#000', 'stroke-opacity': 0.25 }));
        g.append(dg, el('rect', { x: wx, y: wy, width: dw * 4, height: dh, fill: 'url(#gGlass)' }));
        thumbG = el('g', { filter: 'url(#fShadow)' });
        thumbG.append(
          el('rect', { x: 110, y: 50, width: 24, height: 20, rx: 5, fill: 'url(#gMetal)', stroke: 'var(--metal-lo)', 'stroke-width': 0.8 }),
          el('rect', { x: 118, y: 44, width: 8, height: 10, rx: 2, fill: 'url(#gMetalDown)' }),
        );
        g.append(thumbG, hit(100, 36, 44, 40, 'thumb', 'press'));
        svg.append(g);
      },
      render() {
        // Each drum carries the next only as it rolls from 9 to 0 (see
        // Tally.drums), so at rest every drum is square on its digit.
        model.drums().forEach(({ digit, frac }, i) => {
          const [a, b] = drums[i];
          a.textContent = String(digit);
          b.textContent = String((digit + 1) % 10);
          a.setAttribute('y', wy + dh - 7 + frac * dh);
          b.setAttribute('y', wy + dh - 7 + (frac - 1) * dh);
        });
        thumbG.setAttribute('transform', `translate(0 ${6 * thumb.depth})`);
      },
      zones: {
        thumb: {
          down() {
            return thumb.press();
          },
          up(pt, info) {
            return info.held < 0.1 ? thumb.tap(0.11 - info.held) : thumb.release();
          },
        },
      },
      onEvent(e, source) {
        if (source === thumb && e === 'down') return model.press();
        return null;
      },
      key() {
        return thumb.tap();
      },
      note: () => `Operations so far: ${model.digits()}.`,
      state: () => `reading ${model.digits()}`,
    };
  }

  const collection = [toggle, rotary, lightSwitch, slide, bellPush, pushOnOff, anyKey, dip, pullChain, knife, breaker, guarded, estop, uselessBox, tally];

  return { collection, W, H };
})();
