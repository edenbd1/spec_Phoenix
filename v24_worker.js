// v24_worker.js — MC simulation worker for parallel overnight sweep
// Runs inside worker_threads, receives batches of configs, returns results

const { parentPort, workerData } = require('worker_threads');

// ─── MATH CORE ─────────────────────────────────────────────────────────────

function normalCDF(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign=x<0?-1:1,t=1/(1+p*Math.abs(x));
  return 0.5*(1+sign*(1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x/2)));
}

function diPutPx(S,K,H,T,r,sig) {
  if(T<=0.001) return S<=H?Math.max(K-S,0):0;
  if(S<=H) {
    const sq=Math.sqrt(T),d1=(Math.log(S/K)+(r+sig*sig/2)*T)/(sig*sq);
    return K*Math.exp(-r*T)*normalCDF(-(d1-sig*sq))-S*normalCDF(-d1);
  }
  if(S<=0.001||sig<=0.001) return 0;
  const sq=Math.sqrt(T),lam=(r+sig*sig/2)/(sig*sig);
  const x1=Math.log(S/H)/(sig*sq)+lam*sig*sq;
  const y=Math.log(H*H/(S*K))/(sig*sq)+lam*sig*sq;
  const y1=Math.log(H/S)/(sig*sq)+lam*sig*sq;
  const p2l=Math.pow(H/S,2*lam),p2l2=Math.pow(H/S,2*lam-2),disc=Math.exp(-r*T);
  return Math.max(
    -S*normalCDF(-x1)+K*disc*normalCDF(-x1+sig*sq)
    +S*p2l*(normalCDF(y)-normalCDF(y1))
    -K*disc*p2l2*(normalCDF(y-sig*sq)-normalCDF(y1-sig*sq)),0);
}

function diPutDelta(S,K,H,T,r,sig) {
  if(T<=0.001) return S<=K?-1:0;
  if(S<=H) { const sq=Math.sqrt(T); return normalCDF((Math.log(S/K)+(r+sig*sig/2)*T)/(sig*sq))-1; }
  const eps=S*0.005;
  return (diPutPx(S+eps,K,H,T,r,sig)-diPutPx(S-eps,K,H,T,r,sig))/(2*eps);
}

let _sp=null;
function randn(){ if(_sp!==null){const v=_sp;_sp=null;return v;} let u,v,s; do{u=Math.random()*2-1;v=Math.random()*2-1;s=u*u+v*v;}while(s>=1||s===0); const m=Math.sqrt(-2*Math.log(s)/s);_sp=v*m;return u*m; }

function cholesky(M){
  const n=M.length,L=Array.from({length:n},()=>new Float64Array(n));
  for(let i=0;i<n;i++) for(let j=0;j<=i;j++){let s=0;for(let k=0;k<j;k++)s+=L[i][k]*L[j][k];L[i][j]=i===j?Math.sqrt(Math.max(M[i][i]-s,1e-10)):(M[i][j]-s)/L[j][j];}
  return L;
}

// ─── UNIVERSE ──────────────────────────────────────────────────────────────

const BASE_STOCKS = {
  NVDAx:{S0:183.14, impliedVol:0.55},
  TSLAx:{S0:395.01, impliedVol:0.60},
  AMDx: {S0:115,    impliedVol:0.50},
  METAx:{S0:638.27, impliedVol:0.38},
  AAPLx:{S0:255.76, impliedVol:0.28},
  AMZNx:{S0:225,    impliedVol:0.35},
};

const BASE_CORR = {
  'NVDAx-TSLAx':0.45,'NVDAx-AMDx':0.70,'NVDAx-METAx':0.55,'NVDAx-AAPLx':0.60,'NVDAx-AMZNx':0.55,
  'TSLAx-AMDx':0.40,'TSLAx-METAx':0.30,'TSLAx-AAPLx':0.35,'TSLAx-AMZNx':0.30,
  'AMDx-METAx':0.50,'AMDx-AAPLx':0.55,'AMDx-AMZNx':0.55,
  'METAx-AAPLx':0.65,'METAx-AMZNx':0.65,'AAPLx-AMZNx':0.70,
};

// ─── REGIME MODIFIERS ─────────────────────────────────────────────────────

const VOL_REGIMES = {
  low:    { volMult: 0.70, driftOverride: null },
  normal: { volMult: 1.00, driftOverride: null },
  high:   { volMult: 1.30, driftOverride: null },
  crash:  { volMult: 1.80, driftOverride: -0.30 },
};

const CORR_REGIMES = {
  normal:  { corrShift: 0.00 },
  spike:   { corrShift: 0.25 },
  decorr:  { corrShift: -0.25 },
};

// Historical regime proxies (mapped to vol/drift adjustments)
const HIST_REGIMES = {
  '2018_correction': { volMult: 1.10, driftOverride: -0.08, corrShift: 0.10 },
  '2020_crash':      { volMult: 1.80, driftOverride: -0.35, corrShift: 0.30 },
  '2021_bull':       { volMult: 0.65, driftOverride: 0.40,  corrShift: -0.05 },
  '2022_bear':       { volMult: 1.40, driftOverride: -0.25, corrShift: 0.20 },
  '2023_recovery':   { volMult: 0.85, driftOverride: 0.20,  corrShift: 0.00 },
};

function getCorr(a, b, corrShift) {
  if (a === b) return 1;
  const base = BASE_CORR[`${a}-${b}`] ?? BASE_CORR[`${b}-${a}`] ?? 0.20;
  return Math.max(-0.50, Math.min(0.95, base + corrShift));
}

// ─── PATH GENERATION ─────────────────────────────────────────────────────

function genPaths(stocks, nP, T, totalSteps, vrp, volMult, corrShift, driftOverride) {
  const n = stocks.length, dt = T / totalSteps, sq = Math.sqrt(dt);
  const pv = stocks.map(s => BASE_STOCKS[s].impliedVol * (volMult || 1) * (1 - (vrp || 0)));
  const drift = driftOverride != null ? driftOverride : 0.05; // rf default
  const C = Array.from({length:n}, (_,i) => Array.from({length:n}, (_,j) => getCorr(stocks[i], stocks[j], corrShift || 0)));
  const L = cholesky(C);
  const S0 = stocks.map(s => BASE_STOCKS[s].S0);
  const paths = [];
  for (let p = 0; p < nP; p++) {
    const raw = stocks.map((_,i) => { const a = new Float64Array(totalSteps+1); a[0] = S0[i]; return a; });
    for (let t = 0; t < totalSteps; t++) {
      const z = []; for (let i = 0; i < n; i++) z.push(randn());
      const w = new Float64Array(n); for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) w[i] += L[i][j] * z[j];
      for (let i = 0; i < n; i++) raw[i][t+1] = raw[i][t] * Math.exp((drift - 0.5*pv[i]**2)*dt + pv[i]*sq*w[i]);
    }
    paths.push(raw);
  }
  return paths;
}

// ─── SIMULATION ─────────────────────────────────────────────────────────────

function woDeltas(stocks, prices, S0, ki, ttm, rf, volMult) {
  const n = stocks.length, perfs = prices.map((p,i) => p/S0[i]), wp = Math.min(...perfs);
  const ds = new Float64Array(n), alpha = 8;
  for (let i = 0; i < n; i++) {
    const iv = BASE_STOCKS[stocks[i]].impliedVol * (volMult || 1);
    let bd;
    if (ttm <= 0.001) bd = 0;
    else { bd = Math.abs(diPutDelta(prices[i], S0[i], ki*S0[i], ttm, rf, iv)); bd = Math.max(0, Math.min(bd, 0.95)); if (perfs[i]>1.15) bd*=0.5; if (perfs[i]>1.30) bd=0; }
    ds[i] = bd * Math.exp(-alpha * (perfs[i] - wp));
  }
  return ds;
}

function simPath(path, stocks, cfg, volMult) {
  const { ki, cb, acStart, acSD, cpnPerPeriod, seniorDep, juniorRatio, rf, nObs, obsFreq, deltaThresh, stepsPerDay, acStartObs } = cfg;
  const n = stocks.length, S0 = stocks.map(s => BASE_STOCKS[s].S0), juniorDep = seniorDep * juniorRatio, poolSize = seniorDep + juniorDep;
  const T = nObs * obsFreq, totalSteps = Math.round(T * 252 * stepsPerDay), dt = T / totalSteps;

  function obsAt(step) {
    const ct = step*dt, pt = (step-1)*dt;
    for (let k = 1; k <= nObs; k++) { const to = k*obsFreq; if (pt < to-dt*0.01 && ct >= to-dt*0.01) return k; }
    return null;
  }

  let cash = poolSize * 0.998;
  let ss = new Float64Array(n), se = new Float64Array(n), cd = new Float64Array(n);
  let knockedIn = false, totalCpn = 0, tradeCount = 0, gPnL = 0, cpnCount = 0;

  function rebal(tds, pr) {
    for (let i = 0; i < n; i++) {
      if (Math.abs(tds[i]-cd[i]) <= deltaThresh) continue;
      const ns = seniorDep/n/S0[i], tgt = tds[i]*ns, diff = tgt - ss[i];
      if (Math.abs(diff*pr[i]) < 20) continue;
      if (diff > 0) { const t2 = ss[i]+diff; if (t2 > 0.001) se[i] = (ss[i]*se[i]+diff*pr[i])/t2; }
      else { const c = Math.abs(diff), p = c*se[i]-c*pr[i]; gPnL += p; cash += p; }
      ss[i] = tgt; cd[i] = tds[i]; tradeCount++;
    }
  }

  function unw(pr) {
    for (let i = 0; i < n; i++) {
      if (ss[i] > 0.001) { const p = ss[i]*se[i]-ss[i]*pr[i]; gPnL += p; cash += p; ss[i]=0; se[i]=0; cd[i]=0; tradeCount++; }
    }
  }

  const id = woDeltas(stocks, S0, S0, ki, T, rf, volMult);
  for (let i = 0; i < n; i++) if (id[i] > 0.001) { ss[i] = id[i]*seniorDep/n/S0[i]; se[i] = S0[i]; cd[i] = id[i]; tradeCount++; }

  for (let step = 1; step <= totalSteps; step++) {
    const ct = step*dt, ttm = Math.max(T-ct, 0.001);
    const pr = stocks.map((_,i) => path[i][step]), pf = pr.map((p,i) => p/S0[i]), wp = Math.min(...pf);
    const isL = step === totalSteps;
    if (!knockedIn && wp <= ki) knockedIn = true;
    const ok = obsAt(step);
    if (ok !== null) {
      const isLO = ok === nObs, acBar = Math.max(acStart - acSD*(ok-1), 0.80), canAC = ok >= (acStartObs||2) && !isLO;
      if (canAC && pf.every(p => p >= acBar)) {
        let c = cpnPerPeriod * seniorDep; totalCpn += c; cash -= c; cpnCount++;
        unw(pr);
        const jp = Math.max(cash - seniorDep, 0);
        return { out:'AC', dur:ct, srRet:totalCpn/seniorDep, jrRet:(jp-juniorDep)/juniorDep, ki:false, gPnL, totalCpn, kiLoss:0, cpnCount, tradeCount };
      }
      if (!isLO && wp >= cb) { let c = cpnPerPeriod * seniorDep; totalCpn += c; cash -= c; cpnCount++; }
    }
    if (!isL) { const td = woDeltas(stocks, pr, S0, ki, ttm, rf, volMult); rebal(td, pr); }
    if (isL) {
      if (wp >= cb) { let c = cpnPerPeriod * seniorDep; totalCpn += c; cash -= c; cpnCount++; }
      unw(pr);
      if (knockedIn && wp < 1) {
        const kl = seniorDep * (1-wp); cash -= kl;
        const sp = Math.max(Math.min(seniorDep, cash), 0), jp = Math.max(cash - seniorDep, 0);
        return { out:'KI', dur:T, srRet:(sp+totalCpn-seniorDep)/seniorDep, jrRet:(jp-juniorDep)/juniorDep, ki:true, gPnL, totalCpn, kiLoss:kl, cpnCount, tradeCount };
      } else {
        const jp = Math.max(cash - seniorDep, 0);
        return { out:'MAT', dur:T, srRet:totalCpn/seniorDep, jrRet:(jp-juniorDep)/juniorDep, ki:false, gPnL, totalCpn, kiLoss:0, cpnCount, tradeCount };
      }
    }
  }
}

// ─── AGGREGATE STATS (raw — no Euler/fees, computed post-hoc) ────────────

function computeRawStats(results, cfg) {
  const N = results.length;
  if (N === 0) return null;
  const mean = a => a.reduce((x,y) => x+y, 0) / a.length;
  const pct = (a, p) => { const sorted = [...a].sort((x,y) => x-y); return sorted[Math.min(Math.floor(sorted.length*p/100), sorted.length-1)]; };

  const srRets = results.map(r => r.srRet);
  const jrRets = results.map(r => r.jrRet);
  const durs = results.map(r => r.dur);
  const avgDur = mean(durs);

  return {
    avgSrRet: mean(srRets),
    srP5: pct(srRets, 5),
    srP1: pct(srRets, 1),
    sWin: srRets.filter(r => r >= 0).length / N,
    sAnn: avgDur > 0 ? mean(srRets) / avgDur : 0,
    acR: results.filter(r => r.out === 'AC').length / N,
    kiR: results.filter(r => r.ki).length / N,
    matR: results.filter(r => r.out === 'MAT').length / N,
    avgDur,
    avgGamma: mean(results.map(r => r.gPnL)),
    avgCpn: mean(results.map(r => r.totalCpn)),
    avgKI: mean(results.map(r => r.kiLoss)),
    avgCpnCount: mean(results.map(r => r.cpnCount)),
    // Jr PnL raw (no Euler/fees)
    jrRets,
    durs,
    N,
  };
}

// ─── BATCH PROCESSING ─────────────────────────────────────────────────────

function processBatch(batch) {
  const output = [];
  for (const job of batch) {
    const { id, stocks, cfg, nPaths, vrp, volMult, corrShift, driftOverride } = job;
    const T = cfg.nObs * cfg.obsFreq;
    const ts = Math.round(T * 252 * cfg.stepsPerDay);
    const paths = genPaths(stocks, nPaths, T, ts, vrp, volMult, corrShift, driftOverride);
    const results = paths.map(p => simPath(p, stocks, cfg, volMult)).filter(Boolean);
    const raw = computeRawStats(results, cfg);
    if (!raw) continue;

    // Strip large arrays for transport — compute post-hoc metrics inline
    const jrDep = cfg.seniorDep * cfg.juniorRatio;

    // Compute protocol PnL at multiple Euler/fee levels post-hoc
    // Euler carry ~ poolSize * eulerAPY * avgDur (approx, since cash varies with hedging)
    // More accurate: use avgDur and pool utilization
    const poolSize = cfg.seniorDep + jrDep;
    const poolUtil = 0.85; // approximate pool utilization (15% tied in hedge margin)

    output.push({
      id,
      // Core raw metrics
      sAnn: raw.sAnn,
      sWin: raw.sWin,
      srP5: raw.srP5,
      srP1: raw.srP1,
      acR: raw.acR,
      kiR: raw.kiR,
      matR: raw.matR,
      avgDur: raw.avgDur,
      avgGamma: raw.avgGamma,
      avgCpn: raw.avgCpn,
      avgKI: raw.avgKI,
      avgCpnCount: raw.avgCpnCount,
      N: raw.N,
      // For post-hoc Euler computation
      poolSize,
      jrDep,
      poolUtil,
      // Raw Jr PnL (option-only, no carry/fees) — mean and percentiles
      avgJrPnL: raw.jrRets.reduce((a,b) => a+b, 0) / raw.N * jrDep,
      jrP5: raw.jrRets.sort((a,b) => a-b)[Math.floor(raw.N*0.05)] * jrDep,
      jrP1: raw.jrRets.sort((a,b) => a-b)[Math.floor(raw.N*0.01)] * jrDep,
      jrWin: raw.jrRets.filter(r => r >= 0).length / raw.N,
    });
  }
  return output;
}

// ─── WORKER MAIN ──────────────────────────────────────────────────────────

parentPort.on('message', (msg) => {
  if (msg.type === 'batch') {
    const results = processBatch(msg.jobs);
    parentPort.postMessage({ type: 'results', results, batchId: msg.batchId });
  }
});
