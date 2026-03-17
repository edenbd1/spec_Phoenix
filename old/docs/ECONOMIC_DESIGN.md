# xYield Notes — Economic Design Document

## Final Synthesis of Simulation Research (v2–v23)

*Generated: March 15, 2026 — Pre-implementation reference for Solidity MVP*
*Hackathon: xStocks, Mar 31 – Apr 2, 2026, Cannes*

---

## 1. Version-by-Version Research Summary

### Phase 1: Foundation & Historical Backtesting (v2–v6)

**v2–v4 — Single-Stock Prototyping**
- **Hypothesis:** Can a basic autocall with delta hedging work on a single xStock?
- **What changed:** v2 introduced BS delta hedging on historical prices. v3 compared 3 strategy variants. v4 searched for the "fair coupon" where both investor and underwriter win.
- **Learned:** Basic framework works. Single-stock products have limited premium. Need multi-stock baskets.
- **Assumptions validated:** Delta hedging is feasible on tokenized equities.

**v5 — Worst-of Baskets**
- **Hypothesis:** Worst-of baskets of 2–3 xStocks generate higher coupons via dispersion premium.
- **What changed:** Upgraded to 11 real stocks with quarterly historical prices. Multiple timeline windows (3–12mo). Auto-roll APY calculation.
- **Learned:** Worst-of baskets are the right product format. Higher vol baskets = higher coupon capacity.
- **Assumptions validated:** Dispersion premium is real and exploitable.

**v6 — Industry Best Practices**
- **Hypothesis:** Combining GS/SocGen/JPM/BNP/Barclays features (step-down AC, per-stock hedging, correlation-aware pricing) improves economics.
- **What changed:** Step-down autocall barrier, per-stock delta hedging, UW deposit optimization.
- **Learned:** Step-down AC improves autocall probability. Correlation matters for worst-of pricing.
- **Assumptions validated:** Institutional autocall features add value.

### Phase 2: Monte Carlo Simulation Engine (v7–v9)

**v7 — Full Monte Carlo**
- **Hypothesis:** Replace historical backtest (4 price points) with 10,000 correlated GBM paths for statistical rigor.
- **What changed:** Cholesky-decomposed correlated paths, weekly rebalancing, 0.1% transaction cost per trade, full distribution analysis (mean, P5, P95, Sharpe).
- **Learned:** Stochastic simulation reveals tail risks invisible in historical data. 5,000 paths sufficient for convergence.
- **Assumptions validated:** GBM with correlation is an adequate path model for 3–12mo horizons.

**v8 — Calibrated Parameter Sweep**
- **Hypothesis:** Systematic optimization across coupon (6–18% APY), KI (40–60%), maturity (3–12mo), vol baskets finds the true equilibrium.
- **What changed:** Grid sweep of all parameter combinations. 5,000 paths per config.
- **Learned:** Equilibrium exists but is sensitive to parameter choice. Lower coupons + lower KI barriers = more viable.
- **Assumptions rejected:** High coupons (>15% APY) are not sustainable without excessive KI risk.

**v9 — Yield-First Design (Philosophical Shift)**
- **Hypothesis:** The PRIMARY income is Euler yield on idle collateral, not the autocall premium. The autocall is a distribution mechanism.
- **What changed:** Maximize capital in Euler. Smart hedging (rebalance only when delta changes >10%). Euler APY sweep 3–15%. Leverage modeling.
- **Learned:** Euler carry transforms marginal structures into profitable products. Hedge costs are secondary to carry income.
- **Assumptions validated:** DeFi lending yield is a legitimate structural advantage over TradFi.

### Phase 3: Product Architecture (v10–v13)

**v10 — Yield Stacking Engine**
- **Hypothesis:** Stacking 5 yield sources (leveraged Euler, funding rates, capital amplification, KI risk premium, auto-roll compounding) can target 15–35% APY.
- **What changed:** Explicit modeling of each yield layer. Product cards for 5 risk tiers (Safe through Degen).
- **Learned:** Yield stacking works in theory but the underwriter side is unprofitable.
- **Assumptions rejected:** UW profitability requires structural changes, not just yield optimization.

**v11 — Tranched Model (Senior/Junior)**
- **Hypothesis:** Tranching into Senior (fixed coupon, principal protected) and Junior (first-loss, leveraged residual) makes both sides profitable.
- **What changed:** Senior tranche: 12–18% APY, principal protected. Junior tranche: first loss, earns residual. Pool leverage ~3.5x.
- **Learned:** Tranching solves the UW profitability problem. Both sides can win simultaneously.
- **Assumptions validated:** Senior/Junior tranche structure is the correct architecture.

**v12 — Full Stack Autocall**
- **Hypothesis:** Combine autocall + delta hedging + Euler + funding + tranching into one product with explicit yield decomposition.
- **What changed:** Revenue decomposition: option premium, Euler yield, KI losses, hedge cost as separate line items.
- **Learned:** Option premium and Euler yield are the two main sources. Need to understand which dominates.

**v13 — Option Premium as Primary Source**
- **Hypothesis:** Option premium (from selling upside cap + KI put) is the REAL primary yield, not Euler.
- **What changed:** Explicit pricing model: option premium funds the coupon. TradFi cost comparison (banks take 2–5%, xYield takes 0.2%).
- **Learned:** Formula: total = option_premium + euler_yield - hedge_cost - protocol_fee ~ 25.8% distributable.
- **Assumptions tested:** Option premium primacy — later challenged in v19–v22.

### Phase 4: Hedging Optimization (v14–v15)

**v14 — Aggressive Option Premium Explorer**
- **Hypothesis:** Ultra-volatile baskets (MSTR 85% vol, COIN 70% vol) + lower KI + longer maturity maximize option premium.
- **What changed:** 6 high-vol stocks, 8 baskets, KI 30–45%, AC triggers 105–110%, 6–12mo maturities.
- **Learned:** Higher vol = higher premium but also higher hedge cost. Biweekly hedging is a weakness.
- **Assumptions tested:** Vol optimization has diminishing returns due to proportional hedge cost increase.

**v15 — Advanced Hedging Engine (Gamma Scalping)**
- **Hypothesis:** Hedge frequency is a primary optimization variable. Frequent hedging captures gamma PnL and can make hedging a profit center.
- **What changed:** Configurable hedge modes (time-based, threshold-based). Delta thresholds 0.02–0.10. Gamma PnL tracking. `stepsPerDay` simulation granularity.
- **Learned:** More frequent hedging captures gamma but has diminishing returns vs. transaction costs. Threshold-based is more efficient than time-based.
- **Assumptions validated:** Gamma scalping is real but modest in magnitude.

### Phase 5: Bug Fixes & Model Correction (v16–v17)

**v16 — Worst-of Delta Hedging**
- **Hypothesis:** Concentrate delta hedging on the worst performer using exponential weighting (alpha=8).
- **What changed:** 7 stocks with correlation matrix. Worst-of delta concentration. KI=35%, CB=40–50%.
- **CRITICAL BUGS FOUND:**
  1. **AC waterfall double-counting:** `srPay = seniorDep + totalCpnPaid` included coupons already deducted from cash. Junior was charged twice for coupons.
  2. **Hedge direction inversion:** Pool is short a put → should SHORT stock to hedge. v16 BOUGHT shares (doubling risk instead of hedging).
- **Impact:** All results from v3–v16 are unreliable due to these bugs. v17 is the first clean simulation.

**v17 — Corrected Model (First Reliable Results)**
- **Hypothesis:** With bugs fixed, find balanced structures where both Senior and Junior are profitable.
- **What changed:** AC waterfall: deduct coupon from cash, then `jrPay = max(cash - seniorDep, 0)`. Hedge: short model with `shortShares[]`, `shortEntryPrice[]`. Gamma PnL tracking.
- **Results:** 48 balanced configs found. Best: Sr +11.1%, Jr +9.6%, KI 0.9%.
- **Learned:** The model works correctly. Both tranches can be profitable simultaneously.
- **Assumptions validated:** Short delta hedge model is correct for short-put exposure.

### Phase 6: Protocol Economics (v18–v19)

**v18 — Protocol Profit Engine**
- **Hypothesis:** The protocol (acting as Junior/underwriter) captures residual margin + fees.
- **What changed:** `protocolSpread` (management fee on Euler yield), `origFee` (origination fee). Protocol PnL = Jr residual + fee income.
- **Learned:** At Euler=12%, protocol is profitable. Pure option economics are negative — profit comes from Euler carry.
- **Assumptions validated:** Fee model (management spread + origination) is viable.

**v19 — Pure Autocall Premium Isolation**
- **Hypothesis:** Does the autocall structure itself generate value, independent of Euler carry?
- **What changed:** Flexible observation frequency (`obsFreq`). Step-down AC (`acSD`). AC start delay (`acStartObs`). KI type: continuous vs European (at-maturity).
- **CRITICAL FINDING:** Pure autocall premium is NEGATIVE for ALL structures tested. European KI dramatically reduces KI rate (10.5% → 4.7% vs continuous).
- **Learned:** The autocall structure does not generate standalone alpha. It is a product wrapper around Euler carry.
- **Assumptions rejected:** Option premium is NOT the primary yield source — Euler carry is.

### Phase 7: Volatility Risk Premium & Institutional Edges (v20–v21)

**v20 — VRP Engine**
- **Hypothesis:** Volatility Risk Premium (implied vol > realized vol) creates structural edge for option sellers.
- **What changed:** Dual-vol model: implied vol for pricing/hedging, realized vol for path generation. Per-stock calibration (e.g., NVDA: implied 55%, realized 48%). Dual correlation matrices.
- **Results:** VRP improved PnL by +$174/note (avg across 8 baskets), but still -$842 avg. Correlation premium: -$5 (negligible). Breakeven Euler: 4.9%.
- **Learned:** VRP is real and material. Correlation premium is negligible. Breakeven Euler ~5%.
- **Assumptions validated:** VRP is a genuine structural edge for option sellers.

**v21 — Institutional Edge Deep Dive**
- **Hypothesis:** Stronger VRP (20–30%), correlation dislocation, hedge execution costs, and capital turnover change the picture.
- **What changed:** Parameterized VRP: `realizedVol = impliedVol * (1 - vrpDiscount)`. Correlation shift function. Hedge spread + slippage modeling. 2-year capital turnover simulation.
- **PARADOXICAL FINDING:** VRP made PnL WORSE with safe structures ($-419 → $-471 at VRP=30%). Root cause: KI was already ~0% with KI=25%/European, so VRP couldn't reduce it, but lower realized vol = more coupons paid (stocks stay above coupon barrier more often).
- **Other results:** Correlation premium: $2 total sensitivity (negligible). Hedge costs: $3/note (negligible). Capital turnover: 1.7x/year multiplier.
- **Assumptions validated:** Hedge execution costs are manageable. Correlation premium is not exploitable.
- **Assumptions rejected:** VRP does NOT help safe structures — it helps risky ones (discovered in v22).

### Phase 8: Risky Structures & VRP Rescue (v22)

**v22 — Risky Structure Exploration**
- **Hypothesis:** Structures with KI probability 5–20% (vs ~0% in v21) allow VRP to reduce meaningful KI risk, creating a genuine edge.
- **What changed:** KI barriers 35–55%, CB 75–90%, maturities 3–9mo, AC 95–105%, coupon 8–20% ann. Skew premium modeling (OTM put vol = ATM + addon). Asymmetric structures (CB > AC). 4,320 configs tested.
- **KEY FINDING:** VRP NOW HELPS: +$159/note at VRP=30% (vs -$51 in v21). KI reduction: 4.4% → 0.3%. This rescues the VRP hypothesis.
- **Other results:** Skew premium HURTS: -$23/note (over-hedging costs exceed benefit). Asymmetric structures: modest improvement but still negative. Best pure option PnL: -$126 (best ever, but still negative).
- **Best structure found:** 3mo monthly, KI 55%, CB 90%, AC 95%, Cpn 8% ann, continuous KI. Breakeven Euler: 3.2–3.5%.
- **Learned:** The v21 paradox was a selection bias — safe structures eliminate the very risk that VRP mitigates. Risky structures with VRP are the optimal design point.
- **Assumptions validated:** VRP is real and material for structures with meaningful KI exposure.
- **Assumptions rejected:** Skew premium is not exploitable in our fixed-coupon model.

### Phase 9: Robustness Validation (v23)

**v23 — Final Stress Testing**
- **Hypothesis:** The v22 best structure is robust across VRP levels, Euler rates, coupon rates, and basket compositions.
- **What changed:** 5 baskets (including 2-stock pairs: NVDA/AMD, NVDA/META). 4,000–6,000 paths per run. VRP sweep 0–30%. Euler sweep 0–12%. Coupon sweep 6–14%.
- **Results:**
  - VRP sensitivity: monotonic improvement, +$105 lift at VRP=30%, plateaus ~25%
  - Euler sensitivity: breakeven at 3.4%, all 5 baskets profitable at E≥4%
  - Coupon sensitivity: 8% ann is sweet spot (Sr +5%, BEuler ~5.8%)
  - Basket robustness: ALL 5 baskets profitable at E≥4%
  - Protocol APY: +6.3% at E=5%, +33.7% at E=12%
  - Senior APY: ~5% with 99.6–100% win rate
- **Learned:** The structure is robust. 2-stock baskets work but are slightly less profitable than 3-stock.
- **Assumptions validated:** Economic model holds across all tested dimensions.

---

## 2. Consolidated Findings

### 2.1 What We Know with High Confidence

**A. Pure autocall premium is negative in ALL configurations.**
Tested across 23 versions, thousands of parameter combinations, multiple baskets, with and without VRP/skew/correlation premium. Best pure option PnL ever achieved: -$126/note. The coupon drain consistently exceeds option income (gamma PnL + KI savings).

**B. VRP is a genuine and material structural edge.**
VRP lift: +$105/note at VRP=25% (avg across 5 baskets). This is consistent with decades of academic literature on the variance risk premium. It reduces KI probability from ~4% to ~0.3% and is the single most powerful lever after Euler carry.

**C. Euler carry is the primary profit driver.**
Breakeven Euler APY: **3.4%** (with VRP=25%). DeFi lending protocols typically offer 5–15% APY on stablecoins. The margin between breakeven and available yield is the protocol's primary income.

**D. The fee model works.**
Management spread on Euler yield + origination fees contribute 20–30% of total protocol PnL. This mirrors TradFi structured product desks.

**E. The Senior tranche is attractive and safe.**
Senior APY: 4–6% (at 8% ann coupon) with 99.6–100% win rate across all baskets tested. European or continuous KI at 55% with VRP keeps KI probability under 1%.

**F. Short maturity (3 months) with monthly observations is optimal.**
Capital turnover of ~5x/year at Euler=4%. Shorter structures benefit more from VRP (less time for tail events) and enable faster capital recycling.

**G. Hedge execution costs are negligible.**
At 10bps spread + 5bps slippage: $3/note drag. Not a deal-breaker.

**H. Correlation premium is not exploitable.**
$2 total sensitivity across ±30% correlation shifts. Not worth modeling or marketing.

**I. Skew premium hurts in our model.**
Over-hedging with higher vol costs more than the protection benefits. This is because our coupons are fixed (not priced at skew vol like in TradFi).

### 2.2 Uncertain Assumptions

**A. VRP calibration (HIGH IMPACT)**
We assume VRP = 20–25% (realized vol = implied × 0.75–0.80). This is consistent with historical data on equity indices but may not hold for:
- Individual high-vol stocks during regime changes
- Crypto-adjacent names (COIN, MSTR) in extreme markets
- Post-earnings periods when realized vol can briefly exceed implied
- **Sensitivity:** At VRP=0%, breakeven Euler rises to ~10% (still achievable but tight)

**B. Euler yield persistence (HIGH IMPACT)**
We assume Euler/DeFi lending yields of 4–12% APY. These yields are:
- Currently available (Mar 2026) but historically volatile
- Subject to compression as more capital enters DeFi lending
- Breakeven at 3.4% provides safety margin, but a sustained sub-3% environment would make the protocol unprofitable
- **Mitigation:** Protocol can switch between lending protocols (Euler, Aave, Compound, Morpho)

**C. Volatility parameter accuracy (MEDIUM IMPACT)**
Implied vols are calibrated to current market (NVDA 55%, TSLA 60%, etc.). These shift over time. Our model uses static vols for each 3mo product — reasonable for short maturity but not for regime changes mid-product.

**D. Correlation stability (LOW IMPACT)**
Correlation sensitivity is only $2/note, so even large errors in correlation estimates have minimal impact.

**E. GBM path model adequacy (MEDIUM IMPACT)**
GBM assumes log-normal returns with constant vol. Real markets have:
- Fat tails (higher KI probability than modeled)
- Vol clustering (bursts of high vol can trigger KI)
- Jump risk (overnight gaps can breach barriers without gradual approach)
- **Mitigation:** Conservative KI barrier at 55% (not 40–50%), continuous monitoring

**F. Hedge execution in DeFi (LOW-MEDIUM IMPACT)**
We assume liquid markets for shorting tokenized equities on xStocks. If liquidity is thin, slippage could exceed our 5–15bps assumption. However, the total hedge cost sensitivity is only $3/note even at worst-case 20+10bps.

### 2.3 Recommended MVP Product Structure

```
PRODUCT: xYield Phoenix Autocall Note
────────────────────────────────────────────

STRUCTURE PARAMETERS:
  Maturity:             3 months
  Observation freq:     Monthly (3 observations)
  KI Barrier:           55% of initial (continuous monitoring)
  Coupon Barrier:       90% of initial
  Autocall Trigger:     95% of initial (no step-down for MVP)
  Coupon Rate:          8% annualized (0.67%/month)
  Memory Coupon:        No (simplifies smart contract)
  Underlying:           Worst-of basket (2–3 xStocks)

TRANCHE STRUCTURE:
  Senior:               Retail depositors — fixed coupon, principal protected by Jr
  Junior:               Protocol treasury / DAO — first-loss, earns residual
  Junior Ratio:         35% of pool

REVENUE MODEL:
  Euler Carry:          Pool cash deposited in DeFi lending (Euler/Aave)
  Management Fee:       Protocol keeps spread on Euler yield (~2%)
  Origination Fee:      0.5% of Senior deposit at inception

HEDGE EXECUTION:
  Instrument:           Short xStocks (or perp futures)
  Rebalancing:          At each monthly observation
  Delta model:          BS down-and-in put, worst-of concentration (alpha=8)

MVP BASKETS (ordered by recommendation):
  1. NVDA/AMD/META      — Most robust (highest protocol win rate)
  2. NVDA/META/AMZN     — Most profitable (highest protocol APY)
  3. META/AAPL/AMZN     — Most marketable (highest Senior APY, 0% KI)
```

### 2.4 Robust Parameter Ranges

| Parameter | MVP Value | Safe Range | Notes |
|-----------|-----------|------------|-------|
| KI Barrier | 55% | 50–60% | <50% = too much KI risk; >60% = no meaningful VRP capture |
| Coupon Barrier | 90% | 85–95% | <85% = excessive coupon drain; >95% = too few coupons for Sr |
| AC Trigger | 95% | 90–100% | <90% = autocalls too frequently; >100% = too rare |
| Coupon Rate (ann) | 8% | 6–10% | <6% = unattractive to Sr; >10% = unsustainable drain |
| Maturity | 3mo | 3–6mo | 9mo+ reduces capital turnover without proportional benefit |
| Obs Frequency | Monthly | Monthly–Quarterly | Monthly = more exit points, better for 3mo product |
| Junior Ratio | 35% | 30–40% | <30% = insufficient buffer; >40% = dilutes Jr returns |
| VRP assumed | 20–25% | 15–30% | Conservative 20%, optimistic 30% |
| Euler yield | 4–8% | 3.4%+ | Breakeven at 3.4%; anything above is profit |

---

## 3. Economic Model Summary

### 3.1 PnL Attribution (per $10,000 Senior note, $3,500 Junior capital, Euler=4%, VRP=25%)

| Component | Amount | Share |
|-----------|--------|-------|
| Pure option PnL | -$145 | Negative |
| Euler carry | +$53 | ~55% of gross income |
| Fee income | +$103 | ~45% of gross income |
| Coupons paid to Sr | -$93 | Main cost |
| KI losses absorbed | -$19 | Minor cost |
| Gamma PnL | -$4 | Negligible |
| **Protocol Net** | **+$17** | **+2.5% APY** |

### 3.2 Scaling with Euler Yield

| Euler APY | Protocol Net | Protocol APY | Senior APY |
|-----------|-------------|-------------|------------|
| 3% (breakeven) | ~$0 | ~0% | ~5% |
| 4% (conservative) | +$17 | +2.5% | ~5% |
| 5% | +$43 | +6.3% | ~5% |
| 8% | +$125 | +18% | ~5% |
| 12% | +$232 | +33.7% | ~5% |

### 3.3 Three-Legged Economic Engine

```
LEG 1 — AUTOCALL STRUCTURE (Product & VRP Capture)
  What it does:  Creates the product format (coupons, barriers, autocall)
  Edge source:   VRP — implied vol > realized vol → fewer KI events than priced
  Standalone:    NEGATIVE (-$145/note at VRP=25%)
  Role:          Product wrapper + VRP capture mechanism

LEG 2 — EULER CARRY (Reliable Income Floor)
  What it does:  Deploys idle pool cash in DeFi lending protocols
  Edge source:   DeFi yield on stablecoin collateral
  Standalone:    POSITIVE (breakeven at 3.4%)
  Role:          Primary income — transforms negative option economics into profit

LEG 3 — FEES (Distribution Margin)
  What it does:  Management spread + origination fee
  Edge source:   Protocol's distribution advantage (TradFi takes 2-5%, we take <1%)
  Standalone:    POSITIVE (~$103/note)
  Role:          Stable revenue regardless of option outcome
```

This mirrors how investment banks profit from structured products:
- The options desk often breaks even or loses slightly on pure option economics
- Profit comes from vol markup (we capture this via VRP), funding advantages (our Euler carry), and distribution fees
- The structured note FORMAT is what enables the fee extraction

---

## 4. Key Research Milestones

| Version | Milestone | Impact |
|---------|-----------|--------|
| v5 | Worst-of baskets | Correct product format identified |
| v7 | Monte Carlo engine | Statistical rigor established |
| v9 | "Euler is primary" | Philosophical shift — DeFi carry > option premium |
| v11 | Senior/Junior tranching | Both sides profitable |
| v16–v17 | Bug fixes (hedge direction + waterfall) | First reliable results |
| v19 | Pure autocall premium = NEGATIVE | Confirmed carry trade engine |
| v20 | VRP quantified (+$174/note) | Institutional edge measured |
| v21 | VRP paradox (hurts safe structures) | Revealed selection bias |
| v22 | VRP rescued (helps risky structures, +$159/note) | Optimal design point found |
| v23 | Robustness validated (5 baskets, BEuler=3.4%) | MVP-ready |

---

## 5. MVP Implementation Priorities

1. **Pool contract:** Accept Senior + Junior deposits, deploy to Euler
2. **Observation engine:** Monthly price checks against barriers (KI, CB, AC)
3. **Coupon distribution:** Pay Senior investors when worst performer ≥ 90%
4. **Autocall logic:** Return capital when worst performer ≥ 95%
5. **KI settlement:** At maturity, if worst performer ever ≤ 55%, apply loss to Junior first
6. **Hedge execution:** Off-chain or via keeper — short worst performer on xStocks
7. **Fee extraction:** Management spread on Euler yield + origination fee

---

*This document synthesizes 23 simulation versions, ~10,000+ parameter configurations, and millions of Monte Carlo paths. It represents the complete economic foundation for the xYield Notes smart contract implementation.*
