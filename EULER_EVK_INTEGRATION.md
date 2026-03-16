# Euler Finance EVK Integration for xStocks Collateral

## Research Date: 2026-03-16

---

## 1. Architecture Overview

### Euler V2 Core Components

Euler V2 is a **modular lending protocol** built on three pillars:

1. **Ethereum Vault Connector (EVC)** - Mediation layer connecting vaults, handling collateral/controller relationships
2. **Euler Vault Kit (EVK)** - Framework for deploying ERC-4626 credit vaults with borrowing functionality
3. **Euler Price Oracle (EPO)** - Library of immutable oracle adapters (Chainlink, Pyth, Redstone, etc.)

**Key property:** Anyone can permissionlessly deploy isolated lending vaults for any ERC-20 token, with custom risk parameters, oracles, and interest rate models.

### Contract Addresses (Ethereum Mainnet)

| Contract | Address |
|----------|---------|
| eVault Factory | `0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e` |
| EVault Implementation | `0x8ff1c814719096b61abf00bb46ead0c9a529dd7d` |
| Escrowed Collateral Perspective | `0x4e58BBEa423c4B9A2Fc7b8E58F5499f9927fADdE` |
| Governed Perspective | `0xC0121817FF224a018840e4D15a864747d36e6Eb2` |
| Balance Tracker (Rewards) | `0x0D52d06ceB8Dcdeeb40Cfd9f17489B350dD7F8a3` |
| Fee Flow | `0xFcd3Db06EA814eB21C84304fC7F90798C00D1e32` |

> **Note:** For Base/Arbitrum addresses, check https://docs.euler.finance/developers/contract-addresses/ (loaded dynamically from euler-interfaces repo).

---

## 2. How EVK Vaults Work

### Credit Vault = ERC-4626 + Borrowing

EVK vaults are **extended ERC-4626 vaults** that function as passive lending pools. Each vault:
- Holds exactly **one underlying ERC-20 token** (e.g., USDC)
- Earns yield by **lending** to borrowers (not active strategies)
- Has its own oracle, IRM, LTV config, and governance

### Vault-to-Vault Collateral

Unlike traditional lending (asset-level collateral), Euler uses **vault-to-vault collateral recognition**:
- Deposits in Vault A (e.g., xAAPL vault) create vault shares
- Those shares can be recognized as collateral by Vault B (e.g., USDC vault)
- The borrower enables the collateral relationship via the EVC

### Exchange Rate

```
exchangeRate = (cash + totalBorrows + VIRTUAL_DEPOSIT) / (totalShares + VIRTUAL_DEPOSIT)
VIRTUAL_DEPOSIT = 1e6  (prevents rounding manipulation)
```

---

## 3. Deploying a Vault via GenericFactory

### Factory Architecture

The `GenericFactory` contract deploys vault proxies. Each proxy stores **trailing metadata** (60 bytes) encoding:

```solidity
// From ProxyUtils.sol - metadata is appended to every call through the proxy
function metadata() internal pure returns (IERC20 asset, IPriceOracle oracle, address unitOfAccount) {
    assembly {
        asset := shr(96, calldataload(sub(calldatasize(), 60)))        // bytes [0:20]
        oracle := shr(96, calldataload(sub(calldatasize(), 40)))       // bytes [20:40]
        unitOfAccount := shr(96, calldataload(sub(calldatasize(), 20))) // bytes [40:60]
    }
}
```

### createProxy Function

```solidity
function createProxy(
    address desiredImplementation,  // Current implementation address (front-run protection)
    bool upgradeable,               // true = BeaconProxy, false = MetaProxy (immutable)
    bytes memory trailingData       // abi.encodePacked(asset, oracle, unitOfAccount)
) external returns (address proxy);
```

### Deployment Steps

```solidity
// 1. Encode trailing data
bytes memory trailingData = abi.encodePacked(
    address(xAAPL_TOKEN),      // underlying asset (the xStocks token)
    address(oracleRouter),     // price oracle for the vault
    address(840)               // unitOfAccount = USD (ISO 4217 code)
);

// 2. Deploy the vault proxy
address vault = GenericFactory(EVAULT_FACTORY).createProxy(
    EVAULT_FACTORY.implementation(),  // desiredImplementation
    true,                              // upgradeable (BeaconProxy)
    trailingData
);

// 3. The factory calls initialize(msg.sender) on the new proxy
// This sets msg.sender as both creator and governorAdmin
```

### Vault Types (Governance Matrix)

| Type | Upgradeable | Governor | Properties |
|------|-------------|----------|------------|
| Governed + Upgradeable | true | deployer | Max flexibility, factory admin can upgrade impl |
| Governed + Immutable | false | deployer | Governor adjusts params, impl is fixed |
| Finalized + Upgradeable | true | address(0) | No param changes, but impl can upgrade |
| Finalized + Immutable | false | address(0) | Fully immutable, trustless |

---

## 4. Governor Configuration Functions (IGovernance)

After deployment, the vault governor configures all risk parameters:

### setLTV - Configure Collateral Recognition

```solidity
function setLTV(
    address collateral,       // Address of the COLLATERAL VAULT (not the token!)
    uint16 borrowLTV,         // Max LTV for new borrows, scaled by 1e4 (e.g., 0.75e4 = 75%)
    uint16 liquidationLTV,    // LTV at which liquidation becomes possible, scaled by 1e4
    uint32 rampDuration       // Seconds to ramp liquidation LTV (for smooth phase-outs)
) external;
```

**Critical:** `collateral` is the address of another EVK vault (where xStocks are deposited), NOT the token address directly. Euler uses vault-to-vault collateral.

**Constraints:**
- `borrowLTV <= liquidationLTV`
- Both scaled by `CONFIG_SCALE = 1e4` (so 0.75e4 = 75%)
- `rampDuration` allows smooth LTV changes (liquidation LTV ramps from current to target)

### setOracle

```solidity
function setOracle(address oracle) external;  // Not in standard IGovernance - set at deployment
// Oracle is immutable, set via trailingData at createProxy time
```

> **Important:** The oracle is set at deployment via trailing data and cannot be changed after. The vault governor can only change which collateral vaults are recognized and their LTVs.

### setInterestRateModel

```solidity
function setInterestRateModel(address newModel) external;
```

Euler supports two IRM types:
- **Kink IRM**: Piecewise-linear curve with a kink point (similar to Compound)
- **Adaptive Curve IRM**: Dynamically adjusts based on market conditions

### Other Governor Functions

```solidity
function setGovernorAdmin(address newGovernorAdmin) external;
function setFeeReceiver(address newFeeReceiver) external;
function setInterestFee(uint16 newFee) external;           // Fee on interest, 1e4 scale (default 10%)
function setMaxLiquidationDiscount(uint16 newDiscount) external; // Liquidation incentive, 1e4 scale
function setLiquidationCoolOffTime(uint16 newCoolOffTime) external;
function setCaps(uint16 supplyCap, uint16 borrowCap) external;   // AmountCap format
function setHookConfig(address newHookTarget, uint32 newHookedOps) external;
function setConfigFlags(uint32 newConfigFlags) external;
```

---

## 5. Oracle Setup for xStocks

### Chainlink + xStocks Alliance

Chainlink is the **official oracle infrastructure** for xStocks:
- Chainlink joined the xStocks Alliance as official pricing partner
- **Chainlink Data Streams** deliver sub-second price latency for 50+ tokenized equities/ETFs
- Also supports **Chainlink Proof of Reserve** for collateral verification
- Backed.fi previously had Chainlink feeds for bIB01, bIBTA, bCSPX (predecessor tokens)

### Euler ChainlinkOracle Adapter

```solidity
// From euler-xyz/euler-price-oracle/src/adapter/chainlink/ChainlinkOracle.sol

contract ChainlinkOracle is BaseAdapter {
    address public immutable base;          // xStocks token address
    address public immutable quote;         // Quote asset (e.g., USD = address(840))
    address public immutable feed;          // Chainlink Aggregator address
    uint256 public immutable maxStaleness;  // Max age before price is stale (1 min - 72 hours)

    constructor(
        address _base,          // e.g., xAAPL token address
        address _quote,         // e.g., address(840) for USD
        address _feed,          // Chainlink AggregatorV3 feed address
        uint256 _maxStaleness   // e.g., 3700 (slightly > 1hr heartbeat)
    ) {
        // Validates maxStaleness in [1 minute, 72 hours]
        // Computes scale factors from base/quote/feed decimals
    }
}
```

### Oracle Router Setup

The EulerRouter aggregates multiple adapters:

1. **Deploy ChainlinkOracle adapter** for each xStocks token (xAAPL/USD, xTSLA/USD, etc.)
2. **Deploy an EulerRouter** (via Oracle Router Factory)
3. **Configure the router** to map each token pair to its adapter
4. **For ERC-4626 vaults as collateral**: register "resolved vaults" so router uses `convertToAssets()` to price vault shares

**Oracle Dashboard**: https://oracles.euler.finance/

### Steps for Oracle Deployment

1. Check if adapter exists on [Euler Oracles Dashboard](https://oracles.euler.finance/)
2. If not, deploy via **Oracle Deployer** at oracle-deployer.euler.finance
3. Deploy Oracle Router at create.euler.finance
4. Configure adapters: add xStocks/USD adapters + USDC/USD adapter
5. Register resolved vaults (for ERC-4626 collateral pricing)
6. Verify on block explorer, submit PR to euler-interfaces repo

---

## 6. Complete Deployment Flow: xStocks Collateral -> Borrow USDC

### Architecture

```
User deposits xAAPL -> [xAAPL Collateral Vault] --collateral--> [USDC Lending Vault] -> User borrows USDC
                              |                                          |
                        ERC-4626 vault                             ERC-4626 vault
                        (escrowed collateral)                      (borrowable)
                              |                                          |
                    Oracle: xAAPL/USD                          Oracle: USDC/USD
                    (Chainlink Data Streams)                   (Chainlink)
```

### Step-by-Step Deployment

#### Step 1: Deploy Oracle Infrastructure

```solidity
// Deploy Chainlink adapter for xAAPL
ChainlinkOracle xAAPLOracle = new ChainlinkOracle(
    xAAPL_ADDRESS,       // base token
    address(840),        // quote = USD
    CHAINLINK_XAAPL_FEED, // Chainlink feed address
    3700                 // maxStaleness (slightly > 1hr heartbeat)
);

// Deploy Chainlink adapter for USDC
ChainlinkOracle usdcOracle = new ChainlinkOracle(
    USDC_ADDRESS,
    address(840),
    CHAINLINK_USDC_FEED,
    86500                // maxStaleness for USDC
);

// Deploy Oracle Router and configure
// (Use Euler Router Factory or euler-vault-scripts)
```

#### Step 2: Deploy the USDC Lending Vault (where borrowing happens)

```solidity
bytes memory usdcTrailingData = abi.encodePacked(
    USDC_ADDRESS,           // underlying = USDC
    address(oracleRouter),  // oracle router
    address(840)            // unitOfAccount = USD
);

address usdcVault = GenericFactory(EVAULT_FACTORY).createProxy(
    EVAULT_FACTORY.implementation(),
    true,  // upgradeable
    usdcTrailingData
);
```

#### Step 3: Deploy the xAAPL Collateral Vault (escrowed collateral)

```solidity
bytes memory xAAPLTrailingData = abi.encodePacked(
    xAAPL_ADDRESS,          // underlying = xAAPL token
    address(oracleRouter),  // same oracle router
    address(840)            // unitOfAccount = USD
);

address xAAPLVault = GenericFactory(EVAULT_FACTORY).createProxy(
    EVAULT_FACTORY.implementation(),
    true,
    xAAPLTrailingData
);
```

#### Step 4: Configure the USDC Vault (as governor)

```solidity
IEVault(usdcVault).setInterestRateModel(kinkIRM);     // Set IRM
IEVault(usdcVault).setMaxLiquidationDiscount(0.15e4);  // 15% max discount
IEVault(usdcVault).setLiquidationCoolOffTime(1);       // 1 second cooloff

// Recognize xAAPL vault as collateral for USDC vault
IEVault(usdcVault).setLTV(
    xAAPLVault,     // collateral vault address
    0.65e4,         // borrowLTV = 65% (conservative for tokenized stocks)
    0.70e4,         // liquidationLTV = 70%
    0               // rampDuration = immediate
);

// Set supply/borrow caps
IEVault(usdcVault).setCaps(supplyCap, borrowCap);
```

#### Step 5: Configure the xAAPL Vault (escrowed collateral mode)

```solidity
// For escrowed collateral, the xAAPL vault doesn't need borrowing enabled
// It just holds deposits that serve as collateral
// No IRM needed, no LTVs to set (it's the collateral, not the liability vault)
```

### Step 6: User Interaction - Borrow USDC Against xAAPL

```solidity
// === User Flow (via EVC batching) ===

// 1. Approve xAAPL token for the collateral vault
IERC20(xAAPL).approve(xAAPLVault, amount);

// 2. Build batch
IEVC.BatchItem[] memory items = new IEVC.BatchItem[](4);

// 2a. Deposit xAAPL into the collateral vault
items[0] = IEVC.BatchItem({
    targetContract: xAAPLVault,
    onBehalfOfAccount: userAddress,     // main address (token source)
    value: 0,
    data: abi.encodeCall(IEVault.deposit, (xAAPLAmount, userAddress))
});

// 2b. Enable xAAPL vault as collateral
items[1] = IEVC.BatchItem({
    targetContract: address(evc),
    onBehalfOfAccount: userAddress,
    value: 0,
    data: abi.encodeCall(IEVC.enableCollateral, (userAddress, xAAPLVault))
});

// 2c. Enable USDC vault as controller (grants it permission to check your health)
items[2] = IEVC.BatchItem({
    targetContract: address(evc),
    onBehalfOfAccount: userAddress,
    value: 0,
    data: abi.encodeCall(IEVC.enableController, (userAddress, usdcVault))
});

// 2d. Borrow USDC
items[3] = IEVC.BatchItem({
    targetContract: usdcVault,
    onBehalfOfAccount: userAddress,
    value: 0,
    data: abi.encodeCall(IEVault.borrow, (usdcAmount, userAddress))
});

// 3. Execute batch atomically
IEVC(evc).batch(items);
// Health checks are deferred to end of batch
```

---

## 7. Using euler-vault-scripts (Recommended for Production)

The `euler-vault-scripts` repo provides a battle-tested framework for deploying vault clusters.

### Cluster Configuration Example

```solidity
// script/clusters/XStocksCluster.s.sol
contract XStocksCluster is ClusterScript {

    function defineCluster() internal override {
        cluster.assets = [xAAPL, xTSLA, xGOOG, USDC];
    }

    function configureCluster() internal override {
        // Governance
        cluster.oracleRoutersGovernor = getDeployer();
        cluster.vaultsGovernor = getDeployer();
        cluster.unitOfAccount = USD;  // address(840)

        // Fees
        cluster.feeReceiver = address(0);
        cluster.interestFee = 0.1e4;  // 10% of interest -> protocol

        // Liquidation
        cluster.maxLiquidationDiscount = 0.15e4;  // 15%
        cluster.liquidationCoolOffTime = 1;

        // Oracle providers (Chainlink adapters)
        cluster.oracleProviders[xAAPL] = "0x..."; // Chainlink xAAPL/USD adapter
        cluster.oracleProviders[xTSLA] = "0x..."; // Chainlink xTSLA/USD adapter
        cluster.oracleProviders[xGOOG] = "0x..."; // Chainlink xGOOG/USD adapter
        cluster.oracleProviders[USDC]  = "0x..."; // Chainlink USDC/USD adapter

        // Supply & Borrow Caps
        cluster.supplyCaps[xAAPL] = 10_000;
        cluster.supplyCaps[USDC]  = 5_000_000;
        cluster.borrowCaps[USDC]  = 4_000_000;

        // IRM (Kink model for USDC borrowing)
        cluster.kinkIRMParams[USDC] = [uint256(0), uint256(194425692),
                                        uint256(41617711740), uint256(3865470566)];

        // LTV Matrix: columns = liability vaults, rows = collateral vaults
        //                      xAAPL    xTSLA    xGOOG    USDC
        cluster.ltvs = [
            [uint16(0.00e4), 0.00e4, 0.00e4, 0.00e4],  // xAAPL (no borrowing from xStocks)
            [uint16(0.00e4), 0.00e4, 0.00e4, 0.00e4],  // xTSLA
            [uint16(0.00e4), 0.00e4, 0.00e4, 0.00e4],  // xGOOG
            [uint16(0.65e4), 0.65e4, 0.65e4, 0.00e4],  // USDC as collateral for xStocks (if needed)
        ];
        // Note: For xStocks as collateral to borrow USDC, invert the matrix:
        // Set LTV for xAAPL->USDC, xTSLA->USDC, xGOOG->USDC in the USDC column

        cluster.spreadLTV = 0.05e4;  // 5% spread between borrow and liquidation LTV
    }
}
```

### Deploy Command

```bash
# Dry run first
./script/ExecuteSolidityScript.sh ./script/clusters/XStocksCluster.s.sol \
  --dry-run --rpc-url 1 --account DEPLOYER

# Production deployment
./script/ExecuteSolidityScript.sh ./script/clusters/XStocksCluster.s.sol \
  --rpc-url 1 --account DEPLOYER

# For multisig governance
./script/ExecuteSolidityScript.sh ./script/clusters/XStocksCluster.s.sol \
  --batch-via-safe --safe-address DAO_SAFE --rpc-url 1
```

---

## 8. xStocks Token Details

### Backed.fi / xStocks ERC-20 Tokens

- **Issuer:** Backed Finance (Swiss-regulated)
- **Token type:** ERC-20, fully backed 1:1 by real securities
- **Available:** 55+ tokenized stocks and ETFs (AAPL, TSLA, GOOGL, AMZN, SPY, etc.)
- **Chains:** Ethereum, Solana, Base, Polygon (EVM chains as ERC-20)
- **Oracle:** Chainlink Data Streams (official alliance partner)

### Known Token Addresses (Ethereum)

Some xStocks/Backed token addresses found on Etherscan (verify before use):
- `0xf8a80d1cb9cfd70d03d655d9df42339846f3b3c8`
- `0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48`
- `0xaf072f109a2c173d822a4fe9af311a1b18f83d19`
- `0xa6a65ac27e76cd53cb790473e4345c46e5ebf961`
- `0xae2f842ef90c0d5213259ab82639d5bbf649b08e`

> **Action needed:** Verify specific token-to-ticker mappings on Etherscan or via backed.fi docs.

### Existing DeFi Integrations

- **Kamino Finance** (Solana): Already accepts xStocks as lending collateral
- **Securitize + Euler**: Partnership for DS tokens (tokenized securities) as Euler collateral
- **No existing xStocks vault on Euler** found as of this research date

---

## 9. Key Considerations for xStocks Collateral

### LTV Ratio Recommendations

For tokenized equities, consider:
- **Borrow LTV: 60-70%** (individual stocks are more volatile than blue-chip crypto)
- **Liquidation LTV: 70-80%** (needs buffer for stock market volatility)
- **Spread: 5-10%** between borrow and liquidation LTV
- Compare: Euler typically uses 85-95% for stablecoin pairs, 75-87% for ETH/BTC

### Oracle Considerations

- xStocks trade during **US market hours only** (9:30 AM - 4:00 PM ET)
- **After-hours risk:** Prices may not update outside trading hours
- `maxStaleness` must account for weekends/holidays (could be up to ~65 hours for weekends)
- Consider using **Chainlink Data Streams** (sub-second latency) vs traditional feeds
- **Chainlink Proof of Reserve** can verify the 1:1 backing

### Regulatory / Transfer Restrictions

- Backed tokens may have **transfer restrictions** (whitelist-based)
- EVK supports this via **Hook system**: can add KYC/whitelist checks
- The `setHookConfig()` function enables custom access controls per vault

### Liquidation Concerns

- Stock market circuit breakers could prevent price updates
- Consider lower `maxLiquidationDiscount` for RWA assets
- Set appropriate `liquidationCoolOffTime` to prevent MEV exploitation

---

## 10. ERC20Collateral Alternative

Euler also supports **ERC20Collateral** tokens that can be used as collateral **directly from the wallet** without depositing into a vault:

```solidity
// ERC20CollateralWrapper: retrofits existing tokens with EVC compatibility
// Allows xStocks holders to use tokens as collateral without vault deposit
// The wrapper calls into the EVC to check solvency rules
```

This could simplify the UX: users don't need to deposit xStocks into a separate vault first.

---

## 11. Relevant Repositories

| Repository | Purpose |
|-----------|---------|
| [euler-xyz/euler-vault-kit](https://github.com/euler-xyz/euler-vault-kit) | Core EVK contracts (EVault, GenericFactory) |
| [euler-xyz/ethereum-vault-connector](https://github.com/euler-xyz/ethereum-vault-connector) | EVC contracts |
| [euler-xyz/euler-price-oracle](https://github.com/euler-xyz/euler-price-oracle) | Oracle adapters (Chainlink, Pyth, etc.) |
| [euler-xyz/euler-vault-scripts](https://github.com/euler-xyz/euler-vault-scripts) | Deployment scripts for vault clusters |
| [euler-xyz/evc-playground](https://github.com/euler-xyz/evc-playground) | Example vault implementations |
| [euler-xyz/euler-interfaces](https://github.com/euler-xyz/euler-interfaces) | Contract addresses & ABIs |

---

## 12. Summary: Minimum Steps to Deploy

1. **Get xStocks Chainlink feed addresses** (via Chainlink Data Streams / xStocks Alliance)
2. **Deploy ChainlinkOracle adapters** for each xStocks token (base=xToken, quote=USD, feed=ChainlinkAggregator)
3. **Deploy an EulerRouter** and configure it with xStocks + USDC adapters
4. **Deploy USDC lending vault** via GenericFactory (underlying=USDC, oracle=router, unitOfAccount=USD)
5. **Deploy xStocks collateral vault(s)** via GenericFactory (underlying=xAAPL, oracle=router, unitOfAccount=USD)
6. **Configure USDC vault as governor:**
   - `setLTV(xAAPLVault, 0.65e4, 0.70e4, 0)` -- recognize xAAPL vault as collateral
   - `setInterestRateModel(kinkIRM)` -- set borrowing rates
   - `setMaxLiquidationDiscount(0.15e4)` -- incentivize liquidators
   - `setCaps(supplyCap, borrowCap)` -- risk limits
7. **Users interact via EVC batch:** deposit xAAPL -> enable collateral -> enable controller -> borrow USDC

**Alternative: Use `euler-vault-scripts`** for a production-grade, auditable deployment with cluster configuration.
