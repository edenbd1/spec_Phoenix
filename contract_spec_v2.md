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

## 6. Résumé pour les devs

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
