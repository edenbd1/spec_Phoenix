#!/usr/bin/env node
// ============================================================
// xYield Notes v3 — Strategy Optimization for DeFi
// Compares 3 strategy variants on the same historical data
// + Memory coupon, step-down autocall, vol-adjusted barriers
// ============================================================

// === MATH UTILS (unchanged) ===

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
  const logSH = Math.log(S / H);
  const logH2SK = Math.log((H * H) / (S * K));
  const x1 = logSH / (sigma * sqrtT) + lambda * sigma * sqrtT;
  const y = logH2SK / (sigma * sqrtT) + lambda * sigma * sqrtT;
  const y1 = Math.log(H / S) / (sigma * sqrtT) + lambda * sigma * sqrtT;
  const pow2l = Math.pow(H / S, 2 * lambda);
  const pow2l2 = Math.pow(H / S, 2 * lambda - 2);
  const disc = Math.exp(-r * T);
  const p = -S * normalCDF(-x1) + K * disc * normalCDF(-x1 + sigma * sqrtT)
    + S * pow2l * (normalCDF(y) - normalCDF(y1))
    - K * disc * pow2l2 * (normalCDF(y - sigma * sqrtT) - normalCDF(y1 - sigma * sqrtT));
  return Math.max(p, 0);
}

function diPutDelta(S, K, H, T, r, sigma) {
  if (T <= 0.001) return S <= K ? -1 : 0;
  const eps = S * 0.005;
  const pUp = downAndInPutPrice(S + eps, K, H, T, r, sigma);
  const pDn = downAndInPutPrice(S - eps, K, H, T, r, sigma);
  return (pUp - pDn) / (2 * eps);
}

// === ENHANCED SIMULATION ENGINE ===

function simulateV3(config) {
  const {
    name, stratName, initialPrice, obsPrices,
    acBarrier, acStepDown, // step-down per period (e.g. 0.025 = 2.5%/quarter)
    kiBarrier, couponBarrier,
    couponRate, memoryCoupon,
    investorDep, uwDep,
    eulerAPY, sigma, rfRate,
    periodsPerYear,
  } = config;

  const pool = investorDep + uwDep;
  const notionalShares = investorDep / initialPrice;
  const nPeriods = obsPrices.length;
  const dt = 1 / periodsPerYear;
  const strike = initialPrice;
  const barrier = kiBarrier * initialPrice;
  const protocolFee = 0.005 * investorDep;

  let euler = 0;
  let shares = 0;
  let knockedIn = false;
  let totalCoupons = 0;
  let couponsCount = 0;
  let missedCoupons = 0; // memory coupon accumulator

  // Initial hedge
  const T0 = nPeriods * dt;
  let rawDelta = Math.abs(diPutDelta(initialPrice, strike, barrier, T0, rfRate, sigma));
  let delta = Math.max(0.05, Math.min(rawDelta, 0.95));
  const initShares = delta * notionalShares;
  shares = initShares;
  euler = pool - initShares * initialPrice - protocolFee;

  let result = null;

  for (let i = 0; i < nPeriods; i++) {
    const price = obsPrices[i];
    const perf = price / initialPrice;
    const timeToMat = Math.max((nPeriods - i - 1) * dt, 0.001);
    const isLast = i === nPeriods - 1;

    // Euler yield
    euler += euler * eulerAPY * dt;

    // Step-down autocall barrier
    const currentAcBarrier = Math.max(acBarrier - acStepDown * i, kiBarrier + 0.10);

    let coupon = 0;

    // 1) Autocall check (with step-down)
    if (perf >= currentAcBarrier) {
      coupon = couponRate * investorDep;
      couponsCount++;
      totalCoupons += coupon;
      // Pay memory coupons if any
      if (memoryCoupon && missedCoupons > 0) {
        totalCoupons += missedCoupons;
        coupon += missedCoupons;
        missedCoupons = 0;
      }
      euler -= coupon;
      const proceeds = shares * price;
      euler += proceeds;
      shares = 0;
      euler -= investorDep;

      result = {
        outcome: `AUTOCALL Q${i + 1} (barrier ${(currentAcBarrier * 100).toFixed(0)}%)`,
        periodCount: i + 1,
        durationMonths: (i + 1) * (12 / periodsPerYear),
        investorTotal: investorDep + totalCoupons,
        investorReturn: totalCoupons / investorDep,
        uwFinal: euler,
        uwReturn: (euler - uwDep) / uwDep,
        stockReturn: perf - 1,
        knockedIn: false,
        missedCoupons: 0,
      };
      break;
    }

    // 2) Knock-in
    if (perf <= kiBarrier && !knockedIn) {
      knockedIn = true;
    }

    // 3) Coupon (with memory)
    if (perf >= couponBarrier) {
      coupon = couponRate * investorDep;
      couponsCount++;
      totalCoupons += coupon;
      // Pay memory coupons
      if (memoryCoupon && missedCoupons > 0) {
        totalCoupons += missedCoupons;
        coupon += missedCoupons;
        missedCoupons = 0;
      }
      euler -= coupon;
    } else {
      // Miss coupon — accumulate if memory
      if (memoryCoupon) {
        missedCoupons += couponRate * investorDep;
      }
    }

    // 4) Delta rebalance
    let newDelta;
    if (knockedIn && perf < 1.0) {
      const kiDepth = (initialPrice - price) / initialPrice;
      newDelta = Math.min(0.5 + kiDepth * 3, 1.0);
    } else if (isLast) {
      newDelta = knockedIn && perf < 1.0 ? 1.0 : 0.05;
    } else {
      newDelta = Math.abs(diPutDelta(price, strike, barrier, timeToMat, rfRate, sigma));
      newDelta = Math.max(0.05, Math.min(newDelta, 0.95));
    }

    const targetShares = newDelta * notionalShares;
    const diff = targetShares - shares;
    if (Math.abs(diff / notionalShares) > 0.03) {
      if (diff > 0) {
        euler -= diff * price;
      } else {
        euler += Math.abs(diff) * price;
      }
      shares = targetShares;
      delta = newDelta;
    }

    // 5) Maturity settlement
    if (isLast) {
      if (knockedIn && perf < 1.0) {
        const remaining = notionalShares - shares;
        if (remaining > 0.01) {
          euler -= remaining * price;
          shares = notionalShares;
        }
        const deliveryValue = notionalShares * price;
        result = {
          outcome: 'KNOCK-IN DELIVERY',
          periodCount: nPeriods,
          durationMonths: nPeriods * (12 / periodsPerYear),
          investorTotal: deliveryValue + totalCoupons,
          investorReturn: (deliveryValue + totalCoupons - investorDep) / investorDep,
          uwFinal: euler,
          uwReturn: (euler - uwDep) / uwDep,
          stockReturn: perf - 1,
          knockedIn: true,
          missedCoupons,
        };
      } else {
        const proceeds = shares * price;
        euler += proceeds;
        euler -= investorDep;
        shares = 0;
        result = {
          outcome: knockedIn ? 'MATURITY (KI recovered)' : 'MATURITY (no KI)',
          periodCount: nPeriods,
          durationMonths: nPeriods * (12 / periodsPerYear),
          investorTotal: investorDep + totalCoupons,
          investorReturn: totalCoupons / investorDep,
          uwFinal: euler,
          uwReturn: (euler - uwDep) / uwDep,
          stockReturn: perf - 1,
          knockedIn,
          missedCoupons,
        };
      }
    }
  }

  return { name, stratName, result, config: { sigma, notionalShares, initialPrice, totalCoupons, couponsCount, protocolFee, missedCoupons } };
}

// === STRATEGY DEFINITIONS ===

const STRATEGIES = {
  // V2 = current (broken) params
  V2_CURRENT: {
    label: 'V2 Current',
    acBarrier: 1.0,
    acStepDown: 0,
    kiBarrier: 0.70,
    couponBarrier: 0.80,
    memoryCoupon: false,
    uwDepMultiplier: 1, // 1x = $2k/$3k based on vol
    couponFn: (vol) => {
      if (vol >= 0.50) return 0.05;
      if (vol >= 0.35) return 0.04;
      if (vol >= 0.25) return 0.03;
      return 0.02;
    },
  },

  // V3A = GS-aligned conservative (best for DAO treasuries / risk-averse)
  V3_CONSERVATIVE: {
    label: 'V3 Conservative (GS-aligned)',
    acBarrier: 1.0,
    acStepDown: 0,
    kiBarrier: 0.50,        // GS uses 50%
    couponBarrier: 0.60,    // GS uses 50-60%, we use 60%
    memoryCoupon: true,
    uwDepMultiplier: 1.5,   // 50% more UW capital
    couponFn: (vol) => {
      // Lower coupons but much more protection (KI 50%)
      if (vol >= 0.50) return 0.04;   // 16% ann
      if (vol >= 0.35) return 0.032;  // 12.8% ann
      if (vol >= 0.25) return 0.025;  // 10% ann
      return 0.018;                    // 7.2% ann
    },
  },

  // V3B = Balanced (higher coupons, moderate protection, step-down)
  V3_BALANCED: {
    label: 'V3 Balanced (DeFi-optimized)',
    acBarrier: 1.0,
    acStepDown: 0.025,      // step-down 2.5%/quarter: 100% → 97.5% → 95% → 92.5%
    kiBarrier: 0.55,        // Between 50-60%
    couponBarrier: 0.65,    // More accessible coupons
    memoryCoupon: true,
    uwDepMultiplier: 1.25,
    couponFn: (vol) => {
      // Higher coupons — the DeFi premium
      if (vol >= 0.50) return 0.055;  // 22% ann
      if (vol >= 0.35) return 0.042;  // 16.8% ann
      if (vol >= 0.25) return 0.032;  // 12.8% ann
      return 0.022;                    // 8.8% ann
    },
  },

  // V3C = Aggressive yield (crypto-native degens, high coupon, tighter barriers)
  V3_AGGRESSIVE: {
    label: 'V3 Aggressive (High Yield)',
    acBarrier: 1.05,        // 105% autocall = harder to trigger
    acStepDown: 0.025,      // step-down: 105% → 102.5% → 100% → 97.5%
    kiBarrier: 0.60,        // 60% = less protection than conservative
    couponBarrier: 0.70,    // 70%
    memoryCoupon: true,
    uwDepMultiplier: 1.5,
    couponFn: (vol) => {
      // Max coupons — riskier but higher yield
      if (vol >= 0.50) return 0.065;  // 26% ann
      if (vol >= 0.35) return 0.050;  // 20% ann
      if (vol >= 0.25) return 0.038;  // 15.2% ann
      return 0.025;                    // 10% ann
    },
  },
};

// === STOCK DATA (same as v2) ===

const ALL_SCENARIOS = [
  // TIMELINE 1: Mar 2025 start (bull)
  { name: 'NVDAx', timeline: 'Mar25', initial: 108.36, prices: [176.67, 177.82, 186.50, 183.14], vol: 0.45 },
  { name: 'TSLAx', timeline: 'Mar25', initial: 259.16, prices: [317.66, 395.94, 449.72, 395.01], vol: 0.55 },
  { name: 'AAPLx', timeline: 'Mar25', initial: 221.17, prices: [204.55, 237.88, 271.86, 255.76], vol: 0.25 },
  { name: 'COINx', timeline: 'Mar25', initial: 172.23, prices: [350.49, 337.49, 226.14, 193.24], vol: 0.70 },
  { name: 'METAx', timeline: 'Mar25', initial: 575.06, prices: [736.99, 733.78, 660.09, 638.27], vol: 0.35 },
  { name: 'NFLXx', timeline: 'Mar25', initial: 93.25, prices: [133.91, 119.89, 93.76, 94.30], vol: 0.40 },
  { name: 'AMZNx', timeline: 'Mar25', initial: 190.26, prices: [219.39, 219.57, 230.82, 209.55], vol: 0.30 },
  { name: 'MSFTx', timeline: 'Mar25', initial: 372.54, prices: [494.54, 515.81, 482.52, 401.89], vol: 0.30 },
  { name: 'MRKx',  timeline: 'Mar25', initial: 87.26, prices: [77.72, 83.22, 105.26, 115.94], vol: 0.25 },
  { name: 'MCDx',  timeline: 'Mar25', initial: 305.32, prices: [287.19, 300.40, 303.93, 323.93], vol: 0.18 },
  { name: 'HOODx', timeline: 'Mar25', initial: 41.62, prices: [93.63, 143.18, 113.10, 76.12], vol: 0.75 },
  // TIMELINE 2: Jun 2025 start (peak)
  { name: 'COINx', timeline: 'Jun25', initial: 350.49, prices: [337.49, 226.14, 193.24], vol: 0.70 },
  { name: 'NFLXx', timeline: 'Jun25', initial: 133.91, prices: [119.89, 93.76, 94.30], vol: 0.40 },
  { name: 'METAx', timeline: 'Jun25', initial: 736.99, prices: [733.78, 660.09, 638.27], vol: 0.35 },
  { name: 'MSFTx', timeline: 'Jun25', initial: 494.54, prices: [515.81, 482.52, 401.89], vol: 0.30 },
  { name: 'AAPLx', timeline: 'Jun25', initial: 204.55, prices: [237.88, 271.86, 255.76], vol: 0.25 },
  { name: 'MRKx',  timeline: 'Jun25', initial: 77.72, prices: [83.22, 105.26, 115.94], vol: 0.25 },
  // TIMELINE 3: Sep 2025 start
  { name: 'HOODx', timeline: 'Sep25', initial: 143.18, prices: [113.10, 76.12], vol: 0.75 },
  { name: 'TSLAx', timeline: 'Sep25', initial: 395.94, prices: [449.72, 395.01], vol: 0.55 },
  { name: 'MSFTx', timeline: 'Sep25', initial: 515.81, prices: [482.52, 401.89], vol: 0.30 },
  { name: 'NVDAx', timeline: 'Sep25', initial: 177.82, prices: [186.50, 183.14], vol: 0.45 },
  { name: 'AAPLx', timeline: 'Sep25', initial: 237.88, prices: [271.86, 255.76], vol: 0.25 },
  { name: 'MCDx',  timeline: 'Sep25', initial: 300.40, prices: [303.93, 323.93], vol: 0.18 },
  // TIMELINE 4: Dec 2025 start (3mo)
  { name: 'HOODx', timeline: 'Dec25', initial: 113.10, prices: [76.12], vol: 0.75 },
  { name: 'COINx', timeline: 'Dec25', initial: 226.14, prices: [193.24], vol: 0.70 },
  { name: 'TSLAx', timeline: 'Dec25', initial: 449.72, prices: [395.01], vol: 0.55 },
  { name: 'MSFTx', timeline: 'Dec25', initial: 482.52, prices: [401.89], vol: 0.30 },
  { name: 'METAx', timeline: 'Dec25', initial: 660.09, prices: [638.27], vol: 0.35 },
  { name: 'NVDAx', timeline: 'Dec25', initial: 186.50, prices: [183.14], vol: 0.45 },
  { name: 'AAPLx', timeline: 'Dec25', initial: 271.86, prices: [255.76], vol: 0.25 },
  { name: 'AMZNx', timeline: 'Dec25', initial: 230.82, prices: [209.55], vol: 0.30 },
  { name: 'NFLXx', timeline: 'Dec25', initial: 93.76, prices: [94.30], vol: 0.40 },
  { name: 'MRKx',  timeline: 'Dec25', initial: 105.26, prices: [115.94], vol: 0.25 },
  { name: 'MCDx',  timeline: 'Dec25', initial: 303.93, prices: [323.93], vol: 0.18 },
];

// === RUN ALL STRATEGIES ON ALL SCENARIOS ===

console.log('█'.repeat(110));
console.log('█  xYIELD NOTES v3 — STRATEGY OPTIMIZATION');
console.log('█  4 strategies × 34 scenarios = 136 simulations');
console.log('█'.repeat(110));

const allStratResults = {};

for (const [stratKey, strat] of Object.entries(STRATEGIES)) {
  const results = [];

  for (const scenario of ALL_SCENARIOS) {
    const baseUwDep = scenario.vol >= 0.50 ? 3000 : 2000;
    const uwDep = Math.round(baseUwDep * strat.uwDepMultiplier);
    const couponRate = strat.couponFn(scenario.vol);

    const sim = simulateV3({
      name: `${scenario.name} (${scenario.timeline})`,
      stratName: strat.label,
      initialPrice: scenario.initial,
      obsPrices: scenario.prices,
      acBarrier: strat.acBarrier,
      acStepDown: strat.acStepDown,
      kiBarrier: strat.kiBarrier,
      couponBarrier: strat.couponBarrier,
      couponRate,
      memoryCoupon: strat.memoryCoupon,
      investorDep: 10000,
      uwDep,
      eulerAPY: 0.05,
      sigma: scenario.vol,
      rfRate: 0.05,
      periodsPerYear: 4,
    });

    results.push(sim);
  }

  allStratResults[stratKey] = results;
}

// === COMPARISON TABLE ===

function computeStats(results) {
  const invRets = results.map(r => r.result.investorReturn);
  const uwRets = results.map(r => r.result.uwReturn);
  const autocalls = results.filter(r => r.result.outcome.includes('AUTOCALL'));
  const knockins = results.filter(r => r.result.outcome.includes('KNOCK-IN'));
  const maturities = results.filter(r => r.result.outcome.includes('MATURITY'));

  const invAvg = invRets.reduce((a, b) => a + b, 0) / invRets.length;
  const uwAvg = uwRets.reduce((a, b) => a + b, 0) / uwRets.length;

  // Annualized investor return (weighted by duration)
  let totalWeightedAnn = 0;
  for (const r of results) {
    const months = r.result.durationMonths;
    const annualized = r.result.investorReturn * (12 / months);
    totalWeightedAnn += annualized;
  }
  const invAnnAvg = totalWeightedAnn / results.length;

  // Sharpe-like ratio for investor (return / volatility of returns)
  const invStd = Math.sqrt(invRets.reduce((a, r) => a + (r - invAvg) ** 2, 0) / invRets.length);
  const invSharpe = invStd > 0 ? invAvg / invStd : 0;

  // UW Sharpe
  const uwStd = Math.sqrt(uwRets.reduce((a, r) => a + (r - uwAvg) ** 2, 0) / uwRets.length);
  const uwSharpe = uwStd > 0 ? uwAvg / uwStd : 0;

  return {
    n: results.length,
    autocallRate: autocalls.length / results.length,
    kiRate: knockins.length / results.length,
    matRate: maturities.length / results.length,
    invAvg,
    invAnnAvg,
    invMin: Math.min(...invRets),
    invMax: Math.max(...invRets),
    invWinRate: invRets.filter(r => r >= 0).length / invRets.length,
    invSharpe,
    uwAvg,
    uwMin: Math.min(...uwRets),
    uwMax: Math.max(...uwRets),
    uwWinRate: uwRets.filter(r => r >= 0).length / uwRets.length,
    uwSharpe,
  };
}

console.log('\n\n' + '█'.repeat(110));
console.log('█  HEAD-TO-HEAD COMPARISON — ALL 4 STRATEGIES');
console.log('█'.repeat(110));

const statsMap = {};
for (const [key, results] of Object.entries(allStratResults)) {
  statsMap[key] = computeStats(results);
}

// Print comparison
const metrics = [
  ['Autocall rate', (s) => `${(s.autocallRate * 100).toFixed(0)}%`],
  ['KI rate', (s) => `${(s.kiRate * 100).toFixed(0)}%`],
  ['Maturity rate', (s) => `${(s.matRate * 100).toFixed(0)}%`],
  ['', () => ''],
  ['INV avg return', (s) => `${s.invAvg >= 0 ? '+' : ''}${(s.invAvg * 100).toFixed(1)}%`],
  ['INV annualized', (s) => `${s.invAnnAvg >= 0 ? '+' : ''}${(s.invAnnAvg * 100).toFixed(1)}%`],
  ['INV win rate', (s) => `${(s.invWinRate * 100).toFixed(0)}%`],
  ['INV max loss', (s) => `${(s.invMin * 100).toFixed(1)}%`],
  ['INV best', (s) => `+${(s.invMax * 100).toFixed(1)}%`],
  ['INV Sharpe', (s) => s.invSharpe.toFixed(2)],
  ['', () => ''],
  ['UW avg return', (s) => `${s.uwAvg >= 0 ? '+' : ''}${(s.uwAvg * 100).toFixed(1)}%`],
  ['UW win rate', (s) => `${(s.uwWinRate * 100).toFixed(0)}%`],
  ['UW max loss', (s) => `${(s.uwMin * 100).toFixed(1)}%`],
  ['UW best', (s) => `+${(s.uwMax * 100).toFixed(1)}%`],
  ['UW Sharpe', (s) => s.uwSharpe.toFixed(2)],
];

const stratKeys = Object.keys(STRATEGIES);
const colWidth = 24;
const labelWidth = 18;

// Header
console.log('\n' + ' '.repeat(labelWidth) +
  stratKeys.map(k => STRATEGIES[k].label.substring(0, colWidth - 2).padStart(colWidth)).join(''));
console.log(' '.repeat(labelWidth) +
  stratKeys.map(k => {
    const s = STRATEGIES[k];
    return `KI ${(s.kiBarrier * 100).toFixed(0)}% CB ${(s.couponBarrier * 100).toFixed(0)}%`.padStart(colWidth);
  }).join(''));
console.log('─'.repeat(labelWidth + colWidth * stratKeys.length));

for (const [label, fn] of metrics) {
  if (label === '') {
    console.log('');
    continue;
  }
  const row = label.padEnd(labelWidth) +
    stratKeys.map(k => fn(statsMap[k]).padStart(colWidth)).join('');
  console.log(row);
}

console.log('─'.repeat(labelWidth + colWidth * stratKeys.length));

// === DETAILED PER-SCENARIO COMPARISON ===

console.log('\n\n' + '█'.repeat(130));
console.log('█  PER-SCENARIO COMPARISON (Investor returns)');
console.log('█'.repeat(130));

console.log('\n' + 'Scenario'.padEnd(28) + 'Stock'.padStart(8) +
  stratKeys.map(k => STRATEGIES[k].label.substring(0, 20).padStart(22)).join('') +
  '  Winner'.padStart(10));
console.log('─'.repeat(130));

for (let i = 0; i < ALL_SCENARIOS.length; i++) {
  const scenario = ALL_SCENARIOS[i];
  const stockRet = allStratResults[stratKeys[0]][i].result.stockReturn;

  let bestReturn = -Infinity;
  let bestKey = '';

  const vals = stratKeys.map(k => {
    const r = allStratResults[k][i].result;
    const ret = r.investorReturn;
    if (ret > bestReturn) {
      bestReturn = ret;
      bestKey = k;
    }
    const outcomeShort = r.outcome.includes('AUTOCALL') ? 'AC' :
      r.outcome.includes('KNOCK-IN') ? 'KI' : 'MAT';
    return `${ret >= 0 ? '+' : ''}${(ret * 100).toFixed(1)}% ${outcomeShort}`.padStart(22);
  }).join('');

  const winner = STRATEGIES[bestKey].label.substring(0, 8);
  console.log(
    `${scenario.name} (${scenario.timeline})`.padEnd(28) +
    `${(stockRet * 100).toFixed(1)}%`.padStart(8) +
    vals +
    `  ${winner}`.padStart(10)
  );
}

// === DETAILED PER-SCENARIO COMPARISON (UW returns) ===

console.log('\n\n' + '█'.repeat(130));
console.log('█  PER-SCENARIO COMPARISON (Underwriter returns)');
console.log('█'.repeat(130));

console.log('\n' + 'Scenario'.padEnd(28) + 'Stock'.padStart(8) +
  stratKeys.map(k => STRATEGIES[k].label.substring(0, 20).padStart(22)).join('') +
  '  Winner'.padStart(10));
console.log('─'.repeat(130));

for (let i = 0; i < ALL_SCENARIOS.length; i++) {
  const scenario = ALL_SCENARIOS[i];
  const stockRet = allStratResults[stratKeys[0]][i].result.stockReturn;

  let bestReturn = -Infinity;
  let bestKey = '';

  const vals = stratKeys.map(k => {
    const r = allStratResults[k][i].result;
    const ret = r.uwReturn;
    if (ret > bestReturn) {
      bestReturn = ret;
      bestKey = k;
    }
    const outcomeShort = r.outcome.includes('AUTOCALL') ? 'AC' :
      r.outcome.includes('KNOCK-IN') ? 'KI' : 'MAT';
    return `${ret >= 0 ? '+' : ''}${(ret * 100).toFixed(1)}% ${outcomeShort}`.padStart(22);
  }).join('');

  const winner = STRATEGIES[bestKey].label.substring(0, 8);
  console.log(
    `${scenario.name} (${scenario.timeline})`.padEnd(28) +
    `${(stockRet * 100).toFixed(1)}%`.padStart(8) +
    vals +
    `  ${winner}`.padStart(10)
  );
}

// === REGIME ANALYSIS ===

console.log('\n\n' + '█'.repeat(110));
console.log('█  REGIME ANALYSIS — Performance by market regime');
console.log('█'.repeat(110));

const regimes = {
  'Bull (Mar25)': (s) => s.timeline === 'Mar25',
  'Peak (Jun25)': (s) => s.timeline === 'Jun25',
  'Rotation (Sep25)': (s) => s.timeline === 'Sep25',
  'Bear (Dec25)': (s) => s.timeline === 'Dec25',
};

for (const [regimeName, filterFn] of Object.entries(regimes)) {
  console.log(`\n  ${regimeName}:`);
  console.log('  ' + ' '.repeat(labelWidth - 2) +
    stratKeys.map(k => STRATEGIES[k].label.substring(0, colWidth - 2).padStart(colWidth)).join(''));

  for (const [key, results] of Object.entries(allStratResults)) {
    // skip, we'll print per strategy
  }

  // Investor avg
  const invRow = '  INV avg'.padEnd(labelWidth) +
    stratKeys.map(k => {
      const filtered = allStratResults[k].filter((_, i) => filterFn(ALL_SCENARIOS[i]));
      const avg = filtered.reduce((a, r) => a + r.result.investorReturn, 0) / filtered.length;
      return `${avg >= 0 ? '+' : ''}${(avg * 100).toFixed(1)}%`.padStart(colWidth);
    }).join('');
  console.log(invRow);

  // UW avg
  const uwRow = '  UW avg'.padEnd(labelWidth) +
    stratKeys.map(k => {
      const filtered = allStratResults[k].filter((_, i) => filterFn(ALL_SCENARIOS[i]));
      const avg = filtered.reduce((a, r) => a + r.result.uwReturn, 0) / filtered.length;
      return `${avg >= 0 ? '+' : ''}${(avg * 100).toFixed(1)}%`.padStart(colWidth);
    }).join('');
  console.log(uwRow);

  // AC rate
  const acRow = '  AC rate'.padEnd(labelWidth) +
    stratKeys.map(k => {
      const filtered = allStratResults[k].filter((_, i) => filterFn(ALL_SCENARIOS[i]));
      const rate = filtered.filter(r => r.result.outcome.includes('AUTOCALL')).length / filtered.length;
      return `${(rate * 100).toFixed(0)}%`.padStart(colWidth);
    }).join('');
  console.log(acRow);
}

// === TIER ANALYSIS — By stock volatility tier ===

console.log('\n\n' + '█'.repeat(110));
console.log('█  VOL TIER ANALYSIS — Which strategy for which stocks?');
console.log('█'.repeat(110));

const volTiers = {
  'Low vol (<30%: AAPL, AMZN, MSFT, MRK, MCD)': (s) => s.vol < 0.30,
  'Mid vol (30-45%: META, NFLX, NVDA)': (s) => s.vol >= 0.30 && s.vol <= 0.45,
  'High vol (>45%: TSLA, COIN, HOOD)': (s) => s.vol > 0.45,
};

for (const [tierName, filterFn] of Object.entries(volTiers)) {
  console.log(`\n  ${tierName}:`);

  const invRow = '  INV avg'.padEnd(labelWidth) +
    stratKeys.map(k => {
      const filtered = allStratResults[k].filter((_, i) => filterFn(ALL_SCENARIOS[i]));
      if (filtered.length === 0) return 'N/A'.padStart(colWidth);
      const avg = filtered.reduce((a, r) => a + r.result.investorReturn, 0) / filtered.length;
      return `${avg >= 0 ? '+' : ''}${(avg * 100).toFixed(1)}%`.padStart(colWidth);
    }).join('');
  console.log(invRow);

  const uwRow = '  UW avg'.padEnd(labelWidth) +
    stratKeys.map(k => {
      const filtered = allStratResults[k].filter((_, i) => filterFn(ALL_SCENARIOS[i]));
      if (filtered.length === 0) return 'N/A'.padStart(colWidth);
      const avg = filtered.reduce((a, r) => a + r.result.uwReturn, 0) / filtered.length;
      return `${avg >= 0 ? '+' : ''}${(avg * 100).toFixed(1)}%`.padStart(colWidth);
    }).join('');
  console.log(uwRow);

  const kiRow = '  KI rate'.padEnd(labelWidth) +
    stratKeys.map(k => {
      const filtered = allStratResults[k].filter((_, i) => filterFn(ALL_SCENARIOS[i]));
      if (filtered.length === 0) return 'N/A'.padStart(colWidth);
      const rate = filtered.filter(r => r.result.outcome.includes('KNOCK-IN')).length / filtered.length;
      return `${(rate * 100).toFixed(0)}%`.padStart(colWidth);
    }).join('');
  console.log(kiRow);

  const winRow = '  INV wins'.padEnd(labelWidth) +
    stratKeys.map(k => {
      const filtered = allStratResults[k].filter((_, i) => filterFn(ALL_SCENARIOS[i]));
      if (filtered.length === 0) return 'N/A'.padStart(colWidth);
      const rate = filtered.filter(r => r.result.investorReturn >= 0).length / filtered.length;
      return `${(rate * 100).toFixed(0)}%`.padStart(colWidth);
    }).join('');
  console.log(winRow);
}

// === FINAL RECOMMENDATION ===

console.log('\n\n' + '█'.repeat(110));
console.log('█  FINAL RECOMMENDATION');
console.log('█'.repeat(110));

// Find best strategy by combined score
const scores = {};
for (const k of stratKeys) {
  const s = statsMap[k];
  // Weighted score: investor-centric for DeFi (investors are the users)
  // 30% inv avg return, 20% inv win rate, 15% inv sharpe, 15% inv max loss (inverted),
  // 10% uw avg return, 10% uw win rate
  scores[k] = (
    s.invAvg * 30 +
    s.invWinRate * 20 +
    s.invSharpe * 15 +
    (1 + s.invMin) * 15 +  // less negative = better
    s.uwAvg * 10 +
    s.uwWinRate * 10
  );
}

const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

console.log('\n  Combined Score (investor-weighted):');
for (const [k, score] of sorted) {
  const s = statsMap[k];
  console.log(`    ${STRATEGIES[k].label.padEnd(35)} Score: ${score.toFixed(2)}  |  INV: ${(s.invAvg * 100).toFixed(1)}% avg, ${(s.invWinRate * 100).toFixed(0)}% win  |  UW: ${(s.uwAvg * 100).toFixed(1)}% avg, ${(s.uwWinRate * 100).toFixed(0)}% win`);
}

const bestKey = sorted[0][0];
const best = STRATEGIES[bestKey];
console.log(`\n  ★ WINNER: ${best.label}`);
console.log(`    KI: ${(best.kiBarrier * 100).toFixed(0)}% | Coupon barrier: ${(best.couponBarrier * 100).toFixed(0)}% | AC: ${(best.acBarrier * 100).toFixed(0)}% | Step-down: ${best.acStepDown > 0 ? (best.acStepDown * 100).toFixed(1) + '%/q' : 'No'} | Memory: ${best.memoryCoupon ? 'Yes' : 'No'}`);

console.log('\n  RECOMMENDED PRODUCT LINEUP FOR DEFI:');
console.log('    ┌──────────────────────────────────────────────────────────────────────┐');
console.log('    │  "Protected Yield" (Conservative)                                    │');
console.log('    │   → Blue Chip basket (AAPL/MSFT/AMZN), KI 50%, 10% APY             │');
console.log('    │   → Target: DAO treasuries, risk-averse, "better than Aave"         │');
console.log('    │                                                                      │');
console.log('    │  "Balanced Yield" (DeFi-optimized)       ← DEFAULT PRODUCT           │');
console.log('    │   → US Tech basket (NVDA/AAPL/TSLA), KI 55%, step-down, 15% APY    │');
console.log('    │   → Target: crypto-native investors, main product                    │');
console.log('    │                                                                      │');
console.log('    │  "High Yield" (Aggressive)                                           │');
console.log('    │   → Single stock (TSLA, NVDA, COIN), KI 60%, 20-26% APY            │');
console.log('    │   → Target: yield seekers, degens, "I want max coupon"              │');
console.log('    └──────────────────────────────────────────────────────────────────────┘');

console.log('\n' + '█'.repeat(110));
console.log('█  SIMULATION v3 COMPLETE — 136 simulations across 4 strategies');
console.log('█'.repeat(110) + '\n');
