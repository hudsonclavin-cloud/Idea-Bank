#!/usr/bin/env node
// Verifies the dossier. Run from anywhere:  node ideas/08-sky-cooled-bed/check.mjs
//  1. index.html carries model.js verbatim and every tagged number matches a fresh build.
//  2. The headline numbers are recomputed by INDEPENDENT code below (different solver
//     formulation, own formulas) and must agree with the model.
//  3. A tiny dimensional-analysis kernel checks the units of every formula used.
//  4. Physics sanity checks (energy closure, monotonicity, thermal-diode behaviour).
//  5. README.md quotes the same numbers. 6. Folder size and no-network rules.
import fs from 'node:fs';
import path from 'node:path';
import { render, loadModel, DIR, namespaces } from './build.mjs';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL  ${msg}`);
  }
}
function near(a, b, tol, msg) {
  ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} (tol ${tol})`);
}

const modelCode = fs.readFileSync(path.join(DIR, 'model.js'), 'utf8');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
const M = loadModel(modelCode);
const q = M.quoted();
const B = M.BASE;
const P = M.PHYS;

// ---------------------------------------------------------------- 1. page vs model
{
  const a = html.indexOf('/*MODEL:BEGIN*/') + '/*MODEL:BEGIN*/'.length;
  const b = html.indexOf('/*MODEL:END*/');
  ok(html.slice(a, b).trim() === modelCode.trim(), 'inline model in index.html is byte-identical to model.js');
  const fresh = render(html, modelCode);
  if (fresh.html !== html) {
    let i = 0;
    while (i < html.length && html[i] === fresh.html[i]) i++;
    ok(false, `index.html is stale vs model.js (run node build.mjs); first difference near: ${JSON.stringify(html.slice(Math.max(0, i - 60), i + 40))}`);
  } else ok(true, '');
  ok(fresh.count > 300, `expected >300 tagged numbers, found ${fresh.count}`);
  const tags = [...html.matchAll(/data-v="([^"]+)"[^>]*>([^<]*)</g)];
  for (const [, key, text] of tags) ok(/^-?\d+(\.\d+)?$/.test(text), `tag ${key} holds a clean number (got "${text}")`);
  for (const [k, v] of Object.entries(q)) ok(/^-?\d+(\.\d+)?$/.test(v), `quoted ${k} is finite (got "${v}")`);
}

// ---------------------------------------------------------------- 2. independent recomputation
// Own constants (re-typed, not imported) so a typo in the model would show up here.
const SIG = 5.670374419e-8;
const K0 = 273.15;
{
  // sky
  const x = B.tDew / 100;
  const eSky = 0.711 + 0.56 * x + 0.73 * x * x;
  near(eSky, 0.8193, 5e-4, 'clear-sky emissivity at Tdp=16');
  const Ta4 = (B.tAir + K0) ** 4;
  near(SIG * Ta4, Number(q.sigmaTa4), 0.06, 'sigma Ta^4');
  near(Math.pow(eSky, 0.25) * (B.tAir + K0) - K0, Number(q.tSky), 0.5, 'effective sky temperature');
  near(B.epsPanel * SIG * Ta4 * (1 - eSky), Number(q.qRadAmbient), 0.5, 'net radiation at ambient');

  // coupled balance, formulated on the WATER temperature with an inner fixed-point
  // iteration for the plate temperature, solved by the secant method (model uses bisection on Ts)
  const h = B.hConvBare + B.uBack;
  function plateFlux(tW) {
    let tS = tW - 0.5;
    for (let i = 0; i < 200; i++) {
      const qn = B.epsPanel * SIG * ((tS + K0) ** 4 - eSky * Ta4) - h * (B.tAir - tS);
      tS = tW - qn / B.hPlate;
    }
    return B.epsPanel * SIG * ((tS + K0) ** 4 - eSky * Ta4) - h * (B.tAir - tS);
  }
  const Tmr = 33 + 0.4 * (35 - 33); // walls at room air, ceiling 2 K hotter filling 40% of the view
  near(Tmr, Number(q.mrt), 0.05, 'mean radiant temperature');
  const Ub = 1 / (1 / B.kTissue + 1 / 40); // 40 = 1/(0.01+0.0015+0.003+0.0105)
  const UAb = Ub * B.contactArea;
  const exposedPad = 0.72 - 0.3;
  // parasitic gains written out term by term (model folds them into UA_par and an effective temperature)
  const Qpar_of = (tW) => exposedPad * (1.5 * (33 - tW) + 5.5 * (Tmr - tW)) + 3.5 * 0.72 * (33 - tW) + 0.4 * (33 - tW);
  const F = (tW) => B.panelArea * plateFlux(tW) - UAb * (B.tCore - tW) - Qpar_of(tW);
  let t0 = 20;
  let t1 = 32;
  for (let i = 0; i < 60; i++) {
    const f0 = F(t0);
    const f1 = F(t1);
    if (Math.abs(f1 - f0) < 1e-14) break;
    const t2 = t1 - (f1 * (t1 - t0)) / (f1 - f0);
    t0 = t1;
    t1 = t2;
  }
  const tW = t1;
  const Qbody = UAb * (B.tCore - tW);
  const Qpar = Qpar_of(tW);
  const base = M.solve();
  near(tW, base.tW, 1e-6, 'water temperature (independent secant solve)');
  near(Qbody, base.Qbody, 1e-5, 'Q_body (independent)');
  near(Qpar, base.Qpar, 1e-5, 'Q_par (independent, term by term)');
  near(Qbody + Qpar, base.Qpanel, 1e-5, 'Q_panel = Q_body + Q_par (independent)');
  near(Qbody, Number(q.Qbody), 0.5, 'quoted Q_body');
  near(Ub, Number(q.uBody), 0.05, 'quoted U_body');

  // panel no-load temperature by its own bisection, and the infinite-panel cap
  let a = 0;
  let z = 40;
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (a + z);
    const qn = B.epsPanel * SIG * ((m + K0) ** 4 - eSky * Ta4) - h * (B.tAir - m);
    if (qn > 0) z = m;
    else a = m;
  }
  near(a, Number(q.tStag), 0.05, 'panel no-load temperature');
  near(UAb * (37 - a), Number(q.QbodyCap), 0.5, 'infinite-panel cap on Q_body');

  // thermosyphon: find mdot where buoyancy equals friction by bisection (model uses a closed form).
  // Friction budget written out: 24 m of 20 mm pipe (20 m + 4 m fittings), spacer pad, panel channels.
  const rho = 997, cp = 4180, mu = 0.00089, beta = 2.57e-4, g = 9.81;
  const Rpipe = (128 * mu * 24) / (Math.PI * 0.02 ** 4);
  const Rpad = (12 * mu * 0.6 * 3) / (1.2 * 0.003 ** 3);
  const Rpanel = (128 * mu * 1.0) / (Math.PI * 0.005 ** 4 * 250);
  const RcapX = (128 * mu * 0.6) / (Math.PI * 0.0027 ** 4 * 80);
  const RcapL = (128 * mu * 1.2) / (Math.PI * 0.0027 ** 4 * 40);
  near((Rpipe + Rpad + Rpanel) / 1e6, Number(q.rLoop), 0.005, 'loop hydraulic resistance');
  const Q = base.Qpanel;
  const solveFlow = (R, H, Qh) => {
    const resid = (md) => rho * beta * (Qh / (cp * md)) * g * H - (R * md) / rho;
    let lo = 1e-7;
    let hi = 1;
    for (let i = 0; i < 200; i++) {
      const mid = Math.sqrt(lo * hi);
      if (resid(mid) > 0) lo = mid;
      else hi = mid;
    }
    return Math.sqrt(lo * hi);
  };
  const md = solveFlow(Rpipe + Rpad + Rpanel, 3, Q);
  near(Q / (cp * md), base.ts.dT, 1e-6, 'thermosyphon dT (independent bisection on flow)');
  near(md * 1000, Number(q.mdot), 0.05, 'quoted mass flow g/s');
  near((4 * md) / (Math.PI * 0.02 * mu), Number(q.Re), 0.5, 'quoted Reynolds number');
  near((Rpad * md) / rho, Number(q.dpPad), 0.05, 'pad pressure drop (Pa)');
  near((Rpipe * md) / rho, Number(q.dpPipe), 0.05, 'pipe pressure drop (Pa)');
  const capX = M.solve({ padType: 'capX' });
  const mdX = solveFlow(Rpipe + RcapX + Rpanel, 3, capX.Qpanel);
  near(capX.Qpanel / (cp * mdX), Number(q.dTcapX), 0.05, 'capillary mat (across) loop dT');
  const capL = M.solve({ padType: 'capL' });
  const mdL1 = solveFlow(Rpipe + RcapL + Rpanel, 1, capL.Qpanel);
  near(capL.Qpanel / (cp * mdL1), Number(q.dTcapL1m), 0.05, 'capillary mat (lengthwise) loop dT at 1 m');
  near(3 * ((Q / (cp * md)) / 8) ** 2, Number(q.hMin), 0.05, 'lowest pumpless height');
  near((1e-3 * Rpad) / (rho * g * 0.01), Number(q.benchSpacer), 0.5, 'bench seconds per litre, spacer pad');
  near((1e-3 * (Rpipe + Rpanel)) / (rho * g * 0.01), Number(q.benchMax), 0.5, 'bench pass threshold seconds');
  near((rho * g * 3) / ((70 * 9.81) / 0.3), Number(q.pressRatio), 0.5, 'pad static pressure / body pressure');

  // sleeper: convection to 33 degC air, radiation to the mean radiant temperature
  const Msleep = 0.7 * 58.2 * 1.8;
  const Qdry = (1.8 - 0.3) * (3.0 * (34.5 - 33) + 4.5 * (34.5 - Tmr));
  near(Msleep, Number(q.M), 0.5, 'sleeping metabolism');
  near(Qdry, Number(q.Qdry), 0.5, 'dry heat loss');
  near(((Msleep - Qdry) / 2.42e6) * 3.6e6, Number(q.sweatNoPad), 0.5, 'sweat rate without pad (g/h)');
  near(((Msleep - Qdry - Qbody) / 2.42e6) * 3.6e6, Number(q.sweatWithPad), 0.5, 'sweat rate with pad (g/h)');
  near((Qbody / (Msleep - Qdry)) * 100, Number(q.sweatCut), 0.5, 'sweat cut %');

  // room
  const room = 12 * 8 * 9 + 16.7 * 1.5 * 5 + 1.5 * 5 * 5 + ((0.5 * 31.2) / 3600) * 1.2 * 1005 * 5 + Msleep;
  near(room, Number(q.roomTotal), 0.5, 'room cooling load');
  near(room / Qbody, Number(q.roomRatio), 0.5, 'room / body ratio');

  // risks
  const tech = 0.75 * 0.85 * 0.9 * 0.9 * 0.85;
  near(tech * 100, Number(q.survTech), 0.5, 'technical survival %');
  near(tech * 0.65 * 0.75 * 100, Number(q.survAll), 0.5, 'overall survival %');

  // day leak, gel mat, candidates
  near(((2 * 0.6 * Math.PI * 0.01 * 0.01 * (70 - 33)) / 3) * 1000, Number(q.dayLeakMW), 0.5, 'daytime conduction leak (mW)');
  near((2 * 4180 * 8) / Qbody / 60, Number(q.gelMin), 0.5, 'gel mat minutes');
  near(1500 / (1.2 * 1005 * 5), Number(q.carFlow), 0.005, 'hot-car airflow');
  near((1000 * 100 * 0.8 * 9.81 * 6) / 3.6e6, Number(q.rainKWh), 0.05, 'rain-pipe energy');
  near(0.5 * 90 * (20 / 3.6) ** 2, Number(q.springKE), 0.5, 'bike kinetic energy');
  near((0.5 * 90 * (20 / 3.6) ** 2) / ((1.2e9 ** 2 / (6 * 200e9)) / 7850), Number(q.springKg), 0.5, 'spring mass');

  // experiment: the control night and its corrections
  const pred = UAb * (B.tCore - 28);
  near(pred, Number(q.expPredicted), 0.5, 'experiment prediction');
  const patch = 0.3 * (1.5 * (33 - 28) + 5.5 * (Tmr - 28));
  near(patch, Number(q.expPatch), 0.5, 'room gain on the body patch (empty-bed bias)');
  near(pred - patch, Number(q.expNaive), 0.5, 'what a plain empty-bed subtraction would read');
  near(0.7 * 0.3 * (33 - 28), Number(q.expBoard), 0.5, 'foam-board leak');
  near(UAb - 0.3 * (1.5 + 5.5), Number(q.expNaiveSlope), 0.05, 'naive slope');
  near(1 / (1 / (30 / 9 / 0.3) - 1 / 40), Number(q.expPassK), 0.5, 'tissue conductance at the pass line');
  const gain = pred + Qpar_of(28) + 5 + 0.8 * (33 - 28);
  near(gain, Number(q.expGain), 0.5, 'bucket total gain');
  near((gain * 3600) / (50 * 4180), Number(q.expDrift), 0.05, 'bucket drift K/h');
  near((70 * 9.81) / 0.3 / 1000, Number(q.bodyPressure), 0.05, 'body contact pressure kPa');
  near((base.ts.dp / (997 * 9.81)) * 1000, Number(q.dpMM), 0.05, 'loop drive in mm of water');
  near(0.005 * 4180 * 0.05, Number(q.expRes), 0.05, 'experiment resolution');
}

// ---------------------------------------------------------------- 3. dimensional analysis
{
  const DIMS = ['kg', 'm', 's', 'K'];
  const U = (v, d = {}) => ({ v, d: Object.fromEntries(DIMS.map((k) => [k, d[k] || 0])) });
  const mul = (a, b) => U(a.v * b.v, Object.fromEntries(DIMS.map((k) => [k, a.d[k] + b.d[k]])));
  const div = (a, b) => U(a.v / b.v, Object.fromEntries(DIMS.map((k) => [k, a.d[k] - b.d[k]])));
  const pow = (a, n) => U(a.v ** n, Object.fromEntries(DIMS.map((k) => [k, a.d[k] * n])));
  const add = (a, b) => {
    const same = DIMS.every((k) => Math.abs(a.d[k] - b.d[k]) < 1e-12);
    ok(same, `unit mismatch in addition: ${JSON.stringify(a.d)} + ${JSON.stringify(b.d)}`);
    return U(a.v + b.v, a.d);
  };
  const sub = (a, b) => add(a, U(-b.v, b.d));
  const is = (a, d, name) => ok(DIMS.every((k) => Math.abs(a.d[k] - (d[k] || 0)) < 1e-12), `units of ${name}: got ${JSON.stringify(a.d)}`);
  const W = { kg: 1, m: 2, s: -3 };
  const J = { kg: 1, m: 2, s: -2 };
  const Pa = { kg: 1, m: -1, s: -2 };
  const sigma = U(SIG, { kg: 1, s: -3, K: -4 });
  const T = U(304.15, { K: 1 });
  is(mul(sigma, pow(T, 4)), { kg: 1, s: -3 }, 'sigma T^4 (W/m^2)');
  const hc = U(10, { kg: 1, s: -3, K: -1 });
  const dT = U(3.2, { K: 1 });
  is(sub(mul(sigma, pow(T, 4)), mul(hc, dT)), { kg: 1, s: -3 }, 'q_net (W/m^2)');
  const area = U(0.3, { m: 2 });
  is(mul(mul(hc, area), dT), W, 'UA dT (W)');
  const mu = U(0.00089, { kg: 1, m: -1, s: -1 });
  const L = U(14, { m: 1 });
  const Qw = U(64, W);
  const D4 = pow(U(0.02, { m: 1 }), 4);
  const rho = U(997, { kg: 1, m: -3 });
  const beta = U(2.57e-4, { K: -1 });
  const g = U(9.81, { m: 1, s: -2 });
  const H = U(3, { m: 1 });
  const cp = U(4180, { m: 2, s: -2, K: -1 });
  const inner = div(mul(mul(U(128), mu), mul(L, Qw)), mul(mul(mul(D4, pow(rho, 2)), mul(beta, g)), mul(H, cp)));
  is(pow(inner, 0.5), { K: 1 }, 'thermosyphon dT (K)');
  const mdot = div(Qw, mul(cp, U(2.5, { K: 1 })));
  is(mdot, { kg: 1, s: -1 }, 'mass flow (kg/s)');
  is(mul(mul(mul(rho, beta), U(2.5, { K: 1 })), mul(g, H)), Pa, 'buoyancy pressure (Pa)');
  is(div(mul(mul(U(128), mu), mul(L, mdot)), mul(D4, rho)), Pa, 'Hagen-Poiseuille pressure (Pa)');
  is(div(mdot, mul(U(0.02, { m: 1 }), mu)), {}, 'Reynolds number (dimensionless)');
  is(div(U(56, W), U(2.42e6, { m: 2, s: -2 })), { kg: 1, s: -1 }, 'sweat rate (kg/s)');
  const perS = U(0.5 / 3600, { s: -1 });
  is(mul(mul(mul(perS, U(31.2, { m: 3 })), mul(U(1.2, { kg: 1, m: -3 }), U(1005, { m: 2, s: -2, K: -1 }))), U(5, { K: 1 })), W, 'infiltration load (W)');
  is(div(U(1e6, J), mul(U(70, { kg: 1 }), U(3470, { m: 2, s: -2, K: -1 }))), { K: 1 }, 'core-temperature rise (K)');
  is(div(div(pow(U(1.2e9, Pa), 2), U(6 * 200e9, Pa)), U(7850, { kg: 1, m: -3 })), { m: 2, s: -2 }, 'spring energy density (J/kg)');
  is(mul(mul(mul(U(1000, { kg: 1, m: -3 }), U(80, { m: 3 })), g), U(6, { m: 1 })), J, 'rain potential energy (J)');
  // hydraulic resistances (Pa s m^-3) and the resistance form of the thermosyphon dT
  const PaSm3 = { kg: 1, m: -4, s: -1 };
  is(div(mul(mul(U(12), mu), U(0.6, { m: 1 })), mul(U(1.2, { m: 1 }), pow(U(0.003, { m: 1 }), 3))), PaSm3, 'spacer-gap resistance (Pa s/m^3)');
  is(div(mul(mul(U(128), mu), L), D4), PaSm3, 'tube resistance (Pa s/m^3)');
  const Rl = U(6.26e6, PaSm3);
  is(pow(div(mul(Rl, Qw), mul(mul(pow(rho, 2), mul(beta, g)), mul(H, cp))), 0.5), { K: 1 }, 'thermosyphon dT, resistance form (K)');
  is(div(mul(Rl, U(4.3e-6, { m: 3, s: -1 })), U(1)), Pa, 'R x volume flow (Pa)');
  is(div(mul(U(1e-3, { m: 3 }), Rl), mul(mul(rho, g), U(0.01, { m: 1 }))), { s: 1 }, 'bench check time (s)');
  const kW = U(0.6, { kg: 1, m: 1, s: -3, K: -1 });
  is(div(mul(mul(kW, U(3.14e-4, { m: 2 })), U(37, { K: 1 })), H), W, 'daytime conduction leak (W)');
}

// ---------------------------------------------------------------- 4. physics sanity
{
  const b = M.solve();
  ok(Math.abs(b.resid) < 1e-6, `energy balance closes (residual ${b.resid} W)`);
  near(b.ts.dp, b.ts.dpFriction, 1e-9 * b.ts.dp, 'buoyancy equals friction at the solved flow');
  ok(b.ts.Re < 2000, 'base-case flow is laminar');
  near(M.epsSkyClear(0), 0.711, 1e-12, 'Berdahl-Martin intercept');
  near(SIG * 300 ** 4, 459.3, 0.05, 'sigma*300^4 sanity');
  const Q = (o) => M.solve(o).Qbody;
  ok(Q({ panelArea: 1 }) < Q({ panelArea: 2 }) && Q({ panelArea: 2 }) < Q({ panelArea: 4 }), 'more panel -> more cooling');
  ok(Q({ panelArea: 4 }) - Q({ panelArea: 2 }) < Q({ panelArea: 2 }) - Q({ panelArea: 0.01 + 0 }), 'diminishing returns with panel area');
  ok(Q({ tDew: 8 }) > Q({ tDew: 16 }) && Q({ tDew: 16 }) > Q({ tDew: 24 }), 'more humid -> less cooling');
  ok(Q({ cloud: 0 }) > Q({ cloud: 0.5 }) && Q({ cloud: 0.5 }) > Q({ cloud: 1 }), 'more cloud -> less cooling');
  ok(Q({ kTissue: 8 }) < Q({ kTissue: 20 }) && Q({ kTissue: 20 }) < Q({ kTissue: 40 }), 'more tissue conductance -> more cooling');
  ok(M.solve({ tAir: 40, cloud: 1 }).running === false, 'thermal diode: hot overcast night above body temperature -> loop does not run');
  ok(M.thermosyphon(B, 64).dT > M.thermosyphon(Object.assign({}, B, { loopHeight: 6 }), 64).dT, 'taller loop -> smaller dT');
  ok(b.dewMarginPad > 0, 'base case: pad stays above bedroom dew point');
  ok(b.ts.dT <= M.DESIGN.dTmax, 'base case: loop dT within the design limit');
  near(b.ts.dpPipe + b.ts.dpPad + b.ts.dpPanel, b.ts.dp, 1e-9, 'friction budget components sum to the drive');
  ok(M.solve({ padType: 'capL' }).ts.dT > M.solve({ padType: 'capX' }).ts.dT && M.solve({ padType: 'capX' }).ts.dT > b.ts.dT, 'more pad friction -> larger loop dT');
  ok(Math.abs(M.solve({ padType: 'capL' }).Qbody - b.Qbody) < 0.5, 'pad friction changes dT, not (mean-temperature) body heat');
  ok(M.tStagnation() < b.tS, 'panel floor temperature lies below the operating point');
  ok(M.solve({ panelArea: 50 }).Qbody < Number(q.QbodyCap) + 0.5, 'huge panel stays under the no-load cap');
  ok(M.experiment().naiveReads < M.EXP.passW && M.experiment().predicted >= M.EXP.passW, 'naive empty-bed control would fail a model-perfect sleeper; corrected one passes');
  ok(!b.dewOnPanel, 'base case: no dew on panel');
  ok(b.sleeper.eWithPad > 0, 'base case: pad does not over-cool the sleeper');
  near(M.costTotal(), M.COST.reduce((s, c) => s + c[1], 0), 0, 'cost total');
  const ns = namespaces(M);
  near(ns.K.body, 0.25, 0, 'risk table wired');
  near(B.uFabric, 40, 1e-9, 'fabric conductance is 40 W/m2K');
}

// ---------------------------------------------------------------- 5. README agrees
{
  const need = [
    `${q.Qbody} W is drawn`, `${q.fracOfM}%`, `${q.M} W`, `${q.tSky} °C`, `${q.qNet} W/m²`, `${q.Qpanel} W from`,
    `${q.uaBody} W/K`, `${q.QbodyLowK} W`, `${q.QbodyHighK} W`, `${q.dTloop} K, ${q.mdot} g/s, ${q.dp} Pa and Re ${q.Re}`,
    `${q.roomTotal} W`, `${q.roomRatio}×`, `from ${q.sweatNoPad} to ${q.sweatWithPad} g/h`, `${q.sweatCut}% reduction`,
    `${q.survTech}%`, `${q.survAll}%`, `${q.Qpar} W (${q.parFrac}%)`, `about ${q.QbodyOvercast} W`,
    `${q.expPredicted} W from the sleeper at ${M.EXP.tWater} °C water`, `${q.expDT} K rise`, `≤ ${q.expKillK} W/m²K`, `≥ ${q.expPassK} W/m²K`,
    `${q.skyTest} W/m²`, `$${q.costTotal}`, `is ${q.epsSky}`, `${q.tS} °C`, `only ${q.Qdry} W of dry heat`, `${q.mrt} °C mean radiant`,
    `${q.roomElec} W`, `${q.qRadOp} W/m²`, `${q.qGainOp} W/m² straight back`, `buys just ${q.gainA4} W`, `(${B.uFabric} W/m²K)`,
    `about ${q.tStag} °C`, `about ${q.QbodyCap} W even with an infinite panel`,
    `(${q.dpPipe} Pa)`, `(${q.dpPad} Pa)`, `(${q.dpPanel} Pa)`, `down to ${q.hMin} m of height`, `${q.dTcapX}–${q.dTcapL} K at 3 m`,
    `${q.hMinCapX}–${q.hMinCapL} m of height`, `about ${q.padPressure} kPa`, `roughly ${q.pressRatio}×`, `${q.bodyPressure} kPa body`,
    `${q.dp} Pa drive is only ${q.dpMM} mm`, `±${q.expRes.split('.')[0]} W`, `tissue conductance is ${M.SCEN.lowK} the sleeper gets only`,
    `if it is ${M.SCEN.highK}, ${q.QbodyHighK} W`, `about ${q.expGain} W in total`, `about ${q.expDrift} K per hour`,
    `only ${q.expKillBig} W`, `about ${M.EXP.tStart} °C`, `about ${q.benchSpacer} s`, `${q.benchCapX}–${q.benchCapL} s`, `Slower than ${q.benchMax} s`,
    `about ${q.expPatch} W`, `read about ${q.expNaive} W`, `leaks about ${q.expBoard} W`, `slope of ${q.uaBody} W/K`,
    `from ${M.OLD.dTloop} K / ${M.OLD.mdot.toFixed(1)} g/s / ${M.OLD.dp} Pa to ${q.dTloop} K / ${q.mdot} g/s / ${q.dp} Pa`,
    `from ${M.OLD.sweatNoPad} → ${M.OLD.sweatWithPad} g/h to ${q.sweatNoPad} → ${q.sweatWithPad} g/h`,
    `within an ${M.DESIGN.dTmax} K`, `at ${q.tCeil} °C`,
  ];
  for (const s of need) ok(readme.includes(s), `README mentions "${s}"`);
  for (const h of ['## What it is', '## Why I made it', '## The key numbers', '## Honest assessment', '## The first experiment', '**Kind:** dossier', '**Run:** open index.html in a browser', '**Made by:**']) ok(readme.includes(h), `README has "${h}"`);
}

// ---------------------------------------------------------------- 6. folder rules
{
  let bytes = 0;
  for (const f of fs.readdirSync(DIR)) bytes += fs.statSync(path.join(DIR, f)).size;
  ok(bytes < 500 * 1024, `folder under 500 KB (is ${(bytes / 1024).toFixed(0)} KB)`);
  const urls = [...html.matchAll(/https?:\/\/[^\s"'<)]+/g)].map((m) => m[0]).filter((u) => u !== 'http://www.w3.org/2000/svg');
  ok(urls.length === 0, `no external URLs in index.html (${urls.join(', ')})`);
  ok(!/\bfetch\(|XMLHttpRequest|<link\b|<script[^>]+src=/i.test(html), 'no network calls or external assets');
  ok(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html), 'viewport meta present');
}

console.log(`\ncheck: ${pass} passed, ${fail} failed`);
console.log(`base case: ${q.Qbody} W from sleeper (${q.fracOfM}% of ${q.M} W), water ${q.tW} °C, panel ${q.qNet} W/m², loop dT ${q.dTloop} K at ${q.mdot} g/s, Re ${q.Re}`);
process.exit(fail ? 1 : 0);
