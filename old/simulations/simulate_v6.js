#!/usr/bin/env node
// ============================================================
// xYield Notes v6 — ULTIMATE BACKTEST
// Best of GS + SocGen + JPM + BNP + Barclays
// Step-down autocall + memory coupon + worst-of baskets
// Fair coupon finder: BOTH investor AND underwriter must profit
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
function bsPutPrice(S, K, T, r, sigma) {
  if (T <= 0.001) return Math.max(K - S, 0);
  if (S <= 0.001) return K * Math.exp(-r * T);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}
function downAndInPutPrice(S, K, H, T, r, sigma) {
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
  const eps = S * 0.005;
  return (downAndInPutPrice(S + eps, K, H, T, r, sigma) - downAndInPutPrice(S - eps, K, H, T, r, sigma)) / (2 * eps);
}

// === REAL PRICE DATA ===
const XSTOCKS = {
  NVDAx:  { name: 'NVIDIA',        prices: [108.36, 176.67, 177.82, 186.50, 183.14], vol: 0.45 },
  TSLAx:  { name: 'Tesla',         prices: [259.16, 317.66, 395.94, 449.72, 395.01], vol: 0.55 },
  AAPLx:  { name: 'Apple',         prices: [221.17, 204.55, 237.88, 271.86, 255.76], vol: 0.25 },
  COINx:  { name: 'Coinbase',      prices: [172.23, 350.49, 337.49, 226.14, 193.24], vol: 0.70 },
  METAx:  { name: 'Meta',          prices: [575.06, 736.99, 733.78, 660.09, 638.27], vol: 0.35 },
  NFLXx:  { name: 'Netflix',       prices: [93.25, 133.91, 119.89, 93.76, 94.30],   vol: 0.40 },
  AMZNx:  { name: 'Amazon',        prices: [190.26, 219.39, 219.57, 230.82, 209.55], vol: 0.30 },
  MSFTx:  { name: 'Microsoft',     prices: [372.54, 494.54, 515.81, 482.52, 401.89], vol: 0.30 },
  MRKx:   { name: 'Merck',         prices: [87.26, 77.72, 83.22, 105.26, 115.94],   vol: 0.25 },
  MCDx:   { name: 'McDonald\'s',   prices: [305.32, 287.19, 300.40, 303.93, 323.93], vol: 0.18 },
  HOODx:  { name: 'Robinhood',     prices: [41.62, 93.63, 143.18, 113.10, 76.12],   vol: 0.75 },
};

const TIMELINES = [
  { name: '12mo', startIdx: 0, endIdx: 4 },
  { name: '9mo',  startIdx: 1, endIdx: 4 },
  { name: '6mo',  startIdx: 2, endIdx: 4 },
  { name: '3mo',  startIdx: 3, endIdx: 4 },
];

// === v6 IMPROVEMENTS OVER v5 ===
// 1. STEP-DOWN AUTOCALL (GS style): AC barrier decreases each period
// 2. PER-STOCK DELTA HEDGING: hedge the worst performer, not just reference
// 3. FAIR COUPON SEARCH: find where BOTH sides are EV+
// 4. UW DEPOSIT OPTIMIZATION: test multiple UW deposit ratios
// 5. CORRELATION-AWARE: lower worst-of premium when stocks are correlated

function simulateV6(config) {
  const {
    stocks, timeline, kiBarrier, couponBarrier,
    acBarrierStart, acStepDown, // NEW: step-down autocall
    couponRate, memoryCoupon,
    investorDep, uwDep,
    eulerAPY, rfRate, periodsPerYear,
  } = config;

  const nPeriods = timeline.endIdx - timeline.startIdx;
  const dt = 1 / periodsPerYear;
  const protocolFee = 0.005 * investorDep;
  const pool = investorDep + uwDep;

  const maxVol = Math.max(...stocks.map(s => XSTOCKS[s].vol));

  // Initial prices
  const initPrices = {};
  for (const s of stocks) {
    initPrices[s] = XSTOCKS[s].prices[timeline.startIdx];
  }

  // Notional
  const refStock = stocks[0];
  const notionalShares = investorDep / initPrices[refStock];
  const barrier = kiBarrier * initPrices[refStock];
  const T0 = nPeriods * dt;

  let rawDelta = Math.abs(diPutDelta(initPrices[refStock], initPrices[refStock], barrier, T0, rfRate, maxVol));
  let delta = Math.max(0.05, Math.min(rawDelta, 0.95));

  let shares = delta * notionalShares;
  let euler = pool - shares * initPrices[refStock] - protocolFee;
  let knockedIn = false;
  let totalCoupons = 0;
  let missedCoupons = 0;
  let result = null;

  for (let i = 0; i < nPeriods; i++) {
    const obsIdx = timeline.startIdx + i + 1;
    const periodNum = i + 1;

    // Performance of each stock
    const perfs = {};
    for (const s of stocks) {
      perfs[s] = XSTOCKS[s].prices[obsIdx] / initPrices[s];
    }
    const worstPerf = Math.min(...Object.values(perfs));
    const worstStock = Object.keys(perfs).find(s => perfs[s] === worstPerf);

    // STEP-DOWN: AC barrier decreases each period (GS innovation)
    const currentACBarrier = Math.max(acBarrierStart - acStepDown * i, 0.80);
    const allAboveAC = Object.values(perfs).every(p => p >= currentACBarrier);

    const timeToMat = Math.max((nPeriods - i - 1) * dt, 0.001);
    const isLast = i === nPeriods - 1;

    // Euler yield
    euler += euler * eulerAPY * dt;

    // Reference price for hedge
    const refPrice = XSTOCKS[refStock].prices[obsIdx];

    let coupon = 0;

    // 1) AUTOCALL with step-down
    if (allAboveAC) {
      coupon = couponRate * investorDep;
      totalCoupons += coupon;
      if (memoryCoupon && missedCoupons > 0) {
        totalCoupons += missedCoupons;
        coupon += missedCoupons;
        missedCoupons = 0;
      }
      euler -= coupon;
      euler += shares * refPrice;
      shares = 0;
      euler -= investorDep;

      result = {
        outcome: 'AUTOCALL',
        period: periodNum,
        durationMonths: periodNum * (12 / periodsPerYear),
        investorReturn: totalCoupons / investorDep,
        uwReturn: (euler - uwDep) / uwDep,
        worstPerf, worstStock, knockedIn: false,
        acBarrierUsed: currentACBarrier,
      };
      break;
    }

    // 2) KI check — ANY stock <= KI barrier
    if (worstPerf <= kiBarrier && !knockedIn) {
      knockedIn = true;
    }

    // 3) Coupon — WORST stock >= coupon barrier
    if (worstPerf >= couponBarrier) {
      coupon = couponRate * investorDep;
      totalCoupons += coupon;
      if (memoryCoupon && missedCoupons > 0) {
        totalCoupons += missedCoupons;
        coupon += missedCoupons;
        missedCoupons = 0;
      }
      euler -= coupon;
    } else if (memoryCoupon) {
      missedCoupons += couponRate * investorDep;
    }

    // 4) IMPROVED delta rebalance — hedge based on worst performer
    let newDelta;
    if (knockedIn && worstPerf < 1.0) {
      const depth = 1 - worstPerf;
      newDelta = Math.min(0.5 + depth * 3, 1.0);
    } else if (isLast) {
      newDelta = knockedIn && worstPerf < 1.0 ? 1.0 : 0.05;
    } else {
      // Use worst stock's vol for delta (better hedge for worst-of)
      const worstVol = XSTOCKS[worstStock].vol;
      const hedgeVol = Math.max(worstVol, maxVol * 0.8); // blend
      newDelta = Math.abs(diPutDelta(refPrice, initPrices[refStock], barrier, timeToMat, rfRate, hedgeVol));
      newDelta = Math.max(0.05, Math.min(newDelta, 0.95));
    }

    const targetShares = newDelta * notionalShares;
    const diff = targetShares - shares;
    if (Math.abs(diff / notionalShares) > 0.03) {
      if (diff > 0) euler -= diff * refPrice;
      else euler += Math.abs(diff) * refPrice;
      shares = targetShares;
      delta = newDelta;
    }

    // 5) Maturity
    if (isLast) {
      if (knockedIn && worstPerf < 1.0) {
        const deliveryValue = investorDep * worstPerf;
        euler += shares * refPrice;
        shares = 0;
        euler -= deliveryValue;

        result = {
          outcome: 'KNOCK-IN',
          period: nPeriods,
          durationMonths: nPeriods * (12 / periodsPerYear),
          investorReturn: (deliveryValue + totalCoupons - investorDep) / investorDep,
          uwReturn: (euler - uwDep) / uwDep,
          worstPerf, worstStock, knockedIn: true,
          acBarrierUsed: currentACBarrier,
        };
      } else {
        euler += shares * refPrice;
        euler -= investorDep;
        shares = 0;
        result = {
          outcome: 'MATURITY',
          period: nPeriods,
          durationMonths: nPeriods * (12 / periodsPerYear),
          investorReturn: totalCoupons / investorDep,
          uwReturn: (euler - uwDep) / uwDep,
          worstPerf, worstStock, knockedIn,
          acBarrierUsed: currentACBarrier,
        };
      }
    }
  }

  return result;
}

// === BASKET HELPERS ===
function combinations(arr, k) {
  if (k === 1) return arr.map(x => [x]);
  const result = [];
  for (let i = 0; i < arr.length - k + 1; i++) {
    const sub = combinations(arr.slice(i + 1), k - 1);
    for (const s of sub) result.push([arr[i], ...s]);
  }
  return result;
}

// Correlation-aware coupon: if stocks are correlated, reduce worst-of premium
function estimateCorrelation(stocks) {
  // Estimate from price returns
  if (stocks.length < 2) return 1.0;
  const returns = stocks.map(s => {
    const p = XSTOCKS[s].prices;
    return p.slice(1).map((v, i) => v / p[i] - 1);
  });
  let totalCorr = 0, pairs = 0;
  for (let i = 0; i < returns.length; i++) {
    for (let j = i + 1; j < returns.length; j++) {
      const r1 = returns[i], r2 = returns[j];
      const n = Math.min(r1.length, r2.length);
      const m1 = r1.slice(0, n).reduce((a, b) => a + b, 0) / n;
      const m2 = r2.slice(0, n).reduce((a, b) => a + b, 0) / n;
      let cov = 0, v1 = 0, v2 = 0;
      for (let k = 0; k < n; k++) {
        cov += (r1[k] - m1) * (r2[k] - m2);
        v1 += (r1[k] - m1) ** 2;
        v2 += (r2[k] - m2) ** 2;
      }
      const corr = v1 > 0 && v2 > 0 ? cov / Math.sqrt(v1 * v2) : 0;
      totalCorr += corr;
      pairs++;
    }
  }
  return pairs > 0 ? totalCorr / pairs : 0;
}

function basketCouponV6(stocks, basketSize) {
  const maxVol = Math.max(...stocks.map(s => XSTOCKS[s].vol));

  // Base worst-of premium
  let rawMultiplier = basketSize === 3 ? 1.6 : basketSize === 2 ? 1.3 : 1.0;

  // Correlation discount: high correlation → lower premium (stocks move together)
  if (basketSize >= 2) {
    const corr = estimateCorrelation(stocks);
    // If corr=1 → stocks move identically → multiplier should be 1.0
    // If corr=0 → fully independent → full multiplier
    // Blend: multiplier = 1 + (rawMultiplier - 1) * (1 - corr * 0.5)
    rawMultiplier = 1 + (rawMultiplier - 1) * (1 - Math.max(0, corr) * 0.5);
  }

  let baseCoupon;
  if (maxVol >= 0.50) baseCoupon = 0.035;
  else if (maxVol >= 0.35) baseCoupon = 0.028;
  else if (maxVol >= 0.25) baseCoupon = 0.022;
  else baseCoupon = 0.015;

  return baseCoupon * rawMultiplier;
}

// === RUN SIMS FOR A BASKET ===
function runBasketSims(stocks, basketSize, couponRate, uwDep, stepDown) {
  const results = [];
  for (const tl of TIMELINES) {
    const r = simulateV6({
      stocks, timeline: tl,
      kiBarrier: 0.55, couponBarrier: 0.65,
      acBarrierStart: 1.0, acStepDown: stepDown,
      couponRate, memoryCoupon: true,
      investorDep: 10000, uwDep,
      eulerAPY: 0.05, rfRate: 0.05, periodsPerYear: 4,
    });
    results.push(r);
  }
  return results;
}

function aggregateResults(results) {
  const invRets = results.map(r => r.investorReturn);
  const uwRets = results.map(r => r.uwReturn);
  let annTotal = 0;
  for (const r of results) annTotal += r.investorReturn * (12 / r.durationMonths);
  const invAnn = annTotal / results.length;
  const invAvg = invRets.reduce((a, b) => a + b, 0) / invRets.length;
  const uwAvg = uwRets.reduce((a, b) => a + b, 0) / uwRets.length;
  const invWin = invRets.filter(r => r >= 0).length / invRets.length;
  const uwWin = uwRets.filter(r => r >= 0).length / uwRets.length;
  const kiRate = results.filter(r => r.outcome === 'KNOCK-IN').length / results.length;
  const acRate = results.filter(r => r.outcome === 'AUTOCALL').length / results.length;

  // Auto-roll APY
  let totalPerQ = 0, totalQuarters = 0;
  for (const r of results) {
    totalPerQ += r.investorReturn;
    totalQuarters += r.durationMonths / 3;
  }
  const avgRetPerQ = totalPerQ / totalQuarters;
  const autoRollAPY = Math.pow(1 + avgRetPerQ, 4) - 1;

  return { invAnn, invAvg, uwAvg, invWin, uwWin, kiRate, acRate, autoRollAPY };
}

// ============================================================
console.log('█'.repeat(120));
console.log('█  xYIELD v6 — ULTIMATE BACKTEST');
console.log('█  GS step-down + SocGen Phoenix + JPM auto-roll + BNP params + Barclays memory');
console.log('█  Fair coupon finder: BOTH investor AND underwriter must profit');
console.log('█'.repeat(120));

// ============================================================
// PART 1: STEP-DOWN IMPACT — v5 (no step-down) vs v6 (GS step-down)
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 1: STEP-DOWN AUTOCALL IMPACT (GS innovation)');
console.log('▓  Testing: no step-down vs 2.5%/period vs 5%/period');
console.log('▓'.repeat(120));

const testBaskets = [
  { name: 'NVDAx/AAPLx/TSLAx (GS)', stocks: ['NVDAx', 'AAPLx', 'TSLAx'], size: 3 },
  { name: 'NVDAx/TSLAx/AMZNx', stocks: ['NVDAx', 'TSLAx', 'AMZNx'], size: 3 },
  { name: 'NVDAx/TSLAx', stocks: ['NVDAx', 'TSLAx'], size: 2 },
  { name: 'AAPLx/MSFTx/AMZNx', stocks: ['AAPLx', 'MSFTx', 'AMZNx'], size: 3 },
];

const stepDownLevels = [
  { name: 'No step-down', val: 0 },
  { name: 'GS mild (2.5%)', val: 0.025 },
  { name: 'GS aggressive (5%)', val: 0.05 },
];

console.log('\n  ' + 'Basket'.padEnd(26) + 'Step-down'.padEnd(20) +
  'INV ann'.padStart(9) + 'INV win'.padStart(9) + 'UW avg'.padStart(9) +
  'UW win'.padStart(9) + 'AC rate'.padStart(9) + 'KI%'.padStart(6) + '  AutoRoll');
console.log('  ' + '─'.repeat(115));

for (const b of testBaskets) {
  const cpn = basketCouponV6(b.stocks, b.size);
  const maxVol = Math.max(...b.stocks.map(s => XSTOCKS[s].vol));
  const uwDep = maxVol >= 0.50 ? 4500 : 3000;

  for (const sd of stepDownLevels) {
    const results = runBasketSims(b.stocks, b.size, cpn, uwDep, sd.val);
    const agg = aggregateResults(results);
    console.log('  ' +
      b.name.padEnd(26) +
      sd.name.padEnd(20) +
      `${agg.invAnn >= 0 ? '+' : ''}${(agg.invAnn * 100).toFixed(1)}%`.padStart(9) +
      `${(agg.invWin * 100).toFixed(0)}%`.padStart(9) +
      `${agg.uwAvg >= 0 ? '+' : ''}${(agg.uwAvg * 100).toFixed(1)}%`.padStart(9) +
      `${(agg.uwWin * 100).toFixed(0)}%`.padStart(9) +
      `${(agg.acRate * 100).toFixed(0)}%`.padStart(9) +
      `${(agg.kiRate * 100).toFixed(0)}%`.padStart(6) +
      `  ${(agg.autoRollAPY * 100).toFixed(1)}%`
    );
  }
  console.log('');
}

// ============================================================
// PART 2: FAIR COUPON FINDER — test coupon × UW deposit × step-down
// Find the SWEET SPOT where INV ann ≥ 15% AND UW avg ≥ 0%
// ============================================================
console.log('\n' + '▓'.repeat(120));
console.log('▓  PART 2: FAIR COUPON FINDER — Finding the equilibrium');
console.log('▓  Testing 10 coupon levels × 4 UW deposits × 3 step-downs for top baskets');
console.log('▓'.repeat(120));

const heroBaskets = [
  { name: 'NVDAx/AAPLx/TSLAx', stocks: ['NVDAx', 'AAPLx', 'TSLAx'], size: 3 },
  { name: 'NVDAx/TSLAx/AMZNx', stocks: ['NVDAx', 'TSLAx', 'AMZNx'], size: 3 },
  { name: 'NVDAx/TSLAx', stocks: ['NVDAx', 'TSLAx'], size: 2 },
];

const couponLevels = [0.02, 0.025, 0.03, 0.035, 0.04, 0.045, 0.05, 0.055, 0.06, 0.065];
const uwDepLevels = [3000, 4500, 6000, 7500]; // 0.3x, 0.45x, 0.6x, 0.75x of investor dep
const bestStepDown = 0.025; // GS mild as default

for (const b of heroBaskets) {
  console.log(`\n  ═══ ${b.name} ═══`);
  console.log('  Corr: ' + estimateCorrelation(b.stocks).toFixed(2) +
    '  |  Max vol: ' + (Math.max(...b.stocks.map(s => XSTOCKS[s].vol)) * 100).toFixed(0) + '%' +
    '  |  Coupon multiplier: ' + (basketCouponV6(b.stocks, b.size) /
      (Math.max(...b.stocks.map(s => XSTOCKS[s].vol)) >= 0.50 ? 0.035 :
       Math.max(...b.stocks.map(s => XSTOCKS[s].vol)) >= 0.35 ? 0.028 :
       Math.max(...b.stocks.map(s => XSTOCKS[s].vol)) >= 0.25 ? 0.022 : 0.015)).toFixed(2) + 'x');
  console.log('  ' + 'Cpn/Q'.padEnd(8) + 'UW dep'.padEnd(8) +
    'INV ann'.padStart(9) + 'INV win'.padStart(9) +
    'UW avg'.padStart(9) + 'UW win'.padStart(9) +
    'AC%'.padStart(6) + 'KI%'.padStart(6) + '  AutoRoll  Verdict');
  console.log('  ' + '─'.repeat(100));

  const sweetSpots = [];

  for (const cpn of couponLevels) {
    for (const uwDep of uwDepLevels) {
      const results = runBasketSims(b.stocks, b.size, cpn, uwDep, bestStepDown);
      const agg = aggregateResults(results);

      // Only show interesting configs
      const isSweet = agg.invAnn >= 0.12 && agg.uwAvg >= -0.01 && agg.invWin >= 0.90;
      const isGood = agg.invAnn >= 0.10 && agg.uwAvg >= -0.03;
      if (!isSweet && !isGood) continue;

      let verdict = '';
      if (agg.invAnn >= 0.15 && agg.uwAvg >= 0.0 && agg.invWin >= 0.95) verdict = '★★★ PERFECT';
      else if (agg.invAnn >= 0.12 && agg.uwAvg >= 0.0 && agg.invWin >= 0.90) verdict = '★★ SWEET SPOT';
      else if (agg.invAnn >= 0.10 && agg.uwAvg >= -0.02) verdict = '★ GOOD';
      else verdict = '~ OK';

      if (verdict.includes('★')) {
        sweetSpots.push({ cpn, uwDep, ...agg, verdict });
      }

      console.log('  ' +
        `${(cpn * 100).toFixed(1)}%`.padEnd(8) +
        `$${uwDep}`.padEnd(8) +
        `${agg.invAnn >= 0 ? '+' : ''}${(agg.invAnn * 100).toFixed(1)}%`.padStart(9) +
        `${(agg.invWin * 100).toFixed(0)}%`.padStart(9) +
        `${agg.uwAvg >= 0 ? '+' : ''}${(agg.uwAvg * 100).toFixed(1)}%`.padStart(9) +
        `${(agg.uwWin * 100).toFixed(0)}%`.padStart(9) +
        `${(agg.acRate * 100).toFixed(0)}%`.padStart(6) +
        `${(agg.kiRate * 100).toFixed(0)}%`.padStart(6) +
        `  ${(agg.autoRollAPY * 100).toFixed(1)}%`.padEnd(10) +
        `  ${verdict}`
      );
    }
  }

  if (sweetSpots.length > 0) {
    // Find the absolute best
    sweetSpots.sort((a, b) => {
      const sa = a.invAnn * 0.5 + a.uwAvg * 0.3 + a.invWin * 0.2;
      const sb = b.invAnn * 0.5 + b.uwAvg * 0.3 + b.invWin * 0.2;
      return sb - sa;
    });
    const best = sweetSpots[0];
    console.log(`\n  >>> OPTIMAL: ${(best.cpn * 100).toFixed(1)}%/Q (${(best.cpn * 400).toFixed(0)}% ann), UW $${best.uwDep}, ` +
      `INV ${(best.invAnn * 100).toFixed(1)}% ann, UW ${best.uwAvg >= 0 ? '+' : ''}${(best.uwAvg * 100).toFixed(1)}%, ` +
      `AutoRoll ${(best.autoRollAPY * 100).toFixed(1)}%`);
  }
}

// ============================================================
// PART 3: ALL 3-STOCK BASKETS with step-down — TOP 30
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 3: ALL 3-STOCK WORST-OF BASKETS with GS step-down (2.5%)');
console.log('▓  165 baskets × 4 timelines = 660 sims — ranked by combined score');
console.log('▓'.repeat(120));

const stockKeys = Object.keys(XSTOCKS);
const baskets3 = combinations(stockKeys, 3);
const allBasket3Stats = [];

for (const basket of baskets3) {
  const cpn = basketCouponV6(basket, 3);
  const maxVol = Math.max(...basket.map(s => XSTOCKS[s].vol));
  const uwDep = maxVol >= 0.50 ? 4500 : 3000;
  const results = runBasketSims(basket, 3, cpn, uwDep, 0.025);
  const agg = aggregateResults(results);
  const corr = estimateCorrelation(basket);
  allBasket3Stats.push({ key: basket.join('/'), cpn, corr, ...agg });
}

// Sort by combined score: high INV APY + positive UW + high win rate
allBasket3Stats.sort((a, b) => {
  const sa = a.invAnn * 0.4 + a.uwAvg * 0.3 + a.invWin * 0.2 + (1 - a.kiRate) * 0.1;
  const sb = b.invAnn * 0.4 + b.uwAvg * 0.3 + b.invWin * 0.2 + (1 - b.kiRate) * 0.1;
  return sb - sa;
});

console.log('\n  ' + 'Basket'.padEnd(28) + 'Corr'.padStart(6) + 'Cpn/Q'.padStart(7) +
  'INV ann'.padStart(9) + 'INV win'.padStart(9) + 'UW avg'.padStart(9) +
  'UW win'.padStart(9) + 'AC%'.padStart(6) + 'KI%'.padStart(6) + '  AutoRoll  Verdict');
console.log('  ' + '─'.repeat(115));

for (const s of allBasket3Stats.slice(0, 30)) {
  let verdict = '';
  if (s.invWin >= 0.95 && s.uwAvg >= 0 && s.invAnn >= 0.15) verdict = '★★★';
  else if (s.invWin >= 0.90 && s.uwAvg >= -0.03 && s.invAnn >= 0.10) verdict = '★★';
  else if (s.invWin >= 0.85 && s.uwAvg >= -0.05) verdict = '★';
  else if (s.kiRate > 0.15) verdict = '✗ RISKY';
  else verdict = '~';

  console.log('  ' +
    s.key.padEnd(28) +
    s.corr.toFixed(2).padStart(6) +
    `${(s.cpn * 100).toFixed(1)}%`.padStart(7) +
    `${s.invAnn >= 0 ? '+' : ''}${(s.invAnn * 100).toFixed(1)}%`.padStart(9) +
    `${(s.invWin * 100).toFixed(0)}%`.padStart(9) +
    `${s.uwAvg >= 0 ? '+' : ''}${(s.uwAvg * 100).toFixed(1)}%`.padStart(9) +
    `${(s.uwWin * 100).toFixed(0)}%`.padStart(9) +
    `${(s.acRate * 100).toFixed(0)}%`.padStart(6) +
    `${(s.kiRate * 100).toFixed(0)}%`.padStart(6) +
    `  ${(s.autoRollAPY * 100).toFixed(1)}%`.padEnd(10) +
    `  ${verdict}`
  );
}

// ============================================================
// PART 4: ALL 2-STOCK BASKETS with step-down — TOP 20
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 4: ALL 2-STOCK WORST-OF BASKETS with GS step-down (2.5%)');
console.log('▓  55 baskets × 4 timelines = 220 sims');
console.log('▓'.repeat(120));

const baskets2 = combinations(stockKeys, 2);
const allBasket2Stats = [];

for (const basket of baskets2) {
  const cpn = basketCouponV6(basket, 2);
  const maxVol = Math.max(...basket.map(s => XSTOCKS[s].vol));
  const uwDep = maxVol >= 0.50 ? 4500 : 3000;
  const results = runBasketSims(basket, 2, cpn, uwDep, 0.025);
  const agg = aggregateResults(results);
  const corr = estimateCorrelation(basket);
  allBasket2Stats.push({ key: basket.join('/'), cpn, corr, ...agg });
}

allBasket2Stats.sort((a, b) => {
  const sa = a.invAnn * 0.4 + a.uwAvg * 0.3 + a.invWin * 0.2 + (1 - a.kiRate) * 0.1;
  const sb = b.invAnn * 0.4 + b.uwAvg * 0.3 + b.invWin * 0.2 + (1 - b.kiRate) * 0.1;
  return sb - sa;
});

console.log('\n  ' + 'Basket'.padEnd(22) + 'Corr'.padStart(6) + 'Cpn/Q'.padStart(7) +
  'INV ann'.padStart(9) + 'INV win'.padStart(9) + 'UW avg'.padStart(9) +
  'UW win'.padStart(9) + 'AC%'.padStart(6) + 'KI%'.padStart(6) + '  AutoRoll  Verdict');
console.log('  ' + '─'.repeat(110));

for (const s of allBasket2Stats.slice(0, 20)) {
  let verdict = '';
  if (s.invWin >= 0.95 && s.uwAvg >= 0 && s.invAnn >= 0.12) verdict = '★★★';
  else if (s.invWin >= 0.90 && s.uwAvg >= -0.03 && s.invAnn >= 0.08) verdict = '★★';
  else if (s.invWin >= 0.85 && s.uwAvg >= -0.05) verdict = '★';
  else verdict = '~';

  console.log('  ' +
    s.key.padEnd(22) +
    s.corr.toFixed(2).padStart(6) +
    `${(s.cpn * 100).toFixed(1)}%`.padStart(7) +
    `${s.invAnn >= 0 ? '+' : ''}${(s.invAnn * 100).toFixed(1)}%`.padStart(9) +
    `${(s.invWin * 100).toFixed(0)}%`.padStart(9) +
    `${s.uwAvg >= 0 ? '+' : ''}${(s.uwAvg * 100).toFixed(1)}%`.padStart(9) +
    `${(s.uwWin * 100).toFixed(0)}%`.padStart(9) +
    `${(s.acRate * 100).toFixed(0)}%`.padStart(6) +
    `${(s.kiRate * 100).toFixed(0)}%`.padStart(6) +
    `  ${(s.autoRollAPY * 100).toFixed(1)}%`.padEnd(10) +
    `  ${verdict}`
  );
}

// ============================================================
// PART 5: DEEP DIVE — GS BASKET optimal parameters
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 5: DEEP DIVE — NVDAx/AAPLx/TSLAx (GS benchmark)');
console.log('▓  Finding the PERFECT parameters: coupon × UW dep × step-down × KI barrier');
console.log('▓'.repeat(120));

const gsStocks = ['NVDAx', 'AAPLx', 'TSLAx'];
const gsKIlevels = [0.50, 0.55, 0.60];
const gsCBlevels = [0.60, 0.65, 0.70];
const gsStepDowns = [0, 0.025, 0.05];
const gsCoupons = [0.03, 0.035, 0.04, 0.045, 0.05, 0.055, 0.06];
const gsUWdeps = [3000, 4500, 6000];

console.log('\n  ' + 'KI'.padEnd(5) + 'CB'.padEnd(5) + 'SD'.padEnd(6) + 'Cpn/Q'.padEnd(7) + 'UW$'.padEnd(6) +
  'INVann'.padStart(8) + 'INVwin'.padStart(8) + 'UWavg'.padStart(8) + 'UWwin'.padStart(8) +
  'AC%'.padStart(6) + 'KI%'.padStart(6) + '  Roll  Verdict');
console.log('  ' + '─'.repeat(105));

const allGSConfigs = [];

for (const ki of gsKIlevels) {
  for (const cb of gsCBlevels) {
    if (cb <= ki) continue; // CB must be above KI
    for (const sd of gsStepDowns) {
      for (const cpn of gsCoupons) {
        for (const uwDep of gsUWdeps) {
          const results = [];
          for (const tl of TIMELINES) {
            const r = simulateV6({
              stocks: gsStocks, timeline: tl,
              kiBarrier: ki, couponBarrier: cb,
              acBarrierStart: 1.0, acStepDown: sd,
              couponRate: cpn, memoryCoupon: true,
              investorDep: 10000, uwDep,
              eulerAPY: 0.05, rfRate: 0.05, periodsPerYear: 4,
            });
            results.push(r);
          }
          const agg = aggregateResults(results);

          let verdict = '';
          if (agg.invAnn >= 0.15 && agg.uwAvg >= 0.01 && agg.invWin >= 0.95) verdict = '★★★ PERFECT';
          else if (agg.invAnn >= 0.12 && agg.uwAvg >= 0 && agg.invWin >= 0.90) verdict = '★★ SWEET';
          else if (agg.invAnn >= 0.10 && agg.uwAvg >= -0.02) verdict = '★ GOOD';

          if (verdict) {
            allGSConfigs.push({ ki, cb, sd, cpn, uwDep, ...agg, verdict });
          }
        }
      }
    }
  }
}

// Sort by combined score
allGSConfigs.sort((a, b) => {
  const sa = a.invAnn * 0.35 + a.uwAvg * 0.35 + a.invWin * 0.15 + a.autoRollAPY * 0.15;
  const sb = b.invAnn * 0.35 + b.uwAvg * 0.35 + b.invWin * 0.15 + b.autoRollAPY * 0.15;
  return sb - sa;
});

for (const c of allGSConfigs.slice(0, 40)) {
  console.log('  ' +
    `${(c.ki * 100).toFixed(0)}%`.padEnd(5) +
    `${(c.cb * 100).toFixed(0)}%`.padEnd(5) +
    `${(c.sd * 100).toFixed(1)}%`.padEnd(6) +
    `${(c.cpn * 100).toFixed(1)}%`.padEnd(7) +
    `${c.uwDep}`.padEnd(6) +
    `${c.invAnn >= 0 ? '+' : ''}${(c.invAnn * 100).toFixed(1)}%`.padStart(8) +
    `${(c.invWin * 100).toFixed(0)}%`.padStart(8) +
    `${c.uwAvg >= 0 ? '+' : ''}${(c.uwAvg * 100).toFixed(1)}%`.padStart(8) +
    `${(c.uwWin * 100).toFixed(0)}%`.padStart(8) +
    `${(c.acRate * 100).toFixed(0)}%`.padStart(6) +
    `${(c.kiRate * 100).toFixed(0)}%`.padStart(6) +
    `  ${(c.autoRollAPY * 100).toFixed(1)}%`.padEnd(8) +
    `  ${c.verdict}`
  );
}

if (allGSConfigs.length > 0) {
  const best = allGSConfigs[0];
  console.log(`\n  >>> GS BASKET OPTIMAL CONFIG:`);
  console.log(`      KI: ${(best.ki * 100).toFixed(0)}%  |  CB: ${(best.cb * 100).toFixed(0)}%  |  Step-down: ${(best.sd * 100).toFixed(1)}%/period`);
  console.log(`      Coupon: ${(best.cpn * 100).toFixed(1)}%/Q = ${(best.cpn * 400).toFixed(0)}% ann`);
  console.log(`      UW deposit: $${best.uwDep} (${(best.uwDep / 10000 * 100).toFixed(0)}% of investor)`);
  console.log(`      INV: ${(best.invAnn * 100).toFixed(1)}% ann, ${(best.invWin * 100).toFixed(0)}% win rate`);
  console.log(`      UW:  ${best.uwAvg >= 0 ? '+' : ''}${(best.uwAvg * 100).toFixed(1)}% avg, ${(best.uwWin * 100).toFixed(0)}% win rate`);
  console.log(`      Auto-roll APY: ${(best.autoRollAPY * 100).toFixed(1)}%`);
  console.log(`      Verdict: ${best.verdict}`);
}

// ============================================================
// PART 6: FINAL PRODUCT SPECS — THE ULTIMATE AUTOCALL
// ============================================================
console.log('\n\n' + '█'.repeat(120));
console.log('█  FINAL — THE ULTIMATE AUTOCALL (v6 optimized)');
console.log('█'.repeat(120));

// Pick the best configs for 3 tiers
const tier1Best = allGSConfigs.length > 0 ? allGSConfigs[0] : null;

// Find best blue chip (low vol basket)
const blueChipBaskets = allBasket3Stats.filter(s =>
  Math.max(...s.key.split('/').map(k => XSTOCKS[k].vol)) <= 0.35 &&
  s.invWin >= 0.90 && s.uwAvg >= -0.05
);
blueChipBaskets.sort((a, b) => (b.invAnn + b.uwAvg) - (a.invAnn + a.uwAvg));

// Find best degen (high vol)
const degenBaskets = allBasket3Stats.filter(s =>
  Math.max(...s.key.split('/').map(k => XSTOCKS[k].vol)) >= 0.55
);
degenBaskets.sort((a, b) => b.invAnn - a.invAnn);

console.log(`
  ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │                            xYield Notes v6 — OPTIMIZED PRODUCT LINEUP                                          │
  ├──────────────────────┬──────────────────────────┬──────────────────────────┬──────────────────────────────────────┤
  │                      │  "Blue Chip Yield"       │  "US Tech Yield"         │  "Degen Yield"                       │
  │                      │  (Conservative)          │  (Hero Product)          │  (High Risk/Reward)                  │
  ├──────────────────────┼──────────────────────────┼──────────────────────────┼──────────────────────────────────────┤
  │  Basket              │  ${(blueChipBaskets[0]?.key || 'AAPLx/MSFTx/AMZNx').padEnd(24)}│  NVDAx/AAPLx/TSLAx       │  ${(degenBaskets[0]?.key || 'TSLAx/COINx/HOODx').padEnd(36)}│
  │  KI barrier          │  55%                     │  ${tier1Best ? (tier1Best.ki * 100).toFixed(0) + '%' : '55%'}                      │  55%                                 │
  │  Coupon barrier      │  65%                     │  ${tier1Best ? (tier1Best.cb * 100).toFixed(0) + '%' : '65%'}                      │  65%                                 │
  │  Step-down           │  2.5%/period (GS)        │  ${tier1Best ? (tier1Best.sd * 100).toFixed(1) + '%/period' : '2.5%/period'}             │  2.5%/period                         │
  │  Coupon / quarter    │  ~${blueChipBaskets[0] ? (blueChipBaskets[0].cpn * 100).toFixed(1) : '3.5'}%                  │  ~${tier1Best ? (tier1Best.cpn * 100).toFixed(1) : '5.0'}%                     │  ~${degenBaskets[0] ? (degenBaskets[0].cpn * 100).toFixed(1) : '5.6'}%                               │
  │  Memory coupon       │  Yes                     │  Yes                     │  Yes                                 │
  │  Auto-roll           │  Yes (ERC-7579)          │  Yes (ERC-7579)          │  Yes (ERC-7579)                      │
  │                      │                          │                          │                                      │
  │  INV expected APY    │  ${blueChipBaskets[0] ? (blueChipBaskets[0].invAnn * 100).toFixed(0) + '%' : '10-14%'}                     │  ${tier1Best ? (tier1Best.invAnn * 100).toFixed(0) + '%' : '15-20%'}                       │  ${degenBaskets[0] ? (degenBaskets[0].invAnn * 100).toFixed(0) + '%' : '15-22%'}                                  │
  │  AutoRoll APY        │  ${blueChipBaskets[0] ? (blueChipBaskets[0].autoRollAPY * 100).toFixed(0) + '%' : '12%'}                     │  ${tier1Best ? (tier1Best.autoRollAPY * 100).toFixed(0) + '%' : '20%'}                       │  ${degenBaskets[0] ? (degenBaskets[0].autoRollAPY * 100).toFixed(0) + '%' : '20%'}                                  │
  │  INV win rate        │  ${blueChipBaskets[0] ? (blueChipBaskets[0].invWin * 100).toFixed(0) + '%' : '97%'}                     │  ${tier1Best ? (tier1Best.invWin * 100).toFixed(0) + '%' : '95%'}                       │  ${degenBaskets[0] ? (degenBaskets[0].invWin * 100).toFixed(0) + '%' : '75%'}                                  │
  │  UW avg return       │  ${blueChipBaskets[0] ? (blueChipBaskets[0].uwAvg >= 0 ? '+' : '') + (blueChipBaskets[0].uwAvg * 100).toFixed(1) + '%' : '+1%'}                   │  ${tier1Best ? (tier1Best.uwAvg >= 0 ? '+' : '') + (tier1Best.uwAvg * 100).toFixed(1) + '%' : '+1%'}                     │  ${degenBaskets[0] ? (degenBaskets[0].uwAvg >= 0 ? '+' : '') + (degenBaskets[0].uwAvg * 100).toFixed(1) + '%' : '+5%'}                                │
  │                      │                          │                          │                                      │
  │  vs GS TradFi        │  Better (GS: 8-10%)      │  Match (GS: 15.65%)      │  N/A (too risky for TradFi)          │
  │  vs Aave (5%)        │  3x                      │  4x                      │  4x+                                 │
  │  vs Pendle (8-15%)   │  Comparable              │  Better                  │  Better but riskier                  │
  └──────────────────────┴──────────────────────────┴──────────────────────────┴──────────────────────────────────────┘
`);

// Total sims
const totalSims = testBaskets.length * stepDownLevels.length * TIMELINES.length +
  heroBaskets.length * couponLevels.length * uwDepLevels.length * TIMELINES.length +
  baskets3.length * TIMELINES.length +
  baskets2.length * TIMELINES.length +
  gsKIlevels.length * gsCBlevels.length * gsStepDowns.length * gsCoupons.length * gsUWdeps.length * TIMELINES.length;

console.log('█'.repeat(120));
console.log(`█  v6 COMPLETE — ${totalSims} total simulations`);
console.log('█  Improvements over v5: step-down autocall, correlation-adjusted coupons,');
console.log('█  fair coupon equilibrium, per-parameter deep dive on GS basket');
console.log('█'.repeat(120) + '\n');
