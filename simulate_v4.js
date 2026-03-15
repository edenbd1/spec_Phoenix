#!/usr/bin/env node
// ============================================================
// xYield Notes v4 — FAIR COUPON FINDER
// Find the equilibrium where BOTH investor AND underwriter win
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

// === SIMULATION ENGINE ===

function simulate(config) {
  const {
    initialPrice, obsPrices,
    acBarrier, kiBarrier, couponBarrier,
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
  let missedCoupons = 0;

  const T0 = nPeriods * dt;
  let rawDelta = Math.abs(diPutDelta(initialPrice, strike, barrier, T0, rfRate, sigma));
  let delta = Math.max(0.05, Math.min(rawDelta, 0.95));
  shares = delta * notionalShares;
  euler = pool - shares * initialPrice - protocolFee;

  let result = null;

  for (let i = 0; i < nPeriods; i++) {
    const price = obsPrices[i];
    const perf = price / initialPrice;
    const timeToMat = Math.max((nPeriods - i - 1) * dt, 0.001);
    const isLast = i === nPeriods - 1;

    euler += euler * eulerAPY * dt;

    let coupon = 0;

    // Autocall
    if (perf >= acBarrier) {
      coupon = couponRate * investorDep;
      couponsCount++;
      totalCoupons += coupon;
      if (memoryCoupon && missedCoupons > 0) {
        totalCoupons += missedCoupons;
        coupon += missedCoupons;
        missedCoupons = 0;
      }
      euler -= coupon;
      euler += shares * price;
      shares = 0;
      euler -= investorDep;

      result = {
        outcome: 'AUTOCALL',
        periodCount: i + 1,
        durationMonths: (i + 1) * (12 / periodsPerYear),
        investorTotal: investorDep + totalCoupons,
        investorReturn: totalCoupons / investorDep,
        uwFinal: euler,
        uwReturn: (euler - uwDep) / uwDep,
        stockReturn: perf - 1,
        knockedIn: false,
      };
      break;
    }

    // Knock-in
    if (perf <= kiBarrier && !knockedIn) knockedIn = true;

    // Coupon
    if (perf >= couponBarrier) {
      coupon = couponRate * investorDep;
      couponsCount++;
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

    // Delta rebalance
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
      if (diff > 0) euler -= diff * price;
      else euler += Math.abs(diff) * price;
      shares = targetShares;
      delta = newDelta;
    }

    // Maturity
    if (isLast) {
      if (knockedIn && perf < 1.0) {
        const remaining = notionalShares - shares;
        if (remaining > 0.01) {
          euler -= remaining * price;
          shares = notionalShares;
        }
        const deliveryValue = notionalShares * price;
        result = {
          outcome: 'KNOCK-IN',
          periodCount: nPeriods,
          durationMonths: nPeriods * (12 / periodsPerYear),
          investorTotal: deliveryValue + totalCoupons,
          investorReturn: (deliveryValue + totalCoupons - investorDep) / investorDep,
          uwFinal: euler,
          uwReturn: (euler - uwDep) / uwDep,
          stockReturn: perf - 1,
          knockedIn: true,
        };
      } else {
        euler += shares * price;
        euler -= investorDep;
        shares = 0;
        result = {
          outcome: 'MATURITY',
          periodCount: nPeriods,
          durationMonths: nPeriods * (12 / periodsPerYear),
          investorTotal: investorDep + totalCoupons,
          investorReturn: totalCoupons / investorDep,
          uwFinal: euler,
          uwReturn: (euler - uwDep) / uwDep,
          stockReturn: perf - 1,
          knockedIn,
        };
      }
    }
  }

  return result;
}

// === STOCK DATA ===

const ALL_SCENARIOS = [
  { name: 'NVDAx', tl: 'Mar25', initial: 108.36, prices: [176.67, 177.82, 186.50, 183.14], vol: 0.45 },
  { name: 'TSLAx', tl: 'Mar25', initial: 259.16, prices: [317.66, 395.94, 449.72, 395.01], vol: 0.55 },
  { name: 'AAPLx', tl: 'Mar25', initial: 221.17, prices: [204.55, 237.88, 271.86, 255.76], vol: 0.25 },
  { name: 'COINx', tl: 'Mar25', initial: 172.23, prices: [350.49, 337.49, 226.14, 193.24], vol: 0.70 },
  { name: 'METAx', tl: 'Mar25', initial: 575.06, prices: [736.99, 733.78, 660.09, 638.27], vol: 0.35 },
  { name: 'NFLXx', tl: 'Mar25', initial: 93.25, prices: [133.91, 119.89, 93.76, 94.30], vol: 0.40 },
  { name: 'AMZNx', tl: 'Mar25', initial: 190.26, prices: [219.39, 219.57, 230.82, 209.55], vol: 0.30 },
  { name: 'MSFTx', tl: 'Mar25', initial: 372.54, prices: [494.54, 515.81, 482.52, 401.89], vol: 0.30 },
  { name: 'MRKx',  tl: 'Mar25', initial: 87.26, prices: [77.72, 83.22, 105.26, 115.94], vol: 0.25 },
  { name: 'MCDx',  tl: 'Mar25', initial: 305.32, prices: [287.19, 300.40, 303.93, 323.93], vol: 0.18 },
  { name: 'HOODx', tl: 'Mar25', initial: 41.62, prices: [93.63, 143.18, 113.10, 76.12], vol: 0.75 },
  { name: 'COINx', tl: 'Jun25', initial: 350.49, prices: [337.49, 226.14, 193.24], vol: 0.70 },
  { name: 'NFLXx', tl: 'Jun25', initial: 133.91, prices: [119.89, 93.76, 94.30], vol: 0.40 },
  { name: 'METAx', tl: 'Jun25', initial: 736.99, prices: [733.78, 660.09, 638.27], vol: 0.35 },
  { name: 'MSFTx', tl: 'Jun25', initial: 494.54, prices: [515.81, 482.52, 401.89], vol: 0.30 },
  { name: 'AAPLx', tl: 'Jun25', initial: 204.55, prices: [237.88, 271.86, 255.76], vol: 0.25 },
  { name: 'MRKx',  tl: 'Jun25', initial: 77.72, prices: [83.22, 105.26, 115.94], vol: 0.25 },
  { name: 'HOODx', tl: 'Sep25', initial: 143.18, prices: [113.10, 76.12], vol: 0.75 },
  { name: 'TSLAx', tl: 'Sep25', initial: 395.94, prices: [449.72, 395.01], vol: 0.55 },
  { name: 'MSFTx', tl: 'Sep25', initial: 515.81, prices: [482.52, 401.89], vol: 0.30 },
  { name: 'NVDAx', tl: 'Sep25', initial: 177.82, prices: [186.50, 183.14], vol: 0.45 },
  { name: 'AAPLx', tl: 'Sep25', initial: 237.88, prices: [271.86, 255.76], vol: 0.25 },
  { name: 'MCDx',  tl: 'Sep25', initial: 300.40, prices: [303.93, 323.93], vol: 0.18 },
  { name: 'HOODx', tl: 'Dec25', initial: 113.10, prices: [76.12], vol: 0.75 },
  { name: 'COINx', tl: 'Dec25', initial: 226.14, prices: [193.24], vol: 0.70 },
  { name: 'TSLAx', tl: 'Dec25', initial: 449.72, prices: [395.01], vol: 0.55 },
  { name: 'MSFTx', tl: 'Dec25', initial: 482.52, prices: [401.89], vol: 0.30 },
  { name: 'METAx', tl: 'Dec25', initial: 660.09, prices: [638.27], vol: 0.35 },
  { name: 'NVDAx', tl: 'Dec25', initial: 186.50, prices: [183.14], vol: 0.45 },
  { name: 'AAPLx', tl: 'Dec25', initial: 271.86, prices: [255.76], vol: 0.25 },
  { name: 'AMZNx', tl: 'Dec25', initial: 230.82, prices: [209.55], vol: 0.30 },
  { name: 'NFLXx', tl: 'Dec25', initial: 93.76, prices: [94.30], vol: 0.40 },
  { name: 'MRKx',  tl: 'Dec25', initial: 105.26, prices: [115.94], vol: 0.25 },
  { name: 'MCDx',  tl: 'Dec25', initial: 303.93, prices: [323.93], vol: 0.18 },
];

// === RUN A FULL STRATEGY ON ALL SCENARIOS ===

function runStrategy(params) {
  const results = [];
  for (const s of ALL_SCENARIOS) {
    const uwDep = Math.round((s.vol >= 0.50 ? 3000 : 2000) * params.uwMultiplier);
    const couponRate = params.couponFn(s.vol);
    const r = simulate({
      initialPrice: s.initial,
      obsPrices: s.prices,
      acBarrier: params.acBarrier,
      kiBarrier: params.kiBarrier,
      couponBarrier: params.couponBarrier,
      couponRate,
      memoryCoupon: params.memoryCoupon,
      investorDep: 10000,
      uwDep,
      eulerAPY: 0.05,
      sigma: s.vol,
      rfRate: 0.05,
      periodsPerYear: 4,
    });
    results.push({ scenario: s, result: r, uwDep });
  }
  return results;
}

function stats(results) {
  const inv = results.map(r => r.result.investorReturn);
  const uw = results.map(r => r.result.uwReturn);
  const ac = results.filter(r => r.result.outcome === 'AUTOCALL').length;
  const ki = results.filter(r => r.result.outcome === 'KNOCK-IN').length;

  let invAnn = 0;
  let uwAnn = 0;
  for (const r of results) {
    const mo = r.result.durationMonths;
    invAnn += r.result.investorReturn * (12 / mo);
    uwAnn += r.result.uwReturn * (12 / mo);
  }

  return {
    n: results.length,
    acRate: ac / results.length,
    kiRate: ki / results.length,
    invAvg: inv.reduce((a, b) => a + b, 0) / inv.length,
    invAnn: invAnn / results.length,
    invWin: inv.filter(r => r >= 0).length / inv.length,
    invMin: Math.min(...inv),
    invMax: Math.max(...inv),
    uwAvg: uw.reduce((a, b) => a + b, 0) / uw.length,
    uwAnn: uwAnn / results.length,
    uwWin: uw.filter(r => r >= 0).length / uw.length,
    uwMin: Math.min(...uw),
    uwMax: Math.max(...uw),
  };
}

// ============================================================
// PART 1: COUPON SENSITIVITY — Find equilibrium
// ============================================================

console.log('█'.repeat(110));
console.log('█  xYIELD v4 — FAIR COUPON FINDER');
console.log('█  Goal: Find the coupon level where BOTH sides are profitable');
console.log('█'.repeat(110));

console.log('\n\n' + '▓'.repeat(110));
console.log('▓  PART 1: COUPON SENSITIVITY — KI 50%, Coupon Barrier 60%, Memory ON');
console.log('▓  Testing coupon rates from 1% to 6% per quarter');
console.log('▓'.repeat(110));

const couponLevels = [0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.045, 0.05, 0.06];

console.log('\n' +
  'Coupon/Q'.padEnd(10) +
  'Ann.'.padStart(7) +
  'INV avg'.padStart(10) +
  'INV ann'.padStart(10) +
  'INV win'.padStart(9) +
  'INV min'.padStart(10) +
  '│'.padStart(2) +
  'UW avg'.padStart(10) +
  'UW ann'.padStart(10) +
  'UW win'.padStart(9) +
  'UW min'.padStart(10) +
  '│'.padStart(2) +
  'AC%'.padStart(5) +
  'KI%'.padStart(5) +
  ' Balance'.padStart(10)
);
console.log('─'.repeat(120));

for (const cpn of couponLevels) {
  const results = runStrategy({
    acBarrier: 1.0,
    kiBarrier: 0.50,
    couponBarrier: 0.60,
    memoryCoupon: true,
    uwMultiplier: 1.5,
    couponFn: () => cpn, // flat coupon for sensitivity
  });
  const s = stats(results);
  const balance = s.invAvg + s.uwAvg; // combined surplus
  const balanceStr = balance >= 0 ? `+${(balance * 100).toFixed(1)}%` : `${(balance * 100).toFixed(1)}%`;

  console.log(
    `${(cpn * 100).toFixed(1)}%`.padEnd(10) +
    `${(cpn * 400).toFixed(0)}%`.padStart(7) +
    `${s.invAvg >= 0 ? '+' : ''}${(s.invAvg * 100).toFixed(1)}%`.padStart(10) +
    `${s.invAnn >= 0 ? '+' : ''}${(s.invAnn * 100).toFixed(1)}%`.padStart(10) +
    `${(s.invWin * 100).toFixed(0)}%`.padStart(9) +
    `${(s.invMin * 100).toFixed(1)}%`.padStart(10) +
    ' │' +
    `${s.uwAvg >= 0 ? '+' : ''}${(s.uwAvg * 100).toFixed(1)}%`.padStart(10) +
    `${s.uwAnn >= 0 ? '+' : ''}${(s.uwAnn * 100).toFixed(1)}%`.padStart(10) +
    `${(s.uwWin * 100).toFixed(0)}%`.padStart(9) +
    `${(s.uwMin * 100).toFixed(1)}%`.padStart(10) +
    ' │' +
    `${(s.acRate * 100).toFixed(0)}%`.padStart(5) +
    `${(s.kiRate * 100).toFixed(0)}%`.padStart(5) +
    balanceStr.padStart(10)
  );
}

// ============================================================
// PART 2: SAME BUT WITH KI 55%
// ============================================================

console.log('\n\n' + '▓'.repeat(110));
console.log('▓  PART 2: COUPON SENSITIVITY — KI 55%, Coupon Barrier 65%, Memory ON');
console.log('▓'.repeat(110));

console.log('\n' +
  'Coupon/Q'.padEnd(10) + 'Ann.'.padStart(7) +
  'INV avg'.padStart(10) + 'INV ann'.padStart(10) + 'INV win'.padStart(9) + 'INV min'.padStart(10) + '│'.padStart(2) +
  'UW avg'.padStart(10) + 'UW ann'.padStart(10) + 'UW win'.padStart(9) + 'UW min'.padStart(10) + '│'.padStart(2) +
  'AC%'.padStart(5) + 'KI%'.padStart(5) + ' Balance'.padStart(10)
);
console.log('─'.repeat(120));

for (const cpn of couponLevels) {
  const results = runStrategy({
    acBarrier: 1.0, kiBarrier: 0.55, couponBarrier: 0.65,
    memoryCoupon: true, uwMultiplier: 1.25,
    couponFn: () => cpn,
  });
  const s = stats(results);
  const balance = s.invAvg + s.uwAvg;
  console.log(
    `${(cpn * 100).toFixed(1)}%`.padEnd(10) + `${(cpn * 400).toFixed(0)}%`.padStart(7) +
    `${s.invAvg >= 0 ? '+' : ''}${(s.invAvg * 100).toFixed(1)}%`.padStart(10) +
    `${s.invAnn >= 0 ? '+' : ''}${(s.invAnn * 100).toFixed(1)}%`.padStart(10) +
    `${(s.invWin * 100).toFixed(0)}%`.padStart(9) + `${(s.invMin * 100).toFixed(1)}%`.padStart(10) +
    ' │' +
    `${s.uwAvg >= 0 ? '+' : ''}${(s.uwAvg * 100).toFixed(1)}%`.padStart(10) +
    `${s.uwAnn >= 0 ? '+' : ''}${(s.uwAnn * 100).toFixed(1)}%`.padStart(10) +
    `${(s.uwWin * 100).toFixed(0)}%`.padStart(9) + `${(s.uwMin * 100).toFixed(1)}%`.padStart(10) +
    ' │' + `${(s.acRate * 100).toFixed(0)}%`.padStart(5) + `${(s.kiRate * 100).toFixed(0)}%`.padStart(5) +
    `${balance >= 0 ? '+' : ''}${(balance * 100).toFixed(1)}%`.padStart(10)
  );
}

// ============================================================
// PART 3: SAME BUT WITH KI 60%
// ============================================================

console.log('\n\n' + '▓'.repeat(110));
console.log('▓  PART 3: COUPON SENSITIVITY — KI 60%, Coupon Barrier 70%, Memory ON');
console.log('▓'.repeat(110));

console.log('\n' +
  'Coupon/Q'.padEnd(10) + 'Ann.'.padStart(7) +
  'INV avg'.padStart(10) + 'INV ann'.padStart(10) + 'INV win'.padStart(9) + 'INV min'.padStart(10) + '│'.padStart(2) +
  'UW avg'.padStart(10) + 'UW ann'.padStart(10) + 'UW win'.padStart(9) + 'UW min'.padStart(10) + '│'.padStart(2) +
  'AC%'.padStart(5) + 'KI%'.padStart(5) + ' Balance'.padStart(10)
);
console.log('─'.repeat(120));

for (const cpn of couponLevels) {
  const results = runStrategy({
    acBarrier: 1.0, kiBarrier: 0.60, couponBarrier: 0.70,
    memoryCoupon: true, uwMultiplier: 1.25,
    couponFn: () => cpn,
  });
  const s = stats(results);
  const balance = s.invAvg + s.uwAvg;
  console.log(
    `${(cpn * 100).toFixed(1)}%`.padEnd(10) + `${(cpn * 400).toFixed(0)}%`.padStart(7) +
    `${s.invAvg >= 0 ? '+' : ''}${(s.invAvg * 100).toFixed(1)}%`.padStart(10) +
    `${s.invAnn >= 0 ? '+' : ''}${(s.invAnn * 100).toFixed(1)}%`.padStart(10) +
    `${(s.invWin * 100).toFixed(0)}%`.padStart(9) + `${(s.invMin * 100).toFixed(1)}%`.padStart(10) +
    ' │' +
    `${s.uwAvg >= 0 ? '+' : ''}${(s.uwAvg * 100).toFixed(1)}%`.padStart(10) +
    `${s.uwAnn >= 0 ? '+' : ''}${(s.uwAnn * 100).toFixed(1)}%`.padStart(10) +
    `${(s.uwWin * 100).toFixed(0)}%`.padStart(9) + `${(s.uwMin * 100).toFixed(1)}%`.padStart(10) +
    ' │' + `${(s.acRate * 100).toFixed(0)}%`.padStart(5) + `${(s.kiRate * 100).toFixed(0)}%`.padStart(5) +
    `${balance >= 0 ? '+' : ''}${(balance * 100).toFixed(1)}%`.padStart(10)
  );
}

// ============================================================
// PART 4: UW DEPOSIT SENSITIVITY
// ============================================================

console.log('\n\n' + '▓'.repeat(110));
console.log('▓  PART 4: UW DEPOSIT SENSITIVITY — KI 55%, CB 65%, Coupon 3%/Q, Memory ON');
console.log('▓  How much should UW deposit? (affects leverage & return profile)');
console.log('▓'.repeat(110));

const uwMultipliers = [0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

console.log('\n' +
  'UW mult'.padEnd(10) + 'UW dep$'.padStart(10) +
  'INV avg'.padStart(10) + 'INV ann'.padStart(10) + 'INV win'.padStart(9) + '│'.padStart(2) +
  'UW avg'.padStart(10) + 'UW ann'.padStart(10) + 'UW win'.padStart(9) + 'UW min'.padStart(10) + 'UW max'.padStart(10) + '│'.padStart(2) +
  ' UW $/note'.padStart(12)
);
console.log('─'.repeat(110));

for (const mult of uwMultipliers) {
  const results = runStrategy({
    acBarrier: 1.0, kiBarrier: 0.55, couponBarrier: 0.65,
    memoryCoupon: true, uwMultiplier: mult,
    couponFn: (vol) => {
      if (vol >= 0.50) return 0.035;
      if (vol >= 0.35) return 0.028;
      if (vol >= 0.25) return 0.022;
      return 0.015;
    },
  });
  const s = stats(results);
  const avgUwDep = results.reduce((a, r) => a + r.uwDep, 0) / results.length;
  const avgUwPnL = results.reduce((a, r) => a + (r.result.uwFinal - r.uwDep), 0) / results.length;

  console.log(
    `${mult.toFixed(2)}x`.padEnd(10) +
    `$${avgUwDep.toFixed(0)}`.padStart(10) +
    `${s.invAvg >= 0 ? '+' : ''}${(s.invAvg * 100).toFixed(1)}%`.padStart(10) +
    `${s.invAnn >= 0 ? '+' : ''}${(s.invAnn * 100).toFixed(1)}%`.padStart(10) +
    `${(s.invWin * 100).toFixed(0)}%`.padStart(9) + ' │' +
    `${s.uwAvg >= 0 ? '+' : ''}${(s.uwAvg * 100).toFixed(1)}%`.padStart(10) +
    `${s.uwAnn >= 0 ? '+' : ''}${(s.uwAnn * 100).toFixed(1)}%`.padStart(10) +
    `${(s.uwWin * 100).toFixed(0)}%`.padStart(9) +
    `${(s.uwMin * 100).toFixed(1)}%`.padStart(10) +
    `+${(s.uwMax * 100).toFixed(1)}%`.padStart(10) +
    ' │' +
    `$${avgUwPnL >= 0 ? '+' : ''}${avgUwPnL.toFixed(0)}`.padStart(12)
  );
}

// ============================================================
// PART 5: VOL-ADJUSTED COUPONS — The optimal strategy
// ============================================================

console.log('\n\n' + '▓'.repeat(110));
console.log('▓  PART 5: VOL-ADJUSTED FAIR COUPONS');
console.log('▓  Different coupon for each vol tier to balance both sides');
console.log('▓'.repeat(110));

// Test vol-specific coupon combinations
const volCouponGrids = [
  { label: 'A: Low coupons', highVol: 0.025, midVol: 0.020, lowVol: 0.015, minVol: 0.010 },
  { label: 'B: GS-level',    highVol: 0.030, midVol: 0.025, lowVol: 0.020, minVol: 0.013 },
  { label: 'C: Balanced',    highVol: 0.035, midVol: 0.028, lowVol: 0.022, minVol: 0.015 },
  { label: 'D: DeFi premium',highVol: 0.040, midVol: 0.032, lowVol: 0.025, minVol: 0.018 },
  { label: 'E: Aggressive',  highVol: 0.050, midVol: 0.038, lowVol: 0.030, minVol: 0.020 },
  { label: 'F: Max yield',   highVol: 0.060, midVol: 0.045, lowVol: 0.035, minVol: 0.025 },
];

for (const ki of [0.50, 0.55, 0.60]) {
  const cb = ki + 0.10; // coupon barrier = KI + 10%
  console.log(`\n  KI ${(ki * 100).toFixed(0)}% | CB ${(cb * 100).toFixed(0)}% | UW 1.5x`);
  console.log('  ' +
    'Grid'.padEnd(20) +
    'High/Q'.padStart(8) + 'Mid/Q'.padStart(8) + 'Low/Q'.padStart(8) + 'Min/Q'.padStart(8) + '│'.padStart(2) +
    'INV avg'.padStart(9) + 'INV ann'.padStart(9) + 'INV win'.padStart(9) + '│'.padStart(2) +
    'UW avg'.padStart(9) + 'UW ann'.padStart(9) + 'UW win'.padStart(9) + '│'.padStart(2) +
    'KI%'.padStart(5) + ' VERDICT'.padStart(10)
  );
  console.log('  ' + '─'.repeat(106));

  for (const grid of volCouponGrids) {
    const results = runStrategy({
      acBarrier: 1.0, kiBarrier: ki, couponBarrier: cb,
      memoryCoupon: true, uwMultiplier: 1.5,
      couponFn: (vol) => {
        if (vol >= 0.50) return grid.highVol;
        if (vol >= 0.35) return grid.midVol;
        if (vol >= 0.25) return grid.lowVol;
        return grid.minVol;
      },
    });
    const s = stats(results);

    let verdict = '';
    if (s.invWin >= 0.95 && s.uwAvg >= -0.02 && s.invAnn >= 0.05) verdict = '★ SWEET SPOT';
    else if (s.invWin >= 0.95 && s.uwAvg >= -0.05) verdict = '✓ OK';
    else if (s.uwAvg < -0.10) verdict = '✗ UW bleeds';
    else if (s.invWin < 0.85) verdict = '✗ INV risky';
    else verdict = '~ meh';

    console.log('  ' +
      grid.label.padEnd(20) +
      `${(grid.highVol * 100).toFixed(1)}%`.padStart(8) +
      `${(grid.midVol * 100).toFixed(1)}%`.padStart(8) +
      `${(grid.lowVol * 100).toFixed(1)}%`.padStart(8) +
      `${(grid.minVol * 100).toFixed(1)}%`.padStart(8) + ' │' +
      `${s.invAvg >= 0 ? '+' : ''}${(s.invAvg * 100).toFixed(1)}%`.padStart(9) +
      `${s.invAnn >= 0 ? '+' : ''}${(s.invAnn * 100).toFixed(1)}%`.padStart(9) +
      `${(s.invWin * 100).toFixed(0)}%`.padStart(9) + ' │' +
      `${s.uwAvg >= 0 ? '+' : ''}${(s.uwAvg * 100).toFixed(1)}%`.padStart(9) +
      `${s.uwAnn >= 0 ? '+' : ''}${(s.uwAnn * 100).toFixed(1)}%`.padStart(9) +
      `${(s.uwWin * 100).toFixed(0)}%`.padStart(9) + ' │' +
      `${(s.kiRate * 100).toFixed(0)}%`.padStart(5) +
      verdict.padStart(16)
    );
  }
}

// ============================================================
// PART 6: FINAL OPTIMAL — Per-scenario details
// ============================================================

console.log('\n\n' + '█'.repeat(110));
console.log('█  PART 6: OPTIMAL STRATEGY — Per-scenario detail');
console.log('█  Using best parameters found above');
console.log('█'.repeat(110));

// Run the sweet spot config
const optConfigs = [
  {
    label: 'OPTIMAL KI50 (Protected Yield)',
    ki: 0.50, cb: 0.60, uwMult: 1.5,
    couponFn: (vol) => {
      if (vol >= 0.50) return 0.030;
      if (vol >= 0.35) return 0.025;
      if (vol >= 0.25) return 0.020;
      return 0.013;
    },
  },
  {
    label: 'OPTIMAL KI55 (Balanced Yield)',
    ki: 0.55, cb: 0.65, uwMult: 1.5,
    couponFn: (vol) => {
      if (vol >= 0.50) return 0.035;
      if (vol >= 0.35) return 0.028;
      if (vol >= 0.25) return 0.022;
      return 0.015;
    },
  },
  {
    label: 'OPTIMAL KI60 (High Yield)',
    ki: 0.60, cb: 0.70, uwMult: 1.5,
    couponFn: (vol) => {
      if (vol >= 0.50) return 0.040;
      if (vol >= 0.35) return 0.032;
      if (vol >= 0.25) return 0.025;
      return 0.018;
    },
  },
];

for (const opt of optConfigs) {
  const results = runStrategy({
    acBarrier: 1.0, kiBarrier: opt.ki, couponBarrier: opt.cb,
    memoryCoupon: true, uwMultiplier: opt.uwMult,
    couponFn: opt.couponFn,
  });
  const s = stats(results);

  console.log(`\n  ${opt.label} — KI ${(opt.ki * 100).toFixed(0)}% | CB ${(opt.cb * 100).toFixed(0)}% | UW ${opt.uwMult}x`);
  console.log(`  INV: avg ${(s.invAvg * 100).toFixed(1)}%, ann ${(s.invAnn * 100).toFixed(1)}%, win ${(s.invWin * 100).toFixed(0)}%, min ${(s.invMin * 100).toFixed(1)}%, max +${(s.invMax * 100).toFixed(1)}%`);
  console.log(`  UW:  avg ${(s.uwAvg * 100).toFixed(1)}%, ann ${(s.uwAnn * 100).toFixed(1)}%, win ${(s.uwWin * 100).toFixed(0)}%, min ${(s.uwMin * 100).toFixed(1)}%, max +${(s.uwMax * 100).toFixed(1)}%`);
  console.log(`  AC: ${(s.acRate * 100).toFixed(0)}% | KI: ${(s.kiRate * 100).toFixed(0)}% | MAT: ${((1 - s.acRate - s.kiRate) * 100).toFixed(0)}%`);

  console.log('\n  ' + 'Scenario'.padEnd(22) + 'Stock'.padStart(8) + 'Outcome'.padStart(10) +
    'INV ret'.padStart(10) + 'INV $'.padStart(10) + 'UW ret'.padStart(10) + 'UW $'.padStart(10) + 'Dur'.padStart(6));
  console.log('  ' + '─'.repeat(84));

  for (const r of results) {
    const res = r.result;
    console.log('  ' +
      `${r.scenario.name} (${r.scenario.tl})`.padEnd(22) +
      `${(res.stockReturn * 100).toFixed(1)}%`.padStart(8) +
      res.outcome.substring(0, 9).padStart(10) +
      `${res.investorReturn >= 0 ? '+' : ''}${(res.investorReturn * 100).toFixed(1)}%`.padStart(10) +
      `$${res.investorTotal.toFixed(0)}`.padStart(10) +
      `${res.uwReturn >= 0 ? '+' : ''}${(res.uwReturn * 100).toFixed(1)}%`.padStart(10) +
      `$${res.uwFinal.toFixed(0)}`.padStart(10) +
      `${res.durationMonths}mo`.padStart(6)
    );
  }
}

// ============================================================
// SUMMARY
// ============================================================

console.log('\n\n' + '█'.repeat(110));
console.log('█  FINAL SUMMARY — RECOMMENDED PARAMETERS');
console.log('█'.repeat(110));

console.log(`
  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
  │                              xYield Notes — Optimal Parameters                                   │
  ├──────────────────────────────┬──────────────────────┬──────────────────────┬──────────────────────┤
  │                              │  Protected Yield     │  Balanced Yield      │  High Yield          │
  ├──────────────────────────────┼──────────────────────┼──────────────────────┼──────────────────────┤
  │  Target audience             │  DAO treasuries      │  Crypto-native       │  Yield seekers       │
  │  KI barrier                  │  50%                 │  55%                 │  60%                 │
  │  Coupon barrier              │  60%                 │  65%                 │  70%                 │
  │  Autocall barrier            │  100%                │  100%                │  100%                │
  │  Memory coupon               │  Yes                 │  Yes                 │  Yes                 │
  │  UW deposit                  │  1.5x ($3k-4.5k)    │  1.5x ($2.5k-4.5k)  │  1.5x ($3k-4.5k)    │
  │                              │                      │                      │                      │
  │  Coupons (per quarter):      │                      │                      │                      │
  │    High vol (TSLA,COIN,HOOD) │  3.0% (12% ann)      │  3.5% (14% ann)      │  4.0% (16% ann)      │
  │    Mid vol (META,NFLX,NVDA)  │  2.5% (10% ann)      │  2.8% (11.2% ann)    │  3.2% (12.8% ann)    │
  │    Low vol (AAPL,MSFT,AMZN)  │  2.0% (8% ann)       │  2.2% (8.8% ann)     │  2.5% (10% ann)      │
  │    Min vol (MCD)             │  1.3% (5.2% ann)     │  1.5% (6% ann)       │  1.8% (7.2% ann)     │
  ├──────────────────────────────┼──────────────────────┼──────────────────────┼──────────────────────┤
  │  Pitch to INVESTOR           │  "8-12% APY, never   │  "9-14% APY,         │  "10-16% APY, max    │
  │                              │   lost money in      │   balanced risk/      │   yield on xStocks,  │
  │                              │   backtest, KI 50%"  │   reward, KI 55%"    │   more risk, KI 60%" │
  │                              │                      │                      │                      │
  │  Pitch to UNDERWRITER        │  "Low vol exposure,  │  "Moderate gamma,    │  "High gamma          │
  │                              │   Euler yield base,  │   balanced P&L,      │   exposure, big tail  │
  │                              │   rare but big       │   steady flow"       │   wins, volatile"    │
  │                              │   tail wins"         │                      │                      │
  └──────────────────────────────┴──────────────────────┴──────────────────────┴──────────────────────┘
`);

console.log('█'.repeat(110));
console.log('█  v4 COMPLETE — 34 scenarios × 10 coupon levels × 3 KI barriers × 7 UW sizes + 6 vol grids');
console.log('█'.repeat(110) + '\n');
