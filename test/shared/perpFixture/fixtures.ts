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
  Quoter,
  CollateralManager,
  TestERC20__factory,
  MockTestAggregatorV3__factory,
  UniswapV3Factory__factory,
  Quoter__factory,
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
import { QuoteToken } from "../../../perp-lushan/typechain/QuoteToken";
import { TestAccountBalance } from "../../../perp-lushan/typechain/TestAccountBalance";
import { token0Fixture, tokensFixture } from "./sharedFixtures";
import perpV2Config from "./perpV2Config.json";
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
  quoteToken: QuoteToken;
  baseToken: BaseToken;
  mockedBaseAggregator: MockTestAggregatorV3;
  baseToken2: BaseToken;
  mockedBaseAggregator2: MockTestAggregatorV3;
  pool2: UniswapV3Pool;
  quoter: Quoter;
}

// caller of this function should ensure that (base, quote) = (token0, token1) is always true
export function createClearingHouseFixture(
  admin: any,
  canMockTime: boolean = true,
  uniFeeTier = 10000, // 1%
): () => Promise<ClearingHouseFixture> {
  return async (): Promise<ClearingHouseFixture> => {
    console.log("in createClearingHouseFixture");
    // // deploy test tokens
    const tokenFactory = new ContractFactory(TestERC20__factory.abi, TestERC20__factory.bytecode, admin);
    // const USDC = (await tokenFactory.deploy()) as any;
    // await USDC.__TestERC20_init("TestUSDC", "USDC", 6);
    // const WETH = (await tokenFactory.deploy()) as any;
    // await WETH.__TestERC20_init("TestETH", "ETH", 18);
    // const WBTC = (await tokenFactory.deploy()) as any;
    // await WBTC.__TestERC20_init("TestWBTC", "WBTC", 8);

    // const usdcDecimals = await USDC.decimals();

    // let baseToken: any, quoteToken: any, mockedBaseAggregator: any;
    // const { token0, mockedAggregator0, token1 } = await tokensFixture(admin);

    //uncomment all the factory objects
    const aggregatorFactory = new ContractFactory(
      MockTestAggregatorV3__factory.abi,
      MockTestAggregatorV3__factory.bytecode,
      admin,
    );
    // const mockedWethPriceFeed = (await aggregatorFactory.deploy()) as any;
    // // // await mockedXxxPriceFeed.setLatestRoundData(0, parseUnits("100", 18), 0, 0, 0);
    // await mockedWethPriceFeed.setDecimals(18);
    // const mockedWbtcPriceFeed = (await aggregatorFactory.deploy()) as any;
    // await mockedWbtcPriceFeed.setDecimals(18);

    // // we assume (base, quote) == (token0, token1)
    // baseToken = token0;
    // quoteToken = token1;
    // mockedBaseAggregator = mockedAggregator0;

    // // deploy UniV3 factory
    const factoryFactory = new ContractFactory(
      UniswapV3Factory__factory.abi,
      UniswapV3Factory__factory.bytecode,
      admin,
    );
    // const uniV3Factory = (await factoryFactory.deploy()) as any;

    const quoterFactory = new ContractFactory(Quoter__factory.abi, Quoter__factory.bytecode, admin);
    // const quoter = (await quoterFactory.deploy(uniV3Factory.address, baseToken.address)) as any;

    const clearingHouseConfigFactory = new ContractFactory(
      ClearingHouseConfig__factory.abi,
      ClearingHouseConfig__factory.bytecode,
      admin,
    );
    // const clearingHouseConfig = (await clearingHouseConfigFactory.deploy()) as any;
    // await clearingHouseConfig.initialize();

    // // prepare uniswap factory
    // await uniV3Factory.createPool(baseToken.address, quoteToken.address, uniFeeTier);
    const poolFactory = new ContractFactory(UniswapV3Pool__factory.abi, UniswapV3Pool__factory.bytecode, admin);

    const marketRegistryFactory = new ContractFactory(
      MarketRegistry__factory.abi,
      MarketRegistry__factory.bytecode,
      admin,
    );
    // const marketRegistry = (await marketRegistryFactory.deploy()) as any;
    // await marketRegistry.initialize(uniV3Factory.address, quoteToken.address);

    const orderBookFactory = new ContractFactory(OrderBook__factory.abi, OrderBook__factory.bytecode, admin);
    // const orderBook = (await orderBookFactory.deploy()) as any;
    // await orderBook.initialize(marketRegistry.address);

    // let accountBalance;
    // let exchange;
    // if (canMockTime) {
    const accountBalanceFactory = new ContractFactory(
      TestAccountBalance__factory.abi,
      TestAccountBalance__factory.bytecode,
      admin,
    );
    //   accountBalance = (await accountBalanceFactory.deploy()) as any;

    const exchangeFactory = new ContractFactory(TestExchange__factory.abi, TestExchange__factory.bytecode, admin);
    //   exchange = (await exchangeFactory.deploy()) as any;
    // } else {
    //   const accountBalanceFactory = new ContractFactory(
    //     AccountBalance__factory.abi,
    //     AccountBalance__factory.bytecode,
    //     admin,
    //   );
    //   accountBalance = (await accountBalanceFactory.deploy()) as any;

    //   const exchangeFactory = new ContractFactory(Exchange__factory.abi, Exchange__factory.bytecode, admin);
    //   exchange = (await exchangeFactory.deploy()) as any;
    // }

    const insuranceFundFactory = new ContractFactory(
      InsuranceFund__factory.abi,
      InsuranceFund__factory.bytecode,
      admin,
    );
    // const insuranceFund = (await insuranceFundFactory.deploy()) as any;
    // await insuranceFund.initialize(USDC.address);

    // // deploy exchange
    // await exchange.initialize(marketRegistry.address, orderBook.address, clearingHouseConfig.address);
    // exchange.setAccountBalance(accountBalance.address);

    // await orderBook.setExchange(exchange.address);

    // await accountBalance.initialize(clearingHouseConfig.address, orderBook.address);

    // // deploy vault
    const vaultFactory = new ContractFactory(TestVault__factory.abi, TestVault__factory.bytecode, admin);
    // const vault = (await vaultFactory.deploy()) as any;
    // await vault.initialize(
    //   insuranceFund.address,
    //   clearingHouseConfig.address,
    //   accountBalance.address,
    //   exchange.address,
    // );

    const collateralManagerFactory = new ContractFactory(
      CollateralManager__factory.abi,
      CollateralManager__factory.bytecode,
      admin,
    );
    // const collateralManager = (await collateralManagerFactory.deploy()) as any;
    // await collateralManager.initialize(
    //   clearingHouseConfig.address,
    //   vault.address,
    //   5, // maxCollateralTokensPerAccount
    //   "750000", // debtNonSettlementTokenValueRatio
    //   "500000", // liquidationRatio
    //   "2000", // maintenanceMarginRatioBuffer
    //   "30000", // clInsuranceFundFeeRatio
    //   parseUnits("10000", usdcDecimals), // debtThreshold
    //   parseUnits("500", usdcDecimals), // collateralValueDust
    // );

    // await collateralManager.addCollateral(WETH.address, {
    //   priceFeed: mockedWethPriceFeed.address,
    //   collateralRatio: (0.7e6).toString(),
    //   discountRatio: (0.1e6).toString(),
    //   depositCap: parseEther("100000000000"),
    // });
    // await collateralManager.addCollateral(WBTC.address, {
    //   priceFeed: mockedWbtcPriceFeed.address,
    //   collateralRatio: (0.7e6).toString(),
    //   discountRatio: (0.1e6).toString(),
    //   depositCap: parseUnits("1000000000", await WBTC.decimals()),
    // });

    // await vault.setCollateralManager(collateralManager.address);
    // await insuranceFund.setBorrower(vault.address);
    // await accountBalance.setVault(vault.address);

    // // deploy a pool
    // const poolAddr = await uniV3Factory.getPool(baseToken.address, quoteToken.address, uniFeeTier);
    // const pool = poolFactory.attach(poolAddr) as any;
    // await baseToken.addWhitelist(pool.address);
    // await quoteToken.addWhitelist(pool.address);

    // // deploy another pool
    // const _token0Fixture = await token0Fixture(admin, quoteToken.address);
    // const baseToken2 = _token0Fixture.baseToken;
    // const mockedBaseAggregator2 = _token0Fixture.mockedAggregator;
    // await uniV3Factory.createPool(baseToken2.address, quoteToken.address, uniFeeTier);
    // const pool2Addr = await uniV3Factory.getPool(baseToken2.address, quoteToken.address, uniFeeTier);
    // const pool2 = poolFactory.attach(pool2Addr) as any;

    // await baseToken2.addWhitelist(pool2.address);
    // await quoteToken.addWhitelist(pool2.address);

    // // deploy clearingHouse
    // let clearingHouse: any;
    // if (canMockTime) {
    const clearingHouseFactory = new ContractFactory(
      TestClearingHouse__factory.abi,
      TestClearingHouse__factory.bytecode,
      admin,
    );
    //   clearingHouse = (await clearingHouseFactory.deploy()) as any;
    //   await clearingHouse.initialize(
    //     clearingHouseConfig.address,
    //     vault.address,
    //     quoteToken.address,
    //     uniV3Factory.address,
    //     exchange.address,
    //     accountBalance.address,
    //     insuranceFund.address,
    //   );
    // } else {
    //   const clearingHouseFactory = new ContractFactory(
    //     ClearingHouse__factory.abi,
    //     ClearingHouse__factory.bytecode,
    //     admin,
    //   );
    //   clearingHouse = (await clearingHouseFactory.deploy()) as any;
    //   await clearingHouse.initialize(
    //     clearingHouseConfig.address,
    //     vault.address,
    //     quoteToken.address,
    //     uniV3Factory.address,
    //     exchange.address,
    //     accountBalance.address,
    //     insuranceFund.address,
    //   );
    // }

    // await clearingHouseConfig.setSettlementTokenBalanceCap(ethers.constants.MaxUint256);
    // await quoteToken.mintMaximumTo(clearingHouse.address);
    // await baseToken.mintMaximumTo(clearingHouse.address);
    // await baseToken2.mintMaximumTo(clearingHouse.address);
    // await quoteToken.addWhitelist(clearingHouse.address);
    // await baseToken.addWhitelist(clearingHouse.address);
    // await baseToken2.addWhitelist(clearingHouse.address);
    // await marketRegistry.setClearingHouse(clearingHouse.address);
    // await orderBook.setClearingHouse(clearingHouse.address);
    // await exchange.setClearingHouse(clearingHouse.address);
    // await accountBalance.setClearingHouse(clearingHouse.address);
    // await vault.setClearingHouse(clearingHouse.address);

    const clearingHouse = (clearingHouseFactory.attach(perpV2Config.contracts.ClearingHouse.address)) as any;
    const orderBook = (orderBookFactory.attach(perpV2Config.contracts.OrderBook.address)) as any;
    const marketRegistry = (marketRegistryFactory.attach(perpV2Config.contracts.MarketRegistry.address)) as any;
    const exchange = (exchangeFactory.attach(perpV2Config.contracts.Exchange.address)) as any;
    const accountBalance = (accountBalanceFactory.attach(perpV2Config.contracts.AccountBalance.address)) as any;
    const quoteToken = (quoterFactory.attach(perpV2Config.contracts.QuoteToken.address)) as any;
    const baseToken = (tokenFactory.attach(perpV2Config.contracts.vETH.address)) as any;
    const baseToken2 = (tokenFactory.attach(perpV2Config.contracts.vBTC.address)) as any;
    const vault = (vaultFactory.attach(perpV2Config.contracts.Vault.address)) as any;
    const pool = (poolFactory.attach(perpV2Config.pools[0].address)) as any;
    const pool2 = (poolFactory.attach(perpV2Config.pools[1].address)) as any;
    const uniV3Factory = (factoryFactory.attach(perpV2Config.externalContracts.UniswapV3Factory)) as any;
    const clearingHouseConfig = (clearingHouseConfigFactory.attach(perpV2Config.contracts.ClearingHouseConfig.address)) as any;
    const insuranceFund = (insuranceFundFactory.attach(perpV2Config.contracts.InsuranceFund.address)) as any;
    const collateralManager = (collateralManagerFactory.attach(perpV2Config.contracts.CollateralManager.address)) as any;
    const USDC = (tokenFactory.attach(perpV2Config.externalContracts.USDC)) as any;
    const WETH = (tokenFactory.attach(perpV2Config.externalContracts.WETH9)) as any;
    const WBTC = (tokenFactory.attach(perpV2Config.externalContracts.TestWBTC)) as any;
    const mockedWethPriceFeed = (aggregatorFactory.attach(perpV2Config.collaterals[2].priceFeedAddress)) as any;
    const mockedWbtcPriceFeed = (aggregatorFactory.attach(perpV2Config.collaterals[1].priceFeedAddress)) as any;

    const mockedBaseAggregator = 0 as any;
    const mockedBaseAggregator2 = 0 as any;
    const quoter = 0 as any;

    console.log("out of createClearingHouseFixture");
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
      quoter,
    };
  };
}
