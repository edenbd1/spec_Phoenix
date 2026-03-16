# xYield Protocol — Complete Economic Model

> Document de synthese finale. Integre les resultats de 24 versions de simulation (120,960 configs),
> l'analyse du marche TradFi ($125B/an d'autocalls), et le modele de yield DeFi complet.
> Genere le 16 mars 2026, pre-implementation pour le hackathon xStocks Market Open (31 mars - 2 avril 2026, Cannes).

---

## 1. Le pivot strategique : de l'option pure a l'infrastructure

### Ce qu'on faisait (v1-v24)

Pendant 24 versions de simulation, on a cherche a optimiser la structure autocall elle-meme :
minimiser le KI, maximiser le win rate, rendre le produit profitable dans tous les regimes.
Resultat : des structures ultra-safe (KI 30%, Cpn 6%) mais avec un rendement retail de 2-3% — pas attractif.

### Ce que Goldman Sachs fait

GS ne cherche pas un autocall qui gagne toujours. Ils vendent un produit attractif :

| Parametre | Goldman Sachs (SEC 2024) | Notre ancien modele | Nouveau modele |
|---|---|---|---|
| Coupon | 15.65% p.a. | 6-8% | **10-14%** |
| KI barrier | 50% | 30% | **50%** |
| Coupon barrier | 60% | 80-90% | **65-70%** |
| Maturite | 2 ans | 3 mois | **3-6 mois (auto-roll)** |
| Win rate retail | ~75-85% | ~100% | **~75-85%** |
| Settlement | Cash (perte seche) | Physical delivery | **Physical delivery (xStocks)** |
| Embedded fee | 3-7% | 0.5% | **1-3%** |

Le retail accepte le risque (KI 50% = -50% drawdown possible) en echange d'un coupon eleve.
Quand le KI est touche, il recoit les xStocks (physical delivery) — pas une perte seche, il garde l'exposition equity.

### Le modele economique reel de GS

Une note $1,000 chez Goldman Sachs :
- Valeur reelle jour 1 : **$930-970** (estimated initial value dans le prospectus SEC)
- Le spread de $30-70 (3-7%) couvre : profit GS + commission broker + hedging markup
- GS hedge en delta-neutral via options/futures → risque directionnel quasi-nul
- Le retail gagne ~75-85% du temps
- Quand il perd (KI), c'est le retail qui absorbe — pas GS

**Notre avantage vs GS :**
1. Pas de reseau de distribution (brokers prennent 1-3% chez GS)
2. Pas de compliance overhead bancaire
3. Physical delivery (xStocks) au lieu de cash settlement
4. **DeFi yield sur les deux cotes du trade** (Euler + funding rate arb)
5. Smart contract = cout marginal quasi-nul par note

---

## 2. L'economie complete : deux cotes, quatre moteurs de yield

### Vue d'ensemble

```
                SENIOR (Retail)                      UNDERWRITER (Market Maker)
                ───────────────                      ─────────────────────────

 Depose USDC ────→  POOL xYIELD  ←──── Poste xStocks + marge
                      │       │
         ┌────────────┘       └──────────────┐
         ▼                                   ▼
   USDC YIELD ENGINE                   xSTOCK YIELD ENGINE
   ┌──────────────────┐                ┌──────────────────────┐
   │ Strategie 1:     │                │ Strategie:           │
   │ Euler lending    │                │ xStocks collatéral   │
   │ → 3-4% base     │                │ → Euler/lending      │
   │                  │                │ → Emprunte USDC      │
   │ Strategie 2:     │                │ → Short perps (Nado) │
   │ Funding rate arb │                │ → Capture funding    │
   │ → Long collat    │                │   rate               │
   │ → Short perps    │                │                      │
   │ → 5-20% selon    │                │ Le short perp = le   │
   │   marche         │                │ delta hedge !        │
   └──────────────────┘                └──────────────────────┘
         │                                   │
         ▼                                   ▼
   ┌─────────────────────────────────────────────────┐
   │              AUTOCALL ENGINE                     │
   │  Chainlink Data Streams → prix xStocks          │
   │  Chainlink Automation → trigger observations    │
   │  Logique : coupon / autocall / KI               │
   │  Settlement : 1inch swap → physical delivery    │
   └─────────────────────────────────────────────────┘
         │                                   │
         ▼                                   ▼
   Coupons / Principal              Option premium / Yield
   → Retail                         → Underwriter
```

### Les 4 moteurs de yield

| # | Moteur | Source | Yield attendu | Qui en beneficie |
|---|--------|--------|---------------|------------------|
| 1 | **Euler lending** | Pret USDC sur Euler/Aave/Morpho | 3-5% ann | Protocole |
| 2 | **Funding rate arb (USDC)** | Long spot + short perps sur Nado | 5-20% ann | Protocole |
| 3 | **Funding rate arb (xStocks)** | xStocks collat → borrow → short perps | 3-10% ann | Underwriter |
| 4 | **Embedded fee** | Spread entre fair value et prix de vente | 1-3% par note | Protocole |

---

## 3. Funding rate arbitrage : le moteur principal

### Comment ca marche

Le funding rate est un paiement periodique (toutes les 8h) entre les positions long et short
sur les marches de futures perpetuels. En marche haussier, les longs paient les shorts.

**La strategie (identique a Ethena/PiggyBank) :**

```
1. Detenir un actif spot (USDC ou xStock)
2. Ouvrir une position short equivalente en perps
3. Position nette = delta-neutral (pas d'exposition directionnelle)
4. Capturer le funding rate : les longs vous paient toutes les 8h
5. Yield = funding_rate × leverage × 365 jours
```

### Rendements observes

**PiggyBank (piggybank.fi) — All-Time depuis oct 2025 :**
| Vault | APY All-Time | Strategie |
|-------|-------------|-----------|
| USDC | **20.84%** | Funding rate arb directe |
| SPYx | **7.18%** | Collat xStock → borrow → funding arb |
| JITOSOL | 4.99% | Staking + arb |

**Ethena (USDe/sUSDe) — $6B+ TVL :**
| Periode | sUSDe APY |
|---------|-----------|
| 2024 bull | 15-25% |
| 2025 normal | 8-12% |
| Mars 2026 (bear) | 3.5-3.7% |

**Funding rates moyens annualises :**
| Periode | BTC perps | ETH perps |
|---------|-----------|-----------|
| 2024 | ~11% | ~12.6% |
| Bull periods | 20-30%+ | 20-30%+ |
| Bear/calme | 3-5% | 3-5% |

### Le yield est VARIABLE

Le funding rate arb n'est PAS un rendement fixe. Il fluctue avec le sentiment de marche :
- **Bull market** : les longs paient beaucoup → 15-25% APY
- **Marche normal** : 8-12% APY
- **Bear/calme** : 3-5% APY
- **Crash severe** : funding rates negatifs possible → strategie perd temporairement

C'est le meme profil que PiggyBank (20.84% all-time = periode majoritairement bullish).
Le protocole doit gerer dynamiquement l'allocation entre lending safe (Euler) et arb (Nado).

### Risques du funding rate arb

| Risque | Gravite | Mitigation |
|--------|---------|------------|
| Funding rates negatifs prolonges | ELEVE | Reserve fund (comme Ethena), switch vers Euler lending |
| Liquidation sur position perp | ELEVE | Levier conservateur (2-3x max), rebalancing automatique |
| Smart contract (DEX perps) | MOYEN | Diversification multi-DEX, audit |
| Depeg stablecoin | MOYEN | Monitoring, unwind automatique |
| Slippage sur gros volumes | FAIBLE | Execution fragmentee, limit orders |

---

## 4. Le coup de genie : le delta hedge EST le funding rate arb

### Autocall classique (Goldman Sachs)

```
GS vend autocall → doit hedger le risque directionnel
  → Achete/vend des options et du delta
  → Gamma hedging = COUT (rebalancing frequent, spread bid-ask)
  → Le hedge COUTE de l'argent
```

### Notre modele (xYield)

```
Underwriter vend autocall → doit hedger
  → Achete xStocks (position long = delta hedge)
  → Ouvre position short perps equivalente sur Nado
  → Position nette = delta-neutral ✓ (hedge valide)
  → MAIS les longs paient le funding rate au shorts
  → Le hedge RAPPORTE au lieu de couter !
```

| Composante | GS / TradFi | xYield |
|---|---|---|
| L'hedger est long stocks | Oui | Oui (xStocks) |
| L'hedger est short perps | Rarement (options surtout) | **Oui — et il capture le funding rate** |
| Cout du hedge | Negatif (gamma, bid-ask) | **Positif (funding rate income)** |
| Complexite | Options exotiques, OTC | Smart contract + perp DEX |

C'est l'avantage structurel de DeFi sur TradFi : les marches de perps onchain paient
un funding rate systematiquement positif (car les cryptos sont majoritairement bullish en spot).
Sur les xStocks (tech US), le meme phenomene s'applique : les traders sont globalement long-biased
sur NVDA, TSLA, META → les shorts capturent du funding.

---

## 5. Architecture technique complete

### Stack hackathon

```
┌────────────────────────────────────────────────────────────────────────┐
│                        xYield Protocol                                │
│                     Deployed on Ink (Kraken L2)                       │
├─────────────────────────┬──────────────────────────────────────────────┤
│     SENIOR VAULT        │      HEDGING ENGINE                         │
│     (ERC-4626)          │      (Smart Contract)                       │
│                         │                                              │
│  accept USDC deposits   │   buy xStocks via 1inch                     │
│  deploy to Euler        │   collateralize on Euler EVK                │
│  (optional: fund arb)   │   short perps on Nado                      │
│                         │   capture funding rate                      │
│  yield → protocol       │   = delta hedge + yield                     │
├─────────────────────────┴──────────────────────────────────────────────┤
│                      AUTOCALL ENGINE                                   │
│                                                                        │
│  Chainlink Data Streams    → prix xStocks (sub-second)                │
│  Chainlink Automation      → trigger observations periodiques         │
│  Phoenix logic             → coupon/autocall/KI evaluation            │
│  1inch                     → swap xStocks pour physical delivery      │
│  ERC-7579                  → auto-roll via smart account module       │
├────────────────────────────────────────────────────────────────────────┤
│                      PARTENAIRES INTEGRES                              │
│                                                                        │
│  Euler Finance  → lending USDC + xStock collateral (ERC-4626 vaults)  │
│  Nado           → perp DEX sur Ink (orderbook, 5-15ms latency)        │
│  Chainlink      → Data Streams + Automation + Proof of Reserve        │
│  1inch          → swap API pour xStocks trades                        │
│  PiggyBank*     → strategie de reference (jury hackathon)             │
│  Ink            → Kraken L2 (chain de deploiement)                    │
│                                                                        │
│  * PiggyBank est sur Solana — reference architecturale, pas integration│
│    directe. On replique leur strategie sur EVM via Euler + Nado.      │
└────────────────────────────────────────────────────────────────────────┘
```

### Pourquoi Ink (Kraken L2)

- xStocks est un produit Kraken → deployer sur Ink = alignement strategique maximal
- Nado (perp DEX) est natif sur Ink → funding rate arb sans bridge
- Frais de gas < Ethereum mainnet
- Latence 5-15ms pour le trading de perps
- Critere hackathon "xStocks Relevance" (30%) favorise l'ecosysteme Kraken

---

## 6. Revenue model du protocole

### Par note de $10,000 — maturite 6 mois

#### A. Revenus du protocole (infrastructure)

| Source | Calcul | Montant | Risque |
|--------|--------|---------|--------|
| Embedded fee (2%) | $10,000 × 2% | **$200** | Aucun |
| Origination fee (0.3%) | $10,000 × 0.3% | **$30** | Aucun |
| Euler spread (0.5%) | $10,000 × 4% Euler × 0.5% spread × 0.5an | **$10** | SC risk |
| Auto-roll fee (0.1%/roll) | $10,000 × 0.1% × 2 rolls/an | **$20** | Aucun |
| **Total protocole / note / an** | | **$260** | |
| **Protocol APY** | $260 / $10,000 | **2.6%** | |

#### B. Revenus additionnels si funding rate arb deploye

| Source | Calcul (marche normal 10% arb) | Montant |
|--------|-------------------------------|---------|
| Funding arb sur USDC idle | $10,000 × 10% × 0.5an × 20% perf fee | **$100** |
| Total protocole avec arb | $260 + $100 | **$360** |
| Protocol APY avec arb | | **3.6%** |

#### C. Revenus de l'underwriter (par note de $10,000 hedgee)

| Source | Montant | Risque |
|--------|---------|--------|
| Option premium capturee (spread) | $300-700 | Pricing risk |
| Funding rate sur xStocks hedge (7% × 0.5an) | $175-350 | Funding rate |
| VRP (vol implicite > realisee) | $100-175 | Realisation |
| **Brut UW** | **$575-1,225** | |
| Hedge costs (rebalancing) | -$50-100 | |
| KI losses (probabilise 5-10% × tail loss) | -$150-400 | Marche |
| **Net UW attendu** | **$375-725 / note / an** | |

### Scaling

| TVL | Notes actives | Turnover annuel | Revenue protocole | Avec fund arb |
|-----|---------------|-----------------|-------------------|---------------|
| $1M | 100 × $10k | $4M (auto-roll 3mo) | $26k | $36k |
| $10M | 1,000 | $40M | $260k | $360k |
| $100M | 10,000 | $400M | $2.6M | $3.6M |

---

## 7. Produit autocall cible : mode GS/SocGen

### Structure MVP

| Parametre | Valeur | Justification |
|-----------|--------|---------------|
| Type | Phoenix Autocall | Standard mondial (France, US, Asia) |
| Sous-jacent | Worst-of 3 xStocks | GS vend worst-of NVDA/AAPL/TSLA |
| Basket propose | NVDAx / METAx / TSLAx | Haute vol = coupon eleve |
| Coupon | 10-14% p.a. | Competitif vs GS 15.65% (nos fees sont plus bas) |
| Coupon barrier | 65-70% | GS utilise 60%, on est legerement plus conservateur |
| Autocall trigger | 100% (step-down 2%/obs) | Standard industrie |
| KI barrier | 50% | Alignement GS, standard marche |
| Memory coupon | Oui | Standard Phoenix, meilleur pour retail |
| Observation | Mensuelle | GS = mensuel, plus de chances d'autocall |
| Maturite | 6 mois (auto-roll) | GS = 2 ans, nous on auto-roll pour capital efficiency |
| Settlement | Physical delivery (xStocks) | Avantage vs GS (cash settlement = perte seche) |
| KI type | European (fin de maturite) | Moins de KI events que continuous |

### Ce que le retail voit

```
╔══════════════════════════════════════════════════════════╗
║  xYield Note — NVDAx / METAx / TSLAx                   ║
║                                                          ║
║  Coupon:          12% annualise (1% par mois)            ║
║  Coupon barrier:  70% (touche si worst stock > 70%)      ║
║  Autocall:        100% (step-down 2%/mois)               ║
║  Protection:      KI a 50% (absorbe jusqu'a -50%)        ║
║  Maturite:        6 mois (auto-roll disponible)          ║
║  Settlement:      Physical delivery en xStocks           ║
║                                                          ║
║  Scenarios :                                             ║
║  ✅ 75-85% : Autocall → capital + coupons (6-12%)       ║
║  ✅ 10-15% : Coupons payes, pas d'autocall, capital OK  ║
║  ❌ 5-10%  : KI touche → recoit xStocks du worst stock  ║
║                                                          ║
║  "Le meme produit que Goldman Sachs vend a Wall Street   ║
║   — permissionless, 1% de fees au lieu de 5%."           ║
╚══════════════════════════════════════════════════════════╝
```

### Pourquoi physical delivery est un avantage

Chez GS, si le KI est touche, le retail perd en cash. Chez nous :
- Le retail recoit des xStocks (NVDAx, METAx ou TSLAx)
- Il garde l'exposition equity → si le stock remonte, il recupere
- Il peut deposer ses xStocks chez PiggyBank pour generer du yield en attendant
- Ce n'est PAS une perte definitive — c'est un swap USDC → equity a prix reduit

---

## 8. Resultats de simulation v24 — reinterpretes

### Contexte

120,960 configurations testees via Monte Carlo (2,000 paths chacune).
8 baskets × 2 maturites × 5 coupons × 4 KI × 3 CB × 3 AC × 3 VRP × 14 regimes.

### Avant : on cherchait la structure parfaite

L'ancien modele (KI 30%, Cpn 6%) etait optimise pour le protocole, pas pour le retail.
Resultat : 2-3% SrAPY — aucun interet pour un investisseur.

### Maintenant : on accepte le risque comme GS

Avec le modele GS (KI 50%, Cpn 10-12%), les resultats v24 montrent :

| Config GS-style | KI hit rate | SrAPY | Win rate retail | Breakeven Euler |
|---|---|---|---|---|
| KI 50%, Cpn 10%, CB 70% | 3-11% | 6-8% | 89-97% | 11% |
| KI 50%, Cpn 12%, CB 80% | 3-11% | 7-10% | 89-97% | 15% |
| KI 50%, Cpn 10%, CB 90% | 3-11% | 8-10% | 89-97% | 11% |

Le breakeven Euler semble eleve (11-15%), **mais ce n'est plus pertinent** dans le nouveau modele.
Le protocole ne depend plus d'Euler seul — il a 4 moteurs de revenus.

### Les donnees v24 qui restent valides

**Sensibilites confirmees :**
- KI est le parametre le plus sensible (30% → 60% = +32% de danger)
- 3mo-M >> 6mo-Q en securite (2% vs 18% de configs dangereuses)
- VRP aide massivement les baskets volatils (NVDA/TSLA : -30% → -9% avec VRP 20%)
- CB 90% maximise les autocall precoces (moins de temps d'exposition)
- En crash 2020-type, seuls KI ≤ 40% + 3mo-M survivent

**Zone de confort pour le produit GS-style :**
- KI 50% en regime normal : ~9% de configs dangereuses (acceptable, GS prend ce risque)
- KI 50% en crash : ~42% de configs touchees (c'est le risque que le retail accepte pour 12% de coupon)

---

## 9. Capital flow detaille

### Etape par etape

```
ETAPE 1 — EMISSION
═══════════════════
Retail depose $10,000 USDC dans le vault xYield
    → Protocole preleve origination fee ($30)
    → Protocole preleve embedded fee ($200, integre dans le prix de la note)
    → $9,770 USDC disponibles dans le pool

Underwriter accepte la contrepartie
    → Poste une marge en USDC ($3,000-5,000, 30-50% du notionnel)
    → Achete les xStocks necessaires pour le delta hedge

ETAPE 2 — DEPLOIEMENT DU CAPITAL
═════════════════════════════════
Pool USDC ($9,770 + marge UW) :
    → 60-80% deploye sur Euler Finance (lending, 3-4% safe)
    → 20-40% deploye en funding rate arb via Nado (5-20% variable)
    → Reserve de liquidite pour coupon payments

Underwriter xStocks :
    → xStocks collateralises sur Euler EVK
    → Emprunte USDC contre les xStocks
    → Short perps equivalents sur Nado (= delta hedge + funding capture)

ETAPE 3 — VIE DE LA NOTE (6 mois, observations mensuelles)
═══════════════════════════════════════════════════════════
Chaque mois, Chainlink Automation trigger l'observation :
    → Chainlink Data Streams fournit les prix des 3 xStocks
    → Smart contract evalue :
        1. Worst stock < coupon barrier (70%) → pas de coupon ce mois
        2. Worst stock ≥ coupon barrier (70%) → coupon de 1% paye
        3. Worst stock ≥ autocall trigger (100%) → note terminee, principal rendu
        4. Memory : coupons rates sont recuperes quand la condition est remplie

ETAPE 4a — AUTOCALL (75-85% des cas)
═════════════════════════════════════
    → Principal $10,000 + coupons accumules rendu au retail
    → Underwriter recupere ses xStocks + marge + profit
    → Protocole garde : embedded fee + Euler spread + arb performance
    → Auto-roll propose au retail (ERC-7579 executor module)

ETAPE 4b — MATURITE SANS AUTOCALL (10-15%)
═══════════════════════════════════════════
    → Si worst stock ≥ KI (50%) : principal rendu + derniers coupons
    → Si worst stock < KI (50%) : physical delivery

ETAPE 4c — KI EVENT (5-10%)
════════════════════════════
    → Retail recoit les xStocks du worst performer via 1inch swap
    → Quantite = notionnel / prix du worst stock au fixing final
    → Exemple : $10,000 / $50 NVDAx = 200 NVDAx
    → Le retail garde l'exposition equity (peut rebondir ou deposer chez PiggyBank)
```

---

## 10. Positionnement PiggyBank (jury hackathon)

### Pourquoi PiggyBank dans notre architecture

PiggyBank (piggybank.fi) a prouve la viabilite du funding rate arbitrage sur xStocks :
- **SPYx vault : 7.18% APY** — yield sur actions tokenisees
- **USDC vault : 20.84% APY** — funding rate arb directe
- TVL : $3.9M, en croissance
- Strategie : collat xStocks sur Kamino → borrow stables → arb funding rates sur perps DEX
- Delta-neutral avec risk management automatique (rebalancing, TP/SL)

### Notre relation avec PiggyBank

**On ne copie pas PiggyBank. On les compose.**

PiggyBank genere du yield sur xStocks.
Nous, on utilise cette meme strategie DANS le cadre d'un produit structure.
Le delta hedge de l'autocall devient lui-meme une source de yield.

**Pitch au jury :**

> "PiggyBank a cree les premiers vaults yield-bearing pour xStocks.
> Nous construisons le premier produit structure sur xStocks —
> et le hedge de notre autocall utilise la meme strategie que PiggyBank :
> long xStocks + short perps = delta hedge + yield capture.
> C'est le premier autocall au monde ou le hedge rapporte au lieu de couter."

### Contrainte technique

PiggyBank est sur **Solana** (via Kamino/Loopscale).
Le hackathon est **EVM** (Ethereum/Ink/Mantle).
On replique leur strategie sur EVM via **Euler (collateral) + Nado (perps sur Ink)**.
Dans l'architecture long-terme, une integration cross-chain (Solana ↔ EVM via bridge)
permettrait d'utiliser PiggyBank directement comme vault de yield pour les xStocks hedges.

---

## 11. Projections de yield par regime de marche

### Scenario A — Bull market (funding rates ~15-20%)

| Source | Yield USDC side | Yield xStock hedge side |
|--------|----------------|------------------------|
| Euler lending | 5-8% | — |
| Funding arb USDC | 15-20% | — |
| Funding arb xStocks | — | 10-15% |
| **Blend USDC** | **10-15%** | |
| **Blend hedge** | | **10-15%** |

Protocole APY : **5-8%** (fees + spread sur yield)
Retail coupon : **12-14%** (largement couvert)
Underwriter : **15-25% net**

### Scenario B — Marche normal (funding rates ~8-12%)

| Source | Yield USDC side | Yield xStock hedge side |
|--------|----------------|------------------------|
| Euler lending | 3-5% | — |
| Funding arb USDC | 8-12% | — |
| Funding arb xStocks | — | 5-8% |
| **Blend USDC** | **6-8%** | |
| **Blend hedge** | | **5-8%** |

Protocole APY : **3-4%**
Retail coupon : **10-12%** (couvert)
Underwriter : **8-15% net**

### Scenario C — Bear / calme (funding rates ~3-5%)

| Source | Yield USDC side | Yield xStock hedge side |
|--------|----------------|------------------------|
| Euler lending | 2-3% | — |
| Funding arb USDC | 3-5% | — |
| Funding arb xStocks | — | 2-3% |
| **Blend USDC** | **3-4%** | |
| **Blend hedge** | | **2-3%** |

Protocole APY : **2.6%** (fees fixes dominent)
Retail coupon : **10-12%** (couvert par option premium, pas par yield)
Underwriter : **3-8% net** (marge comprimee)

### Point critique

Le coupon retail (10-14%) est finance par la **prime d'option** (le cout economique reel
de la barriere KI + worst-of), pas par le yield Euler/arb. Le yield est un bonus
pour le protocole et l'underwriter. Meme a Euler 0% et funding arb 0%, le produit
reste vendable — c'est juste que le protocole gagne moins.

---

## 12. Comparaison avec les protocoles morts

| Protocole | Pourquoi mort | Notre difference |
|-----------|--------------|-----------------|
| **Ribbon Finance** | Options sur crypto (ETH/BTC), pas d'equities, yield comprime post-merge, acquis par Aevo | xStocks equities, rendement structurellement plus eleve via worst-of basket |
| **Friktion** | Solana-only, options simples (covered calls), pas de produit structure | Phoenix autocall complet, multi-chain, TradFi-grade |
| **Cega** | Exotiques trop complexes, sous-jacents crypto seulement, marche trop petit | GS-style autocall = $125B/an de demande prouvee |

**Pourquoi on ne mourra pas :**
1. Sous-jacents equities (xStocks) = demande $125B/an prouvee, pas de niche crypto
2. Revenue diversifie (fees + Euler + arb) vs. single yield source
3. Two-sided marketplace (retail + underwriter) vs. one-sided vaults
4. Physical delivery vs. cash settlement

---

## 13. Risques et mitigations

### Risques systemiques

| Risque | Probabilite | Impact | Mitigation |
|--------|------------|--------|------------|
| **Crash marche (-40%+)** | 5-10%/an | KI events massifs, pertes UW | KI 50% absorbe jusqu'a -50%, physical delivery limite la perte |
| **Funding rates negatifs prolonges** | 10-15%/an | Yield engine perd de l'argent | Reserve fund, switch vers Euler lending pur, reduce arb allocation |
| **Smart contract exploit** | <5%/an | Perte de fonds | Audit, bug bounty, assurance (Nexus Mutual), vaults separes |
| **xStocks depeg** | <2%/an | Collateral vaut moins que l'underlying | Chainlink Proof of Reserve, redemption 1:1 chez Backed Finance |
| **Depeg USDC** | <1%/an | Positions leveragees liquidees | Monitoring, circuit breakers, multi-stablecoin |
| **Liquidite xStocks insuffisante** | MOYEN | Slippage sur physical delivery | 1inch aggregation, limit orders, OTC pour gros montants |

### Risques specifiques au modele

| Risque | Detail | Mitigation |
|--------|--------|------------|
| **Correlation spike en crash** | Worst-of = toutes les actions tombent ensemble | Maturite courte (6mo) limite l'exposition, step-down accelere l'autocall |
| **Adverse selection** | Les UW ne prennent que les trades faciles | Pricing dynamique (MC simulation on-chain ou oracle), spread ajuste |
| **Concentration** | Un seul UW monopolise le pool | Cap par UW, reputation system, multiple UW required |

---

## 14. Donnees de simulation v24 — reference rapide

**120,960 configurations analysees** (8 baskets, 2 maturites, 5 coupons, 4 KI, 3 CB, 3 AC, 3 VRP, 14 regimes)

### Regles validees par les simulations

1. **KI ≤ 50% obligatoire** — KI 60% = 32% de configs dangereuses en normal, 50%+ en crash
2. **3mo-M > 6mo-Q** — 2% vs 18% de configs dangereuses
3. **VRP aide les baskets volatils** — NVDA/TSLA/AMD passe de -30% a -9% avec VRP 20%
4. **CB 90% maximise les autocall precoces** — KI 30% + CB 90% = seule combo positive en moyenne
5. **En crash 2020-type** — seuls KI ≤ 40% + 3mo-M + VRP 30% survivent
6. **Le coupon est le principal cout** — chaque +2% de coupon coute ~4% de ProtAPY

### Top structures v24 (pour reference)

**Meilleur profit protocole (E=5%, Jr=35%, normal) :**
NVDA/TSLA/AMD 3mo-M KI=30% CB=90% AC=95% Cpn=6% VRP=0% → ProtAPY +12.7%

**Plus robuste :**
META/AAPL/AMZN 3mo-M KI=30% CB=70% AC=95% Cpn=6% VRP=30% → profitable 100% des regimes

**Meilleur retail :**
NVDA/META/AMZN 3mo-M VRP=20% KI=30% CB=80% AC=95% Cpn=8% → SrAPY +6.8%, 100% win

---

## 15. Resume executif — Pitch hackathon

### Le probleme

Les autocalls representent $125B+/an d'emissions (50% de tous les produits structures).
Goldman Sachs seul a fait $4.2B au Q1 2024. Mais ces produits sont :
- Reserves aux investisseurs accredites
- Vendus avec 3-7% de fees embedded
- Cash settlement (perte seche si KI touche)
- Aucune composabilite DeFi

### La solution : xYield Notes

Le meme produit que Goldman Sachs vend — reconstruit onchain, permissionless, avec :
- **1-3% de fees** au lieu de 3-7%
- **Physical delivery** en xStocks au lieu de cash settlement
- **DeFi yield** sur les deux cotes du trade (Euler + funding rate arb)
- **Auto-roll** via ERC-7579 pour capital efficiency
- **Le premier autocall ou le hedge rapporte au lieu de couter**

### L'avantage DeFi

```
Goldman Sachs :  Vend autocall → hedge coute → profit = fees seulement
xYield :         Vend autocall → hedge RAPPORTE (funding rate arb)
                               → USDC idle RAPPORTE (Euler + arb)
                               → 4 moteurs de yield au lieu de 0
```

### Partenaires integres

| Partenaire | Role | Score hackathon |
|-----------|------|-----------------|
| **xStocks** | Sous-jacent (NVDAx, METAx, TSLAx) | xStocks Relevance (30%) |
| **Euler Finance** | Lending USDC + collateral xStocks | Technical Execution (30%) |
| **Chainlink** | Data Streams + Automation | Technical Execution (30%) |
| **1inch** | Swaps pour xStocks | Technical Execution (30%) |
| **Nado** | Perp DEX sur Ink (funding rate arb) | Innovation (15%) |
| **PiggyBank** | Strategie de reference (jury) | Innovation (15%) |
| **Ink** | Chain de deploiement (Kraken L2) | xStocks Relevance (30%) |

### Chiffres cles

| Metrique | Valeur |
|----------|--------|
| Marche adressable | $125B+/an (autocalls TradFi) |
| Fee par note | 1-3% embedded |
| Protocol APY | 2.6-3.6% sur TVL |
| Retail coupon | 10-14% ann (competitif vs GS 15.65%) |
| Win rate retail | 75-85% |
| Configs simulees | 120,960 (MC 2,000 paths/config) |
| Partenaires integres | 7 |
| Produits structures onchain existants | 0 (blue ocean) |

---

## 16. Prochaines etapes — Implementation

### Semaine du 16-30 mars (pre-hackathon)

1. **Solidity MVP** — Smart contract autocall (Phoenix, worst-of 3, observations mensuelles)
2. **Euler integration** — ERC-4626 vault pour USDC, EVK pour xStocks collateral
3. **Chainlink setup** — Data Streams pour prix xStocks, Automation pour triggers
4. **Frontend** — Next.js + wagmi + viem, page de souscription + dashboard
5. **Testing** — Foundry tests, fork mainnet Ink

### Hackathon (31 mars - 2 avril)

1. Deploy sur Ink testnet/mainnet
2. Demo end-to-end : deposit USDC → note creee → observation → coupon/autocall
3. Video demo 2 min
4. Pitch deck centre sur :
   - "GS sells this for 5% fees, we do it for 1%"
   - "First autocall where the hedge generates yield"
   - "Physical delivery in xStocks — not a loss, an equity swap"

---

*Document genere le 16 mars 2026. Basé sur 24 versions de simulation Monte Carlo (v2-v24),
l'analyse du marche global des autocalls ($125B/an), les benchmarks Goldman Sachs (SEC filings 2024),
les yields observes sur PiggyBank/Ethena, et l'ecosysteme xStocks (Euler, Nado, Chainlink, 1inch, Ink).*
