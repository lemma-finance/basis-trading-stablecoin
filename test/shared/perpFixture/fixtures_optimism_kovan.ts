import { parseEther, parseUnits } from "ethers/lib/utils";
import { ethers, waffle } from "hardhat";
import { ContractFactory } from "ethers";
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
  UniswapV3Factory,
  UniswapV3Pool,
  Vault,
  // Quoter,
  CollateralManager,
  TestERC20__factory,
  MockTestAggregatorV3__factory,
  UniswapV3Factory__factory,
  // Quoter__factory,
  ClearingHouseConfig__factory,
  UniswapV3Pool__factory,
  MarketRegistry__factory,
  OrderBook__factory,
  TestAccountBalance__factory,
  TestExchange__factory,
  AccountBalance__factory,
  Exchange__factory,
  InsuranceFund__factory,
  TestVault__factory,
  CollateralManager__factory,
  TestClearingHouse__factory,
  ClearingHouse__factory,
} from "../../../perp-lushan/typechain";
// import { QuoteToken } from "../../../perp-lushan/typechain/QuoteToken";
import { TestAccountBalance } from "../../../perp-lushan/typechain/TestAccountBalance";
import BaseTokenAbi from "../../../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json"
import QuoteTokenAbi from "../../../perp-lushan/artifacts/contracts/QuoteToken.sol/QuoteToken.json"

import UniV3PoolAbi from "../../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
// import QuoteTokenAbi from "../../../perp-lushan/artifacts/contracts/QuoteToken.sol/QuoteToken.json"
import { token0Fixture, tokensFixture } from "./sharedFixtures";
import fs from "fs"
const SAVE_PREFIX = "./deployments/"
const SAVE_POSTFIX = "optimismkovan.deployment.perp.js";
let deployedContracts = {}

export interface ClearingHouseFixture {
  clearingHouse: TestClearingHouse | ClearingHouse;
  orderBook: OrderBook;
  accountBalance: TestAccountBalance | AccountBalance;
  marketRegistry: MarketRegistry;
  clearingHouseConfig: ClearingHouseConfig;
  exchange: TestExchange | Exchange;
  vault: Vault;
  insuranceFund: InsuranceFund;
  collateralManager: CollateralManager;
  uniV3Factory: UniswapV3Factory;
  pool: UniswapV3Pool;
  uniFeeTier: number;
  USDC: TestERC20;
  WETH: TestERC20;
  WBTC: TestERC20;
  mockedWethPriceFeed: MockTestAggregatorV3;
  mockedWbtcPriceFeed: MockTestAggregatorV3;
  // quoteToken: QuoteToken;
  baseToken: BaseToken;
  mockedBaseAggregator: MockTestAggregatorV3;
  baseToken2: BaseToken;
  mockedBaseAggregator2: MockTestAggregatorV3;
  pool2: UniswapV3Pool;
  // quoter: Quoter;
}

// caller of this function should ensure that (base, quote) = (token0, token1) is always true
export function createClearingHouseFixture(
  admin: any,
  canMockTime: boolean = true,
  uniFeeTier = 10000, // 1%
): () => Promise<ClearingHouseFixture> {
  return async (): Promise<ClearingHouseFixture> => {
    // deploy test tokens
    const tokenFactory = new ContractFactory(TestERC20__factory.abi, TestERC20__factory.bytecode, admin);

    // ERC20 Tokens 
    const usdc = "0x7F5c764cBc14f9669B88837ca1490cCa17c31607" // USDC on Optimism Kovan
    const USDC = new ethers.Contract(usdc, QuoteTokenAbi.abi, admin) as any
    const usdcDecimals = await USDC.decimals();

    const weth = "0x4200000000000000000000000000000000000006" // WETH on Optimism Kovan
    const WETH = new ethers.Contract(weth, QuoteTokenAbi.abi, admin) as any

    const wbtc = "0x12e30e93ee88cb7b85f5e613de4d40155775cb11" // WBTC on mainnet
    const WBTC = new ethers.Contract(wbtc, QuoteTokenAbi.abi, admin) as any





    // Virtual Base Tokens 
    const addr_veth = "0x8C835DFaA34e2AE61775e80EE29E2c724c6AE2BB";
    const vETH = new ethers.Contract(addr_veth, BaseTokenAbi.abi, admin) as any 

    const addr_vbtc = "0x86f1e0420c26a858fc203A3645dD1A36868F18e5";
    const vBTC = new ethers.Contract(addr_vbtc, BaseTokenAbi.abi, admin) as any 



    // Virtual Quote Token
    const addr_vusd = "0xC84Da6c8ec7A57cD10B939E79eaF9d2D17834E04";
    const vUSD = new ethers.Contract(addr_vusd, QuoteTokenAbi.abi, admin) as any

    // let baseToken: any, quoteToken: any, mockedBaseAggregator: any;
    const { token0, mockedAggregator0, token1 } = await tokensFixture(admin);

    const aggregatorFactory = new ContractFactory(
      MockTestAggregatorV3__factory.abi,
      MockTestAggregatorV3__factory.bytecode,
      admin,
    );
    const mockedWethPriceFeed = (await aggregatorFactory.deploy()) as any;
    // // await mockedXxxPriceFeed.setLatestRoundData(0, parseUnits("100", 18), 0, 0, 0);
    await mockedWethPriceFeed.setDecimals(18);
    const mockedWbtcPriceFeed = (await aggregatorFactory.deploy()) as any;
    await mockedWbtcPriceFeed.setDecimals(18);


    // we assume (base, quote) == (token0, token1)
    const baseToken = vETH;
    // baseToken = token0;



    const quoteToken = vUSD;
    // quoteToken = token1;

    const mockedBaseAggregator = mockedAggregator0;

    // deploy UniV3 factory
    const factoryFactory = new ContractFactory(
      UniswapV3Factory__factory.abi,
      UniswapV3Factory__factory.bytecode,
      admin,
    );
    const uniV3Factory = (await factoryFactory.deploy()) as any;

    // const quoterFactory = new ContractFactory(Quoter__factory.abi, Quoter__factory.bytecode, admin);
    // const quoter = (await quoterFactory.deploy(uniV3Factory.address, baseToken.address)) as any;

    const clearingHouseConfigFactory = new ContractFactory(
      ClearingHouseConfig__factory.abi,
      ClearingHouseConfig__factory.bytecode,
      admin,
    );
    const clearingHouseConfig = (await clearingHouseConfigFactory.deploy()) as any;
    await clearingHouseConfig.initialize();

    // prepare uniswap factory
    await uniV3Factory.createPool(baseToken.address, quoteToken.address, uniFeeTier);
    const poolFactory = new ContractFactory(UniswapV3Pool__factory.abi, UniswapV3Pool__factory.bytecode, admin);

    const marketRegistryFactory = new ContractFactory(
      MarketRegistry__factory.abi,
      MarketRegistry__factory.bytecode,
      admin,
    );
    const marketRegistry = (await marketRegistryFactory.deploy()) as any;
    await marketRegistry.initialize(uniV3Factory.address, quoteToken.address);

    const orderBookFactory = new ContractFactory(OrderBook__factory.abi, OrderBook__factory.bytecode, admin);
    const orderBook = (await orderBookFactory.deploy()) as any;
    await orderBook.initialize(marketRegistry.address);

    let accountBalance;
    let exchange;
    if (canMockTime) {
      const accountBalanceFactory = new ContractFactory(
        TestAccountBalance__factory.abi,
        TestAccountBalance__factory.bytecode,
        admin,
      );
      accountBalance = (await accountBalanceFactory.deploy()) as any;

      const exchangeFactory = new ContractFactory(TestExchange__factory.abi, TestExchange__factory.bytecode, admin);
      exchange = (await exchangeFactory.deploy()) as any;
    } else {
      const accountBalanceFactory = new ContractFactory(
        AccountBalance__factory.abi,
        AccountBalance__factory.bytecode,
        admin,
      );
      accountBalance = (await accountBalanceFactory.deploy()) as any;

      const exchangeFactory = new ContractFactory(Exchange__factory.abi, Exchange__factory.bytecode, admin);
      exchange = (await exchangeFactory.deploy()) as any;
    }

    const insuranceFundFactory = new ContractFactory(
      InsuranceFund__factory.abi,
      InsuranceFund__factory.bytecode,
      admin,
    );
    const insuranceFund = (await insuranceFundFactory.deploy()) as any;
    await insuranceFund.initialize(USDC.address);

    // deploy exchange
    await exchange.initialize(marketRegistry.address, orderBook.address, clearingHouseConfig.address);
    exchange.setAccountBalance(accountBalance.address);

    await orderBook.setExchange(exchange.address);

    await accountBalance.initialize(clearingHouseConfig.address, orderBook.address);

    // deploy vault
    const vaultFactory = new ContractFactory(TestVault__factory.abi, TestVault__factory.bytecode, admin);
    const vault = (await vaultFactory.deploy()) as any;
    await vault.initialize(
      insuranceFund.address,
      clearingHouseConfig.address,
      accountBalance.address,
      exchange.address,
    );

    const collateralManagerFactory = new ContractFactory(
      CollateralManager__factory.abi,
      CollateralManager__factory.bytecode,
      admin,
    );
    const collateralManager = (await collateralManagerFactory.deploy()) as any;
    await collateralManager.initialize(
      clearingHouseConfig.address,
      vault.address,
      5, // maxCollateralTokensPerAccount
      "750000", // debtNonSettlementTokenValueRatio
      "500000", // liquidationRatio
      "2000", // maintenanceMarginRatioBuffer
      "30000", // clInsuranceFundFeeRatio
      parseUnits("10000", usdcDecimals), // debtThreshold
      parseUnits("500", usdcDecimals), // collateralValueDust
    );

    await collateralManager.addCollateral(WETH.address, {
      priceFeed: mockedWethPriceFeed.address,
      collateralRatio: (0.7e6).toString(),
      discountRatio: (0.1e6).toString(),
      depositCap: parseEther("100000000000"),
    });
    await collateralManager.addCollateral(WBTC.address, {
      priceFeed: mockedWbtcPriceFeed.address,
      collateralRatio: (0.7e6).toString(),
      discountRatio: (0.1e6).toString(),
      depositCap: parseUnits("1000000000", await WBTC.decimals()),
    });

    await vault.setCollateralManager(collateralManager.address);
    await insuranceFund.setBorrower(vault.address);
    await accountBalance.setVault(vault.address);





    // deploy a pool

    const addr_vETH_vUSD_pool = "0x36B18618c4131D8564A714fb6b4D2B1EdADc0042";
    const pool = new ethers.Contract(addr_vETH_vUSD_pool, UniV3PoolAbi.abi, admin) as any

    // const poolAddr = await uniV3Factory.getPool(baseToken.address, quoteToken.address, uniFeeTier);
    // const pool = poolFactory.attach(poolAddr) as any;

    await baseToken.addWhitelist(pool.address);
    await quoteToken.addWhitelist(pool.address);

    // deploy another pool
    const _token0Fixture = await token0Fixture(admin, quoteToken.address);
    const baseToken2 = _token0Fixture.baseToken;
    const mockedBaseAggregator2 = _token0Fixture.mockedAggregator;
    await uniV3Factory.createPool(baseToken2.address, quoteToken.address, uniFeeTier);
    const pool2Addr = await uniV3Factory.getPool(baseToken2.address, quoteToken.address, uniFeeTier);
    const pool2 = poolFactory.attach(pool2Addr) as any;

    await baseToken2.addWhitelist(pool2.address);
    await quoteToken.addWhitelist(pool2.address);

    // deploy clearingHouse
    let clearingHouse: any;
    if (canMockTime) {
      const clearingHouseFactory = new ContractFactory(
        TestClearingHouse__factory.abi,
        TestClearingHouse__factory.bytecode,
        admin,
      );
      clearingHouse = (await clearingHouseFactory.deploy()) as any;
      await clearingHouse.initialize(
        clearingHouseConfig.address,
        vault.address,
        quoteToken.address,
        uniV3Factory.address,
        exchange.address,
        accountBalance.address,
        insuranceFund.address,
      );
    } else {
      const clearingHouseFactory = new ContractFactory(
        ClearingHouse__factory.abi,
        ClearingHouse__factory.bytecode,
        admin,
      );
      clearingHouse = (await clearingHouseFactory.deploy()) as any;
      await clearingHouse.initialize(
        clearingHouseConfig.address,
        vault.address,
        quoteToken.address,
        uniV3Factory.address,
        exchange.address,
        accountBalance.address,
        insuranceFund.address,
      );
    }

    await clearingHouseConfig.setSettlementTokenBalanceCap(ethers.constants.MaxUint256);
    await quoteToken.mintMaximumTo(clearingHouse.address);
    await baseToken.mintMaximumTo(clearingHouse.address);
    await baseToken2.mintMaximumTo(clearingHouse.address);
    await quoteToken.addWhitelist(clearingHouse.address);
    await baseToken.addWhitelist(clearingHouse.address);
    await baseToken2.addWhitelist(clearingHouse.address);
    await marketRegistry.setClearingHouse(clearingHouse.address);
    await orderBook.setClearingHouse(clearingHouse.address);
    await exchange.setClearingHouse(clearingHouse.address);
    await accountBalance.setClearingHouse(clearingHouse.address);
    await vault.setClearingHouse(clearingHouse.address);

    deployedContracts["clearingHouse"] = {
      name: "clearingHouse",
      address: clearingHouse.address,
    }

    deployedContracts["orderBook"] = {
        name: "orderBook",
        address: orderBook.address,
    }

    deployedContracts["clearingHouseConfig"] = {
        name: "clearingHouseConfig",
        address: clearingHouseConfig.address,
    }

    deployedContracts["vault"] = {
        name: "vault",
        address: vault.address,
    }

    deployedContracts["exchange"] = {
        name: "exchange",
        address: exchange.address,
    }

    deployedContracts["marketRegistry"] = {
        name: "marketRegistry",
        address: marketRegistry.address,
    }

    deployedContracts["usdCollateral"] = {
        name: "usdCollateral",
        address: usdc,
    }

    deployedContracts["ethCollateral"] = {
        name: "ethCollateral",
        address: weth,
    }

    deployedContracts["btcCollateral"] = {
        name: "btcCollateral",
        address: wbtc,
    }

    deployedContracts["baseToken"] = {
        name: "baseToken",
        address: baseToken.address,
    }

    deployedContracts["baseToken2"] = {
        name: "baseToken2",
        address: baseToken2.address,
    }

    deployedContracts["quoteToken"] = {
        name: "quoteToken",
        address: quoteToken.address,
    }

    deployedContracts["quoteToken2"] = {
        name: "quoteToken2",
        address: quoteToken.address,
    }

    deployedContracts["mockedBaseAggregator"] = {
        name: "mockedBaseAggregator",
        address: mockedBaseAggregator.address,
    }

    deployedContracts["mockedBaseAggregator2"] = {
        name: "mockedBaseAggregator2",
        address: mockedBaseAggregator2.address,
    }

    deployedContracts["mockedWbtcPriceFeed"] = {
        name: "mockedWbtcPriceFeed",
        address: mockedWbtcPriceFeed.address,
    }

    deployedContracts["mockedWethPriceFeed"] = {
        name: "mockedWethPriceFeed",
        address: mockedWethPriceFeed.address,
    }

    deployedContracts["collateralManager"] = {
        name: "collateralManager",
        address: collateralManager.address,
    }

    deployedContracts["pool"] = {
        name: "pool",
        address: pool.address,
    }

    deployedContracts["pool2"] = {
        name: "pool2",
        address: pool2.address,
    }

    deployedContracts["accountBalance"] = {
        name: "accountBalance",
        address: accountBalance.address,
    }

    deployedContracts["accountBalance"] = {
        name: "accountBalance",
        address: accountBalance.address,
    }

    deployedContracts["univ3factory"] = {
        name: "univ3factory",
        address: uniV3Factory.address,
    }

    // deployedContracts["quoter"] = {
    //     name: "quoter",
    //     address: quoter.address,
    // }

    console.log("deployedContracts: ", deployedContracts)
    await fs.writeFileSync(SAVE_PREFIX + SAVE_POSTFIX, JSON.stringify(deployedContracts, null, 2))


    return {
      clearingHouse,
      orderBook,
      accountBalance,
      marketRegistry,
      clearingHouseConfig,
      exchange,
      vault,
      insuranceFund,
      collateralManager,
      uniV3Factory,
      pool,
      uniFeeTier,
      USDC,
      WETH,
      WBTC,
      mockedWethPriceFeed,
      mockedWbtcPriceFeed,
      quoteToken,
      baseToken,
      mockedBaseAggregator,
      baseToken2,
      mockedBaseAggregator2,
      pool2,
      // quoter,
    };
  };
}
