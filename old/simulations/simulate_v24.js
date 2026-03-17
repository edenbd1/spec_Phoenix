#!/usr/bin/env node
// ============================================================
// xYield v24 — OVERNIGHT DESIGN SPACE SWEEP
//
// Full parameter space exploration with parallel execution.
// Produces: v24_results.json (raw) + v24_analysis.txt (formatted)
//
// Usage: node simulate_v24.js [--workers N] [--paths N] [--quick]
//   --workers N  : number of worker threads (default: CPU count)
//   --paths N    : paths per config (default: 2000, quick: 500)
//   --quick      : fast mode for testing (500 paths, subset of grid)
// ============================================================

const { Worker } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');

// ─── CLI ARGS ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i+1] ? Number(args[i+1]) : def; };
const QUICK = args.includes('--quick');
const NUM_WORKERS = getArg('--workers', os.cpus().length);
const PATHS_PER_CONFIG = getArg('--paths', QUICK ? 500 : 2000);
const BATCH_SIZE = 20; // configs per worker message

// ─── PARAMETER GRID ────────────────────────────────────────────────────────

const BASKETS = [
  { name:'NVDA/AMD/META',   stocks:['NVDAx','AMDx','METAx'] },
  { name:'NVDA/META/AMZN',  stocks:['NVDAx','METAx','AMZNx'] },
  { name:'META/AAPL/AMZN',  stocks:['METAx','AAPLx','AMZNx'] },
  { name:'NVDA/AMD',        stocks:['NVDAx','AMDx'] },
  { name:'NVDA/META',       stocks:['NVDAx','METAx'] },
  { name:'NVDA/TSLA/AMD',   stocks:['NVDAx','TSLAx','AMDx'] },
  { name:'NVDA/META/TSLA',  stocks:['NVDAx','METAx','TSLAx'] },
  { name:'META/AAPL',       stocks:['METAx','AAPLx'] },
];

// Maturity configs: [label, nObs, obsFreq]
const MATURITIES = QUICK ? [
  ['3mo-M', 3, 1/12],
  ['6mo-Q', 2, 0.25],
] : [
  ['3mo-M', 3, 1/12],
  ['6mo-Q', 2, 0.25],
];

const COUPONS    = QUICK ? [0.08, 0.12]          : [0.06, 0.08, 0.10, 0.12, 0.14];
const KI_BARS    = QUICK ? [0.40, 0.55]          : [0.30, 0.40, 0.50, 0.60];
const CB_BARS    = QUICK ? [0.80, 0.90]          : [0.70, 0.80, 0.90];
const AC_TRIGS   = QUICK ? [0.95, 1.00]          : [0.95, 1.00, 1.05];
const JR_RATIOS  = QUICK ? [0.30, 0.35, 0.40]     : [0.20, 0.30, 0.35, 0.40, 0.50];
const VRP_LEVELS = QUICK ? [0, 0.20, 0.30]       : [0, 0.20, 0.30];
const EULER_LEVELS =                                [0.02, 0.03, 0.04, 0.05, 0.08, 0.12, 0.15];

// Vol regimes
const VOL_REGIMES = QUICK ? {
  normal: { volMult:1.0, driftOverride:null },
  crash:  { volMult:1.8, driftOverride:-0.30 },
} : {
  low:    { volMult:0.70, driftOverride:null },
  normal: { volMult:1.00, driftOverride:null },
  high:   { volMult:1.30, driftOverride:null },
  crash:  { volMult:1.80, driftOverride:-0.30 },
};

// Corr regimes
const CORR_REGIMES = QUICK ? {
  normal: { corrShift:0.00 },
  spike:  { corrShift:0.25 },
} : {
  normal:  { corrShift:0.00 },
  spike:   { corrShift:0.25 },
  decorr:  { corrShift:-0.25 },
};

// Historical regime proxies
const HIST_REGIMES = QUICK ? {} : {
  '2020_crash':      { volMult:1.80, driftOverride:-0.35, corrShift:0.30 },
  '2022_bear':       { volMult:1.40, driftOverride:-0.25, corrShift:0.20 },
};

// ─── JOB GENERATION ─────────────────────────────────────────────────────────

function generateJobs() {
  const jobs = [];
  let id = 0;

  // Build all regime combos
  const regimes = [];

  // Synthetic: vol × corr
  for (const [vName, vCfg] of Object.entries(VOL_REGIMES)) {
    for (const [cName, cCfg] of Object.entries(CORR_REGIMES)) {
      regimes.push({
        regimeName: `${vName}_${cName}`,
        regimeType: 'synthetic',
        volMult: vCfg.volMult,
        driftOverride: vCfg.driftOverride,
        corrShift: cCfg.corrShift,
      });
    }
  }

  // Historical proxies
  for (const [hName, hCfg] of Object.entries(HIST_REGIMES)) {
    regimes.push({
      regimeName: hName,
      regimeType: 'historical',
      volMult: hCfg.volMult,
      driftOverride: hCfg.driftOverride,
      corrShift: hCfg.corrShift,
    });
  }

  for (const basket of BASKETS) {
    for (const [matLabel, nObs, obsFreq] of MATURITIES) {
      for (const cpnAnn of COUPONS) {
        for (const ki of KI_BARS) {
          for (const cb of CB_BARS) {
            for (const ac of AC_TRIGS) {
              for (const vrp of VRP_LEVELS) {
                for (const regime of regimes) {
                  // Use first Jr ratio for MC (Jr ratio only affects PnL split, not paths)
                  // We'll compute all Jr ratios post-hoc
                  const cfg = {
                    ki, cb, acStart: ac, acSD: 0.00, // no step-down for sweep simplicity
                    cpnPerPeriod: cpnAnn / (obsFreq < 0.1 ? 12 : 4), // monthly or quarterly
                    seniorDep: 10000,
                    juniorRatio: 0.35, // reference ratio for MC (actual Jr ratios computed post-hoc)
                    rf: 0.05,
                    nObs, obsFreq,
                    deltaThresh: 0.03,
                    stepsPerDay: 1, // reduced for speed (was 2 in v23)
                    acStartObs: 2,
                  };

                  jobs.push({
                    id: id++,
                    stocks: basket.stocks,
                    cfg,
                    nPaths: PATHS_PER_CONFIG,
                    vrp,
                    volMult: regime.volMult,
                    corrShift: regime.corrShift,
                    driftOverride: regime.driftOverride,
                    // Metadata for output
                    meta: {
                      basket: basket.name,
                      basketSize: basket.stocks.length,
                      maturity: matLabel,
                      cpnAnn,
                      ki, cb, ac,
                      vrp,
                      regime: regime.regimeName,
                      regimeType: regime.regimeType,
                    },
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  return jobs;
}

// ─── WORKER POOL ────────────────────────────────────────────────────────────

class WorkerPool {
  constructor(numWorkers, workerFile) {
    this.workers = [];
    this.queue = [];
    this.results = [];
    this.inflight = 0;
    this.totalJobs = 0;
    this.completedJobs = 0;
    this.startTime = Date.now();
    this.resolveAll = null;

    for (let i = 0; i < numWorkers; i++) {
      const w = new Worker(workerFile);
      w.on('message', (msg) => this._onResult(w, msg));
      w.on('error', (err) => console.error(`Worker error:`, err));
      this.workers.push({ worker: w, busy: false });
    }
  }

  _onResult(worker, msg) {
    if (msg.type === 'results') {
      this.results.push(...msg.results);
      this.completedJobs += msg.results.length;
      this.inflight--;

      // Progress
      const pct = (this.completedJobs / this.totalJobs * 100).toFixed(1);
      const elapsed = (Date.now() - this.startTime) / 1000;
      const rate = this.completedJobs / elapsed;
      const eta = rate > 0 ? (this.totalJobs - this.completedJobs) / rate : 0;
      const etaMin = (eta / 60).toFixed(1);
      process.stdout.write(`\r  Progress: ${this.completedJobs}/${this.totalJobs} (${pct}%) | ${rate.toFixed(0)} cfg/s | ETA: ${etaMin}min    `);
    }

    const wObj = this.workers.find(w => w.worker === worker);
    wObj.busy = false;
    this._dispatch();

    if (this.inflight === 0 && this.queue.length === 0 && this.resolveAll) {
      this.resolveAll();
    }
  }

  _dispatch() {
    for (const w of this.workers) {
      if (w.busy || this.queue.length === 0) continue;
      const batch = this.queue.shift();
      w.busy = true;
      this.inflight++;
      w.worker.postMessage({ type: 'batch', jobs: batch.jobs, batchId: batch.id });
    }
  }

  async runAll(jobs) {
    this.totalJobs = jobs.length;
    this.completedJobs = 0;
    this.startTime = Date.now();

    // Split into batches
    let batchId = 0;
    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
      // Strip meta from jobs sent to worker (save memory in transport)
      const batchJobs = jobs.slice(i, i + BATCH_SIZE).map(j => ({
        id: j.id,
        stocks: j.stocks,
        cfg: j.cfg,
        nPaths: j.nPaths,
        vrp: j.vrp,
        volMult: j.volMult,
        corrShift: j.corrShift,
        driftOverride: j.driftOverride,
      }));
      this.queue.push({ id: batchId++, jobs: batchJobs });
    }

    return new Promise((resolve) => {
      this.resolveAll = resolve;
      this._dispatch();
    });
  }

  terminate() {
    for (const w of this.workers) w.worker.terminate();
  }
}

// ─── POST-HOC COMPUTATIONS ──────────────────────────────────────────────────

function enrichResult(raw, meta) {
  const out = { ...meta, ...raw };

  // Compute protocol PnL at each Euler level and Jr ratio
  // Euler carry approximation: poolSize * poolUtil * eulerAPY * avgDur
  // Fee income: poolSize * poolUtil * protocolSpread * avgDur + origFee * seniorDep
  const protocolSpread = 0.02;
  const origFee = 0.005;
  const seniorDep = 10000;

  out.eulerPnL = {};
  out.protPnL = {};

  const refJr = 0.35;

  for (const euler of EULER_LEVELS) {
    // Net pool income from Euler (net of protocol spread)
    const netEulerToPool = raw.poolSize * raw.poolUtil * (euler - protocolSpread) * raw.avgDur;
    const feeInc = raw.poolSize * raw.poolUtil * protocolSpread * raw.avgDur + origFee * seniorDep;
    const eKey = euler.toFixed(4); // string key for reliable lookup
    out.eulerPnL[eKey] = netEulerToPool;

    // Protocol PnL at each Jr ratio
    out.protPnL[eKey] = {};
    for (const jr of JR_RATIOS) {
      const jKey = jr.toFixed(4);
      // avgJrPnL is the $ residual to Jr at ref ratio (0.35)
      // For different Jr: approximate — same option outcome, different capital base
      const rawOptPnL = raw.avgJrPnL;
      const protPnL = rawOptPnL + netEulerToPool + feeInc;
      const protAPY = raw.avgDur > 0 ? protPnL / (seniorDep * refJr) / raw.avgDur : 0;

      out.protPnL[eKey][jKey] = {
        pnl: protPnL,
        apy: protAPY,
        breakeven: protPnL >= 0,
      };
    }
  }

  // Breakeven Euler (at ref Jr=0.35)
  const jrDep = seniorDep * refJr;
  const feeIncBE = raw.poolSize * raw.poolUtil * protocolSpread * raw.avgDur + origFee * seniorDep;
  const eulerPerPct = raw.poolSize * raw.poolUtil * raw.avgDur;
  // PnL(euler) = rawOptPnL + poolSize*poolUtil*(euler - spread)*avgDur + feeInc
  // = 0 → euler = spread + (- rawOptPnL - feeInc) / (poolSize * poolUtil * avgDur)
  const deficit = -raw.avgJrPnL - feeIncBE;
  out.breakEuler = eulerPerPct > 0 ? Math.max(0, protocolSpread + deficit / eulerPerPct) : null;

  return out;
}

// ─── ANALYSIS ───────────────────────────────────────────────────────────────

function analyze(enriched) {
  const lines = [];
  const L = s => lines.push(s);
  const B='█', G='▓', D='─';
  const f = v => `${v>=0?'+':''}${(v*100).toFixed(1)}%`;
  const $$ = v => `$${(v>=0?'+':'-')+Math.abs(v).toFixed(0).padStart(5)}`;

  L(B.repeat(120));
  L(`${B}  xYIELD v24 — OVERNIGHT DESIGN SPACE SWEEP — RESULTS`);
  L(`${B}  ${enriched.length} configurations analyzed`);
  L(`${B}  Date: ${new Date().toISOString().split('T')[0]}`);
  L(B.repeat(120));

  // ── Reference Euler for rankings (string keys for object lookup)
  const REF_EULER = (0.05).toFixed(4);
  const REF_JR = (0.35).toFixed(4);

  // Filter to normal regime for primary rankings
  const normalRegime = enriched.filter(r => r.regime === 'normal_normal');

  // ════════════════════════════════════════════════════════════════════════
  // 1. TOP 10 BY PROTOCOL PROFITABILITY
  // ════════════════════════════════════════════════════════════════════════

  L('\n' + G.repeat(120));
  L(`${G}  1. TOP 10 STRUCTURES BY PROTOCOL PROFITABILITY`);
  L(`${G}  Ranked by Protocol APY at Euler=${(REF_EULER*100)}%, Jr=${(REF_JR*100)}%, normal regime`);
  L(G.repeat(120));

  const byProfit = normalRegime
    .filter(r => r.protPnL?.[REF_EULER]?.[REF_JR])
    .sort((a,b) => b.protPnL[REF_EULER][REF_JR].apy - a.protPnL[REF_EULER][REF_JR].apy)
    .slice(0, 10);

  L('\n  #  Basket            Mat    VRP  KI  CB  AC  Cpn   KI%   AC% SrAPY SrWin ProtAPY  BEuler AvgDur');
  L('  ' + D.repeat(110));
  byProfit.forEach((r, i) => {
    const pa = r.protPnL[REF_EULER][REF_JR];
    L(`  ${String(i+1).padStart(2)} ${r.basket.padEnd(18)} ${r.maturity.padEnd(6)} ${(r.vrp*100).toFixed(0).padStart(3)}% ${(r.ki*100).toFixed(0).padStart(3)}% ${(r.cb*100).toFixed(0).padStart(3)}% ${(r.ac*100).toFixed(0).padStart(3)}% ${(r.cpnAnn*100).toFixed(0).padStart(3)}%  ${(r.kiR*100).toFixed(1).padStart(5)}% ${(r.acR*100).toFixed(0).padStart(4)}% ${f(r.sAnn).padStart(6)} ${(r.sWin*100).toFixed(0).padStart(4)}%  ${f(pa.apy).padStart(7)} ${r.breakEuler!=null?(r.breakEuler*100).toFixed(1).padStart(6)+'%':'   N/A'} ${r.avgDur.toFixed(2).padStart(6)}yr`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. TOP 10 BY ROBUSTNESS
  // ════════════════════════════════════════════════════════════════════════

  L('\n\n' + G.repeat(120));
  L(`${G}  2. TOP 10 STRUCTURES BY ROBUSTNESS`);
  L(`${G}  Score = profitable across ALL regimes + high Sr win + low KI`);
  L(G.repeat(120));

  // Group by structure (basket+mat+cpn+ki+cb+ac+vrp), check profitability across regimes
  const structKey = r => `${r.basket}|${r.maturity}|${r.cpnAnn}|${r.ki}|${r.cb}|${r.ac}|${r.vrp}`;
  const structGroups = {};
  for (const r of enriched) {
    const k = structKey(r);
    if (!structGroups[k]) structGroups[k] = [];
    structGroups[k].push(r);
  }

  const robustScores = [];
  for (const [key, group] of Object.entries(structGroups)) {
    const regimesProfit = group.filter(r =>
      r.protPnL?.[REF_EULER]?.[REF_JR] && r.protPnL[REF_EULER][REF_JR].pnl > 0
    ).length;
    const totalRegimes = group.length;
    const normalR = group.find(r => r.regime === 'normal_normal');
    if (!normalR) continue;

    const profitRate = regimesProfit / totalRegimes;
    const avgKI = group.reduce((s,r) => s + r.kiR, 0) / totalRegimes;
    const avgSrWin = group.reduce((s,r) => s + r.sWin, 0) / totalRegimes;
    const worstPnL = Math.min(...group.map(r =>
      r.protPnL?.[REF_EULER]?.[REF_JR] ? r.protPnL[REF_EULER][REF_JR].pnl : -Infinity
    ).filter(v => v > -Infinity));

    // Robustness score: weighted combo
    const score = profitRate * 40 + avgSrWin * 30 + (1 - avgKI) * 20 + (worstPnL > 0 ? 10 : 0);

    robustScores.push({
      key, normalR, profitRate, totalRegimes, avgKI, avgSrWin, worstPnL, score,
      meta: normalR,
    });
  }

  robustScores.sort((a,b) => b.score - a.score);
  const topRobust = robustScores.slice(0, 10);

  L('\n  #  Basket            Mat    VRP  KI  CB  AC  Cpn  RegProf%  AvgKI% AvgSrW  WorstPnL  Score');
  L('  ' + D.repeat(110));
  topRobust.forEach((r, i) => {
    const m = r.meta;
    L(`  ${String(i+1).padStart(2)} ${m.basket.padEnd(18)} ${m.maturity.padEnd(6)} ${(m.vrp*100).toFixed(0).padStart(3)}% ${(m.ki*100).toFixed(0).padStart(3)}% ${(m.cb*100).toFixed(0).padStart(3)}% ${(m.ac*100).toFixed(0).padStart(3)}% ${(m.cpnAnn*100).toFixed(0).padStart(3)}%   ${(r.profitRate*100).toFixed(0).padStart(4)}%  ${(r.avgKI*100).toFixed(1).padStart(5)}% ${(r.avgSrWin*100).toFixed(0).padStart(5)}%  ${$$(r.worstPnL).padStart(8)} ${r.score.toFixed(1).padStart(6)}`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. BEST RETAIL-FRIENDLY STRUCTURE
  // ════════════════════════════════════════════════════════════════════════

  L('\n\n' + G.repeat(120));
  L(`${G}  3. BEST RETAIL-FRIENDLY STRUCTURE`);
  L(`${G}  Criteria: SrAPY > 5%, SrWin > 99%, KI < 2%, profitable at E=5%`);
  L(G.repeat(120));

  const retailCandidates = normalRegime
    .filter(r =>
      r.sAnn > 0.05 &&
      r.sWin > 0.99 &&
      r.kiR < 0.02 &&
      r.protPnL?.[REF_EULER]?.[REF_JR] && r.protPnL[REF_EULER][REF_JR].pnl > 0
    )
    .sort((a,b) => b.sAnn - a.sAnn)
    .slice(0, 5);

  if (retailCandidates.length > 0) {
    L('\n  #  Basket            Mat    VRP  KI  CB  AC  Cpn   KI%  SrAPY SrWin ProtAPY  BEuler');
    L('  ' + D.repeat(100));
    retailCandidates.forEach((r, i) => {
      const pa = r.protPnL[REF_EULER][REF_JR];
      L(`  ${String(i+1).padStart(2)} ${r.basket.padEnd(18)} ${r.maturity.padEnd(6)} ${(r.vrp*100).toFixed(0).padStart(3)}% ${(r.ki*100).toFixed(0).padStart(3)}% ${(r.cb*100).toFixed(0).padStart(3)}% ${(r.ac*100).toFixed(0).padStart(3)}% ${(r.cpnAnn*100).toFixed(0).padStart(3)}%  ${(r.kiR*100).toFixed(1).padStart(5)}% ${f(r.sAnn).padStart(6)} ${(r.sWin*100).toFixed(1).padStart(5)}% ${f(pa.apy).padStart(7)} ${r.breakEuler!=null?(r.breakEuler*100).toFixed(1).padStart(6)+'%':'   N/A'}`);
    });
  } else {
    L('\n  No structures meet all retail criteria at E=5%.');
    // Relax criteria
    const relaxed = normalRegime
      .filter(r => r.sWin > 0.98 && r.kiR < 0.05 &&
        r.protPnL?.[REF_EULER]?.[REF_JR] && r.protPnL[REF_EULER][REF_JR].pnl > 0)
      .sort((a,b) => b.sAnn - a.sAnn)
      .slice(0, 5);
    if (relaxed.length > 0) {
      L('  Relaxed criteria (SrWin>98%, KI<5%):');
      L('  #  Basket            Mat    VRP  KI  CB  AC  Cpn   KI%  SrAPY SrWin ProtAPY');
      L('  ' + D.repeat(95));
      relaxed.forEach((r, i) => {
        const pa = r.protPnL[REF_EULER][REF_JR];
        L(`  ${String(i+1).padStart(2)} ${r.basket.padEnd(18)} ${r.maturity.padEnd(6)} ${(r.vrp*100).toFixed(0).padStart(3)}% ${(r.ki*100).toFixed(0).padStart(3)}% ${(r.cb*100).toFixed(0).padStart(3)}% ${(r.ac*100).toFixed(0).padStart(3)}% ${(r.cpnAnn*100).toFixed(0).padStart(3)}%  ${(r.kiR*100).toFixed(1).padStart(5)}% ${f(r.sAnn).padStart(6)} ${(r.sWin*100).toFixed(1).padStart(5)}% ${f(pa.apy).padStart(7)}`);
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4. BEST PROTOCOL-MAXIMIZING STRUCTURE
  // ════════════════════════════════════════════════════════════════════════

  L('\n\n' + G.repeat(120));
  L(`${G}  4. BEST PROTOCOL-MAXIMIZING STRUCTURE`);
  L(`${G}  Criteria: Highest ProtAPY at E=8%, Jr=50%, KI < 10%`);
  L(G.repeat(120));

  const protMaxEuler = (0.08).toFixed(4);
  const protMaxJr = (0.50).toFixed(4);
  const protMax = normalRegime
    .filter(r =>
      r.kiR < 0.10 &&
      r.protPnL?.[protMaxEuler]?.[protMaxJr]
    )
    .sort((a,b) => b.protPnL[protMaxEuler][protMaxJr].apy - a.protPnL[protMaxEuler][protMaxJr].apy)
    .slice(0, 5);

  L(`\n  At Euler=${(protMaxEuler*100)}%, Jr=${(protMaxJr*100)}%:`);
  L('  #  Basket            Mat    VRP  KI  CB  AC  Cpn   KI%  SrAPY SrWin ProtAPY  BEuler');
  L('  ' + D.repeat(100));
  protMax.forEach((r, i) => {
    const pa = r.protPnL[protMaxEuler][protMaxJr];
    L(`  ${String(i+1).padStart(2)} ${r.basket.padEnd(18)} ${r.maturity.padEnd(6)} ${(r.vrp*100).toFixed(0).padStart(3)}% ${(r.ki*100).toFixed(0).padStart(3)}% ${(r.cb*100).toFixed(0).padStart(3)}% ${(r.ac*100).toFixed(0).padStart(3)}% ${(r.cpnAnn*100).toFixed(0).padStart(3)}%  ${(r.kiR*100).toFixed(1).padStart(5)}% ${f(r.sAnn).padStart(6)} ${(r.sWin*100).toFixed(0).padStart(4)}% ${f(pa.apy).padStart(7)} ${r.breakEuler!=null?(r.breakEuler*100).toFixed(1).padStart(6)+'%':'   N/A'}`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. PARAMETER SENSITIVITY HEATMAPS
  // ════════════════════════════════════════════════════════════════════════

  L('\n\n' + G.repeat(120));
  L(`${G}  5. PARAMETER SENSITIVITY HEATMAPS`);
  L(`${G}  Average ProtAPY across all baskets, normal regime, Euler=5%, Jr=35%`);
  L(G.repeat(120));

  // Helper: avg protAPY for a filter
  const avgAPY = (filter) => {
    const matches = normalRegime.filter(filter).filter(r =>
      r.protPnL?.[REF_EULER]?.[REF_JR]
    );
    if (matches.length === 0) return null;
    return matches.reduce((s,r) => s + r.protPnL[REF_EULER][REF_JR].apy, 0) / matches.length;
  };

  // 5a. KI × Coupon heatmap
  L('\n  5a. KI Barrier × Coupon Rate (avgProtAPY at E=5%)');
  L('  ' + ''.padStart(8) + COUPONS.map(c => `Cpn${(c*100).toFixed(0)}%`.padStart(9)).join(''));
  L('  ' + D.repeat(8 + COUPONS.length * 9));
  for (const ki of KI_BARS) {
    const row = COUPONS.map(cpn => {
      const v = avgAPY(r => r.ki === ki && r.cpnAnn === cpn);
      return v != null ? f(v).padStart(9) : '    N/A  ';
    }).join('');
    L(`  KI=${(ki*100).toFixed(0).padStart(3)}% ${row}`);
  }

  // 5b. Maturity × VRP heatmap
  L('\n  5b. Maturity × VRP (avgProtAPY at E=5%)');
  const matLabels = [...new Set(normalRegime.map(r => r.maturity))].sort();
  L('  ' + ''.padStart(10) + VRP_LEVELS.map(v => `VRP${(v*100).toFixed(0)}%`.padStart(9)).join(''));
  L('  ' + D.repeat(10 + VRP_LEVELS.length * 9));
  for (const mat of matLabels) {
    const row = VRP_LEVELS.map(vrp => {
      const v = avgAPY(r => r.maturity === mat && r.vrp === vrp);
      return v != null ? f(v).padStart(9) : '    N/A  ';
    }).join('');
    L(`  ${mat.padEnd(10)}${row}`);
  }

  // 5c. KI × CB heatmap
  L('\n  5c. KI Barrier × Coupon Barrier (avgProtAPY at E=5%)');
  L('  ' + ''.padStart(8) + CB_BARS.map(c => `CB=${(c*100).toFixed(0)}%`.padStart(9)).join(''));
  L('  ' + D.repeat(8 + CB_BARS.length * 9));
  for (const ki of KI_BARS) {
    const row = CB_BARS.map(cb => {
      const v = avgAPY(r => r.ki === ki && r.cb === cb);
      return v != null ? f(v).padStart(9) : '    N/A  ';
    }).join('');
    L(`  KI=${(ki*100).toFixed(0).padStart(3)}% ${row}`);
  }

  // 5d. Basket × VRP heatmap
  L('\n  5d. Basket × VRP (avgProtAPY at E=5%)');
  L('  ' + ''.padStart(20) + VRP_LEVELS.map(v => `VRP${(v*100).toFixed(0)}%`.padStart(9)).join(''));
  L('  ' + D.repeat(20 + VRP_LEVELS.length * 9));
  for (const bkt of BASKETS) {
    const row = VRP_LEVELS.map(vrp => {
      const v = avgAPY(r => r.basket === bkt.name && r.vrp === vrp);
      return v != null ? f(v).padStart(9) : '    N/A  ';
    }).join('');
    L(`  ${bkt.name.padEnd(20)}${row}`);
  }

  // 5e. Regime impact
  L('\n  5e. Regime Impact (avgProtAPY at E=5%, across all structures)');
  const allRegimes = [...new Set(enriched.map(r => r.regime))].sort();
  L('  ' + D.repeat(60));
  for (const reg of allRegimes) {
    const matches = enriched.filter(r => r.regime === reg && r.protPnL?.[REF_EULER]?.[REF_JR]);
    if (matches.length === 0) continue;
    const avg = matches.reduce((s,r) => s + r.protPnL[REF_EULER][REF_JR].apy, 0) / matches.length;
    const kiAvg = matches.reduce((s,r) => s + r.kiR, 0) / matches.length;
    const srWinAvg = matches.reduce((s,r) => s + r.sWin, 0) / matches.length;
    L(`  ${reg.padEnd(25)} ProtAPY: ${f(avg).padStart(7)}  KI: ${(kiAvg*100).toFixed(1).padStart(5)}%  SrWin: ${(srWinAvg*100).toFixed(0).padStart(4)}%`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 6. REGIONS WHERE THE MODEL BREAKS
  // ════════════════════════════════════════════════════════════════════════

  L('\n\n' + G.repeat(120));
  L(`${G}  6. REGIONS WHERE THE MODEL BREAKS`);
  L(`${G}  Configurations with KI > 20%, SrWin < 90%, or extreme losses`);
  L(G.repeat(120));

  // Dangerous configs in normal regime
  const dangerous = normalRegime.filter(r =>
    r.kiR > 0.20 || r.sWin < 0.90 ||
    (r.protPnL?.[REF_EULER]?.[REF_JR] && r.protPnL[REF_EULER][REF_JR].pnl < -500)
  );

  L(`\n  Total dangerous configs: ${dangerous.length} / ${normalRegime.length} (${(dangerous.length/normalRegime.length*100).toFixed(1)}%)`);

  // Identify which parameters drive danger
  L('\n  Danger rate by KI barrier:');
  for (const ki of KI_BARS) {
    const total = normalRegime.filter(r => r.ki === ki).length;
    const bad = dangerous.filter(r => r.ki === ki).length;
    L(`    KI=${(ki*100).toFixed(0)}%: ${(bad/total*100).toFixed(0)}% dangerous (${bad}/${total})`);
  }

  L('\n  Danger rate by maturity:');
  for (const mat of matLabels) {
    const total = normalRegime.filter(r => r.maturity === mat).length;
    const bad = dangerous.filter(r => r.maturity === mat).length;
    L(`    ${mat}: ${total > 0 ? (bad/total*100).toFixed(0) : 0}% dangerous (${bad}/${total})`);
  }

  L('\n  Danger rate by coupon:');
  for (const cpn of COUPONS) {
    const total = normalRegime.filter(r => r.cpnAnn === cpn).length;
    const bad = dangerous.filter(r => r.cpnAnn === cpn).length;
    L(`    Cpn=${(cpn*100).toFixed(0)}%: ${total > 0 ? (bad/total*100).toFixed(0) : 0}% dangerous (${bad}/${total})`);
  }

  // Crash regime analysis
  const crashRegime = enriched.filter(r => r.regime === 'crash_normal' || r.regime === 'crash_spike');
  if (crashRegime.length > 0) {
    const crashDangerous = crashRegime.filter(r => r.kiR > 0.30 || r.sWin < 0.80);
    L(`\n  CRASH REGIME: ${crashDangerous.length}/${crashRegime.length} configs (${(crashDangerous.length/crashRegime.length*100).toFixed(0)}%) have KI>30% or SrWin<80%`);
    const crashAvgKI = crashRegime.reduce((s,r) => s+r.kiR, 0) / crashRegime.length;
    const crashAvgSrWin = crashRegime.reduce((s,r) => s+r.sWin, 0) / crashRegime.length;
    L(`  Crash avg KI: ${(crashAvgKI*100).toFixed(1)}%  Crash avg SrWin: ${(crashAvgSrWin*100).toFixed(0)}%`);

    // Which configs survive crash?
    const crashSurvivors = crashRegime.filter(r =>
      r.kiR < 0.10 && r.sWin > 0.90 &&
      r.protPnL?.[REF_EULER]?.[REF_JR] && r.protPnL[REF_EULER][REF_JR].pnl > -200
    );
    L(`  Crash survivors (KI<10%, SrWin>90%): ${crashSurvivors.length} configs`);
    if (crashSurvivors.length > 0) {
      const best3 = crashSurvivors.sort((a,b) => b.sWin - a.sWin).slice(0, 3);
      best3.forEach(r => {
        L(`    ${r.basket} ${r.maturity} KI=${(r.ki*100)}% CB=${(r.cb*100)}% VRP=${(r.vrp*100)}% → KI:${(r.kiR*100).toFixed(1)}% SrWin:${(r.sWin*100).toFixed(0)}%`);
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // 7. SUMMARY STATISTICS
  // ════════════════════════════════════════════════════════════════════════

  L('\n\n' + B.repeat(120));
  L(`${B}  7. SUMMARY STATISTICS`);
  L(B.repeat(120));

  const profitable = normalRegime.filter(r =>
    r.protPnL?.[REF_EULER]?.[REF_JR]?.pnl > 0
  );
  const REF_E4 = (0.04).toFixed(4);
  const profitableAt4 = normalRegime.filter(r =>
    r.protPnL?.[REF_E4]?.[REF_JR]?.pnl > 0
  );

  L(`\n  Total configs analyzed:           ${enriched.length}`);
  L(`  Normal regime configs:             ${normalRegime.length}`);
  L(`  Profitable at E=5% (normal):       ${profitable.length} (${(profitable.length/normalRegime.length*100).toFixed(1)}%)`);
  L(`  Profitable at E=4% (normal):       ${profitableAt4.length} (${(profitableAt4.length/normalRegime.length*100).toFixed(1)}%)`);
  L(`  Avg breakeven Euler (normal):      ${(normalRegime.filter(r=>r.breakEuler!=null).reduce((s,r)=>s+r.breakEuler,0)/normalRegime.filter(r=>r.breakEuler!=null).length*100).toFixed(1)}%`);

  if (byProfit.length > 0) {
    const best = byProfit[0];
    const bestPA = best.protPnL[REF_EULER][REF_JR];
    L(`\n  BEST STRUCTURE (by ProtAPY):`);
    L(`    ${best.basket} ${best.maturity} KI=${(best.ki*100)}% CB=${(best.cb*100)}% AC=${(best.ac*100)}% Cpn=${(best.cpnAnn*100)}% VRP=${(best.vrp*100)}%`);
    L(`    ProtAPY: ${f(bestPA.apy)} | SrAPY: ${f(best.sAnn)} | KI: ${(best.kiR*100).toFixed(1)}% | BEuler: ${best.breakEuler!=null?(best.breakEuler*100).toFixed(1)+'%':'N/A'}`);
  }

  if (topRobust.length > 0) {
    const best = topRobust[0];
    L(`\n  MOST ROBUST STRUCTURE:`);
    L(`    ${best.meta.basket} ${best.meta.maturity} KI=${(best.meta.ki*100)}% CB=${(best.meta.cb*100)}% AC=${(best.meta.ac*100)}% Cpn=${(best.meta.cpnAnn*100)}% VRP=${(best.meta.vrp*100)}%`);
    L(`    Profitable in ${(best.profitRate*100).toFixed(0)}% of regimes | AvgKI: ${(best.avgKI*100).toFixed(1)}% | Score: ${best.score.toFixed(1)}`);
  }

  L('\n' + B.repeat(120));
  L(`${B}  xYield v24 COMPLETE — Design space mapped`);
  L(B.repeat(120) + '\n');

  return lines.join('\n');
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(80));
  console.log('  xYield v24 — Overnight Design Space Sweep');
  console.log('═'.repeat(80));

  const jobs = generateJobs();
  console.log(`\n  Configuration:`);
  console.log(`    Workers:     ${NUM_WORKERS}`);
  console.log(`    Paths/cfg:   ${PATHS_PER_CONFIG}`);
  console.log(`    Total jobs:  ${jobs.length}`);
  console.log(`    Baskets:     ${BASKETS.length}`);
  console.log(`    Maturities:  ${MATURITIES.length}`);
  console.log(`    Coupons:     ${COUPONS.length}`);
  console.log(`    KI barriers: ${KI_BARS.length}`);
  console.log(`    CB barriers: ${CB_BARS.length}`);
  console.log(`    AC triggers: ${AC_TRIGS.length}`);
  console.log(`    VRP levels:  ${VRP_LEVELS.length}`);
  console.log(`    Vol regimes: ${Object.keys(VOL_REGIMES).length}`);
  console.log(`    Corr regimes:${Object.keys(CORR_REGIMES).length}`);
  console.log(`    Hist regimes:${Object.keys(HIST_REGIMES).length}`);
  console.log(`    Jr ratios:   ${JR_RATIOS.length} (post-hoc)`);
  console.log(`    Euler levels:${EULER_LEVELS.length} (post-hoc)`);
  console.log(`    Mode:        ${QUICK ? 'QUICK (testing)' : 'FULL (overnight)'}`);

  const estTime = jobs.length * 0.15 / NUM_WORKERS; // ~0.15s per config at 2k paths
  console.log(`\n  Estimated time: ${(estTime/60).toFixed(0)} minutes (${(estTime/3600).toFixed(1)} hours)`);
  console.log(`\n  Starting workers...`);

  const workerFile = path.join(__dirname, 'v24_worker.js');
  const pool = new WorkerPool(NUM_WORKERS, workerFile);

  console.log(`  ${NUM_WORKERS} workers ready.\n`);

  await pool.runAll(jobs);

  const elapsed = (Date.now() - pool.startTime) / 1000;
  console.log(`\n\n  Simulation complete: ${pool.results.length} results in ${(elapsed/60).toFixed(1)} min (${(pool.results.length/elapsed).toFixed(0)} cfg/s)\n`);

  // Build meta lookup
  const metaMap = {};
  for (const j of jobs) metaMap[j.id] = j.meta;

  // Enrich results
  console.log('  Enriching results (post-hoc Euler/Jr computation)...');
  const enriched = pool.results.map(r => enrichResult(r, metaMap[r.id]));
  console.log(`  ${enriched.length} enriched results.\n`);

  // Save raw results (compact)
  const rawFile = path.join(__dirname, 'v24_results.json');
  console.log(`  Writing ${rawFile}...`);
  // Strip large nested objects for file size — keep flat metrics + breakEuler + protPnL at key levels
  const compact = enriched.map(r => ({
    basket: r.basket, basketSize: r.basketSize, maturity: r.maturity,
    cpnAnn: r.cpnAnn, ki: r.ki, cb: r.cb, ac: r.ac, vrp: r.vrp,
    regime: r.regime, regimeType: r.regimeType,
    sAnn: r.sAnn, sWin: r.sWin, srP5: r.srP5, srP1: r.srP1,
    acR: r.acR, kiR: r.kiR, matR: r.matR, avgDur: r.avgDur,
    avgGamma: r.avgGamma, avgCpn: r.avgCpn, avgKI: r.avgKI,
    avgCpnCount: r.avgCpnCount, breakEuler: r.breakEuler,
    avgJrPnL: r.avgJrPnL, jrP5: r.jrP5, jrP1: r.jrP1, jrWin: r.jrWin,
    // Key Euler/Jr combos
    prot_e4_jr35: r.protPnL?.[(0.04).toFixed(4)]?.[(0.35).toFixed(4)] || null,
    prot_e5_jr35: r.protPnL?.[(0.05).toFixed(4)]?.[(0.35).toFixed(4)] || null,
    prot_e8_jr35: r.protPnL?.[(0.08).toFixed(4)]?.[(0.35).toFixed(4)] || null,
    prot_e12_jr35: r.protPnL?.[(0.12).toFixed(4)]?.[(0.35).toFixed(4)] || null,
    prot_e5_jr20: r.protPnL?.[(0.05).toFixed(4)]?.[(0.20).toFixed(4)] || null,
    prot_e5_jr50: r.protPnL?.[(0.05).toFixed(4)]?.[(0.50).toFixed(4)] || null,
  }));
  fs.writeFileSync(rawFile, JSON.stringify(compact, null, 0));
  console.log(`  Written (${(fs.statSync(rawFile).size/1024/1024).toFixed(1)} MB)\n`);

  // Analysis
  console.log('  Generating analysis report...');
  const report = analyze(enriched);
  const reportFile = path.join(__dirname, 'v24_analysis.txt');
  fs.writeFileSync(reportFile, report);
  console.log(`  Report written to ${reportFile}\n`);

  // Also print to console
  console.log(report);

  pool.terminate();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
