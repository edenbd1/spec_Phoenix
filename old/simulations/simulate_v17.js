#!/usr/bin/env node
// ============================================================
// xYield v17 — FIXED WATERFALL + CORRECT HEDGE DIRECTION
//
// FIXES FROM v16:
// 1. AC WATERFALL: Fixed coupon double-counting at autocall exit
//    - v16 bug: coupons paid during life were deducted from cash
//      AND included in srPay → Junior paid for them twice
//    - Fix: at AC, deduct AC coupon from cash, then srPay = seniorDep
//
// 2. HEDGE DIRECTION: Pool is SHORT a put (KI obligation)
//    - To hedge: SHORT the underlying (negative delta)
//    - v16 bug: code BOUGHT shares (positive delta), doubling risk
//    - Fix: hedge is now a short position (perp short)
//    - Gamma PnL from selling high/buying low on rebalance
//
// KEPT FROM v16:
// - Worst-of delta concentration (alpha=8)
// - Coupon barrier 40-45%
// - KI loss deducted from pool cash before waterfall
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
// WORST-OF AWARE DELTA MODEL (from v16)
// Hedge concentrates on worst performer via exponential weighting
// ============================================================
function worstOfDeltas(stocks, prices, S0, vols, ki, ttm, rf, knockedIn) {
  const n = stocks.length;
  const perfs = prices.map((p, i) => p / S0[i]);
  const worstPerf = Math.min(...perfs);
  const deltas = new Float64Array(n);
  const alpha = 8.0;

  for (let i = 0; i < n; i++) {
    let baseDelta;
    if (knockedIn && perfs[i] < 1.0) {
      baseDelta = Math.min(0.5 + (1 - perfs[i]) * 2.5, 1.0);
    } else if (ttm <= 0.001) {
      baseDelta = 0;
    } else {
      baseDelta = Math.abs(diPutDelta(prices[i], S0[i], ki * S0[i], ttm, rf, vols[i]));
      baseDelta = Math.max(0, Math.min(baseDelta, 0.95));
      if (perfs[i] > 1.15) baseDelta *= 0.5;
      if (perfs[i] > 1.3) baseDelta = 0;
    }
    const gap = perfs[i] - worstPerf;
    const weight = Math.exp(-alpha * gap);
    deltas[i] = baseDelta * weight;
  }
  return deltas;
}

// ============================================================
// SIMULATION ENGINE v17
// - Fixed AC waterfall (no coupon double-counting)
// - Correct hedge direction (SHORT shares to hedge short put)
// ============================================================
function simPath(path, stocks, cfg) {
  const { ki, cb, acStart, acSD, cpnPerQ, mem,
    seniorDep, juniorRatio, eulerAPY, fundingAPY, rf, nQ,
    deltaThresh, stepsPerDay } = cfg;

  const n = stocks.length;
  const S0 = stocks.map(s => ST[s].S0);
  const vols = stocks.map(s => ST[s].vol);
  const juniorDep = seniorDep * juniorRatio;
  const poolSize = seniorDep + juniorDep;
  const T = nQ * 0.25;
  const totalDays = T * 252;
  const totalSteps = Math.round(totalDays * stepsPerDay);
  const dt = T / totalSteps;

  let cash = poolSize * 0.998; // 0.2% entry fee
  // SHORT hedge: shares[i] > 0 means SHORT that many shares
  // When stock drops, short profits. When stock rises, short loses.
  let shortShares = new Float64Array(n);
  let shortEntryPrice = new Float64Array(n); // avg entry price of short
  let currentDelta = new Float64Array(n);
  let knockedIn = false;
  let totalCpnPaid = 0, missedCpn = 0;
  let tradeCount = 0;
  let yldEuler = 0, yldFunding = 0, gammaPnL = 0;
  let cpnPayments = 0;

  // SHORT hedge rebalancing
  // Short more shares = increase hedge; cover (buy back) = decrease hedge
  function rebalance(targetDeltas, prices) {
    for (let i = 0; i < n; i++) {
      const tgtD = targetDeltas[i];
      if (Math.abs(tgtD - currentDelta[i]) <= deltaThresh) continue;

      const notSh = seniorDep / n / S0[i]; // notional in shares
      const tgtShort = tgtD * notSh; // target short shares
      const diff = tgtShort - shortShares[i]; // positive = short more, negative = cover

      if (Math.abs(diff * prices[i]) < 20) continue;

      if (diff > 0) {
        // SHORT MORE shares: receive cash now (open short via perp)
        // PnL realized when we cover later
        const entryVal = diff * prices[i];
        // Update weighted avg entry price
        const totalShort = shortShares[i] + diff;
        if (totalShort > 0.001) {
          shortEntryPrice[i] = (shortShares[i] * shortEntryPrice[i] + diff * prices[i]) / totalShort;
        }
        // No cash change on opening short (perp margin from pool)
      } else {
        // COVER (buy back) shares: realize PnL
        const sharesToCover = Math.abs(diff);
        const coverCost = sharesToCover * prices[i]; // cost to buy back
        const entryVal = sharesToCover * shortEntryPrice[i]; // what we sold them for
        const pnl = entryVal - coverCost; // positive if stock dropped (short profit!)
        gammaPnL += pnl;
        cash += pnl; // realize the PnL
      }
      shortShares[i] = tgtShort;
      currentDelta[i] = tgtD;
      tradeCount++;
    }
  }

  // Unwind all short positions and realize PnL
  function unwindHedge(prices) {
    for (let i = 0; i < n; i++) {
      if (shortShares[i] > 0.001) {
        const coverCost = shortShares[i] * prices[i];
        const entryVal = shortShares[i] * shortEntryPrice[i];
        const pnl = entryVal - coverCost; // short PnL
        gammaPnL += pnl;
        cash += pnl;
        shortShares[i] = 0;
        shortEntryPrice[i] = 0;
        currentDelta[i] = 0;
        tradeCount++;
      }
    }
  }

  // Initial hedge (open short positions)
  const initDeltas = worstOfDeltas(stocks, S0, S0, vols, ki, T, rf, false);
  for (let i = 0; i < n; i++) {
    if (initDeltas[i] > 0.001) {
      const notSh = seniorDep / n / S0[i];
      shortShares[i] = initDeltas[i] * notSh;
      shortEntryPrice[i] = S0[i];
      currentDelta[i] = initDeltas[i];
      tradeCount++;
    }
  }

  for (let step = 1; step <= totalSteps; step++) {
    const curT = step * dt;
    const ttm = Math.max(T - curT, 0.001);
    const qNum = Math.floor(curT / 0.25 + 0.001) + 1;
    const prevQNum = Math.floor((curT - dt) / 0.25 + 0.001) + 1;
    const isQEnd = qNum > prevQNum && qNum <= nQ + 1 && step > 1;
    const actualQ = qNum - 1;
    const isLast = step === totalSteps;
    const prices = stocks.map((_, i) => path[i][step]);
    const perfs = prices.map((p, i) => p / S0[i]);
    const worstPerf = Math.min(...perfs);

    // Euler yield on pool cash
    if (cash > 0) {
      const y = cash * eulerAPY * dt;
      cash += y;
      yldEuler += y;
    }

    // Funding rate on SHORT hedge notional (shorting earns funding in crypto)
    if (fundingAPY > 0) {
      let hedgeNot = 0;
      for (let i = 0; i < n; i++) hedgeNot += shortShares[i] * prices[i];
      if (hedgeNot > 0) {
        const fy = hedgeNot * fundingAPY * dt;
        cash += fy;
        yldFunding += fy;
      }
    }

    if (worstPerf <= ki) knockedIn = true;

    // Quarterly events
    if (isQEnd && actualQ >= 1 && actualQ <= nQ) {
      const acBar = Math.max(acStart - acSD * (actualQ - 1), 0.80);

      // Autocall check (not at final quarter)
      if (actualQ < nQ && perfs.every(p => p >= acBar)) {
        // Pay final coupon from cash (FIX: deduct from cash like regular coupons)
        let cpn = cpnPerQ * seniorDep;
        totalCpnPaid += cpn;
        if (mem && missedCpn > 0) { totalCpnPaid += missedCpn; cpn += missedCpn; missedCpn = 0; }
        cash -= cpn; // FIX: deduct AC coupon from cash
        cpnPayments++;

        // Unwind hedge
        unwindHedge(prices);

        // FIX: Senior just gets principal back (coupons already paid from cash)
        const jrPay = Math.max(cash - seniorDep, 0);

        return { out:'AC', q:actualQ, dur:curT,
          srRet: totalCpnPaid / seniorDep,
          jrRet: (jrPay - juniorDep) / juniorDep,
          wp:worstPerf, ki:false, tradeCount, cpnPayments,
          yldEuler, yldFunding, gammaPnL,
          totalCpnPaid, kiLoss:0,
        };
      }

      // Coupon check
      if (worstPerf >= cb) {
        let cpn = cpnPerQ * seniorDep;
        totalCpnPaid += cpn;
        if (mem && missedCpn > 0) { totalCpnPaid += missedCpn; cpn += missedCpn; missedCpn = 0; }
        cash -= cpn;
        cpnPayments++;
      } else if (mem) {
        missedCpn += cpnPerQ * seniorDep;
      }
    }

    // Hedge rebalance
    if (!isLast) {
      const tgtDeltas = worstOfDeltas(stocks, prices, S0, vols, ki, ttm, rf, knockedIn);
      rebalance(tgtDeltas, prices);
    }

    // Maturity
    if (isLast) {
      unwindHedge(prices);

      if (knockedIn && worstPerf < 1.0) {
        const kiLoss = seniorDep * (1 - worstPerf);
        cash -= kiLoss; // pool pays KI obligation

        // Waterfall: Senior first, Junior residual
        const srPay = Math.max(Math.min(seniorDep, cash), 0);
        const jrPay = Math.max(cash - seniorDep, 0);

        return { out:'KI', q:nQ, dur:T,
          srRet: (srPay + totalCpnPaid - seniorDep) / seniorDep,
          jrRet: (jrPay - juniorDep) / juniorDep,
          wp:worstPerf, ki:true, tradeCount, cpnPayments,
          yldEuler, yldFunding, gammaPnL,
          totalCpnPaid, kiLoss,
        };
      } else {
        // Normal maturity
        const jrPay = Math.max(cash - seniorDep, 0);
        return { out:'MAT', q:nQ, dur:T,
          srRet: totalCpnPaid / seniorDep,
          jrRet: (jrPay - juniorDep) / juniorDep,
          wp:worstPerf, ki:false, tradeCount, cpnPayments,
          yldEuler, yldFunding, gammaPnL,
          totalCpnPaid, kiLoss:0,
        };
      }
    }
  }
}

function runMC(stocks, cfg, nP) {
  const T = cfg.nQ * 0.25;
  const totalSteps = Math.round(T * 252 * cfg.stepsPerDay);
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
    avgCpnPayments: mean(R.map(r => r.cpnPayments)),
    gammaPnLs: R.map(r => r.gammaPnL).sort((a,b) => a-b),
  };
}

const f = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const $ = v => `$${v >= 0 ? '' : '-'}${Math.abs(v).toFixed(0)}`;
const $$ = v => `$${(v >= 0 ? '+' : '-') + Math.abs(v).toFixed(0).padStart(5)}`;

console.log('█'.repeat(120));
console.log('█  xYIELD v17 — FIXED AC WATERFALL + CORRECT SHORT HEDGE');
console.log('█  No coupon double-counting | Short hedge (correct direction) | KI loss from pool');
console.log('█'.repeat(120));

// ============================================================
// PART 1: A/B TEST — v16 (long hedge + broken AC) vs v17 (short hedge + fixed AC)
// Same paths, same params, different mechanics
// ============================================================
console.log('\n' + '▓'.repeat(120));
console.log('▓  PART 1: v16 vs v17 MECHANICS — A/B on identical paths');
console.log('▓  Shows exact impact of the two bug fixes');
console.log('▓'.repeat(120));

// v16 simPath (with bugs) for comparison
function simPathV16(path, stocks, cfg) {
  const { ki, cb, acStart, acSD, cpnPerQ, mem,
    seniorDep, juniorRatio, eulerAPY, fundingAPY, rf, nQ,
    deltaThresh, stepsPerDay } = cfg;
  const n = stocks.length;
  const S0 = stocks.map(s => ST[s].S0);
  const vols = stocks.map(s => ST[s].vol);
  const juniorDep = seniorDep * juniorRatio;
  const poolSize = seniorDep + juniorDep;
  const T = nQ * 0.25;
  const totalSteps = Math.round(T * 252 * stepsPerDay);
  const dt = T / totalSteps;

  let cash = poolSize * 0.998;
  let shares = new Float64Array(n);
  let costBasis = new Float64Array(n);
  let currentDelta = new Float64Array(n);
  let knockedIn = false;
  let totalCpnPaid = 0, missedCpn = 0;
  let tradeCount = 0;
  let yldEuler = 0, yldFunding = 0, gammaPnL = 0;
  let cpnPayments = 0;

  function rebalance(targetDeltas, prices) {
    for (let i = 0; i < n; i++) {
      const tgtD = targetDeltas[i];
      if (Math.abs(tgtD - currentDelta[i]) <= deltaThresh) continue;
      const notSh = seniorDep / n / S0[i];
      const tgtShares = tgtD * notSh;
      const diff = tgtShares - shares[i];
      if (Math.abs(diff * prices[i]) < 20) continue;
      if (diff > 0) {
        cash -= diff * prices[i];
        costBasis[i] += diff * prices[i];
      } else {
        const sharesToSell = Math.abs(diff);
        const saleVal = sharesToSell * prices[i];
        const basisPer = shares[i] > 0.001 ? costBasis[i] / shares[i] : prices[i];
        const costOfSold = sharesToSell * basisPer;
        gammaPnL += saleVal - costOfSold;
        cash += saleVal;
        costBasis[i] -= costOfSold;
      }
      shares[i] = tgtShares;
      currentDelta[i] = tgtD;
      tradeCount++;
    }
  }

  const initDeltas = worstOfDeltas(stocks, S0, S0, vols, ki, T, rf, false);
  for (let i = 0; i < n; i++) {
    if (initDeltas[i] > 0.001) {
      const notSh = seniorDep / n / S0[i];
      shares[i] = initDeltas[i] * notSh;
      const cost = shares[i] * S0[i];
      cash -= cost;
      costBasis[i] = cost;
      currentDelta[i] = initDeltas[i];
      tradeCount++;
    }
  }

  for (let step = 1; step <= totalSteps; step++) {
    const curT = step * dt;
    const ttm = Math.max(T - curT, 0.001);
    const qNum = Math.floor(curT / 0.25 + 0.001) + 1;
    const prevQNum = Math.floor((curT - dt) / 0.25 + 0.001) + 1;
    const isQEnd = qNum > prevQNum && qNum <= nQ + 1 && step > 1;
    const actualQ = qNum - 1;
    const isLast = step === totalSteps;
    const prices = stocks.map((_, i) => path[i][step]);
    const perfs = prices.map((p, i) => p / S0[i]);
    const worstPerf = Math.min(...perfs);

    if (cash > 0) { const y = cash * eulerAPY * dt; cash += y; yldEuler += y; }
    if (fundingAPY > 0) {
      let hedgeNot = 0;
      for (let i = 0; i < n; i++) hedgeNot += shares[i] * prices[i];
      if (hedgeNot > 0) { const fy = hedgeNot * fundingAPY * dt; cash += fy; yldFunding += fy; }
    }
    if (worstPerf <= ki) knockedIn = true;

    if (isQEnd && actualQ >= 1 && actualQ <= nQ) {
      const acBar = Math.max(acStart - acSD * (actualQ - 1), 0.80);
      if (actualQ < nQ && perfs.every(p => p >= acBar)) {
        let cpn = cpnPerQ * seniorDep;
        totalCpnPaid += cpn;
        if (mem && missedCpn > 0) { totalCpnPaid += missedCpn; missedCpn = 0; }
        cpnPayments++;
        for (let i = 0; i < n; i++) {
          if (shares[i] > 0.001) {
            const saleVal = shares[i] * prices[i];
            gammaPnL += saleVal - costBasis[i];
            cash += saleVal;
            shares[i] = 0; costBasis[i] = 0; currentDelta[i] = 0;
            tradeCount++;
          }
        }
        // v16 BUG: srPay = seniorDep + totalCpnPaid (double-counts coupons)
        const srPay = seniorDep + totalCpnPaid;
        const jrPay = Math.max(cash - srPay, 0);
        return { out:'AC', q:actualQ, dur:curT,
          srRet: totalCpnPaid / seniorDep,
          jrRet: (jrPay - juniorDep) / juniorDep,
          wp:worstPerf, ki:false, tradeCount, cpnPayments,
          yldEuler, yldFunding, gammaPnL, totalCpnPaid, kiLoss:0,
        };
      }
      if (worstPerf >= cb) {
        let cpn = cpnPerQ * seniorDep;
        totalCpnPaid += cpn;
        if (mem && missedCpn > 0) { totalCpnPaid += missedCpn; missedCpn = 0; }
        cash -= cpn;
        cpnPayments++;
      } else if (mem) {
        missedCpn += cpnPerQ * seniorDep;
      }
    }

    if (!isLast) {
      const tgtDeltas = worstOfDeltas(stocks, prices, S0, vols, ki, ttm, rf, knockedIn);
      rebalance(tgtDeltas, prices);
    }

    if (isLast) {
      for (let i = 0; i < n; i++) {
        if (shares[i] > 0.001) {
          const saleVal = shares[i] * prices[i];
          gammaPnL += saleVal - costBasis[i];
          cash += saleVal;
          shares[i] = 0; costBasis[i] = 0;
          tradeCount++;
        }
      }
      if (knockedIn && worstPerf < 1.0) {
        const kiLoss = seniorDep * (1 - worstPerf);
        cash -= kiLoss;
        const srPay = Math.max(Math.min(seniorDep, cash), 0);
        const jrPay = Math.max(cash - seniorDep, 0);
        return { out:'KI', q:nQ, dur:T,
          srRet: (srPay + totalCpnPaid - seniorDep) / seniorDep,
          jrRet: (jrPay - juniorDep) / juniorDep,
          wp:worstPerf, ki:true, tradeCount, cpnPayments,
          yldEuler, yldFunding, gammaPnL, totalCpnPaid, kiLoss,
        };
      } else {
        const jrPay = Math.max(cash - seniorDep, 0);
        return { out:'MAT', q:nQ, dur:T,
          srRet: totalCpnPaid / seniorDep,
          jrRet: (jrPay - juniorDep) / juniorDep,
          wp:worstPerf, ki:false, tradeCount, cpnPayments,
          yldEuler, yldFunding, gammaPnL, totalCpnPaid, kiLoss:0,
        };
      }
    }
  }
}

// A/B test on same paths
const abBaskets = [
  { name:'NVDA/TSLA/AMD',  stocks:['NVDAx','TSLAx','AMDx'] },
  { name:'NVDA/TSLA/COIN', stocks:['NVDAx','TSLAx','COINx'] },
];
const abCfg = {
  ki:0.35, cb:0.45, acStart:1.00, acSD:0.025,
  cpnPerQ:0.04, mem:true, seniorDep:10000, juniorRatio:0.40,
  eulerAPY:0.12, fundingAPY:0.05, rf:0.05, nQ:2,
  deltaThresh:0.03, stepsPerDay:2,
};
const N_AB = 4000;

for (const bkt of abBaskets) {
  console.log(`\n  ═══ ${bkt.name} — KI 35%, CB 45%, AC 100%, Cpn 4%/Q, Jr 40%, 6mo, E=12% ═══`);
  console.log('  ' + 'Model'.padEnd(22) +
    'SrAnn'.padStart(8) + ' SrWin'.padStart(6) +
    '  JrAnn'.padStart(8) + ' JrWin'.padStart(6) + ' JrMed'.padStart(7) + ' JrP5'.padStart(7) +
    '  $Gamma'.padStart(9) + ' GammaAnn'.padStart(10) +
    '  $Euler'.padStart(8) + ' $Cpn'.padStart(7) + ' $KI'.padStart(7) +
    '  KI%'.padStart(6) + ' AC%'.padStart(5));
  console.log('  ' + '─'.repeat(130));

  // Generate shared paths
  const T = abCfg.nQ * 0.25;
  const totalSteps = Math.round(T * 252 * abCfg.stepsPerDay);
  const paths = genPaths(bkt.stocks, N_AB, T, totalSteps);

  // v16 (bugs)
  const r16 = paths.map(p => simPathV16(p, bkt.stocks, abCfg)).filter(Boolean);
  const s16 = stats(r16);

  // v17 (fixed)
  const r17 = paths.map(p => simPath(p, bkt.stocks, abCfg)).filter(Boolean);
  const s17 = stats(r17);

  for (const [label, s] of [['v16 (long+dblcount)', s16], ['v17 (short+fixed)', s17]]) {
    console.log('  ' +
      label.padEnd(22) +
      f(s.sAnn).padStart(8) +
      `${(s.sWin*100).toFixed(0)}%`.padStart(6) +
      f(s.jAnn).padStart(8) +
      `${(s.jWin*100).toFixed(0)}%`.padStart(6) +
      f(s.jMed).padStart(7) +
      f(s.jP5).padStart(7) +
      `  ${$$(s.avgGammaPnL)}` +
      f(s.avgGammaPnL/10000/s.avgDur).padStart(10) +
      `  ${$$(s.avgEuler)}` +
      ` ${$$(s.avgCpnPaid)}` +
      ` ${$$(s.avgKiLoss)}` +
      `  ${(s.kiR*100).toFixed(1)}%` +
      ` ${(s.acR*100).toFixed(0)}%`
    );
  }
  console.log('  ' + '─'.repeat(130));
  console.log(`  Δ Jr APY: ${f(s17.jAnn - s16.jAnn)}  (v17 - v16)`);
  console.log(`  Δ Gamma:  ${$$(s17.avgGammaPnL - s16.avgGammaPnL)}`);
}


// ============================================================
// PART 2: FULL PRODUCT SWEEP — v17 corrected model
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 2: FULL PRODUCT SWEEP — v17 corrected mechanics');
console.log('▓  Baskets: NVDA/TSLA/AMD, NVDA/TSLA/COIN');
console.log('▓'.repeat(120));

const P2_baskets = [
  { name:'NVDA/TSLA/AMD',  stocks:['NVDAx','TSLAx','AMDx'] },
  { name:'NVDA/TSLA/COIN', stocks:['NVDAx','TSLAx','COINx'] },
];
const P2_ki = [0.30, 0.35, 0.40];
const P2_ac = [1.00, 1.05];
const P2_mat = [{ n:'6mo', q:2 }, { n:'9mo', q:3 }];
const P2_cpn = [0.03, 0.04, 0.05, 0.06];
const P2_jr = [0.25, 0.30, 0.35, 0.40];
const P2_cb = [0.40, 0.45];
const N2 = 2000;

const allP2 = [];
let p2cnt = 0;
const p2tot = P2_baskets.length * P2_ki.length * P2_ac.length * P2_mat.length * P2_cpn.length * P2_jr.length * P2_cb.length;
process.stdout.write(`\n  Running ${p2tot} configs...`);

for (const bkt of P2_baskets)
  for (const ki of P2_ki)
    for (const ac of P2_ac)
      for (const mat of P2_mat)
        for (const cpn of P2_cpn)
          for (const jr of P2_jr)
            for (const cb of P2_cb) {
              p2cnt++;
              if (p2cnt % 50 === 0) process.stdout.write(`\r  Running ${p2cnt}/${p2tot}...`);
              const R = runMC(bkt.stocks, {
                ki, cb, acStart:ac, acSD:0.025,
                cpnPerQ:cpn, mem:true, seniorDep:10000, juniorRatio:jr,
                eulerAPY:0.12, fundingAPY:0.05, rf:0.05, nQ:mat.q,
                deltaThresh:0.03, stepsPerDay:2,
              }, N2);
              const s = stats(R);
              allP2.push({
                bkt:bkt.name, stocks:bkt.stocks,
                ki, ac, mat:mat.n, nQ:mat.q, cpn, jr, cb, ...s,
              });
            }

console.log(`\r  Done: ${p2tot} configs × ${N2} paths\n`);

// Filter: balanced configs — relaxed for Jr
const balanced2 = allP2.filter(r =>
  r.sAnn >= 0.08 && r.jAnn >= 0.02 && r.sWin >= 0.70 && r.jWin >= 0.50
).sort((a, b) => {
  const sa = a.sAnn * 0.30 + a.jAnn * 0.40 + a.sWin * 0.15 + a.jWin * 0.15;
  const sb = b.sAnn * 0.30 + b.jAnn * 0.40 + b.sWin * 0.15 + b.jWin * 0.15;
  return sb - sa;
});

console.log(`  ${balanced2.length} balanced configs (Sr≥8%, Jr≥2%, SrWin≥70%, JrWin≥50%)\n`);

if (balanced2.length === 0) {
  // Try softer filter
  const soft = allP2.filter(r =>
    r.sAnn >= 0.05 && r.jAnn >= 0.0 && r.sWin >= 0.60 && r.jWin >= 0.40
  ).sort((a, b) => {
    const sa = a.sAnn * 0.30 + a.jAnn * 0.40 + a.sWin * 0.15 + a.jWin * 0.15;
    const sb = b.sAnn * 0.30 + b.jAnn * 0.40 + b.sWin * 0.15 + b.jWin * 0.15;
    return sb - sa;
  });
  console.log(`  Softer filter (Sr≥5%, Jr≥0%, SrWin≥60%, JrWin≥40%): ${soft.length} configs\n`);
  if (soft.length > 0) balanced2.push(...soft);
}

if (balanced2.length === 0) {
  // Show top by combined APY as fallback
  const fallback = allP2.filter(r => r.sAnn > 0)
    .sort((a,b) => (b.sAnn + b.jAnn) - (a.sAnn + a.jAnn));
  console.log('  No balanced configs found. Showing top 30 by combined APY:\n');
  balanced2.push(...fallback.slice(0, 30));
}

console.log('  TOP 30:');
console.log('  ' + 'Basket'.padEnd(18) + 'KI'.padEnd(5) + 'AC'.padEnd(6) + 'Mat'.padEnd(5) +
  'Cpn'.padEnd(5) + 'Jr'.padEnd(5) + 'CB'.padEnd(5) +
  '│ SrAnn'.padStart(8) + ' SrW'.padStart(5) +
  '│ JrAnn'.padStart(8) + ' JrW'.padStart(5) + ' JrMed'.padStart(7) + ' JrP5'.padStart(7) +
  '│ $Cpn'.padStart(7) + ' $Eul'.padStart(7) + ' $Gam'.padStart(7) + ' $KI'.padStart(7) +
  '│ CpnR'.padStart(5) + ' KI%'.padStart(6));
console.log('  ' + '─'.repeat(145));

for (const r of balanced2.slice(0, 30)) {
  const cpnRate = r.avgCpnPayments / r.nQ;
  console.log('  ' +
    r.bkt.padEnd(18) +
    `${(r.ki*100).toFixed(0)}%`.padEnd(5) +
    `${(r.ac*100).toFixed(0)}%`.padEnd(6) +
    r.mat.padEnd(5) +
    `${(r.cpn*100).toFixed(0)}%`.padEnd(5) +
    `${(r.jr*100).toFixed(0)}%`.padEnd(5) +
    `${(r.cb*100).toFixed(0)}%`.padEnd(5) +
    `│ ${f(r.sAnn).padStart(7)}` +
    ` ${(r.sWin*100).toFixed(0)}%`.padStart(5) +
    `│ ${f(r.jAnn).padStart(7)}` +
    ` ${(r.jWin*100).toFixed(0)}%`.padStart(5) +
    ` ${f(r.jMed).padStart(6)}` +
    ` ${f(r.jP5).padStart(6)}` +
    `│ ${$$(r.avgCpnPaid).padStart(6)}` +
    ` ${$$(r.avgEuler).padStart(6)}` +
    ` ${$$(r.avgGammaPnL).padStart(6)}` +
    ` ${$$(r.avgKiLoss).padStart(6)}` +
    `│ ${(cpnRate*100).toFixed(0)}%`.padStart(5) +
    ` ${(r.kiR*100).toFixed(1)}%`.padStart(6)
  );
}


// ============================================================
// PART 3: DEEP DIVE — Top 5 with 8,000 paths
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 3: DEEP DIVE — Top 5 with 8,000 paths');
console.log('▓'.repeat(120));

const deepDive = balanced2.slice(0, 5);

for (let i = 0; i < deepDive.length; i++) {
  const b = deepDive[i];
  process.stdout.write(`\n  #${i+1}: ${b.bkt}...`);
  const R = runMC(b.stocks, {
    ki:b.ki, cb:b.cb, acStart:b.ac, acSD:0.025,
    cpnPerQ:b.cpn, mem:true, seniorDep:10000, juniorRatio:b.jr,
    eulerAPY:0.12, fundingAPY:0.05, rf:0.05, nQ:b.nQ,
    deltaThresh:0.03, stepsPerDay:2,
  }, 8000);
  const ds = stats(R);
  console.log(' done');

  const lev = ((1+b.jr)/b.jr).toFixed(1);
  const dur = ds.avgDur;
  const optAnn = dur > 0 ? ds.avgCpnPaid / 10000 / dur : 0;
  const eulerAnn = dur > 0 ? ds.avgEuler / 10000 / dur : 0;
  const gammaAnn = dur > 0 ? ds.avgGammaPnL / 10000 / dur : 0;
  const fundAnn = dur > 0 ? ds.avgFunding / 10000 / dur : 0;
  const totalIncome = ds.avgCpnPaid + ds.avgEuler + ds.avgGammaPnL + ds.avgFunding;
  const totalAnn = dur > 0 ? totalIncome / 10000 / dur : 0;
  const cpnShare = totalIncome > 0 ? (ds.avgCpnPaid / totalIncome * 100) : 0;
  const eulerShare = totalIncome > 0 ? (ds.avgEuler / totalIncome * 100) : 0;
  const gammaShare = totalIncome > 0 ? (ds.avgGammaPnL / totalIncome * 100) : 0;
  const fundShare = totalIncome > 0 ? (ds.avgFunding / totalIncome * 100) : 0;
  const cpnRate = ds.avgCpnPayments / b.nQ;

  // Conditional KI stats
  const kiPaths = R.filter(r => r.ki);
  const avgCondKI = kiPaths.length > 0 ? kiPaths.reduce((s,r) => s + r.kiLoss, 0) / kiPaths.length : 0;

  console.log(`
  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #${i+1} ${b.bkt.padEnd(18)} KI:${(b.ki*100).toFixed(0)}% AC:${(b.ac*100).toFixed(0)}% CB:${(b.cb*100).toFixed(0)}% Cpn:${(b.cpn*100).toFixed(0)}%/Q Jr:${(b.jr*100).toFixed(0)}%(${lev}x) ${b.mat} E:12% F:5%  │
  ├──────────────────────────────────────────────────────────────────────────────────────────────┤
  │  SENIOR (retail)     APY: ${f(ds.sAnn).padStart(7)}   Win: ${(ds.sWin*100).toFixed(1)}%   Med: ${f(ds.sMed).padStart(7)}   P5: ${f(ds.sP5).padStart(7)}       │
  │  JUNIOR (whale/DAO)  APY: ${f(ds.jAnn).padStart(7)}   Win: ${(ds.jWin*100).toFixed(1)}%   Med: ${f(ds.jMed).padStart(7)}   P5: ${f(ds.jP5).padStart(7)}       │
  ├──────────────────────────────────────────────────────────────────────────────────────────────┤
  │  YIELD SOURCE DECOMPOSITION (per $10k Senior note):                                         │
  │  ┌───────────────────┬────────────┬─────────┬─────────┐                                     │
  │  │ Source             │   $/note   │  Ann %  │  Share  │                                     │
  │  ├───────────────────┼────────────┼─────────┼─────────┤                                     │
  │  │ Option premium     │ ${$$(ds.avgCpnPaid).padStart(9)}  │ ${f(optAnn).padStart(7)} │  ${cpnShare.toFixed(0).padStart(3)}%  │  coupons paid to Senior          │
  │  │ Euler yield        │ ${$$(ds.avgEuler).padStart(9)}  │ ${f(eulerAnn).padStart(7)} │  ${eulerShare.toFixed(0).padStart(3)}%  │  lending on pool capital          │
  │  │ Gamma hedge PnL    │ ${$$(ds.avgGammaPnL).padStart(9)}  │ ${f(gammaAnn).padStart(7)} │  ${gammaShare.toFixed(0).padStart(3)}%  │  short rebalancing profit         │
  │  │ Funding rate       │ ${$$(ds.avgFunding).padStart(9)}  │ ${f(fundAnn).padStart(7)} │  ${fundShare.toFixed(0).padStart(3)}%  │  perp funding on short            │
  │  ├───────────────────┼────────────┼─────────┼─────────┤                                     │
  │  │ Total income       │ ${$$(totalIncome).padStart(9)}  │ ${f(totalAnn).padStart(7)} │  100%  │                                     │
  │  │ KI losses          │ ${$$(-ds.avgKiLoss).padStart(9)}  │         │         │  avg ${$(avgCondKI)} per KI event        │
  │  └───────────────────┴────────────┴─────────┴─────────┘                                     │
  │                                                                                              │
  │  STRUCTURE: AC ${(ds.acR*100).toFixed(0)}%  MAT ${((1-ds.acR-ds.kiR)*100).toFixed(0)}%  KI ${(ds.kiR*100).toFixed(1)}%  CpnRate ${(cpnRate*100).toFixed(0)}%  Avg ${(dur*12).toFixed(1)}mo  ${ds.avgTrades.toFixed(0)} trades       │
  │  GAMMA DIST: P5 ${$(ds.gammaPnLs[Math.floor(ds.gammaPnLs.length*0.05)])}  Med ${$(ds.gammaPnLs[Math.floor(ds.gammaPnLs.length*0.5)])}  P95 ${$(ds.gammaPnLs[Math.floor(ds.gammaPnLs.length*0.95)])}       │
  └──────────────────────────────────────────────────────────────────────────────────────────────┘`);
}

console.log('\n\n' + '█'.repeat(120));
console.log('█  v17 COMPLETE — Fixed AC waterfall + correct short hedge');
console.log('█'.repeat(120) + '\n');
