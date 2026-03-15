#!/usr/bin/env node
// ============================================================
// xYield v16 — FIXED DELTA MODEL + REALISTIC COUPON BARRIER
//
// FIXES FROM v15:
// 1. WORST-OF DELTA: hedge concentrates on the worst performer
//    - Worst performer gets full DI put delta
//    - Other stocks: delta weighted by proximity to worst
//    - This mimics a real structured desk hedging the dominant risk
//
// 2. COUPON BARRIER: lowered to 40-50% for high-vol baskets
//    - At 60%, coupons never paid → broken product
//    - At 40-50%, coupons paid ~70-90% of quarters → realistic
//
// 3. KI LOSS: properly deducted from pool cash before distribution
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
// WORST-OF AWARE DELTA MODEL
//
// In a worst-of basket, the barrier is triggered by the WORST stock.
// So the hedge should FOCUS on the worst performer:
//
// 1. Compute each stock's DI put delta independently
// 2. Weight by "worst-of proximity":
//    - Worst performer: weight = 1.0 (full delta)
//    - 2nd worst: weight decays based on gap to worst
//    - Best performer: weight ≈ 0 (far from triggering barrier)
// 3. This captures the "risk concentration" that real desks hedge
//
// The proximity weight uses: w_i = exp(-alpha * (perf_i - worstPerf))
// where alpha controls how quickly weight drops off
// ============================================================
function worstOfDeltas(stocks, prices, S0, vols, ki, ttm, rf, knockedIn) {
  const n = stocks.length;
  const perfs = prices.map((p, i) => p / S0[i]);
  const worstPerf = Math.min(...perfs);
  const worstIdx = perfs.indexOf(worstPerf);

  const deltas = new Float64Array(n);
  const alpha = 8.0; // decay rate: higher = more concentrated on worst

  for (let i = 0; i < n; i++) {
    // Base delta from DI put
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

    // Worst-of proximity weight
    const gap = perfs[i] - worstPerf; // 0 for worst, positive for others
    const weight = Math.exp(-alpha * gap);

    // Combined: worst performer gets full delta, others decay
    deltas[i] = baseDelta * weight;
  }

  return deltas;
}

// ============================================================
// SIMULATION ENGINE — Fixed delta + configurable coupon barrier
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

  let cash = poolSize * 0.998;
  let shares = new Float64Array(n);
  let costBasis = new Float64Array(n);
  let currentDelta = new Float64Array(n);
  let knockedIn = false;
  let totalCpnPaid = 0, missedCpn = 0;
  let tradeCount = 0;
  let yldEuler = 0, yldFunding = 0, gammaPnL = 0;
  let cpnPayments = 0; // count of coupon payments

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

  // Initial hedge
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
    const actualQ = qNum - 1; // the quarter that just ended
    const isLast = step === totalSteps;
    const prices = stocks.map((_, i) => path[i][step]);
    const perfs = prices.map((p, i) => p / S0[i]);
    const worstPerf = Math.min(...perfs);

    // Euler yield
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

    if (worstPerf <= ki) knockedIn = true;

    // Quarterly events
    if (isQEnd && actualQ >= 1 && actualQ <= nQ) {
      const acBar = Math.max(acStart - acSD * (actualQ - 1), 0.80);

      // Autocall check (not at final quarter — that's maturity)
      if (actualQ < nQ && perfs.every(p => p >= acBar)) {
        let cpn = cpnPerQ * seniorDep;
        totalCpnPaid += cpn;
        if (mem && missedCpn > 0) { totalCpnPaid += missedCpn; missedCpn = 0; }
        cpnPayments++;

        // Unwind hedge
        for (let i = 0; i < n; i++) {
          if (shares[i] > 0.001) {
            const saleVal = shares[i] * prices[i];
            gammaPnL += saleVal - costBasis[i];
            cash += saleVal;
            shares[i] = 0; costBasis[i] = 0; currentDelta[i] = 0;
            tradeCount++;
          }
        }

        // Distribute: Senior gets principal + coupons, Junior gets rest
        const srPay = seniorDep + totalCpnPaid;
        const jrPay = Math.max(cash - srPay, 0);
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
        if (mem && missedCpn > 0) { totalCpnPaid += missedCpn; missedCpn = 0; }
        cash -= cpn;
        cpnPayments++;
      } else if (mem) {
        missedCpn += cpnPerQ * seniorDep;
      }
    }

    // Hedge rebalance (threshold-based, checked every step)
    if (!isLast) {
      const tgtDeltas = worstOfDeltas(stocks, prices, S0, vols, ki, ttm, rf, knockedIn);
      rebalance(tgtDeltas, prices);
    }

    // Maturity
    if (isLast) {
      // Unwind hedge
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
        // KI: pool pays the loss, then distributes via waterfall
        const kiLoss = seniorDep * (1 - worstPerf);
        cash -= kiLoss; // pool PAYS the KI obligation

        // Waterfall: Senior first (protected), Junior gets residual
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
        // Normal maturity: return principal, Junior gets excess
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
console.log('█  xYIELD v16 — FIXED DELTA MODEL + REALISTIC COUPON BARRIER');
console.log('█  Worst-of delta concentration | KI loss from pool cash | Low coupon barrier');
console.log('█'.repeat(120));

// ============================================================
// PART 1: COUPON BARRIER CALIBRATION
// Find the right barrier so coupons actually get paid
// ============================================================
console.log('\n' + '▓'.repeat(120));
console.log('▓  PART 1: COUPON BARRIER CALIBRATION');
console.log('▓  Testing barrier levels to find where coupons are actually paid');
console.log('▓'.repeat(120));

const calibBaskets = [
  { name:'NVDA/TSLA/AMD',  stocks:['NVDAx','TSLAx','AMDx'] },
  { name:'NVDA/TSLA/COIN', stocks:['NVDAx','TSLAx','COINx'] },
];
const barriers = [0.35, 0.40, 0.45, 0.50, 0.55, 0.60];
const N1 = 2000;

for (const bkt of calibBaskets) {
  const avgVol = bkt.stocks.reduce((s,st) => s + ST[st].vol, 0) / bkt.stocks.length;
  console.log(`\n  ═══ ${bkt.name} (avg vol ${(avgVol*100).toFixed(0)}%) — KI 40%, 9mo, Cpn 6%/Q, Jr 30%, E=12% ═══`);
  console.log('  ' + 'CpnBar'.padEnd(8) + 'CpnRate'.padStart(8) + 'AvgCpns'.padStart(8) +
    '  SrAnn'.padStart(8) + '  JrAnn'.padStart(8) +
    '  SrWin'.padStart(7) + '  JrWin'.padStart(7) +
    '  KI%'.padStart(7) + '  AC%'.padStart(6) +
    '  $CpnPaid'.padStart(10) + '  $Euler'.padStart(8) + '  $Gamma'.padStart(8) + '  $KI'.padStart(7));
  console.log('  ' + '─'.repeat(110));

  for (const cb of barriers) {
    const R = runMC(bkt.stocks, {
      ki:0.40, cb, acStart:1.00, acSD:0.025,
      cpnPerQ:0.06, mem:true, seniorDep:10000, juniorRatio:0.30,
      eulerAPY:0.12, fundingAPY:0.05, rf:0.05, nQ:3,
      deltaThresh:0.03, stepsPerDay:2,
    }, N1);
    const s = stats(R);
    const cpnRate = s.avgCpnPayments / 3; // fraction of quarters with coupon
    console.log('  ' +
      `${(cb*100).toFixed(0)}%`.padEnd(8) +
      `${(cpnRate*100).toFixed(0)}%`.padStart(8) +
      `${s.avgCpnPayments.toFixed(1)}`.padStart(8) +
      f(s.sAnn).padStart(8) +
      f(s.jAnn).padStart(8) +
      `${(s.sWin*100).toFixed(0)}%`.padStart(7) +
      `${(s.jWin*100).toFixed(0)}%`.padStart(7) +
      `${(s.kiR*100).toFixed(1)}%`.padStart(7) +
      `${(s.acR*100).toFixed(0)}%`.padStart(6) +
      `  ${$$(s.avgCpnPaid)}` +
      `  ${$$(s.avgEuler)}` +
      `  ${$$(s.avgGammaPnL)}` +
      `  ${$$(s.avgKiLoss)}`
    );
  }
}

// ============================================================
// PART 2: WORST-OF DELTA vs OLD DELTA — A/B comparison
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 2: WORST-OF DELTA vs EQUAL-WEIGHT DELTA — A/B test');
console.log('▓  Same structure, different delta models');
console.log('▓'.repeat(120));

// Run with OLD model (equal weight) for comparison
function oldDeltas(stocks, prices, S0, vols, ki, ttm, rf, knockedIn) {
  const n = stocks.length;
  const perfs = prices.map((p, i) => p / S0[i]);
  const deltas = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (knockedIn && perfs[i] < 1.0) {
      deltas[i] = Math.min(0.5 + (1 - perfs[i]) * 2.5, 1.0);
    } else if (ttm <= 0.001) {
      deltas[i] = 0;
    } else {
      deltas[i] = Math.abs(diPutDelta(prices[i], S0[i], ki * S0[i], ttm, rf, vols[i]));
      deltas[i] = Math.max(0, Math.min(deltas[i], 0.95));
      if (perfs[i] > 1.15) deltas[i] *= 0.5;
      if (perfs[i] > 1.3) deltas[i] = 0;
    }
  }
  return deltas;
}

// Temporarily swap delta function for A/B test
const origWoF = worstOfDeltas;
const testBkt = { name:'NVDA/TSLA/COIN', stocks:['NVDAx','TSLAx','COINx'] };
const testCfg = {
  ki:0.40, cb:0.45, acStart:1.00, acSD:0.025,
  cpnPerQ:0.06, mem:true, seniorDep:10000, juniorRatio:0.30,
  eulerAPY:0.12, fundingAPY:0.05, rf:0.05, nQ:3,
  deltaThresh:0.03, stepsPerDay:2,
};
const N2 = 3000;

console.log(`\n  ═══ ${testBkt.name} — KI 40%, CpnBar 45%, 9mo, Cpn 6%/Q, Jr 30%, E=12% ═══`);
console.log('  ' + 'Model'.padEnd(22) +
  'GammaPnL'.padStart(10) + 'GammaAnn'.padStart(10) +
  '  Trades'.padStart(8) +
  '  SrAnn'.padStart(8) + '  JrAnn'.padStart(8) +
  '  SrWin'.padStart(7) + '  JrWin'.padStart(7) +
  '  KI%'.padStart(7) +
  '  $Cpn'.padStart(8) + '  $Euler'.padStart(8) + '  $KI'.padStart(7) +
  '  GammaP5'.padStart(10) + '  GammaP95'.padStart(11));
console.log('  ' + '─'.repeat(130));

// Test with different alpha values for worst-of concentration
const alphas = [0, 2, 4, 8, 12, 20];

for (const alpha of alphas) {
  const label = alpha === 0 ? 'Equal-weight (old v15)' : `Worst-of (α=${alpha})`;

  // Monkey-patch the worstOfDeltas to use this alpha
  const useAlpha = alpha;

  // We need to create a modified simPath that uses this alpha
  // Instead, let's just run separate sims
  process.stdout.write(`  Running ${label}...`);

  // Generate paths once, run with both models
  const T = testCfg.nQ * 0.25;
  const totalSteps = Math.round(T * 252 * testCfg.stepsPerDay);
  const paths = genPaths(testBkt.stocks, N2, T, totalSteps);

  const results = paths.map(path => {
    // Modified simPath inline with configurable alpha
    const { ki, cb, acStart, acSD, cpnPerQ, mem,
      seniorDep, juniorRatio, eulerAPY, fundingAPY, rf, nQ,
      deltaThresh, stepsPerDay: spd } = testCfg;
    const stocks = testBkt.stocks;
    const n = stocks.length;
    const S0 = stocks.map(s => ST[s].S0);
    const vols = stocks.map(s => ST[s].vol);
    const juniorDep = seniorDep * juniorRatio;
    const poolSize = seniorDep + juniorDep;
    const dt = T / totalSteps;

    let cash = poolSize * 0.998;
    let shr = new Float64Array(n), cBasis = new Float64Array(n), curD = new Float64Array(n);
    let knockedIn = false, tcpn = 0, mcpn = 0, tc = 0, yE = 0, yF = 0, gPnL = 0, cpnP = 0;

    function getDeltas(prices, ttm) {
      const perfs = prices.map((p,i) => p/S0[i]);
      const wp = Math.min(...perfs);
      const ds = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let bd;
        if (knockedIn && perfs[i] < 1.0) bd = Math.min(0.5 + (1-perfs[i])*2.5, 1.0);
        else if (ttm <= 0.001) bd = 0;
        else {
          bd = Math.abs(diPutDelta(prices[i], S0[i], ki*S0[i], ttm, rf, vols[i]));
          bd = Math.max(0, Math.min(bd, 0.95));
          if (perfs[i] > 1.15) bd *= 0.5;
          if (perfs[i] > 1.3) bd = 0;
        }
        const gap = perfs[i] - wp;
        const w = useAlpha === 0 ? 1.0 : Math.exp(-useAlpha * gap);
        ds[i] = bd * w;
      }
      return ds;
    }

    function rebal(tds, prices) {
      for (let i = 0; i < n; i++) {
        if (Math.abs(tds[i] - curD[i]) <= deltaThresh) continue;
        const nSh = seniorDep/n/S0[i], tgt = tds[i]*nSh, diff = tgt - shr[i];
        if (Math.abs(diff*prices[i]) < 20) continue;
        if (diff > 0) { cash -= diff*prices[i]; cBasis[i] += diff*prices[i]; }
        else {
          const sell = Math.abs(diff), sv = sell*prices[i];
          const bp = shr[i]>0.001 ? cBasis[i]/shr[i] : prices[i];
          gPnL += sv - sell*bp; cash += sv; cBasis[i] -= sell*bp;
        }
        shr[i] = tgt; curD[i] = tds[i]; tc++;
      }
    }

    // Init hedge
    const id = getDeltas(S0, T);
    for (let i=0;i<n;i++) if(id[i]>0.001){
      const ns=seniorDep/n/S0[i]; shr[i]=id[i]*ns;
      const c=shr[i]*S0[i]; cash-=c; cBasis[i]=c; curD[i]=id[i]; tc++;
    }

    for (let step=1;step<=totalSteps;step++){
      const curT=step*dt, ttm=Math.max(T-curT,0.001);
      const qN=Math.floor(curT/0.25+0.001)+1, pqN=Math.floor((curT-dt)/0.25+0.001)+1;
      const isQE=qN>pqN&&qN<=nQ+1&&step>1, aQ=qN-1, isL=step===totalSteps;
      const pr=stocks.map((_,i)=>path[i][step]), pf=pr.map((p,i)=>p/S0[i]), wp=Math.min(...pf);
      if(cash>0){const y=cash*eulerAPY*dt;cash+=y;yE+=y;}
      if(fundingAPY>0){let hn=0;for(let i=0;i<n;i++)hn+=shr[i]*pr[i];if(hn>0){const fy=hn*fundingAPY*dt;cash+=fy;yF+=fy;}}
      if(wp<=ki)knockedIn=true;

      if(isQE&&aQ>=1&&aQ<=nQ){
        const acB=Math.max(acStart-acSD*(aQ-1),0.80);
        if(aQ<nQ&&pf.every(p=>p>=acB)){
          let c=cpnPerQ*seniorDep;tcpn+=c;if(mem&&mcpn>0){tcpn+=mcpn;mcpn=0;}cpnP++;
          for(let i=0;i<n;i++)if(shr[i]>0.001){gPnL+=shr[i]*pr[i]-cBasis[i];cash+=shr[i]*pr[i];shr[i]=0;cBasis[i]=0;curD[i]=0;tc++;}
          return{out:'AC',q:aQ,dur:curT,srRet:tcpn/seniorDep,jrRet:(Math.max(cash-seniorDep-tcpn,0)-juniorDep)/juniorDep,
            wp,ki:false,tc,cpnP,yE,yF,gPnL,tcpn,kiL:0};
        }
        if(wp>=cb){let c=cpnPerQ*seniorDep;tcpn+=c;if(mem&&mcpn>0){tcpn+=mcpn;mcpn=0;}cash-=c;cpnP++;}
        else if(mem)mcpn+=cpnPerQ*seniorDep;
      }

      if(!isL){const td=getDeltas(pr,ttm);rebal(td,pr);}

      if(isL){
        for(let i=0;i<n;i++)if(shr[i]>0.001){gPnL+=shr[i]*pr[i]-cBasis[i];cash+=shr[i]*pr[i];shr[i]=0;cBasis[i]=0;tc++;}
        if(knockedIn&&wp<1.0){
          const kl=seniorDep*(1-wp);cash-=kl;
          const sp=Math.max(Math.min(seniorDep,cash),0),jp=Math.max(cash-seniorDep,0);
          return{out:'KI',q:nQ,dur:T,srRet:(sp+tcpn-seniorDep)/seniorDep,jrRet:(jp-juniorDep)/juniorDep,
            wp,ki:true,tc,cpnP,yE,yF,gPnL,tcpn,kiL:kl};
        }else{
          return{out:'MAT',q:nQ,dur:T,srRet:tcpn/seniorDep,jrRet:(Math.max(cash-seniorDep,0)-juniorDep)/juniorDep,
            wp,ki:false,tc,cpnP,yE,yF,gPnL,tcpn,kiL:0};
        }
      }
    }
  }).filter(Boolean);

  // Compute stats manually
  const N = results.length;
  const srs = results.map(r=>r.srRet).sort((a,b)=>a-b);
  const jrs = results.map(r=>r.jrRet).sort((a,b)=>a-b);
  const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
  const avgDur = mean(results.map(r=>r.dur));
  const sAnn = mean(srs)/avgDur;
  const jAnn = mean(jrs)/avgDur;
  const sWin = srs.filter(r=>r>=0).length/N;
  const jWin = jrs.filter(r=>r>=0).length/N;
  const kiR = results.filter(r=>r.ki).length/N;
  const avgG = mean(results.map(r=>r.gPnL));
  const avgE = mean(results.map(r=>r.yE));
  const avgCpn = mean(results.map(r=>r.tcpn));
  const avgKI = mean(results.map(r=>r.kiL));
  const avgTc = mean(results.map(r=>r.tc));
  const gs = results.map(r=>r.gPnL).sort((a,b)=>a-b);

  console.log('\r  ' +
    label.padEnd(22) +
    $(avgG).padStart(10) +
    f(avgG/10000/avgDur).padStart(10) +
    `${avgTc.toFixed(0)}`.padStart(8) +
    f(sAnn).padStart(8) +
    f(jAnn).padStart(8) +
    `${(sWin*100).toFixed(0)}%`.padStart(7) +
    `${(jWin*100).toFixed(0)}%`.padStart(7) +
    `${(kiR*100).toFixed(1)}%`.padStart(7) +
    `  ${$$(avgCpn)}` +
    `  ${$$(avgE)}` +
    `  ${$$(avgKI)}` +
    `  ${$(gs[Math.floor(N*0.05)])}`.padStart(10) +
    `  ${$(gs[Math.floor(N*0.95)])}`.padStart(11)
  );
}

// ============================================================
// PART 3: FULL PRODUCT SWEEP — corrected model
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 3: FULL PRODUCT SWEEP — Corrected delta + coupon barrier + KI model');
console.log('▓  Baskets: NVDA/TSLA/AMD, NVDA/TSLA/COIN');
console.log('▓'.repeat(120));

const P3_baskets = [
  { name:'NVDA/TSLA/AMD',  stocks:['NVDAx','TSLAx','AMDx'] },
  { name:'NVDA/TSLA/COIN', stocks:['NVDAx','TSLAx','COINx'] },
];
const P3_ki = [0.35, 0.40, 0.45];
const P3_ac = [1.00, 1.05];
const P3_mat = [{ n:'6mo', q:2 }, { n:'9mo', q:3 }];
const P3_cpn = [0.04, 0.06, 0.08];
const P3_jr = [0.20, 0.25, 0.30, 0.40];
const P3_cb = [0.40, 0.45]; // calibrated coupon barriers
const N3 = 2000;

const allP3 = [];
let p3cnt = 0;
const p3tot = P3_baskets.length * P3_ki.length * P3_ac.length * P3_mat.length * P3_cpn.length * P3_jr.length * P3_cb.length;
process.stdout.write(`\n  Running ${p3tot} configs...`);

for (const bkt of P3_baskets)
  for (const ki of P3_ki)
    for (const ac of P3_ac)
      for (const mat of P3_mat)
        for (const cpn of P3_cpn)
          for (const jr of P3_jr)
            for (const cb of P3_cb) {
              p3cnt++;
              if (p3cnt % 50 === 0) process.stdout.write(`\r  Running ${p3cnt}/${p3tot}...`);
              const R = runMC(bkt.stocks, {
                ki, cb, acStart:ac, acSD:0.025,
                cpnPerQ:cpn, mem:true, seniorDep:10000, juniorRatio:jr,
                eulerAPY:0.12, fundingAPY:0.05, rf:0.05, nQ:mat.q,
                deltaThresh:0.03, stepsPerDay:2,
              }, N3);
              const s = stats(R);
              allP3.push({
                bkt:bkt.name, stocks:bkt.stocks,
                ki, ac, mat:mat.n, nQ:mat.q, cpn, jr, cb, ...s,
              });
            }

console.log(`\r  Done: ${p3tot} configs × ${N3} paths\n`);

// Filter: balanced configs
const balanced = allP3.filter(r =>
  r.sAnn >= 0.10 && r.jAnn >= 0.05 && r.sWin >= 0.60 && r.jWin >= 0.40
).sort((a, b) => {
  const sa = a.sAnn * 0.35 + a.jAnn * 0.35 + a.sWin * 0.15 + a.jWin * 0.15;
  const sb = b.sAnn * 0.35 + b.jAnn * 0.35 + b.sWin * 0.15 + b.jWin * 0.15;
  return sb - sa;
});

console.log(`  ${balanced.length} balanced configs (Sr≥10%, Jr≥5%, SrWin≥60%, JrWin≥40%)\n`);

console.log('  TOP 40:');
console.log('  ' + 'Basket'.padEnd(18) + 'KI'.padEnd(5) + 'AC'.padEnd(6) + 'Mat'.padEnd(5) +
  'Cpn'.padEnd(5) + 'Jr'.padEnd(5) + 'CB'.padEnd(5) +
  '│ SrAnn'.padStart(8) + ' SrW'.padStart(5) +
  '│ JrAnn'.padStart(8) + ' JrW'.padStart(5) + ' JrP5'.padStart(7) +
  '│ $Cpn'.padStart(7) + ' $Eul'.padStart(7) + ' $Gam'.padStart(7) + ' $Fun'.padStart(6) + ' $KI'.padStart(7) +
  '│ CpnR'.padStart(5) + ' KI%'.padStart(6));
console.log('  ' + '─'.repeat(140));

for (const r of balanced.slice(0, 40)) {
  const cpnRate = r.avgCpnPayments / r.nQ;
  const totalIncome = r.avgCpnPaid + r.avgEuler + r.avgGammaPnL + r.avgFunding;
  const gammaShare = totalIncome > 0 ? r.avgGammaPnL / totalIncome : 0;
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
    ` ${f(r.jP5).padStart(6)}` +
    `│ ${$$(r.avgCpnPaid).padStart(6)}` +
    ` ${$$(r.avgEuler).padStart(6)}` +
    ` ${$$(r.avgGammaPnL).padStart(6)}` +
    ` ${$$(r.avgFunding).padStart(5)}` +
    ` ${$$(r.avgKiLoss).padStart(6)}` +
    `│ ${(cpnRate*100).toFixed(0)}%`.padStart(5) +
    ` ${(r.kiR*100).toFixed(1)}%`.padStart(6)
  );
}

// ============================================================
// PART 4: DEEP DIVE — Top 5 with 8,000 paths
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 4: DEEP DIVE — Top 5 with 8,000 paths');
console.log('▓'.repeat(120));

const deepDive = balanced.slice(0, 5);
if (deepDive.length === 0) {
  console.log('\n  No balanced configs found. Showing top 5 by combined APY instead.\n');
  const fallback = allP3.filter(r => r.sAnn > 0 && r.jAnn > -0.5)
    .sort((a,b) => (b.sAnn + b.jAnn*0.5) - (a.sAnn + a.jAnn*0.5)).slice(0,5);
  deepDive.push(...fallback);
}

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
  │  │ Gamma hedge PnL    │ ${$$(ds.avgGammaPnL).padStart(9)}  │ ${f(gammaAnn).padStart(7)} │  ${gammaShare.toFixed(0).padStart(3)}%  │  delta rebalancing profit         │
  │  │ Funding rate       │ ${$$(ds.avgFunding).padStart(9)}  │ ${f(fundAnn).padStart(7)} │  ${fundShare.toFixed(0).padStart(3)}%  │  perp funding on hedge            │
  │  ├───────────────────┼────────────┼─────────┼─────────┤                                     │
  │  │ Total income       │ ${$$(totalIncome).padStart(9)}  │ ${f(totalAnn).padStart(7)} │  100%  │                                     │
  │  │ KI losses          │ ${$$(-ds.avgKiLoss).padStart(9)}  │         │         │  deducted from pool               │
  │  └───────────────────┴────────────┴─────────┴─────────┘                                     │
  │                                                                                              │
  │  STRUCTURE: AC ${(ds.acR*100).toFixed(0)}%  MAT ${((1-ds.acR-ds.kiR)*100).toFixed(0)}%  KI ${(ds.kiR*100).toFixed(1)}%  CpnRate ${(cpnRate*100).toFixed(0)}%  Avg ${(dur*12).toFixed(1)}mo  ${ds.avgTrades.toFixed(0)} trades       │
  └──────────────────────────────────────────────────────────────────────────────────────────────┘`);
}

console.log('\n\n' + '█'.repeat(120));
console.log('█  v16 COMPLETE — Fixed delta model + coupon barrier + KI accounting');
console.log('█'.repeat(120) + '\n');
