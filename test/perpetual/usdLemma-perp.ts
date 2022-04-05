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
import CollateralManagerAbi from "../../perp-lushan/artifacts/contracts/CollateralManager.sol/CollateralManager.json";
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
async function addLiquidity(clearingHouse, signer, baseTokenAddress, _baseAmount, _quoteAmount, _lT, _uT) {
  await clearingHouse.connect(signer).addLiquidity({
    baseToken: baseTokenAddress,
    base: _baseAmount,
    quote: _quoteAmount,
    lowerTick: _lT,
    upperTick: _uT,
    minBase: 0,
    minQuote: 0,
    useTakerBalance: false,
    deadline: ethers.constants.MaxUint256,
  });
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
  let defaultSigner, usdLemma, reBalancer, hasWETH, keeperGasReward, signer1, signer2, signer3, longAddress;
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
  let usdCollateral: any
  let ethCollateral: any;
  let btcCollateral: any;
  let collateral: any;
  let baseToken: any;
  let baseToken2: any;
  let quoteToken: any;
  let univ3factory: any;
  let collateralManager: any
  let pool: any;
  let pool2: any;
  let mockedBaseAggregator: any;
  let mockedBaseAggregator2: any;
  let mockedWbtcPriceFeed: any;
  let mockedWethPriceFeed: any
  let quoter: any;
  let perpLemma: any;
  let perpLemma2: any;
  let usdCollateralDecimals: any;
  let ethCollateralDecimals: any;
  let btcCollateralDecimals: any;
  let collateralDecimals: any;
  const lowerTick = 0;
  const upperTick = 100000;


  before(async function () {
    [defaultSigner, usdLemma, reBalancer, hasWETH, signer1, signer2, signer3, longAddress] = await ethers.getSigners();

    perpAddresses = await loadPerpLushanInfo();
    clearingHouse = new ethers.Contract(perpAddresses.clearingHouse.address, ClearingHouseAbi.abi, defaultSigner);
    orderBook = new ethers.Contract(perpAddresses.orderBook.address, OrderBookAbi.abi, defaultSigner);
    clearingHouseConfig = new ethers.Contract(perpAddresses.clearingHouseConfig.address, ClearingHouseConfigAbi.abi, defaultSigner);
    vault = new ethers.Contract(perpAddresses.vault.address, VaultAbi.abi, defaultSigner);
    exchange = new ethers.Contract(perpAddresses.exchange.address, ExchangeAbi.abi, defaultSigner);
    marketRegistry = new ethers.Contract(perpAddresses.marketRegistry.address, MarketRegistryAbi.abi, defaultSigner);
    usdCollateral = new ethers.Contract(perpAddresses.usdCollateral.address, TestERC20Abi.abi, defaultSigner);
    ethCollateral = new ethers.Contract(perpAddresses.ethCollateral.address, TestERC20Abi.abi, defaultSigner);
    btcCollateral = new ethers.Contract(perpAddresses.btcCollateral.address, TestERC20Abi.abi, defaultSigner);
    baseToken = new ethers.Contract(perpAddresses.baseToken.address, BaseTokenAbi.abi, defaultSigner);
    baseToken2 = new ethers.Contract(perpAddresses.baseToken2.address, BaseToken2Abi.abi, defaultSigner);
    quoteToken = new ethers.Contract(perpAddresses.quoteToken.address, QuoteTokenAbi.abi, defaultSigner);
    collateralManager = new ethers.Contract(perpAddresses.collateralManager.address, CollateralManagerAbi.abi, defaultSigner);
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
    mockedWethPriceFeed = new ethers.Contract(
      perpAddresses.mockedWethPriceFeed.address,
      MockTestAggregatorV3Abi.abi,
      defaultSigner,
    );
    mockedWbtcPriceFeed = new ethers.Contract(
      perpAddresses.mockedWbtcPriceFeed.address,
      MockTestAggregatorV3Abi.abi,
      defaultSigner,
    );
    pool = new ethers.Contract(perpAddresses.pool.address, UniswapV3PoolAbi.abi, defaultSigner);
    pool2 = new ethers.Contract(perpAddresses.pool2.address, UniswapV3Pool2Abi.abi, defaultSigner);
    quoter = new ethers.Contract(perpAddresses.quoter.address, QuoterAbi.abi, defaultSigner);

    usdCollateralDecimals = await usdCollateral.decimals();
    ethCollateralDecimals = await ethCollateral.decimals();
    btcCollateralDecimals = await btcCollateral.decimals();

    console.log('usdCollateralDecimals', usdCollateralDecimals.toString())
    console.log('ethCollateralDecimals', ethCollateralDecimals.toString())
    console.log('btcCollateralDecimals', btcCollateralDecimals.toString())

    const maxPosition = ethers.constants.MaxUint256;
    const perpLemmaFactory = await ethers.getContractFactory("PerpLemma");
    perpLemma = await upgrades.deployProxy(
      perpLemmaFactory,
      [
        // usdCollateral.address,
        ethCollateral.address,
        baseToken.address,
        quoteToken.address,
        clearingHouse.address,
        marketRegistry.address,
        usdLemma.address,
        maxPosition,
      ],
      { initializer: "initialize" },
    );
    await perpLemma.connect(signer1).resetApprovals();

    collateral = ethCollateral;
    collateralDecimals = ethCollateralDecimals;

    // base = usd
    // quote = eth

    await mockedBaseAggregator.setLatestRoundData(0, parseUnits("0.01", ethCollateralDecimals), 0, 0, 0);
    await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("100", ethCollateralDecimals), 0, 0, 0);
    await mockedWethPriceFeed.setLatestRoundData(0, parseUnits("100", ethCollateralDecimals), 0, 0, 0);
    // await mockedWbtcPriceFeed.setLatestRoundData(0, parseUnits("10000", ethCollateralDecimals), 0, 0, 0);

    await pool.initialize(encodePriceSqrt("1", "100"));
    await pool.increaseObservationCardinalityNext((2 ^ 16) - 1);

    await pool2.initialize(encodePriceSqrt("1", "100"));
    await pool2.increaseObservationCardinalityNext((2 ^ 16) - 1);

    await clearingHouseConfig.setMaxFundingRate(parseUnits("1", 6));

    await marketRegistry.addPool(baseToken.address, 10000);
    await marketRegistry.addPool(baseToken2.address, 10000);
    await marketRegistry.setFeeRatio(baseToken.address, 10000);
    await marketRegistry.setFeeRatio(baseToken2.address, 10000);
    await exchange.setMaxTickCrossedWithinBlock(baseToken.address, 887272);

    //add liquidity

    // prepare usdCollateral for maker
    const makerUSDCollateralAmount = parseUnits("100000000000", usdCollateralDecimals);
    await usdCollateral.mint(signer1.address, makerUSDCollateralAmount);
    await usdCollateral.mint(signer2.address, makerUSDCollateralAmount);
    await usdCollateral.mint(longAddress.address, makerUSDCollateralAmount);

    await usdCollateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
    await usdCollateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256);
    await usdCollateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);

    const depositUSDAmount = parseUnits("10000000000", usdCollateralDecimals);
    await vault.connect(longAddress).deposit(usdCollateral.address, depositUSDAmount);
    await vault.connect(signer2).deposit(usdCollateral.address, depositUSDAmount);

    // prepare ethCollateral for maker
    const makerETHCollateralAmount = parseUnits("10000000000", ethCollateralDecimals);
    await ethCollateral.mint(signer1.address, makerETHCollateralAmount);
    await ethCollateral.mint(signer2.address, makerETHCollateralAmount);
    await ethCollateral.mint(longAddress.address, makerETHCollateralAmount);

    await ethCollateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
    await ethCollateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256);
    await ethCollateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);

    const depositETHAmount = parseUnits("1000000000", ethCollateralDecimals);
    await vault.connect(longAddress).deposit(ethCollateral.address, depositETHAmount);
    await vault.connect(signer2).deposit(ethCollateral.address, depositETHAmount);

    // prepare btcCollateral for maker
    const makerBtcCollateralAmount = parseUnits("1000000", btcCollateralDecimals);
    await btcCollateral.mint(signer1.address, makerBtcCollateralAmount);
    await btcCollateral.mint(signer2.address, makerBtcCollateralAmount);
    await btcCollateral.mint(longAddress.address, makerBtcCollateralAmount);

    await btcCollateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
    await btcCollateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256);
    await btcCollateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);

    const depositAmountForBtc = parseUnits("100", btcCollateralDecimals);
    await vault.connect(longAddress).deposit(btcCollateral.address, depositAmountForBtc);
    await vault.connect(signer2).deposit(btcCollateral.address, depositAmountForBtc);

    await addLiquidity(
      clearingHouse,
      signer2,
      baseToken.address,
      parseEther("1000000000"), // usdc
      parseEther("10000000"), // eth
      -887200,
      887200,
    );

    //also, deposit a few amount of settlement tokens from perpLemma wrapper to vault
    await usdCollateral.connect(defaultSigner).mint(defaultSigner.address, parseEther("1"));
    await usdCollateral.connect(defaultSigner).approve(perpLemma.address, parseEther("1"));
    await perpLemma.connect(defaultSigner).depositSettlementToken(parseEther("1"));



    //deploy USDLemma
    const USDLemma = await ethers.getContractFactory("USDLemma");
    usdLemma = await upgrades.deployProxy(USDLemma, [AddressZero, collateral.address, perpLemma.address], {
      initializer: "initialize",
    });
    await perpLemma.setUSDLemma(usdLemma.address);


    //extra setup for tests
    await collateral.mint(defaultSigner.address, parseEther("1000"));
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
  it("should deposit with exact collateral correctly", async function () {
    const collateralBalanceBefore = await collateral.balanceOf(defaultSigner.address);
    const amount = utils.parseEther("1");
    await collateral.approve(usdLemma.address, amount);
    const [baseAmount,] = await callStaticOpenPosition(clearingHouse, longAddress, baseToken.address, false, true, amount);
    let tx = await usdLemma.depositToWExactCollateral(signer1.address, amount, 0, 0, collateral.address);
    const collateralBalanceAfter = await collateral.balanceOf(defaultSigner.address);
    expect(collateralBalanceBefore.sub(collateralBalanceAfter)).to.equal(amount);
    expect(baseAmount).to.equal(await usdLemma.balanceOf(signer1.address));
    await expect(tx)
      .to.emit(usdLemma, "DepositTo")
      .withArgs(0, collateral.address, signer1.address, baseAmount, amount);
    //right now there is no way to check only a subset of the emitted events in waffle: https://github.com/TrueFiEng/Waffle/issues/437
    // will need to add custom method to extract the args from the emitted events and test the following test
    // await expect(tx).to.emit(clearingHouse, "PositionChanged").withArgs(perpLemma.address, baseToken.address, baseAmount, undefined, undefined, undefined, undefined, undefined);
  });
  it("should close with exact collateral correctly", async function () {
    const openWAmount = utils.parseEther("1");
    await collateral.approve(usdLemma.address, openWAmount);
    await usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, collateral.address);
    //trying to get back only half of the collateral
    //tests for all the collateral to get back is after this test
    const amount = openWAmount.div(BigNumber.from("2"));

    const [baseAmount,] = await callStaticOpenPosition(clearingHouse, longAddress, baseToken.address, true, false, amount);
    const collateralBalanceBefore = await collateral.balanceOf(signer1.address);
    const usdlBalanceBefore = await usdLemma.balanceOf(defaultSigner.address);
    let tx = await usdLemma.withdrawToWExactCollateral(signer1.address, amount, 0, ethers.constants.MaxUint256, collateral.address);
    const collateralBalanceAfter = await collateral.balanceOf(signer1.address);
    const usdlBalanceAfter = await usdLemma.balanceOf(defaultSigner.address);

    expect(collateralBalanceAfter.sub(collateralBalanceBefore)).to.equal(amount);
    expect(usdlBalanceBefore.sub(usdlBalanceAfter)).to.equal(baseAmount);

    await expect(tx).to.emit(usdLemma, "WithdrawTo").withArgs(0, collateral.address, signer1.address, baseAmount, amount);

    //right now there is no way to check only a subset of the emitted events in waffle: https://github.com/TrueFiEng/Waffle/issues/437
    // will need to add custom method to extract the args from the emitted events and test the following test
    // await expect(tx).to.emit(clearingHouse, "PositionChanged").withArgs(perpLemma.address, baseToken.address, baseAmount, undefined, undefined, undefined, undefined, undefined);
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
