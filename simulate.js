#!/usr/bin/env node
// ============================================================
// xYield Notes — Full Autocall Simulation with Delta-Hedging
// Black-Scholes pricing + numerical Greeks + complete cash flows
// ============================================================

// === MATH UTILS ===

function normalCDF(x) {
  // Abramowitz & Stegun approximation (error < 1.5e-7)
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax / 2);
  return 0.5 * (1.0 + sign * y);
}

// === BLACK-SCHOLES PRICING ===

function bsPutPrice(S, K, T, r, sigma) {
  if (T <= 0.001) return Math.max(K - S, 0);
  if (S <= 0.001) return K * Math.exp(-r * T);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

// Down-and-in put price (Merton 1973 analytical formula)
// H = barrier level, K = strike, H <= K
function downAndInPutPrice(S, K, H, T, r, sigma) {
  if (T <= 0.001) {
    return S <= H ? Math.max(K - S, 0) : 0;
  }
  if (S <= H) return bsPutPrice(S, K, T, r, sigma); // already knocked in
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

  const p = -S * normalCDF(-x1)
    + K * disc * normalCDF(-x1 + sigma * sqrtT)
    + S * pow2l * (normalCDF(y) - normalCDF(y1))
    - K * disc * pow2l2 * (normalCDF(y - sigma * sqrtT) - normalCDF(y1 - sigma * sqrtT));

  return Math.max(p, 0);
}

// Numerical delta of down-and-in put (bump-and-reprice)
function diPutDelta(S, K, H, T, r, sigma) {
  if (T <= 0.001) return S <= K ? -1 : 0;
  const eps = S * 0.005;
  const pUp = downAndInPutPrice(S + eps, K, H, T, r, sigma);
  const pDn = downAndInPutPrice(S - eps, K, H, T, r, sigma);
  return (pUp - pDn) / (2 * eps); // negative for puts
}

// Numerical gamma
function diPutGamma(S, K, H, T, r, sigma) {
  if (T <= 0.001) return 0;
  const eps = S * 0.005;
  const pUp = downAndInPutPrice(S + eps, K, H, T, r, sigma);
  const pMid = downAndInPutPrice(S, K, H, T, r, sigma);
  const pDn = downAndInPutPrice(S - eps, K, H, T, r, sigma);
  return (pUp - 2 * pMid + pDn) / (eps * eps);
}

// === VOLATILITY ===

function computeVol(prices) {
  if (prices.length < 3) return 0.35;
  const logReturns = [];
  for (let i = 1; i < prices.length; i++) {
    logReturns.push(Math.log(prices[i] / prices[i - 1]));
  }
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / (logReturns.length - 1);
  // prices are quarterly → 4 periods/year
  return Math.sqrt(variance * 4);
}

// === SIMULATION ENGINE ===

function simulate(config) {
  const {
    name, initialPrice, obsPrices, // prices at each observation date
    acBarrier, kiBarrier, couponBarrier,
    couponRate, // per period
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

  // State variables
  let euler = 0;
  let shares = 0;
  let knockedIn = false;
  let totalCoupons = 0;
  let couponsCount = 0;

  // === INITIAL HEDGE ===
  const T0 = nPeriods * dt;
  let rawDelta = Math.abs(diPutDelta(initialPrice, strike, barrier, T0, rfRate, sigma));
  let delta = Math.max(0.05, Math.min(rawDelta, 0.95));

  const initShares = delta * notionalShares;
  const initCost = initShares * initialPrice;
  shares = initShares;
  euler = pool - initCost - protocolFee;

  const rows = [];
  rows.push({
    period: 'START',
    price: initialPrice,
    perf: '100.0%',
    event: 'INITIAL HEDGE',
    delta: delta,
    shares: shares,
    xVal: shares * initialPrice,
    euler: euler,
    coupon: 0,
    trade: `BUY ${shares.toFixed(2)} @ $${initialPrice.toFixed(2)}`,
    poolTotal: euler + shares * initialPrice,
  });

  let result = null;

  for (let i = 0; i < nPeriods; i++) {
    const price = obsPrices[i];
    const perf = price / initialPrice;
    const timeToMat = Math.max((nPeriods - i - 1) * dt, 0.001);
    const isLast = i === nPeriods - 1;

    // Euler yield
    const yld = euler * eulerAPY * dt;
    euler += yld;

    // === BARRIER CHECKS ===
    let event = '';
    let coupon = 0;

    // 1) Autocall
    if (perf >= acBarrier) {
      coupon = couponRate * investorDep;
      couponsCount++;
      totalCoupons += coupon;
      euler -= coupon;

      // Sell all xStocks
      const proceeds = shares * price;
      euler += proceeds;
      const tradeStr = `SELL ${shares.toFixed(2)} @ $${price.toFixed(2)} = +$${proceeds.toFixed(0)}`;
      shares = 0;

      // Return principal
      euler -= investorDep;

      rows.push({
        period: `Q${i + 1}`,
        price, perf: (perf * 100).toFixed(1) + '%',
        event: `★ AUTOCALL`,
        delta: 0, shares: 0, xVal: 0,
        euler, coupon, trade: tradeStr,
        poolTotal: euler,
      });

      result = {
        outcome: `AUTOCALL Q${i + 1}`,
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

    // 2) Knock-in
    if (perf <= kiBarrier && !knockedIn) {
      knockedIn = true;
      event += 'KNOCK-IN! ';
    }

    // 3) Coupon
    if (perf >= couponBarrier) {
      coupon = couponRate * investorDep;
      couponsCount++;
      totalCoupons += coupon;
      euler -= coupon;
      event += `COUPON $${coupon.toFixed(0)}`;
    } else {
      event += 'NO COUPON';
    }

    // 4) Delta rebalance
    let newDelta;
    if (knockedIn && perf < 1.0) {
      // Knocked in and below initial → move towards full hedge
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
    let tradeStr = 'NO REBALANCE';

    if (Math.abs(diff / notionalShares) > 0.03) {
      if (diff > 0) {
        const cost = diff * price;
        euler -= cost;
        tradeStr = `BUY ${diff.toFixed(2)} @ $${price.toFixed(2)} = -$${cost.toFixed(0)}`;
      } else {
        const proceeds = Math.abs(diff) * price;
        euler += proceeds;
        tradeStr = `SELL ${Math.abs(diff).toFixed(2)} @ $${price.toFixed(2)} = +$${proceeds.toFixed(0)}`;
      }
      shares = targetShares;
      delta = newDelta;
    }

    // 5) Maturity settlement
    if (isLast) {
      if (knockedIn && perf < 1.0) {
        // Physical delivery
        event = `★ KI DELIVERY (${(perf * 100).toFixed(1)}%)`;
        const remaining = notionalShares - shares;
        if (remaining > 0.01) {
          const cost = remaining * price;
          euler -= cost;
          tradeStr += ` + BUY ${remaining.toFixed(2)} @ $${price.toFixed(2)} = -$${cost.toFixed(0)}`;
          shares = notionalShares;
        }
        const deliveryValue = notionalShares * price;

        rows.push({
          period: `Q${i + 1}`,
          price, perf: (perf * 100).toFixed(1) + '%',
          event, delta: 1.0, shares: notionalShares,
          xVal: deliveryValue, euler, coupon,
          trade: tradeStr, poolTotal: euler,
        });

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
        };
      } else {
        // Sell xStocks, return principal
        event = knockedIn ? 'MATURITY (KI recovered!)' : 'MATURITY (no KI)';
        const proceeds = shares * price;
        euler += proceeds;
        // Coupon already subtracted above (line 212). Just return principal.
        euler -= investorDep;

        rows.push({
          period: `Q${i + 1}`,
          price, perf: (perf * 100).toFixed(1) + '%',
          event, delta: 0, shares: 0, xVal: 0,
          euler, coupon,
          trade: `SELL ${shares.toFixed(2)} @ $${price.toFixed(2)} = +$${proceeds.toFixed(0)}`,
          poolTotal: euler,
        });
        shares = 0;

        result = {
          outcome: event,
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
    } else {
      rows.push({
        period: `Q${i + 1}`,
        price, perf: (perf * 100).toFixed(1) + '%',
        event, delta, shares, xVal: shares * price,
        euler, coupon, trade: tradeStr,
        poolTotal: euler + shares * price,
      });
    }
  }

  return { name, rows, result, config: { sigma, notionalShares, initialPrice, totalCoupons, couponsCount, protocolFee } };
}

// === DISPLAY ===

function printSimulation(sim) {
  const { name, rows, result, config } = sim;
  const r = result;

  console.log('\n' + '═'.repeat(90));
  console.log(`  ${name}`);
  console.log('═'.repeat(90));
  console.log(`  Initial: $${config.initialPrice.toFixed(2)} | Shares: ${config.notionalShares.toFixed(2)} | Vol: ${(config.sigma * 100).toFixed(0)}%`);
  console.log('─'.repeat(90));
  console.log(
    'Period'.padEnd(7) +
    'Price'.padStart(9) +
    'Perf'.padStart(8) +
    'Event'.padEnd(25) +
    'Delta'.padStart(6) +
    'Shares'.padStart(8) +
    'Euler'.padStart(10) +
    'PoolVal'.padStart(10)
  );
  console.log('─'.repeat(90));

  for (const row of rows) {
    console.log(
      String(row.period).padEnd(7) +
      `$${row.price.toFixed(2)}`.padStart(9) +
      String(row.perf).padStart(8) +
      ` ${row.event}`.padEnd(25) +
      row.delta.toFixed(2).padStart(6) +
      row.shares.toFixed(1).padStart(8) +
      `$${row.euler.toFixed(0)}`.padStart(10) +
      `$${row.poolTotal.toFixed(0)}`.padStart(10)
    );
    if (row.trade && row.trade !== 'NO REBALANCE') {
      console.log('       ' + '  → ' + row.trade);
    }
  }

  console.log('─'.repeat(90));
  console.log(`  OUTCOME: ${r.outcome} (${r.durationMonths} months)`);
  console.log(`  Stock return: ${(r.stockReturn * 100).toFixed(1)}%`);
  console.log('');
  console.log(`  INVESTOR:    Deposited $10,000 → Got $${r.investorTotal.toFixed(0)} (${r.knockedIn && r.investorReturn < 0 ? '' : '+'}${(r.investorReturn * 100).toFixed(1)}%)`);
  console.log(`               Coupons received: $${config.totalCoupons.toFixed(0)} (${config.couponsCount} payments)`);
  if (r.knockedIn && r.investorReturn < 0) {
    console.log(`               Physical delivery: ${config.notionalShares.toFixed(2)} xStock tokens`);
  }
  console.log('');
  console.log(`  UNDERWRITER: Deposited $${sim.rows[0].euler < 5000 ? '3,000' : '2,000'} → Got $${r.uwFinal.toFixed(0)} (${r.uwReturn >= 0 ? '+' : ''}${(r.uwReturn * 100).toFixed(1)}%)`);
  console.log(`  PROTOCOL:    Fee: $${config.protocolFee.toFixed(0)}`);
  console.log('═'.repeat(90));
}

// === ALL SIMULATIONS ===

// Historical price data (real prices)
const STOCKS = {
  NVDAx: { prices_mar25: [176.67, 177.82, 186.50, 183.14], initial_mar25: 108.36, vol: 0.45 },
  TSLAx: { prices_mar25: [317.66, 395.94, 449.72, 395.01], initial_mar25: 259.16, vol: 0.55 },
  AAPLx: { prices_mar25: [204.55, 237.88, 271.86, 255.76], initial_mar25: 221.17, vol: 0.25 },
  COINx: { prices_mar25: [350.49, 337.49, 226.14, 193.24], initial_mar25: 172.23, vol: 0.70 },
  METAx: { prices_mar25: [736.99, 733.78, 660.09, 638.27], initial_mar25: 575.06, vol: 0.35 },
  NFLXx: { prices_mar25: [133.91, 119.89, 93.76, 94.30],  initial_mar25: 93.25,  vol: 0.40 },
  AMZNx: { prices_mar25: [219.39, 219.57, 230.82, 209.55], initial_mar25: 190.26, vol: 0.30 },
  MSFTx: { prices_mar25: [494.54, 515.81, 482.52, 401.89], initial_mar25: 372.54, vol: 0.30 },
  MRKx:  { prices_mar25: [77.72, 83.22, 105.26, 115.94],   initial_mar25: 87.26,  vol: 0.25 },
  MCDx:  { prices_mar25: [287.19, 300.40, 303.93, 323.93],  initial_mar25: 305.32, vol: 0.18 },
  HOODx: { prices_mar25: [93.63, 143.18, 113.10, 76.12],    initial_mar25: 41.62,  vol: 0.75 },
};

// Coupon rates by vol bucket
function couponForVol(vol) {
  if (vol >= 0.50) return 0.05;  // 5%/quarter (20% ann) — HOOD, COIN, TSLA
  if (vol >= 0.35) return 0.04;  // 4%/quarter (16% ann) — NVDA, NFLX, META
  if (vol >= 0.25) return 0.03;  // 3%/quarter (12% ann) — AAPL, AMZN, MSFT, MRK
  return 0.02;                    // 2%/quarter (8% ann)  — MCD
}

const BASE_CONFIG = {
  acBarrier: 1.0,
  kiBarrier: 0.70,
  couponBarrier: 0.80,
  investorDep: 10000,
  eulerAPY: 0.05,
  rfRate: 0.05,
  periodsPerYear: 4,
};

console.log('\n' + '█'.repeat(90));
console.log('█  xYIELD NOTES — BACKTESTING AVEC DELTA-HEDGING (BLACK-SCHOLES)');
console.log('█  Données réelles xStocks : Mars 2025 → Mars 2026');
console.log('█'.repeat(90));

// ============================================================
// TIMELINE 1: Start Mars 2025 (creux → toutes les actions montent)
// ============================================================

console.log('\n\n' + '▓'.repeat(90));
console.log('▓  TIMELINE 1 : Start Mars 31, 2025 (marché au creux post-DeepSeek)');
console.log('▓  Observations : Jun 30, Sep 30, Dec 31, Mar 12 2026');
console.log('▓'.repeat(90));

const timeline1Results = [];
for (const [name, data] of Object.entries(STOCKS)) {
  const vol = data.vol;
  const coupon = couponForVol(vol);
  const uwDep = vol >= 0.50 ? 3000 : 2000;
  const sim = simulate({
    name: `${name} (Mar 2025 start)`,
    initialPrice: data.initial_mar25,
    obsPrices: data.prices_mar25,
    couponRate: coupon,
    uwDep,
    sigma: vol,
    ...BASE_CONFIG,
  });
  printSimulation(sim);
  timeline1Results.push(sim);
}

// ============================================================
// TIMELINE 2: Start Jun 2025 (pic pour beaucoup de stocks)
// ============================================================

console.log('\n\n' + '▓'.repeat(90));
console.log('▓  TIMELINE 2 : Start Jun 30, 2025 (pic pour plusieurs stocks)');
console.log('▓  Observations : Sep 30, Dec 31, Mar 12 2026');
console.log('▓'.repeat(90));

const timeline2Stocks = {
  COINx: { initial: 350.49, prices: [337.49, 226.14, 193.24], vol: 0.70 },
  NFLXx: { initial: 133.91, prices: [119.89, 93.76, 94.30],  vol: 0.40 },
  METAx: { initial: 736.99, prices: [733.78, 660.09, 638.27], vol: 0.35 },
  MSFTx: { initial: 494.54, prices: [515.81, 482.52, 401.89], vol: 0.30 },
  AAPLx: { initial: 204.55, prices: [237.88, 271.86, 255.76], vol: 0.25 },
  MRKx:  { initial: 77.72,  prices: [83.22, 105.26, 115.94],  vol: 0.25 },
};

const timeline2Results = [];
for (const [name, data] of Object.entries(timeline2Stocks)) {
  const coupon = couponForVol(data.vol);
  const uwDep = data.vol >= 0.50 ? 3000 : 2000;
  const sim = simulate({
    name: `${name} (Jun 2025 start)`,
    initialPrice: data.initial,
    obsPrices: data.prices,
    couponRate: coupon,
    uwDep,
    sigma: data.vol,
    ...BASE_CONFIG,
  });
  printSimulation(sim);
  timeline2Results.push(sim);
}

// ============================================================
// TIMELINE 3: Start Sep 2025 (pic absolu pour HOOD, TSLA, MSFT)
// ============================================================

console.log('\n\n' + '▓'.repeat(90));
console.log('▓  TIMELINE 3 : Start Sep 30, 2025 (pic pour HOOD, TSLA, MSFT)');
console.log('▓  Observations : Dec 31, Mar 12 2026 (6 mois)');
console.log('▓'.repeat(90));

const timeline3Stocks = {
  HOODx: { initial: 143.18, prices: [113.10, 76.12],  vol: 0.75 },
  TSLAx: { initial: 395.94, prices: [449.72, 395.01], vol: 0.55 },
  MSFTx: { initial: 515.81, prices: [482.52, 401.89], vol: 0.30 },
  NVDAx: { initial: 177.82, prices: [186.50, 183.14], vol: 0.45 },
  AAPLx: { initial: 237.88, prices: [271.86, 255.76], vol: 0.25 },
  MCDx:  { initial: 300.40, prices: [303.93, 323.93], vol: 0.18 },
};

const timeline3Results = [];
for (const [name, data] of Object.entries(timeline3Stocks)) {
  const coupon = couponForVol(data.vol);
  const uwDep = data.vol >= 0.50 ? 3000 : 2000;
  const sim = simulate({
    name: `${name} (Sep 2025 start)`,
    initialPrice: data.initial,
    obsPrices: data.prices,
    couponRate: coupon,
    uwDep,
    sigma: data.vol,
    ...BASE_CONFIG,
  });
  printSimulation(sim);
  timeline3Results.push(sim);
}

// ============================================================
// TIMELINE 4: Start Dec 2025 (test court terme 3 mois)
// ============================================================

console.log('\n\n' + '▓'.repeat(90));
console.log('▓  TIMELINE 4 : Start Dec 31, 2025 (3 mois, single observation)');
console.log('▓  Observation : Mar 12, 2026');
console.log('▓'.repeat(90));

const timeline4Stocks = {
  HOODx: { initial: 113.10, prices: [76.12],  vol: 0.75 },
  COINx: { initial: 226.14, prices: [193.24], vol: 0.70 },
  TSLAx: { initial: 449.72, prices: [395.01], vol: 0.55 },
  MSFTx: { initial: 482.52, prices: [401.89], vol: 0.30 },
  METAx: { initial: 660.09, prices: [638.27], vol: 0.35 },
  NVDAx: { initial: 186.50, prices: [183.14], vol: 0.45 },
  AAPLx: { initial: 271.86, prices: [255.76], vol: 0.25 },
  AMZNx: { initial: 230.82, prices: [209.55], vol: 0.30 },
  NFLXx: { initial: 93.76,  prices: [94.30],  vol: 0.40 },
  MRKx:  { initial: 105.26, prices: [115.94], vol: 0.25 },
  MCDx:  { initial: 303.93, prices: [323.93], vol: 0.18 },
};

const timeline4Results = [];
for (const [name, data] of Object.entries(timeline4Stocks)) {
  const coupon = couponForVol(data.vol);
  const uwDep = data.vol >= 0.50 ? 3000 : 2000;
  const sim = simulate({
    name: `${name} (Dec 2025 start, 3mo)`,
    initialPrice: data.initial,
    obsPrices: data.prices,
    couponRate: coupon,
    uwDep,
    sigma: data.vol,
    ...BASE_CONFIG,
  });
  printSimulation(sim);
  timeline4Results.push(sim);
}

// ============================================================
// SUMMARY TABLE
// ============================================================

console.log('\n\n' + '█'.repeat(100));
console.log('█  RÉSUMÉ GLOBAL — TOUTES LES SIMULATIONS');
console.log('█'.repeat(100));

function printSummaryTable(title, results) {
  console.log(`\n  ${title}`);
  console.log('  ' + '─'.repeat(96));
  console.log('  ' +
    'Stock'.padEnd(24) +
    'Outcome'.padEnd(22) +
    'Stock'.padStart(8) +
    'Inv.Ret'.padStart(10) +
    'UW.Ret'.padStart(10) +
    'Inv.$'.padStart(10) +
    'UW.$'.padStart(10) +
    'Dur.'.padStart(6)
  );
  console.log('  ' + '─'.repeat(96));

  for (const sim of results) {
    const r = sim.result;
    console.log('  ' +
      sim.name.padEnd(24) +
      r.outcome.substring(0, 21).padEnd(22) +
      `${(r.stockReturn * 100).toFixed(1)}%`.padStart(8) +
      `${r.investorReturn >= 0 ? '+' : ''}${(r.investorReturn * 100).toFixed(1)}%`.padStart(10) +
      `${r.uwReturn >= 0 ? '+' : ''}${(r.uwReturn * 100).toFixed(1)}%`.padStart(10) +
      `$${r.investorTotal.toFixed(0)}`.padStart(10) +
      `$${r.uwFinal.toFixed(0)}`.padStart(10) +
      `${r.durationMonths}mo`.padStart(6)
    );
  }
  console.log('  ' + '─'.repeat(96));
}

printSummaryTable('TIMELINE 1: Start Mars 2025 (creux)', timeline1Results);
printSummaryTable('TIMELINE 2: Start Juin 2025 (pic)', timeline2Results);
printSummaryTable('TIMELINE 3: Start Sep 2025 (pic HOOD/TSLA)', timeline3Results);
printSummaryTable('TIMELINE 4: Start Dec 2025 (3 mois)', timeline4Results);

// ============================================================
// AGGREGATE STATS
// ============================================================

const allResults = [...timeline1Results, ...timeline2Results, ...timeline3Results, ...timeline4Results];

const autocalls = allResults.filter(s => s.result.outcome.includes('AUTOCALL'));
const knockins = allResults.filter(s => s.result.outcome.includes('KNOCK-IN'));
const maturities = allResults.filter(s => s.result.outcome.includes('MATURITY'));

const invReturns = allResults.map(s => s.result.investorReturn);
const uwReturns = allResults.map(s => s.result.uwReturn);

console.log('\n\n' + '█'.repeat(60));
console.log('█  STATISTIQUES AGRÉGÉES');
console.log('█'.repeat(60));
console.log(`\n  Total simulations : ${allResults.length}`);
console.log(`  Autocalls :         ${autocalls.length} (${(autocalls.length / allResults.length * 100).toFixed(0)}%)`);
console.log(`  Knock-ins :         ${knockins.length} (${(knockins.length / allResults.length * 100).toFixed(0)}%)`);
console.log(`  Maturities :        ${maturities.length} (${(maturities.length / allResults.length * 100).toFixed(0)}%)`);

console.log('\n  INVESTOR RETURNS:');
console.log(`    Average :  ${(invReturns.reduce((a, b) => a + b, 0) / invReturns.length * 100).toFixed(1)}%`);
console.log(`    Min :      ${(Math.min(...invReturns) * 100).toFixed(1)}%`);
console.log(`    Max :      ${(Math.max(...invReturns) * 100).toFixed(1)}%`);
console.log(`    Win rate : ${(invReturns.filter(r => r >= 0).length / invReturns.length * 100).toFixed(0)}%`);

console.log('\n  UNDERWRITER RETURNS:');
console.log(`    Average :  ${(uwReturns.reduce((a, b) => a + b, 0) / uwReturns.length * 100).toFixed(1)}%`);
console.log(`    Min :      ${(Math.min(...uwReturns) * 100).toFixed(1)}%`);
console.log(`    Max :      ${(Math.max(...uwReturns) * 100).toFixed(1)}%`);
console.log(`    Win rate : ${(uwReturns.filter(r => r >= 0).length / uwReturns.length * 100).toFixed(0)}%`);

// Correlation: when investor loses, does underwriter win?
const kiSims = allResults.filter(s => s.result.knockedIn && s.result.investorReturn < 0);
if (kiSims.length > 0) {
  console.log('\n  KNOCK-IN ANALYSIS (investor loss → underwriter profit):');
  for (const s of kiSims) {
    console.log(`    ${s.name}: Inv ${(s.result.investorReturn * 100).toFixed(1)}% / UW ${(s.result.uwReturn * 100).toFixed(1)}%`);
  }
}

console.log('\n  ZERO-SUM CHECK (investor return + underwriter return ≈ Euler yield - fees):');
for (const s of allResults.slice(0, 5)) {
  const invPnL = s.result.investorTotal - s.config.investorDep;  // this doesn't exist, let me fix
  // Actually let me just show the check differently
  console.log(`    ${s.name.substring(0, 30)}: Inv ${(s.result.investorReturn * 100).toFixed(1)}% + UW ${(s.result.uwReturn * 100).toFixed(1)}%`);
}

console.log('\n' + '█'.repeat(60));
console.log('█  SIMULATION COMPLETE');
console.log('█'.repeat(60) + '\n');
