# xYield — Flow On-Chain Complet

> Tout ce qui se passe on-chain, transaction par transaction, comme si tu suivais sur Etherscan.
> Deux côtés : RETAIL (investisseur) et PROTOCOLE (= la "banque" automatisée).

---

## Qui est qui ?

### L'ancienne architecture avait 3 acteurs :
```
RETAIL (investisseur)  ←→  UNDERWRITER (la "banque")  ←→  PROTOCOLE (infra)
```
Problème : il faut trouver des underwriters. C'est un chicken-and-egg problem au lancement.

### La nouvelle architecture (PiggyBank model) : 2 acteurs
```
RETAIL (investisseur)  ←→  PROTOCOLE (= la "banque" + l'infra)
```
Le protocole EST la banque. Il prend les deux côtés du trade.
Le vault USDC finance tout : les coupons, le hedge, le yield.

**C'est exactement ce que PiggyBank fait** : pas d'underwriter externe, le protocole gère tout.

### Pourquoi ça marche sans underwriter séparé ?

| Question | Réponse |
|---|---|
| Qui paie le coupon au retail ? | Le vault USDC (funded par les deposits + yield) |
| Qui hedge le risque directionnel ? | Le protocole lui-même (HedgeManager) |
| Qui absorbe les pertes en cas de KI ? | Le vault USDC (le funding rate arb + fees couvrent les pertes statistiques) |
| Qui capture le funding rate ? | Le protocole (c'est son revenue principal) |

**Le modèle économique :** Le protocole collecte ~15-25% ann de funding rate sur le hedge,
paie ~10-14% de coupon au retail, et garde la différence + les fees.
En moyenne, même avec 5-10% de KI events, le protocole est profitable.

---

## FLOW COMPLET — CÔTÉ RETAIL

### Étape 1 : Dépôt USDC

```
Retail (wallet)
    │
    │  TX 1: USDC.approve(XYieldVault, 10000e6)
    │  TX 2: XYieldVault.deposit(10000e6, myAddress)
    │
    ▼
┌──────────────────────────────────────────┐
│  XYieldVault.sol (ERC-4626)              │
│                                          │
│  • Mint xyUSDC shares au retail          │
│    (1 xyUSDC = 1 USDC + yield futur)     │
│                                          │
│  • Prélève origination fee 0.3% ($30)    │
│    → FeeCollector                        │
│                                          │
│  • Capital split automatique :           │
│    ├── $5,000 → EulerStrategy            │
│    ├── $3,000 → FundingArbStrategy       │
│    └── $2,000 → Réserve (coupons + liq)  │
└──────────────────────────────────────────┘
```

Le retail voit : ses xyUSDC dans son wallet. Le share price monte au fil du temps = yield.

---

### Étape 2 : Le capital travaille (automatique)

#### Branche A — Euler Lending (safe, 3-5%)

```
$5,000 USDC
    │
    │  EulerStrategy.deposit(5000e6)
    │  → appelle EulerVault.deposit(5000e6, address(this))
    │
    ▼
┌──────────────────────────────────────────┐
│  Euler Finance (vault USDC)              │
│                                          │
│  $5,000 prêtés à des emprunteurs.        │
│  Yield : 3-5% annualisé.                │
│  Accrual automatique dans le vault.      │
│                                          │
│  C'est du lending basique.               │
│  Rien de risqué. Safe.                   │
└──────────────────────────────────────────┘
```

#### Branche B — Funding Rate Arb (PiggyBank strat, 8-20%)

```
$3,000 USDC
    │
    │  FundingArbStrategy.deploy(3000e6)
    │
    │  TX interne 1 : 1inch.swap(USDC → NVDAx, $1,000)
    │  TX interne 2 : 1inch.swap(USDC → METAx, $1,000)
    │  TX interne 3 : 1inch.swap(USDC → TSLAx, $1,000)
    │
    ▼
On détient $3,000 de xStocks spot dans le contrat.
    │
    │  TX interne 4 : Aster.openShort(NVDAx, $1,000 notional)
    │  TX interne 5 : Aster.openShort(METAx, $1,000 notional)
    │  TX interne 6 : Aster.openShort(TSLAx, $1,000 notional)
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  POSITION DELTA-NEUTRE :                             │
│                                                      │
│  Long $1k NVDAx spot  +  Short $1k NVDAx perp = 0   │
│  Long $1k METAx spot  +  Short $1k METAx perp = 0   │
│  Long $1k TSLAx spot  +  Short $1k TSLAx perp = 0   │
│                                                      │
│  NVDA monte +10% → spot +$100, short -$100 → net $0  │
│  NVDA baisse -10% → spot -$100, short +$100 → net $0 │
│                                                      │
│  PAS DE RISQUE DIRECTIONNEL.                          │
│                                                      │
│  MAIS toutes les 8h sur Aster DEX :                  │
│  Les longs paient les shorts (funding rate).         │
│  On est short → ON EST PAYÉ.                         │
│  ~0.01-0.03% par 8h = 10-30% annualisé.             │
│                                                      │
│  C'est EXACTEMENT ce que PiggyBank fait              │
│  sur Drift (Solana). Même strat, sur EVM.            │
└──────────────────────────────────────────────────────┘
```

**Pourquoi les longs paient les shorts ?**

Les traders retail sont massivement long NVDA/TSLA/META (bullish tech).
Ça fait monter le prix du perp au-dessus du spot.
Le funding rate corrige ça : les longs paient les shorts pour ramener le prix.
C'est structurel — tant que les gens sont bullish, les shorts sont payés.

---

### Étape 3 : Création de l'autocall

```
AutocallEngine.createNote(params)
    │
    │  Paramètres gravés on-chain :
    │  ├── basket: [NVDAx, METAx, TSLAx]
    │  ├── strikes: [prix spot jour J]
    │  │   ex: NVDAx=$150, METAx=$600, TSLAx=$350
    │  ├── coupon: 12% ann (1%/mois)
    │  ├── couponBarrier: 70%
    │  ├── autocallTrigger: 100% (step-down 2%/obs)
    │  ├── kiBarrier: 50% (European)
    │  ├── maturity: block.timestamp + 6 months
    │  └── notional: $10,000
    │
    │  Actions on-chain :
    │
    │  TX 1: NoteToken.mint(retail, noteId, 1)
    │         → ERC-1155 NFT représentant la note
    │
    │  TX 2: Embedded fee 2% ($200) → FeeCollector
    │
    │  TX 3: Enregistre 6 dates d'observation
    │         obs[0..5] = T0 + 1mo, 2mo, 3mo, 4mo, 5mo, 6mo
    │
    │  TX 4: Chainlink Automation enregistrement
    │         → trigger automatique à chaque date
    │
    ▼
Le retail a son NoteToken ERC-1155 dans son wallet.
Il peut le voir, le transférer, le vendre sur un marché secondaire.
```

---

### Étape 4 : Le hedge s'ouvre (LE coup de génie)

**C'est ici que le protocole joue le rôle de la "banque".**
Il hedge son propre risque — et le hedge lui rapporte de l'argent.

```
HedgeManager.openHedge(noteId, $10,000)
    │
    │  LE PROTOCOLE FAIT EXACTEMENT CE QUE PIGGYBANK FAIT :
    │
    │  TX 1-3 : Acheter $10,000 de xStocks via 1inch
    │  ├── 1inch.swap(USDC → NVDAx, $3,333)
    │  ├── 1inch.swap(USDC → METAx, $3,333)
    │  └── 1inch.swap(USDC → TSLAx, $3,334)
    │
    │  TX 4-6 : Collat xStocks sur Euler EVK
    │  ├── EulerVault.deposit(NVDAx, amount)
    │  ├── EulerVault.deposit(METAx, amount)
    │  └── EulerVault.deposit(TSLAx, amount)
    │  → Les xStocks sont sécurisés sur Euler
    │
    │  TX 7 : Emprunter USDC contre xStocks (50% LTV)
    │  └── EulerVault.borrow(USDC, $5,000)
    │      → Pour la marge sur Aster DEX
    │
    │  TX 8-10 : Short perps sur Aster DEX
    │  ├── Aster.openShort(NVDAx, $3,333)
    │  ├── Aster.openShort(METAx, $3,333)
    │  └── Aster.openShort(TSLAx, $3,334)
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│  RÉSULTAT DU HEDGE :                                     │
│                                                          │
│  ✅ HEDGE VALIDE (delta-neutral) :                       │
│     Long $10k xStocks + Short $10k perps = delta 0      │
│     Aucun risque directionnel pour le protocole.         │
│                                                          │
│  ✅ LE HEDGE RAPPORTE :                                  │
│     Funding rate sur $10k short = ~$500/6 mois           │
│     (~10% ann en marché normal)                          │
│                                                          │
│  COMPARAISON GOLDMAN SACHS :                             │
│  ┌────────────────────────────────────────────┐          │
│  │ GS : hedge via options OTC                 │          │
│  │   → gamma hedging = COÛTE 1-4% ($100-400) │          │
│  │   → bid-ask spreads = COÛTE               │          │
│  │   → margin de financement = COÛTE          │          │
│  │                                            │          │
│  │ xYield : hedge via perps (PiggyBank strat) │          │
│  │   → funding rate = RAPPORTE 5-15% ($250+)  │          │
│  │   → le hedge est un profit center          │          │
│  └────────────────────────────────────────────┘          │
│                                                          │
│  C'EST LA RAISON POUR LAQUELLE ON N'A PAS BESOIN        │
│  D'UNDERWRITER EXTERNE : le protocole se hedge           │
│  lui-même ET gagne de l'argent en le faisant.            │
└──────────────────────────────────────────────────────────┘
```

---

### Étape 5 : Vie de la note — Observations mensuelles

Chaque mois, Chainlink Automation trigger automatiquement :

```
ChainlinkKeeper.performUpkeep()
    │
    │  → AutocallEngine.observe(noteId)
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  AutocallEngine.observe(noteId)                      │
│                                                      │
│  1. Récupère prix via Chainlink Data Streams         │
│     NVDAx = $135 (= 90% du strike $150)              │
│     METAx = $660 (= 110% du strike $600)             │
│     TSLAx = $280 (= 80% du strike $350)              │
│                                                      │
│  2. Calcule worst performer                          │
│     worst = min(90%, 110%, 80%) = TSLAx à 80%        │
│                                                      │
│  3. CHECK COUPON :                                   │
│     worst (80%) ≥ coupon barrier (70%) ? OUI ✅      │
│     → TX : transfer $100 USDC au retail (1% coupon)  │
│     → Si memory coupons manqués → les payer aussi    │
│                                                      │
│  4. CHECK AUTOCALL :                                 │
│     worst (80%) ≥ autocall trigger (100%-step) ? NON │
│     → La note continue. Prochain check dans 1 mois.  │
│                                                      │
│  5. CHECK KI :                                       │
│     Seulement à maturité (observation 6) → skip      │
└──────────────────────────────────────────────────────┘
```

**Entre les observations, toutes les 8h :**

```
ChainlinkKeeper.performUpkeep()
    │
    │  → HedgeManager.collectFunding(noteId)
    │
    ▼
Aster.claimFunding(NVDAx) → +$5
Aster.claimFunding(METAx) → +$3
Aster.claimFunding(TSLAx) → +$7
                             ────
                    Total : +$15 / 8h
                    = ~$45/jour
                    = ~$1,350/mois
                    = ~$8,100 sur 6 mois (sur $10k)
                    = ~16% annualisé

    → Funding → vault treasury (augmente le share price xyUSDC)
```

**Aussi toutes les 48h — Epoch :**

```
EpochManager.processEpoch()
    │
    │  Heure 0 : Snapshot NAV
    │  ├── Euler : combien de yield ?
    │  ├── Aster : combien de funding collecté ?
    │  └── Maj prix xyUSDC (share price monte)
    │
    │  Heures 0-24 : Withdrawals
    │  ├── Process les demandes de retrait
    │  └── Unwind positions si besoin
    │
    │  Heures 24-48 : Rebalancing
    │  ├── Funding rate toujours positif ? → continuer
    │  ├── Funding rate négatif > 24h ? → shift vers Euler
    │  ├── Rebalance les deltas si drift > 5%
    │  └── Déployer les nouveaux dépôts
    │
    │  Heure 48 : Nouvel epoch
```

---

### Étape 6a : AUTOCALL (75-85% des cas)

Mois 3, tous les xStocks sont remontés :

```
AutocallEngine.observe(noteId)
    │
    │  NVDAx = 105%, METAx = 112%, TSLAx = 98%
    │  worst = 98%
    │  autocall trigger = 100% - (3 obs × 2% step-down) = 94%
    │  98% ≥ 94% → AUTOCALL TRIGGERED ✅
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  SETTLEMENT AUTOCALL :                               │
│                                                      │
│  TX 1-3 : Fermer le hedge                            │
│  ├── Aster.closeShort(NVDAx, METAx, TSLAx)          │
│  ├── EulerVault.repay($5,000 USDC borrowed)          │
│  └── EulerVault.withdraw(xStocks) → 1inch → USDC    │
│                                                      │
│  TX 4 : Payer le retail                              │
│  ├── $10,000 principal                               │
│  ├── + $300 coupons (3 × 1%)                         │
│  └── = $10,300 USDC → transfer au retail             │
│                                                      │
│  TX 5 : NoteToken.burn(noteId)                       │
│                                                      │
│  TX 6 (optionnel) : Auto-roll                        │
│  └── Si ERC-7579 activé → nouvelle note créée auto   │
│                                                      │
│  ═══════════════════════════════════════════════════  │
│  BILAN PROTOCOLE (3 mois) :                          │
│  ├── Embedded fee :             $200                  │
│  ├── Origination fee :          $30                   │
│  ├── Euler yield (3 mois) :     ~$50                  │
│  ├── Funding arb vault :        ~$90                  │
│  ├── Funding rate hedge :       ~$250 (brut)          │
│  │   dont perf fee 20% =       ~$50 pour protocole    │
│  └── TOTAL protocole :         ~$420 sur 3 mois       │
│      = ~16.8% ann sur $10k de TVL                    │
│                                                      │
│  Le retail a gagné $300 de coupons sur $10k en 3 mois │
│  = 12% annualisé ← exactement le coupon promis       │
│                                                      │
│  TOUT LE MONDE GAGNE :                                │
│  ├── Retail : 12% ann en coupons                     │
│  ├── Protocole : ~17% ann en fees+yield               │
│  └── Personne ne perd (pas de KI)                    │
└──────────────────────────────────────────────────────┘
```

---

### Étape 6b : KI EVENT (5-10% des cas)

À maturité (mois 6), TSLAx a crashé :

```
AutocallEngine.observe(noteId)  // observation finale (maturité)
    │
    │  NVDAx = 75%, METAx = 85%, TSLAx = 42%
    │  worst = TSLAx à 42%
    │  42% < KI barrier (50%) → KI TOUCHÉ ❌
    │
    │  → PHYSICAL DELIVERY
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  SETTLEMENT KI :                                     │
│                                                      │
│  TX 1 : Calculer quantité de xStocks                 │
│  └── $10,000 / prix_TSLAx_final ($147) = 68 TSLAx   │
│                                                      │
│  TX 2 : 1inch.swap(USDC → TSLAx, ~$10,000)           │
│  └── 68 TSLAx transférés au retail                   │
│                                                      │
│  TX 3-5 : Fermer le hedge                            │
│  ├── Aster.closeShort(all)                           │
│  ├── EulerVault.repay(borrowed)                      │
│  └── EulerVault.withdraw(xStocks)                    │
│                                                      │
│  TX 6 : NoteToken.burn(noteId)                       │
│                                                      │
│  ═══════════════════════════════════════════════════  │
│  BILAN RETAIL :                                      │
│  ├── A déposé : $10,000 USDC                         │
│  ├── A reçu : 68 TSLAx (valeur $10,000 au prix bas) │
│  ├── + quelques coupons mensuels ($100-500)          │
│  ├── PERTE LATENTE : oui (TSLA à -58% du strike)    │
│  ├── MAIS : il détient les actions                   │
│  │   → Si TSLA remonte, il récupère                  │
│  │   → Il peut staker sur un protocol yield          │
│  │   → Chez GS = cash settlement = perte SÈCHE       │
│  └── Chez nous = il garde l'equity                   │
│                                                      │
│  BILAN PROTOCOLE :                                   │
│  ├── Embedded fee : $200 (prélevé au début) ✅       │
│  ├── 6 mois de funding rate : ~$500 ✅               │
│  ├── 6 mois d'Euler yield : ~$100 ✅                 │
│  ├── MAIS : le vault a payé $10k de xStocks          │
│  │   au retail (= perte sur cette note spécifique)   │
│  │                                                   │
│  │   STATISTIQUEMENT :                               │
│  │   KI events = 5-10% des notes                     │
│  │   Sur 100 notes de $10k :                         │
│  │   ├── 80 autocall → +$420 × 80 = +$33,600        │
│  │   ├── 12 coupons-only → +$350 × 12 = +$4,200     │
│  │   ├── 8 KI events → perte hedge nette             │
│  │   │   ~-$2,000 × 8 = -$16,000                    │
│  │   └── NET = +$21,800 sur $1M TVL                  │
│  │       = ~2.2% net après KI losses                 │
│  │                                                   │
│  └── LE PROTOCOLE EST PROFITABLE MÊME AVEC DES KI    │
└──────────────────────────────────────────────────────┘
```

---

## Vue d'ensemble — Schéma final

```
        RETAIL                           PROTOCOLE (= la "banque")               PROTOCOLS EXTERNES
        ──────                           ──────────────────────────               ──────────────────

   Dépose USDC ──────→ XYieldVault ───────┬────→ EulerStrategy ────→ Euler Finance
   Reçoit xyUSDC       (ERC-4626)         │                           (lending 3-5%)
                            │             │
                            │             ├────→ FundingArbStrategy ─┬→ 1inch (buy xStocks)
                            │             │     (PiggyBank strat)    └→ Aster DEX (short perps)
                            │             │                              └→ Funding rate $$$
                            │             │                                  toutes les 8h
                            │             └────→ Réserve liquidité
                            │                    (coupons, withdrawals)
                            │
                            ▼
                    AutocallEngine ──────────→ Chainlink Data Streams (prix)
                    (Phoenix logic)          → Chainlink Automation (triggers)
                            │
                            ▼
                    HedgeManager ────────────→ 1inch (buy xStocks spot)
                    (PiggyBank strat)        → Euler EVK (collat xStocks)
                            │                → Aster DEX (short perps = HEDGE)
                            │                   └→ Funding rate $$$ (HEDGE RAPPORTE)
                            │
                    ┌───────┴───────┐
                    ▼               ▼
              AUTOCALL           KI EVENT
              (75-85%)           (5-10%)
                    │               │
              USDC back +      xStocks livrés
              coupons          (physical delivery
              au retail         via 1inch swap)
                    │               │
                    ▼               ▼
              Auto-roll ?      Retail garde
              (ERC-7579)       les actions


    ╔══════════════════════════════════════════════════════════════╗
    ║  PAS D'UNDERWRITER EXTERNE NÉCESSAIRE.                      ║
    ║  Le protocole = la banque.                                  ║
    ║  Il se hedge lui-même via PiggyBank strat.                  ║
    ║  Le hedge RAPPORTE au lieu de coûter.                       ║
    ║  C'est pour ça que ça marche sans contrepartie externe.     ║
    ╚══════════════════════════════════════════════════════════════╝
```

---

## D'où vient l'argent ? (résumé)

```
┌──────────────────────────────────────────────────────────────┐
│  SOURCES DE REVENUS DU PROTOCOLE :                           │
│                                                              │
│  1. EMBEDDED FEE (2%)           → $200/note     → GARANTI   │
│  2. ORIGINATION FEE (0.3%)     → $30/note      → GARANTI   │
│  3. EULER LENDING (3-5%)       → ~$100/note/6mo → SAFE     │
│  4. FUNDING RATE ARB (8-20%)   → ~$180/note/6mo → VARIABLE │
│  5. HEDGE FUNDING (5-15%)      → ~$500/note/6mo → VARIABLE │
│                                                              │
│  TOTAL : ~$1,010/note/6mo (best case bull)                   │
│          ~$420/note/6mo (marché normal)                       │
│          ~$280/note/6mo (bear/calme)                          │
│                                                              │
│  COÛTS :                                                     │
│  1. COUPONS PAYÉS              → -$100/mois/note → FIXE     │
│  2. KI LOSSES (5-10% des notes)→ -$2,000/KI event → TAIL   │
│  3. GAS + REBALANCING          → -$50/note/6mo  → FIXE     │
│                                                              │
│  NET POSITIF dans tous les scénarios sauf bear extrême       │
│  + funding rates négatifs prolongés (rare, <5% du temps)     │
└──────────────────────────────────────────────────────────────┘
```

---

*Document généré le 16 mars 2026. Flow on-chain complet du protocole xYield,
modèle PiggyBank sur EVM (Euler + Aster DEX), sans underwriter externe.*
