#!/usr/bin/env node
// ============================================================
// xYield v18 — PROTOCOL PROFIT ENGINE
//
// Shift: stop balancing tranches, start thinking like a desk.
// Protocol = Junior capital + fee-charging underwriter.
//
// Protocol PnL = Jr Residual + Fee Income
// Where:
//   Jr Residual = (pool cash - Sr principal) - Jr capital
//   Fee Income  = protocolSpread × pool AUM (management fee)
//   Origination = origFee × Sr deposit (upfront)
//
// Protocol Edge Sources:
//   1. CARRY: Euler on total pool vs coupon paid to Sr
//   2. OPTION MISPRICING: sell at high implied vol, actual KI is low
//   3. FEES: management spread + origination
//   4. LEVERAGE: control (Sr+Jr) with only Jr capital
// ============================================================

function normalCDF(x){const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;const sign=x<0?-1:1,t=1/(1+p*Math.abs(x));return 0.5*(1+sign*(1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x/2)));}
function diPutPx(S,K,H,T,r,sig){if(T<=0.001)return S<=H?Math.max(K-S,0):0;if(S<=H){const sq=Math.sqrt(T),d1=(Math.log(S/K)+(r+sig*sig/2)*T)/(sig*sq);return K*Math.exp(-r*T)*normalCDF(-(d1-sig*sq))-S*normalCDF(-d1);}if(S<=0.001||sig<=0.001)return 0;const sq=Math.sqrt(T),lam=(r+sig*sig/2)/(sig*sig);const x1=Math.log(S/H)/(sig*sq)+lam*sig*sq,y=Math.log(H*H/(S*K))/(sig*sq)+lam*sig*sq,y1=Math.log(H/S)/(sig*sq)+lam*sig*sq;const p2l=Math.pow(H/S,2*lam),p2l2=Math.pow(H/S,2*lam-2),disc=Math.exp(-r*T);return Math.max(-S*normalCDF(-x1)+K*disc*normalCDF(-x1+sig*sq)+S*p2l*(normalCDF(y)-normalCDF(y1))-K*disc*p2l2*(normalCDF(y-sig*sq)-normalCDF(y1-sig*sq)),0);}
function diPutDelta(S,K,H,T,r,sig){if(T<=0.001)return S<=K?-1:0;if(S<=H){const sq=Math.sqrt(T);return normalCDF((Math.log(S/K)+(r+sig*sig/2)*T)/(sig*sq))-1;}const eps=S*0.005;return(diPutPx(S+eps,K,H,T,r,sig)-diPutPx(S-eps,K,H,T,r,sig))/(2*eps);}

let _sp=null;
function randn(){if(_sp!==null){const v=_sp;_sp=null;return v;}let u,v,s;do{u=Math.random()*2-1;v=Math.random()*2-1;s=u*u+v*v;}while(s>=1||s===0);const m=Math.sqrt(-2*Math.log(s)/s);_sp=v*m;return u*m;}
function cholesky(M){const n=M.length,L=Array.from({length:n},()=>new Float64Array(n));for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let s=0;for(let k=0;k<j;k++)s+=L[i][k]*L[j][k];L[i][j]=i===j?Math.sqrt(Math.max(M[i][i]-s,1e-10)):(M[i][j]-s)/L[j][j];}return L;}

const ST={NVDAx:{S0:183.14,vol:0.55},TSLAx:{S0:395.01,vol:0.60},COINx:{S0:193.24,vol:0.75},MSTRx:{S0:350,vol:0.85},AMDx:{S0:115,vol:0.50},METAx:{S0:638.27,vol:0.38},AAPLx:{S0:255.76,vol:0.28}};
const CR={'NVDAx-TSLAx':0.45,'NVDAx-COINx':0.35,'NVDAx-MSTRx':0.35,'NVDAx-AMDx':0.70,'NVDAx-METAx':0.55,'NVDAx-AAPLx':0.60,'TSLAx-COINx':0.40,'TSLAx-MSTRx':0.30,'TSLAx-AMDx':0.40,'TSLAx-METAx':0.30,'TSLAx-AAPLx':0.35,'COINx-MSTRx':0.75,'COINx-AMDx':0.25,'COINx-METAx':0.20,'COINx-AAPLx':0.15,'MSTRx-AMDx':0.25,'MSTRx-METAx':0.20,'MSTRx-AAPLx':0.15,'AMDx-METAx':0.50,'AMDx-AAPLx':0.55,'METAx-AAPLx':0.65};
function gc(a,b){return a===b?1:CR[`${a}-${b}`]??CR[`${b}-${a}`]??0.20;}

function genPaths(stocks,nP,T,totalSteps){const n=stocks.length,dt=T/totalSteps,sq=Math.sqrt(dt);const C=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>gc(stocks[i],stocks[j])));const L=cholesky(C),vols=stocks.map(s=>ST[s].vol),S0=stocks.map(s=>ST[s].S0),r=0.05;const paths=[];for(let p=0;p<nP;p++){const path=stocks.map((_,i)=>{const a=new Float64Array(totalSteps+1);a[0]=S0[i];return a;});for(let t=0;t<totalSteps;t++){const z=[];for(let i=0;i<n;i++)z.push(randn());const w=new Float64Array(n);for(let i=0;i<n;i++)for(let j=0;j<=i;j++)w[i]+=L[i][j]*z[j];for(let i=0;i<n;i++)path[i][t+1]=path[i][t]*Math.exp((r-0.5*vols[i]**2)*dt+vols[i]*sq*w[i]);}paths.push(path);}return paths;}

function worstOfDeltas(stocks,prices,S0,vols,ki,ttm,rf,knockedIn){const n=stocks.length;const perfs=prices.map((p,i)=>p/S0[i]);const wp=Math.min(...perfs);const ds=new Float64Array(n);const alpha=8.0;for(let i=0;i<n;i++){let bd;if(knockedIn&&perfs[i]<1.0)bd=Math.min(0.5+(1-perfs[i])*2.5,1.0);else if(ttm<=0.001)bd=0;else{bd=Math.abs(diPutDelta(prices[i],S0[i],ki*S0[i],ttm,rf,vols[i]));bd=Math.max(0,Math.min(bd,0.95));if(perfs[i]>1.15)bd*=0.5;if(perfs[i]>1.3)bd=0;}const gap=perfs[i]-wp;ds[i]=bd*Math.exp(-alpha*gap);}return ds;}

// ============================================================
// SIMULATION ENGINE v18
// v17 base + protocol fee model
// ============================================================
function simPath(path,stocks,cfg){
  const{ki,cb,acStart,acSD,cpnPerQ,mem,seniorDep,juniorRatio,eulerAPY,fundingAPY,rf,nQ,deltaThresh,stepsPerDay,protocolSpread}=cfg;
  const n=stocks.length,S0=stocks.map(s=>ST[s].S0),vols=stocks.map(s=>ST[s].vol);
  const juniorDep=seniorDep*juniorRatio,poolSize=seniorDep+juniorDep;
  const T=nQ*0.25,totalSteps=Math.round(T*252*stepsPerDay),dt=T/totalSteps;
  const poolEuler=eulerAPY-(protocolSpread||0); // pool gets Euler minus protocol's cut

  let cash=poolSize*0.998;
  let shortShares=new Float64Array(n),shortEntry=new Float64Array(n),curDelta=new Float64Array(n);
  let knockedIn=false,totalCpnPaid=0,missedCpn=0,tradeCount=0;
  let yldEuler=0,yldFunding=0,gammaPnL=0,cpnPayments=0,feeIncome=0;

  function rebalance(tds,prices){for(let i=0;i<n;i++){if(Math.abs(tds[i]-curDelta[i])<=deltaThresh)continue;const notSh=seniorDep/n/S0[i],tgt=tds[i]*notSh,diff=tgt-shortShares[i];if(Math.abs(diff*prices[i])<20)continue;if(diff>0){const tot=shortShares[i]+diff;if(tot>0.001)shortEntry[i]=(shortShares[i]*shortEntry[i]+diff*prices[i])/tot;}else{const cover=Math.abs(diff),pnl=cover*shortEntry[i]-cover*prices[i];gammaPnL+=pnl;cash+=pnl;}shortShares[i]=tgt;curDelta[i]=tds[i];tradeCount++;}}
  function unwind(prices){for(let i=0;i<n;i++){if(shortShares[i]>0.001){const pnl=shortShares[i]*shortEntry[i]-shortShares[i]*prices[i];gammaPnL+=pnl;cash+=pnl;shortShares[i]=0;shortEntry[i]=0;curDelta[i]=0;tradeCount++;}}}

  // Init hedge
  const id=worstOfDeltas(stocks,S0,S0,vols,ki,T,rf,false);
  for(let i=0;i<n;i++)if(id[i]>0.001){const ns=seniorDep/n/S0[i];shortShares[i]=id[i]*ns;shortEntry[i]=S0[i];curDelta[i]=id[i];tradeCount++;}

  for(let step=1;step<=totalSteps;step++){
    const curT=step*dt,ttm=Math.max(T-curT,0.001);
    const qN=Math.floor(curT/0.25+0.001)+1,pqN=Math.floor((curT-dt)/0.25+0.001)+1;
    const isQE=qN>pqN&&qN<=nQ+1&&step>1,aQ=qN-1,isLast=step===totalSteps;
    const prices=stocks.map((_,i)=>path[i][step]),perfs=prices.map((p,i)=>p/S0[i]),wp=Math.min(...perfs);

    // Pool Euler yield (after protocol spread)
    if(cash>0){const y=cash*poolEuler*dt;cash+=y;yldEuler+=y;}
    // Protocol fee income (management spread)
    if((protocolSpread||0)>0&&cash>0){feeIncome+=cash*(protocolSpread)*dt;}
    // Funding on short
    if(fundingAPY>0){let hn=0;for(let i=0;i<n;i++)hn+=shortShares[i]*prices[i];if(hn>0){const fy=hn*fundingAPY*dt;cash+=fy;yldFunding+=fy;}}
    if(wp<=ki)knockedIn=true;

    if(isQE&&aQ>=1&&aQ<=nQ){
      const acBar=Math.max(acStart-acSD*(aQ-1),0.80);
      if(aQ<nQ&&perfs.every(p=>p>=acBar)){
        let cpn=cpnPerQ*seniorDep;totalCpnPaid+=cpn;
        if(mem&&missedCpn>0){totalCpnPaid+=missedCpn;cpn+=missedCpn;missedCpn=0;}
        cash-=cpn;cpnPayments++;
        unwind(prices);
        const jrPay=Math.max(cash-seniorDep,0);
        return{out:'AC',q:aQ,dur:curT,srRet:totalCpnPaid/seniorDep,jrRet:(jrPay-juniorDep)/juniorDep,wp,ki:false,tradeCount,cpnPayments,yldEuler,yldFunding,gammaPnL,totalCpnPaid,kiLoss:0,feeIncome};
      }
      if(wp>=cb){let cpn=cpnPerQ*seniorDep;totalCpnPaid+=cpn;if(mem&&missedCpn>0){totalCpnPaid+=missedCpn;cpn+=missedCpn;missedCpn=0;}cash-=cpn;cpnPayments++;}
      else if(mem)missedCpn+=cpnPerQ*seniorDep;
    }
    if(!isLast){const td=worstOfDeltas(stocks,prices,S0,vols,ki,ttm,rf,knockedIn);rebalance(td,prices);}
    if(isLast){
      unwind(prices);
      if(knockedIn&&wp<1.0){
        const kiLoss=seniorDep*(1-wp);cash-=kiLoss;
        const srPay=Math.max(Math.min(seniorDep,cash),0),jrPay=Math.max(cash-seniorDep,0);
        return{out:'KI',q:nQ,dur:T,srRet:(srPay+totalCpnPaid-seniorDep)/seniorDep,jrRet:(jrPay-juniorDep)/juniorDep,wp,ki:true,tradeCount,cpnPayments,yldEuler,yldFunding,gammaPnL,totalCpnPaid,kiLoss,feeIncome};
      }else{
        const jrPay=Math.max(cash-seniorDep,0);
        return{out:'MAT',q:nQ,dur:T,srRet:totalCpnPaid/seniorDep,jrRet:(jrPay-juniorDep)/juniorDep,wp,ki:false,tradeCount,cpnPayments,yldEuler,yldFunding,gammaPnL,totalCpnPaid,kiLoss:0,feeIncome};
      }
    }
  }
}

function runMC(stocks,cfg,nP){const T=cfg.nQ*0.25;const ts=Math.round(T*252*cfg.stepsPerDay);const paths=genPaths(stocks,nP,T,ts);return paths.map(p=>simPath(p,stocks,cfg)).filter(Boolean);}

function stats(R,cfg){
  const N=R.length,mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const sr=R.map(r=>r.srRet).sort((a,b)=>a-b),jr=R.map(r=>r.jrRet).sort((a,b)=>a-b);
  const pct=(a,p)=>a[Math.min(Math.floor(a.length*p/100),a.length-1)];
  const avgDur=mean(R.map(r=>r.dur));
  const juniorDep=cfg.seniorDep*cfg.juniorRatio;
  const origFeeIncome=(cfg.origFee||0)*cfg.seniorDep;

  // Protocol PnL: Jr residual + fee income + origination
  const protPnLs=R.map(r=>{
    const jrRes=r.jrRet*juniorDep; // Jr cash PnL
    return jrRes+r.feeIncome+origFeeIncome;
  });
  const avgProtPnL=mean(protPnLs);
  const protAPY=avgDur>0?avgProtPnL/juniorDep/avgDur:0;

  return{
    sm:mean(sr),sMed:pct(sr,50),sP5:pct(sr,5),sP95:pct(sr,95),
    sWin:sr.filter(r=>r>=0).length/N,sAnn:avgDur>0?mean(sr)/avgDur:0,
    jm:mean(jr),jMed:pct(jr,50),jP5:pct(jr,5),jP95:pct(jr,95),
    jWin:jr.filter(r=>r>=0).length/N,jAnn:avgDur>0?mean(jr)/avgDur:0,
    acR:R.filter(r=>r.out==='AC').length/N,kiR:R.filter(r=>r.ki).length/N,avgDur,
    avgEuler:mean(R.map(r=>r.yldEuler)),avgFunding:mean(R.map(r=>r.yldFunding)),
    avgGamma:mean(R.map(r=>r.gammaPnL)),avgCpn:mean(R.map(r=>r.totalCpnPaid)),
    avgKI:mean(R.map(r=>r.kiLoss)),avgTrades:mean(R.map(r=>r.tradeCount)),
    avgCpnPay:mean(R.map(r=>r.cpnPayments)),avgFee:mean(R.map(r=>r.feeIncome)),
    origFeeIncome,avgProtPnL,protAPY,
    // Protocol risk
    protP5:pct(protPnLs.sort((a,b)=>a-b),5)/juniorDep/(avgDur||1),
    protP95:pct(protPnLs.sort((a,b)=>a-b),95)/juniorDep/(avgDur||1),
    protWin:protPnLs.filter(p=>p>=0).length/N,
  };
}

const f=v=>`${v>=0?'+':''}${(v*100).toFixed(1)}%`;
const $=v=>`$${v>=0?'':'-'}${Math.abs(v).toFixed(0)}`;
const $$=v=>`$${(v>=0?'+':'-')+Math.abs(v).toFixed(0).padStart(5)}`;
const B='█',G='▓';

console.log(B.repeat(120));
console.log(`${B}  xYIELD v18 — PROTOCOL PROFIT ENGINE`);
console.log(`${B}  Protocol = underwriter | Maximize protocol edge | Fee model`);
console.log(B.repeat(120));

// ============================================================
// PART 1: EDGE DECOMPOSITION
// Where does the protocol profit actually come from?
// ============================================================
console.log('\n'+G.repeat(120));
console.log(`${G}  PART 1: PROTOCOL EDGE DECOMPOSITION`);
console.log(`${G}  Breaking down exactly where protocol profit comes from`);
console.log(G.repeat(120));

const refCfg={ki:0.30,cb:0.45,acStart:1.00,acSD:0.025,cpnPerQ:0.03,mem:true,seniorDep:10000,juniorRatio:0.40,eulerAPY:0.12,fundingAPY:0.05,rf:0.05,nQ:2,deltaThresh:0.03,stepsPerDay:2,protocolSpread:0,origFee:0};
const refStocks=['NVDAx','TSLAx','AMDx'];
const NRef=4000;

console.log('\n  Reference: NVDA/TSLA/AMD, KI 30%, AC 100%, CB 45%, Cpn 3%/Q, Jr 40%, 6mo\n');

// Test with different fee levels
const feeLevels=[
  {spread:0,orig:0,label:'No fees (pure Jr)'},
  {spread:0.015,orig:0.005,label:'+1.5% mgmt +0.5% orig'},
  {spread:0.02,orig:0.005,label:'+2.0% mgmt +0.5% orig'},
  {spread:0.02,orig:0.01,label:'+2.0% mgmt +1.0% orig'},
  {spread:0.03,orig:0.01,label:'+3.0% mgmt +1.0% orig'},
];

const refR=runMC(refStocks,refCfg,NRef);
const refS=stats(refR,refCfg);

console.log('  ┌─────────────────────────────────────────────────────────────────────────────────────────┐');
console.log('  │  PROTOCOL PnL DECOMPOSITION (per $10k Sr note, Jr=$4k, 6mo)                            │');
console.log('  ├─────────────────────────────────────────────────────────────────────────────────────────┤');
const dur=refS.avgDur;
const carryOPM=refS.avgEuler*(10000/(10000+4000)); // Euler from Sr capital
const carryOwn=refS.avgEuler*(4000/(10000+4000)); // Euler from Jr capital
console.log(`  │  Euler on Sr capital (OPM carry)  ${$$(carryOPM)}  (${f(carryOPM/10000/dur)} ann)                           │`);
console.log(`  │  Euler on Jr capital (own carry)   ${$$(carryOwn)}  (${f(carryOwn/4000/dur)} ann)                           │`);
console.log(`  │  Funding rate income               ${$$(refS.avgFunding)}                                                    │`);
console.log(`  │  Gamma hedge PnL                   ${$$(refS.avgGamma)}                                                    │`);
console.log(`  │  ─────────────────────────────────────────                                               │`);
console.log(`  │  TOTAL INCOME                      ${$$(refS.avgEuler+refS.avgFunding+refS.avgGamma)}  (${f((refS.avgEuler+refS.avgFunding+refS.avgGamma)/10000/dur)} ann on Sr)        │`);
console.log(`  │                                                                                         │`);
console.log(`  │  COSTS:                                                                                 │`);
console.log(`  │  Senior coupons paid               ${$$(-refS.avgCpn)}  (${f(refS.avgCpn/10000/dur)} ann to Sr)               │`);
console.log(`  │  KI losses absorbed                ${$$(-refS.avgKI)}  (${(refS.kiR*100).toFixed(1)}% KI rate)                          │`);
console.log(`  │  ─────────────────────────────────────────                                               │`);
console.log(`  │  PROTOCOL NET (Jr residual)        ${$$(refS.avgProtPnL)}  → ${f(refS.protAPY)} ann on $4k Jr capital    │`);
console.log(`  │                                                                                         │`);
console.log(`  │  KEY INSIGHT:                                                                           │`);
console.log(`  │  OPM carry - Sr coupons - KI = ${$$(carryOPM-refS.avgCpn-refS.avgKI)} → ${carryOPM-refS.avgCpn-refS.avgKI>=0?'POSITIVE':'NEGATIVE'} edge on Sr money          │`);
console.log(`  │  Own carry (Euler on Jr)       = ${$$(carryOwn)} → ALWAYS positive                          │`);
console.log(`  │  Protocol earns ~12% on own capital + small margin on OPM                               │`);
console.log('  └─────────────────────────────────────────────────────────────────────────────────────────┘');

console.log('\n  PROTOCOL APY WITH FEE MODELS:');
console.log('  '+'Fee Model'.padEnd(30)+'ProtAPY'.padStart(9)+'SrAPY'.padStart(8)+'ProtWin'.padStart(8)+'SrWin'.padStart(7)+'FeeInc'.padStart(8)+'JrRes'.padStart(8));
console.log('  '+'─'.repeat(80));

for(const fl of feeLevels){
  const cfg2={...refCfg,protocolSpread:fl.spread,origFee:fl.orig};
  const R2=runMC(refStocks,cfg2,NRef);
  const s2=stats(R2,cfg2);
  const origInc=fl.orig*10000;
  console.log('  '+
    fl.label.padEnd(30)+
    f(s2.protAPY).padStart(9)+
    f(s2.sAnn).padStart(8)+
    `${(s2.protWin*100).toFixed(0)}%`.padStart(8)+
    `${(s2.sWin*100).toFixed(0)}%`.padStart(7)+
    `${$$(s2.avgFee+origInc)}`.padStart(8)+
    `${$$(s2.avgProtPnL-s2.avgFee-origInc)}`.padStart(8)
  );
}


// ============================================================
// PART 2: BASKET ANALYSIS — Which underlyings maximize edge?
// ============================================================
console.log('\n\n'+G.repeat(120));
console.log(`${G}  PART 2: BASKET ANALYSIS — Option premium vs KI cost by basket`);
console.log(`${G}  Finding baskets where perceived risk >> actual risk = protocol edge`);
console.log(G.repeat(120));

const baskets=[
  {name:'NVDA/AMD/META',     stocks:['NVDAx','AMDx','METAx']},
  {name:'NVDA/TSLA/META',    stocks:['NVDAx','TSLAx','METAx']},
  {name:'NVDA/TSLA/AMD',     stocks:['NVDAx','TSLAx','AMDx']},
  {name:'NVDA/TSLA/COIN',    stocks:['NVDAx','TSLAx','COINx']},
  {name:'NVDA/TSLA/AMD/META',stocks:['NVDAx','TSLAx','AMDx','METAx']},
  {name:'TSLA/COIN/MSTR',    stocks:['TSLAx','COINx','MSTRx']},
];
const kiLevels=[0.25,0.30,0.35];
const NB=2000;

console.log('\n  Cfg: AC 100%, CB 45%, Cpn 3%/Q, Jr 40%, 6mo, E=12%, Spread=2%, Orig=0.5%\n');
console.log('  '+'Basket'.padEnd(22)+'AvgVol'.padStart(7)+'KI'.padStart(5)+
  '  KI%'.padStart(6)+'AC%'.padStart(5)+
  '  SrAPY'.padStart(8)+'  ProtAPY'.padStart(9)+'ProtWin'.padStart(8)+
  '  $Cpn'.padStart(7)+'$Euler'.padStart(7)+'$KI'.padStart(7)+'$Fee'.padStart(6)+
  '  ProtPnL'.padStart(9)+'CpnR'.padStart(6));
console.log('  '+'─'.repeat(115));

const bktResults=[];
for(const bkt of baskets){
  const avgVol=bkt.stocks.reduce((s,st)=>s+ST[st].vol,0)/bkt.stocks.length;
  for(const ki of kiLevels){
    const cfg={ki,cb:0.45,acStart:1.00,acSD:0.025,cpnPerQ:0.03,mem:true,seniorDep:10000,juniorRatio:0.40,eulerAPY:0.12,fundingAPY:0.05,rf:0.05,nQ:2,deltaThresh:0.03,stepsPerDay:2,protocolSpread:0.02,origFee:0.005};
    const R=runMC(bkt.stocks,cfg,NB);
    const s=stats(R,cfg);
    bktResults.push({...s,bkt:bkt.name,stocks:bkt.stocks,ki,avgVol});
    const cpnRate=s.avgCpnPay/2;
    console.log('  '+
      bkt.name.padEnd(22)+
      `${(avgVol*100).toFixed(0)}%`.padStart(7)+
      `${(ki*100).toFixed(0)}%`.padStart(5)+
      `${(s.kiR*100).toFixed(1)}%`.padStart(6)+
      `${(s.acR*100).toFixed(0)}%`.padStart(5)+
      f(s.sAnn).padStart(8)+
      f(s.protAPY).padStart(9)+
      `${(s.protWin*100).toFixed(0)}%`.padStart(8)+
      `${$$(s.avgCpn)}`.padStart(7)+
      `${$$(s.avgEuler)}`.padStart(7)+
      `${$$(s.avgKI)}`.padStart(7)+
      `${$$(s.avgFee+50)}`.padStart(6)+
      `${$$(s.avgProtPnL)}`.padStart(9)+
      `${(cpnRate*100).toFixed(0)}%`.padStart(6)
    );
  }
}


// ============================================================
// PART 3: PROTOCOL APY SENSITIVITY — What levers matter most?
// ============================================================
console.log('\n\n'+G.repeat(120));
console.log(`${G}  PART 3: PROTOCOL APY SENSITIVITY — One parameter at a time`);
console.log(`${G}  Base: NVDA/TSLA/AMD, KI 30%, AC 100%, CB 45%, 3%/Q, Jr 40%, 6mo, E=12%, Spread=2%`);
console.log(G.repeat(120));

const baseCfg={ki:0.30,cb:0.45,acStart:1.00,acSD:0.025,cpnPerQ:0.03,mem:true,seniorDep:10000,juniorRatio:0.40,eulerAPY:0.12,fundingAPY:0.05,rf:0.05,nQ:2,deltaThresh:0.03,stepsPerDay:2,protocolSpread:0.02,origFee:0.005};
const baseStocks=['NVDAx','TSLAx','AMDx'];
const NS=1500;

function sensTest(label,param,values,stocks){
  console.log(`\n  ═══ ${label} ═══`);
  console.log('  '+'Value'.padEnd(10)+'ProtAPY'.padStart(9)+'SrAPY'.padStart(8)+'ProtWin'.padStart(8)+
    'SrWin'.padStart(6)+'KI%'.padStart(6)+'AC%'.padStart(5)+'$ProtPnL'.padStart(9)+'ProtP5'.padStart(8));
  console.log('  '+'─'.repeat(75));
  for(const v of values){
    const cfg={...baseCfg,[param]:v};
    const R=runMC(stocks||baseStocks,cfg,NS);
    const s=stats(R,cfg);
    console.log('  '+
      `${typeof v==='number'&&v<1?`${(v*100).toFixed(0)}%`:`${v}`}`.padEnd(10)+
      f(s.protAPY).padStart(9)+
      f(s.sAnn).padStart(8)+
      `${(s.protWin*100).toFixed(0)}%`.padStart(8)+
      `${(s.sWin*100).toFixed(0)}%`.padStart(6)+
      `${(s.kiR*100).toFixed(1)}%`.padStart(6)+
      `${(s.acR*100).toFixed(0)}%`.padStart(5)+
      `${$$(s.avgProtPnL)}`.padStart(9)+
      f(s.protP5).padStart(8)
    );
  }
}

sensTest('EULER APY (pool yield)','eulerAPY',[0.08,0.10,0.12,0.15,0.18,0.22]);
sensTest('COUPON RATE (Sr cost)','cpnPerQ',[0.02,0.025,0.03,0.035,0.04,0.05]);
sensTest('JUNIOR RATIO (leverage)','juniorRatio',[0.15,0.20,0.25,0.30,0.35,0.40,0.50]);
sensTest('KI BARRIER (tail risk)','ki',[0.20,0.25,0.30,0.35,0.40]);
sensTest('MATURITY','nQ',[1,2,3,4]);
sensTest('PROTOCOL SPREAD (mgmt fee)','protocolSpread',[0,0.01,0.015,0.02,0.025,0.03]);


// ============================================================
// PART 4: COMBINED SWEEP — Mode A (Safe) vs Mode B (Premium)
// ============================================================
console.log('\n\n'+G.repeat(120));
console.log(`${G}  PART 4: PRODUCT MODES — Safe vs Premium`);
console.log(G.repeat(120));

// Mode A: Safe product — moderate coupon, deep KI, protocol earns carry + fees
// Mode B: Premium product — higher coupon, more vol, protocol earns option premium + fees
const sweepCfgs=[];
const N4=1500;

// Mode A sweep
const modeA_bkts=[
  {name:'NVDA/TSLA/AMD',stocks:['NVDAx','TSLAx','AMDx']},
  {name:'NVDA/TSLA/META',stocks:['NVDAx','TSLAx','METAx']},
  {name:'NVDA/AMD/META',stocks:['NVDAx','AMDx','METAx']},
];
const modeA_ki=[0.25,0.30];
const modeA_cpn=[0.02,0.025,0.03];
const modeA_jr=[0.30,0.35,0.40];
const modeA_euler=[0.12,0.15];
const modeA_spread=[0.02,0.025];

console.log('\n  ── Mode A: Safe Product (deep KI, moderate coupon, protocol earns carry) ──\n');
let cnt4=0;
for(const bkt of modeA_bkts)
  for(const ki of modeA_ki)
    for(const cpn of modeA_cpn)
      for(const jr of modeA_jr)
        for(const euler of modeA_euler)
          for(const spread of modeA_spread){
            cnt4++;
            const cfg={ki,cb:0.45,acStart:1.00,acSD:0.025,cpnPerQ:cpn,mem:true,seniorDep:10000,juniorRatio:jr,eulerAPY:euler,fundingAPY:0.05,rf:0.05,nQ:2,deltaThresh:0.03,stepsPerDay:2,protocolSpread:spread,origFee:0.005};
            const R=runMC(bkt.stocks,cfg,N4);
            const s=stats(R,cfg);
            sweepCfgs.push({mode:'A',bkt:bkt.name,stocks:bkt.stocks,ki,cpn,jr,euler,spread,...s});
          }

// Mode B sweep
const modeB_bkts=[
  {name:'NVDA/TSLA/AMD',stocks:['NVDAx','TSLAx','AMDx']},
  {name:'NVDA/TSLA/COIN',stocks:['NVDAx','TSLAx','COINx']},
  {name:'NVDA/TSLA/AMD/META',stocks:['NVDAx','TSLAx','AMDx','METAx']},
];
const modeB_ki=[0.25,0.30,0.35];
const modeB_cpn=[0.035,0.04,0.05];
const modeB_jr=[0.25,0.30,0.35,0.40];
const modeB_euler=[0.12,0.15];
const modeB_spread=[0.02,0.025];

for(const bkt of modeB_bkts)
  for(const ki of modeB_ki)
    for(const cpn of modeB_cpn)
      for(const jr of modeB_jr)
        for(const euler of modeB_euler)
          for(const spread of modeB_spread){
            cnt4++;
            const cfg={ki,cb:0.45,acStart:1.00,acSD:0.025,cpnPerQ:cpn,mem:true,seniorDep:10000,juniorRatio:jr,eulerAPY:euler,fundingAPY:0.05,rf:0.05,nQ:2,deltaThresh:0.03,stepsPerDay:2,protocolSpread:spread,origFee:0.005};
            const R=runMC(bkt.stocks,cfg,N4);
            const s=stats(R,cfg);
            sweepCfgs.push({mode:'B',bkt:bkt.name,stocks:bkt.stocks,ki,cpn,jr,euler,spread,...s});
          }

console.log(`  Swept ${cnt4} configs\n`);

// Filter and display Mode A
const modeAFiltered=sweepCfgs.filter(r=>r.mode==='A'&&r.sAnn>=0.08&&r.protAPY>=0.10&&r.sWin>=0.95&&r.protWin>=0.85)
  .sort((a,b)=>b.protAPY-a.protAPY);
console.log(`  Mode A balanced: ${modeAFiltered.length} configs (Sr≥8%, Prot≥10%, SrWin≥95%, ProtWin≥85%)\n`);
console.log('  TOP 15 — Mode A:');
console.log('  '+'Basket'.padEnd(22)+'KI'.padEnd(5)+'Cpn'.padEnd(5)+'Jr'.padEnd(5)+'E'.padEnd(5)+'Sp'.padEnd(5)+
  '│ SrAPY'.padStart(8)+' SrW'.padStart(5)+
  '│ ProtAPY'.padStart(9)+' PrW'.padStart(5)+' PrP5'.padStart(7)+
  '│ $Cpn'.padStart(7)+'$Eul'.padStart(6)+'$KI'.padStart(6)+'$Fee'.padStart(6)+
  '│ KI%'.padStart(5));
console.log('  '+'─'.repeat(120));
for(const r of modeAFiltered.slice(0,15)){
  console.log('  '+
    r.bkt.padEnd(22)+`${(r.ki*100).toFixed(0)}%`.padEnd(5)+`${(r.cpn*100).toFixed(1)}%`.padEnd(5)+
    `${(r.jr*100).toFixed(0)}%`.padEnd(5)+`${(r.euler*100).toFixed(0)}%`.padEnd(5)+`${(r.spread*100).toFixed(1)}%`.padEnd(5)+
    `│ ${f(r.sAnn).padStart(7)}`+` ${(r.sWin*100).toFixed(0)}%`.padStart(5)+
    `│ ${f(r.protAPY).padStart(8)}`+` ${(r.protWin*100).toFixed(0)}%`.padStart(5)+` ${f(r.protP5).padStart(6)}`+
    `│ ${$$(r.avgCpn).padStart(6)}`+`${$$(r.avgEuler).padStart(6)}`+`${$$(r.avgKI).padStart(6)}`+`${$$(r.avgFee+50).padStart(6)}`+
    `│ ${(r.kiR*100).toFixed(1)}%`.padStart(5)
  );
}

// Filter and display Mode B
console.log('\n\n  ── Mode B: Premium Product (higher coupon, more vol, protocol captures premium) ──\n');
const modeBFiltered=sweepCfgs.filter(r=>r.mode==='B'&&r.sAnn>=0.12&&r.protAPY>=0.15&&r.sWin>=0.90&&r.protWin>=0.70)
  .sort((a,b)=>b.protAPY-a.protAPY);
console.log(`  Mode B balanced: ${modeBFiltered.length} configs (Sr≥12%, Prot≥15%, SrWin≥90%, ProtWin≥70%)\n`);

if(modeBFiltered.length===0){
  // Softer filter
  const soft=sweepCfgs.filter(r=>r.mode==='B'&&r.sAnn>=0.10&&r.protAPY>=0.08&&r.sWin>=0.85)
    .sort((a,b)=>b.protAPY-a.protAPY);
  console.log(`  Soft filter (Sr≥10%, Prot≥8%, SrWin≥85%): ${soft.length} configs\n`);
  modeBFiltered.push(...soft);
}

console.log('  TOP 15 — Mode B:');
console.log('  '+'Basket'.padEnd(22)+'KI'.padEnd(5)+'Cpn'.padEnd(5)+'Jr'.padEnd(5)+'E'.padEnd(5)+'Sp'.padEnd(5)+
  '│ SrAPY'.padStart(8)+' SrW'.padStart(5)+
  '│ ProtAPY'.padStart(9)+' PrW'.padStart(5)+' PrP5'.padStart(7)+
  '│ $Cpn'.padStart(7)+'$Eul'.padStart(6)+'$KI'.padStart(6)+'$Fee'.padStart(6)+
  '│ KI%'.padStart(5));
console.log('  '+'─'.repeat(120));
for(const r of modeBFiltered.slice(0,15)){
  console.log('  '+
    r.bkt.padEnd(22)+`${(r.ki*100).toFixed(0)}%`.padEnd(5)+`${(r.cpn*100).toFixed(1)}%`.padEnd(5)+
    `${(r.jr*100).toFixed(0)}%`.padEnd(5)+`${(r.euler*100).toFixed(0)}%`.padEnd(5)+`${(r.spread*100).toFixed(1)}%`.padEnd(5)+
    `│ ${f(r.sAnn).padStart(7)}`+` ${(r.sWin*100).toFixed(0)}%`.padStart(5)+
    `│ ${f(r.protAPY).padStart(8)}`+` ${(r.protWin*100).toFixed(0)}%`.padStart(5)+` ${f(r.protP5).padStart(6)}`+
    `│ ${$$(r.avgCpn).padStart(6)}`+`${$$(r.avgEuler).padStart(6)}`+`${$$(r.avgKI).padStart(6)}`+`${$$(r.avgFee+50).padStart(6)}`+
    `│ ${(r.kiR*100).toFixed(1)}%`.padStart(5)
  );
}


// ============================================================
// PART 5: DEEP DIVE — Top structures with full decomposition
// ============================================================
console.log('\n\n'+G.repeat(120));
console.log(`${G}  PART 5: DEEP DIVE — Best structures for protocol profitability`);
console.log(G.repeat(120));

const deepCandidates=[
  ...(modeAFiltered.slice(0,3).map(r=>({...r,label:'Mode A'}))),
  ...(modeBFiltered.slice(0,3).map(r=>({...r,label:'Mode B'}))),
];

// If we have less than 3 of either, add from the other
if(deepCandidates.length<3){
  const all=sweepCfgs.filter(r=>r.sAnn>0&&r.protAPY>0).sort((a,b)=>b.protAPY-a.protAPY);
  for(const r of all.slice(0,5))deepCandidates.push({...r,label:'Best'});
}

for(let i=0;i<Math.min(deepCandidates.length,6);i++){
  const b=deepCandidates[i];
  process.stdout.write(`\n  #${i+1} [${b.label}] ${b.bkt}...`);
  const cfg={ki:b.ki,cb:0.45,acStart:1.00,acSD:0.025,cpnPerQ:b.cpn,mem:true,seniorDep:10000,juniorRatio:b.jr,eulerAPY:b.euler,fundingAPY:0.05,rf:0.05,nQ:2,deltaThresh:0.03,stepsPerDay:2,protocolSpread:b.spread,origFee:0.005};
  const R=runMC(b.stocks,cfg,6000);
  const s=stats(R,cfg);
  console.log(' done');

  const juniorDep=10000*b.jr;
  const lev=((1+b.jr)/b.jr).toFixed(1);
  const dur=s.avgDur;
  const origInc=50; // 0.5% of 10k
  const totalFee=s.avgFee+origInc;
  const jrRes=s.jAnn*juniorDep*dur; // approximate Jr dollar PnL
  const totalIncome=s.avgEuler+s.avgFunding+s.avgGamma;
  const netAfterCosts=totalIncome-s.avgCpn-s.avgKI;

  // Conditional KI loss
  const kiPaths=R.filter(r=>r.ki);
  const condKI=kiPaths.length>0?kiPaths.reduce((s,r)=>s+r.kiLoss,0)/kiPaths.length:0;

  console.log(`
  ┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #${i+1} [${b.label}] ${b.bkt.padEnd(22)} KI:${(b.ki*100).toFixed(0)}% Cpn:${(b.cpn*100).toFixed(1)}%/Q Jr:${(b.jr*100).toFixed(0)}%(${lev}x) 6mo E:${(b.euler*100).toFixed(0)}% Sp:${(b.spread*100).toFixed(1)}%  │
  ├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │  SENIOR (retail)       APY: ${f(s.sAnn).padStart(7)}   Win: ${(s.sWin*100).toFixed(1)}%   Med: ${f(s.sMed).padStart(7)}   P5: ${f(s.sP5).padStart(7)}              │
  │  PROTOCOL (underwriter) APY: ${f(s.protAPY).padStart(7)}   Win: ${(s.protWin*100).toFixed(1)}%   P5: ${f(s.protP5).padStart(7)}   P95: ${f(s.protP95).padStart(7)}              │
  ├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │  PROTOCOL PROFIT ENGINE (per $10k Sr note):                                                         │
  │  ┌───────────────────────┬────────────┬──────────────────────────────────────────┐                   │
  │  │ REVENUE               │            │                                          │                   │
  │  │ Euler yield (pool)     │ ${$$(s.avgEuler).padStart(9)}  │  on $${(10000+juniorDep).toFixed(0)} pool at ${(b.euler*100).toFixed(0)}% (net ${((b.euler-b.spread)*100).toFixed(1)}% to pool)    │                   │
  │  │ Funding rate           │ ${$$(s.avgFunding).padStart(9)}  │  on short hedge notional                 │                   │
  │  │ Gamma PnL              │ ${$$(s.avgGamma).padStart(9)}  │  short rebalancing                       │                   │
  │  │ Management fee         │ ${$$(s.avgFee).padStart(9)}  │  ${(b.spread*100).toFixed(1)}% ann on pool AUM                       │                   │
  │  │ Origination fee        │ ${$$(origInc).padStart(9)}  │  0.5% of Sr deposit (one-time)           │                   │
  │  ├───────────────────────┼────────────┼──────────────────────────────────────────┤                   │
  │  │ COSTS                  │            │                                          │                   │
  │  │ Senior coupons         │ ${$$(-s.avgCpn).padStart(9)}  │  ${(b.cpn*100).toFixed(1)}%/Q → ${f(s.avgCpn/10000/dur)} ann to Sr                 │                   │
  │  │ KI losses              │ ${$$(-s.avgKI).padStart(9)}  │  ${(s.kiR*100).toFixed(1)}% rate, avg ${$(condKI)} per event              │                   │
  │  ├───────────────────────┼────────────┼──────────────────────────────────────────┤                   │
  │  │ PROTOCOL NET           │ ${$$(s.avgProtPnL).padStart(9)}  │  on $${juniorDep.toFixed(0)} capital → ${f(s.protAPY)} ann          │                   │
  │  └───────────────────────┴────────────┴──────────────────────────────────────────┘                   │
  │                                                                                                      │
  │  EDGE DECOMPOSITION:                                                                                 │
  │    Carry edge (Euler on OPM - coupons) = ${$$(s.avgEuler*(10000/(10000+juniorDep))-s.avgCpn)}                                                      │
  │    Own capital return (Euler on Jr)     = ${$$(s.avgEuler*(juniorDep/(10000+juniorDep)))}                                                      │
  │    Fee income (mgmt + orig)            = ${$$(totalFee)}                                                      │
  │    KI cost                             = ${$$(-s.avgKI)}                                                      │
  │                                                                                                      │
  │  OUTCOMES: AC ${(s.acR*100).toFixed(0)}%  MAT ${((1-s.acR-s.kiR)*100).toFixed(0)}%  KI ${(s.kiR*100).toFixed(1)}%  CpnRate ${(s.avgCpnPay/2*100).toFixed(0)}%  ${s.avgTrades.toFixed(0)} trades                              │
  └──────────────────────────────────────────────────────────────────────────────────────────────────────┘`);
}


// ============================================================
// RECOMMENDATION
// ============================================================
console.log('\n\n'+B.repeat(120));
console.log(`${B}  RECOMMENDATION — Which product to build for the MVP`);
console.log(B.repeat(120));

const bestA=modeAFiltered[0]||sweepCfgs.filter(r=>r.mode==='A').sort((a,b)=>b.protAPY-a.protAPY)[0];
const bestB=modeBFiltered[0]||sweepCfgs.filter(r=>r.mode==='B').sort((a,b)=>b.protAPY-a.protAPY)[0];

if(bestA)console.log(`
  MODE A (MVP — Safe Retail Product):
    Basket:     ${bestA.bkt}
    KI:         ${(bestA.ki*100).toFixed(0)}%
    Coupon:     ${(bestA.cpn*100).toFixed(1)}%/Q = ${(bestA.cpn*400).toFixed(0)}% ann
    Jr ratio:   ${(bestA.jr*100).toFixed(0)}%
    Euler:      ${(bestA.euler*100).toFixed(0)}%
    Mgmt fee:   ${(bestA.spread*100).toFixed(1)}%
    → Senior:   ${f(bestA.sAnn)} APY, ${(bestA.sWin*100).toFixed(0)}% win
    → Protocol: ${f(bestA.protAPY)} APY, ${(bestA.protWin*100).toFixed(0)}% win
`);

if(bestB)console.log(`
  MODE B (Growth — Premium Product):
    Basket:     ${bestB.bkt}
    KI:         ${(bestB.ki*100).toFixed(0)}%
    Coupon:     ${(bestB.cpn*100).toFixed(1)}%/Q = ${(bestB.cpn*400).toFixed(0)}% ann
    Jr ratio:   ${(bestB.jr*100).toFixed(0)}%
    Euler:      ${(bestB.euler*100).toFixed(0)}%
    Mgmt fee:   ${(bestB.spread*100).toFixed(1)}%
    → Senior:   ${f(bestB.sAnn)} APY, ${(bestB.sWin*100).toFixed(0)}% win
    → Protocol: ${f(bestB.protAPY)} APY, ${(bestB.protWin*100).toFixed(0)}% win
`);

console.log(`
  PROTOCOL BUSINESS MODEL:
    1. Launch with Mode A → prove safety, attract retail
    2. Add Mode B → capture premium seekers, higher protocol margin
    3. Scale: protocol captures mgmt fee + Jr residual + origination
    4. As AUM grows, fee income becomes the dominant profit driver
`);

console.log(B.repeat(120));
console.log(`${B}  v18 COMPLETE — Protocol profit engine analyzed`);
console.log(B.repeat(120)+'\n');
