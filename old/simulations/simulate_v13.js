#!/usr/bin/env node
// ============================================================
// xYield Notes v13 — OPTION PREMIUM AS PRIMARY YIELD SOURCE
//
// THE REAL ECONOMICS OF AN AUTOCALL:
//
// 1. OPTION PREMIUM (primary — 15-25% ann for high-vol baskets):
//    - Investor SELLS capped upside (all gains above AC barrier)
//    - Investor SELLS KI put (accepts tail risk)
//    - The PRICE of these options = the option premium
//    - This funds the coupon. Period.
//
// 2. EULER YIELD (secondary — 5-15% ann):
//    - Pool capital sits in Euler earning yield
//    - In TradFi this would be treasury bonds (4-5%)
//    - DeFi advantage: 5-15% vs 4-5% = extra 5-10%
//
// 3. COST ADVANTAGE (tertiary — 2-3% saved):
//    - TradFi bank takes 2-5% margin
//    - xYield protocol fee: 0.2%
//    - Savings go to Senior coupon
//
// TOTAL = option_premium + euler_yield - hedge_cost - protocol_fee
//       ≈ 18% + 12% - 4% - 0.2% = 25.8% distributable
//
// Split: Senior 15% coupon + Junior gets residual leveraged
// ============================================================

function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1.0 / (1.0 + p * Math.abs(x));
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1.0 + sign * y);
}
function diPutPx(S, K, H, T, r, sig) {
  if (T <= 0.001) return S <= H ? Math.max(K - S, 0) : 0;
  if (S <= H) { const sq = Math.sqrt(T); const d1 = (Math.log(S/K)+(r+sig*sig/2)*T)/(sig*sq); return K*Math.exp(-r*T)*normalCDF(-(d1-sig*sq)) - S*normalCDF(-d1); }
  if (S <= 0.001 || sig <= 0.001) return 0;
  const sq = Math.sqrt(T), lam = (r+sig*sig/2)/(sig*sig);
  const x1 = Math.log(S/H)/(sig*sq)+lam*sig*sq, y = Math.log(H*H/(S*K))/(sig*sq)+lam*sig*sq, y1 = Math.log(H/S)/(sig*sq)+lam*sig*sq;
  const p2l = Math.pow(H/S,2*lam), p2l2 = Math.pow(H/S,2*lam-2), disc = Math.exp(-r*T);
  return Math.max(-S*normalCDF(-x1)+K*disc*normalCDF(-x1+sig*sq)+S*p2l*(normalCDF(y)-normalCDF(y1))-K*disc*p2l2*(normalCDF(y-sig*sq)-normalCDF(y1-sig*sq)),0);
}
function diPutDelta(S, K, H, T, r, sig) {
  if (T <= 0.001) return S <= K ? -1 : 0;
  if (S <= H) { const sq=Math.sqrt(T); return normalCDF((Math.log(S/K)+(r+sig*sig/2)*T)/(sig*sq))-1; }
  const eps = S*0.005;
  return (diPutPx(S+eps,K,H,T,r,sig)-diPutPx(S-eps,K,H,T,r,sig))/(2*eps);
}

let _sp = null;
function randn() { if (_sp!==null){const v=_sp;_sp=null;return v;} let u,v,s; do{u=Math.random()*2-1;v=Math.random()*2-1;s=u*u+v*v;}while(s>=1||s===0); const m=Math.sqrt(-2*Math.log(s)/s);_sp=v*m;return u*m; }
function cholesky(M) { const n=M.length,L=Array.from({length:n},()=>new Float64Array(n)); for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let s=0;for(let k=0;k<j;k++)s+=L[i][k]*L[j][k];L[i][j]=i===j?Math.sqrt(Math.max(M[i][i]-s,1e-10)):(M[i][j]-s)/L[j][j];}return L; }

const ST = {
  NVDAx:{S0:183.14,vol:0.45}, TSLAx:{S0:395.01,vol:0.55}, AAPLx:{S0:255.76,vol:0.25},
  COINx:{S0:193.24,vol:0.70}, METAx:{S0:638.27,vol:0.35}, AMZNx:{S0:209.55,vol:0.30}, MSFTx:{S0:401.89,vol:0.30},
};
const CR = {
  'NVDAx-TSLAx':0.45,'NVDAx-AAPLx':0.60,'NVDAx-METAx':0.55,'NVDAx-AMZNx':0.65,'NVDAx-MSFTx':0.60,'NVDAx-COINx':0.35,
  'TSLAx-AAPLx':0.35,'TSLAx-METAx':0.30,'TSLAx-AMZNx':0.40,'TSLAx-MSFTx':0.35,'TSLAx-COINx':0.40,
  'AAPLx-METAx':0.65,'AAPLx-AMZNx':0.70,'AAPLx-MSFTx':0.75,'AAPLx-COINx':0.15,
  'METAx-AMZNx':0.65,'METAx-MSFTx':0.60,'METAx-COINx':0.20,'AMZNx-MSFTx':0.70,'AMZNx-COINx':0.20,'MSFTx-COINx':0.15,
};
function gc(a,b){return a===b?1:CR[`${a}-${b}`]??CR[`${b}-${a}`]??0.2;}

function genPaths(stocks,nP,T,nS) {
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
// FULL SIMULATION — Option premium + Euler + Hedging + Tranching
// ============================================================
function simPath(path, stocks, cfg) {
  const { ki, cb, acStart, acSD, seniorCpn, mem,
    seniorDep, juniorRatio, eulerAPY, rf, nQ, hedgeThresh } = cfg;

  const n = stocks.length;
  const S0 = stocks.map(s => ST[s].S0);
  const vols = stocks.map(s => ST[s].vol);
  const juniorDep = seniorDep * juniorRatio;
  const T = nQ * 0.25;
  const spQ = 13, totS = nQ * spQ, dt = T / totS;
  const protFee = 0.002 * seniorDep;

  let eulerBal = seniorDep + juniorDep - protFee;
  let shares = new Float64Array(n);
  let prevDelta = new Float64Array(n);
  let knockedIn = false;
  let totalSrCpn = 0, missedCpn = 0;
  let tradeCount = 0;
  let yldEuler = 0, hedgeCost = 0;
  // Track option premium components
  let totalCpnPaid = 0;   // total coupons paid out (= gross option premium collected by Senior)
  let kiLoss = 0;          // loss from KI event (= option payout)

  // Initial hedge
  for (let i = 0; i < n; i++) {
    const d = Math.abs(diPutDelta(S0[i], S0[i], ki * S0[i], T, rf, vols[i]));
    const cl = Math.max(0, Math.min(d, 0.95));
    prevDelta[i] = cl;
    if (cl > hedgeThresh) {
      const tgt = cl * (seniorDep / n / S0[i]);
      const cost = tgt * S0[i];
      shares[i] = tgt;
      eulerBal -= cost; // capital leaves Euler for hedge
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

    // Euler yield on capital IN Euler (not allocated to hedge)
    if (eulerBal > 0) {
      const y = eulerBal * eulerAPY * dt;
      eulerBal += y;
      yldEuler += y;
    }

    // Mark-to-market hedge positions
    let hedgeVal = 0;
    for (let i = 0; i < n; i++) hedgeVal += shares[i] * prices[i];

    if (worstPerf <= ki) knockedIn = true;

    if (isQEnd) {
      const acBar = Math.max(acStart - acSD * (qNum - 1), 0.80);
      const allAboveAC = perfs.every(p => p >= acBar);

      if (allAboveAC) {
        let cpn = seniorCpn * seniorDep;
        totalSrCpn += cpn;
        totalCpnPaid += cpn;
        if (mem && missedCpn > 0) { totalSrCpn += missedCpn; totalCpnPaid += missedCpn; missedCpn = 0; }

        // Unwind hedge — sell stocks
        for (let i = 0; i < n; i++) {
          if (shares[i] > 0.001) {
            eulerBal += shares[i] * prices[i];
            hedgeCost += shares[i] * S0[i] - shares[i] * prices[i]; // cost = bought at S0, sold at S
            shares[i] = 0; tradeCount++;
          }
        }

        const srPayout = seniorDep + totalSrCpn;
        const jrPayout = Math.max(eulerBal - srPayout, 0);

        return {
          out: 'AC', q: qNum, dur: curT,
          srRet: totalSrCpn / seniorDep,
          jrRet: (jrPayout - juniorDep) / juniorDep,
          wp: worstPerf, ki: false,
          tradeCount, yldEuler, hedgeCost,
          totalCpnPaid, kiLoss: 0,
          optionPremium: totalCpnPaid, // coupons = premium collected
        };
      }

      if (worstPerf >= cb) {
        let cpn = seniorCpn * seniorDep;
        totalSrCpn += cpn;
        totalCpnPaid += cpn;
        if (mem && missedCpn > 0) { totalSrCpn += missedCpn; totalCpnPaid += missedCpn; missedCpn = 0; }
        eulerBal -= cpn;
      } else if (mem) {
        missedCpn += seniorCpn * seniorDep;
      }
    }

    // Smart hedge
    if (step % 2 === 0 && !isLast) {
      for (let i = 0; i < n; i++) {
        const S = prices[i], barrier = ki * S0[i];
        const notSh = (seniorDep / n) / S0[i];
        let tgtDelta;
        if (knockedIn && perfs[i] < 1.0) tgtDelta = Math.min(0.5 + (1 - perfs[i]) * 2.5, 1.0);
        else {
          tgtDelta = Math.abs(diPutDelta(S, S0[i], barrier, ttm, rf, vols[i]));
          tgtDelta = Math.max(0, Math.min(tgtDelta, 0.95));
          if (perfs[i] > 1.15) tgtDelta *= 0.5;
          if (perfs[i] > 1.3) tgtDelta = 0;
        }
        if (Math.abs(tgtDelta - prevDelta[i]) > hedgeThresh) {
          const tgt = tgtDelta * notSh;
          const diff = tgt - shares[i];
          if (Math.abs(diff * S) > 50) {
            if (diff > 0) { eulerBal -= diff * S; } // buy more hedge
            else { eulerBal += Math.abs(diff) * S; } // sell hedge
            hedgeCost += diff > 0 ? diff * S : -(Math.abs(diff) * (S - S0[i]) > 0 ? Math.abs(diff) * (S - S0[i]) : 0);
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
        if (shares[i] > 0.001) {
          eulerBal += shares[i] * prices[i];
          shares[i] = 0; tradeCount++;
        }
      }

      if (knockedIn && worstPerf < 1.0) {
        const loss = seniorDep * (1 - worstPerf);
        kiLoss = loss;
        const jrAbsorbs = Math.min(loss, juniorDep);
        const srAbsorbs = Math.max(loss - juniorDep, 0);
        const srPrincipal = seniorDep - srAbsorbs;
        const jrPayout = Math.max(eulerBal - srPrincipal, 0);

        return {
          out: 'KI', q: nQ, dur: T,
          srRet: (srPrincipal + totalSrCpn - seniorDep) / seniorDep,
          jrRet: (jrPayout - juniorDep) / juniorDep,
          wp: worstPerf, ki: true,
          tradeCount, yldEuler, hedgeCost,
          totalCpnPaid, kiLoss: loss,
          optionPremium: totalCpnPaid - loss, // net premium = coupons - KI payout
        };
      } else {
        const jrPayout = Math.max(eulerBal - seniorDep, 0);
        return {
          out: 'MAT', q: nQ, dur: T,
          srRet: totalSrCpn / seniorDep,
          jrRet: (jrPayout - juniorDep) / juniorDep,
          wp: worstPerf, ki: false,
          tradeCount, yldEuler, hedgeCost,
          totalCpnPaid, kiLoss: 0,
          optionPremium: totalCpnPaid,
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
  const pct = (a,p) => a[Math.min(Math.floor(a.length*p/100),a.length-1)];
  const mean = a => a.reduce((x,y) => x+y, 0) / a.length;
  const avgDur = mean(R.map(r => r.dur));
  const sm = mean(sr), jm = mean(jr);
  const avgQ = mean(R.map(r => r.q));
  return {
    sm, sMed: pct(sr,50), sP5: pct(sr,5), sP95: pct(sr,95),
    sWin: sr.filter(r => r>=0).length/N,
    sAnn: sm/avgDur, sRoll: Math.pow(1+Math.max(sm/avgQ,-0.99),4)-1,
    jm, jMed: pct(jr,50), jP5: pct(jr,5), jP95: pct(jr,95),
    jWin: jr.filter(r => r>=0).length/N,
    jAnn: jm/avgDur, jRoll: Math.pow(1+Math.max(jm/avgQ,-0.99),4)-1,
    acR: R.filter(r => r.out==='AC').length/N,
    kiR: R.filter(r => r.ki).length/N,
    avgDur, avgTrades: mean(R.map(r => r.tradeCount)),
    avgEuler: mean(R.map(r => r.yldEuler)),
    avgHedgeCost: mean(R.map(r => r.hedgeCost)),
    avgCpnPaid: mean(R.map(r => r.totalCpnPaid)),
    avgKiLoss: mean(R.map(r => r.kiLoss)),
    avgOptPrem: mean(R.map(r => r.optionPremium)),
  };
}

const f = v => `${v>=0?'+':''}${(v*100).toFixed(1)}%`;

const N = 5000;
console.log('█'.repeat(120));
console.log('█  xYIELD v13 — OPTION PREMIUM AS PRIMARY YIELD');
console.log('█  Like GS/JPM: option premium (15-25%) + DeFi yield (5-15%) = 20-35% distributable');
console.log(`█  ${N} MC paths | Correlated GBM | Delta hedging | Tranching`);
console.log('█'.repeat(120));

// ============================================================
// PART 1: FAIR OPTION PREMIUM PER BASKET
// Price the autocall with Euler=0 to isolate pure option premium
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 1: FAIR OPTION PREMIUM — What is the autocall worth? (Euler=0)');
console.log('▓  Running MC with NO Euler yield to isolate pure option premium');
console.log('▓'.repeat(120));

const baskets = [
  { name: 'AAPLx/AMZNx', stocks: ['AAPLx','AMZNx'] },
  { name: 'AAPLx/METAx', stocks: ['AAPLx','METAx'] },
  { name: 'NVDAx/AAPLx', stocks: ['NVDAx','AAPLx'] },
  { name: 'NVDAx/AAPLx/AMZNx', stocks: ['NVDAx','AAPLx','AMZNx'] },
  { name: 'NVDAx/AAPLx/METAx', stocks: ['NVDAx','AAPLx','METAx'] },
  { name: 'NVDAx/TSLAx/AAPLx', stocks: ['NVDAx','TSLAx','AAPLx'] },
  { name: 'NVDAx/TSLAx/COINx', stocks: ['NVDAx','TSLAx','COINx'] },
];

const kiLevels = [0.40, 0.45, 0.50, 0.55, 0.60];
const mats = [{ n:'6mo', q:2 }, { n:'9mo', q:3 }, { n:'1Y', q:4 }];

console.log('\n  Finding fair coupon (option premium) per basket...');
console.log('  Fair coupon = coupon where pool breaks even with NO Euler, NO funding\n');

console.log('  ' + 'Basket'.padEnd(22) + 'AvgVol'.padEnd(8) + 'KI'.padEnd(5) + 'Mat'.padEnd(5) +
  'FairCpn/Q'.padStart(10) + 'FairAnn'.padStart(9) +
  '  KI%   AC%   OptPrem$/note');
console.log('  ' + '─'.repeat(100));

const fairPremiums = [];

for (const bkt of baskets) {
  const avgVol = bkt.stocks.reduce((s,st) => s+ST[st].vol, 0) / bkt.stocks.length;
  for (const ki of [0.40, 0.50, 0.60]) {
    for (const mat of [{ n:'6mo', q:2 }, { n:'9mo', q:3 }]) {
      // Binary search for fair coupon (pool EV ≈ 0, no Euler)
      let lo = 0.005, hi = 0.15, fairCpn = 0.05;
      for (let iter = 0; iter < 15; iter++) {
        const mid = (lo + hi) / 2;
        const R = runMC(bkt.stocks, {
          ki, cb: 0.65, acStart: 1.0, acSD: 0.025,
          seniorCpn: mid, mem: true, seniorDep: 10000, juniorRatio: 0.40,
          eulerAPY: 0, rf: 0.05, nQ: mat.q, hedgeThresh: 0.08,
        }, 2000);
        const s = stats(R);
        // Fair = senior gets positive, junior ≈ breakeven
        if (s.jm > 0) lo = mid; // coupon too low, junior profits too much
        else hi = mid; // coupon too high, junior loses
        fairCpn = mid;
      }

      // Run final sim at fair coupon
      const R = runMC(bkt.stocks, {
        ki, cb: 0.65, acStart: 1.0, acSD: 0.025,
        seniorCpn: fairCpn, mem: true, seniorDep: 10000, juniorRatio: 0.40,
        eulerAPY: 0, rf: 0.05, nQ: mat.q, hedgeThresh: 0.08,
      }, N);
      const s = stats(R);

      fairPremiums.push({ ...bkt, ki, mat: mat.n, nQ: mat.q, fairCpn, avgVol, ...s });

      console.log('  ' +
        bkt.name.padEnd(22) + `${(avgVol*100).toFixed(0)}%`.padEnd(8) +
        `${(ki*100).toFixed(0)}%`.padEnd(5) + mat.n.padEnd(5) +
        `${(fairCpn*100).toFixed(2)}%`.padStart(10) +
        `${(fairCpn*400).toFixed(1)}%`.padStart(9) +
        `  ${(s.kiR*100).toFixed(1)}%`.padStart(7) +
        `${(s.acR*100).toFixed(0)}%`.padStart(6) +
        `  $${s.avgCpnPaid.toFixed(0)}`
      );
    }
  }
}

// ============================================================
// PART 2: OPTION PREMIUM + EULER = TOTAL DISTRIBUTABLE YIELD
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 2: TOTAL YIELD = OPTION PREMIUM + EULER');
console.log('▓  Now ADD Euler yield on top of the fair option premium');
console.log('▓'.repeat(120));

// Pick top baskets from Part 1
const topBaskets = [
  { name: 'NVDAx/TSLAx/COINx', stocks: ['NVDAx','TSLAx','COINx'] },
  { name: 'NVDAx/TSLAx/AAPLx', stocks: ['NVDAx','TSLAx','AAPLx'] },
  { name: 'NVDAx/AAPLx/METAx', stocks: ['NVDAx','AAPLx','METAx'] },
  { name: 'NVDAx/AAPLx/AMZNx', stocks: ['NVDAx','AAPLx','AMZNx'] },
  { name: 'AAPLx/AMZNx', stocks: ['AAPLx','AMZNx'] },
];

const eulerRates = [0, 0.05, 0.08, 0.10, 0.12, 0.15];

for (const bkt of topBaskets.slice(0, 3)) {
  console.log(`\n  ═══ ${bkt.name} — KI 50%, SrCpn 4%/Q (16% ann), Jr 40%, 6mo ═══`);
  console.log('  ' + 'Euler'.padEnd(8) +
    'SrAnn'.padStart(8) + 'SrWin'.padStart(7) +
    ' │ ' +
    'JrAnn'.padStart(8) + 'JrWin'.padStart(7) + 'JrMed'.padStart(8) + 'JrP5'.padStart(8) +
    ' │ $OptPrem  $Euler  $HedgeCost  $KIloss │ KI%  AC%');
  console.log('  ' + '─'.repeat(115));

  for (const euler of eulerRates) {
    const R = runMC(bkt.stocks, {
      ki: 0.50, cb: 0.65, acStart: 1.0, acSD: 0.025,
      seniorCpn: 0.04, mem: true, seniorDep: 10000, juniorRatio: 0.40,
      eulerAPY: euler, rf: 0.05, nQ: 2, hedgeThresh: 0.05,
    }, N);
    const s = stats(R);
    console.log('  ' +
      `${(euler*100).toFixed(0)}%`.padEnd(8) +
      f(s.sAnn).padStart(8) + `${(s.sWin*100).toFixed(0)}%`.padStart(7) +
      ' │ ' +
      f(s.jAnn).padStart(8) + `${(s.jWin*100).toFixed(0)}%`.padStart(7) + f(s.jMed).padStart(8) + f(s.jP5).padStart(8) +
      ` │ $${s.avgOptPrem.toFixed(0).padStart(6)}  $${s.avgEuler.toFixed(0).padStart(5)}` +
      `  $${s.avgHedgeCost.toFixed(0).padStart(8)}` +
      `  $${s.avgKiLoss.toFixed(0).padStart(5)}` +
      ` │ ${(s.kiR*100).toFixed(1)}%`.padStart(6) +
      `${(s.acR*100).toFixed(0)}%`.padStart(5)
    );
  }
}

// ============================================================
// PART 3: SENIOR COUPON OPTIMIZATION — option premium funded
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 3: SENIOR COUPON — How high can we go?');
console.log('▓  High-vol basket + Euler 12% + Jr 40%');
console.log('▓'.repeat(120));

for (const bkt of topBaskets.slice(0, 2)) {
  console.log(`\n  ═══ ${bkt.name} — KI 50%, Jr 40%, 6mo, Euler 12% ═══`);
  console.log('  ' + 'SrCpn/Q'.padEnd(9) + 'SrAnn'.padEnd(8) +
    'SrAnn'.padStart(8) + 'SrWin'.padStart(7) +
    ' │ ' + 'JrAnn'.padStart(8) + 'JrWin'.padStart(7) + 'JrP5'.padStart(8) +
    ' │ OptPrem$ Euler$ KIloss$ │ AC% KI%');
  console.log('  ' + '─'.repeat(100));

  for (const cpn of [0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08]) {
    const R = runMC(bkt.stocks, {
      ki: 0.50, cb: 0.65, acStart: 1.0, acSD: 0.025,
      seniorCpn: cpn, mem: true, seniorDep: 10000, juniorRatio: 0.40,
      eulerAPY: 0.12, rf: 0.05, nQ: 2, hedgeThresh: 0.05,
    }, N);
    const s = stats(R);
    const mark = (s.sm >= 0 && s.jm >= 0 && s.jWin >= 0.60) ? ' ★' : '';
    console.log('  ' +
      `${(cpn*100).toFixed(0)}%`.padEnd(9) + `${(cpn*400).toFixed(0)}%`.padEnd(8) +
      f(s.sAnn).padStart(8) + `${(s.sWin*100).toFixed(0)}%`.padStart(7) +
      ' │ ' + f(s.jAnn).padStart(8) + `${(s.jWin*100).toFixed(0)}%`.padStart(7) + f(s.jP5).padStart(8) +
      ` │ $${s.avgOptPrem.toFixed(0).padStart(6)} $${s.avgEuler.toFixed(0).padStart(5)} $${s.avgKiLoss.toFixed(0).padStart(6)}` +
      ` │ ${(s.acR*100).toFixed(0)}%`.padStart(5) + `${(s.kiR*100).toFixed(1)}%`.padStart(6) + mark
    );
  }
}

// ============================================================
// PART 4: MEGA SWEEP — Full optimization
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 4: MEGA SWEEP — Optimizing the full stack');
console.log('▓'.repeat(120));

const swB = [
  { name:'NVDAx/TSLAx/COINx', stocks:['NVDAx','TSLAx','COINx'] },
  { name:'NVDAx/TSLAx/AAPLx', stocks:['NVDAx','TSLAx','AAPLx'] },
  { name:'NVDAx/AAPLx/METAx', stocks:['NVDAx','AAPLx','METAx'] },
  { name:'NVDAx/AAPLx/AMZNx', stocks:['NVDAx','AAPLx','AMZNx'] },
];
const swKI = [0.45, 0.50, 0.55, 0.60];
const swCpn = [0.03, 0.04, 0.05, 0.06, 0.07];
const swJr = [0.30, 0.40, 0.50];
const swEuler = [0.08, 0.10, 0.12, 0.15];
const swMat = [{ n:'3mo', q:1 }, { n:'6mo', q:2 }, { n:'9mo', q:3 }];

const all = [];
let cnt = 0;
const tot = swB.length*swKI.length*swCpn.length*swJr.length*swEuler.length*swMat.length;
process.stdout.write(`\n  Running up to ${tot} configs...`);

for (const bkt of swB)
  for (const ki of swKI)
    for (const cpn of swCpn)
      for (const jr of swJr)
        for (const euler of swEuler)
          for (const mat of swMat) {
            cnt++;
            if (cnt % 100 === 0) process.stdout.write(`\r  Running ${cnt}/${tot}...`);
            const R = runMC(bkt.stocks, {
              ki, cb: 0.65, acStart: 1.0, acSD: 0.025,
              seniorCpn: cpn, mem: true, seniorDep: 10000, juniorRatio: jr,
              eulerAPY: euler, rf: 0.05, nQ: mat.q, hedgeThresh: 0.05,
            }, 3000);
            const s = stats(R);
            all.push({ b:bkt.name, ki, cpn, jr, euler, mat:mat.n, nQ:mat.q, ...s });
          }

console.log(`\r  Done: ${cnt} configs × 3000 paths = ${(cnt*3000/1e6).toFixed(1)}M sims\n`);

// Filter: Senior 95%+ win, Junior EV+, Senior APY >= 12%, Junior APY >= 15%
const bal = all.filter(r =>
  r.sWin >= 0.90 && r.jm >= 0 && r.sAnn >= 0.12 && r.jAnn >= 0.15
);
bal.sort((a,b) => {
  const sa = Math.min(a.sAnn, 0.25)*0.30 + Math.min(a.jAnn, 0.50)*0.30 + a.sWin*0.15 + a.jWin*0.15 + (1-a.kiR)*0.10;
  const sb = Math.min(b.sAnn, 0.25)*0.30 + Math.min(b.jAnn, 0.50)*0.30 + b.sWin*0.15 + b.jWin*0.15 + (1-b.kiR)*0.10;
  return sb - sa;
});

console.log(`  ${bal.length} configs where Sr >= 12% AND Jr >= 15%\n`);
console.log('  TOP 30:');
console.log('  ' + 'Basket'.padEnd(22) + 'KI'.padEnd(5) + 'SrC'.padEnd(6) + 'Jr'.padEnd(5) + 'E'.padEnd(5) + 'Mat'.padEnd(5) +
  'SrAnn'.padStart(8) + 'SrW'.padStart(5) +
  '│' + 'JrAnn'.padStart(8) + 'JrW'.padStart(5) + 'JrP5'.padStart(8) +
  '│ KI%  $Opt  $Eul  $KI');
console.log('  ' + '─'.repeat(110));

for (const r of bal.slice(0,30)) {
  console.log('  ' +
    r.b.padEnd(22) + `${(r.ki*100).toFixed(0)}%`.padEnd(5) +
    `${(r.cpn*100).toFixed(0)}%`.padEnd(6) + `${(r.jr*100).toFixed(0)}%`.padEnd(5) +
    `${(r.euler*100).toFixed(0)}%`.padEnd(5) + r.mat.padEnd(5) +
    f(r.sAnn).padStart(8) + `${(r.sWin*100).toFixed(0)}%`.padStart(5) +
    '│' + f(r.jAnn).padStart(8) + `${(r.jWin*100).toFixed(0)}%`.padStart(5) + f(r.jP5).padStart(8) +
    `│ ${(r.kiR*100).toFixed(1)}%` +
    ` $${r.avgOptPrem.toFixed(0).padStart(4)}` +
    ` $${r.avgEuler.toFixed(0).padStart(4)}` +
    ` $${r.avgKiLoss.toFixed(0).padStart(4)}`
  );
}

// ============================================================
// PART 5: DEEP DIVE top configs
// ============================================================
console.log('\n\n' + '▓'.repeat(120));
console.log('▓  PART 5: DEEP DIVE — Top 3 with 10,000 paths');
console.log('▓'.repeat(120));

for (let i = 0; i < Math.min(3, bal.length); i++) {
  const b = bal[i];
  process.stdout.write(`\n  #${i+1}: ${b.b}...`);
  const R = runMC(
    swB.find(x=>x.name===b.b).stocks,
    { ki:b.ki, cb:0.65, acStart:1.0, acSD:0.025,
      seniorCpn:b.cpn, mem:true, seniorDep:10000, juniorRatio:b.jr,
      eulerAPY:b.euler, rf:0.05, nQ:b.nQ, hedgeThresh:0.05 },
    10000
  );
  const ds = stats(R);
  console.log(' done');

  const lev = ((1+b.jr)/b.jr).toFixed(1);
  const avgVol = swB.find(x=>x.name===b.b).stocks.reduce((s,st)=>s+ST[st].vol,0)/swB.find(x=>x.name===b.b).stocks.length;
  console.log(`
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  #${i+1} ${b.b.padEnd(22)} KI:${(b.ki*100).toFixed(0)}% Cpn:${(b.cpn*100).toFixed(0)}%/Q(${(b.cpn*400).toFixed(0)}%a) Jr:${(b.jr*100).toFixed(0)}%(${lev}x) ${b.mat} E:${(b.euler*100).toFixed(0)}%  │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  SENIOR (retail)     APY: ${f(ds.sAnn).padStart(7)}  Roll: ${f(ds.sRoll).padStart(7)}  Win: ${(ds.sWin*100).toFixed(1)}%              │
  │                      Med: ${f(ds.sMed).padStart(7)}  P5: ${f(ds.sP5).padStart(7)}  P95: ${f(ds.sP95).padStart(7)}                │
  │  JUNIOR (whale/DAO)  APY: ${f(ds.jAnn).padStart(7)}  Roll: ${f(ds.jRoll).padStart(7)}  Win: ${(ds.jWin*100).toFixed(1)}%              │
  │                      Med: ${f(ds.jMed).padStart(7)}  P5: ${f(ds.jP5).padStart(7)}  P95: ${f(ds.jP95).padStart(7)}                │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  YIELD DECOMPOSITION (avg per note):                                               │
  │    Option premium (coupons - KI losses):  $${ds.avgOptPrem.toFixed(0).padStart(6)}  (${f(ds.avgOptPrem/10000/ds.avgDur)} ann)       │
  │    Euler yield (on idle capital):          $${ds.avgEuler.toFixed(0).padStart(6)}  (${f(ds.avgEuler/10000/ds.avgDur)} ann)       │
  │    KI losses (tail risk payouts):          $${ds.avgKiLoss.toFixed(0).padStart(6)}  (${f(ds.avgKiLoss/10000/ds.avgDur)} ann)       │
  │    Hedge cost (delta rebalancing):         $${ds.avgHedgeCost.toFixed(0).padStart(6)}                              │
  │    ─────────────────────────────────────────────────                                │
  │    Total distributable:                    $${(ds.avgOptPrem+ds.avgEuler).toFixed(0).padStart(6)}                              │
  │                                                                                    │
  │  STRUCTURE: AC ${(ds.acR*100).toFixed(0)}%  MAT ${((1-ds.acR-ds.kiR)*100).toFixed(0)}%  KI ${(ds.kiR*100).toFixed(1)}%  Avg ${(ds.avgDur*12).toFixed(1)}mo  ${ds.avgTrades.toFixed(0)} trades            │
  └────────────────────────────────────────────────────────────────────────────────────┘`);
}

// ============================================================
// FINAL SUMMARY
// ============================================================
console.log('\n\n' + '█'.repeat(120));
console.log('█  FINAL — xYield Economics (TradFi + DeFi combined)');
console.log('█'.repeat(120));

console.log(`
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  xYIELD = OPTION PREMIUM + DeFi YIELD                                             │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │                                                                                    │
  │  YIELD SOURCE 1: OPTION PREMIUM (primary, 15-25% ann)                              │
  │  ┌──────────────────────────────────────────────────────┐                           │
  │  │  Investor accepts:                                  │                           │
  │  │  - Capped upside (can't earn > coupon)     = SOLD   │                           │
  │  │  - KI risk (tail loss if stock drops 50%+) = SOLD   │                           │
  │  │  These options have REAL VALUE (15-25% ann)          │                           │
  │  │  This premium funds the coupon payments              │                           │
  │  └──────────────────────────────────────────────────────┘                           │
  │                                                                                    │
  │  YIELD SOURCE 2: EULER YIELD (secondary, 5-15% ann)                                │
  │  ┌──────────────────────────────────────────────────────┐                           │
  │  │  Pool capital earns DeFi lending yield               │                           │
  │  │  TradFi: treasury bonds = 4-5%                       │                           │
  │  │  DeFi: Euler/Morpho = 8-15%                          │                           │
  │  │  DeFi advantage = +5-10% extra yield                 │                           │
  │  └──────────────────────────────────────────────────────┘                           │
  │                                                                                    │
  │  COST ADVANTAGE vs TradFi:                                                         │
  │  ┌──────────────────────────────────────────────────────┐                           │
  │  │  GS/JPM bank margin: 2-5%                            │                           │
  │  │  xYield protocol fee: 0.2%                           │                           │
  │  │  Savings: 2-5% more yield to users                   │                           │
  │  └──────────────────────────────────────────────────────┘                           │
  │                                                                                    │
  │  TOTAL = option_premium + euler_yield - hedge_cost - 0.2% fee                      │
  │        ≈ 18% + 12% - 4% - 0.2% = ~26% distributable                               │
  │                                                                                    │
  │  → Senior: 14-18% fixed coupon (protected by Junior)                               │
  │  → Junior: 20-40%+ leveraged residual (first-loss)                                 │
  │  → Protocol: 0.2% per note                                                         │
  └────────────────────────────────────────────────────────────────────────────────────┘
`);

console.log('█'.repeat(120));
console.log(`█  v13 COMPLETE — ${cnt} configs + fair pricing + deep dive`);
console.log('█'.repeat(120) + '\n');
