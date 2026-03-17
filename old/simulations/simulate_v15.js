#!/usr/bin/env node
// ============================================================
// xYield v15 — ADVANCED HEDGING ENGINE
//
// Problem: v14 hedge was biweekly → missed gamma PnL
// Solution: Realistic hedging like GS/JPM structured desks
//
// KEY CONCEPTS:
// 1. Gamma scalping: short option → negative gamma → but if you
//    hedge frequently, you CAPTURE realized vol. If realized > implied,
//    the hedge generates PROFIT.
//
// 2. Theta/gamma tradeoff: option decays (theta = income for seller),
//    gamma risk = cost. Net = theta - gamma_loss.
//    With frequent hedging: gamma_loss ≈ 0.5 * gamma * (dS)^2
//    With infrequent hedging: gamma_loss >> above (path-dependent blowups)
//
// 3. The desk profit formula:
//    PnL = theta_collected - realized_gamma_cost + vega_PnL
//    If implied_vol > realized_vol → desk profits
//    Frequent hedging → realized_gamma_cost is PREDICTABLE and SMALL
//
// THIS SIMULATION:
// - Tests hedge frequencies: continuous (2x/day), daily, 3-day, weekly, biweekly
// - Tests delta thresholds: 0.02, 0.05, 0.10
// - Properly tracks gamma scalping PnL
// - Shows hedge as PROFIT CENTER not just cost
// ============================================================

function normalCDF(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign=x<0?-1:1,t=1/(1+p*Math.abs(x));
  return 0.5*(1+sign*(1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x/2)));
}
function diPutPx(S,K,H,T,r,sig){
  if(T<=0.001)return S<=H?Math.max(K-S,0):0;
  if(S<=H){const sq=Math.sqrt(T),d1=(Math.log(S/K)+(r+sig*sig/2)*T)/(sig*sq);return K*Math.exp(-r*T)*normalCDF(-(d1-sig*sq))-S*normalCDF(-d1);}
  if(S<=0.001||sig<=0.001)return 0;
  const sq=Math.sqrt(T),lam=(r+sig*sig/2)/(sig*sig);
  const x1=Math.log(S/H)/(sig*sq)+lam*sig*sq,y=Math.log(H*H/(S*K))/(sig*sq)+lam*sig*sq,y1=Math.log(H/S)/(sig*sq)+lam*sig*sq;
  const p2l=Math.pow(H/S,2*lam),p2l2=Math.pow(H/S,2*lam-2),disc=Math.exp(-r*T);
  return Math.max(-S*normalCDF(-x1)+K*disc*normalCDF(-x1+sig*sq)+S*p2l*(normalCDF(y)-normalCDF(y1))-K*disc*p2l2*(normalCDF(y-sig*sq)-normalCDF(y1-sig*sq)),0);
}
function diPutDelta(S,K,H,T,r,sig){
  if(T<=0.001)return S<=K?-1:0;
  if(S<=H){const sq=Math.sqrt(T);return normalCDF((Math.log(S/K)+(r+sig*sig/2)*T)/(sig*sq))-1;}
  const eps=S*0.005;return(diPutPx(S+eps,K,H,T,r,sig)-diPutPx(S-eps,K,H,T,r,sig))/(2*eps);
}
function diPutGamma(S,K,H,T,r,sig){
  if(T<=0.001||S<=0.001)return 0;
  const eps=S*0.005;
  return(diPutDelta(S+eps,K,H,T,r,sig)-diPutDelta(S-eps,K,H,T,r,sig))/(2*eps);
}

let _sp=null;
function randn(){if(_sp!==null){const v=_sp;_sp=null;return v;}let u,v,s;do{u=Math.random()*2-1;v=Math.random()*2-1;s=u*u+v*v;}while(s>=1||s===0);const m=Math.sqrt(-2*Math.log(s)/s);_sp=v*m;return u*m;}
function cholesky(M){const n=M.length,L=Array.from({length:n},()=>new Float64Array(n));for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let s=0;for(let k=0;k<j;k++)s+=L[i][k]*L[j][k];L[i][j]=i===j?Math.sqrt(Math.max(M[i][i]-s,1e-10)):(M[i][j]-s)/L[j][j];}return L;}

const ST = {
  NVDAx:{S0:183.14,vol:0.55}, TSLAx:{S0:395.01,vol:0.60},
  COINx:{S0:193.24,vol:0.75}, MSTRx:{S0:350.00,vol:0.85},
  AMDx:{S0:115.00,vol:0.50}, METAx:{S0:638.27,vol:0.38},
  AAPLx:{S0:255.76,vol:0.28},
};
const CR={
  'NVDAx-TSLAx':0.45,'NVDAx-COINx':0.35,'NVDAx-MSTRx':0.35,'NVDAx-AMDx':0.70,
  'NVDAx-METAx':0.55,'NVDAx-AAPLx':0.60,
  'TSLAx-COINx':0.40,'TSLAx-MSTRx':0.30,'TSLAx-AMDx':0.40,'TSLAx-METAx':0.30,'TSLAx-AAPLx':0.35,
  'COINx-MSTRx':0.75,'COINx-AMDx':0.25,'COINx-METAx':0.20,'COINx-AAPLx':0.15,
  'MSTRx-AMDx':0.25,'MSTRx-METAx':0.20,'MSTRx-AAPLx':0.15,
  'AMDx-METAx':0.50,'AMDx-AAPLx':0.55,'METAx-AAPLx':0.65,
};
function gc(a,b){return a===b?1:CR[`${a}-${b}`]??CR[`${b}-${a}`]??0.20;}

// ============================================================
// PATH GENERATION — fine-grained for accurate hedging
// stepsPerDay controls simulation granularity
// ============================================================
function genPaths(stocks, nP, T, totalSteps) {
  const n=stocks.length, dt=T/totalSteps, sq=Math.sqrt(dt);
  const C=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>gc(stocks[i],stocks[j])));
  const L=cholesky(C), vols=stocks.map(s=>ST[s].vol), S0=stocks.map(s=>ST[s].S0), r=0.05;
  const paths=[];
  for(let p=0;p<nP;p++){
    const path=stocks.map((_,i)=>{const a=new Float64Array(totalSteps+1);a[0]=S0[i];return a;});
    for(let t=0;t<totalSteps;t++){
      const z=[];for(let i=0;i<n;i++)z.push(randn());
      const w=new Float64Array(n);for(let i=0;i<n;i++)for(let j=0;j<=i;j++)w[i]+=L[i][j]*z[j];
      for(let i=0;i<n;i++)path[i][t+1]=path[i][t]*Math.exp((r-0.5*vols[i]**2)*dt+vols[i]*sq*w[i]);
    }
    paths.push(path);
  }
  return paths;
}

// ============================================================
// SIMULATION with configurable hedge frequency & threshold
// ============================================================
// hedgeMode: 'time' (fixed frequency) or 'threshold' (delta-based)
// hedgeFreqDays: for 'time' mode — hedge every N days (0.5 = 2x/day)
// deltaThresh: for 'threshold' mode — rebalance when |delta_change| > thresh
// stepsPerDay: simulation granularity (2 = twice daily price updates)
function simPath(path, stocks, cfg) {
  const { ki, cb, acStart, acSD, cpnPerQ, mem,
    seniorDep, juniorRatio, eulerAPY, fundingAPY, rf, nQ,
    hedgeMode, hedgeFreqDays, deltaThresh, stepsPerDay } = cfg;

  const n = stocks.length;
  const S0 = stocks.map(s => ST[s].S0);
  const vols = stocks.map(s => ST[s].vol);
  const juniorDep = seniorDep * juniorRatio;
  const poolSize = seniorDep + juniorDep;
  const T = nQ * 0.25; // in years
  const tradingDaysPerYear = 252;
  const totalDays = T * tradingDaysPerYear;
  const totalSteps = Math.round(totalDays * stepsPerDay);
  const dt = T / totalSteps;
  const stepsPerQ = Math.round(totalSteps / nQ);

  // Hedge frequency in steps
  const hedgeEverySteps = hedgeMode === 'time'
    ? Math.max(1, Math.round(hedgeFreqDays * stepsPerDay))
    : 1; // threshold mode: check every step

  let cash = poolSize * 0.998; // after protocol fee
  const initialCash = cash;

  // Per-stock hedge tracking
  let shares = new Float64Array(n);       // current shares held
  let costBasis = new Float64Array(n);    // total cost basis for held shares
  let currentDelta = new Float64Array(n); // current delta target

  let knockedIn = false;
  let totalCpnPaid = 0, missedCpn = 0;
  let tradeCount = 0;
  let yldEuler = 0, yldFunding = 0;

  // Gamma scalping tracking
  let gammaPnL = 0;      // realized PnL from hedge rebalancing
  let totalBought = 0;   // total $ spent buying shares
  let totalSold = 0;     // total $ received selling shares

  // Helper: compute target delta for stock i
  function targetDelta(i, S, ttm) {
    if (ttm <= 0.001) return 0;
    const barrier = ki * S0[i];
    let d;
    if (knockedIn && S / S0[i] < 1.0) {
      d = Math.min(0.5 + (1 - S / S0[i]) * 2.5, 1.0);
    } else {
      d = Math.abs(diPutDelta(S, S0[i], barrier, ttm, rf, vols[i]));
      d = Math.max(0, Math.min(d, 0.95));
      if (S / S0[i] > 1.15) d *= 0.5;
      if (S / S0[i] > 1.3) d = 0;
    }
    return d;
  }

  // Helper: rebalance hedge for stock i
  function rebalance(i, S, ttm) {
    const notionalShares = seniorDep / n / S0[i]; // max shares to hedge
    const tgtD = targetDelta(i, S, ttm);
    const tgtShares = tgtD * notionalShares;
    const diff = tgtShares - shares[i];

    // Check if rebalance needed
    if (hedgeMode === 'threshold') {
      if (Math.abs(tgtD - currentDelta[i]) <= deltaThresh) return;
    }

    if (Math.abs(diff * S) < 20) return; // min trade size

    if (diff > 0) {
      // BUY shares
      const cost = diff * S;
      cash -= cost;
      costBasis[i] += cost;
      totalBought += cost;
    } else {
      // SELL shares — realize PnL
      const sharesToSell = Math.abs(diff);
      const saleValue = sharesToSell * S;
      // Proportional cost basis
      const basisPer = shares[i] > 0.001 ? costBasis[i] / shares[i] : S;
      const costOfSold = sharesToSell * basisPer;
      const realizedPnL = saleValue - costOfSold;

      cash += saleValue;
      costBasis[i] -= costOfSold;
      totalSold += saleValue;
      gammaPnL += realizedPnL;
    }

    shares[i] = tgtShares;
    currentDelta[i] = tgtD;
    tradeCount++;
  }

  // Initial hedge
  for (let i = 0; i < n; i++) {
    const tgtD = targetDelta(i, S0[i], T);
    if (tgtD > 0.001) {
      const notSh = seniorDep / n / S0[i];
      const tgt = tgtD * notSh;
      const cost = tgt * S0[i];
      shares[i] = tgt;
      costBasis[i] = cost;
      currentDelta[i] = tgtD;
      cash -= cost;
      totalBought += cost;
      tradeCount++;
    }
  }

  for (let step = 1; step <= totalSteps; step++) {
    const curT = step * dt;
    const ttm = Math.max(T - curT, 0.001);
    const qNum = Math.floor(curT / 0.25) + 1;
    const isQEnd = Math.abs(curT - qNum * 0.25) < dt * 0.6 && qNum <= nQ;
    const isLast = step === totalSteps;
    const prices = stocks.map((_, i) => path[i][step]);
    const perfs = prices.map((p, i) => p / S0[i]);
    const worstPerf = Math.min(...perfs);

    // Euler yield on cash (accrues every step)
    if (cash > 0) {
      const y = cash * eulerAPY * dt;
      cash += y;
      yldEuler += y;
    }

    // Funding rate on hedge notional
    if (fundingAPY > 0) {
      let hedgeNot = 0;
      for (let i = 0; i < n; i++) hedgeNot += shares[i] * prices[i];
      if (hedgeNot > 0) {
        const fy = hedgeNot * fundingAPY * dt;
        cash += fy;
        yldFunding += fy;
      }
    }

    // KI check
    if (worstPerf <= ki) knockedIn = true;

    // Quarterly events
    if (isQEnd && qNum <= nQ) {
      const acBar = Math.max(acStart - acSD * (qNum - 1), 0.80);

      if (perfs.every(p => p >= acBar)) {
        // Autocall — pay coupon + unwind
        let cpn = cpnPerQ * seniorDep;
        totalCpnPaid += cpn;
        if (mem && missedCpn > 0) { totalCpnPaid += missedCpn; missedCpn = 0; }

        // Unwind all hedge positions
        for (let i = 0; i < n; i++) {
          if (shares[i] > 0.001) {
            const saleVal = shares[i] * prices[i];
            const realPnL = saleVal - costBasis[i];
            cash += saleVal;
            totalSold += saleVal;
            gammaPnL += realPnL;
            shares[i] = 0; costBasis[i] = 0; currentDelta[i] = 0;
            tradeCount++;
          }
        }

        const srPay = seniorDep + totalCpnPaid;
        const jrPay = Math.max(cash - srPay, 0);
        return { out:'AC', q:qNum, dur:curT,
          srRet: totalCpnPaid / seniorDep,
          jrRet: (jrPay - juniorDep) / juniorDep,
          wp:worstPerf, ki:false, tradeCount,
          yldEuler, yldFunding, gammaPnL,
          totalCpnPaid, kiLoss:0,
          totalBought, totalSold,
        };
      }

      // Coupon check
      if (worstPerf >= cb) {
        let cpn = cpnPerQ * seniorDep;
        totalCpnPaid += cpn;
        if (mem && missedCpn > 0) { totalCpnPaid += missedCpn; missedCpn = 0; }
        cash -= cpn;
      } else if (mem) {
        missedCpn += cpnPerQ * seniorDep;
      }
    }

    // HEDGE REBALANCING
    const shouldHedge = !isLast && (
      hedgeMode === 'threshold' || // threshold: check every step
      (hedgeMode === 'time' && step % hedgeEverySteps === 0)
    );

    if (shouldHedge) {
      for (let i = 0; i < n; i++) {
        rebalance(i, prices[i], ttm);
      }
    }

    // MATURITY
    if (isLast) {
      // Unwind all hedge
      for (let i = 0; i < n; i++) {
        if (shares[i] > 0.001) {
          const saleVal = shares[i] * prices[i];
          const realPnL = saleVal - costBasis[i];
          cash += saleVal;
          totalSold += saleVal;
          gammaPnL += realPnL;
          shares[i] = 0; costBasis[i] = 0;
          tradeCount++;
        }
      }

      if (knockedIn && worstPerf < 1.0) {
        const loss = seniorDep * (1 - worstPerf);
        const jrAbsorbs = Math.min(loss, juniorDep);
        const srPrincipal = seniorDep - Math.max(loss - juniorDep, 0);
        const jrPay = Math.max(cash - srPrincipal, 0);
        return { out:'KI', q:nQ, dur:T,
          srRet: (srPrincipal + totalCpnPaid - seniorDep) / seniorDep,
          jrRet: (jrPay - juniorDep) / juniorDep,
          wp:worstPerf, ki:true, tradeCount,
          yldEuler, yldFunding, gammaPnL,
          totalCpnPaid, kiLoss:loss,
          totalBought, totalSold,
        };
      } else {
        const jrPay = Math.max(cash - seniorDep, 0);
        return { out:'MAT', q:nQ, dur:T,
          srRet: totalCpnPaid / seniorDep,
          jrRet: (jrPay - juniorDep) / juniorDep,
          wp:worstPerf, ki:false, tradeCount,
          yldEuler, yldFunding, gammaPnL,
          totalCpnPaid, kiLoss:0,
          totalBought, totalSold,
        };
      }
    }
  }
}

function runMC(stocks, cfg, nP) {
  const T = cfg.nQ * 0.25;
  const tradingDays = T * 252;
  const totalSteps = Math.round(tradingDays * cfg.stepsPerDay);
  const paths = genPaths(stocks, nP, T, totalSteps);
  return paths.map(p => simPath(p, stocks, cfg)).filter(Boolean);
}

function stats(R) {
  const N = R.length;
  const sr = R.map(r => r.srRet).sort((a,b) => a-b);
  const jr = R.map(r => r.jrRet).sort((a,b) => a-b);
  const pct = (a,p) => a[Math.min(Math.floor(a.length*p/100), a.length-1)];
  const mean = a => a.reduce((x,y) => x+y, 0) / a.length;
  const avgDur = mean(R.map(r => r.dur));
  return {
    sm: mean(sr), sMed: pct(sr,50), sP5: pct(sr,5), sP95: pct(sr,95),
    sWin: sr.filter(r => r >= 0).length / N,
    sAnn: avgDur > 0 ? mean(sr) / avgDur : 0,
    jm: mean(jr), jMed: pct(jr,50), jP5: pct(jr,5), jP95: pct(jr,95),
    jWin: jr.filter(r => r >= 0).length / N,
    jAnn: avgDur > 0 ? mean(jr) / avgDur : 0,
    acR: R.filter(r => r.out === 'AC').length / N,
    kiR: R.filter(r => r.ki).length / N,
    avgDur,
    avgEuler: mean(R.map(r => r.yldEuler)),
    avgFunding: mean(R.map(r => r.yldFunding)),
    avgGammaPnL: mean(R.map(r => r.gammaPnL)),
    avgCpnPaid: mean(R.map(r => r.totalCpnPaid)),
    avgKiLoss: mean(R.map(r => r.kiLoss)),
    avgTrades: mean(R.map(r => r.tradeCount)),
    avgBought: mean(R.map(r => r.totalBought)),
    avgSold: mean(R.map(r => r.totalSold)),
    // Gamma PnL distribution
    gammaPnLs: R.map(r => r.gammaPnL).sort((a,b) => a-b),
  };
}

const f = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const $ = v => `$${v >= 0 ? '+' : ''}${v.toFixed(0)}`;
const $$ = v => `$${v.toFixed(0).padStart(6)}`;

console.log('█'.repeat(120));
console.log('█  xYIELD v15 — ADVANCED HEDGING ENGINE');
console.log('█  Gamma scalping | Configurable frequency | Delta threshold hedging');
console.log('█  Goal: transform hedge from COST CENTER → PROFIT CENTER');
console.log('█'.repeat(120));

// ============================================================
// PART 1: HEDGE FREQUENCY COMPARISON
// Same structure, different hedge frequencies
// ============================================================
console.log('\n' + '▓'.repeat(120));
console.log('▓  PART 1: HEDGE FREQUENCY — Impact on gamma PnL');
console.log('▓  Fixed structure: NVDA/TSLA/COIN, KI 40%, AC 100%, 9mo, Cpn 5%/Q');
console.log('▓'.repeat(120));

const testStocks = ['NVDAx', 'TSLAx', 'COINx'];
const testBaseCfg = {
  ki: 0.40, cb: 0.60, acStart: 1.00, acSD: 0.025,
  cpnPerQ: 0.05, mem: true, seniorDep: 10000, juniorRatio: 0.30,
  eulerAPY: 0, fundingAPY: 0, rf: 0.05, nQ: 3,
};

const N1 = 3000;

// Time-based hedging at different frequencies
const frequencies = [
  { label: 'Continuous (2x/day)', freqDays: 0.5, spd: 2 },
  { label: 'Daily',               freqDays: 1,   spd: 2 },
  { label: 'Every 2 days',        freqDays: 2,   spd: 2 },
  { label: 'Every 3 days',        freqDays: 3,   spd: 1 },
  { label: 'Weekly',              freqDays: 5,   spd: 1 },
  { label: 'Biweekly (v14)',      freqDays: 10,  spd: 1 },
];

console.log('\n  TIME-BASED HEDGING (no Euler, no funding — isolate hedge effect):');
console.log('  ' + 'Frequency'.padEnd(24) +
  'GammaPnL'.padStart(10) + 'GammaAnn'.padStart(10) +
  '  Trades'.padStart(8) +
  '  SrAnn'.padStart(8) + '  JrAnn'.padStart(8) +
  '  SrWin'.padStart(7) + '  JrWin'.padStart(7) +
  '  KI%'.padStart(7) + '  AC%'.padStart(6) +
  '  GammaP5'.padStart(10) + '  GammaP50'.padStart(11) + '  GammaP95'.padStart(11));
console.log('  ' + '─'.repeat(130));

const freqResults = [];
for (const freq of frequencies) {
  process.stdout.write(`  Running ${freq.label}...`);
  const R = runMC(testStocks, {
    ...testBaseCfg,
    hedgeMode: 'time', hedgeFreqDays: freq.freqDays, deltaThresh: 0,
    stepsPerDay: freq.spd,
  }, N1);
  const s = stats(R);
  freqResults.push({ ...freq, ...s });

  const gammaAnn = s.avgGammaPnL / 10000 / s.avgDur;
  const gp5 = s.gammaPnLs[Math.floor(N1 * 0.05)];
  const gp50 = s.gammaPnLs[Math.floor(N1 * 0.50)];
  const gp95 = s.gammaPnLs[Math.floor(N1 * 0.95)];

  console.log('\r  ' +
    freq.label.padEnd(24) +
    $(s.avgGammaPnL).padStart(10) +
    f(gammaAnn).padStart(10) +
    `${s.avgTrades.toFixed(0)}`.padStart(8) +
    f(s.sAnn).padStart(8) +
    f(s.jAnn).padStart(8) +
    `${(s.sWin*100).toFixed(0)}%`.padStart(7) +
    `${(s.jWin*100).toFixed(0)}%`.padStart(7) +
    `${(s.kiR*100).toFixed(1)}%`.padStart(7) +
    `${(s.acR*100).toFixed(0)}%`.padStart(6) +
    $(gp5).padStart(10) +
    $(gp50).padStart(11) +
    $(gp95).padStart(11)
  );
}

// ============================================================
// PART 2: DELTA THRESHOLD HEDGING
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 2: DELTA THRESHOLD HEDGING — Rebalance when |Δdelta| > threshold');
console.log('▓  Same structure, stepsPerDay=2 (granular price updates)');
console.log('▓'.repeat(120));

const thresholds = [0.01, 0.02, 0.03, 0.05, 0.08, 0.10, 0.15];

console.log('\n  THRESHOLD-BASED HEDGING:');
console.log('  ' + 'Threshold'.padEnd(12) +
  'GammaPnL'.padStart(10) + 'GammaAnn'.padStart(10) +
  '  Trades'.padStart(8) +
  '  SrAnn'.padStart(8) + '  JrAnn'.padStart(8) +
  '  SrWin'.padStart(7) + '  JrWin'.padStart(7) +
  '  KI%'.padStart(7) +
  '  GammaP5'.padStart(10) + '  GammaP50'.padStart(11) + '  GammaP95'.padStart(11));
console.log('  ' + '─'.repeat(120));

const threshResults = [];
for (const th of thresholds) {
  process.stdout.write(`  Running threshold ${th}...`);
  const R = runMC(testStocks, {
    ...testBaseCfg,
    hedgeMode: 'threshold', hedgeFreqDays: 0, deltaThresh: th,
    stepsPerDay: 2,
  }, N1);
  const s = stats(R);
  threshResults.push({ th, ...s });

  const gammaAnn = s.avgGammaPnL / 10000 / s.avgDur;
  const gp5 = s.gammaPnLs[Math.floor(N1 * 0.05)];
  const gp50 = s.gammaPnLs[Math.floor(N1 * 0.50)];
  const gp95 = s.gammaPnLs[Math.floor(N1 * 0.95)];

  console.log('\r  ' +
    `Δ > ${th.toFixed(2)}`.padEnd(12) +
    $(s.avgGammaPnL).padStart(10) +
    f(gammaAnn).padStart(10) +
    `${s.avgTrades.toFixed(0)}`.padStart(8) +
    f(s.sAnn).padStart(8) +
    f(s.jAnn).padStart(8) +
    `${(s.sWin*100).toFixed(0)}%`.padStart(7) +
    `${(s.jWin*100).toFixed(0)}%`.padStart(7) +
    `${(s.kiR*100).toFixed(1)}%`.padStart(7) +
    $(gp5).padStart(10) +
    $(gp50).padStart(11) +
    $(gp95).padStart(11)
  );
}

// ============================================================
// PART 3: GAMMA SCALPING ACROSS BASKETS
// Best hedge settings from P1/P2, test across baskets
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 3: GAMMA PnL ACROSS BASKETS — Using optimal hedge settings');
console.log('▓  Higher vol basket → more gamma → more gamma PnL potential');
console.log('▓'.repeat(120));

const baskets = [
  { name:'NVDA/TSLA/AAPL',      stocks:['NVDAx','TSLAx','AAPLx'] },
  { name:'NVDA/TSLA/AMD',       stocks:['NVDAx','TSLAx','AMDx'] },
  { name:'NVDA/TSLA/META',      stocks:['NVDAx','TSLAx','METAx'] },
  { name:'NVDA/TSLA/COIN',      stocks:['NVDAx','TSLAx','COINx'] },
  { name:'NVDA/TSLA/MSTR',      stocks:['NVDAx','TSLAx','MSTRx'] },
  { name:'TSLA/COIN',           stocks:['TSLAx','COINx'] },
  { name:'TSLA/MSTR',           stocks:['TSLAx','MSTRx'] },
  { name:'NVDA/TSLA/COIN/MSTR', stocks:['NVDAx','TSLAx','COINx','MSTRx'] },
];

const N3 = 2000;
// Use daily hedging with threshold 0.03
const hedgeCfg = { hedgeMode: 'threshold', hedgeFreqDays: 0, deltaThresh: 0.03, stepsPerDay: 2 };

console.log('\n  GAMMA PnL BY BASKET (Euler=0, daily threshold hedge Δ>0.03):');
console.log('  ' + 'Basket'.padEnd(24) + 'AvgVol'.padEnd(7) + '#'.padEnd(2) +
  'GammaPnL'.padStart(10) + 'GammaAnn'.padStart(10) +
  '  Trades'.padStart(8) +
  '  KI%'.padStart(7) + '  AC%'.padStart(6) +
  '  GammaP5'.padStart(10) + '  GammaP50'.padStart(11) + '  GammaP95'.padStart(11));
console.log('  ' + '─'.repeat(110));

const basketResults = [];
for (const bkt of baskets) {
  const avgVol = bkt.stocks.reduce((s,st) => s + ST[st].vol, 0) / bkt.stocks.length;
  process.stdout.write(`  Running ${bkt.name}...`);
  const R = runMC(bkt.stocks, {
    ...testBaseCfg, ...hedgeCfg,
    cpnPerQ: 0.05,
  }, N3);
  const s = stats(R);
  basketResults.push({ ...bkt, avgVol, ...s });

  const gammaAnn = s.avgGammaPnL / 10000 / s.avgDur;
  const gp5 = s.gammaPnLs[Math.floor(N3 * 0.05)];
  const gp50 = s.gammaPnLs[Math.floor(N3 * 0.50)];
  const gp95 = s.gammaPnLs[Math.floor(N3 * 0.95)];

  console.log('\r  ' +
    bkt.name.padEnd(24) +
    `${(avgVol*100).toFixed(0)}%`.padEnd(7) +
    `${bkt.stocks.length}`.padEnd(2) +
    $(s.avgGammaPnL).padStart(10) +
    f(gammaAnn).padStart(10) +
    `${s.avgTrades.toFixed(0)}`.padStart(8) +
    `${(s.kiR*100).toFixed(1)}%`.padStart(7) +
    `${(s.acR*100).toFixed(0)}%`.padStart(6) +
    $(gp5).padStart(10) +
    $(gp50).padStart(11) +
    $(gp95).padStart(11)
  );
}

// ============================================================
// PART 4: FULL YIELD DECOMPOSITION — All sources stacked
// Best hedge + Euler + Funding
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 4: FULL YIELD DECOMPOSITION — All yield sources stacked');
console.log('▓  Optimal hedge + Euler 12% + Funding 5%');
console.log('▓'.repeat(120));

const P4_baskets = [
  { name:'NVDA/TSLA/AAPL',      stocks:['NVDAx','TSLAx','AAPLx'] },
  { name:'NVDA/TSLA/COIN',      stocks:['NVDAx','TSLAx','COINx'] },
  { name:'NVDA/TSLA/MSTR',      stocks:['NVDAx','TSLAx','MSTRx'] },
  { name:'NVDA/TSLA/COIN/MSTR', stocks:['NVDAx','TSLAx','COINx','MSTRx'] },
];

const P4_configs = [
  { ki: 0.40, ac: 1.00, nQ: 3, mat: '9mo' },
  { ki: 0.40, ac: 1.05, nQ: 3, mat: '9mo' },
  { ki: 0.45, ac: 1.00, nQ: 4, mat: '12mo' },
  { ki: 0.45, ac: 1.05, nQ: 4, mat: '12mo' },
];
const P4_cpns = [0.04, 0.06, 0.08];
const P4_jrs = [0.20, 0.30];
const N4 = 2000;

console.log(`\n  Running ${P4_baskets.length * P4_configs.length * P4_cpns.length * P4_jrs.length} configs...`);

const allP4 = [];
let p4cnt = 0;
const p4tot = P4_baskets.length * P4_configs.length * P4_cpns.length * P4_jrs.length;

for (const bkt of P4_baskets) {
  for (const cfg of P4_configs) {
    for (const cpn of P4_cpns) {
      for (const jr of P4_jrs) {
        p4cnt++;
        if (p4cnt % 10 === 0) process.stdout.write(`\r  Running ${p4cnt}/${p4tot}...`);

        const R = runMC(bkt.stocks, {
          ki: cfg.ki, cb: 0.60, acStart: cfg.ac, acSD: 0.025,
          cpnPerQ: cpn, mem: true, seniorDep: 10000, juniorRatio: jr,
          eulerAPY: 0.12, fundingAPY: 0.05, rf: 0.05, nQ: cfg.nQ,
          hedgeMode: 'threshold', hedgeFreqDays: 0, deltaThresh: 0.03,
          stepsPerDay: 2,
        }, N4);
        const s = stats(R);

        allP4.push({
          bkt: bkt.name, stocks: bkt.stocks,
          ki: cfg.ki, ac: cfg.ac, mat: cfg.mat, nQ: cfg.nQ,
          cpn, jr, ...s,
        });
      }
    }
  }
}

console.log(`\r  Done: ${p4tot} configs\n`);

// Show yield decomposition table
console.log('  YIELD DECOMPOSITION TABLE:');
console.log('  ' + 'Basket'.padEnd(24) + 'KI'.padEnd(5) + 'AC'.padEnd(6) + 'Mat'.padEnd(5) +
  'Cpn'.padEnd(5) + 'Jr'.padEnd(5) +
  '│ $OptPrem'.padStart(10) + ' $Euler'.padStart(8) + ' $Gamma'.padStart(8) + ' $Fund'.padStart(7) + ' $KI'.padStart(7) +
  ' │ SrAnn'.padStart(8) + ' JrAnn'.padStart(7) + ' SrW'.padStart(5) + ' JrW'.padStart(5) +
  ' │ Gamma%');
console.log('  ' + '─'.repeat(130));

// Sort by combined Sr+Jr APY
allP4.sort((a, b) => {
  const sa = (a.sAnn > 0 ? a.sAnn : 0) + (a.jAnn > 0 ? a.jAnn : 0) + a.sWin * 0.1;
  const sb = (b.sAnn > 0 ? b.sAnn : 0) + (b.jAnn > 0 ? b.jAnn : 0) + b.sWin * 0.1;
  return sb - sa;
});

for (const r of allP4.slice(0, 40)) {
  const totalIncome = Math.abs(r.avgCpnPaid) + Math.abs(r.avgEuler) + Math.abs(r.avgGammaPnL) + Math.abs(r.avgFunding);
  const gammaShare = totalIncome > 0 ? (r.avgGammaPnL / totalIncome * 100) : 0;
  console.log('  ' +
    r.bkt.padEnd(24) +
    `${(r.ki*100).toFixed(0)}%`.padEnd(5) +
    `${(r.ac*100).toFixed(0)}%`.padEnd(6) +
    r.mat.padEnd(5) +
    `${(r.cpn*100).toFixed(0)}%`.padEnd(5) +
    `${(r.jr*100).toFixed(0)}%`.padEnd(5) +
    `│ ${$$(r.avgCpnPaid)}` +
    ` ${$$(r.avgEuler)}` +
    ` ${$$(r.avgGammaPnL)}` +
    ` ${$$(r.avgFunding)}` +
    ` ${$$(r.avgKiLoss)}` +
    ` │ ${f(r.sAnn).padStart(7)}` +
    ` ${f(r.jAnn).padStart(6)}` +
    ` ${(r.sWin*100).toFixed(0)}%`.padStart(5) +
    ` ${(r.jWin*100).toFixed(0)}%`.padStart(5) +
    ` │ ${gammaShare >= 0 ? '+' : ''}${gammaShare.toFixed(0)}%`
  );
}

// ============================================================
// PART 5: DEEP DIVE — Best structure with 8,000 paths
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 5: DEEP DIVE — Top 3 structures with 8,000 paths');
console.log('▓'.repeat(120));

const top3 = allP4.filter(r => r.sAnn > 0 && r.jAnn > 0).slice(0, 3);

for (let i = 0; i < top3.length; i++) {
  const b = top3[i];
  process.stdout.write(`\n  #${i+1}: ${b.bkt}...`);
  const R = runMC(b.stocks, {
    ki:b.ki, cb:0.60, acStart:b.ac, acSD:0.025,
    cpnPerQ:b.cpn, mem:true, seniorDep:10000, juniorRatio:b.jr,
    eulerAPY:0.12, fundingAPY:0.05, rf:0.05, nQ:b.nQ,
    hedgeMode:'threshold', hedgeFreqDays:0, deltaThresh:0.03,
    stepsPerDay:2,
  }, 8000);
  const ds = stats(R);
  console.log(' done');

  const lev = ((1+b.jr)/b.jr).toFixed(1);
  const dur = ds.avgDur;
  const optAnn = ds.avgCpnPaid / 10000 / dur;
  const eulerAnn = ds.avgEuler / 10000 / dur;
  const gammaAnn = ds.avgGammaPnL / 10000 / dur;
  const fundAnn = ds.avgFunding / 10000 / dur;
  const totalIncome = ds.avgCpnPaid + ds.avgEuler + ds.avgGammaPnL + ds.avgFunding;
  const totalIncomeAnn = totalIncome / 10000 / dur;
  const gammaShare = totalIncome > 0 ? (ds.avgGammaPnL / totalIncome * 100) : 0;
  const optShare = totalIncome > 0 ? (ds.avgCpnPaid / totalIncome * 100) : 0;

  console.log(`
  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #${i+1} ${b.bkt.padEnd(24)} KI:${(b.ki*100).toFixed(0)}% AC:${(b.ac*100).toFixed(0)}% Cpn:${(b.cpn*100).toFixed(0)}%/Q Jr:${(b.jr*100).toFixed(0)}%(${lev}x) ${b.mat} E:12% F:5%    │
  ├──────────────────────────────────────────────────────────────────────────────────────────────┤
  │  SENIOR (retail)     APY: ${f(ds.sAnn).padStart(7)}   Win: ${(ds.sWin*100).toFixed(1)}%   Med: ${f(ds.sMed).padStart(7)}   P5: ${f(ds.sP5).padStart(7)}       │
  │  JUNIOR (whale/DAO)  APY: ${f(ds.jAnn).padStart(7)}   Win: ${(ds.jWin*100).toFixed(1)}%   Med: ${f(ds.jMed).padStart(7)}   P5: ${f(ds.jP5).padStart(7)}       │
  ├──────────────────────────────────────────────────────────────────────────────────────────────┤
  │  YIELD SOURCE DECOMPOSITION (per $10k Senior note):                                         │
  │  ┌─────────────────────────────────────────────────────────────────────────────┐             │
  │  │  Source              │    $/note   │  Ann %  │  Share  │                    │             │
  │  │──────────────────────│────────────│─────────│─────────│                    │             │
  │  │  Option premium      │ ${$$(ds.avgCpnPaid)}     │ ${f(optAnn).padStart(7)}  │  ${optShare.toFixed(0).padStart(4)}%   │ ← primary              │             │
  │  │  Euler yield         │ ${$$(ds.avgEuler)}     │ ${f(eulerAnn).padStart(7)}  │  ${(eulerAnn/totalIncomeAnn*100).toFixed(0).padStart(4)}%   │ ← secondary            │             │
  │  │  Gamma scalping PnL  │ ${$$(ds.avgGammaPnL)}     │ ${f(gammaAnn).padStart(7)}  │  ${gammaShare.toFixed(0).padStart(4)}%   │ ← hedge profit          │             │
  │  │  Funding rate        │ ${$$(ds.avgFunding)}     │ ${f(fundAnn).padStart(7)}  │  ${(fundAnn/totalIncomeAnn*100).toFixed(0).padStart(4)}%   │ ← bonus                │             │
  │  │──────────────────────│────────────│─────────│─────────│                    │             │
  │  │  Total income        │ ${$$(totalIncome)}     │ ${f(totalIncomeAnn).padStart(7)}  │  100%   │                    │             │
  │  │  KI losses           │ ${$$(ds.avgKiLoss)}     │         │         │ ← tail risk             │             │
  │  └─────────────────────────────────────────────────────────────────────────────┘             │
  │                                                                                              │
  │  STRUCTURE: AC ${(ds.acR*100).toFixed(0)}%   MAT ${((1-ds.acR-ds.kiR)*100).toFixed(0)}%   KI ${(ds.kiR*100).toFixed(1)}%   Avg ${(dur*12).toFixed(1)}mo   ${ds.avgTrades.toFixed(0)} trades                     │
  └──────────────────────────────────────────────────────────────────────────────────────────────┘`);
}

console.log('\n\n' + '█'.repeat(120));
console.log('█  v15 COMPLETE — Hedging engine upgraded');
console.log('█'.repeat(120) + '\n');
