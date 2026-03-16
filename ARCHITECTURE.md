# xYield Protocol — Architecture Complete

> Architecture calquee sur PiggyBank (piggybank.fi) — le meilleur projet xStocks.
> Meme strategie (funding rate arb), adaptee a l'EVM, avec autocall par-dessus.
> Hackathon xStocks Market Open — 31 mars - 2 avril 2026, Cannes.

---

## 1. PiggyBank → xYield : le mapping

### Ce que PiggyBank fait (Solana)

```
Utilisateur depose xStocks/USDC
    → recoit pbTokens (yield-bearing)
    → Protocol collateralise sur Kamino/Loopscale
    → Emprunte stablecoins
    → Short perps equivalents sur Drift
    → Position delta-neutral + capture funding rate
    → 48h epochs pour NAV + withdrawals
    → APYs : USDC 20.84%, SPYx 7.18%
```

### Ce que xYield fait (Ethereum/Arbitrum)

```
Utilisateur depose USDC
    → recoit xyUSDC (ERC-4626 share token)
    → Autocall Phoenix cree (NoteToken ERC-1155)
    → Protocol achete xStocks spot via 1inch
    → Collateralise xStocks sur Euler EVK
    → Short xStocks perps sur Aster DEX
    → Position delta-neutral + capture funding rate (= le hedge)
    → 48h epochs pour NAV + rebalancing
    → Le hedge RAPPORTE au lieu de couter
```

### Mapping composant par composant

| PiggyBank (Solana) | xYield (EVM) | Role |
|---|---|---|
| pbTokens | xyUSDC (ERC-4626) | Share token yield-bearing |
| Kamino / Loopscale | **Euler Finance EVK** | Lending + collateral |
| Drift DEX | **Aster DEX** | Perps (stock perps on-chain) |
| 48h epochs | 48h epochs | NAV update + rebalancing |
| Risk mgmt (TP/SL) | Chainlink Automation | Automated risk management |
| — | Autocall Engine | Produit structure par-dessus |
| — | Chainlink Data Streams | Prix xStocks sub-second |
| — | 1inch | Swap xStocks spot |

---

## 2. Pourquoi Aster DEX (pas Nado)

### Le probleme Nado

Nado (sur Ink/Kraken L2) n'a **que des perps crypto** (ETH, BTC, SOL...).
Les equity perps (NVDA, TSLA, etc.) sont "coming soon" — pas encore live.
**On ne peut pas faire de funding rate arb sur xStocks via Nado.**

### Aster DEX — stock perps on-chain

Aster DEX est deploye sur **Ethereum mainnet** et **Arbitrum** avec des perps sur actions :

| Stock Perp | Disponible | Fees |
|---|---|---|
| NVDA | ✅ | **0% (promo)** |
| TSLA | ✅ | **0% (promo)** |
| AAPL | ✅ | Standard |
| META | ✅ | Standard |
| AMZN | ✅ | Standard |
| GOOGL | ✅ | Standard |
| MSFT | ✅ | Standard |

**Smart contracts :**
- Ethereum : `0x604DD02d620633Ae427888d41bfd15e38483736E`
- Arbitrum : `0x9E36CB86a159d479cEd94Fa05036f235Ac40E1d5`

**Specs :**
- Leverage : jusqu'a 50x
- Funding rate : toutes les 8h (comme Drift/Binance)
- On-chain, composable, smart contract interactions possibles

### Pourquoi c'est parfait

PiggyBank utilise Drift pour les perps sur Solana.
Aster DEX est le **Drift de l'EVM pour les stock perps**.
C'est exactement le meme role — mais sur Ethereum/Arbitrum avec les memes xStocks.

---

## 3. Chain de deploiement : Ethereum ou Arbitrum

### Decision

| Critere | Ethereum | Arbitrum | Ink (Kraken L2) |
|---|---|---|---|
| Euler Finance | ✅ | ✅ | ❌ (pas deploye) |
| Aster DEX (stock perps) | ✅ | ✅ | ❌ |
| Chainlink Data Streams | ✅ | ✅ | ❓ |
| 1inch | ✅ | ✅ | ❌ |
| xStocks (ERC-20) | ✅ | Via bridge | Via bridge |
| Gas cost | Eleve | Faible | Faible |

**Recommandation : Arbitrum** (ou Ethereum mainnet si gas est acceptable)
- Tous les composants sont natifs (Euler + Aster DEX + Chainlink + 1inch)
- Gas bas = plus de trades, rebalancing frequent possible
- xStocks ERC-20 disponibles via bridge depuis Ethereum

**Note hackathon :** Ink perd des points "xStocks Relevance" mais c'est impossible d'y deployer sans Aster DEX et Euler. L'innovation technique compense largement.

---

## 4. Les 3 modules

### Module 1 — USDC Vault (ERC-4626)

```
┌─────────────────────────────────────────────────────────────┐
│                    XYieldVault.sol                           │
│                    (ERC-4626)                                │
│                                                             │
│  deposit(USDC) → mint xyUSDC shares                        │
│  withdraw(xyUSDC) → burn shares, return USDC + yield        │
│                                                             │
│  Capital allocation :                                       │
│  ├── 40-60% → Euler Finance (lending USDC, 3-5% safe)      │
│  ├── 20-40% → Funding Rate Arb Engine                       │
│  │            (buy xStocks → short perps Aster → 8-20%)     │
│  └── 10-20% → Reserve liquidite (coupons + withdrawals)     │
│                                                             │
│  Epoch system : 48h (calque PiggyBank)                      │
│  ├── T+0h : snapshot NAV                                    │
│  ├── T+0-24h : process withdrawals                          │
│  ├── T+24-48h : rebalance positions                         │
│  └── T+48h : new epoch, updated share price                 │
│                                                             │
│  Yield distribution :                                       │
│  ├── 80% → xyUSDC holders (share price appreciation)        │
│  └── 20% → protocol treasury (performance fee)              │
└─────────────────────────────────────────────────────────────┘
```

### Module 2 — Autocall Engine

```
┌─────────────────────────────────────────────────────────────┐
│                  AutocallEngine.sol                          │
│                                                             │
│  Phoenix Autocall — Worst-of 3 xStocks                      │
│                                                             │
│  Parametres produit :                                        │
│  ├── Basket : NVDAx / METAx / TSLAx (worst-of)             │
│  ├── Coupon : 10-14% ann (1% par mois)                      │
│  ├── Coupon barrier : 65-70%                                │
│  ├── Autocall trigger : 100% (step-down 2%/obs)             │
│  ├── KI barrier : 50% (European, maturite seulement)        │
│  ├── Memory coupon : oui                                    │
│  ├── Observations : mensuelles                              │
│  ├── Maturite : 6 mois                                      │
│  └── Settlement : physical delivery (xStocks via 1inch)     │
│                                                             │
│  Lifecycle :                                                │
│  ├── createNote() → NoteToken ERC-1155 mint                 │
│  ├── observe() → Chainlink Automation trigger mensuel       │
│  │   ├── getPrices() → Chainlink Data Streams               │
│  │   ├── checkCoupon() → worst ≥ coupon barrier?            │
│  │   ├── checkAutocall() → worst ≥ autocall trigger?        │
│  │   └── checkKI() → worst < KI? (maturite seulement)      │
│  ├── payCoupon() → USDC transfer au holder                  │
│  ├── autocall() → principal + coupons → holder              │
│  ├── settle() → physical delivery via 1inch swap            │
│  └── autoRoll() → ERC-7579 module, nouvelle note auto       │
│                                                             │
│  Pricing :                                                  │
│  ├── Embedded fee : 1-3% (protocole)                        │
│  ├── Origination fee : 0.3% (protocole)                     │
│  └── Auto-roll fee : 0.1% par roll                          │
└─────────────────────────────────────────────────────────────┘
```

### Module 3 — Hedge & Yield Engine (la strat PiggyBank)

```
┌─────────────────────────────────────────────────────────────┐
│                  HedgeManager.sol                            │
│            (= PiggyBank strategy sur EVM)                    │
│                                                             │
│  Strategie identique a PiggyBank :                          │
│  1. Acheter xStocks spot (via 1inch)                        │
│  2. Collateraliser xStocks sur Euler EVK                    │
│  3. Emprunter USDC contre les xStocks                       │
│  4. Short perps equivalents sur Aster DEX                   │
│  5. Position delta-neutral → capture funding rate (8h)      │
│                                                             │
│  Le short perp = le delta hedge de l'autocall               │
│  Le funding rate = le yield en bonus                        │
│                                                             │
│  Capital flow :                                             │
│  ┌──────────────┐     ┌─────────────┐     ┌──────────────┐ │
│  │ Buy xStocks  │────→│ Collat on   │────→│ Borrow USDC  │ │
│  │ via 1inch    │     │ Euler EVK   │     │ for margin   │ │
│  └──────────────┘     └─────────────┘     └──────┬───────┘ │
│                                                   │         │
│                                            ┌──────▼───────┐ │
│                                            │ Short perps  │ │
│                                            │ on Aster DEX │ │
│                                            │ (NVDA, TSLA) │ │
│                                            └──────┬───────┘ │
│                                                   │         │
│                                            ┌──────▼───────┐ │
│                                            │ Collect      │ │
│                                            │ funding rate │ │
│                                            │ every 8h     │ │
│                                            └──────────────┘ │
│                                                             │
│  Risk management (calque PiggyBank) :                       │
│  ├── Levier max : 2-3x (conservateur)                       │
│  ├── Rebalance si delta > ±5%                               │
│  ├── Stop loss si funding negatif > 3 periodes (24h)        │
│  ├── Switch vers Euler lending pur si marche adverse         │
│  └── Chainlink Automation pour triggers automatiques        │
│                                                             │
│  Yield attendu (meme profil que PiggyBank) :                │
│  ├── Bull market : 15-25% (PB: 20.84% USDC)                │
│  ├── Normal : 8-12%                                         │
│  └── Bear : 3-5%                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Smart Contracts — Structure

```
contracts/
├── core/
│   ├── XYieldVault.sol          ← ERC-4626, deposit/withdraw USDC, epoch system
│   ├── AutocallEngine.sol       ← Phoenix logic, observations, settlement
│   ├── NoteToken.sol            ← ERC-1155, represents autocall position
│   └── HedgeManager.sol         ← PiggyBank strat: spot+perp arb, risk mgmt
│
├── yield/
│   ├── EulerStrategy.sol        ← Deploy USDC on Euler, manage EVK collateral
│   ├── FundingArbStrategy.sol   ← Long xStocks + short Aster perps
│   └── YieldRouter.sol          ← Allocate between Euler/arb based on rates
│
├── integrations/
│   ├── AsterAdapter.sol         ← Interface with Aster DEX for perp positions
│   ├── ChainlinkPriceFeed.sol   ← Data Streams for xStocks prices
│   ├── ChainlinkKeeper.sol      ← Automation for observations + rebalancing
│   ├── OneInchSwapper.sol       ← 1inch aggregator for xStocks spot trades
│   └── ERC7579AutoRoll.sol      ← Smart account module for auto-roll
│
└── periphery/
    ├── NoteFactory.sol          ← Create new autocall series
    ├── EpochManager.sol         ← 48h epoch logic (NAV, withdrawals, rebalance)
    └── FeeCollector.sol         ← Collect and distribute protocol fees
```

### XYieldVault.sol (coeur)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract XYieldVault is ERC4626, Ownable {
    // --- Epoch System (48h, like PiggyBank) ---
    uint256 public constant EPOCH_DURATION = 48 hours;
    uint256 public currentEpoch;
    uint256 public epochStartTime;

    // --- Strategy allocation ---
    uint256 public eulerAllocation;   // basis points (e.g., 5000 = 50%)
    uint256 public arbAllocation;     // basis points
    uint256 public reserveAllocation; // basis points

    // --- Integrations ---
    IEulerStrategy public eulerStrategy;
    IFundingArbStrategy public arbStrategy;
    IYieldRouter public yieldRouter;

    // --- Withdrawal queue (epoch-based) ---
    struct WithdrawalRequest {
        address user;
        uint256 shares;
        uint256 epoch;
    }
    WithdrawalRequest[] public withdrawalQueue;

    constructor(IERC20 _usdc) ERC4626(_usdc) ERC20("xYield USDC", "xyUSDC") {}

    /// @notice Deposit USDC, get xyUSDC shares
    function deposit(uint256 assets, address receiver)
        public override returns (uint256 shares)
    {
        shares = super.deposit(assets, receiver);
        _deployCapital(assets);
    }

    /// @notice Request withdrawal (processed next epoch)
    function requestWithdraw(uint256 shares) external {
        withdrawalQueue.push(WithdrawalRequest({
            user: msg.sender,
            shares: shares,
            epoch: currentEpoch + 1
        }));
    }

    /// @notice Process epoch: NAV update, withdrawals, rebalance
    function processEpoch() external {
        require(block.timestamp >= epochStartTime + EPOCH_DURATION, "epoch not ended");

        // 1. Update NAV from strategies
        uint256 eulerYield = eulerStrategy.harvest();
        uint256 arbYield = arbStrategy.harvest();

        // 2. Process pending withdrawals
        _processWithdrawals();

        // 3. Rebalance between strategies
        yieldRouter.rebalance(eulerAllocation, arbAllocation);

        // 4. Advance epoch
        currentEpoch++;
        epochStartTime = block.timestamp;
    }

    /// @notice Total assets = USDC in vault + deployed in strategies
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this))
            + eulerStrategy.totalValue()
            + arbStrategy.totalValue();
    }

    function _deployCapital(uint256 amount) internal {
        uint256 toEuler = (amount * eulerAllocation) / 10000;
        uint256 toArb = (amount * arbAllocation) / 10000;
        // rest stays as reserve

        if (toEuler > 0) eulerStrategy.deposit(toEuler);
        if (toArb > 0) arbStrategy.deposit(toArb);
    }

    function _processWithdrawals() internal {
        // Process all withdrawals queued for current epoch
        // ...
    }
}
```

### HedgeManager.sol (la strat PiggyBank)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./integrations/AsterAdapter.sol";
import "./integrations/OneInchSwapper.sol";

contract HedgeManager {
    // --- PiggyBank Strategy on EVM ---
    // Long xStocks spot + Short xStocks perps = delta-neutral + funding capture

    IAsterAdapter public aster;       // Aster DEX for perps
    IOneInchSwapper public swapper;   // 1inch for spot trades
    IEulerVault public eulerVault;    // Euler EVK for collateral
    IChainlinkFeed public priceFeed;  // Chainlink for prices

    struct HedgePosition {
        address xStock;          // e.g., NVDAx address
        uint256 spotAmount;      // amount of xStocks held
        uint256 perpShortSize;   // notional of short perp on Aster
        uint256 collateralOnEuler; // xStocks deposited as collateral
        uint256 borrowedUSDC;    // USDC borrowed against collateral
        uint256 fundingAccrued;  // total funding rate collected
        uint256 lastRebalance;   // timestamp
    }

    mapping(bytes32 => HedgePosition) public positions; // noteId => position

    uint256 public constant MAX_LEVERAGE = 3e18;     // 3x max
    uint256 public constant DELTA_THRESHOLD = 500;    // 5% in bps
    uint256 public constant NEGATIVE_FUNDING_LIMIT = 3; // 3 periods (24h)

    /// @notice Open hedge for a new autocall note (PiggyBank strategy)
    /// @param noteId The autocall note being hedged
    /// @param xStock The xStock to hedge (e.g., NVDAx)
    /// @param notional USDC notional of the note
    function openHedge(
        bytes32 noteId,
        address xStock,
        uint256 notional
    ) external {
        // Step 1: Buy xStocks spot via 1inch
        uint256 xStockAmount = swapper.swap(
            USDC, xStock, notional, 0 // minOut handled by 1inch
        );

        // Step 2: Collateralize xStocks on Euler EVK
        IERC20(xStock).approve(address(eulerVault), xStockAmount);
        eulerVault.deposit(xStockAmount, address(this));
        eulerVault.enableCollateral(address(this), address(eulerVault));

        // Step 3: Borrow USDC against xStocks (conservative LTV)
        uint256 borrowAmount = (notional * 50) / 100; // 50% LTV
        eulerVault.borrow(borrowAmount, address(this));

        // Step 4: Open short perp on Aster DEX (delta hedge)
        aster.openShort(xStock, notional); // notional-equivalent short

        // Step 5: Record position
        positions[noteId] = HedgePosition({
            xStock: xStock,
            spotAmount: xStockAmount,
            perpShortSize: notional,
            collateralOnEuler: xStockAmount,
            borrowedUSDC: borrowAmount,
            fundingAccrued: 0,
            lastRebalance: block.timestamp
        });
    }

    /// @notice Collect funding rate from Aster (called by Chainlink Automation)
    function collectFunding(bytes32 noteId) external {
        HedgePosition storage pos = positions[noteId];
        uint256 funding = aster.claimFunding(pos.xStock);
        pos.fundingAccrued += funding;
    }

    /// @notice Rebalance if delta drifts (called by Chainlink Automation)
    function rebalance(bytes32 noteId) external {
        HedgePosition storage pos = positions[noteId];

        uint256 spotValue = priceFeed.getPrice(pos.xStock) * pos.spotAmount / 1e18;
        uint256 perpValue = pos.perpShortSize;

        // Check delta drift
        uint256 delta = spotValue > perpValue
            ? ((spotValue - perpValue) * 10000) / spotValue
            : ((perpValue - spotValue) * 10000) / perpValue;

        if (delta > DELTA_THRESHOLD) {
            // Rebalance: adjust perp size to match spot
            if (spotValue > perpValue) {
                aster.increaseShort(pos.xStock, spotValue - perpValue);
            } else {
                aster.decreaseShort(pos.xStock, perpValue - spotValue);
            }
            pos.perpShortSize = spotValue;
            pos.lastRebalance = block.timestamp;
        }
    }

    /// @notice Close hedge on autocall/settlement
    function closeHedge(bytes32 noteId) external returns (uint256 xStocksReturned) {
        HedgePosition storage pos = positions[noteId];

        // Close perp short on Aster
        aster.closeShort(pos.xStock);

        // Repay Euler borrow
        eulerVault.repay(pos.borrowedUSDC);

        // Withdraw xStocks from Euler
        xStocksReturned = eulerVault.withdraw(
            pos.collateralOnEuler, address(this), address(this)
        );

        delete positions[noteId];
    }
}
```

### FundingArbStrategy.sol (pour le vault USDC)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice PiggyBank USDC strategy replicated on EVM
/// Buy xStocks spot + short perps = delta-neutral + capture funding rate
/// This is exactly how PiggyBank achieves 20.84% APY on USDC
contract FundingArbStrategy {

    IAsterAdapter public aster;
    IOneInchSwapper public swapper;

    struct ArbPosition {
        address xStock;
        uint256 spotAmount;
        uint256 perpShortNotional;
        uint256 fundingCollected;
    }

    ArbPosition[] public positions;

    /// @notice Deploy USDC into funding rate arb
    /// Diversified across multiple xStocks for lower risk
    function deploy(uint256 usdcAmount) external {
        // Split across 3+ xStocks for diversification
        // (same as PiggyBank splits across multiple assets)
        uint256 perAsset = usdcAmount / 3;

        address[3] memory xStocks = [NVDAx, TSLAx, METAx];

        for (uint i = 0; i < 3; i++) {
            // Buy xStock spot
            uint256 amount = swapper.swap(USDC, xStocks[i], perAsset, 0);

            // Short equivalent perp on Aster
            aster.openShort(xStocks[i], perAsset);

            positions.push(ArbPosition({
                xStock: xStocks[i],
                spotAmount: amount,
                perpShortNotional: perAsset,
                fundingCollected: 0
            }));
        }
    }

    /// @notice Harvest funding rate yield
    function harvest() external returns (uint256 totalYield) {
        for (uint i = 0; i < positions.length; i++) {
            uint256 funding = aster.claimFunding(positions[i].xStock);
            positions[i].fundingCollected += funding;
            totalYield += funding;
        }
    }

    /// @notice Check if funding rate is negative — switch to safe mode
    function checkFundingHealth() external view returns (bool healthy) {
        // If funding rate negative for > 24h, return false
        // YieldRouter will switch allocation to Euler lending
    }

    /// @notice Total value: spot + unrealized PnL + collected funding
    function totalValue() external view returns (uint256) {
        // ...
    }
}
```

### EulerStrategy.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Simple USDC lending on Euler Finance
/// Safe yield (3-5% ann), used as base strategy and fallback
contract EulerStrategy {

    IEulerVault public eulerVault;
    IERC20 public usdc;

    /// @notice Deposit USDC into Euler lending vault
    function deposit(uint256 amount) external {
        usdc.approve(address(eulerVault), amount);
        eulerVault.deposit(amount, address(this));
    }

    /// @notice Withdraw USDC from Euler
    function withdraw(uint256 amount) external returns (uint256) {
        return eulerVault.withdraw(amount, msg.sender, address(this));
    }

    /// @notice Harvest yield (difference between current and last NAV)
    function harvest() external returns (uint256 yield_) {
        uint256 currentValue = eulerVault.maxWithdraw(address(this));
        uint256 deposited = totalDeposited;
        yield_ = currentValue > deposited ? currentValue - deposited : 0;
    }

    function totalValue() external view returns (uint256) {
        return eulerVault.maxWithdraw(address(this));
    }
}
```

---

## 6. Euler EVK Integration — xStocks Collateral

### Creer un vault xStocks sur Euler (permissionless)

Euler EVK permet de creer des vaults pour **n'importe quel ERC-20**, y compris les xStocks.
Factory : `0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e`

```solidity
// Deployer un vault pour NVDAx sur Euler
IEVaultFactory factory = IEVaultFactory(0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e);

// Create vault with NVDAx as underlying
address nvdaVault = factory.createProxy(
    address(0), // no upgradeable
    true,       // yes upgradeable (governance)
    abi.encodePacked(
        NVDAx_ADDRESS,          // underlying asset
        CHAINLINK_NVDA_ORACLE,  // oracle
        USDC_ADDRESS            // reference asset for LTV
    )
);

// Configure LTV
IEVault(nvdaVault).setLTV(
    USDC_VAULT,     // collateral vault (USDC)
    0.50e18,        // borrow LTV: 50%
    0.65e18,        // liquidation LTV: 65%
    0               // ramp duration
);
```

### User flow atomique (EVC batch)

```solidity
// En une seule transaction via EVC :
IEVC evc = IEVC(EVC_ADDRESS);

IEVC.BatchItem[] memory items = new IEVC.BatchItem[](4);

// 1. Deposit xStocks as collateral
items[0] = IEVC.BatchItem({
    targetContract: nvdaVault,
    onBehalfOfAccount: user,
    value: 0,
    data: abi.encodeCall(IEVault.deposit, (nvdaAmount, user))
});

// 2. Enable as collateral
items[1] = IEVC.BatchItem({
    targetContract: address(evc),
    onBehalfOfAccount: user,
    value: 0,
    data: abi.encodeCall(IEVC.enableCollateral, (user, nvdaVault))
});

// 3. Enable controller (USDC vault)
items[2] = IEVC.BatchItem({
    targetContract: address(evc),
    onBehalfOfAccount: user,
    value: 0,
    data: abi.encodeCall(IEVC.enableController, (user, usdcVault))
});

// 4. Borrow USDC
items[3] = IEVC.BatchItem({
    targetContract: usdcVault,
    onBehalfOfAccount: user,
    value: 0,
    data: abi.encodeCall(IEVault.borrow, (usdcAmount, user))
});

evc.batch(items);
```

---

## 7. Aster DEX Integration — Perp Positions

### Interface avec Aster

```solidity
interface IAsterAdapter {
    /// @notice Open a short perpetual position
    /// @param xStock The xStock to short (matched to Aster's market)
    /// @param notional USDC-equivalent notional size
    function openShort(address xStock, uint256 notional) external;

    /// @notice Close a short perpetual position
    function closeShort(address xStock) external;

    /// @notice Increase short position size
    function increaseShort(address xStock, uint256 additionalNotional) external;

    /// @notice Decrease short position size
    function decreaseShort(address xStock, uint256 reduceNotional) external;

    /// @notice Claim accrued funding rate payments
    function claimFunding(address xStock) external returns (uint256);

    /// @notice Get current funding rate (annualized)
    function getFundingRate(address xStock) external view returns (int256);

    /// @notice Get position PnL
    function getPositionPnL(address xStock) external view returns (int256);
}
```

### Mapping xStocks → Aster Markets

```solidity
// Map xStock ERC-20 addresses to Aster market IDs
mapping(address => bytes32) public xStockToAsterMarket;

// Setup during deployment:
// NVDAx → NVDA-USD perp on Aster
// TSLAx → TSLA-USD perp on Aster
// METAx → META-USD perp on Aster
// etc.
```

---

## 8. Chainlink Integration

### Data Streams — Prix xStocks

```solidity
import {IFeeManager} from "@chainlink/contracts/src/v0.8/llo-feeds/interfaces/IFeeManager.sol";
import {IVerifierProxy} from "@chainlink/contracts/src/v0.8/llo-feeds/interfaces/IVerifierProxy.sol";

contract ChainlinkPriceFeed {
    IVerifierProxy public verifier;

    // Feed IDs for xStocks (Data Streams)
    bytes32 public constant NVDA_FEED = 0x...; // NVDAx/USD
    bytes32 public constant TSLA_FEED = 0x...; // TSLAx/USD
    bytes32 public constant META_FEED = 0x...; // METAx/USD

    struct PriceData {
        uint256 price;
        uint256 timestamp;
        uint256 bid;
        uint256 ask;
    }

    /// @notice Get verified price from Chainlink Data Streams
    function getPrice(bytes32 feedId, bytes calldata report)
        external returns (PriceData memory)
    {
        // Verify the report
        bytes memory verifiedData = verifier.verify(report);

        // Decode price data
        (
            bytes32 _feedId,
            uint32 validFromTimestamp,
            uint32 observationsTimestamp,
            uint192 nativeFee,
            uint192 linkFee,
            uint32 expiresAt,
            int192 benchmarkPrice,
            int192 bid,
            int192 ask
        ) = abi.decode(verifiedData, (bytes32, uint32, uint32, uint192, uint192, uint32, int192, int192, int192));

        return PriceData({
            price: uint256(uint192(benchmarkPrice)),
            timestamp: observationsTimestamp,
            bid: uint256(uint192(bid)),
            ask: uint256(uint192(ask))
        });
    }
}
```

### Automation — Triggers automatiques

```solidity
import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";

contract ChainlinkKeeper is AutomationCompatibleInterface {
    AutocallEngine public engine;
    HedgeManager public hedgeManager;

    /// @notice Check if any observation or rebalance is needed
    function checkUpkeep(bytes calldata)
        external view override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        // Check 1: Monthly autocall observations due
        bytes32[] memory notesNeedingObservation = engine.getNotesReadyForObservation();
        if (notesNeedingObservation.length > 0) {
            return (true, abi.encode(1, notesNeedingObservation));
        }

        // Check 2: Hedge positions needing rebalance (delta > 5%)
        bytes32[] memory notesNeedingRebalance = hedgeManager.getPositionsNeedingRebalance();
        if (notesNeedingRebalance.length > 0) {
            return (true, abi.encode(2, notesNeedingRebalance));
        }

        // Check 3: Funding rate collection (every 8h)
        if (block.timestamp >= hedgeManager.lastFundingCollection() + 8 hours) {
            return (true, abi.encode(3, new bytes32[](0)));
        }

        return (false, "");
    }

    /// @notice Execute the upkeep
    function performUpkeep(bytes calldata performData) external override {
        (uint8 action, bytes32[] memory noteIds) = abi.decode(performData, (uint8, bytes32[]));

        if (action == 1) {
            // Observe autocall notes
            for (uint i = 0; i < noteIds.length; i++) {
                engine.observe(noteIds[i]);
            }
        } else if (action == 2) {
            // Rebalance hedge positions
            for (uint i = 0; i < noteIds.length; i++) {
                hedgeManager.rebalance(noteIds[i]);
            }
        } else if (action == 3) {
            // Collect funding rates
            hedgeManager.collectAllFunding();
        }
    }
}
```

---

## 9. Capital Flow — End-to-End

```
ETAPE 1 — DEPOT USDC
═════════════════════
Retail depose $10,000 USDC dans XYieldVault
    → Recoit xyUSDC shares (ERC-4626)
    → Protocole preleve origination fee ($30)
    → Capital deploye :
        ├── $5,000 → Euler lending (3-5% safe)
        ├── $3,000 → Funding rate arb (PiggyBank strat)
        │            ├── Buy $3,000 xStocks spot (1inch)
        │            ├── Short $3,000 xStocks perps (Aster)
        │            └── Capture funding rate every 8h
        └── $2,000 → Reserve liquidite

ETAPE 2 — CREATION AUTOCALL
════════════════════════════
AutocallEngine cree une note Phoenix :
    → NoteToken ERC-1155 mint pour le retail
    → Parametres : worst-of NVDAx/METAx/TSLAx, KI 50%, Cpn 12%
    → Embedded fee 2% ($200) preleve
    → Chainlink Automation programme les observations mensuelles

ETAPE 3 — HEDGE (strategie PiggyBank)
══════════════════════════════════════
HedgeManager ouvre le hedge :
    → Achete $10,000 de xStocks du basket via 1inch
    → Collateralise les xStocks sur Euler EVK
    → Emprunte $5,000 USDC contre les xStocks (50% LTV)
    → Short $10,000 notionnel en perps sur Aster DEX
    → Position = delta-neutral ✓
    → Funding rate collecte toutes les 8h ← LE YIELD BONUS

ETAPE 4 — VIE DE LA NOTE (6 mois)
══════════════════════════════════
Chaque mois, Chainlink Automation trigger :
    → Chainlink Data Streams → prix NVDAx, METAx, TSLAx
    → worst = min(NVDAx_perf, METAx_perf, TSLAx_perf)

    Si worst ≥ coupon barrier (70%) :
        → Coupon 1% paye au retail ($100)
        → Memory : coupons rates recuperes aussi

    Si worst ≥ autocall trigger (100% - step-down) :
        → Autocall ! Principal + coupons rendus
        → Hedge ferme (closeHedge)
        → Auto-roll propose (ERC-7579)

ETAPE 5a — AUTOCALL (75-85% des cas)
═════════════════════════════════════
    → $10,000 + coupons accumules → retail
    → HedgeManager close : perp ferme + xStocks vendus via 1inch
    → Funding rate accumule → protocol treasury
    → Embedded fee ($200) → protocol
    → Euler lending yield → protocol
    → Proposition auto-roll pour nouvelle note

ETAPE 5b — KI EVENT (5-10%)
═══════════════════════════
    → worst stock < 50% a maturite
    → Physical delivery via 1inch :
        $10,000 de xStocks du worst performer → retail
    → Retail garde l'exposition equity (peut rebondir)
    → Retail peut deposer ses xStocks sur un yield protocol
    → Le hedge avait capture du funding rate pendant 6 mois
      → protocol garde ce yield meme en cas de KI
```

---

## 10. Epoch System (48h — calque PiggyBank)

PiggyBank utilise un systeme d'epochs de 48h. On replique exactement :

```
┌──────────────────────────────────────────────────────────┐
│                    EPOCH CYCLE (48h)                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  T+0h    │ SNAPSHOT                                      │
│          │ ├── Calculate NAV of all strategies            │
│          │ ├── Mark funding rate accrued                  │
│          │ ├── Update xyUSDC share price                  │
│          │ └── Lock new deposits until epoch end          │
│          │                                                │
│  T+0-24h │ WITHDRAWAL PROCESSING                         │
│          │ ├── Process queued withdrawal requests         │
│          │ ├── Unwind positions if needed                 │
│          │ ├── 1inch swaps to convert back to USDC       │
│          │ └── USDC sent to withdrawing users             │
│          │                                                │
│  T+24-48h│ REBALANCING                                   │
│          │ ├── Check funding rate health                  │
│          │ ├── If healthy: maintain arb allocation        │
│          │ ├── If unhealthy: shift to Euler lending       │
│          │ ├── Rebalance hedge deltas                     │
│          │ ├── Collect funding from Aster                 │
│          │ └── Deploy new deposits into strategies        │
│          │                                                │
│  T+48h   │ NEW EPOCH                                     │
│          │ ├── Increment epoch counter                    │
│          │ ├── Unlock deposits                            │
│          │ └── Start new 48h cycle                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 11. Le coup de genie — Pourquoi GS ne peut pas repliquer

### TradFi : le hedge COUTE

```
Goldman Sachs vend autocall NVDAx/METAx/TSLAx
    → Doit hedger le risque directionnel
    → Achete/vend options OTC + delta hedge en actions
    → Gamma hedging = rebalancing frequent = COUT
    → Bid-ask spreads sur options OTC = COUT
    → Financing cost (emprunt titres) = COUT
    → Total hedge cost : 1-4% du notionnel / an
    → GS doit le compenser par des fees eleves (3-7%)
```

### DeFi : le hedge RAPPORTE

```
xYield vend autocall NVDAx/METAx/TSLAx
    → Doit hedger le risque directionnel
    → Achete xStocks spot via 1inch (= long = delta hedge ✓)
    → Short perps sur Aster DEX (= renforce le delta hedge ✓)
    → Position delta-neutral ✓
    → MAIS : les longs paient le funding rate aux shorts
    → Le hedge RAPPORTE 5-20% ann au lieu de couter 1-4%
    → Le protocole peut offrir des fees plus bas (1-3%)
      ET gagner plus que GS sur chaque note
```

### Pourquoi GS ne peut pas copier ca

| Raison | Detail |
|---|---|
| **Pas de perps crypto/xStocks** | TradFi utilise des futures avec expiration. Le basis = risk-free rate (~4%), minus funding cost (~4.3%) = ~0% net |
| **Reglementation** | Banques systemiques (G-SIBs) interdites d'operer sur des DEX non-regules |
| **Capital requirements** | Crypto/DeFi positions = 1250% risk weight sous Basel III |
| **Infrastructure** | GS ne peut pas deployer de smart contracts sur Aster DEX |
| **Conflict of interest** | GS profite des fees eleves — reduire les fees cannibilise leur business |

---

## 12. Revenue Model

### Par note $10,000 — maturite 6 mois

| Source | Calcul | Montant |
|---|---|---|
| Embedded fee (2%) | $10,000 × 2% | **$200** |
| Origination fee (0.3%) | $10,000 × 0.3% | **$30** |
| Euler spread | $5,000 × 4% × 0.5an | **$100** |
| Funding rate arb (perf fee 20%) | $3,000 × 12% × 0.5an × 20% | **$36** |
| Hedge funding capture (perf fee 20%) | $10,000 × 10% × 0.5an × 20% | **$100** |
| Auto-roll fee | $10,000 × 0.1% × 2 rolls | **$20** |
| **Total protocol / note / an** | | **$486** |
| **Protocol APY** | | **4.86%** |

### Scaling

| TVL | Revenue protocole/an |
|---|---|
| $1M | $48,600 |
| $10M | $486,000 |
| $100M | $4,860,000 |
| $1B | $48,600,000 |

---

## 13. Risk Management

### Automated (Chainlink Automation)

| Trigger | Action |
|---|---|
| Delta drift > 5% | Rebalance perp position on Aster |
| Funding rate negative > 24h | Shift allocation to Euler lending |
| xStock price near liquidation | Add collateral or reduce leverage |
| Epoch boundary (48h) | Full NAV recalc + rebalance |

### Circuit Breakers

| Condition | Response |
|---|---|
| Single xStock drops > 30% in 24h | Pause new note creation for that xStock |
| Total vault drawdown > 5% in epoch | Emergency withdrawal processing |
| Aster DEX smart contract issue | Fallback to Euler-only mode |
| Chainlink feed stale > 1h | Pause observations, alert |

---

## 14. Frontend (Next.js + wagmi + viem)

### Pages

```
/                  → Landing (pitch, APY display, comparison vs GS)
/notes             → Browse active autocall notes (basket, coupon, maturity)
/notes/[id]        → Note detail (observations, coupon history, current status)
/vault             → USDC Vault (deposit/withdraw, xyUSDC balance, yield history)
/dashboard         → Portfolio (my notes, my yield, P&L)
/underwrite        → Underwriter interface (create notes, manage hedges)
```

### Key Components

```
components/
├── NoteCard.tsx        → Autocall note preview (basket, coupon, KI, maturity)
├── VaultDeposit.tsx    → USDC deposit form with epoch timing
├── YieldDisplay.tsx    → Real-time yield from Euler + funding arb
├── ObservationTimeline.tsx → Visual timeline of observations, coupons, status
├── BasketChart.tsx     → Worst-of basket performance chart
├── PnLTracker.tsx      → Portfolio P&L with breakdown
└── CompareGS.tsx       → Side-by-side vs Goldman Sachs product
```

---

## 15. Hackathon Deployment Plan

### Pre-hackathon (16-30 mars)

| Jour | Task |
|---|---|
| 16-18 mars | XYieldVault.sol + EulerStrategy.sol + tests Foundry |
| 19-21 mars | AutocallEngine.sol + NoteToken.sol + ChainlinkPriceFeed.sol |
| 22-24 mars | HedgeManager.sol + AsterAdapter.sol + FundingArbStrategy.sol |
| 25-27 mars | Integration tests (fork Arbitrum mainnet) |
| 28-30 mars | Frontend MVP + deploy testnet |

### Hackathon (31 mars - 2 avril, Cannes)

| Jour | Task |
|---|---|
| J1 (31 mars) | Deploy sur Arbitrum (ou Ethereum), demo end-to-end |
| J2 (1 avril) | Polish, edge cases, pitch deck |
| J3 (2 avril) | Video demo 2 min, presentations |

### Demo Flow

```
1. Retail depose 1,000 USDC dans le vault → recoit xyUSDC
2. Note autocall creee : NVDAx/METAx/TSLAx, KI 50%, Cpn 12%
3. Hedge ouvre automatiquement (xStocks achetees, perps shorts sur Aster)
4. Simulation d'observation mensuelle → coupon paye
5. Simulation d'autocall trigger → principal + coupons rendus
6. Dashboard montre yield accumule du funding rate arb
7. Comparaison live : "GS prend 5% de fees, nous 1-2%"
```

---

## 16. Pitch Structure (2 min)

**0:00 — Hook**
> "$125 milliards d'autocalls vendus chaque annee. Goldman Sachs prend 5% de fees.
> Nous avons reconstruit le meme produit onchain — pour 1%."

**0:20 — Le produit**
> "Phoenix autocall sur xStocks. Worst-of NVDA/META/TSLA.
> 12% de coupon annualise. Physical delivery en xStocks si KI touche."

**0:40 — L'innovation**
> "Premier autocall ou le hedge rapporte au lieu de couter.
> On utilise la meme strategie que PiggyBank : long spot + short perps = funding rate capture.
> Chez GS, le hedge coute 1-4%. Chez nous, il rapporte 5-20%."

**1:00 — Demo live**
> Montrer le flow : deposit → note → hedge → observation → coupon

**1:30 — Chiffres**
> "4.86% protocol APY. 7 partenaires integres.
> 120,960 configurations simulees en Monte Carlo.
> Blue ocean : zero produit structure onchain aujourd'hui."

**1:50 — Close**
> "Goldman Sachs pour le retail. Permissionless. Sur xStocks."

---

## 17. Partenaires Integres

| Partenaire | Role | Integration |
|---|---|---|
| **xStocks** | Sous-jacent (NVDAx, METAx, TSLAx) | ERC-20 tokens |
| **Euler Finance** | Lending USDC + xStocks collateral | ERC-4626 vaults + EVK |
| **Aster DEX** | Stock perps on-chain (funding rate arb) | Smart contract (Eth/Arb) |
| **Chainlink** | Data Streams (prix) + Automation (triggers) | Oracle + keeper |
| **1inch** | Swap xStocks spot | Aggregator API |
| **PiggyBank** | Strategie de reference (jury) | Architecture model |
| **ERC-7579** | Auto-roll via smart account | Executor module |

---

*Architecture calquee sur PiggyBank (piggybank.fi). Meme strategie de funding rate arbitrage,
adaptee de Solana (Kamino+Drift) vers EVM (Euler+Aster DEX). Premier autocall peer-to-peer
onchain ou le delta hedge genere du yield. Document genere le 16 mars 2026.*
