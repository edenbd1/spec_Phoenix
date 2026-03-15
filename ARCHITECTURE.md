# xYield Notes — Architecture & Economic Model

## Vue d'ensemble

xYield Notes est un protocole de structured products peer-to-peer sur xStocks (tokenized equities by Kraken/Backed). Le produit phare : des **autocalls (callable yield notes)** sur paniers xStocks, avec physical delivery.

**Innovation clé** : premier autocall peer-to-peer onchain. Pas de banque, pas de boîte noire. L'investisseur et l'underwriter sont connectés directement via smart contracts.

---

## Le Two-Sided Model

### Côté A — Note Buyer (l'investisseur)
- Dépose USDC
- Gagne un coupon amélioré (8-15% annualisé)
- Risque : si le sous-jacent a touché la barrière knock-in pendant la vie du produit ET que le prix final à maturité est sous le prix initial → physical delivery de xStocks à perte
- Si knock-in activé mais prix final ≥ initial → principal remboursé (pas de perte)
- **Économiquement = il vend un put option sur xStocks**

### Côté B — Underwriter (le LP)
- Dépose USDC dans le pool d'underwriting
- Son capital **finance les coupons** de l'investisseur (= il paie la prime du put)
- Si knock-in se produit ET prix final < initial → il capture le spread (notionnel - coût des xStocks livrés)
- **Économiquement = il achète un put option sur xStocks**
- Son capital idle earn du yield sur Euler en attendant

### Pourquoi le coupon est SUPÉRIEUR au lending

En TradFi, le coupon amélioré d'un autocall ne vient PAS du lending. Il vient de la **prime du put implicite** que l'investisseur vend. L'investisseur accepte un risque réel (recevoir des actions dépréciées si crash) et est payé pour ce risque.

Dans notre modèle DeFi :
- Le coupon EST la prime du put, payée par l'underwriter à l'investisseur
- L'underwriter paie cette prime parce qu'il PROFITE si le crash se produit
- C'est un dérivé zero-sum, fully collateralized, peer-to-peer
- La banque est supprimée — on connecte directement les deux côtés

---

## Comment ça marche en TradFi (pour référence)

Quand SocGen/BNP émet un autocall :
1. La banque reçoit le capital de l'investisseur
2. Le desk structuration **price les options embedded** (put knock-in, barrière autocall, coupons digitaux)
3. Le desk trading **delta-hedge dynamiquement** — achète ~30-50% du notionnel en actions, ajuste quotidiennement selon les Greeks
4. L'argent va dans le **bilan de la banque** (trésorerie générale)
5. Le coupon est financé par la **prime du put implicite**
6. La banque NE détient PAS 100% du sous-jacent — elle delta-hedge partiellement

**Notre modèle DeFi est plus transparent et plus safe :**
- Pas de risque émetteur (fully collateralized onchain)
- Pas de boîte noire (tout dans le smart contract)
- Settlement instant (pas T+2)
- Physical delivery de vrais tokens xStocks

---

## Cash Flows — Exemples Concrets

### Setup
```
Note : NVDAx Autocall, 1 an, observations trimestrielles
Knock-in barrier : 70% | Autocall barrier : 100%
Coupon : 3%/trimestre (12% annualisé)
Investisseur : $10,000 USDC
Underwriter :  $2,000 USDC
Pool total :   $12,000 → Euler Finance (5% APY)
```

### Scénario 1 — Autocall au Q2 (NVDAx ≥ 100% à la 2ème observation)
```
Pool au Q2 : $12,000 + $300 yield (5% × 6 mois) - $600 coupons = $11,700
Investisseur reçoit : $10,000 + dernière coupon (déjà payé)
Underwriter récupère : $11,700 - $10,000 = $1,700
Underwriter P&L : $1,700 - $2,000 = -$300 (-15%)
→ Autocall rapide = petite perte underwriter (peu de coupons payés)
```

### Scénario 2 — Knock-in activé, maturité avec NVDAx à 55%
```
Le flag knock-in a été activé pendant la vie du produit (prix < 70% à une obs)
À maturité : prix final = 55% < prix initial → PHYSICAL DELIVERY

Pool maturité : $12,000 + $600 yield - $1,200 coupons = $11,400
Acheter 100 NVDAx à $55 via 1inch : $5,500
Livrer à l'investisseur (physical delivery)
Underwriter récupère : $11,400 - $5,500 = $5,900
Underwriter P&L : +$3,900 (+195%)
```

### Scénario 3 — Knock-in activé MAIS prix remonte à maturité (NVDAx à 105%)
```
Le flag knock-in a été activé au Q2 (prix à 68%)
Mais à maturité, NVDAx est remonté à 105% → prix final ≥ initial
→ PAS DE PHYSICAL DELIVERY malgré le knock-in !

Pool maturité : $11,400
Rembourser investisseur : $10,000 (principal intact)
Underwriter récupère : $1,400
Underwriter P&L : -$600 (-30%)

Note : en TradFi, knock-in ≠ perte automatique. L'investisseur ne perd
que si knock-in ET prix final < initial. C'est ce qui rend les autocalls
attractifs — la barrière peut être touchée et le stock remonter.
```

### Scénario 4 — Maturité sans knock-in (NVDAx à 85%)
```
Prix jamais descendu sous 70% → pas de knock-in
Prix jamais remonté au-dessus de 100% → pas d'autocall

Pool maturité : $11,400
Rembourser investisseur : $10,000 + dernier coupon
Underwriter récupère : $1,400
Underwriter P&L : -$600 (-30%)
```

### Espérance underwriter (NVDA, vol historique, modèle complet)
```
Avec les probabilités réalistes pour NVDA (vol ~35%, 1 an) :

P(autocall Q1) ≈ 20%   → UW P&L ≈ -$150     (1 coupon payé)
P(autocall Q2) ≈ 12%   → UW P&L ≈ -$300     (2 coupons)
P(autocall Q3) ≈ 8%    → UW P&L ≈ -$450     (3 coupons)
P(autocall Q4) ≈ 5%    → UW P&L ≈ -$600     (4 coupons)
P(mat, no KI)  ≈ 40%   → UW P&L ≈ -$600     (4 coupons)
P(KI + loss)   ≈ 10%   → UW P&L ≈ +$3,900   (capture le spread)
P(KI + recover)≈ 5%    → UW P&L ≈ -$600     (KI mais stock remonte)

E[P&L] = 0.20×(-150) + 0.12×(-300) + 0.08×(-450) + 0.05×(-600)
         + 0.40×(-600) + 0.10×(3,900) + 0.05×(-600)
       = -30 -36 -36 -30 -240 +390 -30
       = -$12

→ Proche de zero-sum avec un léger edge pour l'investisseur.
Le taux de coupon doit s'ajuster pour que l'underwriter soit à EV ≈ 0.
C'est exactement ce que fait le fair coupon solver (Monte Carlo CRE).

Payoff asymétrique : -30% max si pas de crash, +195% si crash réel
→ Attractif pour hedgers, vol traders, tail risk funds
```

---

## Qui sont les underwriters ?

| Type | Motivation | Rationalité |
|------|-----------|-------------|
| **Hedger xStocks** | Détient NVDAx, veut se protéger contre crash | Profit knock-in compense pertes stock |
| **Vol trader** | Pense que le stock est plus volatile que le coupon implique | EV positive si vol réelle > vol implicite |
| **Bearish speculator** | Veut du short levier sans perps | Levier 5:1 en cas de crash, perte max = dépôt |
| **Tail risk fund** | Earn Euler yield en attendant un black swan | Capital productif + payoff massif sur crash |

---

## Auto-pricing par le marché

Le coupon n'est pas fixé par le protocole — il émerge du marché :
- Beaucoup d'underwriters → coupons montent (compétition)
- Beaucoup d'investisseurs → coupons baissent
- Sous-jacent volatile (TSLAx) → coupons plus élevés naturellement
- Sous-jacent stable (SPYx) → coupons plus bas

Identique au pricing d'options en TradFi, sans la banque.

---

## Delta-Hedging : Répliquer le Desk de Structuration

### Pourquoi la banque delta-hedge (et pourquoi on doit le faire)

En TradFi, la banque ne garde PAS l'argent en cash. Elle **delta-hedge dynamiquement** pour 3 raisons :

**1. Lisser le coût d'acquisition**
Au lieu d'acheter tout à un seul prix (inception ou knock-in), le trader achète progressivement. Le coût moyen est entre le prix initial et le prix de knock-in.

**2. Gamma P&L (profit de rebalancing)**
Le rebalancing crée du profit : acheter bas, vendre haut. Si le stock oscille, chaque rebalancing capture du **gamma scalping** — un des P&L majeurs des desks de structuration.

**3. Réduire le risque de gap**
Si on détient 0 xStocks et qu'un flash crash se produit, on doit tout acheter d'un coup dans un marché en panique. Avec un hedge partiel, on a déjà une partie de la position.

### Comment la banque fait exactement

```
JOUR 0 — Émission ($10M notional, NVDAx à $100, KI 70%)
  Delta du put knock-in ≈ -0.25
  → Acheter 25,000 shares ($2.5M)
  → $7.5M en cash/money market

JOUR 30 — NVDAx à $110 (loin de la barrière)
  Nouveau delta ≈ -0.15
  → VENDRE 10,000 shares à $110 (+$1.1M cash)
  → Gamma P&L: +$100k (acheté à $100, vendu à $110)

JOUR 90 — NVDAx à $80 (se rapproche de la barrière)
  Nouveau delta ≈ -0.45
  → ACHETER 30,000 shares à $80 (-$2.4M cash)

JOUR 180 — NVDAx à $72 (proche du knock-in!)
  Nouveau delta ≈ -0.80 (gamma élevé)
  → ACHETER 35,000 shares à $72

KNOCK-IN à $69 — Delta → -1.0
  → Compléter à 100,000 shares
  → Prix moyen d'achat ≈ $82 (pas $100, pas $69)
  → Livraison : 100,000 NVDAx → investisseur
```

### Notre version DeFi : le Delta Hedge Engine

```
┌──────────────────────────────────────────────────────────┐
│                  DELTA HEDGE ENGINE                       │
│                                                           │
│  Pour chaque note active :                               │
│                                                           │
│  1. Calculer le delta du put knock-in                    │
│     delta = f(spot, barrier, vol, time_to_maturity)      │
│                                                           │
│  2. Position cible = |delta| × notional_shares           │
│     Ex: delta=0.30, notional=100 shares → target=30      │
│                                                           │
│  3. Rebalancer via 1inch si écart > seuil (5%)           │
│     position < target → BUY xStocks                      │
│     position > target → SELL xStocks                     │
│                                                           │
│  4. Trigger : observation dates + si prix bouge >5%      │
│     Déclenché par Chainlink CRE                          │
│                                                           │
│  Cash non-hedgé = Euler (yield)                          │
│  xStocks hedgé = Vault (détention directe)               │
└──────────────────────────────────────────────────────────┘
```

### Cash flows complets avec delta-hedge

```
CRÉATION — NVDAx à $100, notional 100 shares
  Investisseur : $10,000 | Underwriter : $2,000 | Total : $12,000
  Delta initial ≈ 0.30
  → Acheter 30 NVDAx à $100 = $3,000 via 1inch
  → Euler deposit : $9,000
  [30 NVDAx ($3,000) | $9,000 Euler]

Q1 — NVDAx à $110 → Delta ≈ 0.20
  → VENDRE 10 NVDAx à $110 = +$1,100
  → Gamma P&L : 10 × ($110-$100) = +$100
  → Payer coupon : $300
  [20 NVDAx ($2,200) | $9,812 Euler]

Q2 — NVDAx à $85 → Delta ≈ 0.45
  → ACHETER 25 NVDAx à $85 = -$2,125
  → Payer coupon : $300
  [45 NVDAx ($3,825) | $7,499 Euler]

Q3 — NVDAx à $72 → Delta ≈ 0.75
  → ACHETER 30 NVDAx à $72 = -$2,160
  → Payer coupon : $300
  [75 NVDAx ($5,400) | $5,146 Euler]

Q4 KNOCK-IN — NVDAx à $65 → Delta → 1.0
  → ACHETER 25 NVDAx à $65 = -$1,625
  → Payer coupon : $300

  ÉTAT FINAL :
  [100 NVDAx ($6,500) | $3,321 Euler]

  LIVRAISON :
  100 NVDAx → Investisseur (valeur $6,500)
  $3,321 → Underwriter pool

  BILAN :
  Coût total 100 NVDAx : 30×$100 + 25×$85 + 30×$72 + 25×$65 - 10×$110
                        = $3,000 + $2,125 + $2,160 + $1,625 - $1,100
                        = $7,810 (vs $10,000 si acheté au début, vs $6,500 si acheté au KI)

  Investisseur : $6,500 xStocks + $1,200 coupons = $7,700 / $10,000 = -23%
  Underwriter : $3,321 - $2,000 = +$1,321 profit (+66%)
```

### Comparaison avec vs sans delta-hedge

```
                        SANS HEDGE         AVEC DELTA-HEDGE
─────────────────────────────────────────────────────────────
xStocks détenus         0 (sauf delivery)  30-100% du notional
xStocks Relevance       ★★★☆☆              ★★★★★
Risque de slippage      ÉLEVÉ (tout d'un   FAIBLE (75%+ déjà
à la livraison          coup au KI)        détenu au KI)
Gamma P&L               $0                 +$100 à +$500/note
Euler yield             MAX (tout USDC)    RÉDUIT (partie xStocks)
Transactions 1inch      1-2                4-8 (rebalancing)
Fidélité TradFi         ★★★☆☆              ★★★★★
```

### Delta calculation onchain (version hackathon)

```solidity
/// @notice Simplified knock-in put delta
/// @param spotBps Price as % of initial (10000 = 100%)
/// @param barrierBps Knock-in barrier (7000 = 70%)
/// @param timeToMatBps Time remaining as % of total (10000 = 100%)
/// @return deltaBps Delta in bps (3000 = 0.30)
function calculateDelta(
    uint256 spotBps,
    uint256 barrierBps,
    uint256 timeToMatBps
) public pure returns (uint256 deltaBps) {
    if (spotBps <= barrierBps) return 10000; // knocked in → full hedge

    uint256 moneyness = spotBps - barrierBps;

    // Base delta: inversely proportional to distance from barrier
    uint256 baseDelta;
    if (moneyness >= 5000) {
        baseDelta = 500; // 5% floor
    } else {
        baseDelta = 10000 - (moneyness * 19000 / 10000);
        if (baseDelta < 500) baseDelta = 500;
    }

    // Time decay: delta increases as maturity approaches
    uint256 timeAdj = 10000 - (timeToMatBps / 3);
    deltaBps = (baseDelta * timeAdj) / 10000;

    if (deltaBps > 10000) deltaBps = 10000;
    if (deltaBps < 500) deltaBps = 500;
}
```

---

## Architecture Smart Contracts (mise à jour avec delta-hedge)

```
NoteFactory.sol              ─── Creates new note series
     │
     ↓
NoteVault.sol                ─── Core lifecycle manager
     │                           ERC-1155 note tokens
     │
     ├──→ DeltaHedgeEngine.sol  ─── Delta calculation
     │         │                     Rebalancing logic
     │         │                     xStock position tracking
     │         │
     │         ├──→ SwapAdapter.sol    ─── 1inch (buy/sell xStocks)
     │         └──→ PriceOracle.sol    ─── Chainlink Data Streams
     │
     ├──→ EulerAdapter.sol       ─── Deposit/withdraw idle USDC
     │
     └──→ ObservationEngine.sol  ─── Barrier checks + settlement
                                      Triggered by Chainlink CRE

UnderwriterPool.sol          ─── LP deposits/withdrawals
     │                           Pro-rata P&L (incl. gamma P&L)
     └──→ RiskManager.sol    ─── Coverage ratio, utilization caps

NoteToken.sol (ERC-1155)     ─── Transferable note positions

CRE Workflow (off-chain)     ─── Cron observations
                                  Price-triggered rebalancing
                                  Barrier monitoring
```

---

## Lifecycle mise à jour avec Delta-Hedge

```
Phase 1: FUNDING + INITIAL HEDGE
  Investor USDC ──→ NoteVault
  Underwriter USDC ──→ Pool
  DeltaHedgeEngine:
    Calculate initial delta (≈0.25-0.35)
    Buy delta% of notional in xStocks via 1inch
    Deposit remaining USDC in Euler

Phase 2: ACTIVE (observations + rebalancing)
  Chainlink CRE triggers:
    ├── Observation dates → check barriers + rebalance
    └── Price moves >5% → rebalance delta hedge

  At each trigger:
    1. Fetch price (Chainlink Data Streams)
    2. Calculate new delta
    3. Rebalance xStock position (1inch buy/sell)
    4. Check autocall/knock-in barriers
    5. Pay coupon if due (from underwriter pool + gamma P&L)

Phase 3a: AUTOCALL
  Sell all xStocks via 1inch → USDC
  Euler withdraw
  Return principal + coupon to investor
  Remaining (incl. gamma P&L) → underwriter pool

Phase 3b: KNOCK-IN MATURITY
  Buy remaining xStocks to reach 100% via 1inch
  Deliver all xStocks to investor
  Remaining USDC (pool profit) → underwriter pool

Phase 3c: MATURITY (no knock-in)
  Sell all xStocks via 1inch → USDC
  Euler withdraw
  Return principal + final coupon to investor
  Remaining → underwriter pool
```

---

## Revenue Model

- **Issuance fee** : 0.5% du notionnel à l'ouverture
- **Performance fee** : 10% du gamma P&L + 10% des profits underwriter sur knock-in
- **Coupon spread** : 0.1-0.25% de spread entre coupon affiché et coupon réel
- **Swap fees** : protocol captures une partie des 1inch referral fees sur chaque rebalancing

---

## Scoring Hackathon

| Critère (poids) | Score | Justification |
|-----------------|-------|---------------|
| xStocks Relevance (30%) | **10/10** | Achat, détention, rebalancing, physical delivery de xStocks. Le protocole est un HOLDER actif de xStocks. |
| Technical Execution (30%) | **9/10** | Delta hedge engine + CRE + Euler + 1inch + ERC-1155. Banking-grade complexity. |
| Innovation (15%) | **10/10** | Premier autocall P2P avec delta-hedge onchain. Jamais fait nulle part. |
| Market Potential (10%) | **9/10** | $13T structured products TradFi → DeFi disruption |
| UX & Design (10%) | **8/10** | Investor dashboard + Underwriter dashboard + Risk monitor |
| Presentation (5%) | **9/10** | "We built a structuring desk in a smart contract" |

---

## Pricing Engine : Monte Carlo Off-Chain via Chainlink CRE

### Pourquoi on ne peut PAS pricer un autocall avec Black-Scholes

Un autocall est une **option exotique path-dependent**. Le payoff dépend du CHEMIN du prix (est-ce qu'il a touché la barrière à une date d'observation précise ?), pas juste du prix final. Black-Scholes ne fonctionne que pour les options européennes (payoff = f(prix final)).

En TradFi, les quants utilisent :
- **Monte Carlo** : simuler 10,000-100,000 chemins de prix, évaluer le payoff moyen
- **Vol locale (Dupire)** : extraire une surface de volatilité à partir des options cotées
- **Vol stochastique (Heston/SABR)** : modéliser la dynamique de la vol elle-même
- **Méthodes aux différences finies** : résoudre numériquement l'EDP de pricing

Pour notre protocole, **Monte Carlo via CRE** est l'approche la plus adaptée : c'est flexible, extensible, et le calcul lourd se fait off-chain.

### Architecture : Off-chain compute, Onchain settlement

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHAINLINK CRE (OFF-CHAIN)                     │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                  PRICING WORKFLOW                           │  │
│  │                                                             │  │
│  │  Trigger: cron (daily 16h30 ET) + price deviation (>3%)    │  │
│  │                                                             │  │
│  │  1. FETCH INPUTS                                           │  │
│  │     ├── Spot prices (Chainlink Data Streams)               │  │
│  │     ├── Historical prices (30j → realized vol)             │  │
│  │     ├── Risk-free rate (Euler lending rate onchain)         │  │
│  │     └── Note parameters (NoteVault onchain)                │  │
│  │                                                             │  │
│  │  2. COMPUTE VOLATILITY                                     │  │
│  │     ├── Realized vol 30j (close-to-close)                  │  │
│  │     ├── Realized vol 90j (longer window)                   │  │
│  │     ├── EWMA vol (exponentially weighted)                  │  │
│  │     └── Parkinson vol (high-low estimator, si dispo)       │  │
│  │                                                             │  │
│  │  3. MONTE CARLO SIMULATION (N=10,000 paths)               │  │
│  │     ├── Simulate GBM paths to each observation date        │  │
│  │     ├── Check autocall barrier at each obs date            │  │
│  │     ├── Check knock-in barrier (continuous or discrete)    │  │
│  │     ├── Compute discounted payoff for each path            │  │
│  │     └── Average = fair value of the note                   │  │
│  │                                                             │  │
│  │  4. COMPUTE GREEKS (bump-and-reprice)                      │  │
│  │     ├── Delta : reprice at S+ε and S-ε                     │  │
│  │     ├── Gamma : (V(S+ε) - 2V(S) + V(S-ε)) / ε²           │  │
│  │     ├── Vega  : reprice at σ+0.01                          │  │
│  │     ├── Theta : reprice at T-1day                          │  │
│  │     └── Rho   : reprice at r+0.01                          │  │
│  │                                                             │  │
│  │  5. DERIVE FAIR COUPON                                     │  │
│  │     Binary search : find coupon C where noteValue(C) = 1.0 │  │
│  │     = coupon rate that makes the note "at par"              │  │
│  │                                                             │  │
│  │  6. RISK METRICS                                           │  │
│  │     ├── P(knock-in) : % of paths that hit barrier          │  │
│  │     ├── P(autocall) per observation date                   │  │
│  │     ├── Expected loss given knock-in                       │  │
│  │     ├── VaR 95% / CVaR 95% for the pool                   │  │
│  │     └── Stress scenarios (spot -20%, -30%, -40%)           │  │
│  │                                                             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│                    POST RESULTS ONCHAIN                           │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ONCHAIN (Smart Contracts)                      │
│                                                                   │
│  PricingOracle.sol                                               │
│  ├── updatePricing(noteId, delta, fairCoupon, noteValue, ...)   │
│  ├── Stores latest Greeks for each active note                   │
│  ├── Emits events for frontend consumption                       │
│  └── Access-controlled : only CRE DON nodes can write           │
│                                                                   │
│  Consumed by :                                                    │
│  ├── DeltaHedgeEngine.sol → reads delta for rebalancing          │
│  ├── NoteFactory.sol → reads fairCoupon for new note pricing     │
│  ├── RiskManager.sol → reads VaR/stress for pool health          │
│  └── Frontend → reads all for dashboard display                  │
└─────────────────────────────────────────────────────────────────┘
```

### Le CRE Workflow complet (TypeScript)

```typescript
import { cre } from "@chainlink/cre-sdk";

// === TYPES ===

interface NoteParams {
  noteId: string;
  underlying: string;         // "NVDAx"
  initialPrice: number;       // prix au lancement
  autocallBarrierPct: number; // 1.0 = 100%
  knockinBarrierPct: number;  // 0.7 = 70%
  couponRate: number;         // 0.03 = 3% par période
  observationDates: number[]; // timestamps unix
  maturityDate: number;
  notionalShares: number;     // nombre de shares du notionnel
}

interface PricingResult {
  noteValue: number;       // mark-to-market (1.0 = par)
  fairCoupon: number;      // coupon qui rend noteValue = 1.0
  delta: number;           // hedge ratio (0 à 1)
  gamma: number;           // dDelta/dSpot
  vega: number;            // dValue/dVol (pour 1% de vol)
  theta: number;           // dValue/dT (par jour)
  knockInProb: number;     // probabilité de knock-in (0 à 1)
  autocallProbs: number[]; // probabilité d'autocall à chaque date
  expectedLossKI: number;  // perte moyenne si knock-in
  var95: number;           // Value-at-Risk 95%
}

// === VOLATILITY COMPUTATION ===

function computeRealizedVol(prices: number[], window: number): number {
  // Log-returns
  const returns: number[] = [];
  const start = Math.max(0, prices.length - window);
  for (let i = start + 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }

  // Standard deviation of log-returns
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0)
                   / (returns.length - 1);

  // Annualize (252 trading days)
  return Math.sqrt(variance * 252);
}

function computeEWMAVol(prices: number[], lambda: number = 0.94): number {
  // Exponentially Weighted Moving Average — RiskMetrics standard
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }

  let variance = returns[0] ** 2;
  for (let i = 1; i < returns.length; i++) {
    variance = lambda * variance + (1 - lambda) * returns[i] ** 2;
  }

  return Math.sqrt(variance * 252);
}

// === RANDOM NUMBER GENERATION ===

// Box-Muller transform for normal distribution
function normalRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// === MONTE CARLO PRICER ===

function monteCarloPrice(
  spot: number,
  vol: number,
  riskFreeRate: number,
  note: NoteParams,
  couponOverride: number | null,
  numSims: number = 10000
): PricingResult {
  const coupon = couponOverride ?? note.couponRate;
  const now = Date.now() / 1000;

  // Filter future observation dates
  const futureDates = note.observationDates.filter(d => d > now);
  const T = (note.maturityDate - now) / (365 * 86400); // years to maturity

  let totalPayoff = 0;
  let knockInCount = 0;
  const autocallCounts = new Array(futureDates.length).fill(0);
  const payoffs: number[] = [];

  for (let sim = 0; sim < numSims; sim++) {
    let S = spot;
    let knockedIn = false;
    let autocalled = false;
    let payoff = 0;
    let prevTime = now;

    for (let i = 0; i < futureDates.length; i++) {
      const obsTime = futureDates[i];
      const dt = (obsTime - prevTime) / (365 * 86400); // years

      // GBM step : S(t+dt) = S(t) × exp((r - σ²/2)dt + σ√dt × Z)
      const Z = normalRandom();
      S = S * Math.exp(
        (riskFreeRate - 0.5 * vol * vol) * dt + vol * Math.sqrt(dt) * Z
      );
      prevTime = obsTime;

      // Autocall check : prix ≥ autocall barrier × initial
      if (S >= note.autocallBarrierPct * note.initialPrice) {
        const periodsElapsed = note.observationDates.indexOf(obsTime) + 1;
        payoff = 1 + coupon * periodsElapsed; // principal + coupons
        const tToObs = (obsTime - now) / (365 * 86400);
        payoff *= Math.exp(-riskFreeRate * tToObs); // discount
        autocallCounts[i]++;
        autocalled = true;
        break;
      }

      // Knock-in check : prix < knock-in barrier × initial
      if (S < note.knockinBarrierPct * note.initialPrice) {
        knockedIn = true;
      }
    }

    if (!autocalled) {
      const totalPeriods = note.observationDates.length;
      if (knockedIn && S < note.initialPrice) {
        // Knock-in AND final price below initial → physical delivery at loss
        payoff = (S / note.initialPrice) + coupon * totalPeriods;
      } else {
        // No knock-in, OR knock-in but stock recovered above initial
        // → full principal returned + all coupons
        payoff = 1 + coupon * totalPeriods;
      }
      payoff *= Math.exp(-riskFreeRate * T); // discount to present
      if (knockedIn) knockInCount++; // track all knock-ins (even recovered)
    }

    totalPayoff += payoff;
    payoffs.push(payoff);
  }

  const noteValue = totalPayoff / numSims;
  const knockInProb = knockInCount / numSims;

  // VaR 95% : 5th percentile of payoff distribution
  payoffs.sort((a, b) => a - b);
  const var95 = 1 - payoffs[Math.floor(numSims * 0.05)]; // loss amount

  // Expected loss given knock-in
  const kiPayoffs = payoffs.filter(p => p < 1);
  const expectedLossKI = kiPayoffs.length > 0
    ? 1 - kiPayoffs.reduce((a, b) => a + b, 0) / kiPayoffs.length
    : 0;

  return {
    noteValue,
    fairCoupon: 0, // computed separately via binary search
    delta: 0,      // computed separately via bump-and-reprice
    gamma: 0,
    vega: 0,
    theta: 0,
    knockInProb,
    autocallProbs: autocallCounts.map(c => c / numSims),
    expectedLossKI,
    var95,
  };
}

// === FAIR COUPON SOLVER ===

function solveFairCoupon(
  spot: number,
  vol: number,
  riskFreeRate: number,
  note: NoteParams,
  numSims: number = 10000
): number {
  // Binary search : find coupon C where noteValue(C) ≈ 1.0 (par)
  let low = 0.001;  // 0.1%
  let high = 0.15;  // 15% per period
  let mid = 0;

  for (let iter = 0; iter < 50; iter++) {
    mid = (low + high) / 2;
    const result = monteCarloPrice(spot, vol, riskFreeRate, note, mid, numSims);

    if (Math.abs(result.noteValue - 1.0) < 0.0001) break;

    if (result.noteValue > 1.0) {
      high = mid; // coupon too high → note overvalued → reduce
    } else {
      low = mid;  // coupon too low → note undervalued → increase
    }
  }

  return mid;
}

// === GREEKS VIA BUMP-AND-REPRICE ===

function computeGreeks(
  spot: number,
  vol: number,
  riskFreeRate: number,
  note: NoteParams,
  numSims: number = 10000
): { delta: number; gamma: number; vega: number; theta: number } {
  const eps_S = spot * 0.01;  // 1% spot bump
  const eps_vol = 0.01;       // 1% vol bump
  const eps_T = 1 / 365;      // 1 day

  // Base price
  const V = monteCarloPrice(spot, vol, riskFreeRate, note, null, numSims).noteValue;

  // Delta = dV/dS (central difference)
  const V_up = monteCarloPrice(spot + eps_S, vol, riskFreeRate, note, null, numSims).noteValue;
  const V_dn = monteCarloPrice(spot - eps_S, vol, riskFreeRate, note, null, numSims).noteValue;
  const delta = (V_up - V_dn) / (2 * eps_S) * spot; // normalized

  // Gamma = d²V/dS²
  const gamma = (V_up - 2 * V + V_dn) / (eps_S * eps_S) * spot * spot;

  // Vega = dV/dσ (for 1% vol move)
  const V_vup = monteCarloPrice(spot, vol + eps_vol, riskFreeRate, note, null, numSims).noteValue;
  const vega = V_vup - V;

  // Theta = dV/dT (per day)
  // Shift all observation dates and maturity by -1 day
  const shiftedNote = {
    ...note,
    observationDates: note.observationDates.map(d => d - 86400),
    maturityDate: note.maturityDate - 86400,
  };
  const V_t = monteCarloPrice(spot, vol, riskFreeRate, shiftedNote, null, numSims).noteValue;
  const theta = V_t - V; // negative = time decay (note loses value)

  return { delta: Math.abs(delta), gamma, vega, theta };
}

// === WORST-OF BASKET (multi-asset, correlated) ===

function choleskyDecomposition(matrix: number[][]): number[][] {
  const n = matrix.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }
      if (i === j) {
        L[i][j] = Math.sqrt(matrix[i][i] - sum);
      } else {
        L[i][j] = (matrix[i][j] - sum) / L[j][j];
      }
    }
  }
  return L;
}

function monteCarloWorstOf(
  spots: number[],
  vols: number[],
  correlationMatrix: number[][],
  riskFreeRate: number,
  note: NoteParams, // barrier/coupon apply to worst performer
  numSims: number = 10000
): PricingResult {
  const n = spots.length; // number of underlyings
  const L = choleskyDecomposition(correlationMatrix);
  const now = Date.now() / 1000;
  const futureDates = note.observationDates.filter(d => d > now);
  const T = (note.maturityDate - now) / (365 * 86400);

  let totalPayoff = 0;
  let knockInCount = 0;
  const payoffs: number[] = [];

  for (let sim = 0; sim < numSims; sim++) {
    const S = [...spots]; // current prices for each underlying
    let knockedIn = false;
    let autocalled = false;
    let payoff = 0;
    let prevTime = now;

    for (let i = 0; i < futureDates.length; i++) {
      const dt = (futureDates[i] - prevTime) / (365 * 86400);
      prevTime = futureDates[i];

      // Generate correlated random numbers
      const Z_indep = Array.from({ length: n }, () => normalRandom());
      const Z_corr = L.map((row) =>
        row.reduce((sum, Lij, j) => sum + Lij * Z_indep[j], 0)
      );

      // GBM step for each underlying
      for (let k = 0; k < n; k++) {
        S[k] = S[k] * Math.exp(
          (riskFreeRate - 0.5 * vols[k] ** 2) * dt
          + vols[k] * Math.sqrt(dt) * Z_corr[k]
        );
      }

      // Performance of each underlying vs initial
      const performances = S.map((s, k) => s / spots[k]);

      // WORST-OF : performance = min across all underlyings
      const worstPerf = Math.min(...performances);

      // Autocall check on worst performer
      if (worstPerf >= note.autocallBarrierPct) {
        const periodsElapsed = note.observationDates.indexOf(futureDates[i]) + 1;
        payoff = 1 + note.couponRate * periodsElapsed;
        payoff *= Math.exp(-riskFreeRate * (futureDates[i] - now) / (365 * 86400));
        autocalled = true;
        break;
      }

      // Knock-in check on worst performer
      if (worstPerf < note.knockinBarrierPct) {
        knockedIn = true;
      }
    }

    if (!autocalled) {
      const totalPeriods = note.observationDates.length;
      const performances = S.map((s, k) => s / spots[k]);
      const worstPerf = Math.min(...performances);

      if (knockedIn && worstPerf < 1.0) {
        // Knock-in AND worst performer below initial → physical delivery
        // Deliver the worst-performing xStock at current (depressed) value
        payoff = worstPerf + note.couponRate * totalPeriods;
      } else {
        // No knock-in, OR knock-in but all stocks recovered above initial
        payoff = 1 + note.couponRate * totalPeriods;
      }
      payoff *= Math.exp(-riskFreeRate * T);
      if (knockedIn) knockInCount++;
    }

    totalPayoff += payoff;
    payoffs.push(payoff);
  }

  payoffs.sort((a, b) => a - b);

  return {
    noteValue: totalPayoff / numSims,
    fairCoupon: 0,
    delta: 0,
    gamma: 0,
    vega: 0,
    theta: 0,
    knockInProb: knockInCount / numSims,
    autocallProbs: [],
    expectedLossKI: 0,
    var95: 1 - payoffs[Math.floor(numSims * 0.05)],
  };
}

// === CRE MAIN WORKFLOW ===

const PRICING_SCHEDULE = cre.cronTrigger({
  schedule: "0 30 16 * * MON-FRI", // 16h30 ET = after US market close
  timezone: "America/New_York",
});

cre.handler(PRICING_SCHEDULE, async (ctx) => {
  // 1. Get all active notes
  const activeNoteIds = await ctx.evmClient.read({
    chain: "ethereum",
    contract: NOTE_VAULT_ADDRESS,
    method: "getActiveNoteIds",
    args: [],
  });

  for (const noteId of activeNoteIds) {
    // 2. Read note parameters from chain
    const noteParams = await ctx.evmClient.read({
      chain: "ethereum",
      contract: NOTE_VAULT_ADDRESS,
      method: "getNoteParams",
      args: [noteId],
    });

    // 3. Fetch current spot price from Chainlink Data Streams
    const spotPrice = await ctx.dataStreams.read({
      feedId: noteParams.underlyingFeedId,
      fields: ["price", "marketStatus"],
    });

    // Skip if market is closed
    if (spotPrice.marketStatus !== 1) continue;

    // 4. Fetch historical prices for vol calculation
    const histPrices = await ctx.httpClient.fetch({
      url: `https://api.xstocks.fi/v1/prices/history`
          + `?asset=${noteParams.underlying}&days=90`,
      method: "GET",
    });
    const prices = JSON.parse(histPrices.body).prices;

    // 5. Calculate volatility (use EWMA as primary)
    const vol30 = computeRealizedVol(prices, 30);
    const volEWMA = computeEWMAVol(prices, 0.94);
    const vol = Math.max(vol30, volEWMA); // conservative: use higher vol

    // 6. Get risk-free rate from Euler
    const eulerRate = await ctx.evmClient.read({
      chain: "ethereum",
      contract: EULER_VAULT_ADDRESS,
      method: "interestRate",
      args: [],
    });
    const riskFreeRate = Number(eulerRate) / 1e18; // normalize

    // 7. Run Monte Carlo pricing
    const note: NoteParams = {
      noteId,
      underlying: noteParams.underlying,
      initialPrice: Number(noteParams.initialPrice) / 1e18,
      autocallBarrierPct: Number(noteParams.autocallBarrierBps) / 10000,
      knockinBarrierPct: Number(noteParams.knockinBarrierBps) / 10000,
      couponRate: Number(noteParams.couponBps) / 10000,
      observationDates: noteParams.observationDates.map(Number),
      maturityDate: Number(noteParams.maturityDate),
      notionalShares: Number(noteParams.notionalShares),
    };

    const pricing = monteCarloPrice(
      spotPrice.price, vol, riskFreeRate, note, null, 10000
    );

    // 8. Compute Greeks
    const greeks = computeGreeks(
      spotPrice.price, vol, riskFreeRate, note, 10000
    );

    // 9. Compute fair coupon for new notes with same params
    const fairCoupon = solveFairCoupon(
      spotPrice.price, vol, riskFreeRate, note, 10000
    );

    // 10. Post everything onchain
    await ctx.evmClient.write({
      chain: "ethereum",
      contract: PRICING_ORACLE_ADDRESS,
      method: "updatePricing",
      args: [
        noteId,
        toFixed18(greeks.delta),       // delta (0-1 scaled to 18 decimals)
        toFixed18(greeks.gamma),
        toFixed18(greeks.vega),
        toFixed18(greeks.theta),
        toFixed18(fairCoupon),
        toFixed18(pricing.noteValue),
        toFixed18(pricing.knockInProb),
        toFixed18(pricing.var95),
        toFixed18(vol),                // current vol used
      ],
    });

    // 11. Check if delta-hedge rebalance needed
    const currentDelta = await ctx.evmClient.read({
      chain: "ethereum",
      contract: DELTA_HEDGE_ENGINE_ADDRESS,
      method: "currentDelta",
      args: [noteId],
    });

    const deltaChange = Math.abs(greeks.delta - Number(currentDelta) / 1e18);
    if (deltaChange > 0.05) { // 5% threshold
      await ctx.evmClient.write({
        chain: "ethereum",
        contract: DELTA_HEDGE_ENGINE_ADDRESS,
        method: "rebalance",
        args: [noteId, toFixed18(greeks.delta)],
      });
    }
  }
});

function toFixed18(value: number): bigint {
  return BigInt(Math.round(value * 1e18));
}
```

### PricingOracle.sol — Le contrat qui reçoit les résultats

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

struct PricingData {
    uint256 delta;          // 18 decimals (0.3e18 = delta of 0.30)
    uint256 gamma;          // 18 decimals
    int256  vega;           // 18 decimals (can be negative)
    int256  theta;          // 18 decimals (usually negative)
    uint256 fairCoupon;     // 18 decimals (per period)
    uint256 noteValue;      // 18 decimals (1e18 = par)
    uint256 knockInProb;    // 18 decimals (probability 0-1)
    uint256 var95;          // 18 decimals (loss amount)
    uint256 impliedVol;     // 18 decimals (annualized)
    uint256 lastUpdate;     // timestamp
}

contract PricingOracle is Ownable {
    /// @notice CRE DON address authorized to post pricing
    address public creDonAddress;

    /// @notice Latest pricing data per noteId
    mapping(bytes32 => PricingData) public pricing;

    /// @notice Latest fair coupon per underlying (for new note pricing)
    mapping(address => uint256) public fairCouponByUnderlying;

    event PricingUpdated(
        bytes32 indexed noteId,
        uint256 delta,
        uint256 fairCoupon,
        uint256 noteValue,
        uint256 knockInProb
    );

    modifier onlyCRE() {
        require(msg.sender == creDonAddress, "Only CRE DON");
        _;
    }

    constructor(address _creDon) Ownable(msg.sender) {
        creDonAddress = _creDon;
    }

    function updatePricing(
        bytes32 noteId,
        uint256 delta,
        uint256 gamma,
        int256  vega,
        int256  theta,
        uint256 fairCoupon,
        uint256 noteValue,
        uint256 knockInProb,
        uint256 var95,
        uint256 impliedVol
    ) external onlyCRE {
        pricing[noteId] = PricingData({
            delta: delta,
            gamma: gamma,
            vega: vega,
            theta: theta,
            fairCoupon: fairCoupon,
            noteValue: noteValue,
            knockInProb: knockInProb,
            var95: var95,
            impliedVol: impliedVol,
            lastUpdate: block.timestamp
        });

        emit PricingUpdated(noteId, delta, fairCoupon, noteValue, knockInProb);
    }

    /// @notice Get delta for the DeltaHedgeEngine
    function getDelta(bytes32 noteId) external view returns (uint256) {
        require(
            block.timestamp - pricing[noteId].lastUpdate < 3 days,
            "Pricing stale" // 3 days to cover weekends (CRE runs MON-FRI only)
        );
        return pricing[noteId].delta;
    }

    /// @notice Get fair coupon for NoteFactory (new note issuance)
    function getFairCoupon(bytes32 noteId) external view returns (uint256) {
        return pricing[noteId].fairCoupon;
    }

    /// @notice Get full risk metrics for RiskManager
    function getRiskMetrics(bytes32 noteId)
        external view
        returns (uint256 knockInProb, uint256 var95, uint256 impliedVol)
    {
        PricingData memory p = pricing[noteId];
        return (p.knockInProb, p.var95, p.impliedVol);
    }
}
```

### Pourquoi c'est supérieur à un delta linéaire onchain

```
                    DELTA LINÉAIRE        MONTE CARLO CRE
                    (onchain, approx)     (off-chain, exact)
────────────────────────────────────────────────────────────
Précision delta     ★★☆☆☆                 ★★★★★
                    Approximation         Bump-and-reprice
                    linéaire              numérique exact

Pricing coupon      FIXE                  DYNAMIQUE
                    Set manuellement      Fair coupon calculé
                                          par le marché (MC)

Greeks              Delta seulement       Delta + Gamma + Vega
                                          + Theta + Rho

Risk metrics        Aucun                 P(knock-in), VaR,
                                          stress tests

Worst-of basket     Impossible            ✓ (corrélation
                    (pas de corrélation)  multi-asset)

Coût gas            ÉLEVÉ (calcul         ZÉRO (off-chain)
                    onchain à chaque      Seul le résultat
                    rebalance)            est posté

Sophistication      Hackathon-tier        Banking-grade
                                          (Quant-level)
```

### Les Greeks — ce qu'ils signifient pour le protocole

| Greek | Formule | Utilisation dans le protocole |
|-------|---------|------------------------------|
| **Delta (Δ)** | ∂V/∂S | Combien de xStocks détenir dans le hedge. Lu par DeltaHedgeEngine pour rebalancer via 1inch. |
| **Gamma (Γ)** | ∂²V/∂S² | Vitesse de changement du delta. Gamma élevé près de la barrière = rebalancer plus souvent = plus de gamma P&L. |
| **Vega (ν)** | ∂V/∂σ | Sensibilité à la volatilité. Utilisé pour pricer les nouvelles notes : haute vol → coupon plus élevé. |
| **Theta (Θ)** | ∂V/∂t | Time decay. La valeur du put embedded diminue avec le temps → favorable à l'underwriter si pas de knock-in. |
| **Rho (ρ)** | ∂V/∂r | Sensibilité au taux. Si les taux Euler montent, le fair coupon change. |

### Flow de données complet

```
  Chainlink Data Streams     Historical Price API      Euler Vault
         │                          │                       │
         │ spot price               │ 90d prices            │ lending rate
         │                          │                       │
         ▼                          ▼                       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │                    CRE PRICING WORKFLOW                       │
  │                                                               │
  │  vol = EWMA(historical_prices)                               │
  │  MC(spot, vol, rate, barriers) → noteValue, Greeks           │
  │  binarySearch(MC, target=1.0) → fairCoupon                  │
  │  bumpReprice(MC, spot±ε) → delta, gamma                     │
  │  stressTest(MC, spot×0.7) → VaR, expected loss              │
  └──────────────────────┬───────────────────────────────────────┘
                         │
                         │ updatePricing(noteId, delta, gamma, ...)
                         ▼
                  PricingOracle.sol
                    │         │         │
          ┌─────────┘         │         └──────────┐
          ▼                   ▼                    ▼
  DeltaHedgeEngine     NoteFactory          RiskManager
  "rebalance to        "price new notes     "pool health,
   delta=0.42"          at fairCoupon"       utilization ok?"
       │                     │                    │
       ▼                     ▼                    ▼
   1inch swap          New note with          Block new notes
   (buy/sell           market-derived         if VaR > threshold
    xStocks)           coupon rate
```

---

## Analyse Globale du Document

### Forces de l'architecture

1. **Fidélité TradFi maximale** — Le protocole réplique exactement les 3 composants d'un desk de structuration :
   - Pricing engine (Monte Carlo CRE) = le quant
   - Delta hedge engine = le trader
   - Risk manager = le risk desk

2. **Séparation compute off-chain / settlement onchain** — Le pattern Chainlink standard : calcul lourd off-chain (CRE), résultats vérifiables onchain (PricingOracle). Zero gas pour le pricing.

3. **Le two-sided model est économiquement sound** — L'investisseur vend un put, l'underwriter l'achète. Le coupon est la prime. C'est un dérivé zero-sum fully collateralized. Pas de magic money.

4. **Integration depth maximale** — Le protocole est un participant actif du marché xStocks : il achète, détient, rebalance, vend, et livre des xStocks en continu via 1inch.

5. **Extensible** — Le même pricing engine supporte single-asset ET worst-of basket (corrélation multi-asset). Ajouter un nouveau produit = ajouter un nouveau payoff dans le Monte Carlo.

### Risques et points faibles

1. **Complexité pour le hackathon** — C'est un système ambitieux. Pour 3 jours, il faudra prioriser : MVP = NoteVault + UnderwriterPool + simplified delta + CRE observation. Le Monte Carlo complet peut être une v1.1.

2. **Liquidité xStocks** — Le delta-hedging suppose qu'on peut acheter/vendre des xStocks sans trop de slippage. Si la liquidité xStocks sur 1inch est faible, les rebalancings seront coûteux.

3. **Bootstrapping problem** — Qui underwrite en premier ? Sans underwriters, pas de notes. Sans notes, pas d'underwriters. Solution : seed le pool avec du capital initial (team + partenaires).

4. **Oracle risk** — Tout dépend de la fiabilité des prix Chainlink Data Streams pour xStocks. Un mauvais prix = un faux knock-in ou un faux autocall.

5. **Smart contract risk** — Le protocole détient des xStocks + USDC. Bug = perte de fonds. Audit indispensable post-hackathon.

---

## Features TradFi à implémenter

### Les 3 barrières (pas 2)

En TradFi, la plupart des autocalls ont **3 barrières**, pas 2 :

```
Autocall barrier : 100%  → Si prix ≥ 100% à une obs → termination + principal + coupons
Coupon barrier :    80%  → Si prix ≥ 80% à une obs → coupon payé (même sans autocall)
Knock-in barrier :  70%  → Si prix < 70% à une obs → flag KI activé

Zones :
  Prix ≥ 100%  → AUTOCALL (tout le monde est content)
  80% ≤ Prix < 100% → Coupon payé, pas d'autocall (on continue)
  70% ≤ Prix < 80%  → PAS de coupon, PAS de knock-in (zone morte)
  Prix < 70%   → Knock-in activé + pas de coupon
```

### Memory Coupon

Feature standard en TradFi : si un coupon est manqué (prix sous coupon barrier), il est **accumulé** et payé au prochain observation date où le prix est au-dessus du coupon barrier.

```
Exemple :
  Q1: NVDAx à 75% → sous coupon barrier (80%) → coupon MANQUÉ, accumulé ($300)
  Q2: NVDAx à 85% → au-dessus → coupon Q2 ($300) + coupon rattrapé Q1 ($300) = $600 payé
```

Ça rend le produit plus attractif pour l'investisseur (il ne perd pas définitivement les coupons).

### Knock-in ≠ perte automatique (CRITIQUE)

```
Knock-in = flag activé, PAS settlement immédiat.
Le settlement ne se fait qu'à MATURITÉ.

À maturité, si knock-in flag = true :
  - Prix final ≥ prix initial → principal remboursé (PAS de perte)
  - Prix final < prix initial → physical delivery à perte

Le stock PEUT remonter après avoir touché la barrière knock-in.
C'est ce qui rend les autocalls moins risqués que leur apparence :
historiquement, ~30% des knock-ins se terminent avec le stock
au-dessus du prix initial à maturité.
```

### Dividendes xStocks

Les xStocks sont des actions tokenisées. Les dividendes impactent le pricing :
- Chainlink Data Streams v10 inclut `currentMultiplier` et `newMultiplier` pour les corporate actions
- Les dividendes réduisent le prix du stock (ex-div) → affectent les barrières
- Le pricing Monte Carlo doit intégrer le dividend yield dans le drift GBM : `(r - q - σ²/2)dt` où `q` = dividend yield

---

## Partner Mapping Détaillé

### Chainlink — Le cerveau du protocole

```
┌─────────────────────────────────────────────────────────────┐
│                       CHAINLINK                              │
│                                                               │
│  DATA STREAMS v10 (tokenized equity schema)                  │
│  ├── Spot price NVDAx, TSLAx, SPYx, etc.                   │
│  ├── marketStatus (open/closed → bloquer les obs hors marché)│
│  ├── currentMultiplier / newMultiplier (corporate actions)   │
│  ├── tokenizedPrice (prix ajusté pour le token)              │
│  └── Utilisé par : PricingOracle.sol, DeltaHedgeEngine.sol  │
│                                                               │
│  CRE (Chainlink Runtime Environment)                         │
│  ├── PRICING WORKFLOW (daily 16h30 ET)                       │
│  │   ├── Monte Carlo 10,000 paths → noteValue, fair coupon   │
│  │   ├── Greeks (bump-and-reprice) → delta, gamma, vega      │
│  │   ├── Risk metrics → P(knock-in), VaR 95%                │
│  │   └── Post results → PricingOracle.sol                    │
│  │                                                            │
│  ├── OBSERVATION WORKFLOW (at each observation date)          │
│  │   ├── Fetch spot price from Data Streams                  │
│  │   ├── Check autocall barrier → trigger settlement          │
│  │   ├── Check knock-in barrier → set flag                   │
│  │   ├── Check coupon barrier → trigger coupon payment        │
│  │   └── Call ObservationEngine.sol                           │
│  │                                                            │
│  └── REBALANCING WORKFLOW (on delta change > 5%)             │
│      ├── Read new delta from PricingOracle                   │
│      ├── Calculate xStock position adjustment                 │
│      ├── Call DeltaHedgeEngine.rebalance()                    │
│      └── Which triggers 1inch swap                            │
│                                                               │
│  Où dans le code :                                            │
│  ├── PricingOracle.sol — reçoit les résultats CRE            │
│  ├── ObservationEngine.sol — déclenché par CRE               │
│  ├── DeltaHedgeEngine.sol — lit delta depuis PricingOracle   │
│  └── NoteFactory.sol — lit fair coupon pour nouvelles notes  │
└─────────────────────────────────────────────────────────────┘
```

### Euler Finance — La trésorerie

```
┌─────────────────────────────────────────────────────────────┐
│                      EULER FINANCE                            │
│                                                               │
│  ERC-4626 USDC Vault                                         │
│  ├── Idle USDC (investor capital non-hedgé) → deposit         │
│  ├── Underwriter pool capital → deposit                       │
│  ├── Yield : ~3-7% APY sur USDC                              │
│  ├── Withdraw on : coupon payment, autocall, maturity, KI     │
│  └── Le yield complète le coupon de l'underwriter             │
│                                                               │
│  EulerEarn (meta-vault, optionnel v2)                        │
│  └── Route vers les meilleurs vaults Euler automatiquement   │
│                                                               │
│  Potentiel v2 : xStocks comme collateral                     │
│  ├── Deposit NVDAx → borrow USDC → redéployer en yield      │
│  ├── Améliore capital efficiency du delta-hedge               │
│  └── Mais ajoute liquidation risk → trop complexe pour MVP   │
│                                                               │
│  Où dans le code :                                            │
│  └── EulerAdapter.sol                                         │
│      ├── deposit(uint256 amount) — USDC → Euler vault         │
│      ├── withdraw(uint256 amount) — Euler vault → USDC        │
│      ├── getBalance() — montant + yield accrued               │
│      └── Interface ERC-4626 standard                          │
└─────────────────────────────────────────────────────────────┘
```

### 1inch — Le bras d'exécution

```
┌─────────────────────────────────────────────────────────────┐
│                         1INCH                                 │
│                                                               │
│  SWAP API / FUSION (MEV-protected, gasless)                  │
│                                                               │
│  Quand on l'utilise :                                        │
│  ├── NOTE CREATION : acheter delta% de NVDAx avec USDC      │
│  │   → 1inch Fusion swap USDC → NVDAx                       │
│  │                                                            │
│  ├── REBALANCING (chaque observation + price triggers) :     │
│  │   ├── Delta monte → BUY more NVDAx (USDC → NVDAx)        │
│  │   └── Delta baisse → SELL NVDAx (NVDAx → USDC)           │
│  │                                                            │
│  ├── KNOCK-IN DELIVERY :                                     │
│  │   → Compléter position à 100% du notionnel                │
│  │   → Acheter remaining NVDAx à prix spot                   │
│  │                                                            │
│  ├── AUTOCALL / MATURITY (no KI) :                           │
│  │   → Vendre TOUS les xStocks détenus (NVDAx → USDC)       │
│  │   → Rembourser l'investisseur en USDC                     │
│  │                                                            │
│  └── REFERRAL FEES :                                         │
│      → Protocol capture des 1inch referral fees              │
│      → Revenue supplémentaire sur chaque swap                 │
│                                                               │
│  Pourquoi Fusion (pas simple swap) :                         │
│  ├── MEV protection — les rebalancings sont prédictibles      │
│  │   (CRE post le delta onchain → bot voit le trade arriver) │
│  ├── Gasless — réduit le coût de rebalancing fréquent         │
│  └── Better execution — resolvers en compétition              │
│                                                               │
│  Où dans le code :                                            │
│  └── SwapAdapter.sol                                          │
│      ├── buyXStock(address xstock, uint256 usdcAmount)       │
│      ├── sellXStock(address xstock, uint256 amount)           │
│      ├── getQuote(address xstock, uint256 amount) → price     │
│      └── Uses 1inch Aggregation Router or Fusion API          │
└─────────────────────────────────────────────────────────────┘
```

### xStocks — L'actif central

```
┌─────────────────────────────────────────────────────────────┐
│                        xSTOCKS                                │
│                                                               │
│  ERC-20 tokens (NVDAx, TSLAx, SPYx, AAPLx, etc.)           │
│  1:1 backed by real shares (Backed Finance / Kraken)         │
│                                                               │
│  Comment le protocole utilise xStocks :                      │
│  ├── ACHAT : à la création de note (delta-hedge initial)     │
│  ├── DÉTENTION : dans le vault pendant la vie de la note     │
│  ├── REBALANCING : achat/vente à chaque observation          │
│  ├── PHYSICAL DELIVERY : livraison au wallet investisseur    │
│  │   si knock-in + prix final < initial                      │
│  └── VENTE : à l'autocall ou maturité sans KI               │
│                                                               │
│  Le protocole est un HOLDER ACTIF de xStocks :               │
│  ├── Détient 25-100% du notionnel selon le delta             │
│  ├── Trade activement via 1inch                               │
│  ├── Crée de la demande d'achat et de la liquidité           │
│  └── Score xStocks Relevance : ★★★★★                        │
│                                                               │
│  xStocks spécifiques pour le hackathon MVP :                 │
│  ├── NVDAx (NVIDIA) — high vol (~40%), coupon attractif      │
│  ├── TSLAx (Tesla) — très high vol (~55%), coupon max        │
│  └── SPYx (S&P 500 ETF) — low vol (~15%), coupon modéré     │
└─────────────────────────────────────────────────────────────┘
```

### Ink (Kraken L2) — Roadmap post-hackathon

```
┌─────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT STRATEGY                        │
│                                                               │
│  HACKATHON : Ethereum (Sepolia testnet pour demo)            │
│  ├── xStocks ERC-20 tokens : ✓ disponibles sur Ethereum     │
│  ├── Chainlink Data Streams + CRE : ✓                        │
│  ├── Euler Finance : ✓                                       │
│  ├── 1inch Aggregation + Fusion : ✓                          │
│  ├── USDC : ✓                                                │
│  └── = TOUS les partners fonctionnels, demo end-to-end      │
│                                                               │
│  INK : Migration dès que les partners lancent                │
│  ├── Chainlink Data Streams : déjà sur Ink ✓                │
│  ├── CRE, Euler, 1inch : pas encore → migration planifiée   │
│  ├── Ink = OP Stack = migration triviale (même bytecode)     │
│  └── Pitch : "Live on Ethereum today, Ink-native tomorrow"  │
│                                                               │
│  Gas fees mainnet = argument pour Ink :                       │
│  "Le delta-hedging fréquent coûte cher sur L1.              │
│   Ink L2 réduit le gas de 100x, rendant le rebalancing      │
│   quasi-gratuit — c'est pour ça qu'on veut migrer sur Ink." │
└─────────────────────────────────────────────────────────────┘
```

---

## MEV & Front-running Protection

Le delta-hedging crée un risque MEV : quand CRE poste un nouveau delta onchain, les bots voient le swap arriver.

```
Risque :
  CRE poste delta = 0.45 (était 0.30) → le vault va acheter 15 NVDAx
  Bot front-runs : achète NVDAx avant le vault → prix monte
  Vault achète à un prix gonflé → slippage pour le pool

Solutions :
  1. 1inch Fusion : les swaps sont exécutés par des resolvers en compétition,
     MEV-protected par design
  2. Private mempool : soumettre les tx via Flashbots/MEV Blocker
  3. Batch rebalancing : regrouper les rebalancings de toutes les notes
     en une seule tx pour masquer l'intention individuelle
  4. Time-delayed execution : CRE poste le delta, mais le rebalance
     s'exécute après un délai aléatoire (1-30 min)
```

---

## Vision Long-terme

- **Phase 1** : xYield Notes (hackathon MVP — single autocall with delta-hedge)
- **Phase 2** : xRisk Market (full underwriting marketplace, multiple products, advanced Greeks)
- **Phase 3** : Structured products infrastructure on xStocks (reverse convertibles, range accruals, capital-protected notes, worst-of baskets)
