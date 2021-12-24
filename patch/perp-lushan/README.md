
# Overview 

## 1. Sunny's Patch 

This is just to be able to run perp-lushan from basis-trading-stablecoin and to integrate with it

1). Open hardhat.config.ts of perp-lushan repo and add below in `networks`

    local: {
            url: "http://localhost:8545",
            allowUnlimitedContractSize: true
        },

2). Open contracts folder in perp-lushan and create `mock` folder and add below fine name called `MockTestAggregatorV3.sol`

    https://gist.github.com/sunnyRK/a491d6fb24544d9b8f1858058975b54f

3). open deployments folder in perp-lushan and create file called `local.deployment.js`

4). open `scripts` folder in perp-lushan repo a and create file like `deploy_local.ts` and add below gist code in it. 

    https://gist.github.com/sunnyRK/2f6bbf010b4dc43eb6d9647e8127ab83

5). open test folder in perp-lushan repo and create folder called `localDeployFixture`  

-> and create 3 files like below,  
- fixtures.ts  
- sharedFixtures.ts  
- utilities.ts  

and add below gist code in these three files. you will get 3 files in below gist and add respectively.

    https://gist.github.com/sunnyRK/83211224d1eda6ac274bafbe6286a57c





## 2. Quoter Contract Deployment 

This is to deploy the Uniswap V3 Quoter Contract as a part of the perp-lushan protocol 

The reason is in its actual implementation in the `contracts/wrapper/PerpLemma.sol` the `getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)` relies on using in the `Quoter.sol` the `quoteExactInputSingle()` function 

Follow the instructions [here](https://hackmd.io/9BQ7COTxQRilrUUJNw0O7A) 



-------------


# Extending Perp Lushan with Quoter 

The `getCollateralAmountGivenUnderlyingAssetAmount()` for the `PerpLemma.sol` wrapper, in its current implementation requires the Uniswap V3 Quoter so we need to add it 

## 1. Add the UniswapV3 Periphery to the project deps in `package.json`

```
nicolabernini@nicolabernini-ThinkPad-X1-Extreme-Gen-3:~/Documents/personal/Lemma/test20211217/basis-trading-stablecoin/perp-lushan$ git diff package.json
diff --git a/package.json b/package.json
index 01cf9f63..e1567beb 100644
--- a/package.json
+++ b/package.json
@@ -84,7 +84,7 @@
     "@types/mocha": "9.0.0",
     "@types/node": "15.6.1",
     "@uniswap/v3-core": "https://github.com/Uniswap/uniswap-v3-core/tarball/v1.0.0",
-    "@uniswap/v3-periphery": "1.0.1",
+    "@uniswap/v3-periphery": "https://github.com/Uniswap/v3-periphery/tarball/v1.3.0",
     "bignumber.js": "9.0.1",
     "chai": "4.3.4",
     "eslint-config-prettier": "8.3.0",

```

- Use the tarball instead of the npm package, since the npm does not contain the `Quoter.sol` source but the artifacts only 
- We need the source sol file since we have to compile it into typechain 


## 2. Add the `Quoter.sol` to the list of files to be compiled in `hardhat.config.js` file 

```
nicolabernini@nicolabernini-ThinkPad-X1-Extreme-Gen-3:~/Documents/personal/Lemma/test20211217/basis-trading-stablecoin/perp-lushan$ git diff hardhat.config.ts
diff --git a/hardhat.config.ts b/hardhat.config.ts
index f33fa37a..56d16781 100644
--- a/hardhat.config.ts
+++ b/hardhat.config.ts
@@ -78,6 +78,10 @@ const config: HardhatUserConfig = {
             },
             chainId: ChainId.OPTIMISM_CHAIN_ID,
         },
+        local: {
+            url: "http://localhost:8545",
+            allowUnlimitedContractSize: true
+        },
     },
     namedAccounts: {
         deployer: 0, // 0 means ethers.getSigners[0]
@@ -130,7 +134,7 @@ const config: HardhatUserConfig = {
     },
     dependencyCompiler: {
         // We have to compile from source since UniswapV3 doesn't provide artifacts in their npm package
-        paths: ["@uniswap/v3-core/contracts/UniswapV3Factory.sol", "@uniswap/v3-core/contracts/UniswapV3Pool.sol"],
+        paths: ["@uniswap/v3-core/contracts/UniswapV3Factory.sol", "@uniswap/v3-core/contracts/UniswapV3Pool.sol", "@uniswap/v3-periphery/contracts/lens/Quoter.sol"],
     },
     external: {
         contracts: [

```


Now compiling the project with `npx hardhat compile` should generated the `typechain/Quoter.d.ts` that can be accessed in the `fixtures.ts` and `deploy_local.ts` files to deploy the contract 



## 3. Add the Quoter Contract to the list of the ones to be deployed 

### 3.1 Modifications to `test/localDeployFixture/fixtures.ts` 

#### 3.1.1 Imports 

```typescript=
import {
    AccountBalance,
    BaseToken,
    ClearingHouse,
    ClearingHouseConfig,
    Exchange,
    InsuranceFund,
    MarketRegistry,
    MockTestAggregatorV3,
    OrderBook,
    TestClearingHouse,
    TestERC20,
    TestExchange,
    TestUniswapV3Broker,
    UniswapV3Factory,
    UniswapV3Pool,
    Vault,
+    Quoter
} from "../../typechain"

```


As we have `typechain/Quoter.d.ts` resulting from compiling the project 



#### 3.1.2 Interface Exports 

```typescript=
export interface ClearingHouseFixture {
    clearingHouse: TestClearingHouse | ClearingHouse
    orderBook: OrderBook
    accountBalance: TestAccountBalance | AccountBalance
    marketRegistry: MarketRegistry
    clearingHouseConfig: ClearingHouseConfig
    exchange: TestExchange | Exchange
    vault: Vault
    insuranceFund: InsuranceFund
    uniV3Factory: UniswapV3Factory
    pool: UniswapV3Pool
    uniFeeTier: number
    USDC: TestERC20
    quoteToken: QuoteToken
    baseToken: BaseToken
    mockedBaseAggregator: MockTestAggregatorV3
    baseToken2: BaseToken
    mockedBaseAggregator2: MockTestAggregatorV3
    pool2: UniswapV3Pool
+    quoter: Quoter
}
```

As we need to export the `quoter` contract 



#### 3.1.3 Deploy and Initialize

The Ethers interface allows to deploy and initialize at the same time using the `Factory.deploy(args)` function 

In its original version, the Quoter needs to 2 addresses 
- the UniV3 Factory, as it exposes the API to locate a pool given the tuple `(token0, token1, fees)` and 
- WETH9


```solidity=
constructor(address _factory, address _WETH9) PeripheryImmutableState(_factory, _WETH9) {}
```

As defined [here](https://github.com/Uniswap/v3-periphery/blob/7c987c2a5131193d36d51001b1b04be907b0ba06/contracts/lens/Quoter.sol#L27)

However, in our case we do not need WETH9 so we can just pass ANY ADDRESS, let's use USDC for example 

```typescript=
        // deploy UniV3 factory
        const factoryFactory = await ethers.getContractFactory("UniswapV3Factory")
        const uniV3Factory = (await factoryFactory.deploy()) as UniswapV3Factory

+        const quoterFactory = await ethers.getContractFactory("Quoter")
+        const quoter = (await quoterFactory.deploy(uniV3Factory.address, USDC.address)) as Quoter

```



#### 3.1.4 Export the `ClearingHouseFixture` interface with the Quoter Added

```typescript=
        return {
            clearingHouse,
            orderBook,
            accountBalance,
            marketRegistry,
            clearingHouseConfig,
            exchange,
            vault,
            insuranceFund,
            uniV3Factory,
            pool,
            uniFeeTier,
            USDC,
            quoteToken,
            baseToken,
            mockedBaseAggregator,
            baseToken2,
            mockedBaseAggregator2,
            pool2,
+            quoter,
        }
```



## 3.2 Modifications to `scripts/deploy_local.ts`

The Deployed Quoter Contract Object is returned as an additional field in `ClearingHouseFixture` that is created by the `createClearingHouseFixture()` function that is called in the `scripts/deploy_local.ts` 

Here, we just need to add the Quoter Contract to the list of deployed contracts that is maintained in the `deployedContracts[]` hashmap that will be saved as the `deployments/local.deployment.js` file 

This is the way that is used by the perp-lushan protocol to advertise its deployed contracts

```typescript=
    const loadFixture: ReturnType<typeof waffle.createFixtureLoader> = waffle.createFixtureLoader([admin])
    const _clearingHouseFixture = await loadFixture(createClearingHouseFixture())
    clearingHouse = _clearingHouseFixture.clearingHouse as TestClearingHouse
    orderBook = _clearingHouseFixture.orderBook
    accountBalance = _clearingHouseFixture.accountBalance
    clearingHouseConfig = _clearingHouseFixture.clearingHouseConfig
    vault = _clearingHouseFixture.vault
    exchange = _clearingHouseFixture.exchange
    marketRegistry = _clearingHouseFixture.marketRegistry
    collateral = _clearingHouseFixture.USDC
    baseToken = _clearingHouseFixture.baseToken
    baseToken2 = _clearingHouseFixture.baseToken2
    quoteToken = _clearingHouseFixture.quoteToken
    mockedBaseAggregator = _clearingHouseFixture.mockedBaseAggregator
    mockedBaseAggregator2 = _clearingHouseFixture.mockedBaseAggregator2
    pool = _clearingHouseFixture.pool
    pool2 = _clearingHouseFixture.pool2
    univ3factory = _clearingHouseFixture.uniV3Factory
+    quoter = _clearingHouseFixture.quoter


    deployedContracts['clearingHouse'] = {
        name: 'clearingHouse',
        address: clearingHouse.address
    };

    deployedContracts['orderBook'] = {
        name: 'orderBook',
        address: orderBook.address
    };

    deployedContracts['clearingHouseConfig'] = {
        name: 'clearingHouseConfig',
        address: clearingHouseConfig.address
    }; 

    deployedContracts['vault'] = {
        name: 'vault',
        address: vault.address
    };    
    
    deployedContracts['exchange'] = {
        name: 'exchange',
        address: exchange.address
    };       
    
    deployedContracts['marketRegistry'] = {
        name: 'marketRegistry',
        address: marketRegistry.address
    };   

    deployedContracts['collateral'] = {
        name: 'collateral',
        address: collateral.address
    };

    deployedContracts['baseToken'] = {
        name: 'baseToken',
        address: baseToken.address
    };

    deployedContracts['baseToken2'] = {
        name: 'baseToken2',
        address: baseToken2.address
    };

    deployedContracts['quoteToken'] = {
        name: 'quoteToken',
        address: quoteToken.address
    }; 

    deployedContracts['mockedBaseAggregator'] = {
        name: 'mockedBaseAggregator',
        address: mockedBaseAggregator.address
    };    
    
    deployedContracts['mockedBaseAggregator2'] = {
        name: 'mockedBaseAggregator2',
        address: mockedBaseAggregator2.address
    };       
    
    deployedContracts['pool'] = {
        name: 'pool',
        address: pool.address
    };   

    deployedContracts['pool2'] = {
        name: 'pool2',
        address: pool2.address
    };

    deployedContracts['accountBalance'] = {
        name: 'accountBalance',
        address: accountBalance.address
    };

    deployedContracts['accountBalance'] = {
        name: 'accountBalance',
        address: accountBalance.address
    };

    deployedContracts['univ3factory'] = {
        name: 'univ3factory',
        address: univ3factory.address
    }

+    deployedContracts['quoter'] = {
+        name: 'quoter',
+        address: quoter.address
    };

    console.log('deployedContracts: ', deployedContracts)
    await fs.writeFileSync(SAVE_PREFIX + SAVE_POSTFIX, JSON.stringify(deployedContracts, null, 2));

```

The `deployedCntracts[]` hashmap is written in the `perp-lushan/deployments/local.deployment.js` so that it can be accessed from any other protocol integrating this one





## 5. Changes to `basis-trading-stablecoin/perpLemma.js` to instantiate the PerpLemma Wrtapper adding the Quoter and vUSD address

Now that the Quoter is deployed, we need to pass it and the `vUSD` address as additional arguments to the PerpLemma Wrapper that is implemented in the `PerpLemma.sol` at initialization 

```javascript=
        [defaultSigner, usdLemma, reBalancer, hasWETH, signer1, signer2, usdl2] = await ethers.getSigners();
        perpAddresses = await loadPerpLushanInfo();
        clearingHouse = new ethers.Contract(perpAddresses.clearingHouse.address, ClearingHouseAbi.abi, defaultSigner)
        orderBook = new ethers.Contract(perpAddresses.orderBook.address, OrderBookAbi.abi, defaultSigner);
        clearingHouseConfig = new ethers.Contract(perpAddresses.clearingHouseConfig.address, ClearingHouseConfigAbi.abi, defaultSigner);
        vault = new ethers.Contract(perpAddresses.vault.address, VaultAbi.abi, defaultSigner);
        exchange = new ethers.Contract(perpAddresses.exchange.address, ExchangeAbi.abi, defaultSigner);
        marketRegistry = new ethers.Contract(perpAddresses.marketRegistry.address, MarketRegistryAbi.abi, defaultSigner);
        collateral = new ethers.Contract(perpAddresses.collateral.address, TestERC20Abi.abi, defaultSigner);
        baseToken = new ethers.Contract(perpAddresses.baseToken.address, BaseTokenAbi.abi, defaultSigner);
        baseToken2 = new ethers.Contract(perpAddresses.baseToken2.address, BaseToken2Abi.abi, defaultSigner);
        quoteToken = new ethers.Contract(perpAddresses.quoteToken.address, QuoteTokenAbi.abi, defaultSigner);
        accountBalance = new ethers.Contract(perpAddresses.accountBalance.address, AccountBalanceAbi.abi, defaultSigner);
        const mockedBaseAggregator = new ethers.Contract(perpAddresses.mockedBaseAggregator.address, MockTestAggregatorV3Abi.abi, defaultSigner);
        const mockedBaseAggregator2 = new ethers.Contract(perpAddresses.mockedBaseAggregator2.address, MockTestAggregatorV3Abi.abi, defaultSigner);
        const pool = new ethers.Contract(perpAddresses.pool.address, UniswapV3PoolAbi.abi, defaultSigner);
        const pool2 = new ethers.Contract(perpAddresses.pool2.address, UniswapV3Pool2Abi.abi, defaultSigner);
+        const quoter = new ethers.Contract(perpAddresses.quoter.address, UniswapV3Quoter.abi, defaultSigner);


```


First the list of perp-lushan deployed contracts is loaded and then the `quoter` is got from the list 

Finally, the addresses are passed to the PerpLemma initialization function 

```javascript=
        perpLemma = await upgrades.deployProxy(perpLemmaFactory, 
            [
            collateral.address,
            baseToken.address,
            quoteToken.address,
            clearingHouse.address,
            vault.address,
            accountBalance.address,
+            "0xC84Da6c8ec7A57cD10B939E79eaF9d2D17834E04", // vUSD?
+            quoter.address
        ], { initializer: 'initialize' });
```

NOTE 

The `vUSD` address is hardcoded and taken from [here](https://github.com/perpetual-protocol/perp-lushan/blob/a8553acd8ebb42350b9b1c6dd9b73d255b339f57/metadata/optimism.json#L82) so it is both not a production ready solution and the address might be not correct so 

TODO: Fix it 

However, this should be a minor thing 






----------



Finally replace `node_modules/@uniswap/v3-periphery/contracts/lens/Quoter.sol` with the `Quoter.sol` in this directory 





# 3. Test 

At this point, it should be possible to run the tests in `basis-trading-stablecoin/test/perpLemma.js` that include also a test for in perp-lushan in `Quoter.sol` the `quoteExactInputSingle()` and it should pass 

The logs of 
- the `Quoter.sol` part are visible in the terminal where the `npx hardhat node` is run 
- the `perpLemma.js` part are visible in the terminal where the `npx hardhat test --network local` is run








