#!/usr/bin/env node
// ============================================================
// xYield Notes v8 — CALIBRATED MONTE CARLO
// Finding the REAL equilibrium where both sides profit
//
// Fixes from v7:
// - Test lower coupons (1.5-4.5%/Q = 6-18% APY)
// - Test lower KI barriers (40-60%)
// - Test shorter maturities (3mo, 6mo, 9mo, 1Y)
// - Test lower vol baskets
// - Sweep ALL combinations to find the true sweet spot
// - 5,000 paths per config (good convergence, fast enough)
// ============================================================

// === MATH UTILS ===
function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax / 2);
  return 0.5 * (1.0 + sign * y);
}
function bsPutDelta(S, K, T, r, sigma) {
  if (T <= 0.001) return S <= K ? -1 : 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * sqrtT);
  return normalCDF(d1) - 1;
}
function bsPutPrice(S, K, T, r, sigma) {
  if (T <= 0.001) return Math.max(K - S, 0);
  if (S <= 0.001) return K * Math.exp(-r * T);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}
function diPutPrice(S, K, H, T, r, sigma) {
  if (T <= 0.001) return S <= H ? Math.max(K - S, 0) : 0;
  if (S <= H) return bsPutPrice(S, K, T, r, sigma);
  if (S <= 0.001 || sigma <= 0.001) return 0;
  const sqrtT = Math.sqrt(T);
  const lambda = (r + sigma * sigma / 2) / (sigma * sigma);
  const x1 = Math.log(S / H) / (sigma * sqrtT) + lambda * sigma * sqrtT;
  const y = Math.log((H * H) / (S * K)) / (sigma * sqrtT) + lambda * sigma * sqrtT;
  const y1 = Math.log(H / S) / (sigma * sqrtT) + lambda * sigma * sqrtT;
  const pow2l = Math.pow(H / S, 2 * lambda);
  const pow2l2 = Math.pow(H / S, 2 * lambda - 2);
  const disc = Math.exp(-r * T);
  return Math.max(-S * normalCDF(-x1) + K * disc * normalCDF(-x1 + sigma * sqrtT)
    + S * pow2l * (normalCDF(y) - normalCDF(y1))
    - K * disc * pow2l2 * (normalCDF(y - sigma * sqrtT) - normalCDF(y1 - sigma * sqrtT)), 0);
}
function diPutDelta(S, K, H, T, r, sigma) {
  if (T <= 0.001) return S <= K ? -1 : 0;
  if (S <= H) return bsPutDelta(S, K, T, r, sigma);
  const eps = S * 0.005;
  return (diPutPrice(S + eps, K, H, T, r, sigma) - diPutPrice(S - eps, K, H, T, r, sigma)) / (2 * eps);
}

// === RNG ===
let _spare = null;
function randn() {
  if (_spare !== null) { const v = _spare; _spare = null; return v; }
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2 * Math.log(s) / s);
  _spare = v * mul;
  return u * mul;
}

function cholesky(matrix) {
  const n = matrix.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) L[i][j] = Math.sqrt(Math.max(matrix[i][i] - sum, 1e-10));
      else L[i][j] = (matrix[i][j] - sum) / L[j][j];
    }
  }
  return L;
}

// === STOCK DATA ===
const STOCKS = {
  NVDAx:  { S0: 183.14, vol: 0.45 },
  TSLAx:  { S0: 395.01, vol: 0.55 },
  AAPLx:  { S0: 255.76, vol: 0.25 },
  COINx:  { S0: 193.24, vol: 0.70 },
  METAx:  { S0: 638.27, vol: 0.35 },
  NFLXx:  { S0: 94.30,  vol: 0.40 },
  AMZNx:  { S0: 209.55, vol: 0.30 },
  MSFTx:  { S0: 401.89, vol: 0.30 },
  MRKx:   { S0: 115.94, vol: 0.25 },
  MCDx:   { S0: 323.93, vol: 0.18 },
  HOODx:  { S0: 76.12,  vol: 0.75 },
};

const CORR_MAP = {
  'NVDAx-TSLAx': 0.45, 'NVDAx-AAPLx': 0.60, 'NVDAx-COINx': 0.35,
  'NVDAx-METAx': 0.55, 'NVDAx-NFLXx': 0.40, 'NVDAx-AMZNx': 0.65,
  'NVDAx-MSFTx': 0.60, 'NVDAx-MRKx': -0.10, 'NVDAx-MCDx': -0.05,
  'NVDAx-HOODx': 0.30,
  'TSLAx-AAPLx': 0.35, 'TSLAx-COINx': 0.40, 'TSLAx-METAx': 0.30,
  'TSLAx-NFLXx': 0.25, 'TSLAx-AMZNx': 0.40, 'TSLAx-MSFTx': 0.35,
  'TSLAx-MRKx': -0.05, 'TSLAx-MCDx': -0.10, 'TSLAx-HOODx': 0.50,
  'AAPLx-COINx': 0.15, 'AAPLx-METAx': 0.65, 'AAPLx-NFLXx': 0.50,
  'AAPLx-AMZNx': 0.70, 'AAPLx-MSFTx': 0.75, 'AAPLx-MRKx': 0.10,
  'AAPLx-MCDx': 0.15, 'AAPLx-HOODx': 0.10,
  'COINx-METAx': 0.20, 'COINx-NFLXx': 0.15, 'COINx-AMZNx': 0.20,
  'COINx-MSFTx': 0.15, 'COINx-MRKx': -0.05, 'COINx-MCDx': -0.10,
  'COINx-HOODx': 0.60,
  'METAx-NFLXx': 0.55, 'METAx-AMZNx': 0.65, 'METAx-MSFTx': 0.60,
  'METAx-MRKx': 0.05, 'METAx-MCDx': 0.10, 'METAx-HOODx': 0.15,
  'NFLXx-AMZNx': 0.50, 'NFLXx-MSFTx': 0.45, 'NFLXx-MRKx': 0.05,
  'NFLXx-MCDx': 0.10, 'NFLXx-HOODx': 0.15,
  'AMZNx-MSFTx': 0.70, 'AMZNx-MRKx': 0.05, 'AMZNx-MCDx': 0.10,
  'AMZNx-HOODx': 0.15,
  'MSFTx-MRKx': 0.10, 'MSFTx-MCDx': 0.15, 'MSFTx-HOODx': 0.10,
  'MRKx-MCDx': 0.30, 'MRKx-HOODx': -0.05,
  'MCDx-HOODx': -0.05,
};

function getCorr(s1, s2) {
  if (s1 === s2) return 1.0;
  return CORR_MAP[`${s1}-${s2}`] ?? CORR_MAP[`${s2}-${s1}`] ?? 0.20;
}

// === GENERATE PATHS ===
function generatePaths(stocks, nPaths, T, nSteps) {
  const n = stocks.length;
  const dt = T / nSteps;
  const sqrtDt = Math.sqrt(dt);
  const C = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => getCorr(stocks[i], stocks[j]))
  );
  const L = cholesky(C);
  const vols = stocks.map(s => STOCKS[s].vol);
  const S0s = stocks.map(s => STOCKS[s].S0);
  const r = 0.05;
  const paths = [];
  for (let p = 0; p < nPaths; p++) {
    const path = stocks.map((_, i) => { const a = new Float64Array(nSteps + 1); a[0] = S0s[i]; return a; });
    for (let t = 0; t < nSteps; t++) {
      const z = [];
      for (let i = 0; i < n; i++) z.push(randn());
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) w[i] += L[i][j] * z[j];
      for (let i = 0; i < n; i++) {
        path[i][t + 1] = path[i][t] * Math.exp((r - 0.5 * vols[i] ** 2) * dt + vols[i] * sqrtDt * w[i]);
      }
    }
    paths.push(path);
  }
  return paths;
}

// === SIMULATE ONE PATH ===
function simPath(path, stocks, cfg) {
  const { kiBarrier, couponBarrier, acBarrierStart, acStepDown,
    couponRate, memoryCoupon, investorDep, uwDep,
    eulerAPY, rfRate, nQuarters, rebalWeeks, txCost } = cfg;

  const n = stocks.length;
  const S0 = stocks.map(s => STOCKS[s].S0);
  const vols = stocks.map(s => STOCKS[s].vol);
  const T = nQuarters * 0.25;
  const stepsPerQ = 13;
  const totalSteps = nQuarters * stepsPerQ;
  const dt = T / totalSteps;
  const protocolFee = 0.005 * investorDep;

  let cash = investorDep + uwDep - protocolFee;
  let shares = new Float64Array(n);
  let knockedIn = false;
  let totalCoupons = 0;
  let missedCoupons = 0;
  let txCosts = 0;

  // Initial hedge
  for (let i = 0; i < n; i++) {
    const barrier = kiBarrier * S0[i];
    const delta = Math.abs(diPutDelta(S0[i], S0[i], barrier, T, rfRate, vols[i]));
    const clamped = Math.max(0.05, Math.min(delta, 0.95));
    const notional = investorDep / n;
    const tgt = clamped * (notional / S0[i]);
    const cost = tgt * S0[i];
    const fee = cost * txCost;
    shares[i] = tgt;
    cash -= cost + fee;
    txCosts += fee;
  }

  for (let step = 1; step <= totalSteps; step++) {
    const currentT = step * dt;
    const timeToMat = Math.max(T - currentT, 0.001);
    const isQEnd = step % stepsPerQ === 0;
    const qNum = Math.floor((step - 1) / stepsPerQ) + 1;
    const isRebal = step % rebalWeeks === 0;
    const isLast = step === totalSteps;

    const prices = stocks.map((_, i) => path[i][step]);
    const perfs = prices.map((p, i) => p / S0[i]);
    const worstPerf = Math.min(...perfs);

    // Euler yield
    if (cash > 0) cash += cash * eulerAPY * dt;

    // Quarterly observation
    if (isQEnd) {
      const acBar = Math.max(acBarrierStart - acStepDown * (qNum - 1), 0.80);
      const allAboveAC = perfs.every(p => p >= acBar);

      if (allAboveAC) {
        let cpn = couponRate * investorDep;
        totalCoupons += cpn;
        if (memoryCoupon && missedCoupons > 0) { totalCoupons += missedCoupons; cpn += missedCoupons; missedCoupons = 0; }
        for (let i = 0; i < n; i++) {
          if (Math.abs(shares[i]) > 0.001) {
            const proc = shares[i] * prices[i]; const fee = Math.abs(proc) * txCost;
            cash += proc - fee; txCosts += fee; shares[i] = 0;
          }
        }
        cash -= investorDep + cpn;
        return { outcome: 'AUTOCALL', quarter: qNum, durationYears: currentT,
          invReturn: totalCoupons / investorDep, uwReturn: (cash - uwDep) / uwDep,
          worstPerf, knockedIn: false, txCosts };
      }

      if (worstPerf <= kiBarrier) knockedIn = true;

      if (worstPerf >= couponBarrier) {
        let cpn = couponRate * investorDep;
        totalCoupons += cpn;
        if (memoryCoupon && missedCoupons > 0) { totalCoupons += missedCoupons; cpn += missedCoupons; missedCoupons = 0; }
        cash -= cpn;
      } else if (memoryCoupon) {
        missedCoupons += couponRate * investorDep;
      }
    }

    // Continuous KI check
    if (!isQEnd && worstPerf <= kiBarrier) knockedIn = true;

    // Delta rebalance
    if (isRebal) {
      for (let i = 0; i < n; i++) {
        const S = prices[i];
        const barrier = kiBarrier * S0[i];
        const notional = investorDep / n;
        const notShares = notional / S0[i];
        let tgtDelta;
        if (knockedIn && perfs[i] < 1.0) {
          tgtDelta = Math.min(0.5 + (1 - perfs[i]) * 3, 1.0);
        } else if (isLast) {
          tgtDelta = knockedIn && perfs[i] < 1.0 ? 1.0 : 0.05;
        } else {
          tgtDelta = Math.abs(diPutDelta(S, S0[i], barrier, timeToMat, rfRate, vols[i]));
          tgtDelta = Math.max(0.05, Math.min(tgtDelta, 0.95));
          if (perfs[i] > 1.1) tgtDelta *= 0.7;
        }
        const tgt = tgtDelta * notShares;
        const diff = tgt - shares[i];
        if (Math.abs(diff) > notShares * 0.05) {
          const val = Math.abs(diff * S); const fee = val * txCost;
          if (diff > 0) cash -= diff * S + fee; else cash += Math.abs(diff) * S - fee;
          shares[i] = tgt; txCosts += fee;
        }
      }
    }

    // Maturity
    if (isLast) {
      for (let i = 0; i < n; i++) {
        if (Math.abs(shares[i]) > 0.001) {
          const proc = shares[i] * prices[i]; const fee = Math.abs(proc) * txCost;
          cash += proc - fee; txCosts += fee; shares[i] = 0;
        }
      }
      if (knockedIn && worstPerf < 1.0) {
        const deliv = investorDep * worstPerf;
        cash -= deliv + deliv * txCost;
        return { outcome: 'KNOCK-IN', quarter: nQuarters, durationYears: T,
          invReturn: (deliv + totalCoupons - investorDep) / investorDep,
          uwReturn: (cash - uwDep) / uwDep, worstPerf, knockedIn: true, txCosts };
      } else {
        cash -= investorDep;
        return { outcome: 'MATURITY', quarter: nQuarters, durationYears: T,
          invReturn: totalCoupons / investorDep, uwReturn: (cash - uwDep) / uwDep,
          worstPerf, knockedIn, txCosts };
      }
    }
  }
}

// === FULL MC ===
function runMC(stocks, cfg, nPaths) {
  const T = cfg.nQuarters * 0.25;
  const totalSteps = cfg.nQuarters * 13;
  const paths = generatePaths(stocks, nPaths, T, totalSteps);
  const results = [];
  for (let p = 0; p < nPaths; p++) { const r = simPath(paths[p], stocks, cfg); if (r) results.push(r); }
  return results;
}

function stats(results) {
  const inv = results.map(r => r.invReturn).sort((a, b) => a - b);
  const uw = results.map(r => r.uwReturn).sort((a, b) => a - b);
  const N = results.length;
  const pctl = (a, p) => a[Math.min(Math.floor(a.length * p / 100), a.length - 1)];
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const avgDur = mean(results.map(r => r.durationYears));
  const invMean = mean(inv);
  const uwMean = mean(uw);
  const avgQ = mean(results.map(r => r.quarter));
  const retPerQ = invMean / avgQ;
  const roll = Math.pow(1 + Math.max(retPerQ, -0.99), 4) - 1;

  return {
    invMean, invMedian: pctl(inv, 50), invP5: pctl(inv, 5), invP95: pctl(inv, 95),
    invWin: inv.filter(r => r >= 0).length / N,
    invAnn: invMean / avgDur, roll,
    uwMean, uwMedian: pctl(uw, 50), uwP5: pctl(uw, 5), uwP95: pctl(uw, 95),
    uwWin: uw.filter(r => r >= 0).length / N,
    acRate: results.filter(r => r.outcome === 'AUTOCALL').length / N,
    kiRate: results.filter(r => r.outcome === 'KNOCK-IN').length / N,
    avgDur, avgQ,
    avgTx: mean(results.map(r => r.txCosts)),
  };
}

function pct(v) { return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`; }

// ============================================================
console.log('█'.repeat(120));
console.log('█  xYIELD v8 — CALIBRATED MONTE CARLO');
console.log('█  5,000 paths | Weekly rebalance | 0.1% tx cost | Full parameter sweep');
console.log('█'.repeat(120));

const N = 5000;
const BASE = {
  acBarrierStart: 1.0, acStepDown: 0.025,
  memoryCoupon: true, investorDep: 10000,
  eulerAPY: 0.05, rfRate: 0.05,
  rebalWeeks: 1, txCost: 0.001,
};

// ============================================================
// PART 1: MASSIVE SWEEP — 8 baskets × 6 KI × 8 coupons × 3 maturities × 2 UW deps
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 1: PARAMETER SWEEP — Finding the equilibrium');
console.log('▓  8 baskets × 6 KI × 8 coupons × 3 maturities × 2 UW = 2,304 configs');
console.log('▓  5,000 MC paths each — filtering for configs where BOTH sides are EV+');
console.log('▓'.repeat(120));

const baskets = [
  { name: 'NVDAx solo',             stocks: ['NVDAx'] },
  { name: 'AAPLx solo',             stocks: ['AAPLx'] },
  { name: 'NVDAx/AAPLx',            stocks: ['NVDAx', 'AAPLx'] },
  { name: 'NVDAx/TSLAx',            stocks: ['NVDAx', 'TSLAx'] },
  { name: 'AAPLx/AMZNx',            stocks: ['AAPLx', 'AMZNx'] },
  { name: 'NVDAx/AAPLx/AMZNx',      stocks: ['NVDAx', 'AAPLx', 'AMZNx'] },
  { name: 'NVDAx/AAPLx/TSLAx',      stocks: ['NVDAx', 'AAPLx', 'TSLAx'] },
  { name: 'NVDAx/AAPLx/METAx',      stocks: ['NVDAx', 'AAPLx', 'METAx'] },
];

const kiLevels = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65];
const cpnLevels = [0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.045, 0.05];
const matLevels = [{ name: '6mo', nQ: 2 }, { name: '9mo', nQ: 3 }, { name: '1Y', nQ: 4 }];
const uwLevels = [4500, 6000];
const cbFixed = 0.65;

const allResults = [];
let configCount = 0;
const totalConfigs = baskets.length * kiLevels.length * cpnLevels.length * matLevels.length * uwLevels.length;

process.stdout.write(`\n  Running ${totalConfigs} configs...`);

for (const basket of baskets) {
  for (const ki of kiLevels) {
    for (const cpn of cpnLevels) {
      for (const mat of matLevels) {
        for (const uwDep of uwLevels) {
          configCount++;
          if (configCount % 100 === 0) process.stdout.write(`\r  Running ${configCount}/${totalConfigs}...`);

          const results = runMC(basket.stocks, {
            ...BASE, kiBarrier: ki, couponBarrier: cbFixed,
            couponRate: cpn, nQuarters: mat.nQ, uwDep,
          }, N);

          const s = stats(results);
          allResults.push({
            basket: basket.name, stocks: basket.stocks,
            ki, cpn, mat: mat.name, nQ: mat.nQ, uwDep, ...s,
          });
        }
      }
    }
  }
}

console.log(`\r  Done: ${totalConfigs} configs × ${N} paths = ${(totalConfigs * N / 1e6).toFixed(1)}M simulations\n`);

// Filter: BOTH sides EV+
const balanced = allResults.filter(r =>
  r.invMean >= 0 && r.uwMean >= 0 && r.invWin >= 0.70
);

// Sort by combined score: INV annualized + UW mean, weighted
balanced.sort((a, b) => {
  const sa = a.invAnn * 0.4 + a.uwMean * 0.2 + a.invWin * 0.2 + (1 - a.kiRate) * 0.1 + a.roll * 0.1;
  const sb = b.invAnn * 0.4 + b.uwMean * 0.2 + b.invWin * 0.2 + (1 - b.kiRate) * 0.1 + b.roll * 0.1;
  return sb - sa;
});

console.log(`  Found ${balanced.length} balanced configs (both INV and UW mean >= 0, INV win >= 70%)\n`);

console.log('  TOP 50 — BOTH SIDES PROFITABLE:');
console.log('  ' + 'Basket'.padEnd(24) + 'KI'.padEnd(5) + 'Cpn/Q'.padEnd(7) + 'Mat'.padEnd(5) + 'UW$'.padEnd(6) +
  'INVann'.padStart(8) + 'INVmed'.padStart(8) + 'INVwin'.padStart(8) +
  'UWavg'.padStart(8) + 'UWmed'.padStart(8) + 'UWwin'.padStart(8) +
  'AC%'.padStart(6) + 'KI%'.padStart(6) + '  Roll');
console.log('  ' + '─'.repeat(125));

for (const r of balanced.slice(0, 50)) {
  console.log('  ' +
    r.basket.padEnd(24) +
    `${(r.ki * 100).toFixed(0)}%`.padEnd(5) +
    `${(r.cpn * 100).toFixed(1)}%`.padEnd(7) +
    r.mat.padEnd(5) +
    `${r.uwDep}`.padEnd(6) +
    pct(r.invAnn).padStart(8) +
    pct(r.invMedian).padStart(8) +
    `${(r.invWin * 100).toFixed(0)}%`.padStart(8) +
    pct(r.uwMean).padStart(8) +
    pct(r.uwMedian).padStart(8) +
    `${(r.uwWin * 100).toFixed(0)}%`.padStart(8) +
    `${(r.acRate * 100).toFixed(0)}%`.padStart(6) +
    `${(r.kiRate * 100).toFixed(0)}%`.padStart(6) +
    `  ${pct(r.roll)}`
  );
}

// ============================================================
// PART 2: BEST CONFIG PER BASKET — Deep stats
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 2: BEST CONFIG PER BASKET — Detailed analysis');
console.log('▓'.repeat(120));

const basketNames = [...new Set(baskets.map(b => b.name))];
for (const bName of basketNames) {
  const bResults = balanced.filter(r => r.basket === bName);
  if (bResults.length === 0) {
    console.log(`\n  ═══ ${bName} ═══  NO balanced config found (investor always EV-)`);
    // Show best even if not balanced
    const all = allResults.filter(r => r.basket === bName);
    all.sort((a, b) => (a.invMean + a.uwMean * 0.5) - (b.invMean + b.uwMean * 0.5));
    const best = all[all.length - 1];
    if (best) {
      console.log(`    Closest: KI ${(best.ki*100).toFixed(0)}%, Cpn ${(best.cpn*100).toFixed(1)}%/Q, ${best.mat}, UW $${best.uwDep}`);
      console.log(`    INV: ${pct(best.invAnn)} ann, ${(best.invWin*100).toFixed(0)}% win, median ${pct(best.invMedian)}`);
      console.log(`    UW:  ${pct(best.uwMean)} avg, ${(best.uwWin*100).toFixed(0)}% win`);
      console.log(`    KI rate: ${(best.kiRate*100).toFixed(1)}%  |  AC rate: ${(best.acRate*100).toFixed(1)}%`);
    }
    continue;
  }

  const best = bResults[0];
  console.log(`\n  ═══ ${bName} ═══`);
  console.log(`  OPTIMAL: KI ${(best.ki*100).toFixed(0)}%, Cpn ${(best.cpn*100).toFixed(1)}%/Q (${(best.cpn*400).toFixed(0)}% ann), ${best.mat}, UW $${best.uwDep}`);
  console.log('');
  console.log('  INVESTOR:');
  console.log(`    Mean: ${pct(best.invMean)}  |  Ann: ${pct(best.invAnn)}  |  Median: ${pct(best.invMedian)}`);
  console.log(`    P5: ${pct(best.invP5)}  |  P95: ${pct(best.invP95)}`);
  console.log(`    Win rate: ${(best.invWin*100).toFixed(1)}%  |  AutoRoll APY: ${pct(best.roll)}`);
  console.log('');
  console.log('  UNDERWRITER:');
  console.log(`    Mean: ${pct(best.uwMean)}  |  Median: ${pct(best.uwMedian)}`);
  console.log(`    P5: ${pct(best.uwP5)}  |  P95: ${pct(best.uwP95)}`);
  console.log(`    Win rate: ${(best.uwWin*100).toFixed(1)}%`);
  console.log('');
  console.log('  OUTCOMES:');
  console.log(`    Autocall: ${(best.acRate*100).toFixed(1)}%  |  Maturity: ${((1-best.acRate-best.kiRate)*100).toFixed(1)}%  |  Knock-in: ${(best.kiRate*100).toFixed(1)}%`);
  console.log(`    Avg duration: ${(best.avgDur*12).toFixed(1)} months  |  Avg tx costs: $${best.avgTx.toFixed(0)}`);

  // Show top 5 configs for this basket
  console.log('\n  Top 5 configs:');
  console.log('  ' + 'KI'.padEnd(5) + 'Cpn'.padEnd(7) + 'Mat'.padEnd(5) + 'UW$'.padEnd(6) +
    'INVann'.padStart(8) + 'INVwin'.padStart(8) + 'UWavg'.padStart(8) + 'UWwin'.padStart(8) +
    'KI%'.padStart(6) + '  Roll');
  for (const r of bResults.slice(0, 5)) {
    console.log('  ' +
      `${(r.ki*100).toFixed(0)}%`.padEnd(5) +
      `${(r.cpn*100).toFixed(1)}%`.padEnd(7) +
      r.mat.padEnd(5) +
      `${r.uwDep}`.padEnd(6) +
      pct(r.invAnn).padStart(8) +
      `${(r.invWin*100).toFixed(0)}%`.padStart(8) +
      pct(r.uwMean).padStart(8) +
      `${(r.uwWin*100).toFixed(0)}%`.padStart(8) +
      `${(r.kiRate*100).toFixed(0)}%`.padStart(6) +
      `  ${pct(r.roll)}`
    );
  }
}

// ============================================================
// PART 3: DEEP DIVE on best overall config — 10,000 paths
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 3: DEEP DIVE — Best config with 10,000 paths');
console.log('▓'.repeat(120));

if (balanced.length > 0) {
  const best = balanced[0];
  process.stdout.write(`\n  Re-running ${best.basket} with 10,000 paths for precision...`);

  const deepResults = runMC(best.stocks, {
    ...BASE, kiBarrier: best.ki, couponBarrier: cbFixed,
    couponRate: best.cpn, nQuarters: best.nQ, uwDep: best.uwDep,
  }, 10000);

  const ds = stats(deepResults);
  console.log(' done\n');

  console.log(`  ═══ ${best.basket} — DEFINITIVE STATS (10,000 MC paths) ═══`);
  console.log(`  Config: KI ${(best.ki*100).toFixed(0)}%, CB 65%, Cpn ${(best.cpn*100).toFixed(1)}%/Q (${(best.cpn*400).toFixed(0)}% APY), ${best.mat}, UW $${best.uwDep}`);
  console.log(`  Step-down: 2.5%/period | Memory coupon: ON | Euler: 5% APY`);
  console.log('');
  console.log('  ┌───────────────────────────────────────────────────────────────┐');
  console.log('  │                    INVESTOR                                   │');
  console.log('  ├───────────────────────────────────────────────────────────────┤');
  console.log(`  │  Mean return:       ${pct(ds.invMean).padStart(8)}                                │`);
  console.log(`  │  Annualized:        ${pct(ds.invAnn).padStart(8)}                                │`);
  console.log(`  │  Median:            ${pct(ds.invMedian).padStart(8)}                                │`);
  console.log(`  │  P5 (worst 5%):     ${pct(ds.invP5).padStart(8)}                                │`);
  console.log(`  │  P95 (best 5%):     ${pct(ds.invP95).padStart(8)}                                │`);
  console.log(`  │  Win rate:          ${(ds.invWin*100).toFixed(1).padStart(7)}%                                │`);
  console.log(`  │  AutoRoll APY:      ${pct(ds.roll).padStart(8)}                                │`);
  console.log('  ├───────────────────────────────────────────────────────────────┤');
  console.log('  │                   UNDERWRITER                                │');
  console.log('  ├───────────────────────────────────────────────────────────────┤');
  console.log(`  │  Mean return:       ${pct(ds.uwMean).padStart(8)}                                │`);
  console.log(`  │  Median:            ${pct(ds.uwMedian).padStart(8)}                                │`);
  console.log(`  │  P5 (worst 5%):     ${pct(ds.uwP5).padStart(8)}                                │`);
  console.log(`  │  P95 (best 5%):     ${pct(ds.uwP95).padStart(8)}                                │`);
  console.log(`  │  Win rate:          ${(ds.uwWin*100).toFixed(1).padStart(7)}%                                │`);
  console.log('  ├───────────────────────────────────────────────────────────────┤');
  console.log('  │                    OUTCOMES                                  │');
  console.log('  ├───────────────────────────────────────────────────────────────┤');
  console.log(`  │  Autocall:          ${(ds.acRate*100).toFixed(1).padStart(7)}%                                │`);
  console.log(`  │  Maturity:          ${((1-ds.acRate-ds.kiRate)*100).toFixed(1).padStart(7)}%                                │`);
  console.log(`  │  Knock-in:          ${(ds.kiRate*100).toFixed(1).padStart(7)}%                                │`);
  console.log(`  │  Avg duration:      ${(ds.avgDur*12).toFixed(1).padStart(7)} mo                               │`);
  console.log(`  │  Avg tx costs:      $${ds.avgTx.toFixed(0).padStart(6)}                                  │`);
  console.log('  └───────────────────────────────────────────────────────────────┘');

  // Distribution histogram
  console.log('\n  INVESTOR RETURN DISTRIBUTION (10,000 paths):');
  const bins = [-100, -80, -60, -40, -20, -10, -5, 0, 5, 10, 15, 20, 30, 50, 100];
  const invRets = deepResults.map(r => r.invReturn * 100).sort((a, b) => a - b);
  for (let b = 0; b < bins.length - 1; b++) {
    const lo = bins[b], hi = bins[b + 1];
    const count = invRets.filter(r => r >= lo && r < hi).length;
    const pctCount = count / invRets.length;
    const bar = '█'.repeat(Math.round(pctCount * 100));
    if (count > 0) {
      console.log(`  ${lo >= 0 ? '+' : ''}${lo.toString().padStart(4)}% to ${hi >= 0 ? '+' : ''}${hi.toString().padStart(4)}%: ${bar} ${(pctCount*100).toFixed(1)}% (${count})`);
    }
  }

  console.log('\n  UNDERWRITER RETURN DISTRIBUTION:');
  const uwRets = deepResults.map(r => r.uwReturn * 100).sort((a, b) => a - b);
  for (let b = 0; b < bins.length - 1; b++) {
    const lo = bins[b], hi = bins[b + 1];
    const count = uwRets.filter(r => r >= lo && r < hi).length;
    const pctCount = count / uwRets.length;
    const bar = '█'.repeat(Math.round(pctCount * 100));
    if (count > 0) {
      console.log(`  ${lo >= 0 ? '+' : ''}${lo.toString().padStart(4)}% to ${hi >= 0 ? '+' : ''}${hi.toString().padStart(4)}%: ${bar} ${(pctCount*100).toFixed(1)}% (${count})`);
    }
  }
}

// ============================================================
// PART 4: COMPARISON TABLE — All baskets at their best config
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 4: FINAL PRODUCT LINEUP — Each basket at its optimal config');
console.log('▓'.repeat(120));

console.log('\n  ' + 'Basket'.padEnd(24) + 'Config'.padEnd(28) +
  'INVann'.padStart(8) + 'INVwin'.padStart(8) + 'INVmed'.padStart(8) +
  'UWavg'.padStart(8) + 'UWwin'.padStart(8) + 'KI%'.padStart(6) + '  Roll');
console.log('  ' + '─'.repeat(115));

for (const bName of basketNames) {
  const bResults = balanced.filter(r => r.basket === bName);
  if (bResults.length === 0) {
    const all = allResults.filter(r => r.basket === bName);
    all.sort((a, b) => (a.invMean + a.uwMean * 0.3) - (b.invMean + b.uwMean * 0.3));
    const best = all[all.length - 1];
    if (best) {
      console.log('  ' +
        best.basket.padEnd(24) +
        `KI${(best.ki*100).toFixed(0)} C${(best.cpn*100).toFixed(1)} ${best.mat} UW${best.uwDep}`.padEnd(28) +
        pct(best.invAnn).padStart(8) +
        `${(best.invWin*100).toFixed(0)}%`.padStart(8) +
        pct(best.invMedian).padStart(8) +
        pct(best.uwMean).padStart(8) +
        `${(best.uwWin*100).toFixed(0)}%`.padStart(8) +
        `${(best.kiRate*100).toFixed(0)}%`.padStart(6) +
        `  ${pct(best.roll)}  (no balanced cfg)`
      );
    }
  } else {
    const best = bResults[0];
    console.log('  ' +
      best.basket.padEnd(24) +
      `KI${(best.ki*100).toFixed(0)} C${(best.cpn*100).toFixed(1)} ${best.mat} UW${best.uwDep}`.padEnd(28) +
      pct(best.invAnn).padStart(8) +
      `${(best.invWin*100).toFixed(0)}%`.padStart(8) +
      pct(best.invMedian).padStart(8) +
      pct(best.uwMean).padStart(8) +
      `${(best.uwWin*100).toFixed(0)}%`.padStart(8) +
      `${(best.kiRate*100).toFixed(0)}%`.padStart(6) +
      `  ${pct(best.roll)}`
    );
  }
}

// ============================================================
// PART 5: vs DeFi & TradFi comparison
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 5: vs DeFi & TradFi — How we stack up');
console.log('▓'.repeat(120));

const bestOverall = balanced.length > 0 ? balanced[0] : null;
if (bestOverall) {
  console.log(`
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  xYield Notes vs Alternatives                                           │
  ├────────────────────┬─────────┬──────────┬───────────────────────────────┤
  │  Product           │  APY    │  Risk    │  Notes                        │
  ├────────────────────┼─────────┼──────────┼───────────────────────────────┤
  │  Aave USDC         │  4-6%   │  Low     │  Lending, no equity exposure  │
  │  Pendle PT         │  8-15%  │  Low-Med │  Fixed yield, maturity risk   │
  │  Ethena sUSDe      │  15-25% │  Medium  │  Basis trade, depeg risk      │
  │  GS Autocall       │  15.65% │  Medium  │  Min $250k, KYC, illiquid     │
  │                    │         │          │                               │
  │  xYield (ours)     │  ${pct(bestOverall.invAnn).padStart(6)}  │  Medium  │  Permissionless, $100 min     │
  │  AutoRoll APY      │  ${pct(bestOverall.roll).padStart(6)}  │         │  Compound on early autocall   │
  │  Win rate          │  ${(bestOverall.invWin*100).toFixed(0)}%    │         │  ${(bestOverall.kiRate*100).toFixed(0)}% chance of loss (KI)      │
  └────────────────────┴─────────┴──────────┴───────────────────────────────┘

  KEY: Our product is competitive with Pendle/Ethena at the conservative end.
  The key selling point is TRANSPARENCY — MC simulation shows exact risk profile.
  Investor knows: "${(bestOverall.invWin*100).toFixed(0)}% chance of profit, ${(bestOverall.kiRate*100).toFixed(0)}% chance of significant loss"
  This honesty is our moat vs TradFi products that hide risk behind complexity.
`);
}

console.log('█'.repeat(120));
console.log(`█  v8 COMPLETE — ${totalConfigs} configs × ${N} paths = ${(totalConfigs * N / 1e6).toFixed(1)}M total simulations`);
console.log('█'.repeat(120) + '\n');
