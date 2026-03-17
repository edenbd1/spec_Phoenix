# xYield Notes — Market Analysis & TradFi Comparison

## 1. Le marché global des autocalls

### Chiffres clés (distinction stock vs flux)

| Métrique | Valeur | Source |
|---|---|---|
| **Produits structurés — encours total (stock)** | **~$7-8T** | SRP Global, 2024 |
| **Produits structurés — émissions annuelles (flux)** | **~$250B** | SRP, Dataintelo 2024 |
| **Autocalls — part du flux annuel** | **~$125-130B (~50%)** | SRP, AMF, UKSPA |
| **Autocalls — encours (stock)** | **~$200B** | Estimation (maturités courtes 1-3 ans = rotation rapide) |
| **GS seul — Q1 2024** | **$4.2B** (+100% YoY) | SEC filings |

> **Pourquoi le stock autocall est faible vs le total ?** Les autocalls ont des maturités de 1-3 ans et 62-75% sont rappelés avant maturité → ils se "consomment" vite. Les capital-protected notes (5-10 ans) s'accumulent dans le stock. Un autocall émis en 2024 a ~62% de chances d'être remboursé avant fin 2025.

> **Pour le pitch :** "Autocalls represent $125B+ in annual issuance — 50% of all new structured products globally. Goldman Sachs alone did $4.2B in Q1 2024. We're bringing this product onchain."

### Répartition par région (émissions annuelles)

| Région | Taille marché | Produit dominant | Sous-jacent typique | KI barrier | Maturité | Coupon p.a. |
|---|---|---|---|---|---|---|
| **France/Europe** | €42 Mds (2023) | Phoenix Autocall | Euro Stoxx 50, CAC 40 | 50-70% | 2-8 ans | 6-12% |
| **UK** | ~£10 Mds/an | Kick-out (step-down) | FTSE 100 | 60-70% | 5-10 ans | 7-10% accumulé |
| **USA** | ~$40 Mds | Autocallable Contingent Coupon | S&P 500, Nasdaq, single stocks US | 50-70% | 1-2 ans | 8-16% |
| **Corée du Sud** | ~$3.4 Mds/mois | ELS step-down | KOSPI 200, HSCEI, Euro Stoxx | 45-60% | 2-3 ans | 5-10% |
| **Chine** | N/A (OTC) | Snowball | CSI 500/1000 | 70-80% | 1-2 ans | 15-25% |
| **Japon** | ~¥1T/an (déclin) | Uridashi | Nikkei 225 | 50-65% | 1-5 ans | 3-8% |

## 2. Les 3 types d'autocall

### Phoenix Autocall (France/Europe, notre modèle)
- Coupon payé **à chaque observation** si stock > coupon barrier (60-80%)
- Autocall si stock > 100%
- Memory coupon : si coupon raté à Q1, récupéré à Q2 si stock remonte
- Standard en France (SocGen, BNP, Natixis)
- 96-98% des produits structurés français ont rendu un gain aux investisseurs (2019-2020, données AMF)

### Classic Autocall / Athena (UK)
- Coupon **accumulé**, payé uniquement à l'autocall
- Step-down : barrier d'autocall diminue chaque année (100% → 95% → 90% → 85%...)
- Maturité longue : 5-10 ans
- Si autocall en année 4 à 8%/an → investisseur reçoit 32% d'un coup
- Produit Citi typique : FTSE 100, 6 ans, KI 60%, 8%/an accumulé

### Autocallable Contingent Coupon Notes (USA)
- Hybride : coupon conditionnel mensuel/trimestriel (comme Phoenix) + maturité courte (1-2 ans)
- Worst-of baskets d'indices ou single stocks
- Goldman Sachs best-seller Q1 2024 : worst-of S&P/Nasdaq/Russell, 8.89% p.a., 30% downside protection
- GS a fait $4.2 Mds en Q1 2024 seul (+100% YoY)
- BNP Paribas : $11 Mds aux US en 2025

## 3. Goldman Sachs — Le benchmark direct

GS vend des autocalls sur **exactement les mêmes actions** que nos xStocks.

### GS Worst-of NVDA/AAPL/TSLA (SEC filing 2024)

| Paramètre | Goldman Sachs | xYield Notes (actuel) | xYield Notes (cible) |
|---|---|---|---|
| Sous-jacent | NVDA + AAPL + TSLA | NVDAx + AAPLx + TSLAx | Idem |
| Coupon | 15.65% p.a. (mensuel) | 12-20% p.a. (trimestriel) | CRE Monte Carlo |
| Coupon barrier | 60% | 80% | 55-65% |
| Autocall barrier | 100% | 100% | 100% |
| KI barrier | **50%** | 70% | **50-60%** |
| Memory coupon | Oui | Oui (architecture) | Oui |
| Maturité | 2 ans | 3-12 mois | **12-24 mois** |
| Settlement | Cash (USD) | Physical delivery (xStocks) | Physical delivery |
| Accès | Broker-dealer, accredited | Permissionless, onchain | Permissionless |
| Fee | ~2-3% embedded | 0.5% | 0.5% + perf fee |

### GS Single Stock TSLA (SEC filing 2024)
- Coupon : 13-14% p.a. trimestriel conditionnel
- Coupon barrier : **50%**
- KI barrier : **50%**
- Memory coupon : oui
- Maturité : 2 ans

### GS Single Stock NVDA (SEC filing 2024)
- Coupon barrier : **50%** ($88.91 sur prix initial $177.82)
- Structure similaire au TSLA

**Insight clé** : GS offre BEAUCOUP plus de protection que notre modèle actuel (KI 50% vs 70%) tout en payant un coupon comparable (14-16% p.a.). La raison : la maturité de 2 ans donne plus de time value → le fair coupon est naturellement plus élevé.

## 4. Crises et warnings

### Corée — Scandale HSCEI (2023-2024)
- Le Hang Seng China Enterprises Index a chuté ~50%
- $5B+ de pertes pour les investisseurs retail coréens en ELS liés au HSCEI
- Les banques accusées de mis-selling
- Conséquence : ventes ELS -76% en S2 2024, régulation durcie
- Leçon : le choix du sous-jacent est CRITIQUE

### Chine — Interdiction des Snowballs (oct 2024)
- KI à 70-80% (trop agressif) + coupon 15-25% (trop élevé) + sous-jacent volatil
- Quand le CSI 500 a chuté, les knock-ins en masse ont AMPLIFIÉ la baisse (delta hedging → vente d'actions → plus de baisse → plus de KI → spirale)
- SAC a interdit les snowballs non protégés en capital
- Minimum d'investissement relevé de 1M à 10M yuan ($1.4M)
- Leçon : KI agressif + sous-jacent volatil = risque systémique

### Japon — Déclin des Uridashi (2022-2024)
- FSA enquête sur les pratiques de vente depuis juin 2022
- Ventes H2 2024 : -19% (privé), -57% (public)
- Krach Nikkei août 2024 (-12% en un jour) : hedgers ont subi des pertes massives
- Leçon : la régulation arrive toujours après une crise

## 5. Backtesting — Résultats des 34 simulations

### Paramètres de simulation
- 11 xStocks : NVDAx, TSLAx, AAPLx, COINx, METAx, NFLXx, AMZNx, MSFTx, MRKx, MCDx, HOODx
- 4 timelines : Mar 2025 (creux), Jun 2025 (pic), Sep 2025 (rotation), Dec 2025 (bear)
- Barriers : AC 100%, coupon 80%, KI 70%
- Delta-hedging Black-Scholes (Merton 1973 pour barrier options)
- Euler yield 5% APY sur idle USDC

### Distribution des outcomes

| Outcome | Count | % | TradFi référence |
|---|---|---|---|
| Autocall | 21 | 62% | 65-75% (sur 1-3 ans) |
| Maturity (no KI) | 10 | 29% | 15-25% |
| Knock-in delivery | 3 | 9% | 5-10% |

### Investor returns

| Métrique | Valeur | TradFi comparable |
|---|---|---|
| Win rate | 91% | 85-95% |
| Return moyen | +0.4% par note | +5-10% (maturité plus longue) |
| Annualisé (cas favorables) | 8-21% | 6-18% |
| Perte max | -46.8% (HOODx KI) | -50 à -70% |

### Underwriter returns

| Métrique | Valeur | Commentaire |
|---|---|---|
| Win rate | 38% | Profil "vol arb", pas yield farming |
| Return moyen | +8.5% | Positif grâce aux tail wins |
| Best case | +137.9% (HOODx Mar, rally x2.25) | Gamma positif en bull |
| Worst case | -80.1% (NFLXx Jun, dead zone) | Chute modérée sans KI |

### Analyse par régime de marché

| Régime | Timeline | Inv moyen | UW moyen |
|---|---|---|---|
| Bull (post-crash) | Mar 2025 | +5.0% | +42.1% |
| Bear (post-pic) | Jun 2025 | +2.2% | -15.9% |
| Rotation | Sep 2025 | +1.2% | +3.2% |
| Mild bear | Dec 2025 | +2.5% | -19.8% |

### La "Dead Zone" — Le pire scénario pour l'UW
Stock baisse 10-30% SANS toucher le KI (70%). L'investisseur est protégé (récupère $10k + coupons). L'UW absorbe toute la perte du delta-hedge + coupons payés. Pertes UW de -16% à -80%.

Inversement si le stock touche le KI (< 70%), l'investisseur prend la perte (physical delivery), l'UW garde le cash Euler → profit +60-69%.

**1% de différence sur le stock = inversion totale du P&L entre investisseur et UW.**

### Tier list des stocks pour autocall

| Tier | Stocks | Verdict |
|---|---|---|
| Tier 1 — Idéal | AAPLx, MCDx, AMZNx, MRKx | Vol modérée, profil stable, conforme TradFi |
| Tier 2 — Bon | MSFTx, METAx, NVDAx | Vol plus haute, sensible au timing d'entrée |
| Tier 3 — Risqué | TSLAx, NFLXx | Vol élevée, nécessite KI à 50-55% |
| Tier 4 — Dangereux | COINx, HOODx | Vol >70%, jamais proposé en TradFi. KI minimum 40-50% |

## 6. Ajustements nécessaires (alignement GS)

| Paramètre | Avant | Après | Justification |
|---|---|---|---|
| KI barrier | 70% fixe | 50-60% variable | GS utilise 50%. 50% high-vol, 60% mid-vol, 65% low-vol |
| Coupon barrier | 80% fixe | 55-65% variable | GS utilise 50-60% |
| Maturité | 3-12 mois | 12-24 mois | GS fait 2 ans. Plus de time value = meilleur fair coupon |
| Coupon | Fixe par vol bucket | CRE Monte Carlo | Fair coupon calibré dynamiquement par stock |
| Memory coupon | Non implémenté | Oui | Standard GS et Europe |
| UW deposit | 20-30% notionnel | 30-50% | Réduire le levier, attirer les UW |
| Hedging | Aux observations uniquement | + triggers prix ±5% | Réduire gamma exposure via Chainlink Automation |

## 7. Positionnement stratégique

### Cible : DeFi global (pas France ni US directement)
- Investisseurs crypto-native qui veulent de l'exposition equity structurée
- Treasuries de DAOs qui veulent du enhanced yield sur USDC
- Market makers / fonds quant qui veulent underwrite (côté UW)
- Globaux, pas limités à une juridiction

### Marché France (€42 Mds)
- Pour : appétit énorme, Phoenix = standard, demande US exposure
- Contre : distribution via assurance-vie (pas compatible DeFi), AMF, retail peu crypto-native

### Marché US ($40 Mds)
- Pour : GS vend déjà le même produit ($4.2 Mds/trimestre), demande prouvée
- Contre : SEC/FINRA scrutiny, besoin de license broker-dealer, amende $132.5M en mars 2025

### Marché DeFi ($0 — blue ocean)
- Aucun autocall fonctionnel sur equities onchain
- Protocoles morts (Cega, Friktion, Ribbon) = vaults crypto, pas de vrais autocalls
- xYield serait le PREMIER Phoenix autocall sur tokenized equities onchain

### Le pitch
> "Autocalls: $125B+ in annual issuance, 50% of all new structured products. Same product Goldman Sachs sells for 2% fees — rebuilt onchain, permissionless, 0.5% fees, real xStock delivery."

## 8. Sources

- [Autocallable Notes Market Research 2033 — Dataintelo](https://dataintelo.com/report/autocallable-notes-market)
- [GS Finance Corp notes NVDA/AAPL/TSLA — SEC Filing](https://www.stocktitan.net/sec-filings/GS/424b2-goldman-sachs-group-inc-prospectus-supplement-f64e859548f7.html)
- [GS Tesla-linked autocallable notes — SEC Filing](https://www.stocktitan.net/sec-filings/GS/424b2-goldman-sachs-group-inc-prospectus-supplement-f2c80dc480fe.html)
- [GS $40.26M NVDA-Linked Notes — SEC Filing](https://www.stocktitan.net/sec-filings/GS/424b2-goldman-sachs-group-inc-prospectus-supplement-c6ceabc3236e.html)
- [GS record sales in US — SRP](https://www.structuredretailproducts.com/insights/79888/gs-achieves-record-sales-in-us-strong-markets-revenue-in-q1)
- [AMF/ACPR Cartographie Produits Structurés 2024](https://www.amf-france.org/sites/institutionnel/files/private/2025-03/cartographie-pole-commun-2024.pdf)
- [Produits structurés 2025 : alertes AMF-ACPR](https://bienvenue.fees-and-you.com/produits-structures-2025/)
- [UK Guide to Autocalls 2024 — UKSPA](https://www.ukspassociation.co.uk/assets/A%20Guide%20to%20Autocalls.pdf)
- [South Korea ELS rebound — SRP](https://www.structuredretailproducts.com/insights/80052/south-korea-market-review-may-2024-autocall-sales-bounce-back-els-volume-soars-by-60)
- [China snowball regulations — SRP](https://www.structuredretailproducts.com/insights/79908/chinas-regulator-moves-to-curb-snowball-issuance)
- [Japan Uridashi decline H2 2024 — SRP](https://www.structuredretailproducts.com/insights/80669/japans-structured-uridashi-sales-take-a-dive-in-h2-24)
- [Phoenix Autocall vs Classic — Fincyclopedia](https://www.fincyclopedia.net/finance/tutorials/difference-between-autocall-and-phoenix-autocall)
- [Phoenix Autocall définition — Finance de Marché](http://financedemarche.fr/finance/phoenix-autocall-definition-payoff-dun-produit-structure-a-coupons)
- [France performance 2019/2020: only 2% losses — SRP](https://www.structuredretailproducts.com/insights/76505/france-performance-analysis-20192020-only-2-of-structured-products-maturing-returned-losses)

---

## 9. Product-Market Fit Analysis

### 9.1 Pourquoi les structured products DeFi ont échoué

| Protocole | Peak TVL | Statut | Cause de la mort |
|---|---|---|---|
| Ribbon Finance | $300M | Fusionné → Aevo (exchange) | Covered calls trop simple, marges faibles, pivoted to exchange |
| Friktion | ~$50M | Dead (jan 2023) | Coûts > revenus, founder disagreement |
| Cega | ~$30M | Alive mais niche | Exotic basket options trop complexes |

4 problèmes communs :
1. **Sous-jacent crypto-only** : Vaults ETH/BTC, drawdowns massifs en bear market 2022
2. **Produit mal calibré** : Trop simple (covered calls) ou trop complexe (exotic baskets)
3. **Pas de marché secondaire** : Positions lockées, pas de sortie
4. **Un seul côté** : Pas de two-sided marketplace, pas de network effect

### 9.2 Notre différenciation

| Problème | xYield solution |
|---|---|
| Crypto underlyings | **Equities (xStocks)** — vol contrôlée, $125B+/an de demande TradFi prouvée |
| Produit mal calibré | **Phoenix autocall** — #1 produit structuré mondial (€42B/an en France) |
| Pas de secondaire | **ERC-1155** positions transférables et tradables |
| One-sided | **Two-sided marketplace** : investisseur + UW + protocole |

### 9.3 Le marché des stablecoins : $300B sans yield natif

| Protocole | TVL | Yield USDC | Type |
|---|---|---|---|
| Aave | ~$15B | 4-7% | Lending |
| Compound | ~$3B | 3-5% | Lending |
| Morpho | ~$4B | 4-7% | Lending optimisé |
| Euler | ~$1B | 5-8% | Lending (partenaire hackathon) |
| Pendle | $5.7B avg | 5-20% fixe | Yield tokenization |
| Etherfi Cash | ~$500M | 9-10% | Market-neutral |
| **xYield (investor)** | — | **8-16%** | **Autocall equity-linked** |
| **xYield (UW)** | — | **8%+ avg** | **Gamma/vol exposure** |

xYield se positionne entre le lending safe (4-7%) et le yield degen (20%+). Seul produit offrant du equity-linked structured yield en DeFi.

### 9.4 PMF par segment

#### Segment 1 : Crypto-native investors (equity exposure)
- **Taille** : 80k+ holders xStocks (mars 2026: 185k, market cap $1B)
- **Problème** : Holder xStocks = price exposure brut, pas de yield, pas de protection
- **Solution** : Dépose USDC → Earn 12-16% APY via Phoenix autocall. Protégé jusqu'à -50%
- **Pitch** : "Earn 12% APY on USDC. Protected unless NVIDIA drops 50%. Better than Aave (5%), safer than holding NVDAx directly."
- **PMF** : Fort. xStocks ecosystem en explosion, users veulent des PRODUITS pas juste du spot

#### Segment 2 : Treasuries de DAOs
- **Taille** : Billions en USDC idle (Uniswap $3B, Lido, Aave, Arbitrum DAO)
- **Problème** : 4-7% sur Aave/Compound, pas de structured products
- **Solution** : Dépose treasury USDC → Blue Chip basket (AAPL/MSFT/AMZN), KI 50%, 12mo, 10-12%
- **Pitch** : "Double your treasury yield vs Aave. 12% on USDC with -50% protection. Auditable onchain."
- **PMF** : Très fort. 1inch DAO a déjà voté pour optimiser le treasury yield via lending

#### Segment 3 : Market makers / Quant funds (UW)
- **Taille** : Wintermute, Jump, Amber, DWF Labs, quant funds crypto
- **Problème** : Vol arb limité aux options crypto (Derive, Aevo). Pas de put selling sur equities onchain
- **Solution** : Underwrite = long gamma sur autocalls equity. Expected +8.5%, tail wins +60-138%
- **Pitch** : "Underwrite Goldman Sachs's most popular product — onchain, permissionless. Be the bank."
- **PMF** : Fort mais niche. 5-10 UW sophistiqués pour commencer

#### Segment 4 : xStocks ecosystem builders
- **Opportunity** : xPoints program (mars 2026) récompense les builders/traders
- **Notre edge** : Delta-hedging = volume massif de trades xStocks → xPoints pour le protocole
- **Pitch** : "xYield is one of the largest xStocks consumers onchain. We generate continuous trading volume via delta-hedging."

### 9.5 Competitive landscape

| Concurrent | Ce qu'il fait | Pourquoi on gagne |
|---|---|---|
| Pendle ($5.7B) | Fixed yield DeFi | Pas equity-linked. Potentiel d'intégration (tokeniser nos notes sur Pendle) |
| Derive/Lyra | Options crypto | Crypto-only, pas d'equities, pas d'autocall |
| Aevo (ex-Ribbon) | Options exchange | Plus de structured products — pivoted |
| Goldman Sachs ($4.2B/q) | Autocalls NVDA/TSLA/AAPL | Même produit mais accredited-only, 2-3% fees. Nous = permissionless, 0.5% |
| Falcon Finance | xStocks as collateral | Collateral, pas structured yield. Complémentaire |

### 9.6 Moat

1. **First mover** : premier autocall equity onchain
2. **xStocks ecosystem** : intégré aux 70+ tokens, 1inch, Chainlink, Euler
3. **Two-sided marketplace** : network effect investisseur ↔ underwriter
4. **Physical delivery** : vrais xStocks tokens (pas cash settlement)
5. **Composabilité** : ERC-1155 tradable, Pendle integration possible
6. **Auto-roll ERC-7579** : "Deposit once, earn yield forever"

### 9.7 xStocks ecosystem data

- Launched: June 2025 (Solana), September 2025 (Ethereum)
- Trading volume: $3.5B onchain, $25B total across exchanges
- Onchain assets: $225M+
- Holders: 80,000 onchain (185k+ including exchange)
- Tokens: 70+ (55 stocks + 5 ETFs + growing)
- Kraken acquired Backed Finance: December 2025
- xChange: unified execution layer, 24/5 on Ethereum + Solana
- xPoints: rewards program for traders, LPs, DeFi builders (March 2026)
- Partners: 1inch (swaps), Chainlink (data), Falcon Finance (collateral)
- Market cap tokenized stocks sector: $1B (March 2026, up from $20M Dec 2024)

### 9.8 Product design recommendations

**Pour l'investisseur — "Protected Equity Yield" (pas "Phoenix Autocall")**
- UX en 3 étapes : choisis basket → dépose USDC → reçois yield
- Baskets prédéfinis : "US Tech" (NVDA/AAPL/TSLA), "Blue Chip" (AAPL/MSFT/AMZN), "High Yield" (TSLA/COIN)
- Afficher : expected yield, protection level, duration, risk score, historical win rate
- Auto-roll via ERC-7579 : "Deposit once, earn yield forever"

**Pour l'UW — "Structured Yield Underwriting"**
- Dashboard pro : Greeks en temps réel, pool composition, P&L historique
- Risk metrics : VaR, max drawdown, Sharpe ratio
- Comparable à un "volatility fund" onchain

## 10. Catalogue complet des produits structurés

### 10.1 Les 15 types de produits structurés

| # | Produit | Mécanisme | Part émissions TradFi | Complexité Solidity |
|---|---|---|---|---|
| 1 | **Phoenix Autocall** | Coupon conditionnel à chaque obs + rappel si stock > 100% + KI protection | ~35% | Moyenne |
| 2 | **Classic Autocall (Athena)** | Coupon accumulé, payé à l'autocall. Step-down barriers | ~15% | Moyenne |
| 3 | **Barrier Reverse Convertible (BRC)** | Coupon GARANTI fixe + KI : si barrier touchée → livraison stock | ~10-15% | Facile |
| 4 | **Capital Protected Note (CPN)** | 100% capital protégé + participation partielle hausse (50-80%) | ~25-30% (encours) | Facile |
| 5 | **Reverse Convertible (RC)** | Coupon garanti élevé, pas de barrier → si stock < strike, livraison | ~3-5% | Très facile |
| 6 | **Discount Certificate** | Achète le stock à prix réduit, upside cappé | ~5% (DACH) | Très facile |
| 7 | **Bonus Certificate** | Participe 1:1 à la hausse + bonus minimum si barrier pas touchée | ~3-4% | Facile |
| 8 | **Shark Fin** | Participation à la hausse jusqu'à cap. Si cap touché → rebate fixe | ~2% (Asie) | Moyenne |
| 9 | **Twin Win** | Profit si stock monte OU descend, perte seulement si KI touché | ~1% | Moyenne-Hard |
| 10 | **Range Accrual** | Coupon s'accumule chaque jour où stock reste dans range [L, H] | ~2% | Hard |
| 11 | **Snowball** | Autocall chinois : coupon accumulé "boule de neige" + KI + KO | ~2% (Chine) | Moyenne |
| 12 | **Accumulator** | Obligation d'acheter X actions/jour à prix réduit. Flash crash = forced buying | ~1% (HK/SG) | Hard |
| 13 | **Digital / Binary Note** | Paye coupon fixe si condition remplie (stock > X), sinon rien | ~2% | Très facile |
| 14 | **Outperformance Certificate** | Leverage 1.5-2x sur hausse au-dessus du strike, 1:1 à la baisse | ~1% | Facile |
| 15 | **Express Certificate** | Variante allemande de l'autocall, observation annuelle, step-down | ~3% (DACH) | Moyenne |

### 10.2 Scoring hackathon (pondéré par critères judges)

Critères : Demande TradFi (25%), Implémentation (20%), Two-sided marketplace (20%), UX crypto-native (15%), Innovation (10%), Composabilité DeFi (10%)

| Produit | Demande | Impl. | Two-sided | UX | Innov. | Compos. | **Score** |
|---|---|---|---|---|---|---|---|
| **Phoenix Autocall** | 5 | 3 | 5 | 4 | 5 | 4 | **4.35** |
| **BRC** | 4 | 5 | 4 | 5 | 3 | 3 | **4.05** |
| **Classic Autocall** | 4 | 3 | 5 | 3 | 4 | 4 | **3.85** |
| **Reverse Convertible** | 3 | 5 | 4 | 5 | 2 | 3 | **3.60** |
| **Capital Protected** | 5 | 4 | 2 | 5 | 2 | 3 | **3.55** |
| **Express Certificate** | 3 | 3 | 5 | 3 | 3 | 4 | **3.55** |
| **Digital Note** | 2 | 5 | 3 | 5 | 2 | 4 | **3.30** |
| **Discount Certificate** | 3 | 5 | 3 | 4 | 2 | 3 | **3.30** |
| **Bonus Certificate** | 3 | 4 | 3 | 4 | 2 | 3 | **3.15** |
| **Shark Fin** | 2 | 3 | 3 | 3 | 4 | 3 | **2.90** |
| **Snowball** | 2 | 3 | 4 | 2 | 3 | 3 | **2.85** |
| **Twin Win** | 1 | 2 | 3 | 3 | 4 | 3 | **2.50** |
| **Outperformance** | 1 | 4 | 2 | 4 | 2 | 3 | **2.50** |
| **Range Accrual** | 2 | 2 | 3 | 2 | 3 | 3 | **2.45** |
| **Accumulator** | 1 | 1 | 2 | 1 | 3 | 2 | **1.60** |

**Verdict : Phoenix Autocall gagne dans toutes les dimensions clés.**

### 10.3 Pourquoi Phoenix > alternatives (analyse détaillée)

**Phoenix Autocall vs BRC** : Le BRC est plus simple (coupon garanti, pas de logique autocall), mais il manque le "wow factor" : pas de rappel anticipé, pas de step-down, pas de memory coupon. Surtout, le BRC est one-sided — l'UW ne peut pas profiter activement d'une stratégie de vol. Le Phoenix crée un vrai two-sided marketplace.

**Phoenix Autocall vs Capital Protected** : Le CPN garantit 100% du capital → yield faible (3-5%). Le problème DeFi : qui garantit le capital ? Il faut un issuer solvable (une banque). En DeFi, personne ne garantit rien. Le Phoenix résout ce problème en rendant le risque explicite et rémunéré.

**Phoenix Autocall vs Reverse Convertible** : Le RC est un put nu vendu par l'investisseur — pas de barrier, pas de protection. Trop risqué pour du retail, trop simple pour impressionner les judges.

### 10.4 Vision Platform — "L'Uniswap des produits structurés"

```
xYield Protocol (architecture extensible)
├── Vault Engine (shared core)
│   ├── Deposit/Withdraw USDC
│   ├── Oracle integration (Chainlink Data Streams)
│   ├── Euler yield on idle USDC
│   └── ERC-1155 position tokens
│
├── Product Templates (chaque produit = 1 template)
│   ├── PhoenixAutocall.sol    ← HACKATHON MVP
│   ├── BRC.sol                ← V2 (2 semaines post-hack)
│   ├── ReverseConvertible.sol ← V2
│   ├── CapitalProtected.sol   ← V3
│   ├── DigitalNote.sol        ← V3
│   └── ... (extensible via factory pattern)
│
├── Risk Engine (shared)
│   ├── Delta-hedging module
│   ├── Monte Carlo CRE pricing
│   └── Liquidation / settlement logic
│
└── Distribution Layer (shared)
    ├── Auto-roll (ERC-7579)
    ├── Pendle integration (yield tokenization)
    └── Secondary market (ERC-1155 trades)
```

Chaque Product Template définit :
- `PayoffEngine` : logique de paiement (autocall, BRC, CPN...)
- `ObservationSchedule` : quand observer (daily, weekly, quarterly, at maturity)
- `BarrierConfig` : KI, KO, coupon barrier, step-down...
- `CouponLogic` : conditional, guaranteed, accumulated, memory...

**Roadmap :**
- Phase 1 : Phoenix Autocall (hackathon)
- Phase 2 : + BRC + Reverse Convertible (post-hack)
- Phase 3 : + Capital Protected + Digital Notes (avec Pendle)
- Phase 4 : xRisk Market — anyone creates custom structured products

**Pitch : "We're not building one product. We're building the Uniswap of structured products — starting with the $125B/year autocall market."**

## 11. Additional Sources

- [Ribbon/Aevo merger — Blockworks](https://blockworks.co/news/ribbon-finance-governance-approves-aevo-brand-merger)
- [Friktion shutdown — CoinDesk](https://www.coindesk.com/tech/2023/01/30/defi-project-friktions-shutdown-said-to-stem-partly-from-founder-disagreement)
- [Pendle $5.7B TVL — DeFi Llama](https://defillama.com/protocol/pendle)
- [Pendle $69.8B settled — DL News](https://www.dlnews.com/external/pendle-settles-698-billion-in-yield-bridging-the-140t-fixed-income-market-to-crypto/)
- [xStocks launch on Ethereum — Kraken Blog](https://blog.kraken.com/product/xstocks/launch-on-ethereum)
- [Kraken acquires Backed — CoinTelegraph](https://cointelegraph.com/news/kraken-backed-finance-2025-acquisition-xstocks-tokenization)
- [xStocks xPoints program — CoinDesk](https://www.coindesk.com/business/2026/03/10/kraken-s-tokenized-stock-venue-starts-points-program-hinting-at-possible-ecosystem-token)
- [xStocks xChange — The Block](https://www.theblock.co/post/392466/kraken-unified-execution-layer-xstocks-tokenized-equities-xchange)
- [RWA market $18.6B — The Defiant](https://thedefiant.io/news/defi/rwas-became-wall-street-s-gateway-to-crypto-in-2025)
- [Tokenized stocks $1B market cap — RWA.xyz](https://app.rwa.xyz/stocks)
- [Institutional structured products — Marex](https://solutions.marex.com/news/2025/07/institutional-crypto-adoption-via-structured-products/)
- [DAO treasury strategies — OnChain Treasury](https://onchaintreasury.org/2025/12/08/dao-treasury-strategies-using-tokenized-us-treasuries-and-stablecoin-vaults-2025/)
- [DeFi Options & Derivatives 2024-2025 — Opium/Medium](https://medium.com/opium-network/defi-options-derivatives-in-2024-2025-trends-and-key-platforms-2579f1e45927)
