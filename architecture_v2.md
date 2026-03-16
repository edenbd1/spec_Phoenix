# xYield Protocol — Architecture v2

> Modèle 3 couches économiques. Le coupon vient de l'option pricing, pas du funding.
> Le funding rate est l'edge DeFi — pas la base économique.
> Institutionnellement crédible. Plus efficient qu'un desk bancaire.

---

## 1. Le problème de v1

Dans v1, le coupon (10-14%) était financé par le funding rate.

```
v1 : coupon = funding rate → FRAGILE
     Si funding rate baisse → on ne peut plus payer le coupon
     C'est un vault yield déguisé en autocall
```

**v2 sépare 3 couches économiques :**

```
v2 : coupon = OPTION PREMIUM  → SOLIDE (mathématique)
     carry  = FUNDING RATE    → BONUS (profit protocole)
     fees   = EMBEDDED + MGMT → GARANTI (infrastructure)
```

---

## 2. Les 3 couches

### Couche 1 — Option Premium Layer (le vrai autocall)

```
Le retail dépose $10,000
    → Il vend implicitement un worst-of put
    → Ce put a une VALEUR MATHÉMATIQUE

Monte Carlo pricing (notre v24, 120,960 configs) :
    KI 50%, CB 70%, worst-of 3 (NVDA/META/TSLA), 6mo
    → KI hit rate : 5-10% en régime normal
    → Expected loss given KI : ~40-50% du notional
    → Option premium ≈ 5-8% annualisé

DONC : coupon maximum payable = 5-8% ann
       (financé par la prime d'option, pas par le funding)

Quand KI arrive :
    → Retail perd (reçoit xStocks dépréciés)
    → Protocole gagne (capture le payoff du put)

Quand pas de KI :
    → Retail reçoit coupons + principal
    → Protocole a payé les coupons (= prix du put qu'il a acheté)

SUR 100 NOTES :
    → Coupons payés ≈ KI payoffs capturés (équilibre d'option)
    → La couche option est NEUTRE en espérance pour le protocole
```

**C'est exactement ce que fait Goldman Sachs.** Le coupon = la prime du put. C'est mathématique, pas dépendant d'un yield externe.

### Couche 2 — Carry Layer (l'edge DeFi)

```
Le protocole hedge l'autocall :
    → Long xStocks spot + Short xStocks perps sur Aster DEX
    → Position delta-neutre ✓

MAIS les shorts capturent le funding rate :
    → Bull market : 15-25% ann
    → Normal : 8-12% ann
    → Bear : 3-5% ann

CE FUNDING N'EST PAS UTILISÉ POUR LE COUPON.
C'est le PROFIT du protocole. L'edge DeFi.

Chez Goldman Sachs :
    hedge = options OTC + delta → COÛTE 1-4%
    carry = 0%

Chez xYield :
    hedge = spot + perps → COÛTE ~0%
    carry = funding rate → RAPPORTE 5-20%

DIFFÉRENTIEL vs GS : 6-24% par an
C'est ÉNORME. C'est l'avantage structurel de DeFi.
```

### Couche 3 — Fee Layer (infrastructure)

```
Fees prélevés par le protocole :

    Embedded fee :     1-2% par note (day 1)
    Origination fee :  0.3% par note
    Management fee :   0.5% ann sur AUM
    Performance fee :  20% sur le carry (funding rate)
    Auto-roll fee :    0.1% par roll

Ces fees sont GARANTIS. Pas de risque directionnel.
```

---

## 3. Le coupon : option pricing, pas funding

### Comment calculer le coupon

```
ÉTAPE 1 : Pricer le worst-of put via Monte Carlo

    Inputs :
    ├── Basket : NVDAx, METAx, TSLAx
    ├── Vols implicites : σ_NVDA=55%, σ_META=40%, σ_TSLA=60%
    ├── Corrélations : ρ ≈ 0.50-0.65
    ├── KI barrier : 50%
    ├── Coupon barrier : 70%
    ├── Autocall trigger : 100% (step-down 2%/obs)
    ├── Maturity : 6 mois
    └── Observations : mensuelles

    Output :
    └── Fair value du put ≈ 3.5-4.5% du notional sur 6mo
        = 7-9% annualisé

ÉTAPE 2 : Fixer le coupon SOUS la fair value

    Fair value put : ~8% ann
    Protocol spread : -1.5%
    → COUPON BASE : 6.5% ann

    C'est le coupon que le protocole peut payer
    SANS AUCUN funding rate, SANS aucun carry.
    Purement financé par l'économie de l'option.

ÉTAPE 3 (optionnel) : Coupon Enhancement via carry

    Si le protocole veut offrir un coupon plus attractif :
    → Base coupon (option) : 6.5%
    → Carry enhancement : +2-4% (partagé du funding rate)
    → COUPON TOTAL : 8.5-10.5% ann

    MAIS : le carry enhancement est CLAIREMENT SÉPARÉ
    et peut varier selon les conditions de marché.
```

### Le coupon selon le régime de marché

| Régime | Option premium | Carry enhance | Coupon total | vs GS (15.65%) |
|---|---|---|---|---|
| Bull (haute vol) | 8-10% | +3-5% | **11-15%** | Compétitif |
| Normal | 6-8% | +2-3% | **8-11%** | Moins mais honnête |
| Bear (basse vol) | 5-7% | +0-1% | **5-8%** | Plus bas mais réel |

**Transparence** : le retail voit clairement les deux composantes.

```
╔═══════════════════════════════════════════════════╗
║  xYield Note — NVDAx / METAx / TSLAx             ║
║                                                   ║
║  Base coupon (option premium) :    6.5% ann       ║
║  DeFi enhancement (carry) :      +3.0% ann *     ║
║  ─────────────────────────────────────────────    ║
║  Total coupon :                    9.5% ann       ║
║                                                   ║
║  * Le carry enhancement est variable et dépend    ║
║    des conditions du marché des perps.             ║
║                                                   ║
║  KI barrier : 50%  |  Maturity : 6 mois          ║
║  Settlement : Physical delivery en xStocks        ║
╚═══════════════════════════════════════════════════╝
```

---

## 4. Revenue model v2 — par note $10,000 / 6 mois

### Flux économiques

```
RETAIL DÉPOSE $10,000
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  LAYER 1 : OPTION PREMIUM                                   │
│  ─────────────────────────                                  │
│  Fair value put ≈ $400 (8% ann × 6mo × $10k)               │
│  Coupon payé au retail : $325 (6.5% ann × 6mo)             │
│  Protocol edge sur option : $75                             │
│                                                             │
│  En cas de KI (5-10% des notes) :                           │
│    Protocole capture ~$3,000-5,000 (put payoff)             │
│    Compense les coupons payés sur les autres notes          │
│                                                             │
│  NET OPTION LAYER sur 100 notes :                           │
│    Coupons payés : ~$32,500                                 │
│    KI payoffs : ~$28,000-35,000                             │
│    Net : ~$0 à +$2,500 (protocole légèrement positif)       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  LAYER 2 : CARRY (FUNDING RATE)                             │
│  ──────────────────────────────                             │
│  Hedge : long $10k xStocks + short $10k perps Aster        │
│  Funding rate capture (6 mois) :                            │
│                                                             │
│    Bull : $10k × 18% × 0.5 = $900                          │
│    Normal : $10k × 10% × 0.5 = $500                        │
│    Bear : $10k × 4% × 0.5 = $200                           │
│                                                             │
│  Carry enhancement versé au retail :                        │
│    ~$150-250 (portion du carry partagée via coupon)         │
│                                                             │
│  Carry brut protocole (après partage) :                     │
│    Bull : $650-750                                          │
│    Normal : $250-350                                        │
│    Bear : $0-50                                             │
│                                                             │
│  Performance fee (20% du carry brut protocole) :            │
│    Bull : $130-150                                          │
│    Normal : $50-70                                          │
│    Bear : $0-10                                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  LAYER 3 : FEES                                             │
│  ──────────                                                 │
│  Embedded fee (1.5%) : $150                                 │
│  Origination (0.3%) : $30                                   │
│  Management (0.5% ann × 6mo) : $25                          │
│  Auto-roll (0.1%) : $10                                     │
│  Total fees : $215                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘

TOTAL PROTOCOL REVENUE PAR NOTE ($10k / 6mo) :
═══════════════════════════════════════════════

                        Bull      Normal     Bear
Option edge :           $75       $75        $75
Carry (net protocole) : $650      $250       $0
Perf fee sur carry :    $150      $70        $10
Fees fixes :            $215      $215       $215
────────────────────────────────────────────────
TOTAL :                 $1,090    $610       $300
Annualisé :             21.8%     12.2%      6.0%
```

### Comparaison vs Goldman Sachs

| Métrique | Goldman Sachs | xYield v2 |
|---|---|---|
| Source du coupon | Option premium | Option premium (identique) |
| Coupon level | 15.65% | 6.5-10.5% (honnête) |
| Hedge cost | -1 à -4% | **+5 à +20%** (carry) |
| Embedded fee | 3-7% | 1.5% |
| Protocol profit / note | ~$300-700 | **$300-1,090** |
| Risque option | Hedgé (gamma, vega) | Hedgé (delta-neutre) |
| Carry income | $0 | **$200-900** |
| Coupon sustainability | Toujours (maths) | Toujours (maths + carry bonus) |

**Notre coupon est plus bas mais honnête.** Et le protocole gagne PLUS que GS grâce au carry.

---

## 5. Architecture technique v2

### Smart Contracts — Structure

```
contracts/
├── core/
│   ├── XYieldVault.sol          ← ERC-4626, deposit/withdraw USDC
│   ├── AutocallEngine.sol       ← Phoenix logic + OPTION PRICER intégré
│   ├── NoteToken.sol            ← ERC-1155
│   └── HedgeManager.sol         ← Spot+perps delta hedge
│
├── pricing/
│   ├── OptionPricer.sol         ← MC-based worst-of put pricing (NEW)
│   ├── VolOracle.sol            ← Implied vol feed pour pricing (NEW)
│   └── CouponCalculator.sol     ← Base coupon + carry enhancement (NEW)
│
├── carry/
│   ├── CarryEngine.sol          ← Funding rate arb (PiggyBank strat) (RENAMED)
│   ├── EulerStrategy.sol        ← USDC lending on Euler
│   └── CarryRouter.sol          ← Allocate between carry strategies (RENAMED)
│
├── integrations/
│   ├── AsterAdapter.sol         ← Aster DEX perps interface
│   ├── ChainlinkPriceFeed.sol   ← Data Streams for xStocks
│   ├── ChainlinkKeeper.sol      ← Automation for all triggers
│   ├── OneInchSwapper.sol       ← 1inch for spot trades
│   └── ERC7579AutoRoll.sol      ← Smart account auto-roll
│
└── periphery/
    ├── NoteFactory.sol          ← Create new note series
    ├── EpochManager.sol         ← 48h epochs (NAV, rebalance)
    ├── ReserveFund.sol          ← Buffer pour coupon smoothing (NEW)
    └── FeeCollector.sol         ← Fee collection + distribution
```

### Nouveau module : OptionPricer.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice On-chain option pricing for worst-of autocall
/// Uses simplified analytical model (not full MC — too expensive on-chain)
/// Full MC runs off-chain, result is verified on-chain via Chainlink
contract OptionPricer {

    IChainlinkFeed public priceFeed;
    IVolOracle public volOracle;

    struct PricingParams {
        address[] basket;        // [NVDAx, METAx, TSLAx]
        uint256 kiBarrier;       // 5000 = 50%
        uint256 couponBarrier;   // 7000 = 70%
        uint256 maturityDays;    // 180
        uint256 numObservations; // 6
    }

    struct PricingResult {
        uint256 putPremium;      // basis points annualized (e.g., 750 = 7.5%)
        uint256 baseCoupon;      // premium - protocol spread
        uint256 kiProbability;   // basis points (e.g., 800 = 8%)
        uint256 expectedKILoss;  // basis points of notional
        uint256 timestamp;
    }

    /// @notice Calculate the fair option premium for a worst-of autocall
    /// @dev Uses analytical approximation on-chain
    ///      Full MC verification available off-chain via Chainlink Functions
    function priceNote(PricingParams calldata params)
        external view returns (PricingResult memory)
    {
        // Get current vols from VolOracle
        uint256[] memory vols = new uint256[](params.basket.length);
        for (uint i = 0; i < params.basket.length; i++) {
            vols[i] = volOracle.getImpliedVol(params.basket[i]);
        }

        // Get correlations
        uint256 avgCorrelation = volOracle.getAvgCorrelation(params.basket);

        // Analytical worst-of put approximation:
        // Premium increases with: vol, number of assets, lower KI, lower correlation
        // P ≈ Σ(individual_put_i) + correlation_adjustment + worst-of_multiplier

        uint256 avgVol = _average(vols);
        uint256 timeToMaturity = (params.maturityDays * 1e18) / 365;

        // Simplified Margrabe-style approximation
        // For worst-of: premium ≈ single_put × sqrt(n) × (1 - ρ/2)
        uint256 singlePutPremium = _bsApproxPut(
            avgVol, params.kiBarrier, timeToMaturity
        );

        uint256 worstOfMultiplier = _sqrt(params.basket.length * 1e18);
        uint256 corrAdj = 1e18 - (avgCorrelation / 2);

        uint256 putPremium = (singlePutPremium * worstOfMultiplier * corrAdj)
            / 1e36;

        // Annualize
        uint256 annualizedPremium = (putPremium * 365 * 1e4)
            / (params.maturityDays * 1e18);

        // Protocol spread (150 bps)
        uint256 protocolSpread = 150;
        uint256 baseCoupon = annualizedPremium > protocolSpread
            ? annualizedPremium - protocolSpread
            : 0;

        // KI probability estimate
        uint256 kiProb = _estimateKIProbability(
            vols, avgCorrelation, params.kiBarrier, timeToMaturity
        );

        return PricingResult({
            putPremium: annualizedPremium,
            baseCoupon: baseCoupon,
            kiProbability: kiProb,
            expectedKILoss: (kiProb * 4500) / 10000, // avg 45% loss given KI
            timestamp: block.timestamp
        });
    }

    // ... internal math functions
}
```

### Nouveau module : CouponCalculator.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Calculates total coupon = base (option) + enhancement (carry)
contract CouponCalculator {

    IOptionPricer public pricer;
    ICarryEngine public carryEngine;

    uint256 public constant MAX_CARRY_SHARE = 5000; // 50% of carry to retail max

    struct CouponBreakdown {
        uint256 baseCoupon;        // from option premium (bps ann)
        uint256 carryEnhancement;  // from funding rate (bps ann)
        uint256 totalCoupon;       // base + enhancement
        uint256 protocolCarry;     // carry kept by protocol
    }

    /// @notice Calculate coupon for a new note
    function calculateCoupon(
        IOptionPricer.PricingParams calldata params
    ) external view returns (CouponBreakdown memory) {

        // Step 1: Get base coupon from option pricing
        IOptionPricer.PricingResult memory pricing = pricer.priceNote(params);
        uint256 baseCoupon = pricing.baseCoupon;

        // Step 2: Get current carry rate
        uint256 currentCarryRate = carryEngine.getCurrentAnnualizedRate();

        // Step 3: Calculate carry enhancement
        // Share up to 30% of carry with retail as coupon enhancement
        // Only if carry is positive and above threshold
        uint256 carryEnhancement = 0;
        uint256 carryShareRate = 3000; // 30% of carry to retail

        if (currentCarryRate > 300) { // only if carry > 3% ann
            carryEnhancement = (currentCarryRate * carryShareRate) / 10000;
        }

        uint256 totalCoupon = baseCoupon + carryEnhancement;
        uint256 protocolCarry = currentCarryRate - carryEnhancement;

        return CouponBreakdown({
            baseCoupon: baseCoupon,
            carryEnhancement: carryEnhancement,
            totalCoupon: totalCoupon,
            protocolCarry: protocolCarry
        });
    }
}
```

### Nouveau module : ReserveFund.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Reserve fund for coupon smoothing (like Ethena's reserve)
/// Accumulates surplus in bull markets, covers deficits in bear markets
contract ReserveFund {

    IERC20 public usdc;

    uint256 public reserveBalance;
    uint256 public targetReserve;    // target = 10% of total notional
    uint256 public minReserve;       // minimum = 3% of total notional

    /// @notice Deposit surplus carry into reserve
    function depositSurplus(uint256 amount) external {
        usdc.transferFrom(msg.sender, address(this), amount);
        reserveBalance += amount;
    }

    /// @notice Withdraw from reserve to cover coupon deficit
    function coverDeficit(uint256 amount) external returns (uint256 covered) {
        covered = amount > reserveBalance ? reserveBalance : amount;
        if (covered > 0) {
            reserveBalance -= covered;
            usdc.transfer(msg.sender, covered);
        }
    }

    /// @notice Check if reserve is healthy
    function isHealthy() external view returns (bool) {
        return reserveBalance >= minReserve;
    }

    /// @notice If reserve is below minimum, reduce carry enhancement
    function getMaxCarryShare() external view returns (uint256) {
        if (reserveBalance >= targetReserve) return 5000; // 50%
        if (reserveBalance >= minReserve) return 3000;     // 30%
        return 0; // no carry sharing — base coupon only
    }
}
```

---

## 6. Euler EVK + Aster DEX (inchangé vs v1)

L'intégration technique avec Euler et Aster reste identique à v1.
La différence est **économique** : ce que le protocole fait avec le yield.

```
v1 : funding rate → finance le coupon (fragile)
v2 : funding rate → profit protocole + carry enhancement (solide)
```

### Euler Finance
- USDC lending vault (safe yield 3-5%)
- xStocks collateral via EVK (permissionless vaults)
- Factory : 0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e

### Aster DEX
- Stock perps on-chain (NVDA, TSLA, META, AAPL, AMZN, GOOGL, MSFT)
- Ethereum : 0x604DD02d620633Ae427888d41bfd15e38483736E
- Arbitrum : 0x9E36CB86a159d479cEd94Fa05036f235Ac40E1d5
- Funding rate toutes les 8h
- 0% fees sur NVDA/TSLA (promo)

---

## 7. Le rôle du protocole (clarifié)

```
Le protocole est 3 choses :

1. ISSUER
   → Crée les notes autocall
   → Fixe les paramètres (basket, KI, maturity)
   → Calcule le coupon via option pricing
   → Émet les NoteTokens (ERC-1155)

2. HEDGING DESK
   → Prend le côté "banque" de l'autocall
   → Hedge en delta-neutre (spot + short perps)
   → Gère le risque (rebalancing, circuit breakers)
   → Absorbe les KI events (capture le put payoff)

3. CARRY ENGINE
   → Capture le funding rate sur le hedge
   → Déploie l'idle USDC sur Euler
   → Distribue : carry share au retail (coupon enhancement)
                  + carry au protocole (profit)
                  + surplus au reserve fund
```

---

## 8. Scénario worst-case : marché flat + funding bas

```
Le seul scénario dangereux :

Marché flat (pas de KI events = pas de put payoff)
+ Funding rate bas (~3%)
+ Vol basse (option premium réduit)

Dans ce cas :
├── Base coupon (option) : 5% ann
├── Carry enhancement : 0% (funding trop bas)
├── Total coupon : 5%
├── Carry protocole : 3% - 0% = 3%
├── Fees : 1.5%
├── TOTAL protocol : 4.5%
└── PAS DE PERTE — juste des revenus réduits

POURQUOI ÇA TIENT :
Le coupon est financé par l'option economics (pas le funding).
Même à 0% de funding, le coupon de 5% est soutenable
car les KI events (quand ils arrivent) compensent les coupons payés.

C'EST LA DIFFÉRENCE CLEF AVEC V1 :
v1 : funding = 0% → coupon insoutenable → bullshit
v2 : funding = 0% → coupon réduit mais soutenable → réel
```

---

## 9. Pitch v2 — institutionnellement crédible

### Le problème
> $125 milliards d'autocalls émis chaque année. Goldman Sachs prend 3-7% de fees
> et le hedge coûte 1-4%. Le retail paie pour l'infrastructure bancaire.

### La solution
> xYield brings institutional autocallable notes on-chain.
> The coupon is funded by the same option premium used in TradFi structured products.
> The difference is that the hedge generates additional yield through perpetual funding markets,
> making the structure more efficient than traditional desks.

### Les chiffres

| | Goldman Sachs | xYield |
|---|---|---|
| Coupon source | Option premium | Option premium (**identique**) |
| Hedge cost | -1 à -4% | **+5 à +20%** (carry) |
| Fees | 3-7% | **1.5%** |
| Protocol margin | ~3-5% | **6-22%** (carry + fees) |
| Coupon | 15.65% | 6.5-10.5% (**honnête**) |
| Settlement | Cash (perte sèche) | Physical delivery (xStocks) |

### L'edge DeFi expliqué en 1 phrase
> "Same product, same option pricing, but the hedge itself generates yield
> through perpetual funding markets — something Goldman Sachs cannot replicate."

---

## 10. Ce qui change vs v1

| Aspect | v1 (bullshit risk) | v2 (institutionnel) |
|---|---|---|
| Source du coupon | Funding rate | **Option premium** |
| Rôle du funding | Finance le coupon | **Profit protocole** |
| Coupon level | 10-14% (arbitraire) | **6.5-10.5% (calculé)** |
| Si funding = 0% | Coupon insoutenable | **Coupon maintenu (option economics)** |
| Pricing | Pas de pricer | **OptionPricer.sol on-chain** |
| Transparence | Coupon = boîte noire | **Base + enhancement séparés** |
| Credibilité | "Vault yield déguisé" | **"Real autocall + DeFi carry"** |
| Reserve fund | Non | **Oui (coupon smoothing)** |

---

## 11. Hackathon — Ce qui impressionne le jury

```
1. OPTION PRICER ON-CHAIN
   → Première fois qu'un protocole DeFi price un autocall on-chain
   → Chainlink vol oracle + analytical approximation
   → Le coupon est CALCULÉ, pas inventé

2. 3 COUCHES SÉPARÉES ET TRANSPARENTES
   → Option layer, Carry layer, Fee layer
   → Le retail voit exactement d'où vient son coupon
   → Institutionnellement crédible

3. CARRY ENGINE = L'EDGE
   → "The hedge generates yield" — aucun desk TradFi ne peut dire ça
   → PiggyBank strategy intégrée dans un produit structuré
   → Différentiel de 6-24% vs GS sur le hedge

4. COMPARAISON DIRECTE AVEC GS
   → Même produit, même pricing, meilleure économie
   → Dashboard qui montre : "GS takes 5%, we take 1.5%"
   → "GS hedge costs 3%, ours earns 10%"
```

---

## 12. Timeline hackathon (mise à jour v2)

| Jour | Task |
|---|---|
| 17-19 mars | OptionPricer.sol + CouponCalculator.sol + VolOracle.sol |
| 20-22 mars | XYieldVault.sol + AutocallEngine.sol (avec pricing intégré) |
| 23-25 mars | HedgeManager.sol + CarryEngine.sol + AsterAdapter.sol |
| 26-28 mars | ReserveFund.sol + integration tests (fork Arbitrum) |
| 29-30 mars | Frontend + deploy testnet |
| 31 mars-2 avril | **HACKATHON CANNES** |

---

*Architecture v2 — 17 mars 2026. Modèle 3 couches économiques.
Coupon = option pricing. Carry = profit protocole. Fees = infrastructure.
Institutionnellement crédible. Plus efficient qu'un desk bancaire.*
