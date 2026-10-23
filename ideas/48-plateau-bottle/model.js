/* PlateauModel: the numbers behind "The Plateau Bottle".
 *
 * A one-dimensional transient heat model of a rubber hot water bottle in a bed,
 * with or without a latent-heat (lauric acid) jacket between the water and the
 * sleeper. Pure functions, no DOM, no dependencies. index.html carries this file
 * verbatim and check.mjs loads it in Node, so every number on the page and in the
 * README comes from here.
 *
 * Geometry: the bottle is a flat bag lying in a bed. Its top face is split into
 * the part that touches skin (contactFrac) and the part that looks at the duvet;
 * its bottom face lies on the mattress. Each of these three paths is a stack of
 * slabs through the thickness: water -> rubber wall -> [wax slices] -> cover ->
 * boundary. The water is one well-mixed node shared by all three stacks, plus a
 * small edge/neck loss. Wax slices use the enthalpy method, so the melt front is
 * resolved to one slice and the surface temperature is exact between fronts.
 * The skin is a resistance to a 37 C core, or (for skin pressed under body weight)
 * a slab of tissue with heat capacity and optional blood flow (Pennes bioheat).
 *
 * Units: SI throughout (m, kg, s, J, W, K). Temperatures in degrees C; only
 * differences enter the heat equations.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlateauModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- physical constants
  const PHYS = {
    cWater: 4186, // J/(kg K)
    rhoWater: 1000, // kg/m3 (972 at 80 C; using 1000 overstates the stored heat by about 3%)
    hWater: 200, // W/(m2 K), water to wall inside the bottle (free convection; assumed)
    kRubber: 0.13, // W/(m K), natural rubber
    rhoRubber: 1100, // kg/m3, compounded natural rubber (assumed)
    cRubber: 1900, // J/(kg K) (assumed, typical for rubbers)
    // lauric acid (dodecanoic acid), the phase-change material
    TmWax: 43.8, // C: 317 K (NIST); handbooks give 43.6-43.8
    LWax: 175000, // J/kg: middle of the 167-183 kJ/kg range reported for pure lauric acid
    kWaxS: 0.37, // W/(m K), solid at the melting point (Bayram, Aksoz & Marasli 2014)
    kWaxL: 0.19, // W/(m K), liquid: their liquid/solid ratio of 0.52 (older tables give 0.147)
    rhoWaxS: 1007, // kg/m3, solid at 24 C
    rhoWaxL: 868, // kg/m3, liquid at 50 C: the wax swells about 16% when it melts
    cWax: 2020, // J/(kg K), both phases (property-calculator value; not measured)
    // the alternative placement: a sodium acetate trihydrate insert inside the water
    TmSAT: 58, // C
    LSAT: 264000, // J/kg (low end of the 264-289 kJ/kg range)
    cSAT: 2500, // J/(kg K) (assumed)
    rhoSAT: 1450, // kg/m3
    // the bed and the body
    kFoam: 0.04, // W/(m K), mattress foam
    rhoCFoam: 45000, // J/(m3 K): 30 kg/m3 x 1500 J/(kg K)
    kSkin: 0.37, // W/(m K), skin average (epidermis 0.235, dermis 0.445)
    rhoSkin: 1100, // kg/m3
    cSkin: 3500, // J/(kg K)
    rhoCBlood: 4.0e6, // J/(m3 K): blood, 1060 kg/m3 x 3770 J/(kg K), for the perfusion term of a tissue slab
    tog: 0.1, // m2 K/W per tog
  };

  // ---------------------------------------------------------------- the designs
  // The base case is the original used exactly as its makers say: a 2 L bottle
  // filled two thirds full, with water no hotter than 80 C, inside its cover.
  const BASE = {
    waterL: 1.4, // litres of water
    tFill: 80, // C: the top of the 60-80 C range manufacturers recommend
    tRoom: 18, // C, bedroom in winter
    tCore: 37, // C, deep tissue: where the heat that enters the body goes
    tSkinFree: 33, // C, skin surface before the bottle touches it
    faceW: 0.18, // m, width of the flat face
    faceH: 0.28, // m, height of the flat face
    rubberT: 0.002, // m, wall thickness
    bottleMass: 0.35, // kg, empty 2 L bottle (assumed)
    contactFrac: 0.5, // fraction of the top face touching skin
    rTissue: 0.03, // m2 K/W, skin surface to deep tissue (the big unknown; 0.015-0.06 in the nights, up to 5 in the melt-through map)
    tissueDepth: 0, // m: if > 0, the tissue is a conducting slab of this depth (with heat capacity) instead of rTissue
    perfusion: 0, // 1/s: blood flow per volume of that slab (Pennes); 0 = no blood flow, e.g. tissue pressed by body weight
    rAirGap: 0.15, // m2 K/W, loose contact between the top face and the duvet
    duvetTog: 10.5, // a UK winter duvet
    rContact: 0.01, // m2 K/W, wax pouch against the rubber (thin air gaps; assumed)
    rSpacer: 0, // m2 K/W, a felt layer between the rubber and the wax (the redesign uses one)
    uaEdge: 0.05, // W/K, edges and neck to the air under the duvet (assumed)
    foamSlices: 4, // mattress: 4 x 10 mm of foam as nodes, then the rest as a resistance
    foamSliceT: 0.01, // m
    foamRest: 3.75, // m2 K/W, 150 mm of foam below the slices
    hours: 9, // hours simulated after contact begins
    dt: 2, // s, explicit time step (stability is checked in check.mjs)
    preWarmMin: 0, // minutes the bottle lies in the empty bed before anyone touches it
    layout: 'bed', // 'bed', or 'bench' for the first test (bottom face on a 37 C phantom)
    convLiq: 1, // multiplier on liquid-wax conductivity (natural convection; 1 = none)
    kSolid: PHYS.kWaxS, // W/(m K), solid wax (overridable for the sensitivity runs)
    kLiquid: PHYS.kWaxL, // W/(m K), liquid wax
    insertKg: 0, // kg of sodium acetate trihydrate inside the water (patent-style placement)
    latentScale: 1, // 0 makes a 'dummy' jacket: same wax, no phase change (a control in check.mjs)
    flipped: false, // true: the face without a panel meets the skin (matters only for one-panel designs)
  };

  const ORIGINAL = Object.assign({}, BASE, {
    name: 'original',
    waxFaces: 0,
    waxT: 0,
    waxSlices: 0,
    rCover: 0.05, // m2 K/W, a fleece cover, compressed where it is lain on (assumed)
  });

  const REDESIGN = Object.assign({}, BASE, {
    name: 'plateau',
    waxFaces: 2, // a wax panel on both faces, so there is no wrong way round
    waxT: 0.0075, // m: average solid wax per face (two offset layers of 4.3 mm cells)
    waxSlices: 6,
    rSpacer: 0.025, // m2 K/W: 1 mm needle felt (k about 0.04) meters heat into the wax
    rCover: 0.015, // m2 K/W, a thin woven cotton sleeve: the wax does the protecting
  });

  // The first test: the bottle lies on a 37 C water bath under an acrylic plate, which stands in
  // for skin and tissue; a folded duvet covers it. Night A is the night the makers intend; night B
  // is the bad night: kettle-hot water on a 'poor circulation' plate twice as thick.
  const ACRYLIC_K = 0.19; // W/(m K), PMMA
  const BATH_FILM = 0.002; // m2 K/W, stirred water under the plate (h about 500 W/m2K)
  const BENCH_A = { layout: 'bench', contactFrac: 0.8, plateMM: 5, rTissue: 0.005 / ACRYLIC_K + BATH_FILM, tCore: 37, tRoom: 18, tFill: 80 };
  const BENCH_B = Object.assign({}, BENCH_A, { plateMM: 10, rTissue: 0.01 / ACRYLIC_K + BATH_FILM, tFill: 95 });
  // night C: the instructed 80 C fill on a body that drains little heat (a 20 mm plate, about the steady
  // resistance of 40 mm of tissue with no blood flow). It asks whether the wax melts through as filled.
  const BENCH_C = Object.assign({}, BENCH_A, { plateMM: 20, rTissue: 0.02 / ACRYLIC_K + BATH_FILM, tFill: 80 });
  // lying on the bottle: body weight stops the blood flow in the tissue under it; 37 C is 40 mm down
  const PRESSED = { tissueDepth: 0.04, perfusion: 0 };

  // ---------------------------------------------------------------- thresholds
  const LIMITS = {
    longContact: 43, // C: ISO 13732-1 burn threshold, contact of 8 h or longer, all materials
    tenMinutes: 48, // C: ISO 13732-1, contact of 10 min
    sensitive: 42, // C: Fashy's own limit for children and sensitive skin
    warm: 38, // C: about 5 K above resting skin; clearly felt as warm
    isoDose: 480, // min at 43 C: the ISO 8 h line expressed as a thermal dose (CEM43)
    mhDose: 720, // min at 43 C: about 6 h at 44 C, where Moritz & Henriques saw the epidermis die through
  };

  // ---------------------------------------------------------------- helpers
  function area(p) {
    return p.faceW * p.faceH;
  }
  function waxMassPerFace(p) {
    return p.waxFaces ? area(p) * p.waxT * PHYS.rhoWaxS : 0;
  }
  function waxMassTotal(p) {
    return waxMassPerFace(p) * p.waxFaces;
  }
  function insertVolumeL(p) {
    return p.insertKg ? (p.insertKg / PHYS.rhoSAT) * 1000 : 0;
  }
  function waterMass(p) {
    return p.waterL * 1e-3 * PHYS.rhoWater;
  }

  // wax node state -> temperature, melt fraction, and half-slice resistance
  function waxTemp(n) {
    const top = n.capS * n.Tm;
    if (n.H <= top) return n.H / n.capS;
    if (n.H <= top + n.latent) return n.Tm;
    return n.Tm + (n.H - top - n.latent) / n.capS;
  }
  function meltFraction(n) {
    if (!(n.latent > 0)) return n.H > n.capS * n.Tm ? 1 : 0;
    return Math.min(1, Math.max(0, (n.H - n.capS * n.Tm) / n.latent));
  }
  function nodeTemp(n) {
    return n.type === 'wax' ? waxTemp(n) : n.T;
  }
  function halfR(n) {
    if (n.type !== 'wax') return n.dx / 2 / n.k;
    const f = meltFraction(n);
    // the solid part conducts at kS; the liquid part is 16% thicker and conducts at kL x convLiq
    return (n.dx / 2) * ((1 - f) / n.kS + (f * (PHYS.rhoWaxS / PHYS.rhoWaxL)) / (n.kL * n.conv));
  }

  /* One heat path. kind: 'skin' | 'duvet' | 'mattress' | 'top' (bench: top face under a folded duvet). */
  function makeStack(p, kind, hasWax) {
    const nodes = [];
    nodes.push({ type: 'rubber', dx: p.rubberT, k: PHYS.kRubber, cap: PHYS.rhoRubber * PHYS.cRubber * p.rubberT, T: p.tRoom });
    if (hasWax) {
      const dx = p.waxT / p.waxSlices;
      for (let i = 0; i < p.waxSlices; i++) {
        const capS = PHYS.rhoWaxS * PHYS.cWax * dx;
        nodes.push({ type: 'wax', dx, capS, latent: PHYS.rhoWaxS * PHYS.LWax * p.latentScale * dx, Tm: PHYS.TmWax, kS: p.kSolid, kL: p.kLiquid, conv: p.convLiq, H: capS * p.tRoom });
      }
    }
    if (kind === 'mattress') {
      for (let i = 0; i < p.foamSlices; i++) nodes.push({ type: 'foam', dx: p.foamSliceT, k: PHYS.kFoam, cap: PHYS.rhoCFoam * p.foamSliceT, T: p.tRoom });
    }
    const s = { kind, nodes, hasWax, p, G: new Array(nodes.length).fill(0), contact: kind === 'skin' };
    updateConductances(s);
    return s;
  }

  // G[0]: water -> node 0; G[i]: node i-1 -> node i; rOut: last node -> sink; rSurf: last node -> cover surface
  function updateConductances(s) {
    const p = s.p;
    const N = s.nodes;
    s.G[0] = 1 / (1 / PHYS.hWater + halfR(N[0]));
    for (let i = 1; i < N.length; i++) {
      const a = N[i - 1];
      const b = N[i];
      let r = halfR(a) + halfR(b);
      if (a.type === 'rubber' && b.type === 'wax') r += p.rContact + p.rSpacer;
      if (b.type === 'foam' && a.type !== 'foam') r += p.rCover;
      s.G[i] = 1 / r;
    }
    const last = N[N.length - 1];
    if (s.kind === 'mattress') {
      s.rSurf = 0;
      s.rOut = halfR(last) + p.foamRest;
      s.tSink = p.tRoom;
    } else if (s.contact) {
      s.rSurf = halfR(last) + p.rCover;
      if (s.tissue) {
        // a tissue slab: the sink is its first node, half a node below the skin surface
        s.rOut = s.rSurf + s.tissue.dx / 2 / s.tissue.k;
        s.tSink = s.tissue.T[0];
      } else {
        s.rOut = s.rSurf + p.rTissue;
        s.tSink = p.tCore;
      }
    } else {
      // duvet side, or the skin path before contact begins
      s.rSurf = halfR(last) + p.rCover;
      s.rOut = s.rSurf + p.rAirGap + p.duvetTog * PHYS.tog;
      s.tSink = p.tRoom;
    }
  }

  /* Advance one stack by dt. Returns the flux (W/m2) drawn from the water and the flux leaving to the sink. */
  function stepStack(s, tWater, dt) {
    if (s.hasWax) updateConductances(s);
    const N = s.nodes.length;
    const T = new Array(N);
    for (let i = 0; i < N; i++) T[i] = nodeTemp(s.nodes[i]);
    const q = new Array(N + 1);
    q[0] = s.G[0] * (tWater - T[0]);
    for (let i = 1; i < N; i++) q[i] = s.G[i] * (T[i - 1] - T[i]);
    q[N] = (T[N - 1] - s.tSink) / s.rOut;
    for (let i = 0; i < N; i++) {
      const n = s.nodes[i];
      const dH = (q[i] - q[i + 1]) * dt;
      if (n.type === 'wax') n.H += dH;
      else n.T += dH / n.cap;
    }
    return { qIn: q[0], qOut: q[N] };
  }

  function surfaceTemp(s) {
    const tLast = nodeTemp(s.nodes[s.nodes.length - 1]);
    return tLast - ((tLast - s.tSink) / s.rOut) * s.rSurf;
  }
  function stackEnergy(s) {
    let e = 0;
    for (const n of s.nodes) e += n.type === 'wax' ? n.H : n.cap * n.T;
    return e; // J/m2 relative to 0 C
  }
  function stackMelt(s) {
    let f = 0;
    let k = 0;
    for (const n of s.nodes) {
      if (n.type === 'wax') {
        f += meltFraction(n);
        k++;
      }
    }
    return k ? f / k : 0;
  }

  // ---------------------------------------------------------------- tissue as a slab (optional)
  // Pennes bioheat: conduction through tissue of depth d, heat capacity, and blood at 37 C carrying heat away
  // at perfusion w (1/s). The bottom node meets a 37 C core. It starts at the steady profile with the skin
  // surface at tSkinFree. Used for skin that is pressed and drains little heat; rTissue covers the rest.
  function makeTissue(p) {
    const N = Math.max(4, Math.round(p.tissueDepth / 0.002));
    const dx = p.tissueDepth / N;
    const k = PHYS.kSkin;
    const wrc = p.perfusion * PHYS.rhoCBlood; // W/(m3 K)
    const L = wrc > 0 ? Math.sqrt(k / wrc) : 0;
    const T = [];
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * dx;
      const shape = wrc > 0 ? Math.sinh((p.tissueDepth - x) / L) / Math.sinh(p.tissueDepth / L) : (p.tissueDepth - x) / p.tissueDepth;
      T.push(p.tCore + (p.tSkinFree - p.tCore) * shape);
    }
    return { N, dx, k, cap: PHYS.rhoSkin * PHYS.cSkin * dx, wrc, T, tCore: p.tCore };
  }
  function stepTissue(t, qIn, dt) {
    const q = new Array(t.N + 1);
    q[0] = qIn;
    for (let i = 1; i < t.N; i++) q[i] = (t.k / t.dx) * (t.T[i - 1] - t.T[i]);
    q[t.N] = (t.T[t.N - 1] - t.tCore) / (t.dx / 2 / t.k);
    for (let i = 0; i < t.N; i++) t.T[i] += ((q[i] - q[i + 1] - t.wrc * t.dx * (t.T[i] - t.tCore)) * dt) / t.cap;
  }
  /* Steady resistance of the slab, surface to core: (L/k) tanh(d/L), or d/k with no blood flow. */
  function tissueR(depth, perfusion) {
    const wrc = perfusion * PHYS.rhoCBlood;
    if (!(wrc > 0)) return depth / PHYS.kSkin;
    const L = Math.sqrt(PHYS.kSkin / wrc);
    return (L / PHYS.kSkin) * Math.tanh(depth / L);
  }
  /* The perfusion that gives a slab of this depth a given steady resistance (bisection). */
  function perfusionFor(rTarget, depth) {
    let lo = 1e-7;
    let hi = 1;
    for (let i = 0; i < 80; i++) {
      const mid = Math.sqrt(lo * hi);
      if (tissueR(depth, mid) > rTarget) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  // water (+ optional insert) enthalpy <-> temperature
  function waterSide(p) {
    const Cw = (waterMass(p) - insertVolumeL(p) * 1e-3 * PHYS.rhoWater) * PHYS.cWater;
    const m = p.insertKg || 0;
    const C = Cw + m * PHYS.cSAT;
    const Tm = PHYS.TmSAT;
    const L = m * PHYS.LSAT;
    return {
      Cw,
      C,
      temp(H) {
        if (H <= C * Tm) return H / C;
        if (H <= C * Tm + L) return Tm;
        return (H - L) / C;
      },
      // fill: water at tFill, insert solid at room temperature
      H0: Cw * p.tFill + m * PHYS.cSAT * p.tRoom,
      melt(H) {
        return L ? Math.min(1, Math.max(0, (H - C * Tm) / L)) : 0;
      },
    };
  }

  // ---------------------------------------------------------------- the simulation
  function simulate(opts) {
    const p = Object.assign({}, BASE, opts);
    const A = area(p);
    // the face that meets the skin gets the first panel, unless a one-panel bottle is used the wrong way round
    const topWax = p.flipped ? p.waxFaces >= 2 : p.waxFaces >= 1;
    const botWax = p.flipped ? p.waxFaces >= 1 : p.waxFaces >= 2;
    let stacks;
    if (p.layout === 'bench') {
      // bottom face (wax panel 1) on the phantom; the rest of the bottom face and the whole top face under a duvet
      stacks = [
        { s: makeStack(p, 'skin', topWax), A: A * p.contactFrac },
        { s: makeStack(p, 'duvet', topWax), A: A * (1 - p.contactFrac) },
        { s: makeStack(p, 'duvet', botWax), A },
      ];
    } else {
      stacks = [
        { s: makeStack(p, 'skin', topWax), A: A * p.contactFrac },
        { s: makeStack(p, 'duvet', topWax), A: A * (1 - p.contactFrac) },
        { s: makeStack(p, 'mattress', botWax), A },
      ];
    }
    const skin = stacks[0].s;
    if (p.tissueDepth > 0) skin.tissue = makeTissue(p);
    const W = waterSide(p);
    let H = W.H0;
    let tW = W.temp(H);
    const tContact = Math.round(((p.preWarmMin || 0) * 60) / p.dt) * p.dt;
    skin.contact = tContact === 0;
    updateConductances(skin);
    const dt = p.dt;
    const steps = Math.round((tContact + p.hours * 3600) / dt);
    const sampleEvery = Math.max(1, Math.round(60 / dt));

    const energy = () => {
      let e = H;
      for (const st of stacks) e += stackEnergy(st.s) * st.A;
      return e;
    };
    const e0 = energy();
    let eOut = 0;

    const series = { t: [], tWater: [], tSkin: [], melt: [], meltDuvet: [] };
    const m = {
      peakTs: -Infinity,
      tPeak: 0,
      sAbove48: 0,
      sAbove43: 0,
      sAbove42: 0,
      sAbove38: 0,
      sBand: 0, // 38 <= Ts <= 43: warm, and under the all-night burn line
      tWarm: null,
      tCold: null,
      tUnder43: null,
      qBodyJ: 0,
      qLostJ: 0,
      meltMax: 0,
      meltDuvetMax: 0,
      tFullMelt: null,
      tWaterAtContact: null,
      meltAtContact: 0,
      cem43: 0, // min: thermal dose at the skin surface, Sapareto-Dewey (R = 0.5 at or above 43 C, 0.25 below)
      waxMaxT: -Infinity, // C: hottest skin-side wax anywhere, any time (what a leak would put on skin)
    };
    for (let k = 0; k <= steps; k++) {
      const t = k * dt;
      if (!skin.contact && t >= tContact) {
        skin.contact = true;
        updateConductances(skin);
      }
      const tc = t - tContact; // time since contact began
      const melt = stackMelt(skin);
      const meltD = stackMelt(stacks[1].s);
      if (melt > m.meltMax) m.meltMax = melt;
      if (meltD > m.meltDuvetMax) m.meltDuvetMax = meltD;
      if (m.tFullMelt === null && melt >= 0.999) m.tFullMelt = t;
      for (const n of skin.nodes) if (n.type === 'wax') m.waxMaxT = Math.max(m.waxMaxT, waxTemp(n));
      if (tc >= 0) {
        const ts = surfaceTemp(skin);
        if (tc === 0) {
          m.tWaterAtContact = tW;
          m.meltAtContact = melt;
        }
        if (ts > m.peakTs) {
          m.peakTs = ts;
          m.tPeak = tc;
        }
        if (k < steps) {
          m.cem43 += (dt / 60) * Math.pow(ts >= 43 ? 2 : 4, ts - 43);
          if (ts > LIMITS.tenMinutes) m.sAbove48 += dt;
          if (ts > LIMITS.longContact) m.sAbove43 += dt;
          if (ts > LIMITS.sensitive) m.sAbove42 += dt;
          if (ts >= LIMITS.warm) m.sAbove38 += dt;
          if (ts >= LIMITS.warm && ts <= LIMITS.longContact) m.sBand += dt;
        }
        if (m.tWarm === null && ts >= LIMITS.warm) m.tWarm = tc;
        if (m.tWarm !== null && m.tCold === null && ts < LIMITS.warm && tc > m.tPeak) m.tCold = tc;
        if (m.tUnder43 === null && tc > m.tPeak && m.peakTs > LIMITS.longContact && ts <= LIMITS.longContact) m.tUnder43 = tc;
        if (tc % 60 === 0) {
          series.t.push(tc);
          series.tWater.push(tW);
          series.tSkin.push(ts);
          series.melt.push(melt);
          series.meltDuvet.push(meltD);
        }
      }
      if (k === steps) break;
      // step every path, then the water
      let qFromWater = 0;
      let qSkinOut = 0;
      let qOtherOut = 0;
      if (skin.tissue && skin.contact) skin.tSink = skin.tissue.T[0];
      for (let i = 0; i < stacks.length; i++) {
        const r = stepStack(stacks[i].s, tW, dt);
        if (i === 0 && skin.tissue && skin.contact) stepTissue(skin.tissue, r.qOut, dt);
        qFromWater += r.qIn * stacks[i].A;
        if (i === 0 && skin.contact) qSkinOut += r.qOut * stacks[i].A;
        else qOtherOut += r.qOut * stacks[i].A;
      }
      const qEdge = p.uaEdge * (tW - p.tRoom);
      H -= (qFromWater + qEdge) * dt;
      tW = W.temp(H);
      eOut += (qSkinOut + qOtherOut + qEdge) * dt;
      if (tc >= 0) {
        m.qBodyJ += qSkinOut * dt;
        m.qLostJ += (qOtherOut + qEdge) * dt;
      }
    }
    if (m.tCold === null) m.tCold = p.hours * 3600; // still warm when the simulation ends
    const at = (h) => {
      const i = Math.min(series.t.length - 1, Math.round(h * 60));
      return { tWater: series.tWater[i], tSkin: series.tSkin[i], melt: series.melt[i] };
    };
    return {
      params: p,
      series,
      metrics: m,
      at,
      energy: { e0, eEnd: energy(), eOut },
      waxMassPerFace: waxMassPerFace(p),
      waxMassTotal: waxMassTotal(p),
      waterMass: waterMass(p),
    };
  }

  // ---------------------------------------------------------------- closed-form side calculations
  function effusivity(k, rho, c) {
    return Math.sqrt(k * rho * c);
  }
  /* Interface temperature of two semi-infinite bodies pressed together (the first seconds). */
  function contactTemp(t1, e1, t2, e2) {
    return (e1 * t1 + e2 * t2) / (e1 + e2);
  }
  /* Steady skin-surface temperature: a source at tHot behind rWall, the skin with rTissue to tCore. */
  function steadySurface(tHot, rWall, rTissue, tCore) {
    return tCore + ((tHot - tCore) * rTissue) / (rWall + rTissue);
  }
  /* Single time constant of the plain bottle: water + wall heat capacity over the conductance to the sinks. */
  function lumpedTau(p) {
    const A = area(p);
    const rWall = 1 / PHYS.hWater + p.rubberT / PHYS.kRubber + p.rCover;
    const ua = (A * p.contactFrac) / (rWall + p.rTissue) + (A * (1 - p.contactFrac)) / (rWall + p.rAirGap + p.duvetTog * PHYS.tog) + p.uaEdge;
    const C = waterMass(p) * PHYS.cWater + p.bottleMass * PHYS.cRubber;
    return { tau: C / ua, ua, C };
  }
  /* Stefan estimate: time for a melt front to cross a slab of wax with its hot side held at tHot. */
  function stefanMelt(thick, tHot) {
    return (PHYS.rhoWaxS * PHYS.LWax * thick * thick) / (2 * PHYS.kWaxL * (tHot - PHYS.TmWax));
  }
  /* Heat the water holds above the melting point, against what the wax can soak up. */
  function budget(p) {
    const mw = waterMass(p);
    const excess = mw * PHYS.cWater * (p.tFill - PHYS.TmWax);
    const mx = waxMassTotal(p);
    const latent = mx * PHYS.LWax;
    const sensible = mx * PHYS.cWax * (PHYS.TmWax - p.tRoom);
    return { excess, latent, sensible, store: latent + sensible, mw, mx };
  }
  /* The cover a plain bottle would need to keep the skin under the 8 h line at a given water temperature. */
  function coverForLimit(tWater, rTissue, tCore, tLimit) {
    const rWall = 1 / PHYS.hWater + BASE.rubberT / PHYS.kRubber;
    return (rTissue * (tWater - tCore)) / (tLimit - tCore) - rTissue - rWall;
  }

  // ---------------------------------------------------------------- the first test: pass and kill lines
  // Measured on the bench: the temperature between sleeve and plate, for 9 h after filling, on
  // night A (BENCH_A) and night B (BENCH_B), with the plain bottle in fleece and in the thick cover
  // run on the same rig as controls. Warmth is judged against those controls, because late in the
  // night the jacket holds the skin just above 38 C, so absolute hours-in-band swing by hours with a
  // 10% error in the phantom, while the controls move in step with it.
  const TEST = {
    passPeak: 43.0, // C: never above the 8 h burn line, either night, either probe
    killPeak: 43.8, // C: the melting point, which a working jacket cannot exceed while wax is solid (any night, A, B or C)
    bandMarginH: 0.5, // h: night A in-band time must be within this of the thick-cover control to pass
  };
  /* Run a design through the three bench nights. rig(night) returns overrides for an imperfect phantom.
     Nights A and B must stay under the pass line; night C only has to stay under the melting point. */
  function benchTest(design, rig) {
    const R = rig || (() => ({}));
    const run = (d, n) => simulate(Object.assign({}, d, n, R(n)));
    const a = run(design, BENCH_A);
    const b = run(design, BENCH_B);
    const c = run(design, BENCH_C);
    const thickA = run(thickCover(), BENCH_A);
    const plainA = run(ORIGINAL, BENCH_A);
    const peak = Math.max(a.metrics.peakTs, b.metrics.peakTs);
    const peakC = c.metrics.peakTs;
    const band = a.metrics.sBand / 3600;
    const thickBand = thickA.metrics.sBand / 3600;
    const plainBand = plainA.metrics.sBand / 3600;
    let verdict = 'inconclusive';
    if (peak > TEST.killPeak || peakC > TEST.killPeak || band < plainBand) verdict = 'kill';
    else if (peak <= TEST.passPeak && band >= thickBand - TEST.bandMarginH) verdict = 'pass';
    return { verdict, peak, peakC, band, thickBand, plainBand, a, b, c };
  }

  // ---------------------------------------------------------------- bill of materials (GBP per unit at 10,000 a year)
  // low/high in GBP. 'basis' says where each number comes from; most are estimates, labelled as such.
  const BOM = [
    { id: 'bottle', item: '2 L natural-rubber bottle, smooth faces, BS 1970', qty: '1', low: 1.2, high: 2.5, basis: 'estimate: no factory price found; retail is 3-12 GBP and retail is usually 3-5x ex-works' },
    { id: 'wax', item: 'Lauric acid, 98-99%', qty: '0.76 kg', low: 1.3, high: 2.3, basis: 'Argus Asia spot 2,100-2,200 USD/t FOB (Oct 2025) = 1.6 GBP/kg, plus 10-40% for freight, duty and a cosmetic grade' },
    { id: 'film', item: 'PET/PE laminate, 4 cell panels (2 per face)', qty: '0.22 m2', low: 0.15, high: 0.4, basis: 'estimate: ice-pack film at 0.7-1.8 GBP/m2' },
    { id: 'sleeve', item: 'Cotton jersey sleeve with panel pockets and zip', qty: '1', low: 1.2, high: 2.5, basis: 'estimate: cut and sew' },
    { id: 'fill', item: 'Hot-fill, heat-seal, assembly, QC', qty: '1', low: 0.6, high: 1.5, basis: 'estimate: form-fill-seal line as used for gel packs' },
    { id: 'pack', item: 'Box and instructions', qty: '1', low: 0.3, high: 0.6, basis: 'estimate' },
  ];
  // the first test's shopping list (GBP). Only the lauric acid price was checked against a live listing.
  const TEST_KIT = [
    { id: 'wax', item: 'Lauric acid, 1 kg, 98% (UK lab supplier listing)', gbp: 50, owned: false },
    { id: 'sealer', item: 'Impulse heat sealer, 200 mm (estimate)', gbp: 25, owned: false },
    { id: 'film', item: 'Nylon/PE layflat tube or vacuum bags (estimate)', gbp: 8, owned: false },
    { id: 'felt', item: '1 mm polyester felt, a few A4 sheets (estimate)', gbp: 4, owned: false },
    { id: 'acrylic', item: 'Acrylic sheet, 5, 10 and 20 mm, 300 x 200 mm (estimate)', gbp: 30, owned: false },
    { id: 'box', item: '12 L plastic box for the bath (estimate)', gbp: 6, owned: false },
    { id: 'bottles', item: 'Two plain 2 L bottles and a fleece cover (estimate)', gbp: 12, owned: false },
    { id: 'sousvide', item: 'Sous-vide circulator (estimate; many kitchens have one)', gbp: 40, owned: true },
    { id: 'logger', item: '4-channel K-type thermocouple logger (estimate)', gbp: 40, owned: true },
  ];
  function bomTotals() {
    let low = 0;
    let high = 0;
    for (const r of BOM) {
      low += r.low;
      high += r.high;
    }
    return { low, high };
  }

  function weights(p) {
    const mw = waterMass(p);
    const mx = waxMassTotal(p);
    const cover = p.waxFaces ? 0.12 : 0.08; // kg: sleeve + film + seals, or a plain fleece cover (estimates)
    return { water: mw, bottle: p.bottleMass, wax: mx, cover, total: mw + p.bottleMass + mx + cover + (p.insertKg || 0) };
  }

  // ---------------------------------------------------------------- pre-mortem
  // Each p is a separate estimate of the chance that this failure alone sinks the product.
  // They are not shares of 100% and do not sum to anything meaningful.
  const RISKS = [
    { id: 'tepid', p: 0.4, what: 'People who love hot water bottles love them hot. A steady 40-41 C reads as lukewarm next to the 46 C a plain bottle gives in its first hour, and they go back to it.' },
    { id: 'tissue', p: 0.2, what: 'Heated skin opens its blood vessels, so real tissue resistance sits nearer the well-perfused end. Then the plateau is 38-39 C and the warm part of the night is about four hours, not nine.' },
    { id: 'weight', p: 0.25, what: 'The jacket adds 0.8 kg, 44% more than a filled plain bottle. On a belly or a sore back that is too much.' },
    { id: 'price', p: 0.25, what: 'At three times the bill of materials it retails for 14-29 GBP against 5-17 GBP for a plain bottle, and stays a niche gift.' },
    { id: 'seal', p: 0.2, what: 'A tube seam opens within two winters and greasy lauric acid ends up in a bed, a washing machine, or against skin that cannot feel it. It can seriously damage eyes (H318), and some suppliers also class it as a skin irritant (H315).' },
    { id: 'sealLines', p: 0.15, what: 'The seal lines between cells run hotter than sideways conduction should allow, and the fix (a form-stable wax sheet with no cells) costs more than the design can carry.' },
    { id: 'meltThrough', p: 0.2, what: 'Real use melts the wax through while hot water is still behind it, on someone who cannot feel it. In the model, poor circulation with a kettle fill to the brim, or with boiling water, already does it, and a bottle sold as unable to burn invites exactly those fills.' },
    { id: 'cycling', p: 0.1, what: 'Technical-grade lauric acid loses latent heat or drifts in melting point over a few hundred nights, or the fatty acid attacks the PE film at 50 C.' },
    { id: 'safetyStory', p: 0.05, what: 'Bursts and spills are half to four fifths of the burns, depending on the series. The jacket does nothing for spills and only softens late bursts, and buyers judge it on those.' },
    { id: 'filling', p: 0.1, what: 'The empty jacketed bottle weighs about three times as much as a bare one, so it is harder to hold steady while pouring, and spills while filling become more common. They are a third of the burns in one series.' },
  ];
  function riskSummary() {
    let survive = 1;
    for (const r of RISKS) survive *= 1 - r.p;
    return { survive, fail: 1 - survive };
  }

  // ---------------------------------------------------------------- evidence quoted on the page (from the sources listed there)
  const EVIDENCE = {
    ibidInjuries: 5944, // hot water bottle burns in England and Wales, 2014-2023 (Burns 2024, IBID data)
    ibidYears: 10,
    winter2021: 295,
    winter2022: 423,
    seriesN: 85, // one regional burns unit, 39 children + 46 adults, Jan 2004 - Mar 2013 (PMC3885202)
    shareRupture: 48.2, // % of that series
    shareSpill: 33.0,
    shareContact: 18.8,
    fullThickContact: 3, // its only pure full-thickness burns: all prolonged contact, all with sensory deficits
    series2N: 80, // Chelsea and Westminster burns unit, Jan 2017 - Mar 2018 (Begum et al., Burns 2019)
    series2Contact: 41, // contact burns: 51.3% as the abstract rounds it
    series2Scald: 38, // scalds (burst, leak or spill): 47.5%
    series2Steam: 1,
    series2ContactPct: 51.3, // as published
    series2ScaldPct: 47.5,
    series2FullThick: 30, // patients with full-thickness burns
    adelaideN: 23, // Royal Adelaide Hospital audit (Eplasty 2010): 7 contact, 14 burst or split, 2 not recorded
    adelaideContact: 7,
    ownersPct: 61, // UK households owning one (Uswitch survey, as reported)
    retailLow: 4.99, // GBP, plain 2 L bottles seen on UK retail listings
    retailHigh: 17.35,
    lauricUSDperT: 2150, // Argus Asia spot, 99% lauric acid, FOB SE Asia, 1 Oct 2025 (2,100-2,200)
    usdPerGbp: 1.33, // exchange rate assumed
  };

  // ---------------------------------------------------------------- the nights compared on the page
  const SCENARIOS = [
    { id: 'asTold', label: 'As the makers say: 80 C, two thirds full', o: {} },
    { id: 'cool', label: 'Careful: 60 C', o: { tFill: 60 } },
    { id: 'kettle', label: 'Straight from the kettle: 95 C', o: { tFill: 95 } },
    { id: 'brim', label: 'Kettle-hot and filled to the top (2 L)', o: { tFill: 95, waterL: 2 } },
    { id: 'poor', label: 'Poor circulation (tissue resistance doubled)', o: { rTissue: 0.06 } },
    { id: 'poorKettle', label: 'Poor circulation and kettle-hot', o: { rTissue: 0.06, tFill: 95 } },
    { id: 'warmSkin', label: 'Well-perfused skin (tissue resistance halved)', o: { rTissue: 0.015 } },
    { id: 'bare', label: 'Cover or sleeve left off', o: { rCover: 0 } },
    { id: 'early', label: 'Kettle-hot, left in the empty bed for an hour first', o: { tFill: 95, preWarmMin: 60 } },
    // added after the independent review: two misuses at once, and skin pressed under body weight
    { id: 'poorBrim', label: 'Poor circulation, kettle-hot, filled to the top', o: { rTissue: 0.06, tFill: 95, waterL: 2 } },
    { id: 'poorBoil', label: 'Poor circulation and boiling water (100 C)', o: { rTissue: 0.06, tFill: 100 } },
    { id: 'pressed', label: 'Lying on it: no blood flow in 40 mm of tissue, 80 C', o: PRESSED },
    { id: 'pressedKettle', label: 'Lying on it, kettle-hot', o: Object.assign({ tFill: 95 }, PRESSED) },
  ];

  // my headline probabilities, stated on the page and in the README (judgements, not model outputs)
  const VERDICT = {
    mostVsPlain: 0.3, // better than the plain bottle in fleece, for most people
    mostVsThick: 0.2, // better than a plain bottle in a cover 3x thicker, for most people
    vulnVsPlain: 0.7, // less harmful than the plain bottle, for people who cannot feel or move away from heat
    vulnVsThick: 0.6, // less harmful than the thick cover, for the same people
  };

  /* The thinnest plain cover that keeps the as-instructed night under the 8 h burn line (bisection). */
  let thinCoverMemo = null;
  function thinnestSafeCover() {
    if (thinCoverMemo !== null) return thinCoverMemo;
    let lo = ORIGINAL.rCover;
    let hi = 0.6;
    for (let i = 0; i < 24; i++) {
      const mid = 0.5 * (lo + hi);
      if (simulate(Object.assign({}, ORIGINAL, { rCover: mid })).metrics.peakTs > LIMITS.longContact) lo = mid;
      else hi = mid;
    }
    thinCoverMemo = hi;
    return hi;
  }
  function thickCover() {
    return Object.assign({}, ORIGINAL, { name: 'thick cover', rCover: Math.ceil(thinnestSafeCover() * 100 - 1e-9) / 100 });
  }
  function designs() {
    return {
      orig: ORIGINAL,
      thick: thickCover(),
      plateau: REDESIGN,
    };
  }
  // the alternatives a sceptic would try first
  function alternatives() {
    return {
      orig: ORIGINAL,
      thick: thickCover(),
      insert: Object.assign({}, ORIGINAL, { insertKg: 0.4 }), // the patent's placement, idealised
      dummy: Object.assign({}, REDESIGN, { latentScale: 0 }),
      noSpacer: Object.assign({}, REDESIGN, { rSpacer: 0 }),
      onePanel: Object.assign({}, REDESIGN, { waxFaces: 1 }),
      onePanelFlipped: Object.assign({}, REDESIGN, { waxFaces: 1, flipped: true }),
      plateau: REDESIGN,
    };
  }
  const SEAL_LAYER_T = 0.0043; // m: one layer of cells, the thinnest wax anywhere on a face

  // ---------------------------------------------------------------- every number quoted on the page and in the README
  function fmt(x, d) {
    const v = Number(x).toFixed(d);
    return v === '-0' || /^-0\.0*$/.test(v) ? v.slice(1) : v;
  }
  function quoted() {
    const q = {};
    const put = (k, v, d) => {
      if (!Number.isFinite(v)) throw new Error(`quoted ${k} is not finite`);
      q[k] = fmt(v, d);
    };
    const A = (...a) => Object.assign({}, ...a);
    const sum = (k, r) => {
      const m = r.metrics;
      put(`${k}_peak`, m.peakTs, 1);
      put(`${k}_h43`, m.sAbove43 / 3600, 1);
      put(`${k}_band`, m.sBand / 3600, 1);
      if (r.params.waxFaces) put(`${k}_melt`, m.meltMax * 100, 0);
    };

    // the two base nights
    const O = simulate(ORIGINAL);
    const R = simulate(REDESIGN);
    put('O_peak', O.metrics.peakTs, 1);
    put('O_tPeakMin', O.metrics.tPeak / 60, 0);
    put('O_min48', O.metrics.sAbove48 / 60, 0);
    put('O_h43', O.metrics.sAbove43 / 3600, 1);
    put('O_h42', O.metrics.sAbove42 / 3600, 1);
    put('O_band', O.metrics.sBand / 3600, 1);
    put('O_tUnder43H', O.metrics.tUnder43 / 3600, 1);
    for (const h of [1, 4, 8]) {
      put(`O_Ts${h}h`, O.at(h).tSkin, 1);
      put(`O_Tw${h}h`, O.at(h).tWater, 0);
    }
    put('O_qBodyKJ', O.metrics.qBodyJ / 1000, 0);
    put('O_qLostKJ', O.metrics.qLostJ / 1000, 0);
    const tau = lumpedTau(ORIGINAL);
    put('O_tauH', tau.tau / 3600, 1);
    put('O_ua', tau.ua, 2);
    put('O_C_kJK', tau.C / 1000, 2);

    put('R_peak', R.metrics.peakTs, 1);
    put('R_tPeakMin', R.metrics.tPeak / 60, 0);
    put('R_h43', R.metrics.sAbove43 / 3600, 1);
    put('R_h42', R.metrics.sAbove42 / 3600, 1);
    put('R_band', R.metrics.sBand / 3600, 1);
    put('R_tWarmMin', R.metrics.tWarm / 60, 0);
    for (const h of [1, 3, 4, 8]) {
      put(`R_Ts${h}h`, R.at(h).tSkin, 1);
      put(`R_Tw${h}h`, R.at(h).tWater, 0);
    }
    put('R_meltMaxPct', R.metrics.meltMax * 100, 0);
    put('R_meltDuvetPct', R.metrics.meltDuvetMax * 100, 0);
    put('R_qBodyKJ', R.metrics.qBodyJ / 1000, 0);
    put('R_qLostKJ', R.metrics.qLostJ / 1000, 0);
    // when the skin-side wax has frozen again (end of the plateau)
    let iFrozen = -1;
    for (let i = 1; i < R.series.melt.length; i++) if (R.series.melt[i - 1] > 0.001 && R.series.melt[i] <= 0.001) iFrozen = i;
    put('R_frozenH', iFrozen < 0 ? R.params.hours : R.series.t[iFrozen] / 3600, 1);

    // geometry and materials
    put('G_faceW', REDESIGN.faceW * 1000, 0);
    put('G_faceH', REDESIGN.faceH * 1000, 0);
    put('G_faceA', area(REDESIGN) * 1e4, 0);
    put('G_waxT', REDESIGN.waxT * 1000, 1);
    put('G_layerT', SEAL_LAYER_T * 1000, 1);
    put('G_waxFace', waxMassPerFace(REDESIGN) * 1000, 0);
    put('G_waxTotal', waxMassTotal(REDESIGN) * 1000, 0);
    put('G_swellPct', (PHYS.rhoWaxS / PHYS.rhoWaxL - 1) * 100, 0);
    put('G_spacer', REDESIGN.rSpacer, 3);
    put('G_sleeve', REDESIGN.rCover, 3);
    put('G_fleece', ORIGINAL.rCover, 3);
    put('G_Tm', PHYS.TmWax, 1);
    put('G_LkJ', PHYS.LWax / 1000, 0);
    put('G_rubberR', BASE.rubberT / PHYS.kRubber, 4);
    put('G_waxR', REDESIGN.waxT / PHYS.kWaxS, 4);

    // closed forms
    const eSkin = effusivity(PHYS.kSkin, PHYS.rhoSkin, PHYS.cSkin);
    const eRub = effusivity(PHYS.kRubber, PHYS.rhoRubber, PHYS.cRubber);
    put('E_skin', eSkin, 0);
    put('E_rubber', eRub, 0);
    put('C_bareFirst', contactTemp(BASE.tSkinFree, eSkin, BASE.tFill, eRub), 1);
    const rWall = 1 / PHYS.hWater + BASE.rubberT / PHYS.kRubber;
    put('C_rWall', rWall, 4);
    put('C_bareSteady', steadySurface(BASE.tFill, rWall, BASE.rTissue, BASE.tCore), 1);
    put('C_fleeceSteady', steadySurface(BASE.tFill, rWall + ORIGINAL.rCover, BASE.rTissue, BASE.tCore), 1);
    put('C_plateauHi', steadySurface(PHYS.TmWax, REDESIGN.rCover, BASE.rTissue, BASE.tCore), 1);
    put('C_plateauLo', steadySurface(PHYS.TmWax, REDESIGN.rCover + REDESIGN.waxT / PHYS.kWaxS, BASE.rTissue, BASE.tCore), 1);
    put('C_plateauPoor', steadySurface(PHYS.TmWax, REDESIGN.rCover, 0.06, BASE.tCore), 1);
    put('C_plateauBare', steadySurface(PHYS.TmWax, 0, BASE.rTissue, BASE.tCore), 1);
    // a wax melting at 42 C instead (a paraffin, as in US 7,041,123): the same plateau formula
    put('C_plateau42Hi', steadySurface(42, REDESIGN.rCover, BASE.rTissue, BASE.tCore), 1);
    put('C_plateau42Lo', steadySurface(42, REDESIGN.rCover + REDESIGN.waxT / PHYS.kWaxS, BASE.rTissue, BASE.tCore), 1);
    // the tissue resistance above which skin under a pinned front passes 43 C (front at the sleeve)
    put('C_overRt', (REDESIGN.rCover * (LIMITS.longContact - BASE.tCore)) / (PHYS.TmWax - LIMITS.longContact), 3);
    put('CV_asTold', coverForLimit(80, 0.03, 37, LIMITS.longContact), 3);
    put('CV_kettle', coverForLimit(95, 0.03, 37, LIMITS.longContact), 3);
    put('CV_poor', coverForLimit(80, 0.06, 37, LIMITS.longContact), 3);
    put('CV_poorKettle', coverForLimit(95, 0.06, 37, LIMITS.longContact), 3);
    put('CV_poorKettleMM', (coverForLimit(95, 0.06, 37, LIMITS.longContact) * 0.04) * 1000, 0); // mm of fleece at k 0.04
    // that heavy cover on a careful, warm-skinned night: steady skin at 60 C water
    put('CV_heavyCool', steadySurface(60, rWall + coverForLimit(95, 0.06, 37, LIMITS.longContact), 0.015, 37), 1);
    const b80 = budget(REDESIGN);
    const b95 = budget(Object.assign({}, REDESIGN, { tFill: 95 }));
    put('B_excess80', b80.excess / 1000, 0);
    put('B_excess95', b95.excess / 1000, 0);
    put('B_latent', b80.latent / 1000, 0);
    put('B_sensible', b80.sensible / 1000, 0);
    put('B_store', b80.store / 1000, 0);
    put('S_stefanMin', stefanMelt(REDESIGN.waxT, BASE.tFill) / 60, 0);
    put('S_stefan95Min', stefanMelt(REDESIGN.waxT, 95) / 60, 0);

    // the cheapest fix a sceptic would propose
    put('T_thinnest', thinnestSafeCover(), 3);
    const thick = thickCover();
    put('T_thick', thick.rCover, 2);
    put('T_thickRatio', thick.rCover / ORIGINAL.rCover, 0);
    put('T_thickMM', thick.rCover * 0.04 * 1000, 0);

    // robustness: nine nights x three designs
    const D = designs();
    const over = {};
    for (const sc of SCENARIOS) {
      for (const [dk, d] of Object.entries(D)) {
        const r = simulate(A(d, sc.o));
        sum(`S_${sc.id}_${dk}`, r);
        if (r.metrics.sAbove43 > 0) over[dk] = (over[dk] || 0) + 1;
        if (sc.id === 'cool' && dk === 'orig') put('S_cool_orig_margin', LIMITS.longContact - r.metrics.peakTs, 2);
        if (dk === 'plateau') put(`S_${sc.id}_plateau_waxMax`, r.metrics.waxMaxT, 1);
      }
    }

    // where the ceiling fails: the jacket as drawn, by fill and by how much heat the skin can take away.
    // Constant tissue resistances (no heat capacity in the tissue, so pessimistic early on), and the
    // slab with no blood flow at 40 and 60 mm. Rt = 5 is the page's 'no heat carried away at all'.
    const MT_FILLS = { f80: { tFill: 80 }, f90: { tFill: 90 }, f95: { tFill: 95 }, f100: { tFill: 100 }, b80: { tFill: 80, waterL: 2 }, b95: { tFill: 95, waterL: 2 } };
    const MT_TISSUES = { poor: { rTissue: 0.06 }, r10: { rTissue: 0.1 }, r20: { rTissue: 0.2 }, p40: PRESSED, p60: { tissueDepth: 0.06, perfusion: 0 }, none: { rTissue: 5 } };
    for (const [fk, fo] of Object.entries(MT_FILLS)) {
      for (const [tk, to] of Object.entries(MT_TISSUES)) {
        const r = simulate(A(REDESIGN, fo, to));
        put(`MT_${fk}_${tk}_peak`, r.metrics.peakTs, 1);
        put(`MT_${fk}_${tk}_h43`, r.metrics.sAbove43 / 3600, 1);
        put(`MT_${fk}_${tk}_melt`, r.metrics.meltMax * 100, 0);
        if (tk === 'none') put(`MT_${fk}_none_cem`, r.metrics.cem43, 0);
        if (r.metrics.tFullMelt !== null) put(`MT_${fk}_${tk}_tMeltH`, r.metrics.tFullMelt / 3600, 1);
      }
    }
    // the full model's version of C_overRt: the smallest tissue resistance that puts an 80 C night over 43 C
    {
      const over = (rT) => simulate(A(REDESIGN, { rTissue: rT })).metrics.sAbove43 > 0;
      let lo = 0.06;
      let hi = 0.3;
      for (let i = 0; i < 10; i++) {
        const mid = Math.sqrt(lo * hi);
        if (over(mid)) hi = mid;
        else lo = mid;
      }
      put('MT_over80Rt', hi, 2);
    }
    // a slab with blood flow tuned to the base case's 0.03 reproduces the base night
    const wBase = perfusionFor(BASE.rTissue, PRESSED.tissueDepth);
    put('TS_baseFlow', wBase * 6000, 1); // ml of blood per 100 ml of tissue per minute
    put('TS_base_peak', simulate(A(REDESIGN, { tissueDepth: PRESSED.tissueDepth, perfusion: wBase })).metrics.peakTs, 1);
    put('TS_pressR', tissueR(PRESSED.tissueDepth, 0), 3);
    put('TS_press60R', tissueR(0.06, 0), 3);
    // no blood flow and no depth limit: the resistance a step in surface temperature sees after 4 h, and
    // the constant resistance that would have drawn the same heat over those 4 h (half of it)
    const alphaT = PHYS.kSkin / (PHYS.rhoSkin * PHYS.cSkin);
    put('TS_semiR4h', Math.sqrt(Math.PI * alphaT * 4 * 3600) / PHYS.kSkin, 2);
    put('TS_semiReq4h', Math.sqrt(Math.PI * alphaT * 4 * 3600) / PHYS.kSkin / 2, 2);

    // sizing the wax: what more wax buys and costs
    function meltThroughRt(design, o) {
      const melts = (rT) => simulate(A(design, o, { rTissue: rT })).metrics.meltMax >= 0.999;
      let lo = 0.015;
      let hi = 5;
      if (!melts(hi)) return Infinity;
      if (melts(lo)) return lo;
      for (let i = 0; i < 12; i++) {
        const mid = Math.sqrt(lo * hi);
        if (melts(mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    const SIZES = { w75: REDESIGN, w10: A(REDESIGN, { waxT: 0.01 }), w125: A(REDESIGN, { waxT: 0.0125 }) };
    const sc = (id) => SCENARIOS.find((x) => x.id === id).o;
    for (const [zk, d] of Object.entries(SIZES)) {
      put(`Z_${zk}_mm`, d.waxT * 1000, 1);
      put(`Z_${zk}_g`, waxMassTotal(d) * 1000, 0);
      put(`Z_${zk}_kg`, weights(d).total, 2);
      const crit = meltThroughRt(d, { tFill: 95 });
      if (Number.isFinite(crit)) put(`Z_${zk}_critRt`, crit, 3);
      put(`Z_${zk}_crit80`, Number.isFinite(meltThroughRt(d, {})) ? 1 : 0, 0); // 1 if an 80 C fill can melt it through at any Rt up to 5
      for (const id of ['poorBrim', 'poorBoil', 'pressedKettle']) put(`Z_${zk}_${id}`, simulate(A(d, sc(id))).metrics.peakTs, 1);
      put(`Z_${zk}_pressBrim`, simulate(A(d, PRESSED, { tFill: 95, waterL: 2 })).metrics.peakTs, 1);
      put(`Z_${zk}_none80`, simulate(A(d, { rTissue: 5 })).metrics.peakTs, 1);
      put(`Z_${zk}_coolBand`, simulate(A(d, { tFill: 60 })).metrics.sBand / 3600, 1);
      put(`Z_${zk}_asToldBand`, simulate(d).metrics.sBand / 3600, 1);
      const bt = benchTest(d);
      put(`Z_${zk}_benchMargin`, bt.band - bt.thickBand, 1);
      if (zk === 'w10') put('Z_w10_over', SCENARIOS.filter((s) => simulate(A(d, s.o)).metrics.sAbove43 > 0).length, 0);
    }

    // alternatives on the as-instructed night and on the bad night
    const ALT = alternatives();
    const bad = SCENARIOS.find((x) => x.id === 'poorKettle').o;
    for (const [ak, d] of Object.entries(ALT)) {
      sum(`A_${ak}`, simulate(d));
      const rb = simulate(A(d, bad));
      put(`A_${ak}_badPeak`, rb.metrics.peakTs, 1);
      put(`A_${ak}_badH43`, rb.metrics.sAbove43 / 3600, 1);
      put(`A_${ak}_kg`, weights(d).total, 2);
    }
    put('A_insertKg', ALT.insert.insertKg, 1);
    put('A_insertL', insertVolumeL(ALT.insert), 2);

    // where the jacket is thinnest: one layer under a seal line (1-D, no sideways spreading: an upper bound)
    const half = A(REDESIGN, { waxT: SEAL_LAYER_T });
    sum('H_asTold', simulate(half));
    sum('H_kettle', simulate(A(half, { tFill: 95 })));

    // sensitivity of the bad night to the inputs I trust least
    const sens = {
      base: {},
      L167: { latentScale: 167 / 175 },
      L183: { latentScale: 183 / 175 },
      kS016: { kSolid: 0.16 },
      kL015: { kLiquid: 0.147 },
      conv2: { convLiq: 2 },
      ribbed: { rContact: 0.04 },
      noSleeve: { rCover: 0 },
      feltHalf: { rSpacer: REDESIGN.rSpacer / 2 },
      room22: { tRoom: 22 },
    };
    for (const [sk, o] of Object.entries(sens)) {
      const r = simulate(A(REDESIGN, bad, o));
      put(`V_${sk}_peak`, r.metrics.peakTs, 1);
      put(`V_${sk}_melt`, r.metrics.meltMax * 100, 0);
      put(`V_${sk}_h43`, r.metrics.sAbove43 / 3600, 2);
    }

    put('R_meltDuvetKettlePct', simulate(A(REDESIGN, { tFill: 95 })).metrics.meltDuvetMax * 100, 0);
    // put in the bed half an hour early at the instructed 80 C
    const pw30 = simulate(A(REDESIGN, { preWarmMin: 30 }));
    put('R_pw30_peak', pw30.metrics.peakTs, 1);
    put('R_pw30_tWarmMin', pw30.metrics.tWarm / 60, 0);
    put('G_TmAbove', PHYS.TmWax - LIMITS.longContact, 1);
    put('G_TmExcess', PHYS.TmWax - BASE.tCore, 1);
    // put in the bed early, kettle-hot
    for (const pw of [0, 30, 60, 120]) {
      const r = simulate(A(REDESIGN, { tFill: 95, preWarmMin: pw }));
      put(`P_${pw}_peak`, r.metrics.peakTs, 1);
      put(`P_${pw}_min43`, r.metrics.sAbove43 / 60, 0);
      put(`P_${pw}_TwC`, r.metrics.tWaterAtContact, 0);
    }

    // the first test, both nights, every design it must tell apart
    const benchDesigns = { plateau: REDESIGN, orig: ORIGINAL, thick, dummy: ALT.dummy, half, noSpacer: ALT.noSpacer };
    for (const [nk, night] of [['BA', BENCH_A], ['BB', BENCH_B], ['BC', BENCH_C]]) {
      for (const [dk, d] of Object.entries(benchDesigns)) {
        const r = simulate(A(d, night));
        put(`${nk}_${dk}_peak`, r.metrics.peakTs, 1);
        put(`${nk}_${dk}_band`, r.metrics.sBand / 3600, 1);
      }
    }
    put('BA_R', BENCH_A.rTissue, 4);
    put('BB_R', BENCH_B.rTissue, 4);
    put('BC_R', BENCH_C.rTissue, 4);
    put('BC_plateau_melt', simulate(A(REDESIGN, BENCH_C)).metrics.meltMax * 100, 0);
    const bc95 = simulate(A(REDESIGN, BENCH_C, { tFill: 95 }));
    put('BC95_plateau_peak', bc95.metrics.peakTs, 1);
    put('BC95_plateau_tMeltH', bc95.metrics.tFullMelt / 3600, 1);
    put('TEST_passPeak', TEST.passPeak, 1);
    put('TEST_killPeak', TEST.killPeak, 1);
    put('TEST_margin', TEST.bandMarginH, 1);
    // how far a 10% error in the acrylic's conductivity moves the jacket's absolute hours in band
    const kPlus = benchTest(REDESIGN, (n) => ({ rTissue: n.plateMM / 1000 / (ACRYLIC_K * 1.1) + BATH_FILM }));
    put('TEST_bandKplus', kPlus.band, 1);
    put('TEST_thickBandKplus', kPlus.thickBand, 1);

    // weight, cost, evidence, risks
    const wO = weights(ORIGINAL);
    const wR = weights(REDESIGN);
    put('W_orig', wO.total, 2);
    put('W_new', wR.total, 2);
    put('W_added', (wR.total - wO.total) * 1000, 0);
    put('W_addedPct', (wR.total / wO.total - 1) * 100, 0);
    const bt = bomTotals();
    put('BOM_low', bt.low, 2);
    put('BOM_high', bt.high, 2);
    put('BOM_retailLow', bt.low * 3, 0);
    put('BOM_retailHigh', bt.high * 3, 0);
    put('BOM_waxGBPkg', EVIDENCE.lauricUSDperT / 1000 / EVIDENCE.usdPerGbp, 2);
    put('BOM_waxPerBottle', (waxMassTotal(REDESIGN) * EVIDENCE.lauricUSDperT) / 1000 / EVIDENCE.usdPerGbp, 2);
    put('EV_perYear', EVIDENCE.ibidInjuries / EVIDENCE.ibidYears, 0);
    put('EV_risePct', (EVIDENCE.winter2022 / EVIDENCE.winter2021 - 1) * 100, 0);
    put('EV_contactPerYear', (EVIDENCE.ibidInjuries / EVIDENCE.ibidYears) * (EVIDENCE.shareContact / 100), 0);
    put('EV_contact2', EVIDENCE.series2ContactPct, 1);
    put('EV_scald2', EVIDENCE.series2ScaldPct, 1);
    put('EV_contactPerYear2', (EVIDENCE.ibidInjuries / EVIDENCE.ibidYears) * (EVIDENCE.series2Contact / EVIDENCE.series2N), 0);
    put('EV_n2', EVIDENCE.series2N, 0);
    put('EV_c2', EVIDENCE.series2Contact, 0);
    put('EV_s2', EVIDENCE.series2Scald, 0);
    put('EV_ft2', EVIDENCE.series2FullThick, 0);
    put('EV_ftContact', EVIDENCE.fullThickContact, 0);
    put('EV_adN', EVIDENCE.adelaideN, 0);
    put('EV_adC', EVIDENCE.adelaideContact, 0);
    for (const r of BOM) {
      put(`BOM_${r.id}_low`, r.low, 2);
      put(`BOM_${r.id}_high`, r.high, 2);
    }
    put('W_wax', wR.wax, 2);
    put('W_emptyOrig', wO.total - wO.water, 2);
    put('W_emptyNew', wR.total - wR.water, 2);
    put('W_emptyRatio', (wR.total - wR.water) / (wO.total - wO.water), 1);
    put('G_liqExpPct', ((0.8744 / 0.8679 - 1) / (50 - 41.5)) * 100 * (95 - 50), 0); // liquid lauric acid from 50 to 95 C, from the two liquid densities
    put('W_water', wR.water, 2);
    put('W_bottle', wR.bottle, 2);
    put('W_sleeve', wR.cover, 2);
    put('W_fleece', wO.cover, 2);
    let kit = 0;
    let kitOwned = 0;
    for (const k of TEST_KIT) {
      put(`KIT_${k.id}`, k.gbp, 0);
      kit += k.gbp;
      if (k.owned) kitOwned += k.gbp;
    }
    put('KIT_total', kit, 0);
    put('KIT_withoutOwned', kit - kitOwned, 0);
    // limits and evidence as printed
    put('L_long', LIMITS.longContact, 0);
    put('L_ten', LIMITS.tenMinutes, 0);
    put('L_sens', LIMITS.sensitive, 0);
    put('L_warm', LIMITS.warm, 0);
    put('EV_total', EVIDENCE.ibidInjuries, 0);
    put('EV_w21', EVIDENCE.winter2021, 0);
    put('EV_w22', EVIDENCE.winter2022, 0);
    put('EV_n', EVIDENCE.seriesN, 0);
    put('EV_rupture', EVIDENCE.shareRupture, 1);
    put('EV_spill', EVIDENCE.shareSpill, 1);
    put('EV_contact', EVIDENCE.shareContact, 1);
    put('EV_owners', EVIDENCE.ownersPct, 0);
    put('EV_retailLow', EVIDENCE.retailLow, 2);
    put('EV_retailHigh', EVIDENCE.retailHigh, 2);
    put('EV_lauricUSD', EVIDENCE.lauricUSDperT, 0);
    // how many of the nine nights each design spends any time above the all-night line
    for (const dk of Object.keys(D)) put(`N_over_${dk}`, over[dk] || 0, 0);
    put('N_nights', SCENARIOS.length, 0);
    const rs = riskSummary();
    put('P_fail', rs.fail * 100, 0);
    put('P_survive', rs.survive * 100, 0);
    for (const r of RISKS) put(`K_${r.id}`, r.p * 100, 0);
    for (const [k, v] of Object.entries(VERDICT)) put(`PR_${k}`, v * 100, 0);
    put('L_isoDose', LIMITS.isoDose, 0);
    put('L_mhDose', LIMITS.mhDose, 0);
    return q;
  }

  return {
    PHYS,
    BASE,
    ORIGINAL,
    REDESIGN,
    BENCH_A,
    BENCH_B,
    BENCH_C,
    PRESSED,
    VERDICT,
    LIMITS,
    TEST,
    BOM,
    RISKS,
    TEST_KIT,
    simulate,
    benchTest,
    tissueR,
    perfusionFor,
    area,
    waxMassPerFace,
    waxMassTotal,
    waterMass,
    insertVolumeL,
    effusivity,
    contactTemp,
    steadySurface,
    lumpedTau,
    stefanMelt,
    budget,
    coverForLimit,
    bomTotals,
    weights,
    riskSummary,
    EVIDENCE,
    SCENARIOS,
    SEAL_LAYER_T,
    thinnestSafeCover,
    thickCover,
    designs,
    alternatives,
    quoted,
  };
});
