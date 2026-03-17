# xYield Notes — Competitive Analysis: What Each Bank Does Best

## 1. Societe Generale — Le precedent on-chain

**Position:** #1 emetteur mondial d'autocalls

### SG Forge: Premier autocall on-chain au monde

| Detail | Info |
|---|---|
| **Date** | 15 avril 2021 |
| **Produit** | Autocall Euro Medium Term Notes (EMTN) |
| **Montant** | EUR 5 millions |
| **Maturite** | 4 ans |
| **Blockchain** | Tezos (public), puis Ethereum |
| **Sous-jacent** | Index custom (non divulgue) |
| **Souscripteur** | Societe Generale Assurances (100% interne) |
| **Cadre legal** | MIFID II, meme statut que des titres traditionnels |

### Structure Phoenix de SG Forge (template actuel)
- Maturite 5 ans, observations annuelles
- Autocall barrier : 100% du niveau initial
- Coupon barrier : 80% du niveau initial
- Protection barrier (KI) : 60% du niveau initial
- Sous-jacents : equities, fixed income, currencies, commodities, funds
- Blockchains supportees : Ethereum + Tezos

### Automatisation on-chain
- Corporate actions automatisees (paiement coupons, autocall)
- Time-to-market reduit
- Transparence accrue des transactions
- Moins d'intermediaires dans le settlement
- Settlement : SG = Registrar + Settlement Agent
- Interoperabilite : Security Tokens integres aux systemes bancaires via format SWIFT

### Timeline SG Forge
| Date | Milestone |
|---|---|
| Avril 2019 | Premier bond tokenise EUR 100M sur Ethereum |
| Mai 2020 | Bond EUR 40M settle en CBDC (Banque de France) |
| **Avril 2021** | **Premier autocall on-chain sur Tezos (EUR 5M)** |
| Avril 2023 | Lancement EUR CoinVertible (stablecoin EURCV) |
| Nov 2023 | Premier green bond digital sur Ethereum |
| Juin 2025 | USD CoinVertible sur Ethereum + Solana |
| Nov 2025 | Premier bond digital aux USA (Canton Network, achete par DRW/Cumberland) |
| 2025+ | Plans pour structured notes on-chain aux US |

### Produits actuels
- US Tech basket : **30% p.a.** (high-vol names, USD)
- US Stocks Defensive Autocall : **23.3% p.a.** (5.825% quarterly)
- Memory Income Reducing Autocall = exactement notre produit

### Ce qu'on prend
Structure Phoenix Memory + step-down = gold standard. Le fait qu'ils aient fait du on-chain **valide** notre concept.

### Sources
- https://www.sgforge.com/societe-generale-issues-the-first-structured-product-on-public-blockchain/
- https://www.societegenerale.com/en/news/press-release/first-structured-product-public-blockchain
- https://www.sgforge.com/product-structured-products-phoenix/
- https://www.sgforge.com/product/structured-products/
- https://www.structuredretailproducts.com/news/details/77083
- https://www.coindesk.com/business/2025/11/18/societe-generale-s-sg-forge-issues-first-tokenized-bond-in-u-s

---

## 2. Goldman Sachs — L'innovation payoff

- **Catapult payoff** (prix SRP Americas 2024) : si pas d'autocall, l'investisseur recoit de la participation a la hausse au lieu de juste son capital. Hybrid autocall + participation.
- **Step-down agressif** : 97.5% → 95% → 92.5% → 90% (reducing autocall triggers)
- **MerQube Vol Advantage Indexes** : ~$300M en notes sur index proprietaires volatilite-controllee
- **Benchmark** : NVDAx/AAPLx/TSLAx a **15.65% p.a.**
- Coupons ~9.25% p.a. pour index-linked ; snowball coupons 3.9-4.0% semi-annuellement

### Ce qu'on prend
Step-down agressif + benchmark GS comme reference marketing.

### Sources
- https://www.structuredretailproducts.com/insights/80403/srp-americas-awards-2024-gs-capitalises-on-futures-indices-and-catapult-payoff

---

## 3. BNP Paribas — L'ingenierie index

- **#2 en Europe** avec 12.9% de part de marche (H1 2025, en hausse vs 11.6%)
- **Croissance US** : +47%, atteignant $11B de notionnel sur 6000+ produits (3 premiers trimestres 2025)
- **Innovation** : Decrement indexes (dividende synthetique fixe → meilleur pricing pour autocalls)
- Semi-annuel, 4.50-4.80%/semestre (9-9.6% p.a.), protection 65%
- **ESG** : Blue bond framework avec autocalls lies a la preservation des oceans
- **Prix** : Risk.net Structured Products House of the Year 2024

### Ce qu'on prend
Structure semi-annuelle clean, protection 65% (on utilise deja 55% KI).

### Sources
- https://www.risk.net/awards/7962594/structured-products-house-of-the-year-bnp-paribas

---

## 4. JP Morgan — La democratisation

- **Autocallable Income ETF** (CAIE) avec Calamos/MerQube : **$400M AUM en 5 mois** (lance juin 2025). Democratise l'acces aux autocalls sans minimum d'investissement.
- **Laddering** : autocalls decales pour lisser le revenu et reduire le risque de timing
- **ML pricing** : Machine learning pour pricing autocalls = 4,500 heures/an economisees, "Robotrader" auto-quote ~50% des RFQ vanille
- Weighted average coupon du ETF : **17.98%**
- **Prix** : Risk.net Structured Products House of the Year + Equity Derivatives House of the Year

### Ce qu'on prend
Concept de pooling/laddering → en DeFi = vault qui roule automatiquement les notes.

### Sources
- https://www.risk.net/awards/7955836/structured-products-house-of-the-year-jp-morgan
- https://www.stocktitan.net/news/CAIE/calamos-breaks-new-ground-with-autocallable-income-etf-caie-j-p-vfbp11n80qoc.html

---

## 5. Barclays — La memoire

- **Phoenix Memory Callable** (prix SRP Europe 2024) : Most Innovative Product
- **Memory Income Autocall** : 8.70% p.a., 60% capital protection, 80% income trigger, semi-annuel avec memory feature
- **Classic Autocall** : 11.95% p.a. avec observation semi-annuelle a partir de 12 mois
- **Buffered Autocall** : notes sur Russell 2000 / Nasdaq-100, 7.15% p.a. fixed coupons, 25% downside buffer
- 5,921 produits en Europe en 2023, ~US$4.8B en emission

### Ce qu'on prend
Confirmation que memory coupon est le standard (on l'a deja).

### Sources
- https://www.structuredretailproducts.com/news/79898/srp-europe-2024-awards-barclays-choice-has-triggered-a-shift-towards-portfolio-diversification

---

## 6. Notre avantage vs SG Forge

SG Forge a prouve que ca marche on-chain, mais leur approche est du "blockchain washing" — le produit est tokenise mais la logique reste off-chain.

| | SG Forge | xYield (nous) |
|---|---|---|
| **Acces** | KYC/AML, clients institutionnels | Permissionless |
| **Min ticket** | EUR 100k+ | $100 |
| **Composabilite** | Aucune | ERC-1155 → utilisable en collateral DeFi |
| **Observation** | Calculation agent interne | Chainlink Automation |
| **Pricing** | Desk interne | Monte Carlo on-chain (CRE) |
| **Sous-jacents** | Indices trad | Tokenized equities (xStocks) |
| **Hedging** | OTC interne | Euler + 1inch, transparent |
| **Stablecoin** | EUR CoinVertible (MiCA) | USDC/USDT natif |
| **Smart contracts** | Tokenisation passive (settlement only) | Logique active (autocall, coupons, KI on-chain) |

---

## 7. La recette finale pour le hackathon

```
xYield Notes =
  SocGen (Phoenix Memory + on-chain validation)
  + GS (step-down agressif + worst-of 3-stock baskets)
  + JPM (vault pooling + auto-roll)
  + BNP (parametres propres : KI 55%, CB 65%)
  + Barclays (memory coupon)
  + DeFi-native (permissionless, composable, transparent)
```

**Produit hero :** NVDAx/AAPLx/TSLAx worst-of, 15-22% APY, memory coupon, step-down, auto-roll via ERC-7579

C'est pas du copy-paste de TradFi, c'est prendre un marche de $125B/an et le rendre accessible a n'importe qui avec $100 et un wallet.

---

## 8. Donnees marche : worst-of = standard industrie

- **~95% des autocalls sont des worst-of baskets** (pas single stock)
- **3-stock** est le sweet spot pour single-equity products
- **2-stock** est dominant pour index-linked (institutional)
- **APY typiques worst-of 3-stock US tech** : 15-30% p.a.

| Profil risque | Exemple | APY | Barrier |
|---|---|---|---|
| High vol | Tesla / NVIDIA / Palantir | 20-30% p.a. | 50-60% |
| Moderate vol | Apple / AMD / Tesla | 15-23% p.a. | 55-65% |
| Lower vol | Apple / Microsoft / Amazon | 8-12% p.a. | 65-75% |
| Index-based | S&P 500 / Nasdaq-100 / Russell 2000 | 7-10% p.a. | 60-70% |

## 9. Innovations recentes (2024-2025)

| Innovation | Qui | Detail |
|---|---|---|
| On-chain autocall | SG Forge | Premier autocall sur blockchain publique (2021), expansion Ethereum + US en 2025 |
| Autocall ETF wrapper | JPM / Calamos | CAIE : $400M AUM en 5 mois. Autocalls accessibles a tous |
| Catapult payoff | Goldman Sachs | Hybrid autocall + participation : si pas d'autocall → upside participation |
| Decrement indexes | BNP Paribas | Index avec dividendes synthetiques fixes → meilleur pricing autocall |
| ESG-linked autocalls | BNP Paribas | Blue bond framework lie a la preservation des oceans |
| ML pricing | JP Morgan | Stochastic vol ML model → 2 min de moins par pricing |
| Star autocall | Divers | European barrier enhanced : AC level reduit de 2.5%/Q jusqu'a 60% |
| Funds of autocalls | Europe | Fonds dedies holdant 20+ autocalls, ciblant les notes qui n'autocall PAS (max coupons). AUM EUR 137M+ |
| Capital-protected autocalls | SG, BNP | High-rate environment = principal-protected autocalls lies aux taux |
