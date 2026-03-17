# xYield — Contract Specification v2

> Spec contract-ready. Définitions verrouillées, waterfall comptable,
> state machine produit, séparation pricing vs issuance policy.
> Ce document est la référence pour l'implémentation Solidity.

---

## 1. Définitions verrouillées

### 1.1 Coupon

```
coupon_annual_bps : uint256
    Taux annualisé en basis points.
    Exemple : 750 = 7.50% par an.

coupon_per_observation : uint256
    = coupon_annual_bps × days_between_observations / 365
    Pour mensuel (30j) : 750 × 30 / 365 = 61.6 bps = 0.616% du notional

coupon_amount : uint256
    = notional × coupon_per_observation / 10000
    Pour $10,000 notional, mensuel, 7.5% ann :
    = $10,000 × 61.6 / 10000 = $61.60 par observation

    Si carry enhancement = 300 bps (3%) :
    coupon_enhance_per_obs = 300 × 30 / 365 = 24.6 bps
    enhance_amount = $10,000 × 24.6 / 10000 = $24.60

    TOTAL par observation = $61.60 + $24.60 = $86.20
```

### 1.2 Memory coupon

```
memory_coupon : bool = true (toujours activé, standard Phoenix)

Fonctionnement :
    Si observation K : worst < coupon_barrier
        → coupon non payé, mais ACCUMULÉ dans missed_coupons
        → missed_coupons += coupon_amount

    Si observation K+n : worst ≥ coupon_barrier
        → coupon payé = coupon_amount + missed_coupons
        → missed_coupons = 0

    Le memory s'applique UNIQUEMENT au base coupon.
    Le carry enhancement des observations ratées est PERDU.
    (Le protocole ne rembourse pas un carry qui n'existait peut-être plus.)

    En Solidity :
    struct NoteState {
        uint256 missedBaseCoupons;      // accumulé, remboursable
        uint256 missedCarryEnhance;     // perdu, pas remboursé
    }
```

### 1.3 Carry enhancement

```
CALCUL AU MOMENT DE L'ÉMISSION :
─────────────────────────────────
carry_rate_input : trailing 7-day TWAP du funding rate annualisé
    = Σ(funding_rate_8h × 3 × 365) sur les 21 dernières périodes / 21

carry_share_rate : déterminé par ReserveFund.getMaxCarryShare()
    reserve ≥ target (10%) → 3000 (30%)
    min ≤ reserve < target → 1500 (15%)
    reserve < min (3%)    → 0

carry_enhancement_bps : uint256
    = carry_rate_input × carry_share_rate / 10000
    Cap : MAX_CARRY_ENHANCE = 500 bps (5% ann)

FIXÉ À L'ÉMISSION :
────────────────────
Le carry enhancement est calculé à createNote() et GRAVÉ dans le NoteToken.
Il ne change PAS pendant la vie de la note.

Pourquoi fixé :
    → Le retail sait exactement ce qu'il va recevoir
    → Pas de surprise si le funding rate change
    → Plus simple à implémenter
    → Le risque de carry mismatch est porté par le protocole
      (absorbé par le reserve fund si besoin)
```

### 1.4 Safety margin

```
DYNAMIQUE, lié au régime de vol :
─────────────────────────────────
avg_vol = moyenne des vols implicites du basket

safety_margin_bps : uint256
    Si avg_vol ≥ 50% :  safety_margin = 200 bps (2.0%)  → vol haute = plus de marge
    Si avg_vol 35-50% : safety_margin = 150 bps (1.5%)  → normal
    Si avg_vol < 35% :  safety_margin = 100 bps (1.0%)  → vol basse

Justification :
    En vol haute, le pricing a plus d'incertitude.
    Plus de marge = plus de protection pour le protocole.
    C'est standard sur les desks structurés.
```

### 1.5 Formule complète verrouillée

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  base_coupon_bps = option_premium_bps − safety_margin_bps       │
│                                                                 │
│  carry_enhance_bps = min(                                       │
│      funding_twap_7d × carry_share_rate / 10000,                │
│      MAX_CARRY_ENHANCE                                          │
│  )                                                              │
│                                                                 │
│  total_coupon_bps = base_coupon_bps + carry_enhance_bps         │
│                                                                 │
│  coupon_per_obs = total_coupon_bps × obs_interval_days / 365    │
│                                                                 │
│  coupon_amount = notional × coupon_per_obs / 10000              │
│                                                                 │
│  INVARIANTS :                                                   │
│  • base_coupon_bps ≤ option_premium_bps                         │
│  • carry_enhance_bps ≤ 500 (5% ann max)                         │
│  • total_coupon_bps fixé à l'émission, immuable                 │
│  • memory s'applique au base coupon uniquement                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Pricing vs Issuance Policy

### 2.1 Pricing Result (output mathématique)

Le pricer est un ORACLE. Il observe et calcule. Il ne décide rien.

```solidity
struct PricingResult {
    uint256 putPremiumBps;        // fair value du put (ann bps)
    uint256 kiProbabilityBps;     // probabilité KI (bps, ex: 830 = 8.3%)
    uint256 expectedKILossBps;    // perte attendue si KI (bps du notional)
    uint256 avgTimeToAutocall;    // jours moyens avant autocall
    uint256 vegaBps;              // sensibilité à la vol (bps / 1% vol)
    uint256 timestamp;            // quand le pricing a été fait
    bytes32 mcHash;               // hash du MC off-chain pour vérification
}
```

**Ce que le pricer dit :**
> "Pour ce basket, avec ces vols et corrélations, le worst-of put vaut 920 bps annualisés.
> La probabilité de KI est 8.3%. Le temps moyen avant autocall est 3.1 mois."

**Ce que le pricer NE dit PAS :**
> "Le coupon devrait être X." ← c'est la politique d'émission qui décide.

### 2.2 Issuance Policy (décision du protocole)

La politique transforme le pricing en paramètres de note.

```solidity
struct IssuancePolicy {
    uint256 minPremiumBps;         // 300 = 3% min pour émettre
    uint256 maxKIProbBps;          // 1500 = 15% max KI prob
    uint256 safetyMarginLowVol;    // 100 bps
    uint256 safetyMarginMidVol;    // 150 bps
    uint256 safetyMarginHighVol;   // 200 bps
    uint256 volThresholdLow;       // 35% (3500)
    uint256 volThresholdHigh;      // 50% (5000)
    uint256 maxCarryEnhanceBps;    // 500 = 5% max
    uint256 carryShareRate;        // 3000 = 30% du funding → retail
    uint256 minFundingForCarry;    // 300 = 3% min funding pour carry
    uint256 maxVolStaleness;       // 24 hours
    uint256 minReserveRatio;       // 300 = 3%
    uint256 criticalReserveRatio;  // 100 = 1%
}
```

**Ce que la politique dit :**
> "Le pricer dit premium = 920 bps. On applique une marge de 150 bps.
> Base coupon autorisé = 770 bps. Le funding est à 12%, on partage 30% = 360 bps
> cappé à 300 bps. Total coupon = 1070 bps. Émission approuvée."

### 2.3 Le flux complet

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  MARKET DATA │     │   PRICER     │     │   POLICY     │
│              │     │              │     │              │
│ Spot prices  │────→│ MC / Approx  │────→│ Apply rules  │
│ Impl. vols   │     │              │     │              │
│ Correlations │     │ premium=920  │     │ margin=150   │
│ Funding rate │     │ KI prob=8.3% │     │ base=770     │
│              │     │ avg AC=3.1mo │     │ carry=300    │
│              │     │              │     │ total=1070   │
└──────────────┘     └──────┬───────┘     └──────┬───────┘
                            │                     │
                     OBSERVE & CALCULE      DÉCIDE & CONTRAINT
                     (pas de jugement)      (risk management)
                            │                     │
                            ▼                     ▼
                    ┌─────────────────────────────────┐
                    │         CREATE NOTE              │
                    │                                  │
                    │  baseCoupon: 770 bps             │
                    │  carryEnhance: 300 bps           │
                    │  totalCoupon: 1070 bps            │
                    │  kiBarrier: 5000 (50%)           │
                    │  couponBarrier: 7000 (70%)       │
                    │  autocallTrigger: 10000 (100%)   │
                    │  stepDown: 200 (2% per obs)      │
                    │                                  │
                    │  TOUS CES PARAMÈTRES SONT        │
                    │  IMMUABLES APRÈS CRÉATION.        │
                    └─────────────────────────────────┘
```

---

## 3. Waterfall comptable

### 3.1 Sources de cash (inflows)

```
INFLOWS (par ordre de fréquence) :
──────────────────────────────────
1. Funding rate          │ toutes les 8h  │ variable │ CarryEngine
2. Euler lending yield   │ continu        │ stable   │ EulerStrategy
3. Embedded fee          │ à l'émission   │ fixe     │ AutocallEngine
4. Origination fee       │ à l'émission   │ fixe     │ AutocallEngine
5. Management fee        │ par epoch      │ fixe     │ FeeCollector
6. Performance fee       │ par epoch      │ variable │ FeeCollector
7. Auto-roll fee         │ au roll        │ fixe     │ AutocallEngine
8. KI payoff             │ au settlement  │ rare     │ HedgeManager
```

### 3.2 Waterfall de paiement (outflows) — ORDRE DE PRIORITÉ

```
┌─────────────────────────────────────────────────────────────┐
│                    CASH WATERFALL                            │
│                                                             │
│  Quand du cash est disponible, il est distribué dans cet    │
│  ordre STRICT. Chaque niveau doit être satisfait avant      │
│  de passer au suivant.                                      │
│                                                             │
│  PRIORITÉ 1 — SENIOR : Coupon base (obligation retail)      │
│  ──────────────────────────────────────────────────────     │
│  Les coupons base dus aux holders sont payés EN PREMIER.    │
│  C'est une obligation. Le retail a acheté un produit        │
│  avec un coupon calculé par option pricing.                 │
│  Source principale : option economics (KI payoffs).         │
│  Backup : reserve fund.                                     │
│                                                             │
│  PRIORITÉ 2 — SENIOR : Principal repayment                  │
│  ──────────────────────────────────────────────────────     │
│  Quand autocall trigger ou maturité sans KI :               │
│  le principal doit être remboursé intégralement.            │
│  Source : le hedge delta-neutre (spot + perp = notional).   │
│  C'est mécaniquement garanti tant que le hedge est sain.    │
│                                                             │
│  PRIORITÉ 3 — MEZZANINE : Carry enhancement (retail)        │
│  ──────────────────────────────────────────────────────     │
│  Le carry enhancement promis au retail.                     │
│  Fixé à l'émission mais payé par le funding rate courant.   │
│  Si funding < carry enhancement promis :                    │
│    → Reserve fund couvre le déficit                          │
│    → Si reserve insuffisant → carry non payé ce mois        │
│    → Le carry enhancement N'EST PAS une dette (pas memory)  │
│                                                             │
│  PRIORITÉ 4 — JUNIOR : Hedge costs                          │
│  ──────────────────────────────────────────────────────     │
│  Gas pour rebalancing, slippage sur swaps 1inch,            │
│  coûts de marge Aster. Opérationnels.                       │
│                                                             │
│  PRIORITÉ 5 — JUNIOR : Reserve fund contribution            │
│  ──────────────────────────────────────────────────────     │
│  30% du carry net → reserve fund.                           │
│  100% si reserve < minimum.                                 │
│  0% si reserve ≥ target et priorités 1-4 satisfaites.      │
│                                                             │
│  PRIORITÉ 6 — EQUITY : Protocol treasury                    │
│  ──────────────────────────────────────────────────────     │
│  Ce qui reste après priorités 1-5.                          │
│  = profit net du protocole.                                 │
│  Distribué aux stakers / governance token holders.          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Waterfall en Solidity

```solidity
/// @notice Distribute available cash according to strict priority waterfall
/// Called at each epoch (48h)
function distributeWaterfall(uint256 availableCash) internal {
    uint256 remaining = availableCash;

    // PRIORITY 1: Base coupons due
    uint256 couponsDue = _calculateCouponsDue();
    uint256 couponPaid = _min(remaining, couponsDue);
    if (couponPaid > 0) {
        _payCoupons(couponPaid);
        remaining -= couponPaid;
    }
    // If coupons not fully paid → draw from reserve
    if (couponPaid < couponsDue) {
        uint256 deficit = couponsDue - couponPaid;
        uint256 fromReserve = reserveFund.coverDeficit(deficit);
        _payCoupons(fromReserve);
        // If STILL not fully paid → base coupon is deferred (memory)
        if (couponPaid + fromReserve < couponsDue) {
            _deferCoupons(couponsDue - couponPaid - fromReserve);
        }
    }

    // PRIORITY 2: Principal repayments (autocalled / matured notes)
    uint256 principalDue = _calculatePrincipalDue();
    uint256 principalPaid = _min(remaining, principalDue);
    if (principalPaid > 0) {
        _repayPrincipal(principalPaid);
        remaining -= principalPaid;
    }
    // Principal should always be covered by hedge unwind
    // If not → circuit breaker (hedge failure)
    assert(principalPaid == principalDue); // critical invariant

    // PRIORITY 3: Carry enhancement
    uint256 carryEnhanceDue = _calculateCarryEnhanceDue();
    uint256 carryPaid = _min(remaining, carryEnhanceDue);
    if (carryPaid > 0) {
        _payCarryEnhancement(carryPaid);
        remaining -= carryPaid;
    }
    // If carry not fully paid → NOT deferred (no memory for carry)
    // Lost for retail this period. Protocol risk.

    // PRIORITY 4: Hedge operational costs
    uint256 hedgeCosts = _calculateHedgeCosts();
    uint256 hedgePaid = _min(remaining, hedgeCosts);
    if (hedgePaid > 0) {
        _payHedgeCosts(hedgePaid);
        remaining -= hedgePaid;
    }

    // PRIORITY 5: Reserve fund contribution
    uint256 targetContribution = _calculateReserveContribution(remaining);
    if (targetContribution > 0) {
        reserveFund.depositSurplus(targetContribution);
        remaining -= targetContribution;
    }

    // PRIORITY 6: Protocol treasury (whatever is left)
    if (remaining > 0) {
        protocolTreasury.deposit(remaining);
    }
}
```

### 3.4 Scénarios de waterfall

```
SCÉNARIO A — BULL MARKET (normal, tout va bien)
────────────────────────────────────────────────
Available cash (epoch) : $5,000

P1 Coupons base :          -$1,200    remaining: $3,800
P2 Principal :             -$0        remaining: $3,800  (aucun autocall ce epoch)
P3 Carry enhancement :     -$480      remaining: $3,320
P4 Hedge costs :           -$120      remaining: $3,200
P5 Reserve fund (30%) :    -$960      remaining: $2,240
P6 Protocol treasury :     -$2,240    ✅ Tout le monde payé

SCÉNARIO B — BEAR MARKET (funding bas, stress)
──────────────────────────────────────────────
Available cash (epoch) : $800

P1 Coupons base :          -$1,200    remaining: -$400 → DÉFICIT
   → Reserve couvre :      -$400 from reserve
P2 Principal :             -$0        remaining: $0
P3 Carry enhancement :     -$480      remaining: -$480 → PAS PAYÉ (perdu)
P4 Hedge costs :           -$120      → payé par protocol treasury backlog
P5 Reserve fund :          $0         (on a puisé, pas de contribution)
P6 Protocol treasury :     $0         (rien ne reste)

→ Retail reçoit son base coupon (P1 ok via reserve)
→ Carry enhancement perdu ce mois (pas de memory)
→ Protocole ne gagne rien ce epoch
→ Reserve fund diminue
→ Si ça continue → IssuanceGate bloque les nouvelles émissions

SCÉNARIO C — CRASH (KI events)
──────────────────────────────
Available cash (epoch) : $800 (funding bas)
MAIS : 3 notes en KI settlement

P1 Coupons base :          -$1,200    → reserve couvre $400
P2 Principal :             -$0        (pas de remboursement, c'est un KI)
   KI settlement :         livre xStocks au retail (physical delivery)
   KI put payoff capture : +$15,000   (3 notes × ~$5,000 chacune)

   Nouveau available : $800 + $15,000 = $15,800

   Re-run waterfall avec $15,800 :
   P1 Coupons : -$1,200               remaining: $14,600
   P3 Carry :   -$480                  remaining: $14,120
   P4 Hedge :   -$120                  remaining: $14,000
   P5 Reserve : -$4,200 (30%)          remaining: $9,800
   P6 Treasury: -$9,800                ✅

→ Les KI events RECONSTITUENT le reserve fund
→ C'est le natural hedge du modèle
→ Bear + KI = protocole profitable via option layer
```

### 3.5 Waterfall — Règles de défaut

```
Le protocole NE PEUT PAS faire défaut sur le base coupon sauf si :

1. Reserve fund = 0
2. ET carry = négatif
3. ET pas de KI events pour compenser

Dans ce cas (extrêmement rare) :
    → Base coupon est DÉFÉRÉ (memory)
    → Le retail le récupère quand la situation se normalise
    → Les nouvelles émissions sont BLOQUÉES
    → Le protocole est en mode "recovery"

Le protocole NE FAIT JAMAIS défaut sur le principal car :
    → Le principal est toujours couvert par le hedge delta-neutre
    → Si hedge failure (exploit, liquidation) → circuit breaker
    → C'est un événement de type "black swan smart contract"
    → Couvert par assurance (Nexus Mutual / bug bounty)
```

---

## 4. State Machine — Cycle de vie d'une note

### 4.1 États

```
┌───────────────────────────────────────────────────────────────────┐
│                                                                   │
│  CREATED ──→ PRICED ──→ ACTIVE ──→ OBSERVATION_PENDING           │
│                                         │                         │
│                              ┌──────────┼──────────┐              │
│                              ▼          ▼          ▼              │
│                         COUPON_PAID  COUPON_MISSED  AUTOCALLED    │
│                              │          │               │         │
│                              └────┬─────┘               │         │
│                                   ▼                     │         │
│                              ACTIVE (loop) ─────────────┤         │
│                                   │                     │         │
│                              (last observation)         │         │
│                                   ▼                     │         │
│                           MATURITY_CHECK                │         │
│                              │         │                │         │
│                              ▼         ▼                │         │
│                         NO_KI_SETTLE  KI_SETTLE         │         │
│                              │         │                │         │
│                              └────┬────┘                │         │
│                                   ▼                     ▼         │
│                               SETTLED ←─────────── SETTLED       │
│                                   │                               │
│                                   ▼                               │
│                              ROLLED (si auto-roll)                │
│                                                                   │
│  À tout moment :                                                  │
│  ACTIVE / OBSERVATION_PENDING → EMERGENCY_PAUSED                 │
│  CREATED / PRICED → CANCELLED                                     │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 Définition de chaque état

```solidity
enum NoteState {
    CREATED,              // Note params définis, pas encore pricée
    PRICED,               // Option pricer a calculé le coupon
    ACTIVE,               // Note émise, en vie, entre les observations
    OBSERVATION_PENDING,  // Date d'observation atteinte, en attente d'exécution
    COUPON_PAID,          // Observation faite, coupon payé (transitoire → ACTIVE)
    COUPON_MISSED,        // Observation faite, coupon raté (transitoire → ACTIVE)
    AUTOCALLED,           // Autocall trigger atteint, settlement en cours
    MATURITY_CHECK,       // Dernière observation, vérification KI
    NO_KI_SETTLE,         // Maturité, pas de KI → remboursement principal
    KI_SETTLE,            // KI touché → physical delivery en cours
    SETTLED,              // Note terminée, tous les paiements effectués
    ROLLED,               // Note settled + nouvelle note créée (auto-roll)
    CANCELLED,            // Annulée avant activation
    EMERGENCY_PAUSED      // Pause d'urgence (circuit breaker)
}
```

### 4.3 Transitions

```
TRANSITION              CALLER              CONDITION                              EVENT ÉMIS
──────────────────────────────────────────────────────────────────────────────────────────────

CREATED → PRICED        NoteFactory         pricingResult.putPremium > 0           NotePriced(noteId, premium, coupon)
                                            issuanceGate.check() == approved

PRICED → ACTIVE         NoteFactory         retail a déposé le notional             NoteActivated(noteId, holder, notional)
                                            hedge ouvert (HedgeManager)
                                            NoteToken minted

ACTIVE → OBS_PENDING    ChainlinkKeeper     block.timestamp ≥ nextObservationDate   ObservationDue(noteId, obsIndex)

OBS_PENDING → COUPON    AutocallEngine      worst_perf ≥ coupon_barrier             CouponPaid(noteId, amount, obsIndex)
_PAID                                       AND worst_perf < autocall_trigger
                                            (ajusté avec step-down)

OBS_PENDING → COUPON    AutocallEngine      worst_perf < coupon_barrier             CouponMissed(noteId, obsIndex, missedAmount)
_MISSED                                     AND worst_perf < autocall_trigger

COUPON_PAID → ACTIVE    AutocallEngine      transition automatique (même tx)        —
COUPON_MISSED → ACTIVE  AutocallEngine      transition automatique (même tx)        —

OBS_PENDING →           AutocallEngine      worst_perf ≥ autocall_trigger           AutocallTriggered(noteId, obsIndex, worstPerf)
AUTOCALLED                                  (trigger = 100% - obsIndex × stepDown)

ACTIVE → MATURITY       ChainlinkKeeper     block.timestamp ≥ maturityDate          MaturityReached(noteId)
_CHECK                                      (dernière observation)

MATURITY_CHECK →        AutocallEngine      worst_perf ≥ ki_barrier                 MaturityNoKI(noteId, principalReturned)
NO_KI_SETTLE                                (pas de knock-in)

MATURITY_CHECK →        AutocallEngine      worst_perf < ki_barrier                 KnockInEvent(noteId, worstStock, deliveredAmount)
KI_SETTLE                                   (knock-in activé)

AUTOCALLED → SETTLED    AutocallEngine      hedge fermé, principal + coupons payés  NoteSettled(noteId, totalPaid, settleType)
NO_KI_SETTLE → SETTLED  AutocallEngine      hedge fermé, principal payé             NoteSettled(noteId, totalPaid, settleType)
KI_SETTLE → SETTLED     AutocallEngine      xStocks livrés via 1inch               NoteSettled(noteId, xStocksDelivered, settleType)

SETTLED → ROLLED        ERC7579AutoRoll     auto-roll activé par le holder          NoteRolled(oldNoteId, newNoteId)
                                            nouvelle note créée avec fresh strike

CREATED → CANCELLED     NoteFactory         avant activation seulement              NoteCancelled(noteId, reason)
PRICED → CANCELLED      NoteFactory         avant activation seulement              NoteCancelled(noteId, reason)

ACTIVE → EMERGENCY      owner (multisig)    circuit breaker condition               EmergencyPause(noteId, reason)
_PAUSED                 OR ChainlinkKeeper  (oracle stale, hedge failure, etc.)

EMERGENCY_PAUSED →      owner (multisig)    condition résolue                       EmergencyResume(noteId)
ACTIVE
```

### 4.4 State Machine en Solidity

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AutocallEngine {

    enum State {
        Created, Priced, Active, ObservationPending,
        CouponPaid, CouponMissed, Autocalled,
        MaturityCheck, NoKISettle, KISettle,
        Settled, Rolled, Cancelled, EmergencyPaused
    }

    struct Note {
        // Identity
        bytes32 noteId;
        address holder;
        uint256 notional;

        // State
        State state;
        uint256 currentObservation;     // 0-indexed
        uint256 totalObservations;      // e.g., 6

        // Pricing (immutable after PRICED)
        address[] basket;               // [NVDAx, METAx, TSLAx]
        uint256[] strikePrices;         // spot prices at creation
        uint256 baseCouponBps;          // from option pricing
        uint256 carryEnhanceBps;        // from carry engine
        uint256 totalCouponBps;         // base + carry
        uint256 couponBarrierBps;       // 7000 = 70%
        uint256 autocallTriggerBps;     // 10000 = 100%
        uint256 stepDownBps;            // 200 = 2% per obs
        uint256 kiBarrierBps;           // 5000 = 50%

        // Timing
        uint256 createdAt;
        uint256 maturityDate;
        uint256[] observationDates;

        // Accounting
        uint256 couponsAccrued;         // total coupons paid so far
        uint256 missedBaseCoupons;      // memory coupons (base only)
        uint256 missedCarryEnhance;     // lost (no memory)
    }

    mapping(bytes32 => Note) public notes;

    // --- STATE TRANSITIONS ---

    modifier onlyInState(bytes32 noteId, State expected) {
        require(notes[noteId].state == expected, "invalid state");
        _;
    }

    /// @notice Transition: CREATED → PRICED
    function priceNote(bytes32 noteId, PricingResult calldata pricing)
        external
        onlyInState(noteId, State.Created)
    {
        Note storage note = notes[noteId];

        // Apply issuance policy
        IssuanceCheck memory check = issuanceGate.checkIssuance(
            _buildPricingParams(note),
            totalNotionalOutstanding
        );
        require(check.approved, check.rejectReason);

        // Calculate coupon
        CouponBreakdown memory coupon = couponCalculator.calculateCoupon(
            pricing, check.carryAllowed
        );

        note.baseCouponBps = coupon.baseCoupon;
        note.carryEnhanceBps = coupon.carryEnhancement;
        note.totalCouponBps = coupon.totalCoupon;
        note.state = State.Priced;

        emit NotePriced(noteId, pricing.putPremiumBps, coupon.totalCoupon);
    }

    /// @notice Transition: PRICED → ACTIVE
    function activateNote(bytes32 noteId)
        external
        onlyInState(noteId, State.Priced)
    {
        Note storage note = notes[noteId];

        // Retail must have deposited
        require(vault.hasDeposit(noteId, note.notional), "no deposit");

        // Open hedge
        hedgeManager.openHedge(noteId, note.basket, note.notional);

        // Mint NoteToken
        noteToken.mint(note.holder, uint256(noteId), 1, "");

        // Record strike prices
        for (uint i = 0; i < note.basket.length; i++) {
            note.strikePrices[i] = priceFeed.getPrice(note.basket[i]);
        }

        note.state = State.Active;
        emit NoteActivated(noteId, note.holder, note.notional);
    }

    /// @notice Transition: ACTIVE → OBSERVATION_PENDING → (outcome)
    /// Called by Chainlink Automation
    function observe(bytes32 noteId)
        external
        onlyInState(noteId, State.Active)
    {
        Note storage note = notes[noteId];
        uint256 obsIdx = note.currentObservation;

        require(
            block.timestamp >= note.observationDates[obsIdx],
            "too early"
        );

        // Get prices from Chainlink
        uint256 worstPerf = _getWorstPerformance(note);

        // Calculate autocall trigger with step-down
        uint256 currentTrigger = note.autocallTriggerBps
            - (obsIdx * note.stepDownBps);

        // CHECK AUTOCALL
        if (worstPerf >= currentTrigger) {
            note.state = State.Autocalled;
            _settleAutocall(noteId);
            return;
        }

        // CHECK COUPON
        if (worstPerf >= note.couponBarrierBps) {
            // Pay coupon + memory
            uint256 basePay = _couponAmount(note.baseCouponBps, note.notional)
                + note.missedBaseCoupons;
            uint256 carryPay = _couponAmount(note.carryEnhanceBps, note.notional);
            // carry enhance: no memory, current period only

            _payCoupon(noteId, basePay + carryPay);

            note.missedBaseCoupons = 0;
            note.missedCarryEnhance = 0;
            note.couponsAccrued += basePay + carryPay;

            emit CouponPaid(noteId, basePay + carryPay, obsIdx);
        } else {
            // Coupon missed — accumulate memory (base only)
            uint256 missedBase = _couponAmount(note.baseCouponBps, note.notional);
            uint256 missedCarry = _couponAmount(note.carryEnhanceBps, note.notional);

            note.missedBaseCoupons += missedBase;
            note.missedCarryEnhance += missedCarry; // tracked but not owed

            emit CouponMissed(noteId, obsIdx, missedBase);
        }

        // CHECK MATURITY
        note.currentObservation++;
        if (note.currentObservation >= note.totalObservations) {
            // Last observation — check KI
            if (worstPerf >= note.kiBarrierBps) {
                note.state = State.NoKISettle;
                _settleNoKI(noteId);
            } else {
                note.state = State.KISettle;
                _settleKI(noteId, worstPerf);
            }
        } else {
            note.state = State.Active; // back to waiting
        }
    }

    // --- SETTLEMENT FUNCTIONS ---

    function _settleAutocall(bytes32 noteId) internal {
        Note storage note = notes[noteId];
        // Close hedge → recover USDC
        uint256 recovered = hedgeManager.closeHedge(noteId);
        // Pay principal + remaining coupons
        vault.payHolder(note.holder, note.notional + note.missedBaseCoupons);
        // Pay last coupon
        _payCoupon(noteId, _couponAmount(note.totalCouponBps, note.notional));
        note.state = State.Settled;
        emit NoteSettled(noteId, note.notional + note.couponsAccrued, "autocall");
    }

    function _settleNoKI(bytes32 noteId) internal {
        Note storage note = notes[noteId];
        uint256 recovered = hedgeManager.closeHedge(noteId);
        vault.payHolder(note.holder, note.notional);
        note.state = State.Settled;
        emit NoteSettled(noteId, note.notional, "maturity_no_ki");
    }

    function _settleKI(bytes32 noteId, uint256 worstPerf) internal {
        Note storage note = notes[noteId];
        // Close hedge
        hedgeManager.closeHedge(noteId);
        // Calculate xStocks to deliver
        // delivery = notional / strike_price (in xStock units)
        (address worstStock, uint256 deliveryAmount) = _calculateDelivery(note);
        // Swap USDC → worst xStock via 1inch
        swapper.swap(USDC, worstStock, note.notional, deliveryAmount);
        // Transfer xStocks to holder
        IERC20(worstStock).transfer(note.holder, deliveryAmount);
        note.state = State.Settled;
        emit KnockInEvent(noteId, worstStock, deliveryAmount);
        emit NoteSettled(noteId, deliveryAmount, "ki_physical_delivery");
    }

    // --- HELPERS ---

    function _getWorstPerformance(Note storage note)
        internal view returns (uint256 worstPerf)
    {
        worstPerf = type(uint256).max;
        for (uint i = 0; i < note.basket.length; i++) {
            uint256 currentPrice = priceFeed.getPrice(note.basket[i]);
            uint256 perf = (currentPrice * 10000) / note.strikePrices[i];
            if (perf < worstPerf) worstPerf = perf;
        }
    }

    function _couponAmount(uint256 couponBps, uint256 notional)
        internal pure returns (uint256)
    {
        // Monthly coupon = annual bps × 30/365 × notional / 10000
        return (notional * couponBps * 30) / (365 * 10000);
    }
}
```

### 4.5 Events (pour indexing et frontend)

```solidity
// Lifecycle events
event NotePriced(bytes32 indexed noteId, uint256 premium, uint256 totalCoupon);
event NoteActivated(bytes32 indexed noteId, address holder, uint256 notional);
event ObservationDue(bytes32 indexed noteId, uint256 obsIndex);
event CouponPaid(bytes32 indexed noteId, uint256 amount, uint256 obsIndex);
event CouponMissed(bytes32 indexed noteId, uint256 obsIndex, uint256 missedAmount);
event AutocallTriggered(bytes32 indexed noteId, uint256 obsIndex, uint256 worstPerf);
event MaturityReached(bytes32 indexed noteId);
event KnockInEvent(bytes32 indexed noteId, address worstStock, uint256 deliveredAmount);
event NoteSettled(bytes32 indexed noteId, uint256 totalPaid, string settleType);
event NoteRolled(bytes32 indexed oldNoteId, bytes32 indexed newNoteId);
event NoteCancelled(bytes32 indexed noteId, string reason);
event EmergencyPause(bytes32 indexed noteId, string reason);
event EmergencyResume(bytes32 indexed noteId);

// Economic events
event WaterfallDistributed(uint256 epoch, uint256 coupons, uint256 carry, uint256 fees, uint256 reserve, uint256 treasury);
event ReserveFundDeposit(uint256 amount, uint256 newBalance);
event ReserveFundWithdraw(uint256 amount, uint256 newBalance, string reason);
event CarryCollected(uint256 amount, uint256 fundingRate);
event HedgeOpened(bytes32 indexed noteId, uint256 spotNotional, uint256 perpNotional);
event HedgeClosed(bytes32 indexed noteId, uint256 recovered, int256 pnl);
event HedgeRebalanced(bytes32 indexed noteId, uint256 deltaBefore, uint256 deltaAfter);
```

---

## 5. Invariants — Ce qui ne doit JAMAIS être violé

```
INVARIANT 1 : COUPON ≤ PREMIUM
───────────────────────────────
Pour toute note n :
    n.baseCouponBps + safetyMargin ≤ pricingResult.putPremiumBps

Si violé → bug dans OptionPricer ou IssuancePolicy. Note invalide.

INVARIANT 2 : HEDGE = NOTIONAL
──────────────────────────────
Pour toute note active n :
    |spotValue(n) + perpPnL(n)| ≈ n.notional (±5% tolérance)

Si delta drift > 5% → rebalancing automatique (Chainlink Automation).
Si delta drift > 15% → circuit breaker → EMERGENCY_PAUSED.

INVARIANT 3 : PRINCIPAL GARANTI PAR HEDGE
──────────────────────────────────────────
À tout moment pour une note active :
    spotValue + perpPnL ≥ notional × 95%

Le principal est mécaniquement couvert par le hedge delta-neutre.
Le 5% de tolérance couvre le slippage et le timing de rebalance.

INVARIANT 4 : STATE TRANSITIONS VALIDES
───────────────────────────────────────
Seules les transitions définies en 4.3 sont autorisées.
Aucun raccourci. Aucune transition sautée.

INVARIANT 5 : WATERFALL ORDER
────────────────────────────
Les paiements suivent TOUJOURS l'ordre P1 → P6.
Aucun paiement P6 (treasury) si P1 (coupons) n'est pas satisfait.

INVARIANT 6 : ISSUANCE GATE BEFORE ACTIVATION
─────────────────────────────────────────────
Aucune note ne peut passer de PRICED → ACTIVE sans que
issuanceGate.checkIssuance() retourne approved = true.
```

---

## 6. Failure Modes & Emergency Procedures

Chaque dépendance externe peut tomber. Pour chaque failure, une procédure définie.

### 6.1 Oracle Fail — Chainlink Data Streams

```
FAILURE : Chainlink ne retourne pas de prix, ou prix stale > 1h

DÉTECTION :
    ChainlinkPriceFeed.getPrice() vérifie :
        block.timestamp - priceTimestamp ≤ MAX_STALENESS (3600s)
    Si stale → revert("PRICE_STALE")

IMPACT :
    → observe() revert → observation pas exécutée

PROCÉDURE :
    1. ChainlinkKeeper retente au prochain upkeep (5 min)
    2. Si stale > 4h → note passe en EMERGENCY_PAUSED
    3. Grace period : observation autorisée jusqu'à +24h après la date prévue
    4. Si oracle revient dans les 24h → observation exécutée normalement
    5. Si oracle stale > 24h → observation SKIPPÉE
       → Pas de coupon ce mois (missed, memory pour base)
       → Next observation à la date prévue suivante
    6. Si oracle stale > 72h → TOUTES les notes EMERGENCY_PAUSED
       → IssuanceGate bloque les nouvelles émissions
       → Hedge positions maintenues (delta-neutre, pas urgent de fermer)

SOLIDITY :
    uint256 public constant MAX_PRICE_STALENESS = 1 hours;
    uint256 public constant OBSERVATION_GRACE_PERIOD = 24 hours;
    uint256 public constant GLOBAL_PAUSE_STALENESS = 72 hours;
```

### 6.2 Keeper Not Called On Time

```
FAILURE : Chainlink Automation ne trigger pas observe() à la date prévue

DÉTECTION :
    block.timestamp > observationDate + GRACE_PERIOD

IMPACT :
    → Observation en retard

PROCÉDURE :
    1. Grace period de 24h (voir ci-dessus)
    2. Pendant la grace period : ANYONE peut appeler observe()
       (pas seulement le keeper — fallback permissionless)
    3. Si > 24h de retard : observation skippée (coupon missed)
    4. Note reste ACTIVE, avance à la prochaine observation

SOLIDITY :
    function observe(bytes32 noteId) external {
        // Pas de restriction de caller — permissionless
        // Le keeper appelle normalement, mais n'importe qui peut fallback
        Note storage note = notes[noteId];
        require(
            block.timestamp >= note.observationDates[note.currentObservation],
            "too early"
        );
        require(
            block.timestamp <= note.observationDates[note.currentObservation]
                + OBSERVATION_GRACE_PERIOD,
            "observation expired — skip"
        );
        // ... observation logic
    }

    function skipExpiredObservation(bytes32 noteId) external {
        Note storage note = notes[noteId];
        require(
            block.timestamp > note.observationDates[note.currentObservation]
                + OBSERVATION_GRACE_PERIOD,
            "not expired yet"
        );
        // Miss the coupon (memory for base)
        uint256 missedBase = _couponAmount(note.baseCouponBps, note.notional);
        note.missedBaseCoupons += missedBase;
        note.currentObservation++;
        emit CouponMissed(noteId, note.currentObservation - 1, missedBase);

        if (note.currentObservation >= note.totalObservations) {
            // Can't skip maturity — must settle somehow
            // Use last known good price from Chainlink
            _settleWithLastKnownPrice(noteId);
        }
    }
```

### 6.3 Aster DEX — Funding Adapter Unavailable

```
FAILURE : Aster DEX smart contract paused, reverts, or unreachable

DÉTECTION :
    AsterAdapter.openShort() / closeShort() / claimFunding() revert

IMPACT :
    → Impossible d'ouvrir/fermer/rebalancer les hedges
    → Impossible de collecter le funding rate

PROCÉDURE :
    1. Hedge positions EXISTANTES : restent ouvertes sur Aster
       (le contrat Aster gère toujours les positions même si notre adapter échoue)
    2. Nouvelles émissions : BLOQUÉES (IssuanceGate check 3 — funding health)
    3. Carry collection : suspendue, accumulated on-chain chez Aster
       → Récupérable quand Aster revient
    4. Rebalancing : suspendu
       → Delta drift peut augmenter → monitoring renforcé
       → Si delta drift > 15% ET Aster down > 48h → EMERGENCY_PAUSED
    5. Settlement : fallback mode
       → Si note doit settler MAIS Aster down :
         a. Close perp via autre voie si possible
         b. Si impossible : settle en USDC au lieu de physical delivery
         c. Prix de settlement = dernier prix Chainlink connu

SOLIDITY :
    function closeHedgeSafe(bytes32 noteId) internal returns (bool success) {
        try aster.closeShort(notes[noteId].basket[0]) {
            success = true;
        } catch {
            // Aster unreachable — use fallback
            emit HedgeFallback(noteId, "aster_unavailable");
            success = false;
        }
    }
```

### 6.4 Perp Venue Paused / Delisted

```
FAILURE : Aster DEX delist un stock perp (ex: NVDA perp retiré)

DÉTECTION :
    AsterAdapter.getMarketStatus(xStock) returns PAUSED or DELISTED

IMPACT :
    → Plus possible de hedger ce stock
    → Notes existantes avec ce stock dans le basket sont impactées

PROCÉDURE :
    1. Nouvelles émissions avec ce stock : BLOQUÉES immédiatement
    2. Notes existantes : 2 options selon le timing
       a. Si > 2 observations restantes : EMERGENCY_PAUSED
          → Settle early au prix courant (clause de force majeure)
          → Retail reçoit principal + coupons accumulés (pas de pénalité)
       b. Si ≤ 2 observations restantes : continuer avec spot-only hedge
          → Close le short perp (si possible)
          → Garder le spot xStock comme hedge partiel
          → Augmenter le risk monitoring
    3. Reserve fund couvre les éventuelles pertes de hedge imparfait
```

### 6.5 1inch Swap Revert / Excessive Slippage

```
FAILURE : 1inch swap échoue ou slippage > max toléré

DÉTECTION :
    OneInchSwapper.swap() revert
    OR amountOut < minAmountOut (slippage check)

IMPACT :
    → Impossible d'acheter/vendre xStocks spot
    → Bloque : hedge opening, hedge closing, physical delivery

PROCÉDURE :
    1. Retry avec slippage tolerance augmentée (+0.5% par retry, max 3 retries)
    2. Si 3 retries échouent → split l'ordre en chunks plus petits
       (ex: $10k → 5 × $2k pour réduire l'impact prix)
    3. Si toujours échoue → fallback en limit order (laissé en pending)
    4. Pour physical delivery (KI settlement) :
       → Grace period de 48h pour exécuter le swap
       → Si impossible → settlement en USDC au prix Chainlink
         (clause de fallback — retail préfère USDC au lieu de rien)

SOLIDITY :
    uint256 public constant BASE_SLIPPAGE_BPS = 50;     // 0.5%
    uint256 public constant MAX_SLIPPAGE_BPS = 200;      // 2%
    uint256 public constant MAX_SWAP_RETRIES = 3;
    uint256 public constant SETTLEMENT_GRACE_PERIOD = 48 hours;

    function swapWithRetry(
        address tokenIn, address tokenOut, uint256 amountIn
    ) internal returns (uint256 amountOut) {
        uint256 slippage = BASE_SLIPPAGE_BPS;
        for (uint i = 0; i < MAX_SWAP_RETRIES; i++) {
            uint256 minOut = _getMinOutput(tokenIn, tokenOut, amountIn, slippage);
            try swapper.swap(tokenIn, tokenOut, amountIn, minOut)
                returns (uint256 out)
            {
                return out;
            } catch {
                slippage += 50; // increase tolerance
            }
        }
        revert("SWAP_FAILED_ALL_RETRIES");
    }
```

### 6.6 Partial Hedge Unwind

```
FAILURE : Le hedge ne peut être fermé qu'en partie
         (ex: liquidité insuffisante sur Aster pour close tout le short)

DÉTECTION :
    closeHedge() retourne recovered < expectedNotional

IMPACT :
    → Le protocole est exposé sur la partie non fermée

PROCÉDURE :
    1. Fermer ce qui est possible immédiatement
    2. Le reste : close progressivement sur les 24h suivantes
       → ChainlinkKeeper schedule des closes partiels
    3. Settlement : déféré pour la partie non fermée
       → Retail notifié (event PartialSettlement)
       → Paiement partiel immédiat + solde dans les 48h
    4. Si > 48h et toujours pas fermé :
       → Reserve fund couvre la différence
       → Protocole absorbe la perte résiduelle

SOLIDITY :
    event PartialSettlement(bytes32 noteId, uint256 paidNow, uint256 deferred);
    event DeferredSettlementCompleted(bytes32 noteId, uint256 finalAmount);
```

### 6.7 Note Settlement With Dependency Failure — Decision Tree

```
SETTLEMENT REQUIS (autocall / maturity / KI)
    │
    ├── Chainlink OK ?
    │   ├── OUI → utiliser prix live
    │   └── NON → utiliser dernier prix connu (< 24h)
    │             └── Si > 24h → EMERGENCY_PAUSED, attendre oracle
    │
    ├── Aster DEX OK ?
    │   ├── OUI → fermer short perp normalement
    │   └── NON → marquer position "pending close"
    │             → settle avec spot-only recovery
    │             → reserve couvre le manque
    │
    ├── 1inch OK ?
    │   ├── OUI → swap pour physical delivery / liquidation
    │   └── NON → retry 3× avec slippage croissant
    │             └── Si échoue → settlement USDC (fallback)
    │                             prix = dernier Chainlink
    │
    ├── Euler OK ?
    │   ├── OUI → withdraw collateral / repay borrow
    │   └── NON → positions restent sur Euler
    │             → settlement déféré (48h grace)
    │
    └── TOUT OK → settlement normal (single tx ou batch)
        PARTIEL → settlement partiel + deferred
        RIEN OK → EMERGENCY_PAUSED + manual intervention (multisig)
```

### 6.8 Résumé des timeouts et grace periods

| Composant | Timeout normal | Grace period | Action si timeout |
|---|---|---|---|
| Chainlink price | 1h staleness | 24h | Skip observation |
| Chainlink global | 72h | — | Pause tout |
| Keeper observation | Date exacte | +24h | Permissionless fallback |
| Aster DEX | Immédiat | 48h | Pause nouvelles émissions |
| 1inch swap | 3 retries | 48h | Settlement USDC fallback |
| Euler withdraw | Immédiat | 48h | Deferred settlement |
| Hedge close | Immédiat | 24h progressive | Partial + reserve covers |
| Note settlement | Date observation | 48h | Fallback procedures |

---

## 7. Event Model (complet)

### 7.1 Lifecycle Events

```solidity
// ═══════════════════════════════════════════════════
// NOTE LIFECYCLE
// ═══════════════════════════════════════════════════

/// @notice Note created with parameters (before pricing)
event NoteCreated(
    bytes32 indexed noteId,
    address[] basket,
    uint256 kiBarrierBps,
    uint256 couponBarrierBps,
    uint256 maturityDate,
    uint256 notional
);

/// @notice Option pricing completed, coupon set
event NotePriced(
    bytes32 indexed noteId,
    uint256 putPremiumBps,
    uint256 baseCouponBps,
    uint256 carryEnhanceBps,
    uint256 totalCouponBps,
    uint256 safetyMarginBps
);

/// @notice Note activated — retail deposited, hedge opened, token minted
event NoteActivated(
    bytes32 indexed noteId,
    address indexed holder,
    uint256 notional,
    uint256[] strikePrices
);

/// @notice Observation date reached, pending execution
event ObservationDue(
    bytes32 indexed noteId,
    uint256 obsIndex,
    uint256 scheduledDate
);

/// @notice Coupon paid (includes memory coupons if any)
event CouponPaid(
    bytes32 indexed noteId,
    uint256 obsIndex,
    uint256 baseAmount,
    uint256 carryAmount,
    uint256 memoryAmount,
    uint256 worstPerfBps
);

/// @notice Coupon missed — worst perf below coupon barrier
event CouponMissed(
    bytes32 indexed noteId,
    uint256 obsIndex,
    uint256 missedBaseAmount,
    uint256 lostCarryAmount,
    uint256 worstPerfBps
);

/// @notice Autocall triggered
event AutocallTriggered(
    bytes32 indexed noteId,
    uint256 obsIndex,
    uint256 worstPerfBps,
    uint256 triggerLevelBps,
    uint256 totalCouponsPaid
);

/// @notice Maturity reached without prior autocall
event MaturityReached(
    bytes32 indexed noteId,
    uint256 worstPerfBps,
    bool kiTriggered
);

/// @notice KI event — physical delivery
event KnockInEvent(
    bytes32 indexed noteId,
    address worstStock,
    uint256 worstPerfBps,
    uint256 xStocksDelivered,
    uint256 usdcValueDelivered
);

/// @notice Note fully settled
event NoteSettled(
    bytes32 indexed noteId,
    NoteSettleType settleType,      // AUTOCALL, MATURITY_NO_KI, KI_PHYSICAL
    uint256 totalPaidToHolder,
    uint256 totalCoupons,
    int256 protocolPnL
);

/// @notice Note auto-rolled into new note
event NoteRolled(
    bytes32 indexed oldNoteId,
    bytes32 indexed newNoteId,
    uint256 newNotional,
    uint256[] newStrikePrices
);

/// @notice Note cancelled before activation
event NoteCancelled(bytes32 indexed noteId, string reason);

// Settle type enum
enum NoteSettleType { AUTOCALL, MATURITY_NO_KI, KI_PHYSICAL, EMERGENCY }
```

### 7.2 Economic Events

```solidity
// ═══════════════════════════════════════════════════
// CARRY & YIELD
// ═══════════════════════════════════════════════════

/// @notice Carry enhancement rate set at note creation (immutable)
event CarryEnhancementSet(
    bytes32 indexed noteId,
    uint256 carryEnhanceBps,
    uint256 fundingTwap7dBps,
    uint256 carryShareRate,
    uint256 reserveLevel
);

/// @notice Funding rate collected from Aster DEX
event FundingCollected(
    uint256 indexed epoch,
    uint256 totalAmount,
    int256 fundingRateBps,     // can be negative
    uint256 numPositions
);

/// @notice Euler lending yield harvested
event EulerYieldHarvested(
    uint256 indexed epoch,
    uint256 yieldAmount,
    uint256 totalDeposited
);

// ═══════════════════════════════════════════════════
// RESERVE FUND
// ═══════════════════════════════════════════════════

/// @notice Surplus deposited into reserve fund
event ReserveFundDeposit(
    uint256 amount,
    uint256 newBalance,
    uint256 targetBalance,
    string source               // "carry_surplus", "ki_payoff", "fee_allocation"
);

/// @notice Reserve fund drawn to cover deficit
event ReserveFundWithdraw(
    uint256 amount,
    uint256 newBalance,
    string reason               // "coupon_deficit", "carry_shortfall", "hedge_loss"
);

/// @notice Reserve fund level changed risk tier
event ReserveLevelChanged(
    uint256 oldBalance,
    uint256 newBalance,
    ReserveLevel oldLevel,
    ReserveLevel newLevel       // HEALTHY, WARNING, CRITICAL, DEPLETED
);

enum ReserveLevel { HEALTHY, WARNING, CRITICAL, DEPLETED }

// ═══════════════════════════════════════════════════
// WATERFALL
// ═══════════════════════════════════════════════════

/// @notice Epoch waterfall distribution completed
event WaterfallDistributed(
    uint256 indexed epoch,
    uint256 availableCash,
    uint256 p1_coupons,
    uint256 p2_principal,
    uint256 p3_carryEnhance,
    uint256 p4_hedgeCosts,
    uint256 p5_reserveFund,
    uint256 p6_treasury,
    uint256 deficit             // amount reserve had to cover
);

// ═══════════════════════════════════════════════════
// HEDGE
// ═══════════════════════════════════════════════════

/// @notice Hedge position opened for a note
event HedgeOpened(
    bytes32 indexed noteId,
    address[] stocks,
    uint256 spotNotional,
    uint256 perpNotional,
    uint256 eulerCollateral,
    uint256 eulerBorrowed
);

/// @notice Hedge position closed
event HedgeClosed(
    bytes32 indexed noteId,
    uint256 spotRecovered,
    int256 perpPnL,
    uint256 fundingAccrued,
    int256 netPnL
);

/// @notice Hedge rebalanced due to delta drift
event HedgeRebalanced(
    bytes32 indexed noteId,
    uint256 deltaDriftBps,
    uint256 perpAdjustment,
    bool increased              // true = increased short, false = decreased
);

// ═══════════════════════════════════════════════════
// EMERGENCY
// ═══════════════════════════════════════════════════

/// @notice Note paused due to emergency
event EmergencyPause(
    bytes32 indexed noteId,
    EmergencyReason reason,
    string details
);

/// @notice Note resumed after emergency
event EmergencyResume(bytes32 indexed noteId);

/// @notice Global protocol pause
event GlobalPause(EmergencyReason reason, string details);
event GlobalResume();

/// @notice Fallback settlement used
event FallbackSettlement(
    bytes32 indexed noteId,
    string failedComponent,     // "aster", "1inch", "euler", "chainlink"
    string fallbackUsed         // "usdc_settlement", "deferred", "partial"
);

enum EmergencyReason {
    ORACLE_STALE,
    HEDGE_DRIFT_CRITICAL,
    ASTER_UNAVAILABLE,
    EULER_UNAVAILABLE,
    SWAP_FAILED,
    RESERVE_DEPLETED,
    MANUAL_PAUSE
}

// ═══════════════════════════════════════════════════
// FEES
// ═══════════════════════════════════════════════════

/// @notice Fee collected
event FeeCollected(
    FeeType feeType,
    uint256 amount,
    bytes32 noteId              // bytes32(0) for global fees
);

enum FeeType {
    EMBEDDED,
    ORIGINATION,
    MANAGEMENT,
    PERFORMANCE,
    AUTO_ROLL
}

// ═══════════════════════════════════════════════════
// ISSUANCE
// ═══════════════════════════════════════════════════

/// @notice Issuance check result
event IssuanceChecked(
    bytes32 indexed noteId,
    bool approved,
    bool carryAllowed,
    uint256 premiumBps,
    string rejectReason
);
```

---

## 8. Storage Layout — Structs & Mappings figés

### 8.1 Core Structs

```solidity
/// @notice Immutable parameters set at note creation
/// Packed for gas efficiency
struct NoteTerms {
    // Slot 1 (256 bits)
    bytes32 noteId;

    // Slot 2
    address holder;                // 160 bits
    uint48 createdAt;              // 48 bits — timestamp (ok until year 9999)
    uint48 maturityDate;           // 48 bits

    // Slot 3
    uint128 notional;              // 128 bits — max ~3.4e38 (plenty for USDC 6 decimals)
    uint16 baseCouponBps;          // 16 bits — max 65535 bps = 655% (plenty)
    uint16 carryEnhanceBps;        // 16 bits
    uint16 totalCouponBps;         // 16 bits
    uint16 couponBarrierBps;       // 16 bits
    uint16 autocallTriggerBps;     // 16 bits
    uint16 stepDownBps;            // 16 bits
    uint16 kiBarrierBps;           // 16 bits

    // Slot 4
    uint8 totalObservations;       // 8 bits — max 255
    uint8 basketSize;              // 8 bits — max 255 (realistically 2-5)
    // 240 bits free
}

/// @notice Mutable state that changes during note lifecycle
struct NoteStatus {
    // Slot 1
    NoteState state;               // 8 bits
    uint8 currentObservation;      // 8 bits
    uint48 lastObservationTime;    // 48 bits
    uint128 couponsAccrued;        // 128 bits — total USDC coupons paid
    // 64 bits free

    // Slot 2
    uint128 missedBaseCoupons;     // 128 bits — memory coupons owed
    uint128 missedCarryEnhance;    // 128 bits — tracked but not owed
}

/// @notice Basket composition (separate mapping for dynamic array)
/// For a 3-stock basket, uses 3 slots
struct BasketEntry {
    address xStock;                // 160 bits
    uint96 strikePrice;            // 96 bits — price in USDC (6 decimals → max ~79B USDC)
}

/// @notice Observation schedule (separate mapping)
struct ObservationSchedule {
    uint48 date;                   // timestamp
    bool executed;
    bool skipped;
}
```

### 8.2 Pricing Structs

```solidity
/// @notice Output of the option pricer (stored for audit trail)
struct PricingResult {
    // Slot 1
    uint16 putPremiumBps;          // 16 bits
    uint16 kiProbabilityBps;       // 16 bits
    uint16 expectedKILossBps;      // 16 bits
    uint16 safetyMarginBps;        // 16 bits
    uint16 vegaBps;                // 16 bits — vol sensitivity
    uint48 timestamp;              // 48 bits
    // 128 bits free

    // Slot 2
    bytes32 mcHash;                // hash of off-chain MC run for verification
}

/// @notice Issuance policy check result
struct IssuanceCheck {
    bool approved;                 // 8 bits
    bool carryAllowed;             // 8 bits
    uint16 maxBaseCouponBps;       // 16 bits
    uint16 maxCarryEnhanceBps;     // 16 bits
    // string rejectReason → separate event, not stored
}

/// @notice Coupon breakdown (computed, stored in NoteTerms)
struct CouponBreakdown {
    uint16 baseCouponBps;
    uint16 carryEnhanceBps;
    uint16 totalCouponBps;
    uint16 protocolCarryBps;       // carry kept by protocol
}
```

### 8.3 Hedge Structs

```solidity
/// @notice Hedge position for a note
struct HedgePosition {
    // Slot 1
    bytes32 noteId;

    // Slot 2
    uint128 spotNotional;          // USDC value of xStocks held
    uint128 perpNotional;          // USDC notional of short perps

    // Slot 3
    uint128 eulerCollateral;       // xStocks deposited on Euler
    uint128 eulerBorrowed;         // USDC borrowed from Euler

    // Slot 4
    uint128 fundingAccrued;        // total funding rate collected (USDC)
    uint48 lastRebalance;          // timestamp
    uint48 lastFundingCollection;  // timestamp
    int16 currentDeltaBps;         // signed — current delta drift
    // 8 bits free
}
```

### 8.4 Reserve Fund Struct

```solidity
struct ReserveFundState {
    // Slot 1
    uint128 balance;               // current USDC balance
    uint128 targetBalance;         // target = 10% of notional outstanding

    // Slot 2
    uint128 minBalance;            // minimum = 3% of notional
    uint128 totalDeposited;        // lifetime deposits (for analytics)

    // Slot 3
    uint128 totalWithdrawn;        // lifetime withdrawals
    ReserveLevel level;            // current health level
    uint48 lastLevelChange;        // timestamp
}
```

### 8.5 Enums (finaux)

```solidity
enum NoteState {
    Created,              // 0
    Priced,               // 1
    Active,               // 2
    ObservationPending,   // 3
    Autocalled,           // 4
    MaturityCheck,        // 5
    NoKISettle,           // 6
    KISettle,             // 7
    Settled,              // 8
    Rolled,               // 9
    Cancelled,            // 10
    EmergencyPaused       // 11
}
// Note : CouponPaid et CouponMissed sont des transitions transitoires
// (même tx), pas des états persistants. Simplifié vs spec précédente.

enum NoteSettleType {
    Autocall,             // 0
    MaturityNoKI,         // 1
    KIPhysical,           // 2
    Emergency             // 3
}

enum ReserveLevel {
    Healthy,              // balance ≥ target (10%)
    Warning,              // min ≤ balance < target
    Critical,             // 1% ≤ balance < min (3%)
    Depleted              // balance < 1%
}

enum EmergencyReason {
    OracleStale,
    HedgeDriftCritical,
    AsterUnavailable,
    EulerUnavailable,
    SwapFailed,
    ReserveDepleted,
    ManualPause
}

enum FeeType {
    Embedded,
    Origination,
    Management,
    Performance,
    AutoRoll
}
```

### 8.6 Mappings principaux

```solidity
contract AutocallEngine {
    // Note data — split for gas efficiency
    mapping(bytes32 => NoteTerms) public noteTerms;
    mapping(bytes32 => NoteStatus) public noteStatus;
    mapping(bytes32 => PricingResult) public notePricing;

    // Basket entries (noteId => index => BasketEntry)
    mapping(bytes32 => mapping(uint8 => BasketEntry)) public noteBasket;

    // Observation schedule (noteId => obsIndex => ObservationSchedule)
    mapping(bytes32 => mapping(uint8 => ObservationSchedule)) public noteObservations;

    // Note enumeration
    bytes32[] public activeNoteIds;
    mapping(bytes32 => uint256) public noteIdToIndex; // for O(1) removal

    // Global counters
    uint256 public totalNotionalOutstanding;
    uint256 public totalNotesCreated;
    uint256 public totalNotesSettled;
}

contract HedgeManager {
    mapping(bytes32 => HedgePosition) public positions;
    // Per-stock aggregated positions (for rebalancing)
    mapping(address => uint256) public totalSpotPerStock;
    mapping(address => uint256) public totalPerpPerStock;
}

contract XYieldVault {
    // ERC-4626 handles: totalAssets, balanceOf, etc.
    // Additional:
    mapping(address => uint256) public withdrawalRequests; // pending
    uint256 public currentEpoch;
    uint256 public epochStartTime;
    uint256 public eulerAllocationBps;
    uint256 public carryAllocationBps;
    uint256 public reserveAllocationBps;
}

contract ReserveFund {
    ReserveFundState public state;
    // History for analytics
    mapping(uint256 => uint256) public epochDeposits;   // epoch => amount
    mapping(uint256 => uint256) public epochWithdrawals;
}
```

### 8.7 Constants figés

```solidity
// ═══════════════════════════════════════════════════
// PROTOCOL CONSTANTS — ne changent JAMAIS
// ═══════════════════════════════════════════════════

// Pricing
uint256 constant MIN_PREMIUM_BPS = 300;           // 3% ann minimum
uint256 constant MAX_CARRY_ENHANCE_BPS = 500;     // 5% ann maximum
uint256 constant SAFETY_MARGIN_LOW_VOL = 100;     // 1%
uint256 constant SAFETY_MARGIN_MID_VOL = 150;     // 1.5%
uint256 constant SAFETY_MARGIN_HIGH_VOL = 200;    // 2%
uint256 constant VOL_THRESHOLD_LOW = 3500;        // 35%
uint256 constant VOL_THRESHOLD_HIGH = 5000;       // 50%

// Timing
uint256 constant EPOCH_DURATION = 48 hours;
uint256 constant MAX_PRICE_STALENESS = 1 hours;
uint256 constant OBSERVATION_GRACE_PERIOD = 24 hours;
uint256 constant GLOBAL_PAUSE_STALENESS = 72 hours;
uint256 constant SETTLEMENT_GRACE_PERIOD = 48 hours;

// Hedge
uint256 constant MAX_LEVERAGE_BPS = 30000;        // 3x
uint256 constant DELTA_THRESHOLD_BPS = 500;       // 5% drift → rebalance
uint256 constant DELTA_CRITICAL_BPS = 1500;       // 15% drift → emergency
uint256 constant NEGATIVE_FUNDING_LIMIT = 48 hours;

// Reserve
uint256 constant RESERVE_TARGET_BPS = 1000;       // 10% of notional
uint256 constant RESERVE_MIN_BPS = 300;            // 3%
uint256 constant RESERVE_CRITICAL_BPS = 100;       // 1%

// Fees
uint256 constant EMBEDDED_FEE_BPS = 150;          // 1.5%
uint256 constant ORIGINATION_FEE_BPS = 30;         // 0.3%
uint256 constant MANAGEMENT_FEE_BPS = 50;          // 0.5% ann
uint256 constant PERFORMANCE_FEE_BPS = 2000;       // 20% of carry
uint256 constant AUTO_ROLL_FEE_BPS = 10;           // 0.1%

// Carry sharing
uint256 constant CARRY_SHARE_HEALTHY = 3000;       // 30%
uint256 constant CARRY_SHARE_WARNING = 1500;       // 15%
uint256 constant CARRY_SHARE_CRITICAL = 0;         // 0%
uint256 constant MIN_FUNDING_FOR_CARRY = 300;      // 3% ann

// Swap
uint256 constant BASE_SLIPPAGE_BPS = 50;           // 0.5%
uint256 constant MAX_SLIPPAGE_BPS = 200;           // 2%
uint256 constant MAX_SWAP_RETRIES = 3;

// BPS base
uint256 constant BPS = 10000;
```

---

## 9. Résumé pour les devs

```
POUR IMPLÉMENTER, LIRE DANS CET ORDRE :
────────────────────────────────────────

1. Section 1 : Définitions verrouillées
   → Comprendre exactement ce que chaque variable signifie

2. Section 4 : State machine
   → Le cœur du contrat. Chaque fonction = une transition.

3. Section 3 : Waterfall
   → Comment le cash circule. Priorités strictes.

4. Section 2 : Pricing vs Policy
   → Le pricer calcule, la policy décide.

5. Section 5 : Invariants
   → Ce qu'il faut tester. Si un invariant est violé → bug.

FICHIERS SOLIDITY À CRÉER (par ordre de priorité) :
────────────────────────────────────────────────────
1. AutocallEngine.sol   ← state machine + observe + settle
2. NoteToken.sol        ← ERC-1155 simple
3. XYieldVault.sol      ← ERC-4626 + waterfall
4. HedgeManager.sol     ← spot+perp + carry capture
5. OptionPricer.sol     ← analytical approx on-chain
6. IssuanceGate.sol     ← 4 checks
7. CouponCalculator.sol ← formula locked
8. ReserveFund.sol      ← buffer
9. CarryEngine.sol      ← funding rate arb
10. AsterAdapter.sol    ← perp interface
11. ChainlinkKeeper.sol ← automation triggers
12. EpochManager.sol    ← 48h cycle + waterfall trigger
```

---

*Contract Specification v2 — 17 mars 2026.
Définitions verrouillées, waterfall comptable, state machine produit.
Ce document est la référence pour l'implémentation Solidity.*
