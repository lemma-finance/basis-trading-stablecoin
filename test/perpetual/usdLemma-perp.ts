import { ethers, upgrades } from "hardhat";
import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { utils } from "ethers";
import { parseEther, parseUnits } from "ethers/lib/utils";
import { BigNumber } from "@ethersproject/bignumber";
import { loadPerpLushanInfo, snapshot, revertToSnapshot, fromBigNumber } from "../shared/utils";
import bn from "bignumber.js";
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

const AddressZero = "0x0000000000000000000000000000000000000000";
const MaxInt256 = /*#__PURE__*/ BigNumber.from("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

import ClearingHouseAbi from "../../perp-lushan/artifacts/contracts/test/TestClearingHouse.sol/TestClearingHouse.json";
import OrderBookAbi from "../../perp-lushan/artifacts/contracts/OrderBook.sol/OrderBook.json";
import ClearingHouseConfigAbi from "../../perp-lushan/artifacts/contracts/ClearingHouseConfig.sol/ClearingHouseConfig.json";
import VaultAbi from "../../perp-lushan/artifacts/contracts/Vault.sol/Vault.json";
import ExchangeAbi from "../../perp-lushan/artifacts/contracts/Exchange.sol/Exchange.json";
import MarketRegistryAbi from "../../perp-lushan/artifacts/contracts/MarketRegistry.sol/MarketRegistry.json";
import TestERC20Abi from "../../perp-lushan/artifacts/contracts/test/TestERC20.sol/TestERC20.json";
import BaseTokenAbi from "../../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json";
import BaseToken2Abi from "../../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json";
import QuoteTokenAbi from "../../perp-lushan/artifacts/contracts/QuoteToken.sol/QuoteToken.json";
import AccountBalanceAbi from "../../perp-lushan/artifacts/contracts/AccountBalance.sol/AccountBalance.json";
import MockTestAggregatorV3Abi from "../../perp-lushan/artifacts/contracts/mock/MockTestAggregatorV3.sol/MockTestAggregatorV3.json";
import UniswapV3PoolAbi from "../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import UniswapV3Pool2Abi from "../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import QuoterAbi from "../../perp-lushan/artifacts/@uniswap/v3-periphery/contracts/lens/Quoter.sol/Quoter.json";
import UniswapV3FactoryAbi from "../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";

use(solidity);

function fromD1toD2(x, d1, d2) {
  x = x.toString();
  return parseUnits(x, 0).mul(parseUnits("1", d2)).div(parseUnits("1", d1));
}

function encodePriceSqrt(reserve1, reserve0) {
  return BigNumber.from(
    new bn(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString(),
  );
}

async function callStaticOpenPosition(clearingHouse, signer, baseTokenAddress, _isBaseToQuote, _isExactInput, _amount) {
  let openPositionParams = await clearingHouse.connect(signer).callStatic.openPosition({
    baseToken: baseTokenAddress,
    isBaseToQuote: _isBaseToQuote,
    isExactInput: _isExactInput,
    oppositeAmountBound: 0,
    amount: _amount,
    sqrtPriceLimitX96: 0,
    deadline: ethers.constants.MaxUint256,
    referralCode: ethers.constants.HashZero,
  });
  return openPositionParams;
}

describe("usdLemma-perp", async function () {
  let defaultSigner, usdLemma, reBalancer, hasWETH, keeperGasReward, signer1, signer2, usdl2, longAddress;
  let perpAddresses: any;
  const ZERO = BigNumber.from("0");
  let snapshotId: any;

  let clearingHouse: any;
  let marketRegistry: any;
  let clearingHouseConfig: any;
  let exchange: any;
  let orderBook: any;
  let accountBalance: any;
  let vault: any;
  let collateral: any;
  let baseToken: any;
  let baseToken2: any;
  let quoteToken: any;
  let univ3factory: any;
  let pool: any;
  let pool2: any;
  let mockedBaseAggregator: any;
  let mockedBaseAggregator2: any;
  let quoter: any;
  let perpLemma: any;
  let collateralDecimals: any;
  const lowerTick = 0;
  const upperTick = 100000;

  before(async function () {
    [defaultSigner, usdLemma, reBalancer, hasWETH, signer1, signer2, usdl2, longAddress] = await ethers.getSigners();
    perpAddresses = await loadPerpLushanInfo();
    clearingHouse = new ethers.Contract(perpAddresses.clearingHouse.address, ClearingHouseAbi.abi, defaultSigner);
    orderBook = new ethers.Contract(perpAddresses.orderBook.address, OrderBookAbi.abi, defaultSigner);
    clearingHouseConfig = new ethers.Contract(
      perpAddresses.clearingHouseConfig.address,
      ClearingHouseConfigAbi.abi,
      defaultSigner,
    );
    vault = new ethers.Contract(perpAddresses.vault.address, VaultAbi.abi, defaultSigner);
    exchange = new ethers.Contract(perpAddresses.exchange.address, ExchangeAbi.abi, defaultSigner);
    marketRegistry = new ethers.Contract(perpAddresses.marketRegistry.address, MarketRegistryAbi.abi, defaultSigner);
    collateral = new ethers.Contract(perpAddresses.collateral.address, TestERC20Abi.abi, defaultSigner);
    baseToken = new ethers.Contract(perpAddresses.baseToken.address, BaseTokenAbi.abi, defaultSigner);
    baseToken2 = new ethers.Contract(perpAddresses.baseToken2.address, BaseToken2Abi.abi, defaultSigner);
    quoteToken = new ethers.Contract(perpAddresses.quoteToken.address, QuoteTokenAbi.abi, defaultSigner);
    univ3factory = new ethers.Contract(perpAddresses.univ3factory.address, UniswapV3FactoryAbi.abi, defaultSigner);
    accountBalance = new ethers.Contract(perpAddresses.accountBalance.address, AccountBalanceAbi.abi, defaultSigner);
    mockedBaseAggregator = new ethers.Contract(
      perpAddresses.mockedBaseAggregator.address,
      MockTestAggregatorV3Abi.abi,
      defaultSigner,
    );
    mockedBaseAggregator2 = new ethers.Contract(
      perpAddresses.mockedBaseAggregator2.address,
      MockTestAggregatorV3Abi.abi,
      defaultSigner,
    );
    pool = new ethers.Contract(perpAddresses.pool.address, UniswapV3PoolAbi.abi, defaultSigner);
    pool2 = new ethers.Contract(perpAddresses.pool2.address, UniswapV3Pool2Abi.abi, defaultSigner);
    quoter = new ethers.Contract(perpAddresses.quoter.address, QuoterAbi.abi, defaultSigner);
    collateralDecimals = await collateral.decimals();

    const maxPosition = ethers.constants.MaxUint256;
    const perpLemmaFactory = await ethers.getContractFactory("PerpLemma");
    perpLemma = await upgrades.deployProxy(
      perpLemmaFactory,
      [
        baseToken.address,
        quoteToken.address,
        clearingHouse.address,
        marketRegistry.address,
        usdLemma.address,
        maxPosition,
      ],
      { initializer: "initialize" },
    );

    const USDLemma = await ethers.getContractFactory("USDLemma");
    usdLemma = await upgrades.deployProxy(USDLemma, [AddressZero, collateral.address, perpLemma.address], {
      initializer: "initialize",
    });
    await perpLemma.setUSDLemma(usdLemma.address);

    //await addPerpetualDEXWrapper

    await perpLemma.connect(signer1).resetApprovals();

    await mockedBaseAggregator.setLatestRoundData(0, parseUnits("1", collateralDecimals), 0, 0, 0);
    await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("100", collateralDecimals), 0, 0, 0);

    await pool.initialize(encodePriceSqrt("1", "100"));
    // the initial number of oracle can be recorded is 1; thus, have to expand it
    await pool.increaseObservationCardinalityNext((2 ^ 16) - 1);
    await pool2.initialize(encodePriceSqrt("1", "100")); // tick = 50200 (1.0001^50200 = 151.373306858723226652)

    await marketRegistry.addPool(baseToken.address, 10000);
    await marketRegistry.addPool(baseToken2.address, 10000);
    await marketRegistry.setFeeRatio(baseToken.address, 10000);
    await marketRegistry.setFeeRatio(baseToken2.address, 10000);
    await exchange.setMaxTickCrossedWithinBlock(baseToken.address, 887272);

    // prepare collateral for maker
    const makerCollateralAmount = parseUnits("1000000", collateralDecimals);
    await collateral.mint(signer1.address, makerCollateralAmount);
    await collateral.mint(signer2.address, makerCollateralAmount);

    const parsedAmount = parseUnits("100000", collateralDecimals);
    await collateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
    await collateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256);

    await collateral.mint(longAddress.address, parseUnits("10000000000", collateralDecimals));
    await collateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);
    await vault.connect(longAddress).deposit(collateral.address, parseUnits("10000", collateralDecimals));

    // Deposit into vault
    // await vault.connect(signer1).deposit(collateral.address, parsedAmount)
    await vault.connect(signer2).deposit(collateral.address, parsedAmount);
    await clearingHouse.connect(signer2).addLiquidity({
      baseToken: baseToken.address,
      base: parseEther("10000"),
      quote: parseEther("100"),
      lowerTick: -887200, //50000,
      upperTick: 887200, //50400,
      minBase: 0,
      minQuote: 0,
      useTakerBalance: false,
      deadline: ethers.constants.MaxUint256,
    });
  });

  beforeEach(async function () {
    snapshotId = await snapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(snapshotId);
  });
  it("should initialize correctly", async function () {
    expect(await perpLemma.usdLemma()).to.equal(usdLemma.address);
    expect(await usdLemma.perpetualDEXWrappers("0", collateral.address)).to.equal(perpLemma.address);
  });
  it("should revert when depositing with exact USDL amount", async function () {
    await collateral.approve(usdLemma.address, ethers.constants.MaxUint256);
    await expect(usdLemma.deposit(parseEther("1"), 0, ethers.constants.MaxUint256, collateral.address)).to.be.revertedWith("not supported");
  });
  it("openPosition => open position for short and close position for 2 time longs, 50% & 50%", async () => {
    await collateral.mint(defaultSigner.address, parseUnits("5", collateralDecimals));
    let collateralAmount = parseUnits("1", collateralDecimals);
    await collateral.mint(usdLemma.address, collateralAmount);
    collateralAmount = collateralAmount.sub(
      collateralAmount.mul(BigNumber.from("10000")).div(BigNumber.from("1000000")),
    );
    let baseAndQuoteValue = await callStaticOpenPosition(
      clearingHouse,
      longAddress,
      baseToken.address,
      false,
      true,
      collateralAmount,
    ); // index0: base/usd, index1: quote/eth
    collateralAmount = parseUnits("1", collateralDecimals);
    await collateral.connect(defaultSigner).approve(usdLemma.address, collateralAmount);
    await usdLemma
      .connect(defaultSigner)
      .depositToWExactCollateral(defaultSigner.address, collateralAmount, 0, baseAndQuoteValue[0], collateral.address);

    expect(await collateral.balanceOf(perpLemma.address)).to.eq(0);
    expect(await vault.getBalance(perpLemma.address)).to.eq(parseEther("1"));
    let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
    expect(baseAndQuoteValue[0]).to.eq(positionSize);

    // #1
    baseAndQuoteValue = await callStaticOpenPosition(
      clearingHouse,
      longAddress,
      baseToken.address,
      true,
      true,
      positionSize.div(2),
    );
    collateralAmount = baseAndQuoteValue[1].mul(parseEther("1")).div(parseEther("0.99"));

    await usdLemma.withdrawToWExactCollateral(
      defaultSigner.address,
      collateralAmount,
      0,
      MaxInt256,
      collateral.address,
    );

    // #2
    baseAndQuoteValue = await callStaticOpenPosition(
      clearingHouse,
      longAddress,
      baseToken.address,
      true,
      true,
      positionSize.div(2),
    );
    collateralAmount = baseAndQuoteValue[1].mul(parseEther("1")).div(parseEther("0.99"));

    await usdLemma.withdrawToWExactCollateral(
      defaultSigner.address,
      collateralAmount,
      0,
      MaxInt256,
      collateral.address,
    );

    positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
    expect(positionSize).to.closeTo(BigNumber.from("1000"), BigNumber.from("1000"));
    expect(await vault.getBalance(perpLemma.address)).to.gt(0); // consider to be fee
    expect(await collateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
  });

  it("openPosition => open position for short and close position for 2 time longs, 80% & 20%", async () => {
    await collateral.mint(defaultSigner.address, parseUnits("5", collateralDecimals));
    let collateralAmount = parseUnits("1", collateralDecimals);
    await collateral.mint(usdLemma.address, collateralAmount);
    collateralAmount = collateralAmount.sub(
      collateralAmount.mul(BigNumber.from("10000")).div(BigNumber.from("1000000")),
    );
    let baseAndQuoteValue = await callStaticOpenPosition(
      clearingHouse,
      longAddress,
      baseToken.address,
      false,
      true,
      collateralAmount,
    ); // index0: base/usd, index1: quote/eth
    collateralAmount = parseUnits("1", collateralDecimals);
    await collateral.connect(defaultSigner).approve(usdLemma.address, collateralAmount);
    await usdLemma
      .connect(defaultSigner)
      .depositToWExactCollateral(defaultSigner.address, collateralAmount, 0, baseAndQuoteValue[0], collateral.address);

    expect(await collateral.balanceOf(perpLemma.address)).to.eq(0);
    expect(await vault.getBalance(perpLemma.address)).to.eq(parseEther("1"));
    let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
    expect(baseAndQuoteValue[0]).to.eq(positionSize);

    // #1
    baseAndQuoteValue = await callStaticOpenPosition(
      clearingHouse,
      longAddress,
      baseToken.address,
      true,
      true,
      positionSize.mul(80).div(100),
    );
    collateralAmount = baseAndQuoteValue[1].mul(parseEther("1")).div(parseEther("0.99"));

    await usdLemma.withdrawToWExactCollateral(
      defaultSigner.address,
      collateralAmount,
      0,
      MaxInt256,
      collateral.address,
    );

    // #2
    baseAndQuoteValue = await callStaticOpenPosition(
      clearingHouse,
      longAddress,
      baseToken.address,
      true,
      true,
      positionSize.mul(20).div(100),
    );
    collateralAmount = baseAndQuoteValue[1].mul(parseEther("1")).div(parseEther("0.99"));

    await usdLemma.withdrawToWExactCollateral(
      defaultSigner.address,
      collateralAmount,
      0,
      MaxInt256,
      collateral.address,
    );

    positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
    expect(positionSize).to.closeTo(BigNumber.from("1000"), BigNumber.from("1000"));
    expect(await vault.getBalance(perpLemma.address)).to.gt(0); // consider to be fee
    expect(await collateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
  });
});
