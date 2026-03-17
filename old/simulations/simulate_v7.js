#!/usr/bin/env node
// ============================================================
// xYield Notes v7 — FULL MONTE CARLO + DELTA HEDGING
//
// What's different from v5/v6:
// - 10,000 correlated GBM price paths (not 4 historical prices)
// - Weekly delta rebalancing with actual buy/sell of xStocks
// - Transaction costs (0.1% per trade via 1inch)
// - Per-stock hedging for worst-of baskets
// - Euler yield on idle USDC
// - Full distribution analysis (mean, median, P5, P95, Sharpe)
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
  return normalCDF(d1) - 1; // put delta is negative
}

function bsPutPrice(S, K, T, r, sigma) {
  if (T <= 0.001) return Math.max(K - S, 0);
  if (S <= 0.001) return K * Math.exp(-r * T);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

// Down-and-in put (closed form, Rubinstein-Reiner)
function diPutDelta(S, K, H, T, r, sigma) {
  if (T <= 0.001) return S <= K ? -1 : 0;
  if (S <= H) return bsPutDelta(S, K, T, r, sigma);
  const eps = S * 0.005;
  const pUp = diPutPrice(S + eps, K, H, T, r, sigma);
  const pDn = diPutPrice(S - eps, K, H, T, r, sigma);
  return (pUp - pDn) / (2 * eps);
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

// === RANDOM NUMBER GENERATION ===
// Marsaglia polar method for standard normal
let _spare = null;
function randn() {
  if (_spare !== null) {
    const v = _spare;
    _spare = null;
    return v;
  }
  let u, v, s;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2 * Math.log(s) / s);
  _spare = v * mul;
  return u * mul;
}

// Cholesky decomposition for correlation matrix
function cholesky(matrix) {
  const n = matrix.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) {
        L[i][j] = Math.sqrt(Math.max(matrix[i][i] - sum, 1e-10));
      } else {
        L[i][j] = (matrix[i][j] - sum) / L[j][j];
      }
    }
  }
  return L;
}

// === STOCK DATA ===
const STOCKS = {
  NVDAx:  { name: 'NVIDIA',      S0: 183.14, vol: 0.45, sector: 'tech' },
  TSLAx:  { name: 'Tesla',       S0: 395.01, vol: 0.55, sector: 'tech' },
  AAPLx:  { name: 'Apple',       S0: 255.76, vol: 0.25, sector: 'tech' },
  COINx:  { name: 'Coinbase',    S0: 193.24, vol: 0.70, sector: 'crypto' },
  METAx:  { name: 'Meta',        S0: 638.27, vol: 0.35, sector: 'tech' },
  NFLXx:  { name: 'Netflix',     S0: 94.30,  vol: 0.40, sector: 'tech' },
  AMZNx:  { name: 'Amazon',      S0: 209.55, vol: 0.30, sector: 'tech' },
  MSFTx:  { name: 'Microsoft',   S0: 401.89, vol: 0.30, sector: 'tech' },
  MRKx:   { name: 'Merck',       S0: 115.94, vol: 0.25, sector: 'pharma' },
  MCDx:   { name: "McDonald's",  S0: 323.93, vol: 0.18, sector: 'consumer' },
  HOODx:  { name: 'Robinhood',   S0: 76.12,  vol: 0.75, sector: 'fintech' },
};

// Pairwise correlations (estimated from real data + sector adjustments)
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
  const key1 = `${s1}-${s2}`;
  const key2 = `${s2}-${s1}`;
  return CORR_MAP[key1] ?? CORR_MAP[key2] ?? 0.20;
}

// Build correlation matrix for a basket
function buildCorrMatrix(stocks) {
  const n = stocks.length;
  const C = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      C[i][j] = getCorr(stocks[i], stocks[j]);
    }
  }
  return C;
}

// === GENERATE CORRELATED GBM PATHS ===
function generatePaths(stocks, nPaths, T, nSteps) {
  const n = stocks.length;
  const dt = T / nSteps;
  const sqrtDt = Math.sqrt(dt);

  const corrMatrix = buildCorrMatrix(stocks);
  const L = cholesky(corrMatrix);

  const vols = stocks.map(s => STOCKS[s].vol);
  const S0s = stocks.map(s => STOCKS[s].S0);
  const r = 0.05; // risk-free rate

  // paths[pathIdx][stockIdx][stepIdx] — stepIdx 0 = initial price
  const paths = [];

  for (let p = 0; p < nPaths; p++) {
    const path = stocks.map((s, i) => {
      const arr = new Float64Array(nSteps + 1);
      arr[0] = S0s[i];
      return arr;
    });

    for (let t = 0; t < nSteps; t++) {
      // Generate independent normals
      const z = [];
      for (let i = 0; i < n; i++) z.push(randn());

      // Correlate using Cholesky
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
          w[i] += L[i][j] * z[j];
        }
      }

      // GBM step: S(t+dt) = S(t) * exp((r - 0.5*sigma^2)*dt + sigma*sqrt(dt)*w)
      for (let i = 0; i < n; i++) {
        const drift = (r - 0.5 * vols[i] * vols[i]) * dt;
        const diffusion = vols[i] * sqrtDt * w[i];
        path[i][t + 1] = path[i][t] * Math.exp(drift + diffusion);
      }
    }

    paths.push(path);
  }

  return paths;
}

// === SIMULATE ONE PATH WITH FULL DELTA HEDGING ===
function simulateOnePath(path, stocks, config) {
  const {
    kiBarrier, couponBarrier, acBarrierStart, acStepDown,
    couponRate, memoryCoupon,
    investorDep, uwDep,
    eulerAPY, rfRate,
    nQuarters, // number of quarterly observation dates
    rebalFreqWeeks, // how often to rebalance hedge (1 = weekly)
    txCost, // transaction cost per trade (0.001 = 0.1%)
  } = config;

  const n = stocks.length;
  const S0 = stocks.map(s => STOCKS[s].S0);
  const vols = stocks.map(s => STOCKS[s].vol);
  const maxVol = Math.max(...vols);

  // Time params
  const T = nQuarters * 0.25; // total time in years
  const stepsPerQuarter = 13; // ~13 weeks per quarter
  const totalSteps = nQuarters * stepsPerQuarter;
  const dt = T / totalSteps;

  const protocolFee = 0.005 * investorDep;
  const pool = investorDep + uwDep;

  // State
  let cash = pool - protocolFee; // USDC in Euler earning yield
  let shares = new Float64Array(n); // shares held per stock (negative = short)
  let knockedIn = false;
  let totalCouponsPaid = 0;
  let missedCoupons = 0;
  let totalTxCosts = 0;
  let totalTradeVolume = 0;
  let tradeCount = 0;

  // Track all hedge trades
  const trades = [];

  // Initial hedge: buy delta shares of each stock
  for (let i = 0; i < n; i++) {
    const timeToMat = T;
    const barrier = kiBarrier * S0[i];
    const delta = Math.abs(diPutDelta(S0[i], S0[i], barrier, timeToMat, rfRate, vols[i]));
    const clampedDelta = Math.max(0.05, Math.min(delta, 0.95));
    const notional = investorDep / n; // split notional across stocks
    const targetShares = clampedDelta * (notional / S0[i]);

    shares[i] = targetShares;
    const cost = targetShares * S0[i];
    const fee = cost * txCost;
    cash -= cost + fee;
    totalTxCosts += fee;
    totalTradeVolume += cost;
    tradeCount++;
  }

  let result = null;

  for (let step = 1; step <= totalSteps; step++) {
    const currentT = step * dt;
    const timeToMat = Math.max(T - currentT, 0.001);
    const isQuarterEnd = step % stepsPerQuarter === 0;
    const quarterNum = Math.floor((step - 1) / stepsPerQuarter) + 1;
    const isRebalWeek = step % rebalFreqWeeks === 0;
    const isLast = step === totalSteps;

    // Current prices
    const prices = stocks.map((s, i) => path[i][step]);
    const perfs = prices.map((p, i) => p / S0[i]);
    const worstPerf = Math.min(...perfs);
    const worstIdx = perfs.indexOf(worstPerf);

    // Euler yield on cash (weekly)
    const weeklyYield = eulerAPY * dt;
    if (cash > 0) cash += cash * weeklyYield;

    // === QUARTERLY OBSERVATION ===
    if (isQuarterEnd) {
      // Step-down autocall barrier
      const currentACBarrier = Math.max(acBarrierStart - acStepDown * (quarterNum - 1), 0.80);
      const allAboveAC = perfs.every(p => p >= currentACBarrier);

      // 1) AUTOCALL
      if (allAboveAC) {
        let coupon = couponRate * investorDep;
        totalCouponsPaid += coupon;
        if (memoryCoupon && missedCoupons > 0) {
          totalCouponsPaid += missedCoupons;
          coupon += missedCoupons;
          missedCoupons = 0;
        }

        // Unwind all hedge positions (sell all shares)
        for (let i = 0; i < n; i++) {
          if (Math.abs(shares[i]) > 0.001) {
            const proceeds = shares[i] * prices[i];
            const fee = Math.abs(proceeds) * txCost;
            cash += proceeds - fee;
            totalTxCosts += fee;
            totalTradeVolume += Math.abs(proceeds);
            tradeCount++;
            shares[i] = 0;
          }
        }

        // Pay investor: principal + coupons
        cash -= investorDep + coupon;

        result = {
          outcome: 'AUTOCALL',
          quarter: quarterNum,
          durationYears: currentT,
          investorPnL: totalCouponsPaid,
          investorReturn: totalCouponsPaid / investorDep,
          uwPnL: cash - uwDep,
          uwReturn: (cash - uwDep) / uwDep,
          worstPerf,
          knockedIn: false,
          totalTxCosts,
          totalTradeVolume,
          tradeCount,
        };
        break;
      }

      // 2) KNOCK-IN check
      if (worstPerf <= kiBarrier && !knockedIn) {
        knockedIn = true;
      }

      // 3) COUPON payment
      if (worstPerf >= couponBarrier) {
        let coupon = couponRate * investorDep;
        totalCouponsPaid += coupon;
        if (memoryCoupon && missedCoupons > 0) {
          totalCouponsPaid += missedCoupons;
          coupon += missedCoupons;
          missedCoupons = 0;
        }
        cash -= coupon;
      } else if (memoryCoupon) {
        missedCoupons += couponRate * investorDep;
      }
    }

    // === WEEKLY KNOCK-IN CHECK (continuous monitoring) ===
    if (!isQuarterEnd && worstPerf <= kiBarrier && !knockedIn) {
      knockedIn = true;
    }

    // === DELTA REBALANCE ===
    if (isRebalWeek && !result) {
      for (let i = 0; i < n; i++) {
        const S = prices[i];
        const barrier = kiBarrier * S0[i];
        const notional = investorDep / n;
        const notionalShares = notional / S0[i];
        let targetDelta;

        if (knockedIn && perfs[i] < 1.0) {
          // KI activated: increase hedge aggressively
          const depth = 1 - perfs[i];
          targetDelta = Math.min(0.5 + depth * 3, 1.0);
        } else if (isLast) {
          targetDelta = knockedIn && perfs[i] < 1.0 ? 1.0 : 0.05;
        } else {
          // Standard delta from DI put
          targetDelta = Math.abs(diPutDelta(S, S0[i], barrier, timeToMat, rfRate, vols[i]));
          targetDelta = Math.max(0.05, Math.min(targetDelta, 0.95));

          // If stock is well above AC barrier, reduce hedge (likely to autocall)
          if (perfs[i] > 1.1) targetDelta *= 0.7;
        }

        const targetShares = targetDelta * notionalShares;
        const diff = targetShares - shares[i];

        // Only trade if change is significant (> 5% of position)
        if (Math.abs(diff) > notionalShares * 0.05) {
          const tradeValue = Math.abs(diff * S);
          const fee = tradeValue * txCost;

          if (diff > 0) {
            // Buy more shares
            cash -= diff * S + fee;
          } else {
            // Sell shares
            cash += Math.abs(diff) * S - fee;
          }

          shares[i] = targetShares;
          totalTxCosts += fee;
          totalTradeVolume += tradeValue;
          tradeCount++;
        }
      }
    }

    // === MATURITY ===
    if (isLast && !result) {
      if (knockedIn && worstPerf < 1.0) {
        // Physical delivery of worst stock
        const deliveryValue = investorDep * worstPerf;

        // Unwind all positions
        for (let i = 0; i < n; i++) {
          if (Math.abs(shares[i]) > 0.001) {
            const proceeds = shares[i] * prices[i];
            const fee = Math.abs(proceeds) * txCost;
            cash += proceeds - fee;
            totalTxCosts += fee;
            totalTradeVolume += Math.abs(proceeds);
            tradeCount++;
            shares[i] = 0;
          }
        }

        // UW buys worst stock for delivery
        const buyCost = deliveryValue;
        const buyFee = buyCost * txCost;
        cash -= buyCost + buyFee;
        totalTxCosts += buyFee;

        result = {
          outcome: 'KNOCK-IN',
          quarter: nQuarters,
          durationYears: T,
          investorPnL: deliveryValue + totalCouponsPaid - investorDep,
          investorReturn: (deliveryValue + totalCouponsPaid - investorDep) / investorDep,
          uwPnL: cash - uwDep,
          uwReturn: (cash - uwDep) / uwDep,
          worstPerf,
          knockedIn: true,
          totalTxCosts,
          totalTradeVolume,
          tradeCount,
        };
      } else {
        // No KI → return principal + coupons
        // Unwind hedge
        for (let i = 0; i < n; i++) {
          if (Math.abs(shares[i]) > 0.001) {
            const proceeds = shares[i] * prices[i];
            const fee = Math.abs(proceeds) * txCost;
            cash += proceeds - fee;
            totalTxCosts += fee;
            totalTradeVolume += Math.abs(proceeds);
            tradeCount++;
            shares[i] = 0;
          }
        }
        cash -= investorDep;

        result = {
          outcome: 'MATURITY',
          quarter: nQuarters,
          durationYears: T,
          investorPnL: totalCouponsPaid,
          investorReturn: totalCouponsPaid / investorDep,
          uwPnL: cash - uwDep,
          uwReturn: (cash - uwDep) / uwDep,
          worstPerf,
          knockedIn,
          totalTxCosts,
          totalTradeVolume,
          tradeCount,
        };
      }
    }
  }

  return result;
}

// === FULL MONTE CARLO SIMULATION ===
function runMonteCarlo(stocks, config, nPaths) {
  const nQuarters = config.nQuarters;
  const stepsPerQuarter = 13;
  const totalSteps = nQuarters * stepsPerQuarter;
  const T = nQuarters * 0.25;

  // Generate all paths
  const paths = generatePaths(stocks, nPaths, T, totalSteps);

  // Simulate each path
  const results = [];
  for (let p = 0; p < nPaths; p++) {
    const r = simulateOnePath(paths[p], stocks, config);
    if (r) results.push(r);
  }

  return results;
}

// === STATISTICS ===
function computeStats(results) {
  const invRets = results.map(r => r.investorReturn).sort((a, b) => a - b);
  const uwRets = results.map(r => r.uwReturn).sort((a, b) => a - b);
  const n = results.length;

  const percentile = (arr, p) => arr[Math.floor(arr.length * p / 100)];
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const median = arr => arr[Math.floor(arr.length / 2)];
  const stddev = (arr, m) => Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);

  const invMean = mean(invRets);
  const uwMean = mean(uwRets);

  const outcomes = {};
  for (const r of results) {
    outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
  }

  const avgDuration = mean(results.map(r => r.durationYears));
  const invAnn = invMean / avgDuration; // annualized

  // Auto-roll APY: if avg note lasts X quarters, compound returns
  const avgQuarters = mean(results.map(r => r.quarter));
  const avgRetPerQ = invMean / avgQuarters;
  const autoRollAPY = Math.pow(1 + Math.max(avgRetPerQ, -0.99), 4) - 1;

  return {
    n,
    invMean, invMedian: median(invRets),
    invP5: percentile(invRets, 5), invP25: percentile(invRets, 25),
    invP75: percentile(invRets, 75), invP95: percentile(invRets, 95),
    invStd: stddev(invRets, invMean),
    invWinRate: invRets.filter(r => r >= 0).length / n,
    invAnn, autoRollAPY,

    uwMean, uwMedian: median(uwRets),
    uwP5: percentile(uwRets, 5), uwP25: percentile(uwRets, 25),
    uwP75: percentile(uwRets, 75), uwP95: percentile(uwRets, 95),
    uwStd: stddev(uwRets, uwMean),
    uwWinRate: uwRets.filter(r => r >= 0).length / n,

    acRate: (outcomes['AUTOCALL'] || 0) / n,
    kiRate: (outcomes['KNOCK-IN'] || 0) / n,
    matRate: (outcomes['MATURITY'] || 0) / n,
    avgDuration, avgQuarters,

    avgTxCosts: mean(results.map(r => r.totalTxCosts)),
    avgTradeVolume: mean(results.map(r => r.totalTradeVolume)),
    avgTradeCount: mean(results.map(r => r.tradeCount)),
  };
}

function pct(v) { return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`; }

// ============================================================
// RUN SIMULATIONS
// ============================================================

const N_PATHS = 10000;
const BASE_CONFIG = {
  kiBarrier: 0.55,
  couponBarrier: 0.65,
  acBarrierStart: 1.0,
  acStepDown: 0.025, // GS step-down
  memoryCoupon: true,
  investorDep: 10000,
  eulerAPY: 0.05,
  rfRate: 0.05,
  nQuarters: 4, // 1 year
  rebalFreqWeeks: 1, // weekly rebalancing
  txCost: 0.001, // 0.1% per trade (1inch)
};

console.log('█'.repeat(120));
console.log('█  xYIELD v7 — FULL MONTE CARLO + DELTA HEDGING');
console.log(`█  ${N_PATHS.toLocaleString()} paths per basket | Weekly rebalancing | 0.1% tx cost | Euler 5% APY`);
console.log('█  Correlated GBM paths | Per-stock hedging | Transaction cost tracking');
console.log('█'.repeat(120));

// ============================================================
// PART 1: HERO BASKETS — Full Monte Carlo
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 1: HERO BASKETS — 10,000 Monte Carlo paths each');
console.log('▓'.repeat(120));

const heroBaskets = [
  { name: 'NVDAx (single)',          stocks: ['NVDAx'], cpn: 0.028 },
  { name: 'NVDAx/TSLAx',            stocks: ['NVDAx', 'TSLAx'], cpn: 0.043 },
  { name: 'NVDAx/AAPLx/TSLAx (GS)', stocks: ['NVDAx', 'AAPLx', 'TSLAx'], cpn: 0.05 },
  { name: 'NVDAx/TSLAx/AMZNx',      stocks: ['NVDAx', 'TSLAx', 'AMZNx'], cpn: 0.049 },
  { name: 'NVDAx/AAPLx/AMZNx',      stocks: ['NVDAx', 'AAPLx', 'AMZNx'], cpn: 0.044 },
  { name: 'TSLAx/COINx/HOODx',      stocks: ['TSLAx', 'COINx', 'HOODx'], cpn: 0.056 },
];

for (const basket of heroBaskets) {
  process.stdout.write(`  Simulating ${basket.name}...`);
  const maxVol = Math.max(...basket.stocks.map(s => STOCKS[s].vol));
  const uwDep = Math.round(10000 * (maxVol >= 0.50 ? 0.60 : 0.45));

  const results = runMonteCarlo(basket.stocks, {
    ...BASE_CONFIG,
    couponRate: basket.cpn,
    uwDep,
  }, N_PATHS);

  const stats = computeStats(results);
  console.log(` done (${results.length} paths)`);

  console.log(`\n  ═══ ${basket.name} ═══`);
  console.log(`  Coupon: ${(basket.cpn * 100).toFixed(1)}%/Q = ${(basket.cpn * 400).toFixed(0)}% ann  |  UW deposit: $${uwDep}  |  Max vol: ${(maxVol * 100).toFixed(0)}%`);
  console.log('');
  console.log('  INVESTOR:');
  console.log(`    Mean return:   ${pct(stats.invMean)}  |  Annualized: ${pct(stats.invAnn)}  |  AutoRoll APY: ${pct(stats.autoRollAPY)}`);
  console.log(`    Median:        ${pct(stats.invMedian)}  |  Std dev: ${(stats.invStd * 100).toFixed(1)}%`);
  console.log(`    P5/P25/P75/P95: ${pct(stats.invP5)} / ${pct(stats.invP25)} / ${pct(stats.invP75)} / ${pct(stats.invP95)}`);
  console.log(`    Win rate:      ${(stats.invWinRate * 100).toFixed(1)}%`);
  console.log('');
  console.log('  UNDERWRITER:');
  console.log(`    Mean return:   ${pct(stats.uwMean)}  |  Std dev: ${(stats.uwStd * 100).toFixed(1)}%`);
  console.log(`    Median:        ${pct(stats.uwMedian)}`);
  console.log(`    P5/P25/P75/P95: ${pct(stats.uwP5)} / ${pct(stats.uwP25)} / ${pct(stats.uwP75)} / ${pct(stats.uwP95)}`);
  console.log(`    Win rate:      ${(stats.uwWinRate * 100).toFixed(1)}%`);
  console.log('');
  console.log('  OUTCOMES:');
  console.log(`    Autocall: ${(stats.acRate * 100).toFixed(1)}%  |  Maturity: ${(stats.matRate * 100).toFixed(1)}%  |  Knock-in: ${(stats.kiRate * 100).toFixed(1)}%`);
  console.log(`    Avg duration: ${(stats.avgDuration * 12).toFixed(1)} months (${stats.avgQuarters.toFixed(1)} quarters)`);
  console.log('');
  console.log('  HEDGING COSTS:');
  console.log(`    Avg tx costs: $${stats.avgTxCosts.toFixed(0)}  |  Avg volume: $${stats.avgTradeVolume.toFixed(0)}  |  Avg trades: ${stats.avgTradeCount.toFixed(0)}`);
  console.log('');
}

// ============================================================
// PART 2: FAIR COUPON SEARCH — GS basket
// ============================================================
console.log('\n' + '▓'.repeat(120));
console.log('▓  PART 2: FAIR COUPON SEARCH — NVDAx/AAPLx/TSLAx');
console.log('▓  Finding coupon where BOTH investor AND underwriter are EV+');
console.log('▓'.repeat(120));

const gsStocks = ['NVDAx', 'AAPLx', 'TSLAx'];
const couponsToTest = [0.025, 0.03, 0.035, 0.04, 0.045, 0.05, 0.055, 0.06];
const uwDepsToTest = [3000, 4500, 6000];

console.log('\n  ' + 'Cpn/Q'.padEnd(8) + 'UW$'.padEnd(7) +
  'INVann'.padStart(8) + 'INVmed'.padStart(8) + 'INVwin'.padStart(8) +
  'UWavg'.padStart(8) + 'UWmed'.padStart(8) + 'UWwin'.padStart(8) +
  'AC%'.padStart(6) + 'KI%'.padStart(6) + '  Roll   Verdict');
console.log('  ' + '─'.repeat(105));

for (const cpn of couponsToTest) {
  for (const uwDep of uwDepsToTest) {
    const results = runMonteCarlo(gsStocks, {
      ...BASE_CONFIG,
      couponRate: cpn,
      uwDep,
    }, 5000); // 5k paths for speed

    const stats = computeStats(results);

    let verdict = '';
    if (stats.invAnn >= 0.12 && stats.uwMean >= 0.01 && stats.invWinRate >= 0.85) verdict = '★★★ PERFECT';
    else if (stats.invAnn >= 0.10 && stats.uwMean >= 0 && stats.invWinRate >= 0.80) verdict = '★★ SWEET';
    else if (stats.invAnn >= 0.08 && stats.uwMean >= -0.03) verdict = '★ GOOD';
    else if (stats.uwMean < -0.05) verdict = '✗ UW bleeds';
    else verdict = '~';

    console.log('  ' +
      `${(cpn * 100).toFixed(1)}%`.padEnd(8) +
      `$${uwDep}`.padEnd(7) +
      pct(stats.invAnn).padStart(8) +
      pct(stats.invMedian).padStart(8) +
      `${(stats.invWinRate * 100).toFixed(0)}%`.padStart(8) +
      pct(stats.uwMean).padStart(8) +
      pct(stats.uwMedian).padStart(8) +
      `${(stats.uwWinRate * 100).toFixed(0)}%`.padStart(8) +
      `${(stats.acRate * 100).toFixed(0)}%`.padStart(6) +
      `${(stats.kiRate * 100).toFixed(0)}%`.padStart(6) +
      `  ${pct(stats.autoRollAPY).padEnd(7)}` +
      ` ${verdict}`
    );
  }
}

// ============================================================
// PART 3: UW DEPOSIT SENSITIVITY — How much should UW put up?
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 3: UNDERWRITER DEPOSIT SENSITIVITY');
console.log('▓  NVDAx/AAPLx/TSLAx at 5.0%/Q — testing UW deposit from $2000 to $10000');
console.log('▓'.repeat(120));

const uwDeps = [2000, 3000, 4000, 5000, 6000, 7500, 10000];

console.log('\n  ' + 'UW dep'.padEnd(9) + '% of INV'.padEnd(10) +
  'UWavg'.padStart(8) + 'UWmed'.padStart(8) + 'UWwin'.padStart(8) + 'UWP5'.padStart(8) + 'UWP95'.padStart(8) +
  'INVann'.padStart(8) + 'INVwin'.padStart(8) + '  Verdict');
console.log('  ' + '─'.repeat(95));

for (const uwDep of uwDeps) {
  const results = runMonteCarlo(gsStocks, {
    ...BASE_CONFIG,
    couponRate: 0.05,
    uwDep,
  }, 5000);

  const stats = computeStats(results);

  let verdict = '';
  if (stats.uwMean >= 0.02 && stats.uwWinRate >= 0.55) verdict = '★★ UW loves it';
  else if (stats.uwMean >= 0 && stats.uwWinRate >= 0.45) verdict = '★ Balanced';
  else if (stats.uwMean >= -0.03) verdict = '~ OK';
  else verdict = '✗ UW too risky';

  console.log('  ' +
    `$${uwDep}`.padEnd(9) +
    `${(uwDep / 100).toFixed(0)}%`.padEnd(10) +
    pct(stats.uwMean).padStart(8) +
    pct(stats.uwMedian).padStart(8) +
    `${(stats.uwWinRate * 100).toFixed(0)}%`.padStart(8) +
    pct(stats.uwP5).padStart(8) +
    pct(stats.uwP95).padStart(8) +
    pct(stats.invAnn).padStart(8) +
    `${(stats.invWinRate * 100).toFixed(0)}%`.padStart(8) +
    `  ${verdict}`
  );
}

// ============================================================
// PART 4: MATURITY SENSITIVITY — 1Y vs 6M vs 2Y
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 4: MATURITY SENSITIVITY — NVDAx/AAPLx/TSLAx at 5.0%/Q');
console.log('▓'.repeat(120));

const maturities = [
  { name: '6 months (2Q)', nQ: 2 },
  { name: '9 months (3Q)', nQ: 3 },
  { name: '1 year (4Q)',   nQ: 4 },
  { name: '18 months (6Q)', nQ: 6 },
  { name: '2 years (8Q)',  nQ: 8 },
];

console.log('\n  ' + 'Maturity'.padEnd(20) +
  'INVann'.padStart(8) + 'INVwin'.padStart(8) + 'INVmed'.padStart(8) +
  'UWavg'.padStart(8) + 'UWwin'.padStart(8) +
  'AC%'.padStart(6) + 'KI%'.padStart(6) + '  Roll   AvgDur');
console.log('  ' + '─'.repeat(100));

for (const mat of maturities) {
  const results = runMonteCarlo(gsStocks, {
    ...BASE_CONFIG,
    couponRate: 0.05,
    uwDep: 6000,
    nQuarters: mat.nQ,
  }, 5000);

  const stats = computeStats(results);

  console.log('  ' +
    mat.name.padEnd(20) +
    pct(stats.invAnn).padStart(8) +
    `${(stats.invWinRate * 100).toFixed(0)}%`.padStart(8) +
    pct(stats.invMedian).padStart(8) +
    pct(stats.uwMean).padStart(8) +
    `${(stats.uwWinRate * 100).toFixed(0)}%`.padStart(8) +
    `${(stats.acRate * 100).toFixed(0)}%`.padStart(6) +
    `${(stats.kiRate * 100).toFixed(0)}%`.padStart(6) +
    `  ${pct(stats.autoRollAPY).padEnd(7)}` +
    ` ${(stats.avgDuration * 12).toFixed(0)}mo`
  );
}

// ============================================================
// PART 5: KI BARRIER SENSITIVITY
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 5: KI BARRIER SENSITIVITY — NVDAx/AAPLx/TSLAx at 5.0%/Q');
console.log('▓'.repeat(120));

const kiLevels = [0.45, 0.50, 0.55, 0.60, 0.65, 0.70];

console.log('\n  ' + 'KI'.padEnd(6) +
  'INVann'.padStart(8) + 'INVwin'.padStart(8) + 'INVP5'.padStart(8) +
  'UWavg'.padStart(8) + 'UWwin'.padStart(8) + 'UWP5'.padStart(8) +
  'KI%'.padStart(6) + '  Verdict');
console.log('  ' + '─'.repeat(80));

for (const ki of kiLevels) {
  const results = runMonteCarlo(gsStocks, {
    ...BASE_CONFIG,
    kiBarrier: ki,
    couponRate: 0.05,
    uwDep: 6000,
  }, 5000);

  const stats = computeStats(results);

  let verdict = '';
  if (stats.invWinRate >= 0.85 && stats.uwMean >= 0) verdict = '★★ BALANCED';
  else if (stats.invWinRate >= 0.80 && stats.uwMean >= -0.03) verdict = '★ OK';
  else if (stats.kiRate > 0.20) verdict = '✗ too many KI';
  else verdict = '~';

  console.log('  ' +
    `${(ki * 100).toFixed(0)}%`.padEnd(6) +
    pct(stats.invAnn).padStart(8) +
    `${(stats.invWinRate * 100).toFixed(0)}%`.padStart(8) +
    pct(stats.invP5).padStart(8) +
    pct(stats.uwMean).padStart(8) +
    `${(stats.uwWinRate * 100).toFixed(0)}%`.padStart(8) +
    pct(stats.uwP5).padStart(8) +
    `${(stats.kiRate * 100).toFixed(0)}%`.padStart(6) +
    `  ${verdict}`
  );
}

// ============================================================
// FINAL SUMMARY
// ============================================================
console.log('\n\n' + '█'.repeat(120));
console.log('█  v7 COMPLETE — FULL MONTE CARLO RESULTS');
console.log('█'.repeat(120));
console.log(`
  This simulation uses:
  - ${N_PATHS.toLocaleString()} correlated GBM price paths per basket
  - Cholesky decomposition for realistic cross-asset correlations
  - Weekly delta hedge rebalancing with actual buy/sell
  - 0.1% transaction costs on every trade (via 1inch)
  - 5% APY Euler yield on idle USDC
  - Per-stock hedging for worst-of baskets
  - Memory coupon + step-down autocall (GS style)
`);
