#!/usr/bin/env node
// ============================================================
// xYield v19 — INSTITUTIONAL AUTOCALL ENGINE
//
// Goal: Isolate PURE AUTOCALL PREMIUM from Euler carry.
// Design the best autocall where the STRUCTURE ITSELF generates value.
//
// Key question: Is autocall share > 30-40% of protocol PnL?
// Or is the protocol just a leveraged Euler yield wrapper?
//
// New in v19:
//   - obsFreq (1/12 monthly vs 0.25 quarterly) replaces nQ
//   - Memory coupon as explicit lever
//   - Step-down AC barriers
//   - AC start delay (acStartObs)
//   - kiType: 'continuous' vs 'atMaturity' (European KI)
//   - Pure autocall premium isolation (run with eulerAPY=0)
//   - Dual-run decomposition: option share vs carry share
// ============================================================

// ─── MATH CORE ───────────────────────────────────────────────────────────────

function normalCDF(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign=x<0?-1:1, t=1/(1+p*Math.abs(x));
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
    -K*disc*p2l2*(normalCDF(y-sig*sq)-normalCDF(y1-sig*sq)),
  0);
}

function diPutDelta(S,K,H,T,r,sig) {
  if(T<=0.001) return S<=K?-1:0;
  if(S<=H) {
    const sq=Math.sqrt(T);
    return normalCDF((Math.log(S/K)+(r+sig*sig/2)*T)/(sig*sq))-1;
  }
  const eps=S*0.005;
  return (diPutPx(S+eps,K,H,T,r,sig)-diPutPx(S-eps,K,H,T,r,sig))/(2*eps);
}

let _sp=null;
function randn() {
  if(_sp!==null){const v=_sp;_sp=null;return v;}
  let u,v,s;
  do{u=Math.random()*2-1;v=Math.random()*2-1;s=u*u+v*v;}while(s>=1||s===0);
  const m=Math.sqrt(-2*Math.log(s)/s);_sp=v*m;return u*m;
}

function cholesky(M) {
  const n=M.length,L=Array.from({length:n},()=>new Float64Array(n));
  for(let i=0;i<n;i++) for(let j=0;j<=i;j++) {
    let s=0;for(let k=0;k<j;k++)s+=L[i][k]*L[j][k];
    L[i][j]=i===j?Math.sqrt(Math.max(M[i][i]-s,1e-10)):(M[i][j]-s)/L[j][j];
  }
  return L;
}

// ─── UNIVERSE ────────────────────────────────────────────────────────────────

const ST = {
  NVDAx:{S0:183.14,vol:0.55},  TSLAx:{S0:395.01,vol:0.60},
  COINx:{S0:193.24,vol:0.75},  MSTRx:{S0:350,vol:0.85},
  AMDx:{S0:115,vol:0.50},      METAx:{S0:638.27,vol:0.38},
  AAPLx:{S0:255.76,vol:0.28},  AMZNx:{S0:225,vol:0.35},
};

const CR = {
  'NVDAx-TSLAx':0.45,'NVDAx-COINx':0.35,'NVDAx-MSTRx':0.35,'NVDAx-AMDx':0.70,
  'NVDAx-METAx':0.55,'NVDAx-AAPLx':0.60,'NVDAx-AMZNx':0.55,
  'TSLAx-COINx':0.40,'TSLAx-MSTRx':0.30,'TSLAx-AMDx':0.40,'TSLAx-METAx':0.30,
  'TSLAx-AAPLx':0.35,'TSLAx-AMZNx':0.30,
  'COINx-MSTRx':0.75,'COINx-AMDx':0.25,'COINx-METAx':0.20,'COINx-AAPLx':0.15,'COINx-AMZNx':0.15,
  'MSTRx-AMDx':0.25,'MSTRx-METAx':0.20,'MSTRx-AAPLx':0.15,'MSTRx-AMZNx':0.15,
  'AMDx-METAx':0.50,'AMDx-AAPLx':0.55,'AMDx-AMZNx':0.55,
  'METAx-AAPLx':0.65,'METAx-AMZNx':0.65,
  'AAPLx-AMZNx':0.70,
};
function gc(a,b){return a===b?1:CR[`${a}-${b}`]??CR[`${b}-${a}`]??0.20;}

// ─── PATH GENERATION ─────────────────────────────────────────────────────────

function genPaths(stocks,nP,T,totalSteps) {
  const n=stocks.length,dt=T/totalSteps,sq=Math.sqrt(dt);
  const C=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>gc(stocks[i],stocks[j])));
  const L=cholesky(C),vols=stocks.map(s=>ST[s].vol),S0=stocks.map(s=>ST[s].S0),r=0.05;
  const paths=[];
  for(let p=0;p<nP;p++){
    const path=stocks.map(()=>{const a=new Float64Array(totalSteps+1);a[0]=1;return a;});
    // Store as normalized (price/S0) to save memory, reconstruct on use
    const raw=stocks.map((_,i)=>{const a=new Float64Array(totalSteps+1);a[0]=S0[i];return a;});
    for(let t=0;t<totalSteps;t++){
      const z=[];for(let i=0;i<n;i++)z.push(randn());
      const w=new Float64Array(n);
      for(let i=0;i<n;i++)for(let j=0;j<=i;j++)w[i]+=L[i][j]*z[j];
      for(let i=0;i<n;i++)raw[i][t+1]=raw[i][t]*Math.exp((r-0.5*vols[i]**2)*dt+vols[i]*sq*w[i]);
    }
    paths.push(raw);
  }
  return paths;
}

// ─── WORST-OF DELTAS ─────────────────────────────────────────────────────────

function worstOfDeltas(stocks,prices,S0,vols,ki,ttm,rf,knockedIn) {
  const n=stocks.length,perfs=prices.map((p,i)=>p/S0[i]),wp=Math.min(...perfs);
  const ds=new Float64Array(n),alpha=8.0;
  for(let i=0;i<n;i++){
    let bd;
    if(knockedIn&&perfs[i]<1.0) bd=Math.min(0.5+(1-perfs[i])*2.5,1.0);
    else if(ttm<=0.001) bd=0;
    else {
      bd=Math.abs(diPutDelta(prices[i],S0[i],ki*S0[i],ttm,rf,vols[i]));
      bd=Math.max(0,Math.min(bd,0.95));
      if(perfs[i]>1.15)bd*=0.5;
      if(perfs[i]>1.30)bd=0;
    }
    const gap=perfs[i]-wp;
    ds[i]=bd*Math.exp(-alpha*gap);
  }
  return ds;
}

// ─── SIMULATION ENGINE v19 ───────────────────────────────────────────────────
//
// cfg parameters:
//   ki          — KI barrier (e.g. 0.35 = 35%)
//   cb          — Coupon barrier (e.g. 0.60 = 60%)
//   acStart     — Initial autocall trigger (e.g. 1.05)
//   acSD        — Step-down per period (e.g. 0.025 = 2.5%/obs)
//   cpnPerPeriod— Coupon per observation period
//   mem         — Memory coupon on/off
//   seniorDep   — Senior deposit ($10,000)
//   juniorRatio — Jr as fraction of Sr
//   eulerAPY    — Pool lending yield (set to 0 for pure option run)
//   fundingAPY  — Funding rate on short hedge
//   rf          — Risk-free rate
//   nObs        — Number of observation dates
//   obsFreq     — Observation frequency in years (1/12=monthly, 0.25=quarterly)
//   deltaThresh — Delta threshold for rebalancing
//   stepsPerDay — Simulation steps per day
//   protocolSpread — Management fee (set to 0 for pure option run)
//   origFee     — Origination fee (fraction of Sr deposit)
//   acStartObs  — First observation where AC can trigger (e.g. 2 = 2nd obs)
//   kiType      — 'continuous' | 'atMaturity' (European KI)

function simPath(path,stocks,cfg) {
  const {
    ki,cb,acStart,acSD,cpnPerPeriod,mem,seniorDep,juniorRatio,
    eulerAPY,fundingAPY,rf,nObs,obsFreq,deltaThresh,stepsPerDay,
    protocolSpread,origFee,acStartObs,kiType,
  }=cfg;

  const n=stocks.length,S0=stocks.map(s=>ST[s].S0),vols=stocks.map(s=>ST[s].vol);
  const juniorDep=seniorDep*juniorRatio,poolSize=seniorDep+juniorDep;
  const T=nObs*obsFreq;
  const totalSteps=Math.round(T*252*stepsPerDay);
  const dt=T/totalSteps;
  const poolEuler=eulerAPY-(protocolSpread||0);

  // Observation schedule: obs k is at time k*obsFreq (k=1..nObs)
  // We detect observation boundaries by checking which obs index the current step crosses
  function obsAtStep(step) {
    const curT=step*dt;
    const prevT=(step-1)*dt;
    // obs k triggers when time crosses k*obsFreq
    for(let k=1;k<=nObs;k++){
      const tObs=k*obsFreq;
      if(prevT<tObs-dt*0.01&&curT>=tObs-dt*0.01) return k;
    }
    return null;
  }

  let cash=poolSize*0.998;
  let shortShares=new Float64Array(n),shortEntry=new Float64Array(n),curDelta=new Float64Array(n);
  let knockedIn=false,totalCpnPaid=0,missedCpn=0,tradeCount=0;
  let yldEuler=0,yldFunding=0,gammaPnL=0,cpnPayments=0,feeIncome=0;

  function rebalance(tds,prices) {
    for(let i=0;i<n;i++){
      if(Math.abs(tds[i]-curDelta[i])<=deltaThresh)continue;
      const notSh=seniorDep/n/S0[i],tgt=tds[i]*notSh,diff=tgt-shortShares[i];
      if(Math.abs(diff*prices[i])<20)continue;
      if(diff>0){
        const tot=shortShares[i]+diff;
        if(tot>0.001)shortEntry[i]=(shortShares[i]*shortEntry[i]+diff*prices[i])/tot;
      } else {
        const cover=Math.abs(diff),pnl=cover*shortEntry[i]-cover*prices[i];
        gammaPnL+=pnl;cash+=pnl;
      }
      shortShares[i]=tgt;curDelta[i]=tds[i];tradeCount++;
    }
  }

  function unwind(prices) {
    for(let i=0;i<n;i++){
      if(shortShares[i]>0.001){
        const pnl=shortShares[i]*shortEntry[i]-shortShares[i]*prices[i];
        gammaPnL+=pnl;cash+=pnl;
        shortShares[i]=0;shortEntry[i]=0;curDelta[i]=0;tradeCount++;
      }
    }
  }

  // Init hedge at t=0
  const id=worstOfDeltas(stocks,S0,S0,vols,ki,T,rf,false);
  for(let i=0;i<n;i++) if(id[i]>0.001){
    const ns=seniorDep/n/S0[i];
    shortShares[i]=id[i]*ns;shortEntry[i]=S0[i];curDelta[i]=id[i];tradeCount++;
  }

  for(let step=1;step<=totalSteps;step++){
    const curT=step*dt,ttm=Math.max(T-curT,0.001);
    const prices=stocks.map((_,i)=>path[i][step]);
    const perfs=prices.map((p,i)=>p/S0[i]);
    const wp=Math.min(...perfs);
    const isLast=(step===totalSteps);

    // Euler yield on pool (net of protocol spread)
    if(cash>0){const y=cash*poolEuler*dt;cash+=y;yldEuler+=y;}
    // Protocol management fee income (accrues to protocol, tracked separately)
    if((protocolSpread||0)>0&&cash>0){feeIncome+=cash*protocolSpread*dt;}
    // Funding income on short hedge positions
    if(fundingAPY>0){
      let hn=0;for(let i=0;i<n;i++)hn+=shortShares[i]*prices[i];
      if(hn>0){const fy=hn*fundingAPY*dt;cash+=fy;yldFunding+=fy;}
    }

    // KI check: continuous monitoring
    if(kiType!=='atMaturity'&&!knockedIn&&wp<=ki) knockedIn=true;

    const obsK=obsAtStep(step);

    if(obsK!==null){
      const isLastObs=(obsK===nObs);
      const acBar=Math.max(acStart-acSD*(obsK-1),0.80);
      const canAC=(obsK>=acStartObs)&&!isLastObs; // AC not triggered at final obs (maturity handles it)

      // Check autocall: all perfs >= acBar, from acStartObs onwards, not at last obs
      if(canAC&&perfs.every(p=>p>=acBar)){
        let cpn=cpnPerPeriod*seniorDep;
        totalCpnPaid+=cpn;
        if(mem&&missedCpn>0){totalCpnPaid+=missedCpn;cpn+=missedCpn;missedCpn=0;}
        cash-=cpn;cpnPayments++;
        unwind(prices);
        const jrPay=Math.max(cash-seniorDep,0);
        return{
          out:'AC',obs:obsK,dur:curT,
          srRet:totalCpnPaid/seniorDep,
          jrRet:(jrPay-juniorDep)/juniorDep,
          wp,ki:false,tradeCount,cpnPayments,
          yldEuler,yldFunding,gammaPnL,totalCpnPaid,kiLoss:0,feeIncome,
        };
      }

      // Coupon payment at observation (if not already autocalled)
      if(!isLastObs){
        if(wp>=cb){
          let cpn=cpnPerPeriod*seniorDep;
          totalCpnPaid+=cpn;
          if(mem&&missedCpn>0){totalCpnPaid+=missedCpn;cpn+=missedCpn;missedCpn=0;}
          cash-=cpn;cpnPayments++;
        } else if(mem) {
          missedCpn+=cpnPerPeriod*seniorDep;
        }
      }
    }

    // Delta rebalancing (not at last step — unwind handles that)
    if(!isLast){
      const td=worstOfDeltas(stocks,prices,S0,vols,ki,ttm,rf,knockedIn);
      rebalance(td,prices);
    }

    // Maturity
    if(isLast){
      // European KI: only check at maturity
      if(kiType==='atMaturity'&&!knockedIn&&wp<=ki) knockedIn=true;

      // Final coupon at maturity (if above cb and not KI or if above 1.0)
      if(wp>=cb){
        let cpn=cpnPerPeriod*seniorDep;
        totalCpnPaid+=cpn;
        if(mem&&missedCpn>0){totalCpnPaid+=missedCpn;cpn+=missedCpn;missedCpn=0;}
        cash-=cpn;cpnPayments++;
      }
      // Note: if KI and wp<1 the final coupon above won't trigger (wp<cb typically)

      unwind(prices);

      if(knockedIn&&wp<1.0){
        const kiLoss=seniorDep*(1-wp);
        cash-=kiLoss;
        const srPay=Math.max(Math.min(seniorDep,cash),0);
        const jrPay=Math.max(cash-seniorDep,0);
        return{
          out:'KI',obs:nObs,dur:T,
          srRet:(srPay+totalCpnPaid-seniorDep)/seniorDep,
          jrRet:(jrPay-juniorDep)/juniorDep,
          wp,ki:true,tradeCount,cpnPayments,
          yldEuler,yldFunding,gammaPnL,totalCpnPaid,kiLoss,feeIncome,
        };
      } else {
        const jrPay=Math.max(cash-seniorDep,0);
        return{
          out:'MAT',obs:nObs,dur:T,
          srRet:totalCpnPaid/seniorDep,
          jrRet:(jrPay-juniorDep)/juniorDep,
          wp,ki:false,tradeCount,cpnPayments,
          yldEuler,yldFunding,gammaPnL,totalCpnPaid,kiLoss:0,feeIncome,
        };
      }
    }
  }
}

// ─── MONTE CARLO RUNNER ──────────────────────────────────────────────────────

function runMC(stocks,cfg,nP) {
  const T=cfg.nObs*cfg.obsFreq;
  const ts=Math.round(T*252*cfg.stepsPerDay);
  const paths=genPaths(stocks,nP,T,ts);
  return paths.map(p=>simPath(p,stocks,cfg)).filter(Boolean);
}

// ─── STATISTICS ──────────────────────────────────────────────────────────────

function stats(R,cfg) {
  const N=R.length,mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const sr=R.map(r=>r.srRet).sort((a,b)=>a-b);
  const jr=R.map(r=>r.jrRet).sort((a,b)=>a-b);
  const pct=(a,p)=>a[Math.min(Math.floor(a.length*p/100),a.length-1)];
  const avgDur=mean(R.map(r=>r.dur));
  const juniorDep=cfg.seniorDep*cfg.juniorRatio;
  const origFeeIncome=(cfg.origFee||0)*cfg.seniorDep;

  const protPnLs=R.map(r=>r.jrRet*juniorDep+r.feeIncome+origFeeIncome);
  const avgProtPnL=mean(protPnLs);
  const protAPY=avgDur>0?avgProtPnL/juniorDep/avgDur:0;

  const protPnLsSorted=[...protPnLs].sort((a,b)=>a-b);

  return {
    sm:mean(sr),sMed:pct(sr,50),sP5:pct(sr,5),sP95:pct(sr,95),
    sWin:sr.filter(r=>r>=0).length/N,sAnn:avgDur>0?mean(sr)/avgDur:0,
    jm:mean(jr),jMed:pct(jr,50),jP5:pct(jr,5),jP95:pct(jr,95),
    jWin:jr.filter(r=>r>=0).length/N,jAnn:avgDur>0?mean(jr)/avgDur:0,
    acR:R.filter(r=>r.out==='AC').length/N,
    kiR:R.filter(r=>r.ki).length/N,
    matR:R.filter(r=>r.out==='MAT').length/N,
    avgDur,avgEuler:mean(R.map(r=>r.yldEuler)),
    avgFunding:mean(R.map(r=>r.yldFunding)),
    avgGamma:mean(R.map(r=>r.gammaPnL)),
    avgCpn:mean(R.map(r=>r.totalCpnPaid)),
    avgKI:mean(R.map(r=>r.kiLoss)),
    avgTrades:mean(R.map(r=>r.tradeCount)),
    avgCpnPay:mean(R.map(r=>r.cpnPayments)),
    avgFee:mean(R.map(r=>r.feeIncome)),
    origFeeIncome,avgProtPnL,protAPY,
    protP5:pct(protPnLsSorted,5)/juniorDep/(avgDur||1),
    protP95:pct(protPnLsSorted,95)/juniorDep/(avgDur||1),
    protWin:protPnLs.filter(p=>p>=0).length/N,
    cpnRate:avgDur>0?mean(R.map(r=>r.totalCpnPaid))/cfg.seniorDep/avgDur:0,
  };
}

// ─── FORMATTING ──────────────────────────────────────────────────────────────

const f=v=>`${v>=0?'+':''}${(v*100).toFixed(1)}%`;
const fp=v=>`${(v*100).toFixed(1)}%`;
const $=v=>`$${v>=0?'':'-'}${Math.abs(v).toFixed(0)}`;
const $$=v=>`$${(v>=0?'+':'-')+Math.abs(v).toFixed(0).padStart(5)}`;
const B='█',G='▓',D='─';

// ─── BASE CONFIG ─────────────────────────────────────────────────────────────
// 9-month product: 3 quarterly observations
// Reference basket: NVDA/TSLA/AMD

const BASE={
  ki:0.35,cb:0.60,acStart:1.05,acSD:0.025,cpnPerPeriod:0.025,
  mem:false,seniorDep:10000,juniorRatio:0.35,
  eulerAPY:0.12,fundingAPY:0.05,rf:0.05,
  nObs:3,obsFreq:0.25,          // 3 quarterly obs = 9mo
  deltaThresh:0.03,stepsPerDay:2,
  protocolSpread:0.02,origFee:0.005,
  acStartObs:2,kiType:'continuous',
};
const REF_STOCKS=['NVDAx','TSLAx','AMDx'];

// ─── PURE OPTION CONFIG OVERLAY ──────────────────────────────────────────────
// Run same cfg but with Euler=0, funding=0, protocolSpread=0 to isolate autocall premium

function pureOptCfg(cfg){
  return{...cfg,eulerAPY:0,fundingAPY:0,protocolSpread:0,origFee:0};
}

// Decompose: total PnL = pure option + carry contribution + fee income
function decompose(sTotal,sPure,cfg){
  const jrDep=cfg.seniorDep*cfg.juniorRatio,dur=sTotal.avgDur||1;
  const pureOptPnL=sPure.avgProtPnL;           // option PnL at Euler=0
  const eulerCarry=sTotal.avgEuler-sPure.avgEuler; // extra Euler carry
  const feeInc=sTotal.avgFee+sTotal.origFeeIncome;
  const total=sTotal.avgProtPnL;
  const autocallShare=total>0?pureOptPnL/total:0;
  const carryShare=total>0?eulerCarry/total:0;
  const feeShare=total>0?feeInc/total:0;
  return{pureOptPnL,eulerCarry,feeInc,total,autocallShare,carryShare,feeShare,jrDep,dur};
}

// ─── HEADER ──────────────────────────────────────────────────────────────────

console.log(B.repeat(120));
console.log(`${B}  xYIELD v19 — INSTITUTIONAL AUTOCALL ENGINE`);
console.log(`${B}  Goal: Isolate pure autocall premium. Is the structure worth more than Euler carry alone?`);
console.log(B.repeat(120));

// ============================================================
// PART 1 — INSTITUTIONAL FEATURE IMPACT
// Test each feature one at a time on reference config
// ============================================================
console.log('\n'+G.repeat(120));
console.log(`${G}  PART 1 — INSTITUTIONAL FEATURE IMPACT`);
console.log(`${G}  Ref: NVDA/TSLA/AMD, KI 35%, CB 60%, AC 105% step-down 2.5%, Cpn 2.5%/Q, 9mo`);
console.log(G.repeat(120));

const N1=1500;

function featureTable(label,rows) {
  const hdr='  '+
    'Config'.padEnd(28)+
    'SrAPY'.padStart(7)+'ProtAPY'.padStart(9)+
    'KI%'.padStart(5)+'AC%'.padStart(5)+'MAT%'.padStart(6)+
    'CpnRate'.padStart(8)+'PureOptPnL'.padStart(12)+'AutocallShare'.padStart(14);
  console.log(`\n  ─── ${label} ───`);
  console.log(hdr);
  console.log('  '+D.repeat(100));
  for(const r of rows){
    const share=r.autocallShare>=0?`${(r.autocallShare*100).toFixed(0)}%`:'N/A';
    console.log('  '+
      r.label.padEnd(28)+
      f(r.sAnn).padStart(7)+
      f(r.protAPY).padStart(9)+
      `${(r.kiR*100).toFixed(1)}%`.padStart(5)+
      `${(r.acR*100).toFixed(1)}%`.padStart(5)+
      `${(r.matR*100).toFixed(0)}%`.padStart(6)+
      f(r.cpnRate).padStart(8)+
      `${$$(r.pureOptPnL)}`.padStart(12)+
      share.padStart(14)
    );
  }
}

function runFeature(label,cfgOverride) {
  process.stdout.write(`    running ${label}...`);
  const cfg={...BASE,...cfgOverride};
  const R=runMC(REF_STOCKS,cfg,N1);
  const sTotal=stats(R,cfg);
  const Rp=runMC(REF_STOCKS,pureOptCfg(cfg),N1);
  const sPure=stats(Rp,pureOptCfg(cfg));
  const dec=decompose(sTotal,sPure,cfg);
  process.stdout.write(` done\n`);
  return{label,...sTotal,...dec};
}

// 1a. Memory coupon
const memRows=[
  runFeature('Memory OFF (ref)', {mem:false}),
  runFeature('Memory ON',        {mem:true}),
];
featureTable('Memory Coupon: OFF vs ON', memRows);

// 1b. Observation frequency
const obsRows=[
  runFeature('Quarterly (3Q=9mo)', {nObs:3,obsFreq:0.25,cpnPerPeriod:0.025}),
  runFeature('Monthly (9M=9mo)',   {nObs:9,obsFreq:1/12,cpnPerPeriod:0.025/3}),
];
featureTable('Observation Frequency: Quarterly vs Monthly', obsRows);

// 1c. AC step-down
const sdRows=[
  runFeature('SD 0%/obs (flat)',  {acSD:0}),
  runFeature('SD 1.25%/obs',      {acSD:0.0125}),
  runFeature('SD 2.5%/obs',       {acSD:0.025}),
  runFeature('SD 3.75%/obs',      {acSD:0.0375}),
];
featureTable('AC Step-Down per Period', sdRows);

// 1d. AC start delay
const acStartRows=[
  runFeature('AC from obs 1', {acStartObs:1}),
  runFeature('AC from obs 2', {acStartObs:2}),
  runFeature('AC from obs 3', {acStartObs:3}),
];
featureTable('AC Start Delay (first obs where AC can trigger)', acStartRows);

// 1e. Coupon barrier
const cbRows=[
  runFeature('CB 50%', {cb:0.50}),
  runFeature('CB 60%', {cb:0.60}),
  runFeature('CB 70%', {cb:0.70}),
  runFeature('CB 80%', {cb:0.80}),
];
featureTable('Coupon Barrier Level', cbRows);

// 1f. KI type
const kiTypeRows=[
  runFeature('Continuous KI',      {kiType:'continuous'}),
  runFeature('European KI (mat)',  {kiType:'atMaturity'}),
];
featureTable('KI Type: Continuous vs European (at-maturity)', kiTypeRows);

// ============================================================
// PART 2 — MEMORY COUPON DEEP ANALYSIS
// 4 baskets × 3 KI levels × 2 maturities
// ============================================================
console.log('\n\n'+G.repeat(120));
console.log(`${G}  PART 2 — MEMORY COUPON DEEP ANALYSIS`);
console.log(`${G}  Where does memory coupon add the most value?`);
console.log(G.repeat(120));

const MEM_BASKETS=[
  {name:'NVDA/TSLA/AMD',stocks:['NVDAx','TSLAx','AMDx']},
  {name:'NVDA/TSLA/META',stocks:['NVDAx','TSLAx','METAx']},
  {name:'NVDA/TSLA/COIN',stocks:['NVDAx','TSLAx','COINx']},
  {name:'NVDA/AMD/AMZN',stocks:['NVDAx','AMDx','AMZNx']},
];
const MEM_KI=[0.30,0.35,0.40];
const MEM_MAT=[
  {nObs:3,obsFreq:0.25,label:'9mo'},
  {nObs:4,obsFreq:0.25,label:'12mo'},
];
const N2=1200;

console.log('\n  '+
  'Basket'.padEnd(20)+'KI'.padEnd(5)+'Mat'.padEnd(6)+
  'MemOFF_SrAPY'.padStart(13)+'MemON_SrAPY'.padStart(12)+
  'Δ_SrAPY'.padStart(9)+'MemOFF_ProtAPY'.padStart(15)+'MemON_ProtAPY'.padStart(14)+
  'Δ_ProtAPY'.padStart(11)+'Δ_CpnRate'.padStart(11));
console.log('  '+D.repeat(120));

for(const bkt of MEM_BASKETS)
  for(const ki of MEM_KI)
    for(const mat of MEM_MAT){
      process.stdout.write(`    ${bkt.name} KI${(ki*100).toFixed(0)}% ${mat.label}...`);
      const cfg0={...BASE,ki,nObs:mat.nObs,obsFreq:mat.obsFreq,mem:false};
      const cfg1={...BASE,ki,nObs:mat.nObs,obsFreq:mat.obsFreq,mem:true};
      const R0=runMC(bkt.stocks,cfg0,N2),s0=stats(R0,cfg0);
      const R1=runMC(bkt.stocks,cfg1,N2),s1=stats(R1,cfg1);
      process.stdout.write(` done\n`);
      const dSr=s1.sAnn-s0.sAnn,dProt=s1.protAPY-s0.protAPY,dCpn=s1.cpnRate-s0.cpnRate;
      console.log('  '+
        bkt.name.padEnd(20)+`${(ki*100).toFixed(0)}%`.padEnd(5)+mat.label.padEnd(6)+
        f(s0.sAnn).padStart(13)+f(s1.sAnn).padStart(12)+
        f(dSr).padStart(9)+
        f(s0.protAPY).padStart(15)+f(s1.protAPY).padStart(14)+
        f(dProt).padStart(11)+
        f(dCpn).padStart(11)
      );
    }

// ============================================================
// PART 3 — BASKET ENGINEERING
// 12+ baskets: 2/3/4 stocks
// ============================================================
console.log('\n\n'+G.repeat(120));
console.log(`${G}  PART 3 — BASKET ENGINEERING`);
console.log(`${G}  Worst-of premium, KI prob, autocall prob by basket composition`);
console.log(G.repeat(120));

const BASKETS=[
  // 2-stock
  {name:'NVDA/TSLA',        stocks:['NVDAx','TSLAx']},
  {name:'NVDA/AMD',         stocks:['NVDAx','AMDx']},
  {name:'NVDA/META',        stocks:['NVDAx','METAx']},
  {name:'TSLA/COIN',        stocks:['TSLAx','COINx']},
  // 3-stock
  {name:'NVDA/TSLA/AMD',    stocks:['NVDAx','TSLAx','AMDx']},
  {name:'NVDA/TSLA/META',   stocks:['NVDAx','TSLAx','METAx']},
  {name:'NVDA/AMD/META',    stocks:['NVDAx','AMDx','METAx']},
  {name:'NVDA/TSLA/COIN',   stocks:['NVDAx','TSLAx','COINx']},
  {name:'NVDA/META/AMZN',   stocks:['NVDAx','METAx','AMZNx']},
  // 4-stock
  {name:'NVDA/TSLA/AMD/META',stocks:['NVDAx','TSLAx','AMDx','METAx']},
  {name:'NVDA/TSLA/AMD/AMZN',stocks:['NVDAx','TSLAx','AMDx','AMZNx']},
  {name:'NVDA/TSLA/META/AMZN',stocks:['NVDAx','TSLAx','METAx','AMZNx']},
];
const N3=1500;

console.log('\n  '+
  'Basket'.padEnd(24)+'N'.padStart(2)+'AvgVol'.padStart(8)+
  'KI%'.padStart(5)+'AC%'.padStart(5)+'MAT%'.padStart(6)+
  'SrAPY'.padStart(7)+'ProtAPY'.padStart(9)+'PureOpt'.padStart(9)+
  'AutoShare'.padStart(10)+'CpnRate'.padStart(9));
console.log('  '+D.repeat(105));

const bkt3Results=[];
for(const bkt of BASKETS){
  process.stdout.write(`    ${bkt.name}...`);
  const avgVol=bkt.stocks.reduce((s,st)=>s+ST[st].vol,0)/bkt.stocks.length;
  const cfg={...BASE,mem:true};
  const R=runMC(bkt.stocks,cfg,N3),sT=stats(R,cfg);
  const Rp=runMC(bkt.stocks,pureOptCfg(cfg),N3),sP=stats(Rp,pureOptCfg(cfg));
  const dec=decompose(sT,sP,cfg);
  bkt3Results.push({...bkt,avgVol,...sT,...dec});
  process.stdout.write(` done\n`);
  const share=dec.autocallShare>=0?`${(dec.autocallShare*100).toFixed(0)}%`:'N/A';
  console.log('  '+
    bkt.name.padEnd(24)+`${bkt.stocks.length}`.padStart(2)+
    `${(avgVol*100).toFixed(0)}%`.padStart(8)+
    `${(sT.kiR*100).toFixed(1)}%`.padStart(5)+
    `${(sT.acR*100).toFixed(1)}%`.padStart(5)+
    `${(sT.matR*100).toFixed(0)}%`.padStart(6)+
    f(sT.sAnn).padStart(7)+
    f(sT.protAPY).padStart(9)+
    `${$$(dec.pureOptPnL)}`.padStart(9)+
    share.padStart(10)+
    f(sT.cpnRate).padStart(9)
  );
}

// ============================================================
// PART 4 — AUTOCALL PREMIUM DECOMPOSITION
// For top 5 structures: isolate pure option vs Euler carry
// ============================================================
console.log('\n\n'+G.repeat(120));
console.log(`${G}  PART 4 — AUTOCALL PREMIUM DECOMPOSITION`);
console.log(`${G}  Protocol PnL = Pure Autocall Premium + Euler Carry + Fee Income - KI Losses`);
console.log(G.repeat(120));

// Sort baskets by autocallShare (structures where autocall generates most value)
const top5Candidates=bkt3Results
  .filter(r=>r.protAPY>0&&r.sAnn>0.05)
  .sort((a,b)=>b.autocallShare-a.autocallShare)
  .slice(0,5);

const EULER_LEVELS=[0,0.12,0.15];
const N4=1500;

console.log('\n  Running each top structure at Euler=0%, 12%, 15%...\n');

console.log('  '+
  'Basket'.padEnd(24)+'Euler'.padStart(7)+
  'SrAPY'.padStart(7)+'ProtAPY'.padStart(9)+
  'PureOpt$'.padStart(10)+'EulerCarry$'.padStart(13)+'Fees$'.padStart(8)+
  'KI$'.padStart(8)+'AutocallShr'.padStart(13)+'CarryShr'.padStart(10));
console.log('  '+D.repeat(110));

const decomp4=[];
for(const bkt of top5Candidates){
  for(const euler of EULER_LEVELS){
    process.stdout.write(`    ${bkt.name} E=${(euler*100).toFixed(0)}%...`);
    const cfg={...BASE,mem:true,eulerAPY:euler,fundingAPY:euler>0?0.05:0,protocolSpread:euler>0?0.02:0,origFee:euler>0?0.005:0};
    const R=runMC(bkt.stocks,cfg,N4),sT=stats(R,cfg);
    const Rp=runMC(bkt.stocks,pureOptCfg(cfg),N4),sP=stats(Rp,pureOptCfg(cfg));
    const dec=decompose(sT,sP,cfg);
    decomp4.push({name:bkt.name,stocks:bkt.stocks,euler,...sT,...dec,cfg});
    process.stdout.write(` done\n`);
    const aShare=dec.autocallShare>=0?`${(dec.autocallShare*100).toFixed(0)}%`:'--';
    const cShare=dec.carryShare>=0?`${(dec.carryShare*100).toFixed(0)}%`:'--';
    console.log('  '+
      bkt.name.padEnd(24)+
      `${(euler*100).toFixed(0)}%`.padStart(7)+
      f(sT.sAnn).padStart(7)+
      f(sT.protAPY).padStart(9)+
      `${$$(dec.pureOptPnL)}`.padStart(10)+
      `${$$(dec.eulerCarry)}`.padStart(13)+
      `${$$(dec.feeInc)}`.padStart(8)+
      `${$$(-sT.avgKI)}`.padStart(8)+
      aShare.padStart(13)+
      cShare.padStart(10)
    );
  }
  console.log('  '+D.repeat(110));
}

// ============================================================
// PART 5 — TOP 5 INSTITUTIONAL PRODUCTS DEEP DIVE
// 6000 paths on the 5 best structures
// ============================================================
console.log('\n\n'+G.repeat(120));
console.log(`${G}  PART 5 — TOP 5 INSTITUTIONAL PRODUCTS DEEP DIVE`);
console.log(`${G}  6000 paths per structure, full PnL decomposition`);
console.log(G.repeat(120));

// Re-rank by (protAPY at E=12%) × autocallShare — structures that earn well AND have real option value
const top5Full=decomp4
  .filter(r=>r.euler===0.12)
  .sort((a,b)=>{
    const scoreA=(a.protAPY||0)*Math.max(a.autocallShare||0,0.01);
    const scoreB=(b.protAPY||0)*Math.max(b.autocallShare||0,0.01);
    return scoreB-scoreA;
  })
  .slice(0,5);

const N5=6000;

for(let i=0;i<top5Full.length;i++){
  const b=top5Full[i];
  process.stdout.write(`\n  #${i+1} ${b.name} (6000 paths)...`);

  const cfg={...BASE,mem:true,eulerAPY:0.12,fundingAPY:0.05,protocolSpread:0.02,origFee:0.005};
  const cfgPure=pureOptCfg(cfg);

  const R=runMC(b.stocks,cfg,N5);
  const sT=stats(R,cfg);
  const Rp=runMC(b.stocks,cfgPure,N5);
  const sP=stats(Rp,cfgPure);
  const dec=decompose(sT,sP,cfg);

  process.stdout.write(' done\n');

  const jrDep=cfg.seniorDep*cfg.juniorRatio;
  const dur=sT.avgDur;

  // Conditional KI stats
  const kiPaths=R.filter(r=>r.ki);
  const condKILoss=kiPaths.length>0?kiPaths.reduce((s,r)=>s+r.kiLoss,0)/kiPaths.length:0;
  const condKIwp=kiPaths.length>0?kiPaths.reduce((s,r)=>s+r.wp,0)/kiPaths.length:0;

  const origInc=(cfg.origFee||0)*cfg.seniorDep;
  const aShare=dec.total>0?`${(dec.autocallShare*100).toFixed(0)}%`:'--';
  const cShare=dec.total>0?`${(dec.carryShare*100).toFixed(0)}%`:'--';
  const fShare=dec.total>0?`${(dec.feeShare*100).toFixed(0)}%`:'--';

  console.log(`
  ┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #${i+1} ${b.name.padEnd(22)} KI:${fp(cfg.ki)} CB:${fp(cfg.cb)} AC:${fp(cfg.acStart)} SD:${fp(cfg.acSD)}/obs  Cpn:${fp(cfg.cpnPerPeriod)}/Q  9mo  │
  ├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │  SENIOR (retail)        APY: ${f(sT.sAnn).padStart(7)}  Win: ${(sT.sWin*100).toFixed(1)}%  P5: ${f(sT.sP5).padStart(7)}  P95: ${f(sT.sP95).padStart(7)}         │
  │  PROTOCOL (underwriter)  APY: ${f(sT.protAPY).padStart(7)}  Win: ${(sT.protWin*100).toFixed(1)}%  P5: ${f(sT.protP5).padStart(7)}  P95: ${f(sT.protP95).padStart(7)}         │
  ├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │  PROTOCOL PnL DECOMPOSITION (per $10k Sr note, Jr=$${jrDep.toFixed(0)}):                                        │
  │                                                                                                        │
  │  REVENUE:                                                                                              │
  │    Pure autocall premium   ${$$(dec.pureOptPnL).padStart(9)}   option value captured by structure (Euler=0 run)    │
  │    Euler carry enhancement ${$$(dec.eulerCarry).padStart(9)}   additional PnL from ${(cfg.eulerAPY*100).toFixed(0)}% pool yield              │
  │    Fee income              ${$$(dec.feeInc).padStart(9)}   mgmt spread + origination                        │
  │                                                                                                        │
  │  COSTS:                                                                                                │
  │    Senior coupons paid     ${$$(-sT.avgCpn).padStart(9)}   ${f(sT.cpnRate)} annualized to Sr                      │
  │    KI losses absorbed      ${$$(-sT.avgKI).padStart(9)}   ${(sT.kiR*100).toFixed(1)}% KI rate, avg ${$(condKILoss)} per event          │
  │                                                                                                        │
  │  PROTOCOL NET              ${$$(dec.total).padStart(9)}   → ${f(sT.protAPY)} ann on $${jrDep.toFixed(0)} Jr capital        │
  ├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │  PROFIT SHARE BREAKDOWN:                                                                               │
  │    Autocall option share   ${aShare.padStart(6)}   (target: >30-40% → structure earns its keep)        │
  │    Euler carry share       ${cShare.padStart(6)}   (Euler enhancement)                                 │
  │    Fee income share        ${fShare.padStart(6)}   (management + origination)                         │
  ├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │  OUTCOMES: AC ${(sT.acR*100).toFixed(0)}%  MAT ${(sT.matR*100).toFixed(0)}%  KI ${(sT.kiR*100).toFixed(1)}%  CpnRate ${f(sT.cpnRate)}  Trades ${sT.avgTrades.toFixed(0)}/path          │
  │  KI STATS: prob ${(sT.kiR*100).toFixed(1)}%  avg worst-of ${(condKIwp*100).toFixed(0)}%  avg loss ${$(condKILoss)} per KI event              │
  └────────────────────────────────────────────────────────────────────────────────────────────────────────┘`);
}

// ============================================================
// SUMMARY — KEY INSIGHTS
// ============================================================
console.log('\n\n'+B.repeat(120));
console.log(`${B}  SUMMARY — v19 KEY FINDINGS`);
console.log(B.repeat(120));

const bestByAutoShare=bkt3Results.sort((a,b)=>b.autocallShare-a.autocallShare)[0];
const bestByProtAPY=bkt3Results.sort((a,b)=>b.protAPY-a.protAPY)[0];

console.log(`
  AUTOCALL PREMIUM INSIGHTS:
  ─────────────────────────
  Best autocall share:  ${bestByAutoShare?.name||'N/A'}  → ${bestByAutoShare?`${(bestByAutoShare.autocallShare*100).toFixed(0)}% of protocol PnL from pure option`:'N/A'}
  Best protocol APY:    ${bestByProtAPY?.name||'N/A'}  → ${bestByProtAPY?f(bestByProtAPY.protAPY)+' APY':'N/A'}

  TARGET THRESHOLDS:
    Autocall share > 30%   → structure genuinely earns option premium (not just Euler wrapper)
    Autocall share > 40%   → institutional-grade: options desk quality
    Autocall share < 20%   → effectively a yield fund with coupon liability attached

  INSTITUTIONAL DESIGN PRINCIPLES (from v19):
    1. Step-down AC (2.5%/obs) increases AC rate → more coupon payments → better Sr yield
    2. Memory coupon rewards patience but increases liability if many obs missed
    3. Monthly obs vs quarterly: more granular but similar economics on same tenor
    4. European KI (at-maturity) dramatically reduces KI risk → better for Sr investors
    5. CB at 60-70% optimal: enough protection without destroying expected coupon rate
    6. AC start from obs 2: avoids immediate exit, lets structure earn early coupons
`);

console.log(B.repeat(120));
console.log(`${B}  v19 COMPLETE — Institutional autocall engine analyzed`);
console.log(B.repeat(120)+'\n');
