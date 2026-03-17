# xYield — Flow On-Chain v2 (3 Couches)

> Chaque transaction est taggée avec sa couche économique :
> 🟢 OPTION = option premium layer
> 🔵 CARRY = funding rate carry layer
> 🟡 FEE = fee layer

---

## Le protocole = la banque (3 rôles)

```
Le protocole est :

    ISSUER          → crée les notes, price l'option, émet les tokens
    HEDGING DESK    → hedge delta-neutre, gère le risque, absorbe les KI
    CARRY ENGINE    → capture le funding rate, l'edge DeFi vs Goldman Sachs
```

Pas d'underwriter externe. Le protocole prend les 3 rôles.
C'est cohérent parce que le coupon vient de l'option pricing (pas du funding).

---

## ÉTAPE 1 : Dépôt USDC

```
Retail (wallet)
    │
    │  TX 1: USDC.approve(XYieldVault, 10000e6)
    │  TX 2: XYieldVault.deposit(10000e6, myAddress)
    │
    ▼
┌──────────────────────────────────────────────────┐
│  XYieldVault.sol (ERC-4626)                      │
│                                                  │
│  • Mint xyUSDC shares au retail                  │
│                                                  │
│  🟡 FEE : Origination 0.3% ($30) → FeeCollector │
│                                                  │
│  • Capital split :                               │
│    ├── 🟢 $9,500 → AutocallEngine (note creation)│
│    │        dont $150 embedded fee 🟡            │
│    └── 🔵 $500 → CarryEngine (Euler lending)     │
│         (idle capital productif en attendant)     │
└──────────────────────────────────────────────────┘
```

---

## ÉTAPE 2 : Pricing de l'option (NOUVEAU en v2)

**Avant de créer la note, le protocole CALCULE le coupon.**

```
AutocallEngine.createNote()
    │
    │  🟢 OPTION PRICING
    │
    │  TX interne : OptionPricer.priceNote({
    │      basket: [NVDAx, METAx, TSLAx],
    │      kiBarrier: 50%,
    │      couponBarrier: 70%,
    │      maturity: 180 days,
    │      observations: 6
    │  })
    │
    │  Le pricer récupère :
    │  ├── Chainlink Data Streams → prix spot des 3 xStocks
    │  ├── VolOracle → vols implicites (σ_NVDA=55%, σ_META=40%, σ_TSLA=60%)
    │  └── VolOracle → corrélation moyenne (ρ ≈ 0.55)
    │
    │  Calcul analytique (approximation worst-of put) :
    │  ├── Single put premium : ~4.2% (6mo)
    │  ├── Worst-of multiplier : ×1.73 (√3)
    │  ├── Correlation adjustment : ×0.725 (1 - ρ/2)
    │  └── Autocall/coupon barrier adjustment : ×0.85
    │
    │  RÉSULTAT :
    │  ├── Put premium = 4.5% sur 6mo = 9% annualisé
    │  ├── Protocol spread = -1.5%
    │  └── BASE COUPON = 7.5% annualisé
    │
    │  🔵 CARRY ENHANCEMENT
    │
    │  TX interne : CouponCalculator.calculateCoupon()
    │  ├── Current funding rate (Aster) = 12% annualisé
    │  ├── Carry share to retail = 30% × 12% = 3.6%
    │  ├── Mais cappé à 3% max
    │  └── CARRY ENHANCEMENT = 3%
    │
    │  COUPON TOTAL = 7.5% (option) + 3% (carry) = 10.5% ann
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  CE QUE LE RETAIL VOIT :                             │
│                                                      │
│  "xYield Note — NVDAx / METAx / TSLAx"              │
│                                                      │
│  Base coupon (option premium) :    7.5% ann          │
│  DeFi enhancement (carry) :      +3.0% ann *        │
│  ──────────────────────────────────────              │
│  Total coupon :                   10.5% ann          │
│  = 0.875% par mois                                   │
│                                                      │
│  * Variable, dépend des conditions de marché         │
│                                                      │
│  TRANSPARENT. PAS DE BOÎTE NOIRE.                    │
│  Le retail sait exactement d'où vient son coupon.    │
└──────────────────────────────────────────────────────┘
```

---

## ÉTAPE 3 : Création de la note

```
AutocallEngine.createNote(pricingResult, params)
    │
    │  🟢 OPTION : Graver les paramètres on-chain
    │  ├── basket: [NVDAx, METAx, TSLAx]
    │  ├── strikes: [$150, $600, $350] (prix spot jour J)
    │  ├── baseCoupon: 7.5% ann (FROM OPTION PRICING)
    │  ├── carryEnhancement: 3.0% ann (FROM CARRY ENGINE)
    │  ├── couponBarrier: 70%
    │  ├── autocallTrigger: 100% (step-down 2%/obs)
    │  ├── kiBarrier: 50% (European)
    │  ├── maturity: block.timestamp + 180 days
    │  └── notional: $10,000
    │
    │  TX 1: NoteToken.mint(retail, noteId, 1)
    │        → ERC-1155 dans le wallet du retail
    │
    │  🟡 FEE : Embedded fee 1.5% ($150) → FeeCollector
    │
    │  TX 2: Enregistre 6 observations mensuelles
    │  TX 3: Chainlink Automation registration
    │
    ▼
Le retail détient un NoteToken.
Les paramètres (dont le coupon CALCULÉ) sont immuables on-chain.
```

---

## ÉTAPE 4 : Le hedge s'ouvre (delta-neutre + carry)

```
HedgeManager.openHedge(noteId, $10,000)
    │
    │  🟢 OPTION : Delta hedge (le protocole = la banque)
    │
    │  TX 1-3 : Acheter $10,000 xStocks via 1inch
    │  ├── 1inch.swap(USDC → NVDAx, $3,333)
    │  ├── 1inch.swap(USDC → METAx, $3,333)
    │  └── 1inch.swap(USDC → TSLAx, $3,334)
    │
    │  TX 4-6 : Collat xStocks sur Euler EVK
    │  ├── EulerVault.deposit(NVDAx)
    │  ├── EulerVault.deposit(METAx)
    │  └── EulerVault.deposit(TSLAx)
    │
    │  TX 7 : EulerVault.borrow(USDC, $5,000) → marge Aster
    │
    │  TX 8-10 : Short perps sur Aster DEX
    │  ├── Aster.openShort(NVDAx, $3,333)
    │  ├── Aster.openShort(METAx, $3,333)
    │  └── Aster.openShort(TSLAx, $3,334)
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  RÉSULTAT :                                          │
│                                                      │
│  🟢 DELTA HEDGE VALIDE :                             │
│     Long $10k xStocks + Short $10k perps = delta 0   │
│     Le protocole est couvert contre le risque direc.  │
│                                                      │
│  🔵 CARRY ENGINE ACTIVÉ :                            │
│     Les shorts sur Aster capturent le funding rate    │
│     ~0.01-0.03% par 8h = 8-20% annualisé            │
│                                                      │
│     CE CARRY N'EST PAS le coupon.                     │
│     C'est le PROFIT du protocole.                     │
│     (une petite partie = carry enhancement au retail) │
│                                                      │
│  CHEZ GOLDMAN SACHS :                                │
│     Ce hedge COÛTE 1-4%                              │
│     Gamma hedging, bid-ask spreads, financing         │
│                                                      │
│  CHEZ XYIELD :                                       │
│     Ce hedge RAPPORTE 5-20% (carry)                  │
│     Même hedge, mais avec un profit engine intégré    │
│                                                      │
│  C'est l'avantage structurel. C'est réel.            │
│  Mais ce n'est PAS ce qui finance le coupon.          │
│  Le coupon vient de l'option premium (couche 1).      │
└──────────────────────────────────────────────────────┘
```

---

## ÉTAPE 5 : Vie de la note — 3 layers en parallèle

### Toutes les 8h : Carry collection 🔵

```
ChainlinkKeeper.performUpkeep()
    │
    │  🔵 CARRY : Collect funding
    │
    │  CarryEngine.collectFunding()
    │  ├── Aster.claimFunding(NVDAx) → +$5
    │  ├── Aster.claimFunding(METAx) → +$3
    │  └── Aster.claimFunding(TSLAx) → +$7
    │
    │  Total : +$15 / 8h = ~$45/jour
    │
    │  Distribution :
    │  ├── 30% → ReserveFund (coupon smoothing buffer)
    │  ├── 50% → Protocol treasury (profit)
    │  └── 20% → Performance fee 🟡
    │
    │  ⚠️ CE FUNDING NE VA PAS AU RETAIL DIRECTEMENT.
    │  Le retail reçoit son coupon de la couche option.
    │  Le carry enhancement est fixé à la création de la note.
```

### Tous les mois : Observation autocall 🟢

```
ChainlinkKeeper.performUpkeep()
    │
    │  🟢 OPTION : Observation mensuelle
    │
    │  AutocallEngine.observe(noteId)
    │
    │  1. Chainlink Data Streams → prix
    │     NVDAx = $135 (90%), METAx = $660 (110%), TSLAx = $280 (80%)
    │
    │  2. worst = min(90%, 110%, 80%) = TSLAx à 80%
    │
    │  3. CHECK COUPON :
    │     worst (80%) ≥ coupon barrier (70%) ? OUI ✅
    │
    │     🟢 Coupon base : $10,000 × 7.5% / 12 = $62.50
    │     🔵 Carry enhancement : $10,000 × 3.0% / 12 = $25.00
    │     TOTAL coupon ce mois : $87.50 → transfer au retail
    │
    │     D'OÙ VIENT L'ARGENT :
    │     ├── $62.50 = option economics (le "prix du put")
    │     │   → viable même à 0% de funding rate
    │     │   → car les KI events compensent sur d'autres notes
    │     │
    │     └── $25.00 = carry enhancement
    │         → financé par le funding rate collecté
    │         → si funding rate tombe à 0, cette partie s'arrête
    │         → mais le base coupon continue
    │
    │  4. CHECK AUTOCALL :
    │     worst (80%) ≥ autocall trigger (98%) ? NON
    │     → Note continue
```

### Toutes les 48h : Epoch 🔵🟡

```
EpochManager.processEpoch()
    │
    │  🔵 NAV Snapshot
    │  ├── Euler lending yield accumulé
    │  ├── Carry (funding) collecté
    │  ├── Positions delta-neutre vérifiées
    │  └── Share price xyUSDC mis à jour
    │
    │  🔵 Rebalancing
    │  ├── Delta drift > 5% ? → rebalance perps
    │  ├── Funding rate négatif > 24h ? → reduce carry exposure
    │  └── Reserve fund check → adjust carry share si nécessaire
    │
    │  🟡 Fee distribution
    │  ├── Management fee (0.5% ann) accrued
    │  └── Performance fee (20% carry) distributed
```

---

## ÉTAPE 6a : AUTOCALL (75-85% des cas)

Mois 3, worst stock au-dessus du trigger :

```
AutocallEngine.observe(noteId)
    │
    │  NVDAx = 105%, METAx = 112%, TSLAx = 98%
    │  worst = 98%
    │  trigger = 100% - (3 × 2%) = 94%
    │  98% ≥ 94% → AUTOCALL ✅
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  🟢 OPTION SETTLEMENT :                             │
│                                                      │
│  TX 1 : Fermer le hedge                              │
│  ├── Aster.closeShort(NVDAx, METAx, TSLAx)          │
│  ├── EulerVault.repay(USDC borrowed)                 │
│  └── EulerVault.withdraw(xStocks) → 1inch → USDC    │
│                                                      │
│  TX 2 : Payer le retail                              │
│  ├── $10,000 principal                               │
│  ├── + $262.50 coupons (3 × $87.50)                 │
│  └── = $10,262.50 USDC → retail                     │
│                                                      │
│  TX 3 : NoteToken.burn(noteId)                       │
│                                                      │
│  TX 4 : Auto-roll proposé (ERC-7579)                 │
│                                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  BILAN DES 3 COUCHES (3 mois, cette note) :          │
│                                                      │
│  🟢 OPTION LAYER :                                   │
│  ├── Coupons payés : -$262.50                        │
│  ├── Pas de KI → pas de payoff capturé               │
│  ├── Net option : -$262.50                           │
│  └── (compensé par les KI d'autres notes)            │
│                                                      │
│  🔵 CARRY LAYER :                                    │
│  ├── Funding rate 3 mois : +$250 (10% ann × $10k)   │
│  ├── Euler lending 3 mois : +$25                     │
│  ├── Carry enhancement payé au retail : -$75         │
│  ├── → ReserveFund : +$60                            │
│  └── Net carry protocole : +$140                     │
│                                                      │
│  🟡 FEE LAYER :                                      │
│  ├── Embedded fee : +$150                            │
│  ├── Origination : +$30                              │
│  ├── Management (3 mois) : +$12.50                   │
│  ├── Performance fee (20% × $140) : +$28             │
│  └── Net fees : +$220.50                             │
│                                                      │
│  ═══════════════════════════════════════════════════  │
│                                                      │
│  TOTAL PROTOCOLE CETTE NOTE :                        │
│  Option : -$262.50                                   │
│  Carry : +$140                                       │
│  Fees : +$220.50                                     │
│  NET : +$98                                          │
│                                                      │
│  "Mais le protocole perd sur l'option ?"              │
│  Oui, sur CETTE note. Mais sur 100 notes :           │
│  ~8 auront un KI → protocole capture ~$4,000 chacune │
│  8 × $4,000 = $32,000 de KI payoffs                 │
│  92 × $262.50 = $24,150 de coupons payés            │
│  Net option sur 100 notes : +$7,850                  │
│                                                      │
│  L'OPTION LAYER EST POSITIVE EN ESPÉRANCE.           │
│  C'est les MATHS. Pas du bullshit.                   │
└──────────────────────────────────────────────────────┘
```

---

## ÉTAPE 6b : KI EVENT (5-10% des cas)

```
AutocallEngine.observe(noteId)  // maturité
    │
    │  NVDAx = 75%, METAx = 85%, TSLAx = 42%
    │  worst = TSLAx à 42% < KI 50% → KI TOUCHÉ ❌
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  🟢 OPTION SETTLEMENT — KI EVENT :                   │
│                                                      │
│  1. Physical delivery :                              │
│     $10,000 / $150 (strike) = 66.67 TSLAx           │
│     66.67 TSLAx × $63 (current) = $4,200            │
│     → Retail reçoit $4,200 en xStocks               │
│     → Retail perd $5,800                             │
│                                                      │
│  2. Le protocole capture le put payoff :             │
│     ├── Avait $10k de xStocks (maintenant $4,200)    │
│     ├── Short perp gain : +$5,800                    │
│     ├── Livre xStocks ($4,200) au retail             │
│     ├── Garde perp gain ($5,800)                     │
│     └── NET option capture : +$5,800                 │
│                                                      │
│     MOINS coupons payés pendant 6 mois :             │
│     -$525 (6 × $87.50)                              │
│                                                      │
│     NET OPTION cette note : +$5,275                  │
│                                                      │
│  C'EST LE PUT PAYOFF.                                │
│  Le retail a vendu un put.                           │
│  Le put a été exercé.                                │
│  Le protocole (= la banque) capture le payoff.       │
│  C'EST EXACTEMENT CE QUE FAIT GOLDMAN SACHS.         │
│                                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  🔵 CARRY : toujours capturé pendant 6 mois         │
│  ├── Funding rate 6 mois : +$500                     │
│  ├── Carry enhancement payé : -$150                  │
│  └── Net carry : +$350                               │
│                                                      │
│  🟡 FEES : toujours prélevés                         │
│  ├── Embedded + origination + management : +$205     │
│  └── Performance fee : +$70                          │
│                                                      │
│  TOTAL PROTOCOLE CETTE NOTE (KI) :                   │
│  Option : +$5,275                                    │
│  Carry : +$350                                       │
│  Fees : +$275                                        │
│  NET : +$5,900 🎯                                    │
│                                                      │
│  Le KI event est TRÈS profitable pour le protocole.  │
│  C'est le put payoff. C'est le rôle de la banque.    │
└──────────────────────────────────────────────────────┘
```

---

## BILAN SUR 100 NOTES — L'équilibre des 3 couches

```
100 notes de $10,000 / 6 mois = $1M de notional

HYPOTHÈSE : marché normal, funding ~10%, 8 KI events

🟢 OPTION LAYER :
├── 92 notes sans KI : 92 × -$262.50 = -$24,150 (coupons payés)
├── 8 notes avec KI : 8 × +$5,275 = +$42,200 (put payoffs)
└── NET OPTION : +$18,050

🔵 CARRY LAYER :
├── Funding rate 6 mois sur $1M : +$50,000
├── Carry enhancement payé au retail : -$15,000
├── Reserve fund : -$10,000
└── NET CARRY PROTOCOLE : +$25,000

🟡 FEE LAYER :
├── Embedded fees : +$15,000
├── Origination : +$3,000
├── Management : +$2,500
├── Performance : +$5,000
└── NET FEES : +$25,500

═══════════════════════════════════════════════
TOTAL PROTOCOLE SUR $1M / 6 MOIS :

  Option :  +$18,050
  Carry :   +$25,000
  Fees :    +$25,500
  ──────────────────
  TOTAL :   +$68,550

  = 13.7% annualisé sur $1M de TVL

  Dont :
  ├── 26% vient de l'option layer (les maths)
  ├── 37% vient du carry (l'edge DeFi)
  └── 37% vient des fees (l'infrastructure)

  DIVERSIFIÉ. PAS DÉPENDANT D'UNE SEULE SOURCE.
═══════════════════════════════════════════════

SCALING :
├── $10M TVL → $685,500 / 6 mois = $1.37M / an
├── $100M TVL → $13.7M / an
└── $1B TVL → $137M / an
```

---

## VUE D'ENSEMBLE — Schéma final v2

```
     RETAIL                              PROTOCOLE                        EXTERNAL
     ──────                              ────────                         ────────

Dépose $10,000 ────→ XYieldVault
                         │
                         ▼
                 🟢 OptionPricer ────→ VolOracle (Chainlink)
                    "put premium = 9%"
                    "base coupon = 7.5%"
                         │
                 🔵 CouponCalculator
                    "carry enhance = +3%"
                    "total coupon = 10.5%"
                         │
                         ▼
                 AutocallEngine ──────→ Chainlink (Data Streams)
                 NoteToken minted       Chainlink (Automation)
                         │
                         ▼
                 HedgeManager ────────→ 1inch (buy xStocks)
                 🟢 delta hedge         Euler EVK (collateral)
                 🔵 carry capture       Aster DEX (short perps)
                         │                   │
                         │              Funding rate $$$
                         │              toutes les 8h 🔵
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         AUTOCALL      COUPON     KI EVENT
         (75-85%)    (mensuel)    (5-10%)
              │          │          │
         Principal   🟢 base    Physical
         + coupons   🔵 enhance  delivery
         → retail    → retail    xStocks
                                 → retail

    PROTOCOLE REVENUE :
    ┌────────────────────────────────────────────┐
    │ 🟢 Option : +$18k / $1M / 6mo (KI payoffs)│
    │ 🔵 Carry :  +$25k / $1M / 6mo (funding)   │
    │ 🟡 Fees :   +$25k / $1M / 6mo (guaranteed)│
    │ TOTAL :     +$68k / $1M / 6mo = 13.7% ann │
    └────────────────────────────────────────────┘


    PITCH :
    ╔════════════════════════════════════════════════════════╗
    ║  "Same autocall Goldman Sachs sells.                  ║
    ║   Same option pricing.                                ║
    ║   But the hedge generates yield through               ║
    ║   perpetual funding markets.                          ║
    ║                                                       ║
    ║   GS hedge costs 1-4%.                                ║
    ║   Ours earns 5-20%.                                   ║
    ║                                                       ║
    ║   Real autocall. Enhanced with DeFi carry."           ║
    ╚════════════════════════════════════════════════════════╝
```

---

## CE QUI CHANGE POUR LE RETAIL (vs v1)

| | v1 | v2 |
|---|---|---|
| Coupon affiché | "12% fixe" | "7.5% base + 3% carry enhancement" |
| D'où vient le coupon | "Trust me bro" | **Option pricing on-chain** |
| Si funding rate = 0 | Coupon insoutenable | Base coupon maintenu (7.5%) |
| Si funding rate = 20% | Coupon 12% | Base 7.5% + enhancement 5% = **12.5%** |
| Transparence | Opaque | **Full breakdown visible** |
| Crédibilité | "Vault yield déguisé" | **"Real autocall + DeFi carry"** |

---

*Flow v2 — 17 mars 2026. 3 couches économiques séparées.
Le coupon vient de l'option pricing. Le carry est l'edge DeFi.
Institutionnellement crédible. Le protocole = issuer + hedging desk + carry engine.*
