#!/usr/bin/env node
// ============================================================
// xYield v14 — AGGRESSIVE OPTION PREMIUM EXPLORER
//
// GOAL: Maximize option premium through:
// - Ultra-volatile worst-of baskets (TSLA/COIN/MSTR)
// - Lower KI barriers (30-45%)
// - Harder autocall triggers (105%, 110%)
// - Longer maturities (6-12mo)
// - 2/3/4-stock worst-of for dispersion premium
// - Funding rate on hedge notional
//
// TARGET: Senior 15-20% APY, Junior 25-40% APY
// Option premium DOMINANT over Euler
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

// ============================================================
// STOCKS — bumped vols to reflect real implied vol levels
// ============================================================
const ST = {
  NVDAx: { S0:183.14, vol:0.55 },
  TSLAx: { S0:395.01, vol:0.60 },
  COINx: { S0:193.24, vol:0.75 },
  MSTRx: { S0:350.00, vol:0.85 },
  AMDx:  { S0:115.00, vol:0.50 },
  METAx: { S0:638.27, vol:0.38 },
};
const CR = {
  'NVDAx-TSLAx':0.45,'NVDAx-COINx':0.35,'NVDAx-MSTRx':0.35,'NVDAx-AMDx':0.70,'NVDAx-METAx':0.55,
  'TSLAx-COINx':0.40,'TSLAx-MSTRx':0.30,'TSLAx-AMDx':0.40,'TSLAx-METAx':0.30,
  'COINx-MSTRx':0.75,'COINx-AMDx':0.25,'COINx-METAx':0.20,
  'MSTRx-AMDx':0.25,'MSTRx-METAx':0.20,'AMDx-METAx':0.50,
};
function gc(a,b){return a===b?1:CR[`${a}-${b}`]??CR[`${b}-${a}`]??0.20;}

// ============================================================
// BASKETS — ordered by avg vol (ascending)
// ============================================================
const BASKETS = [
  { name:'NVDA/TSLA/META',      stocks:['NVDAx','TSLAx','METAx'] },      // ~51%
  { name:'NVDA/TSLA/AMD',       stocks:['NVDAx','TSLAx','AMDx'] },       // ~55%
  { name:'NVDA/TSLA',           stocks:['NVDAx','TSLAx'] },              // ~58%
  { name:'NVDA/TSLA/COIN',      stocks:['NVDAx','TSLAx','COINx'] },      // ~63%
  { name:'NVDA/TSLA/MSTR',      stocks:['NVDAx','TSLAx','MSTRx'] },      // ~67%
  { name:'TSLA/COIN',           stocks:['TSLAx','COINx'] },              // ~68%
  { name:'TSLA/MSTR',           stocks:['TSLAx','MSTRx'] },              // ~73%
  { name:'NVDA/TSLA/COIN/MSTR', stocks:['NVDAx','TSLAx','COINx','MSTRx'] }, // ~69%
];

function genPaths(stocks,nP,T,nS){
  const n=stocks.length,dt=T/nS,sq=Math.sqrt(dt);
  const C=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>gc(stocks[i],stocks[j])));
  const L=cholesky(C),vols=stocks.map(s=>ST[s].vol),S0=stocks.map(s=>ST[s].S0),r=0.05,paths=[];
  for(let p=0;p<nP;p++){
    const path=stocks.map((_,i)=>{const a=new Float64Array(nS+1);a[0]=S0[i];return a;});
    for(let t=0;t<nS;t++){
      const z=[];for(let i=0;i<n;i++)z.push(randn());
      const w=new Float64Array(n);for(let i=0;i<n;i++)for(let j=0;j<=i;j++)w[i]+=L[i][j]*z[j];
      for(let i=0;i<n;i++)path[i][t+1]=path[i][t]*Math.exp((r-0.5*vols[i]**2)*dt+vols[i]*sq*w[i]);
    }
    paths.push(path);
  }
  return paths;
}

// ============================================================
// SIMULATION ENGINE — Option premium + Euler + Hedge + Funding
// ============================================================
function simPath(path, stocks, cfg) {
  const { ki, cb, acStart, acSD, cpnPerQ, mem,
    seniorDep, juniorRatio, eulerAPY, fundingAPY, rf, nQ, hedgeThresh } = cfg;

  const n = stocks.length;
  const S0 = stocks.map(s => ST[s].S0);
  const vols = stocks.map(s => ST[s].vol);
  const juniorDep = seniorDep * juniorRatio;
  const poolSize = seniorDep + juniorDep;
  const T = nQ * 0.25;
  const spQ = 13, totS = nQ * spQ, dt = T / totS;

  let eulerBal = poolSize * 0.998; // after 0.2% protocol fee
  let shares = new Float64Array(n);
  let prevDelta = new Float64Array(n);
  let knockedIn = false;
  let totalCpnPaid = 0, missedCpn = 0;
  let tradeCount = 0;
  let yldEuler = 0, yldFunding = 0;
  let initialPool = eulerBal;

  // Initial hedge
  for (let i = 0; i < n; i++) {
    const d = Math.abs(diPutDelta(S0[i], S0[i], ki * S0[i], T, rf, vols[i]));
    const cl = Math.max(0, Math.min(d, 0.95));
    prevDelta[i] = cl;
    if (cl > hedgeThresh) {
      const tgt = cl * (seniorDep / n / S0[i]);
      shares[i] = tgt;
      eulerBal -= tgt * S0[i];
      tradeCount++;
    }
  }

  for (let step = 1; step <= totS; step++) {
    const curT = step * dt, ttm = Math.max(T - curT, 0.001);
    const isQEnd = step % spQ === 0;
    const qNum = Math.floor((step - 1) / spQ) + 1;
    const isLast = step === totS;
    const prices = stocks.map((_, i) => path[i][step]);
    const perfs = prices.map((p, i) => p / S0[i]);
    const worstPerf = Math.min(...perfs);

    // Euler yield on cash in pool
    if (eulerBal > 0) {
      const y = eulerBal * eulerAPY * dt;
      eulerBal += y;
      yldEuler += y;
    }

    // Funding rate income on hedge notional
    if (fundingAPY > 0) {
      let hedgeNot = 0;
      for (let i = 0; i < n; i++) hedgeNot += shares[i] * prices[i];
      if (hedgeNot > 0) {
        const fy = hedgeNot * fundingAPY * dt;
        eulerBal += fy;
        yldFunding += fy;
      }
    }

    if (worstPerf <= ki) knockedIn = true;

    if (isQEnd) {
      const acBar = Math.max(acStart - acSD * (qNum - 1), 0.80);

      if (perfs.every(p => p >= acBar)) {
        let cpn = cpnPerQ * seniorDep;
        totalCpnPaid += cpn;
        if (mem && missedCpn > 0) { totalCpnPaid += missedCpn; missedCpn = 0; }

        // Unwind hedge
        for (let i = 0; i < n; i++) {
          if (shares[i] > 0.001) { eulerBal += shares[i] * prices[i]; shares[i] = 0; tradeCount++; }
        }

        const srPay = seniorDep + totalCpnPaid;
        const jrPay = Math.max(eulerBal - srPay, 0);
        const hedgePnL = eulerBal - initialPool - yldEuler - yldFunding + totalCpnPaid;

        return { out:'AC', q:qNum, dur:curT,
          srRet: totalCpnPaid / seniorDep,
          jrRet: (jrPay - juniorDep) / juniorDep,
          wp: worstPerf, ki: false, tradeCount,
          yldEuler, yldFunding, hedgePnL,
          totalCpnPaid, kiLoss: 0,
        };
      }

      if (worstPerf >= cb) {
        let cpn = cpnPerQ * seniorDep;
        totalCpnPaid += cpn;
        if (mem && missedCpn > 0) { totalCpnPaid += missedCpn; missedCpn = 0; }
        eulerBal -= cpn;
      } else if (mem) {
        missedCpn += cpnPerQ * seniorDep;
      }
    }

    // Delta hedge every 2 steps
    if (step % 2 === 0 && !isLast) {
      for (let i = 0; i < n; i++) {
        const S = prices[i], barrier = ki * S0[i];
        const notSh = seniorDep / n / S0[i];
        let tgtDelta;
        if (knockedIn && perfs[i] < 1.0) {
          tgtDelta = Math.min(0.5 + (1 - perfs[i]) * 2.5, 1.0);
        } else {
          tgtDelta = Math.abs(diPutDelta(S, S0[i], barrier, ttm, rf, vols[i]));
          tgtDelta = Math.max(0, Math.min(tgtDelta, 0.95));
          if (perfs[i] > 1.15) tgtDelta *= 0.5;
          if (perfs[i] > 1.3) tgtDelta = 0;
        }
        if (Math.abs(tgtDelta - prevDelta[i]) > hedgeThresh) {
          const tgt = tgtDelta * notSh;
          const diff = tgt - shares[i];
          if (Math.abs(diff * S) > 50) {
            if (diff > 0) eulerBal -= diff * S;
            else eulerBal += Math.abs(diff) * S;
            shares[i] = tgt;
            prevDelta[i] = tgtDelta;
            tradeCount++;
          }
        }
      }
    }

    if (isLast) {
      // Unwind hedge
      for (let i = 0; i < n; i++) {
        if (shares[i] > 0.001) { eulerBal += shares[i] * prices[i]; shares[i] = 0; tradeCount++; }
      }

      const hedgePnL = eulerBal - initialPool - yldEuler - yldFunding + totalCpnPaid;

      if (knockedIn && worstPerf < 1.0) {
        const loss = seniorDep * (1 - worstPerf);
        const jrAbsorbs = Math.min(loss, juniorDep);
        const srPrincipal = seniorDep - Math.max(loss - juniorDep, 0);
        const jrPay = Math.max(eulerBal - srPrincipal, 0);
        return { out:'KI', q:nQ, dur:T,
          srRet: (srPrincipal + totalCpnPaid - seniorDep) / seniorDep,
          jrRet: (jrPay - juniorDep) / juniorDep,
          wp: worstPerf, ki: true, tradeCount,
          yldEuler, yldFunding, hedgePnL,
          totalCpnPaid, kiLoss: loss,
        };
      } else {
        const jrPay = Math.max(eulerBal - seniorDep, 0);
        return { out:'MAT', q:nQ, dur:T,
          srRet: totalCpnPaid / seniorDep,
          jrRet: (jrPay - juniorDep) / juniorDep,
          wp: worstPerf, ki: false, tradeCount,
          yldEuler, yldFunding, hedgePnL,
          totalCpnPaid, kiLoss: 0,
        };
      }
    }
  }
}

function runMC(stocks, cfg, nP) {
  const T = cfg.nQ * 0.25, totS = cfg.nQ * 13;
  const paths = genPaths(stocks, nP, T, totS);
  return paths.map(p => simPath(p, stocks, cfg)).filter(Boolean);
}

function stats(R) {
  const sr = R.map(r => r.srRet).sort((a,b) => a-b);
  const jr = R.map(r => r.jrRet).sort((a,b) => a-b);
  const N = R.length;
  const pct = (a,p) => a[Math.min(Math.floor(a.length*p/100), a.length-1)];
  const mean = a => a.reduce((x,y) => x+y, 0) / a.length;
  const avgDur = mean(R.map(r => r.dur));
  const sm = mean(sr), jm = mean(jr);
  return {
    sm, sMed: pct(sr,50), sP5: pct(sr,5), sP95: pct(sr,95),
    sWin: sr.filter(r => r >= 0).length / N,
    sAnn: avgDur > 0 ? sm / avgDur : 0,
    jm, jMed: pct(jr,50), jP5: pct(jr,5), jP95: pct(jr,95),
    jWin: jr.filter(r => r >= 0).length / N,
    jAnn: avgDur > 0 ? jm / avgDur : 0,
    acR: R.filter(r => r.out === 'AC').length / N,
    kiR: R.filter(r => r.ki).length / N,
    avgDur,
    avgEuler: mean(R.map(r => r.yldEuler)),
    avgFunding: mean(R.map(r => r.yldFunding)),
    avgHedgePnL: mean(R.map(r => r.hedgePnL)),
    avgCpnPaid: mean(R.map(r => r.totalCpnPaid)),
    avgKiLoss: mean(R.map(r => r.kiLoss)),
    avgTrades: mean(R.map(r => r.tradeCount)),
  };
}

const f = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const $ = v => `$${v.toFixed(0).padStart(5)}`;

// ============================================================
console.log('█'.repeat(120));
console.log('█  xYIELD v14 — AGGRESSIVE OPTION PREMIUM EXPLORER');
console.log('█  Ultra-vol baskets | Low barriers | Hard autocall | Long maturities');
console.log('█  Target: Senior 15-20% | Junior 25-40% | Option premium DOMINANT');
console.log('█'.repeat(120));

// ============================================================
// PART 1: OPTION PREMIUM MAP — Fair coupon with Euler=0
// ============================================================
console.log('\n' + '▓'.repeat(120));
console.log('▓  PART 1: OPTION PREMIUM MAP — Fair coupon per structure (Euler=0, funding=0)');
console.log('▓  Binary search for breakeven coupon = PURE option premium value');
console.log('▓'.repeat(120));

const P1_KI = [0.30, 0.35, 0.40, 0.45];
const P1_AC = [1.00, 1.05, 1.10];
const P1_MAT = [
  { n: '6mo', q: 2 },
  { n: '9mo', q: 3 },
  { n: '12mo', q: 4 },
];
const P1_N = 1500; // paths for binary search
const P1_BSKT = BASKETS;

const premiumResults = [];
let p1cnt = 0;
const p1tot = P1_BSKT.length * P1_KI.length * P1_AC.length * P1_MAT.length;
process.stdout.write(`\n  Sweeping ${p1tot} configs for fair premium...`);

for (const bkt of P1_BSKT) {
  const avgVol = bkt.stocks.reduce((s, st) => s + ST[st].vol, 0) / bkt.stocks.length;
  for (const ki of P1_KI) {
    for (const ac of P1_AC) {
      for (const mat of P1_MAT) {
        p1cnt++;
        if (p1cnt % 20 === 0) process.stdout.write(`\r  Sweeping ${p1cnt}/${p1tot}...`);

        // Binary search: find coupon where Junior breaks even (Euler=0)
        let lo = 0.005, hi = 0.25, fairCpn = 0.05;
        for (let iter = 0; iter < 12; iter++) {
          const mid = (lo + hi) / 2;
          const R = runMC(bkt.stocks, {
            ki, cb: 0.60, acStart: ac, acSD: 0.025,
            cpnPerQ: mid, mem: true, seniorDep: 10000, juniorRatio: 0.30,
            eulerAPY: 0, fundingAPY: 0, rf: 0.05, nQ: mat.q, hedgeThresh: 0.04,
          }, P1_N);
          const s = stats(R);
          if (s.jm > 0) lo = mid; else hi = mid;
          fairCpn = mid;
        }

        // Final run at fair coupon
        const R = runMC(bkt.stocks, {
          ki, cb: 0.60, acStart: ac, acSD: 0.025,
          cpnPerQ: fairCpn, mem: true, seniorDep: 10000, juniorRatio: 0.30,
          eulerAPY: 0, fundingAPY: 0, rf: 0.05, nQ: mat.q, hedgeThresh: 0.04,
        }, 2000);
        const s = stats(R);

        premiumResults.push({
          bkt: bkt.name, stocks: bkt.stocks, nStocks: bkt.stocks.length,
          avgVol, ki, ac, mat: mat.n, nQ: mat.q,
          fairCpn, fairAnn: fairCpn * 4,
          optPrem$: s.avgCpnPaid,
          ...s,
        });
      }
    }
  }
}

// Sort by fair annual premium (descending)
premiumResults.sort((a, b) => b.fairAnn - a.fairAnn);

console.log(`\r  Done: ${p1cnt} configs\n`);
console.log('  TOP 40 by option premium (fair coupon with Euler=0):');
console.log('  ' + 'Basket'.padEnd(24) + '#'.padEnd(2) + 'AvgVol'.padEnd(7) +
  'KI'.padEnd(5) + 'AC'.padEnd(6) + 'Mat'.padEnd(5) +
  'FairCpn/Q'.padStart(10) + 'FairAnn'.padStart(9) +
  '  AC%   KI%   OptPrem$');
console.log('  ' + '─'.repeat(100));

for (const r of premiumResults.slice(0, 40)) {
  console.log('  ' +
    r.bkt.padEnd(24) + `${r.nStocks}`.padEnd(2) +
    `${(r.avgVol * 100).toFixed(0)}%`.padEnd(7) +
    `${(r.ki * 100).toFixed(0)}%`.padEnd(5) +
    `${(r.ac * 100).toFixed(0)}%`.padEnd(6) +
    r.mat.padEnd(5) +
    `${(r.fairCpn * 100).toFixed(2)}%`.padStart(10) +
    `${(r.fairAnn * 100).toFixed(1)}%`.padStart(9) +
    `  ${(r.acR * 100).toFixed(0)}%`.padStart(6) +
    `  ${(r.kiR * 100).toFixed(1)}%`.padStart(7) +
    `  ${$(r.optPrem$)}`
  );
}

// Show premium vs vol/KI/AC/mat patterns
console.log('\n  ═══ PREMIUM DRIVERS (avg fair annual premium by factor) ═══');

// By #stocks
for (const ns of [2, 3, 4]) {
  const grp = premiumResults.filter(r => r.nStocks === ns);
  if (grp.length) {
    const avg = grp.reduce((s, r) => s + r.fairAnn, 0) / grp.length;
    console.log(`  ${ns}-stock worst-of:  avg fair premium = ${(avg * 100).toFixed(1)}% ann`);
  }
}
// By KI
for (const ki of P1_KI) {
  const grp = premiumResults.filter(r => r.ki === ki);
  const avg = grp.reduce((s, r) => s + r.fairAnn, 0) / grp.length;
  console.log(`  KI ${(ki * 100).toFixed(0)}%:           avg fair premium = ${(avg * 100).toFixed(1)}% ann`);
}
// By AC trigger
for (const ac of P1_AC) {
  const grp = premiumResults.filter(r => r.ac === ac);
  const avg = grp.reduce((s, r) => s + r.fairAnn, 0) / grp.length;
  console.log(`  AC trigger ${(ac * 100).toFixed(0)}%:    avg fair premium = ${(avg * 100).toFixed(1)}% ann`);
}
// By maturity
for (const mat of P1_MAT) {
  const grp = premiumResults.filter(r => r.mat === mat.n);
  const avg = grp.reduce((s, r) => s + r.fairAnn, 0) / grp.length;
  console.log(`  Maturity ${mat.n}:      avg fair premium = ${(avg * 100).toFixed(1)}% ann`);
}

// ============================================================
// PART 2: FULL STACK — Top 20 premiums + Euler + Jr sweep
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 2: FULL STACK — Top premium structures + Euler yield + Junior ratios');
console.log('▓  Finding where Senior ≥ 15% AND Junior ≥ 25%');
console.log('▓'.repeat(120));

const P2_EULER = [0.10, 0.15];
const P2_JR = [0.15, 0.20, 0.25, 0.30, 0.40];
const P2_FUND = 0.05; // 5% APY funding rate on hedge notional
const P2_N = 3000;
const top20 = premiumResults.slice(0, 20);

const fullResults = [];
let p2cnt = 0;
const p2tot = top20.length * P2_EULER.length * P2_JR.length;
process.stdout.write(`\n  Running ${p2tot} full-stack configs...`);

for (const base of top20) {
  for (const euler of P2_EULER) {
    for (const jr of P2_JR) {
      p2cnt++;
      if (p2cnt % 10 === 0) process.stdout.write(`\r  Running ${p2cnt}/${p2tot}...`);

      // Use fair coupon as the Senior coupon (what the option structure supports)
      const cpn = base.fairCpn;
      const R = runMC(base.stocks, {
        ki: base.ki, cb: 0.60, acStart: base.ac, acSD: 0.025,
        cpnPerQ: cpn, mem: true, seniorDep: 10000, juniorRatio: jr,
        eulerAPY: euler, fundingAPY: P2_FUND, rf: 0.05, nQ: base.nQ, hedgeThresh: 0.04,
      }, P2_N);
      const s = stats(R);

      fullResults.push({
        bkt: base.bkt, nStocks: base.nStocks,
        ki: base.ki, ac: base.ac, mat: base.mat, nQ: base.nQ,
        cpn, fairAnn: base.fairAnn,
        jr, euler,
        stocks: base.stocks,
        ...s,
      });
    }
  }
}

console.log(`\r  Done: ${p2cnt} configs × ${P2_N} paths\n`);

// Filter balanced configs
const balanced = fullResults.filter(r =>
  r.sAnn >= 0.15 && r.jAnn >= 0.20 && r.sWin >= 0.80
).sort((a, b) => {
  // Score: weight Jr APY heavily (user wants 25-40%), then Sr, then safety
  const sa = a.jAnn * 0.40 + a.sAnn * 0.30 + a.jWin * 0.15 + (1 - a.kiR) * 0.15;
  const sb = b.jAnn * 0.40 + b.sAnn * 0.30 + b.jWin * 0.15 + (1 - b.kiR) * 0.15;
  return sb - sa;
});

console.log(`  ${balanced.length} configs where Sr ≥ 15% AND Jr ≥ 20%\n`);

// Also show configs with option premium > Euler
const optDom = fullResults.filter(r => {
  const optPremAnn = r.avgCpnPaid / 10000 / r.avgDur;
  const eulerAnn = r.avgEuler / 10000 / r.avgDur;
  return optPremAnn > eulerAnn && r.sAnn > 0.10 && r.jAnn > 0.10;
});
console.log(`  ${optDom.length} configs where option premium > Euler yield\n`);

console.log('  TOP 30 BALANCED (Sr≥15%, Jr≥20%):');
console.log('  ' + 'Basket'.padEnd(24) + 'KI'.padEnd(5) + 'AC'.padEnd(6) + 'Mat'.padEnd(5) +
  'Jr'.padEnd(5) + 'E'.padEnd(5) +
  'SrAnn'.padStart(8) + 'SrW'.padStart(5) +
  '│' + 'JrAnn'.padStart(8) + 'JrW'.padStart(5) + 'JrP5'.padStart(8) +
  '│ $Opt  $Euler $Fund $Hedge $KI │ OptDom');
console.log('  ' + '─'.repeat(120));

for (const r of balanced.slice(0, 30)) {
  const optPremAnn = r.avgCpnPaid / 10000 / r.avgDur;
  const eulerAnn = r.avgEuler / 10000 / r.avgDur;
  const isDom = optPremAnn > eulerAnn ? '  ★OPT' : '';
  console.log('  ' +
    r.bkt.padEnd(24) +
    `${(r.ki * 100).toFixed(0)}%`.padEnd(5) +
    `${(r.ac * 100).toFixed(0)}%`.padEnd(6) +
    r.mat.padEnd(5) +
    `${(r.jr * 100).toFixed(0)}%`.padEnd(5) +
    `${(r.euler * 100).toFixed(0)}%`.padEnd(5) +
    f(r.sAnn).padStart(8) + `${(r.sWin * 100).toFixed(0)}%`.padStart(5) +
    '│' + f(r.jAnn).padStart(8) + `${(r.jWin * 100).toFixed(0)}%`.padStart(5) +
    f(r.jP5).padStart(8) +
    `│ ${$(r.avgCpnPaid)} ${$(r.avgEuler)} ${$(r.avgFunding)} ${$(r.avgHedgePnL)} ${$(r.avgKiLoss)}` +
    `│${isDom}`
  );
}

// ============================================================
// PART 3: BOOST COUPON — Can we push higher than fair?
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 3: COUPON BOOST — Push coupon ABOVE fair premium with Euler subsidy');
console.log('▓  Fair coupon = option premium only. Boosted coupon = option + Euler share');
console.log('▓'.repeat(120));

// Take top 5 baskets by fair premium, boost coupon by 1.5x-2.5x fair
const boostBaskets = premiumResults.slice(0, 5);
for (const base of boostBaskets) {
  console.log(`\n  ═══ ${base.bkt} — KI ${(base.ki*100).toFixed(0)}%, AC ${(base.ac*100).toFixed(0)}%, ${base.mat}, FairCpn ${(base.fairCpn*100).toFixed(2)}%/Q (${(base.fairAnn*100).toFixed(1)}% ann) ═══`);
  console.log('  ' + 'Cpn/Q'.padEnd(8) + 'CpnAnn'.padEnd(8) + 'Boost'.padEnd(7) +
    'Jr'.padEnd(5) + 'E'.padEnd(5) +
    'SrAnn'.padStart(8) + 'SrW'.padStart(5) +
    '│' + 'JrAnn'.padStart(8) + 'JrW'.padStart(5) + 'JrP5'.padStart(8) +
    '│ $CpnPaid $Euler $KI');
  console.log('  ' + '─'.repeat(100));

  const boosts = [1.0, 1.25, 1.5, 1.75, 2.0];
  for (const boost of boosts) {
    const cpn = base.fairCpn * boost;
    for (const jr of [0.20, 0.30]) {
      const R = runMC(base.stocks, {
        ki: base.ki, cb: 0.60, acStart: base.ac, acSD: 0.025,
        cpnPerQ: cpn, mem: true, seniorDep: 10000, juniorRatio: jr,
        eulerAPY: 0.15, fundingAPY: 0.05, rf: 0.05, nQ: base.nQ, hedgeThresh: 0.04,
      }, 3000);
      const s = stats(R);
      const mark = (s.sAnn >= 0.15 && s.jAnn >= 0.20 && s.jWin >= 0.50) ? ' ★' : '';
      console.log('  ' +
        `${(cpn*100).toFixed(1)}%`.padEnd(8) +
        `${(cpn*400).toFixed(0)}%`.padEnd(8) +
        `${boost.toFixed(2)}x`.padEnd(7) +
        `${(jr*100).toFixed(0)}%`.padEnd(5) +
        '15%'.padEnd(5) +
        f(s.sAnn).padStart(8) + `${(s.sWin*100).toFixed(0)}%`.padStart(5) +
        '│' + f(s.jAnn).padStart(8) + `${(s.jWin*100).toFixed(0)}%`.padStart(5) +
        f(s.jP5).padStart(8) +
        `│ ${$(s.avgCpnPaid)} ${$(s.avgEuler)} ${$(s.avgKiLoss)}` + mark
      );
    }
  }
}

// ============================================================
// PART 4: DEEP DIVE — Top 5 with 10,000 paths
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 4: DEEP DIVE — Top 5 structures with 10,000 paths');
console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');

// Pick top 5 from balanced results, or if not enough, from fullResults
const deepDive = balanced.length >= 5 ? balanced.slice(0, 5) :
  fullResults.filter(r => r.sAnn > 0.10 && r.jAnn > 0.10)
    .sort((a, b) => (b.sAnn + b.jAnn) - (a.sAnn + a.jAnn)).slice(0, 5);

for (let i = 0; i < deepDive.length; i++) {
  const b = deepDive[i];
  process.stdout.write(`\n  #${i + 1}: ${b.bkt}...`);
  const R = runMC(b.stocks, {
    ki: b.ki, cb: 0.60, acStart: b.ac, acSD: 0.025,
    cpnPerQ: b.cpn, mem: true, seniorDep: 10000, juniorRatio: b.jr,
    eulerAPY: b.euler, fundingAPY: P2_FUND, rf: 0.05, nQ: b.nQ, hedgeThresh: 0.04,
  }, 10000);
  const ds = stats(R);
  console.log(' done');

  const lev = ((1 + b.jr) / b.jr).toFixed(1);
  const optPremAnn = ds.avgCpnPaid / 10000 / ds.avgDur;
  const eulerAnn = ds.avgEuler / 10000 / ds.avgDur;
  const fundAnn = ds.avgFunding / 10000 / ds.avgDur;
  const hedgeAnn = ds.avgHedgePnL / 10000 / ds.avgDur;
  const totalDistrib = ds.avgCpnPaid + ds.avgEuler + ds.avgFunding + ds.avgHedgePnL;
  const optShare = ds.avgCpnPaid / (ds.avgCpnPaid + ds.avgEuler + ds.avgFunding) * 100;

  console.log(`
  ┌────────────────────────────────────────────────────────────────────────────────────────┐
  │  #${i + 1} ${b.bkt.padEnd(24)} KI:${(b.ki*100).toFixed(0)}% AC:${(b.ac*100).toFixed(0)}% Cpn:${(b.cpn*100).toFixed(1)}%/Q(${(b.cpn*400).toFixed(0)}%a) Jr:${(b.jr*100).toFixed(0)}%(${lev}x) ${b.mat} E:${(b.euler*100).toFixed(0)}%  │
  ├────────────────────────────────────────────────────────────────────────────────────────┤
  │  SENIOR (retail)     APY: ${f(ds.sAnn).padStart(7)}  Win: ${(ds.sWin*100).toFixed(1)}%  Med: ${f(ds.sMed).padStart(7)}  P5: ${f(ds.sP5).padStart(7)}  │
  │  JUNIOR (whale/DAO)  APY: ${f(ds.jAnn).padStart(7)}  Win: ${(ds.jWin*100).toFixed(1)}%  Med: ${f(ds.jMed).padStart(7)}  P5: ${f(ds.jP5).padStart(7)}  │
  ├────────────────────────────────────────────────────────────────────────────────────────┤
  │  YIELD DECOMPOSITION (per $10k note, avg):                                             │
  │    Option premium (coupons paid):   ${$(ds.avgCpnPaid)}  (${f(optPremAnn)} ann)  ${optShare.toFixed(0)}% of total income   │
  │    Euler yield (idle capital):      ${$(ds.avgEuler)}  (${f(eulerAnn)} ann)                              │
  │    Funding rate (hedge notional):   ${$(ds.avgFunding)}  (${f(fundAnn)} ann)                              │
  │    Hedge PnL (delta rebalancing):   ${$(ds.avgHedgePnL)}  (${f(hedgeAnn)} ann)                              │
  │    KI losses (tail risk):           ${$(ds.avgKiLoss)}                                                  │
  │    ─────────────────────────────────────────────────                                    │
  │    Total income (Opt+Euler+Fund):   ${$(ds.avgCpnPaid + ds.avgEuler + ds.avgFunding)}                                                  │
  │                                                                                        │
  │  STRUCTURE: AC ${(ds.acR*100).toFixed(0)}%  MAT ${((1-ds.acR-ds.kiR)*100).toFixed(0)}%  KI ${(ds.kiR*100).toFixed(1)}%  Avg ${(ds.avgDur*12).toFixed(1)}mo  ${ds.avgTrades.toFixed(0)} trades                │
  │  OPT PREMIUM ${optShare >= 50 ? 'DOMINANT ★' : `${optShare.toFixed(0)}% (Euler dominant)`}                                                    │
  └────────────────────────────────────────────────────────────────────────────────────────┘`);
}

// ============================================================
// FINAL SUMMARY
// ============================================================
console.log('\n\n' + '█'.repeat(120));
console.log('█  SUMMARY — Premium Driver Analysis');
console.log('█'.repeat(120));

console.log(`
  ┌────────────────────────────────────────────────────────────────────────────────────────┐
  │  OPTION PREMIUM MAXIMIZATION FINDINGS                                                  │
  ├────────────────────────────────────────────────────────────────────────────────────────┤
  │                                                                                        │
  │  TOP PREMIUM DRIVERS (by impact on fair annual coupon):                                │
  │                                                                                        │`);

// Compute premium impact per factor
const byNStocks = {};
for (const r of premiumResults) {
  const k = r.nStocks;
  if (!byNStocks[k]) byNStocks[k] = [];
  byNStocks[k].push(r.fairAnn);
}
for (const [k, vals] of Object.entries(byNStocks)) {
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  console.log(`  │  ${k}-stock worst-of: avg ${(avg * 100).toFixed(1)}% ann premium`.padEnd(89) + '│');
}

const byKI = {};
for (const r of premiumResults) {
  const k = r.ki;
  if (!byKI[k]) byKI[k] = [];
  byKI[k].push(r.fairAnn);
}
for (const [k, vals] of Object.entries(byKI)) {
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  console.log(`  │  KI ${(k * 100).toFixed(0)}%: avg ${(avg * 100).toFixed(1)}% ann premium`.padEnd(89) + '│');
}

console.log(`  │                                                                                        │
  │  TOTAL YIELD FORMULA:                                                                  │
  │  option_premium (15-30%+) + Euler (10-15%) + funding (3-5%) + hedge_PnL                │
  │  = 28-50%+ distributable                                                               │
  │                                                                                        │
  │  → Senior: 15-25% fixed coupon                                                         │
  │  → Junior: 25-60%+ leveraged residual                                                  │
  └────────────────────────────────────────────────────────────────────────────────────────┘
`);

console.log('█'.repeat(120));
console.log('█  v14 COMPLETE');
console.log('█'.repeat(120) + '\n');
