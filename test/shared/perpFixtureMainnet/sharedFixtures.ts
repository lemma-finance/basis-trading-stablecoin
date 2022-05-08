import { ContractFactory } from "ethers";
import {
  QuoteToken,
  UniswapV3Factory,
  VirtualToken,
  MockTestAggregatorV3__factory,
  QuoteToken__factory,
  BaseToken__factory,
  UniswapV3Factory__factory,
} from "../../../perp-lushan/typechain";
import { ChainlinkPriceFeed__factory } from "../../../perp-lushan/typechain/perp-oracle"

import { isAscendingTokenOrder } from "./utilities";

interface TokensFixture {
  token0: any;
  token1: any;
  mockedAggregator0: any;
  mockedAggregator1: any;
}

interface PoolFixture {
  factory: any;
  pool: any;
  baseToken: any;
  quoteToken: any;
}

interface BaseTokenFixture {
  baseToken: any;
  mockedAggregator: any;
}

export function createQuoteTokenFixture(admin: any, name: string, symbol: string): () => Promise<QuoteToken> {
  return async (): Promise<QuoteToken> => {
    const quoteTokenFactory = new ContractFactory(QuoteToken__factory.abi, QuoteToken__factory.bytecode, admin);
    const quoteToken = (await quoteTokenFactory.deploy()) as any;
    await quoteToken.initialize(name, symbol);
    return quoteToken;
  };
}

export function createBaseTokenFixture(admin: any, name: string, symbol: string): () => Promise<BaseTokenFixture> {
  return async (): Promise<BaseTokenFixture> => {
    const aggregatorFactory = new ContractFactory(
      MockTestAggregatorV3__factory.abi,
      MockTestAggregatorV3__factory.bytecode,
      admin,
    );
    const mockedAggregator = (await aggregatorFactory.deploy()) as any;
    await mockedAggregator.setDecimals(6);
    // await mockedAggregator.setDecimals(18)
    // await mockedAggregator.setLatestRoundData(0, parseUnits("100", 6), 0, 0, 0)

    // const decimal = await mockedAggregator.decimals()
    // console.log("decimal: ", decimal.toString())
    // const mockedAggregator = await smockit(aggregator)
    // mockedAggregator.smocked.decimals.will.return.with(async () => {
    //     return 6
    // })

    const chainlinkPriceFeedFactory = new ContractFactory(
      ChainlinkPriceFeed__factory.abi,
      ChainlinkPriceFeed__factory.bytecode,
      admin,
    );
    const chainlinkPriceFeed = (await chainlinkPriceFeedFactory.deploy(mockedAggregator.address)) as any;

    const baseTokenFactory = new ContractFactory(BaseToken__factory.abi, BaseToken__factory.bytecode, admin);
    const baseToken = (await baseTokenFactory.deploy()) as any;
    await baseToken.initialize(name, symbol, chainlinkPriceFeed.address);

    return { baseToken, mockedAggregator };
  };
}

export async function uniswapV3FactoryFixture(admin: any): Promise<UniswapV3Factory> {
  const factoryFactory = new ContractFactory(UniswapV3Factory__factory.abi, UniswapV3Factory__factory.bytecode, admin);
  return (await factoryFactory.deploy()) as any;
}

// assume isAscendingTokensOrder() == true/ token0 < token1
export async function tokensFixture(admin: any): Promise<TokensFixture> {
  const { baseToken: randomToken0, mockedAggregator: randomMockedAggregator0 } = await createBaseTokenFixture(
    admin,
    "RandomTestToken0",
    "randomToken0",
  )();
  const { baseToken: randomToken1, mockedAggregator: randomMockedAggregator1 } = await createBaseTokenFixture(
    admin,
    "RandomTestToken1",
    "randomToken1",
  )();

  let token0: any;
  let token1: any;
  let mockedAggregator0: any;
  let mockedAggregator1: any;
  if (isAscendingTokenOrder(randomToken0.address, randomToken1.address)) {
    token0 = randomToken0;
    mockedAggregator0 = randomMockedAggregator0;
    token1 = randomToken1 as VirtualToken as QuoteToken;
    mockedAggregator1 = randomMockedAggregator1;
  } else {
    token0 = randomToken1;
    mockedAggregator0 = randomMockedAggregator1;
    token1 = randomToken0 as VirtualToken as QuoteToken;
    mockedAggregator1 = randomMockedAggregator0;
  }
  return {
    token0,
    mockedAggregator0,
    token1,
    mockedAggregator1,
  };
}

export async function token0Fixture(admin: any, token1Addr: string): Promise<BaseTokenFixture> {
  let token0Fixture: BaseTokenFixture;
  while (!token0Fixture || !isAscendingTokenOrder(token0Fixture.baseToken.address, token1Addr)) {
    token0Fixture = await createBaseTokenFixture(admin, "RandomTestToken0", "randomToken0")();
  }
  return token0Fixture;
}
