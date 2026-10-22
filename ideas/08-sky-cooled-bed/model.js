/* Sky-Cooled Bed: feasibility model. Single source of truth.
 * Plain script (no imports/exports) so it can be inlined verbatim into index.html.
 * build.mjs copies this file into the page; check.mjs proves the copy is identical
 * and recomputes every number quoted on the page and in the README.
 * Units: SI throughout. Temperatures are entered in degrees C and converted to K
 * only inside the Stefan-Boltzmann terms.
 */
const SkyBedModel = (() => {
  'use strict';

  // ---- Physical constants -------------------------------------------------
  const PHYS = {
    SIGMA: 5.670374419e-8, // Stefan-Boltzmann, W m^-2 K^-4
    K0: 273.15, // 0 degC in K
    G: 9.81, // m s^-2
    RHO_W: 997, // water density at 25 degC, kg m^-3
    CP_W: 4180, // water specific heat, J kg^-1 K^-1
    MU_W: 0.00089, // water dynamic viscosity at 25 degC, Pa s
    BETA_W: 2.57e-4, // water volumetric expansion at 25 degC, K^-1
    K_W: 0.6, // water thermal conductivity, W m^-1 K^-1
    H_FG: 2.42e6, // latent heat of evaporation at skin temperature, J kg^-1
    MET: 58.2, // 1 met, W m^-2 (ASHRAE)
    RHO_AIR: 1.2, // kg m^-3
    CP_AIR: 1005, // J kg^-1 K^-1
  };

  // Skin-to-water resistances in series, m^2 K W^-1 (estimates, see assumptions table)
  const FABRIC = Object.freeze({
    sheet: 0.01, // ~0.5 mm cotton sheet
    film: 0.0015, // 0.3 mm TPU pad wall
    water: 0.003, // laminar water film in the pad channels
    gaps: 0.0105, // imperfect skin-fabric contact, folds, channel spacing
  });
  const U_FABRIC = 1 / (FABRIC.sheet + FABRIC.film + FABRIC.water + FABRIC.gaps);

  // ---- Base case: a top-floor bedroom on a clear heat-wave night ---------
  const BASE = Object.freeze({
    // weather and room
    tAir: 31, // outdoor night air at roof level on a hot night, degC
    tDew: 16, // outdoor dew point, degC
    cloud: 0, // effective low-cloud fraction, 0..1 (crude linear blend)
    tRoom: 33, // top-floor bedroom air and surface temperature, degC
    dewIndoorRise: 1, // bedroom dew point above outdoor (sleeper's own moisture), K
    // radiator panel on the roof
    panelArea: 2.0, // m^2
    windscreen: false, // optional thin polyethylene film ~25 mm above the panel
    epsPanel: 0.95, // thermal-IR emissivity of painted panel
    tauScreen: 0.85, // multiplier on net radiative exchange with PE windscreen
    hConvScreen: 3.0, // convective gain coefficient with windscreen, W m^-2 K^-1
    hConvBare: 9.0, // convective gain coefficient, bare panel, light wind
    uBack: 1.0, // foil-faced foam under panel, W m^-2 K^-1
    hPlate: 100, // panel surface-to-water conductance per panel area, W m^-2 K^-1
    // body and pad
    tCore: 37.0, // body core, degC
    contactArea: 0.3, // body area pressed on the pad (supine adult), m^2
    kTissue: 20, // core-to-skin tissue conductance under the cool pad, W m^-2 K^-1
    uFabric: U_FABRIC, // skin-to-water: sheet + pad film + water film + gaps = 40 W m^-2 K^-1
    padArea: 0.72, // 0.6 m x 1.2 m torso pad, m^2
    hPadTop: 7.0, // room-to-exposed-pad (radiation + weak convection), W m^-2 K^-1
    uUnder: 3.5, // pad underside through 10 mm closed-cell foam, W m^-2 K^-1
    uaPipe: 0.4, // ~4 m of insulated indoor pipe, W K^-1
    // thermosyphon loop
    loopHeight: 3.0, // vertical drop from panel to pad, m
    pipeD: 0.02, // inner diameter, m
    loopLength: 14, // equivalent laminar length incl. pad manifolds, m
    // sleeper
    bsa: 1.8, // body surface area, m^2
    metSleep: 0.7, // sleeping metabolic rate, met (ASHRAE: 0.7 met)
    tSkin: 34.5, // mean temperature of exposed skin, degC
    hDry: 7.5, // exposed skin to room, convection + radiation, W m^-2 K^-1
  });

  const toK = (c) => c + PHYS.K0;

  // ---- Sky -----------------------------------------------------------------
  // Berdahl & Martin (1984) clear-sky emissivity, dew point in degC.
  function epsSkyClear(tDew) {
    const x = tDew / 100;
    return 0.711 + 0.56 * x + 0.73 * x * x;
  }
  // Crude cloud blend: thick low cloud radiates almost like a blackbody at air temperature.
  function epsSkyEff(p) {
    const e = epsSkyClear(p.tDew);
    return e + (1 - e) * p.cloud;
  }
  function skyDown(p) {
    // downwelling longwave from the sky, W m^-2
    return epsSkyEff(p) * PHYS.SIGMA * Math.pow(toK(p.tAir), 4);
  }

  // ---- Panel ---------------------------------------------------------------
  function hConv(p) {
    return p.windscreen ? p.hConvScreen : p.hConvBare;
  }
  function tau(p) {
    return p.windscreen ? p.tauScreen : 1;
  }
  // Net radiative loss of a panel surface at tS (degC), W m^-2
  function qRad(p, tS) {
    const T = toK(tS);
    const Ta = toK(p.tAir);
    return tau(p) * p.epsPanel * PHYS.SIGMA * (Math.pow(T, 4) - epsSkyEff(p) * Math.pow(Ta, 4));
  }
  // Heat leaking INTO the panel from air (front) and roof side (back), W m^-2
  function qGain(p, tS) {
    return (hConv(p) + p.uBack) * (p.tAir - tS);
  }
  // Net heat the panel rejects per m^2 (positive = cooling the water)
  function qNet(p, tS) {
    return qRad(p, tS) - qGain(p, tS);
  }

  // ---- Body side -------------------------------------------------------------
  function uBody(p) {
    // core -> tissue -> skin -> sheet -> film -> water, in series
    return 1 / (1 / p.kTissue + 1 / p.uFabric);
  }
  function uaBody(p) {
    return uBody(p) * p.contactArea;
  }
  function uaParasitic(p) {
    const exposed = Math.max(0, p.padArea - p.contactArea);
    return p.hPadTop * exposed + p.uUnder * p.padArea + p.uaPipe;
  }

  // ---- Coupled steady state ---------------------------------------------------
  // Unknown: panel surface temperature tS. Water mean temperature tW = tS + qNet/hPlate.
  // Residual: heat rejected by panel - heat picked up at pad (body + parasitic).
  function stateAt(p, tS) {
    const qn = qNet(p, tS);
    const tW = tS + qn / p.hPlate;
    const Qpanel = p.panelArea * qn;
    const Qbody = uaBody(p) * (p.tCore - tW);
    const Qpar = uaParasitic(p) * (p.tRoom - tW);
    return { tS, tW, qNet: qn, Qpanel, Qbody, Qpar, resid: Qpanel - Qbody - Qpar };
  }
  function solve(pIn) {
    const p = Object.assign({}, BASE, pIn || {});
    let lo = p.tAir - 40;
    let hi = p.tCore;
    if (stateAt(p, hi).resid < 0 || stateAt(p, hi).Qpanel <= 0) {
      // sky cannot even cool water at core temperature: loop does not run
      return finish(p, null);
    }
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      if (stateAt(p, mid).resid > 0) hi = mid;
      else lo = mid;
    }
    return finish(p, stateAt(p, 0.5 * (lo + hi)));
  }

  // ---- Thermosyphon ----------------------------------------------------------
  // Buoyancy rho*beta*dT*g*H balances laminar Hagen-Poiseuille loss
  // 128*mu*L*mdot/(pi*D^4*rho), with mdot = Q/(cp*dT). Solve for dT.
  function thermosyphon(p, Q) {
    if (!(Q > 0) || !(p.loopHeight > 0)) return null;
    const { RHO_W: rho, CP_W: cp, MU_W: mu, BETA_W: beta, G: g } = PHYS;
    const D4 = Math.pow(p.pipeD, 4);
    const dT = Math.sqrt((128 * mu * p.loopLength * Q) / (Math.PI * D4 * rho * rho * beta * g * p.loopHeight * cp));
    const mdot = Q / (cp * dT); // kg/s
    const dp = rho * beta * dT * g * p.loopHeight; // Pa
    const area = (Math.PI * p.pipeD * p.pipeD) / 4;
    const vel = mdot / rho / area; // m/s
    const Re = (4 * mdot) / (Math.PI * p.pipeD * mu);
    const dpFriction = (128 * mu * p.loopLength * (mdot / rho)) / (Math.PI * D4);
    return { dT, mdot, dp, dpFriction, vel, Re };
  }

  // ---- Sleeper heat balance -------------------------------------------------
  function sleeper(p, Qbody) {
    const M = p.metSleep * PHYS.MET * p.bsa;
    const exposed = p.bsa - p.contactArea;
    const Qdry = p.hDry * exposed * (p.tSkin - p.tRoom);
    const eNoPad = M - Qdry; // conventional mattress treated as adiabatic
    const eWithPad = M - Qdry - Qbody;
    const gph = (w) => (Math.max(0, w) / PHYS.H_FG) * 3600 * 1000; // g of water per hour
    return { M, Qdry, eNoPad, eWithPad, sweatNoPad: gph(eNoPad), sweatWithPad: gph(eWithPad), fracOfM: Qbody / M };
  }

  function finish(p, st) {
    const out = { p, running: !!st };
    const s = st || { tS: NaN, tW: NaN, qNet: 0, Qpanel: 0, Qbody: 0, Qpar: 0, resid: 0 };
    Object.assign(out, s);
    out.epsSky = epsSkyEff(p);
    out.skyDown = skyDown(p);
    out.qRadAmbient = qRad(p, p.tAir); // net radiative loss of a panel at air temperature
    out.uBody = uBody(p);
    out.uaBody = uaBody(p);
    out.uaPar = uaParasitic(p);
    out.skinUnderPad = st ? p.tCore - s.Qbody / (p.kTissue * p.contactArea) : NaN;
    out.parFrac = st && s.Qpanel > 0 ? s.Qpar / s.Qpanel : NaN;
    out.ts = st ? thermosyphon(p, s.Qpanel) : null;
    out.padInlet = st && out.ts ? s.tW - out.ts.dT / 2 : s.tW;
    out.dewMarginPad = out.padInlet - (p.tDew + p.dewIndoorRise);
    out.dewOnPanel = st ? s.tS < p.tDew : false;
    out.sleeper = sleeper(p, s.Qbody);
    return out;
  }

  // ---- Derived questions -------------------------------------------------------
  // Panel area needed to pull a target wattage out of the body (bisection on area).
  function areaFor(targetQbody, pIn) {
    const p = Object.assign({}, BASE, pIn || {});
    const at = (A) => solve(Object.assign({}, p, { panelArea: A })).Qbody;
    if (at(200) < targetQbody) return Infinity;
    let lo = 0.01;
    let hi = 200;
    for (let i = 0; i < 100; i++) {
      const mid = 0.5 * (lo + hi);
      if (at(mid) >= targetQbody) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  // Order-of-magnitude cooling load to hold the same room at 26 degC instead (start of night).
  const ROOM = Object.freeze({
    tSet: 26,
    ceilArea: 12, // 3 m x 4 m
    tCeil: 35, // ceiling surface under an uninsulated hot roof, still warm at night
    hIn: 8, // interior surface coefficient, conv + rad, W m^-2 K^-1
    wallArea: 16.7, // two external walls 4 m + 3 m, 2.6 m high, minus window
    uWall: 1.5,
    winArea: 1.5,
    uWin: 5.0,
    volume: 31.2, // m^3
    ach: 0.5, // air changes per hour
    cop: 3.0, // small air conditioner
    nightHours: 8,
  });
  function roomLoad(pIn) {
    const p = Object.assign({}, BASE, pIn || {});
    const r = ROOM;
    const ceiling = r.ceilArea * r.hIn * (r.tCeil - r.tSet);
    const walls = r.wallArea * r.uWall * (p.tAir - r.tSet);
    const windows = r.winArea * r.uWin * (p.tAir - r.tSet);
    const infiltration = ((r.ach * r.volume) / 3600) * PHYS.RHO_AIR * PHYS.CP_AIR * (p.tAir - r.tSet);
    const occupant = p.metSleep * PHYS.MET * p.bsa;
    const total = ceiling + walls + windows + infiltration + occupant;
    const elec = total / r.cop;
    return { ceiling, walls, windows, infiltration, occupant, total, elec, kWhNight: (elec * r.nightHours) / 1000 };
  }

  // Daytime: hot water sits on top of the loop. Only conduction leaks down the column.
  const DAY = Object.freeze({ tPanel: 70 });
  function dayLeak(pIn) {
    const p = Object.assign({}, BASE, pIn || {});
    const tPanelDay = DAY.tPanel; // stagnating panel in sun, degC (assumption)
    const area = (Math.PI * p.pipeD * p.pipeD) / 4;
    const legs = 2;
    const W = legs * (PHYS.K_W * area * (tPanelDay - p.tRoom)) / p.loopHeight;
    return { tPanelDay, W };
  }

  // Why a passive gel mat is not the same thing.
  const GEL = Object.freeze({ mass: 2.0, rise: 8 }); // kg of water gel, K of allowed warming
  function gelMat(Qbody) {
    const J = GEL.mass * PHYS.CP_W * GEL.rise;
    return { J, minutes: J / Qbody / 60 };
  }

  // Materials (rough 2026 retail guesses in USD, not quotes).
  const COST = Object.freeze([
    ['Roof radiator: unglazed polypropylene pool-heater mat, about 2 m²', 80],
    ['Foil-faced foam under the panel, plus legs to lift it off the roof', 30],
    ['20 m of 20 mm PE/PEX pipe with foam sleeve', 60],
    ['Torso pad, 0.6 × 1.2 m, with non-collapsible channels (capillary-tube mat or spacer fabric in TPU)', 60],
    ['Header cup, fill/drain valves, fittings', 35],
    ['10 mm closed-cell foam under the pad', 10],
  ]);
  const costTotal = () => COST.reduce((s, [, v]) => s + v, 0);

  // Pre-mortem: probability that each failure mode, on its own, sinks the idea.
  const RISKS = Object.freeze([
    { id: 'body', p: 0.25, tech: true },
    { id: 'sky', p: 0.15, tech: true },
    { id: 'parasitic', p: 0.1, tech: true },
    { id: 'dew', p: 0.1, tech: true },
    { id: 'leaks', p: 0.15, tech: true },
    { id: 'install', p: 0.35, tech: false },
    { id: 'alternatives', p: 0.25, tech: false },
  ]);
  function survival(onlyTech) {
    return RISKS.filter((r) => !onlyTech || r.tech).reduce((s, r) => s * (1 - r.p), 1);
  }

  // Effective radiating temperature of the sky: sigma*Tsky^4 = epsSky*sigma*Ta^4
  function tSky(pIn) {
    const p = Object.assign({}, BASE, pIn || {});
    return Math.pow(epsSkyEff(p), 0.25) * toK(p.tAir) - PHYS.K0;
  }

  // A fan raises the exposed-skin coefficient; it helps only while room air is below skin.
  const FAN = Object.freeze({ hDryFan: 15 }); // W m^-2 K^-1 at roughly 1 m/s on a reclining body
  function fanGain(pIn) {
    const p = Object.assign({}, BASE, pIn || {});
    return (FAN.hDryFan - p.hDry) * (p.bsa - p.contactArea) * (p.tSkin - p.tRoom);
  }

  // Scale: heat over one night, and the core-temperature rise it would cause if stored.
  const BODY = Object.freeze({ mass: 70, c: 3470, hours: 8 }); // kg, J kg^-1 K^-1, h
  function nightHeat(W) {
    const J = W * BODY.hours * 3600;
    return { MJ: J / 1e6, coreRise: J / (BODY.mass * BODY.c) };
  }

  // Experiment 1 (the bucket bed): hold water at EXP.tWater, pump EXP.mdot through the pad.
  const EXP = Object.freeze({
    tWater: 28, mdot: 0.005, sensorDT: 0.05, killW: 20, passW: 30, cost1: 120, // bucket bed
    bucketL: 50, tStart: 24, pumpW: 5, boxUA: 0.8, killPanel: 6, // drifting-bucket protocol
    skyDT: 2, skyKill: 25, cost2: 150, // sky bucket
  });
  function experiment(pIn) {
    const p = Object.assign({}, BASE, pIn || {});
    const predicted = uaBody(p) * (p.tCore - EXP.tWater);
    const dTpad = predicted / (EXP.mdot * PHYS.CP_W);
    const resolution = EXP.mdot * PHYS.CP_W * EXP.sensorDT;
    // tissue conductance at which the kill threshold is hit
    const uaKill = EXP.killW / (p.tCore - EXP.tWater);
    const uKill = uaKill / p.contactArea;
    const kKill = 1 / (1 / uKill - 1 / p.uFabric);
    // with no ice top-ups the bucket warms: body + parasitic + pump + cooler-box walls
    const gain = predicted + uaParasitic(p) * (p.tRoom - EXP.tWater) + EXP.pumpW + EXP.boxUA * (p.tRoom - EXP.tWater);
    const driftKph = (gain * 3600) / (EXP.bucketL * PHYS.CP_W); // 1 L of water ~ 1 kg
    return { predicted, dTpad, resolution, uaKill, kKill, gain, driftKph };
  }

  // Experiment 2 (the sky bucket): net panel flux with the surface held 2 K below air.
  function skyTest(pIn) {
    const p = Object.assign({}, BASE, pIn || {});
    return qNet(p, p.tAir - EXP.skyDT);
  }

  // Named what-if scenarios quoted in the prose (so every input printed is traceable).
  const SCEN = Object.freeze({
    dryDew: 8, humidDew: 24, halfCloud: 0.5, fullCloud: 1,
    lowK: 8, highK: 40, sideContact: 0.15,
    tunedPad: 0.45, tunedUnder: 1.75, tunedFoamMM: 20,
    mildAir: 26, mildRoom: 30, hotRoom: 36,
    smallPipe: 0.015, lowHeight: 1, smallPanel: 1, bigPanel: 4,
    pumpBelowH: 0.5, // below this loop height the page recommends a 1-3 W pump
  });

  // Back-of-envelope numbers for the candidates I rejected (section 8 of the page).
  const CAND = Object.freeze({
    carSolarGain: 1500, carDT: 5, solarFan: 0.014, // W, K, m^3/s (~30 CFM)
    roofArea: 100, rain: 0.8, head: 6, // m^2, m/yr, m
    riderMass: 90, riderKmh: 20, springSigma: 1.2e9, springE: 200e9, steelRho: 7850,
    roadWidth: 40, roadKm: 400, pipeSpacingArea: 4, // m, km, m^2 per heat pipe
  });
  function candidates() {
    const c = CAND;
    const carFlow = c.carSolarGain / (PHYS.RHO_AIR * PHYS.CP_AIR * c.carDT);
    const rainJ = 1000 * c.roofArea * c.rain * PHYS.G * c.head;
    const v = c.riderKmh / 3.6;
    const ke = 0.5 * c.riderMass * v * v;
    const springJkg = (c.springSigma * c.springSigma) / (6 * c.springE) / c.steelRho;
    const pipes = (c.roadWidth * c.roadKm * 1000) / c.pipeSpacingArea;
    return { carFlow, carRatio: carFlow / c.solarFan, rainKWh: rainJ / 3.6e6, ke, springJkg, springKg: ke / springJkg, pipes };
  }

  // ---- Every number quoted in prose, formatted exactly as printed -------------
  const f = (x, d) => (Number.isFinite(x) ? x.toFixed(d) : '—');
  const P = (o) => Object.assign({}, BASE, o);
  function quoted() {
    const S = SCEN;
    const b = solve();
    const ts = b.ts;
    const room = roomLoad();
    const sl = b.sleeper;
    const screen = solve({ windscreen: true });
    const dry = solve({ tDew: S.dryDew });
    const humid = solve({ tDew: S.humidDew });
    const half = solve({ cloud: S.halfCloud });
    const overcast = solve({ cloud: S.fullCloud });
    const lowK = solve({ kTissue: S.lowK });
    const highK = solve({ kTissue: S.highK });
    const side = solve({ contactArea: S.sideContact });
    const tuned = solve({ padArea: S.tunedPad, uUnder: S.tunedUnder });
    const mild = solve({ tAir: S.mildAir, tRoom: S.mildRoom });
    const ts15 = thermosyphon(P({ pipeD: S.smallPipe }), b.Qpanel);
    const ts1m = thermosyphon(P({ loopHeight: S.lowHeight }), b.Qpanel);
    const gel = gelMat(b.Qbody);
    const leak = dayLeak();
    const night = nightHeat(b.Qbody);
    const ex = experiment();
    const killed = solve({ kTissue: ex.kKill });
    const cand = candidates();
    const q = {
      // sleeper
      M: f(sl.M, 0),
      Qdry: f(sl.Qdry, 0),
      eNoPad: f(sl.eNoPad, 0),
      sweatNoPad: f(sl.sweatNoPad, 0),
      sweatNoPadNight: f((sl.sweatNoPad * 8) / 1000, 1),
      eWithPad: f(sl.eWithPad, 0),
      sweatWithPad: f(sl.sweatWithPad, 0),
      fracOfM: f(sl.fracOfM * 100, 0),
      sweatCut: f((1 - sl.eWithPad / sl.eNoPad) * 100, 0),
      nightMJ: f(night.MJ, 1),
      coreRise: f(night.coreRise, 1),
      fanGain: f(fanGain(), 0),
      fanGainHot: f(Math.abs(fanGain({ tRoom: S.hotRoom })), 0),
      // sky
      epsSky: f(b.epsSky, 3),
      skyDown: f(b.skyDown, 0),
      sigmaTa4: f(PHYS.SIGMA * Math.pow(toK(BASE.tAir), 4), 1),
      tSky: f(tSky(), 0),
      qRadAmbient: f(b.qRadAmbient, 0),
      epsSkyDry: f(dry.epsSky, 3),
      qRadAmbientDry: f(dry.qRadAmbient, 0),
      epsSkyHumid: f(humid.epsSky, 3),
      qRadAmbientHumid: f(humid.qRadAmbient, 0),
      // operating point
      tS: f(b.tS, 1),
      tW: f(b.tW, 1),
      plateDT: f(b.tW - b.tS, 1),
      qNet: f(b.qNet, 0),
      qRadOp: f(qRad(b.p, b.tS), 0),
      qGainOp: f(qGain(b.p, b.tS), 0),
      Qpanel: f(b.Qpanel, 0),
      Qbody: f(b.Qbody, 0),
      Qpar: f(b.Qpar, 0),
      parFrac: f(b.parFrac * 100, 0),
      uBody: f(b.uBody, 1),
      uaBody: f(b.uaBody, 2),
      uaPar: f(b.uaPar, 2),
      skinUnderPad: f(b.skinUnderPad, 1),
      padInlet: f(b.padInlet, 1),
      padOutlet: f(b.tW + ts.dT / 2, 1),
      exposed: f(BASE.padArea - BASE.contactArea, 2),
      padPressure: f((PHYS.RHO_W * PHYS.G * BASE.loopHeight) / 1000, 0),
      fabricR: f(1 / BASE.uFabric, 3),
      dewMarginPad: f(b.dewMarginPad, 1),
      QbodyScreen: f(screen.Qbody, 0),
      QbodyDry: f(dry.Qbody, 0),
      QbodyHumid: f(humid.Qbody, 0),
      dewMarginHumid: f(humid.dewMarginPad, 1),
      QbodyHalf: f(half.Qbody, 0),
      QbodyOvercast: f(overcast.Qbody, 0),
      QbodyLowK: f(lowK.Qbody, 0),
      QbodyHighK: f(highK.Qbody, 0),
      QbodySide: f(side.Qbody, 0),
      QbodyTuned: f(tuned.Qbody, 0),
      QparTuned: f(tuned.Qpar, 0),
      QbodyMild: f(mild.Qbody, 0),
      QbodyA1: f(solve({ panelArea: S.smallPanel }).Qbody, 0),
      QbodyA4: f(solve({ panelArea: S.bigPanel }).Qbody, 0),
      gainA4: f(solve({ panelArea: S.bigPanel }).Qbody - b.Qbody, 0),
      // thermosyphon
      dTloop: f(ts.dT, 1),
      mdot: f(ts.mdot * 1000, 1),
      litresPerHour: f((ts.mdot / PHYS.RHO_W) * 1000 * 3600, 0),
      dp: f(ts.dp, 0),
      vel: f(ts.vel * 100, 1),
      Re: f(ts.Re, 0),
      dTloop15: f(ts15.dT, 1),
      dTloop1m: f(ts1m.dT, 1),
      dayLeakMW: f(leak.W * 1000, 0),
      dpMM: f((ts.dp / (PHYS.RHO_W * PHYS.G)) * 1000, 1),
      bodyPressure: f((BODY.mass * PHYS.G) / BASE.contactArea / 1000, 1),
      pinchRatio: f((BODY.mass * PHYS.G) / BASE.contactArea / ts.dp, 0),
      // room comparison
      roomCeiling: f(room.ceiling, 0),
      roomWalls: f(room.walls, 0),
      roomWindows: f(room.windows, 0),
      roomInfil: f(room.infiltration, 0),
      roomOcc: f(room.occupant, 0),
      roomTotal: f(room.total, 0),
      roomElec: f(room.elec, 0),
      roomKWh: f(room.kWhNight, 1),
      roomRatio: f(room.total / b.Qbody, 0),
      roomDT: f(BASE.tAir - ROOM.tSet, 0),
      roomPanelArea: f(room.total / b.qNet, 0),
      // gel mat, cost, risk
      gelKJ: f(gel.J / 1000, 0),
      gelMin: f(gel.minutes, 0),
      costTotal: f(costTotal(), 0),
      survTech: f(survival(true) * 100, 0),
      survAll: f(survival(false) * 100, 0),
      // experiments
      expPredicted: f(ex.predicted, 0),
      expDT: f(ex.dTpad, 1),
      expRes: f(ex.resolution, 1),
      expKillK: f(ex.kKill, 0),
      expKillQbody: f(killed.Qbody, 0),
      expKillBig: f(solve({ kTissue: ex.kKill, panelArea: EXP.killPanel }).Qbody, 0),
      expGain: f(ex.gain, 0),
      expDrift: f(ex.driftKph, 1),
      skyTest: f(skyTest(), 0),
      // rejected candidates
      carFlow: f(cand.carFlow, 2),
      carRatio: f(cand.carRatio, 0),
      rainKWh: f(cand.rainKWh, 1),
      springKE: f(cand.ke, 0),
      springJkg: f(cand.springJkg, 0),
      springKg: f(cand.springKg, 0),
      icePipes: f(cand.pipes / 1e6, 0),
    };
    return q;
  }

  return {
    PHYS, BASE, ROOM, COST, RISKS, GEL, FAN, BODY, EXP, FABRIC, SCEN, CAND, DAY, candidates,
    epsSkyClear, epsSkyEff, skyDown, tSky, qRad, qGain, qNet, uBody, uaBody, uaParasitic,
    stateAt, solve, thermosyphon, sleeper, areaFor, roomLoad, dayLeak, gelMat, costTotal, survival,
    fanGain, nightHeat, experiment, skyTest,
    quoted, fmt: f,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SkyBedModel;
