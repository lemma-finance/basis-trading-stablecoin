import { ethers, upgrades, waffle } from "hardhat";
import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { utils, constants } from "ethers";
import { parseEther, parseUnits } from "ethers/lib/utils";
import { BigNumber } from "@ethersproject/bignumber";
import { loadPerpLushanInfo, snapshot, revertToSnapshot } from "../shared/utils";
import bn from "bignumber.js";
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });
const { AddressZero, MaxUint256, MaxInt256 } = constants;

import {
  AccountBalance,
  BaseToken,
  ClearingHouseConfig,
  Exchange,
  MarketRegistry,
  MockTestAggregatorV3,
  OrderBook,
  TestClearingHouse,
  TestERC20,
  UniswapV3Factory,
  UniswapV3Pool,
  Vault,
  Quoter,
  CollateralManager,
} from "../../perp-lushan/typechain";
import { QuoteToken } from "../../perp-lushan/typechain/QuoteToken";
import { createClearingHouseFixture } from "../shared/perpFixture/fixture";
import { TestPerpLemma } from "../../types/TestPerpLemma";
import { LemmaETH } from "../../types/LemmaETH";

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
  return openPositionParams; //[base,quote]
}
async function callStaticOpenShortPositionWithExactBase(clearingHouse, signer, baseTokenAddress, _amount) {
  return callStaticOpenPosition(clearingHouse, signer, baseTokenAddress, true, true, _amount);
}
async function callStaticOpenShortPositionWithExactQuote(clearingHouse, signer, baseTokenAddress, _amount) {
  return callStaticOpenPosition(clearingHouse, signer, baseTokenAddress, true, false, _amount);
}
async function callStaticOpenLongPositionWithExactBase(clearingHouse, signer, baseTokenAddress, _amount) {
  return callStaticOpenPosition(clearingHouse, signer, baseTokenAddress, false, false, _amount);
}
async function callStaticOpenLongPositionWithExactQuote(clearingHouse, signer, baseTokenAddress, _amount) {
  return callStaticOpenPosition(clearingHouse, signer, baseTokenAddress, false, true, _amount);
}
async function openPosition(clearingHouse, signer, baseTokenAddress, _isBaseToQuote, _isExactInput, _amount) {
  let openPositionParams = await clearingHouse.connect(signer).openPosition({
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
  let defaultSigner,
    reBalancer,
    stackingContract,
    keeperGasReward,
    signer1,
    signer2,
    lemmaTreasury,
    longAddress,
    maker,
    periphery;
  let perpAddresses: any;
  const ZERO = BigNumber.from("0");
  let snapshotId: any;

  let clearingHouse: TestClearingHouse;
  let marketRegistry: MarketRegistry;
  let clearingHouseConfig: ClearingHouseConfig;
  let exchange: Exchange;
  let orderBook: OrderBook;
  let accountBalance: AccountBalance;
  let vault: Vault;
  let usdCollateral: TestERC20;
  let ethCollateral: TestERC20;
  let btcCollateral: TestERC20;
  let baseToken: BaseToken;
  let baseToken2: BaseToken;
  let quoteToken: QuoteToken;
  let collateralManager: CollateralManager;
  let pool: UniswapV3Pool;
  let pool2: UniswapV3Pool;
  let mockedBaseAggregator: MockTestAggregatorV3;
  let mockedBaseAggregator2: MockTestAggregatorV3;
  let mockedWethPriceFeed: MockTestAggregatorV3;
  let mockedWbtcPriceFeed: MockTestAggregatorV3;
  let univ3factory: UniswapV3Factory;
  let quoter: Quoter;
  let perpLemma: TestPerpLemma;
  let usdLemma: LemmaETH;
  let usdCollateralDecimals: number;
  let ethCollateralDecimals: number;
  let btcCollateralDecimals: number;

  before(async function () {
    [defaultSigner, reBalancer, stackingContract, signer1, signer2, lemmaTreasury, longAddress, maker, periphery] =
      await ethers.getSigners();

    const loadFixture: ReturnType<typeof waffle.createFixtureLoader> = waffle.createFixtureLoader([defaultSigner]);
    const _clearingHouseFixture = await loadFixture(createClearingHouseFixture(defaultSigner));
    clearingHouse = _clearingHouseFixture.clearingHouse as TestClearingHouse;
    orderBook = _clearingHouseFixture.orderBook;
    accountBalance = _clearingHouseFixture.accountBalance;
    clearingHouseConfig = _clearingHouseFixture.clearingHouseConfig;
    vault = _clearingHouseFixture.vault;
    exchange = _clearingHouseFixture.exchange;
    marketRegistry = _clearingHouseFixture.marketRegistry;
    usdCollateral = _clearingHouseFixture.USDC;
    ethCollateral = _clearingHouseFixture.WETH;
    btcCollateral = _clearingHouseFixture.WBTC;
    baseToken = _clearingHouseFixture.baseToken;
    baseToken2 = _clearingHouseFixture.baseToken2;
    quoteToken = _clearingHouseFixture.quoteToken;
    mockedBaseAggregator = _clearingHouseFixture.mockedBaseAggregator;
    mockedBaseAggregator2 = _clearingHouseFixture.mockedBaseAggregator2;
    mockedWethPriceFeed = _clearingHouseFixture.mockedWethPriceFeed;
    mockedWbtcPriceFeed = _clearingHouseFixture.mockedWbtcPriceFeed;
    collateralManager = _clearingHouseFixture.collateralManager;
    pool = _clearingHouseFixture.pool;
    pool2 = _clearingHouseFixture.pool2;
    univ3factory = _clearingHouseFixture.uniV3Factory;
    quoter = _clearingHouseFixture.quoter;
    usdCollateralDecimals = await usdCollateral.decimals();
    ethCollateralDecimals = await ethCollateral.decimals();
    btcCollateralDecimals = await btcCollateral.decimals();

    const trustedForwarder = ethers.constants.AddressZero;
    const maxPosition = ethers.constants.MaxUint256;
    const perpLemmaFactory = await ethers.getContractFactory("TestPerpLemma");
    perpLemma = (await upgrades.deployProxy(
      perpLemmaFactory,
      [trustedForwarder, baseToken.address, clearingHouse.address, marketRegistry.address, AddressZero, maxPosition],
      { initializer: "initialize" },
    )) as TestPerpLemma;
    await perpLemma.connect(signer1).resetApprovals();

    // base = usd
    // quote = eth
    await mockedBaseAggregator.setLatestRoundData(0, parseUnits("100", 6), 0, 0, 0);
    // await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("0.01", ethCollateralDecimals), 0, 0, 0);
    await mockedWethPriceFeed.setLatestRoundData(0, parseUnits("100", ethCollateralDecimals), 0, 0, 0);

    await pool.initialize(encodePriceSqrt("100", "1"));
    await pool.increaseObservationCardinalityNext((2 ^ 16) - 1);

    await pool2.initialize(encodePriceSqrt("100", "1"));
    await pool2.increaseObservationCardinalityNext((2 ^ 16) - 1);

    await clearingHouseConfig.setMaxFundingRate(parseUnits("1", 6));

    await marketRegistry.addPool(baseToken.address, 10000);
    await marketRegistry.setFeeRatio(baseToken.address, 10000);
    await exchange.setMaxTickCrossedWithinBlock(baseToken.address, 887272 * 2);

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
      parseEther("10000000"), // vETH
      parseEther("1000000000"), // vUSD
      -887200,
      887200,
    );
    //also, deposit a few amount of settlement tokens from perpLemma wrapper to vault
    await usdCollateral.connect(defaultSigner).mint(defaultSigner.address, parseEther("1"));
    await usdCollateral.connect(defaultSigner).approve(perpLemma.address, parseEther("1"));

    //deploy LemmaETH
    const LemmaETH = await ethers.getContractFactory("LemmaETH");
    usdLemma = (await upgrades.deployProxy(LemmaETH, [AddressZero, usdCollateral.address, perpLemma.address], {
      initializer: "initialize",
    })) as LemmaETH;
    await perpLemma.setUSDLemma(usdLemma.address);

    let XETHL = await ethers.getContractFactory("xETHL");
    this.xethl = await upgrades.deployProxy(XETHL, [AddressZero, usdLemma.address, periphery.address], {
      initializer: "initialize",
    });
    // await this.xethl.setMinimumLock(100);
    await this.xethl.connect(defaultSigner).approve(usdLemma.address, MaxUint256);

    //extra setup for tests
    await ethCollateral.mint(defaultSigner.address, parseEther("1000"));

    //set fees
    const fees = 3000; //30%
    await usdLemma.setFees(fees);
    //set stacking contract address
    await usdLemma.setStakingContractAddress(this.xethl.address);
    //set lemma treasury address
    await usdLemma.setLemmaTreasury(lemmaTreasury.address);
  });

  beforeEach(async function () {
    snapshotId = await snapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(snapshotId);
  });
  it("should initialize correctly", async function () {
    expect(await perpLemma.usdLemma()).to.equal(usdLemma.address);
    expect(await usdLemma.perpetualDEXWrappers("0", usdCollateral.address)).to.equal(perpLemma.address);
  });
  it("getFees", async function () {
    await expect(usdLemma.getFees(0, AddressZero)).to.be.revertedWith("! DEX Wrapper");
    await expect(usdLemma.getFees(100, AddressZero)).to.be.revertedWith("! DEX Wrapper");
    const fees = await usdLemma.getFees(0, usdCollateral.address);
    expect(fees).to.eq(10000);
  });
  it("getTotalPosition", async function () {
    const openWAmount = parseUnits("100", usdCollateralDecimals);
    await usdCollateral.mint(defaultSigner.address, openWAmount);
    await usdCollateral.approve(usdLemma.address, openWAmount);
    await usdLemma.depositToWExactCollateral(
      defaultSigner.address,
      openWAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      0,
      0,
      usdCollateral.address,
    );
    await expect(usdLemma.getTotalPosition(0, AddressZero)).to.be.revertedWith("! DEX Wrapper");
    const position = await usdLemma.getTotalPosition(0, usdCollateral.address);
    expect(position).to.eq(BigNumber.from("98999990199000970200"));
  });
  it("setWhiteListAddress", async function () {
    await expect(usdLemma.connect(signer1).setWhiteListAddress(signer1.address, true)).to.be.revertedWith(
      "Ownable: caller is not the owner",
    );
    await expect(usdLemma.setWhiteListAddress(AddressZero, true)).to.be.revertedWith("Account should not ZERO address");
    await usdLemma.setWhiteListAddress(signer1.address, true);
  });
  it("setStakingContractAddress", async function () {
    await expect(usdLemma.connect(signer1).setStakingContractAddress(signer1.address)).to.be.revertedWith(
      "Ownable: caller is not the owner",
    );
    await expect(usdLemma.setStakingContractAddress(AddressZero)).to.be.revertedWith(
      "StakingContractAddress should not ZERO address",
    );
    await usdLemma.setStakingContractAddress(signer1.address);
    const stakingContractAddress = await usdLemma.stakingContractAddress();
    expect(stakingContractAddress).to.eq(signer1.address);
  });
  it("setLemmaTreasury", async function () {
    await expect(usdLemma.connect(signer1).setLemmaTreasury(signer1.address)).to.be.revertedWith(
      "Ownable: caller is not the owner",
    );
    await expect(usdLemma.setLemmaTreasury(AddressZero)).to.be.revertedWith("LemmaTreasury should not ZERO address");
    await usdLemma.setLemmaTreasury(signer1.address);
    const lemmaTreasury = await usdLemma.lemmaTreasury();
    expect(lemmaTreasury).to.eq(signer1.address);
  });
  it("setFees", async function () {
    await expect(usdLemma.connect(signer1).setFees(signer1.address)).to.be.revertedWith(
      "Ownable: caller is not the owner",
    );
    await usdLemma.setFees(100);
    const fees = await usdLemma.fees();
    expect(fees).to.eq(100);
  });
  it("should deposit with exact ethCollateral correctly", async function () {
    const collateralBalanceBefore = await usdCollateral.balanceOf(defaultSigner.address);
    const amount = parseUnits("100", usdCollateralDecimals);
    await usdCollateral.approve(usdLemma.address, amount);
    const [baseAmount, quoteAmount] = await callStaticOpenLongPositionWithExactQuote(
      clearingHouse,
      longAddress,
      baseToken.address,
      amount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
    );
    let tx = await usdLemma.depositToWExactCollateral(
      signer1.address,
      quoteAmount,
      0,
      baseAmount,
      usdCollateral.address,
    );
    //perpLemma related tests
    const positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
    expect(positionSize.isNegative()).to.be.false;
    expect(baseAmount).to.eq(positionSize.abs());

    const collateralBalanceAfter = await usdCollateral.balanceOf(defaultSigner.address);
    expect(collateralBalanceBefore.sub(collateralBalanceAfter)).to.equal(amount);
    expect(baseAmount).to.equal(await this.xethl.balanceOf(signer1.address));
    await expect(tx)
      .to.emit(usdLemma, "DepositTo")
      .withArgs(0, usdCollateral.address, signer1.address, baseAmount, amount);
    //right now there is no way to check only a subset of the emitted events in waffle: https://github.com/TrueFiEng/Waffle/issues/437
    // will need to add custom method to extract the args from the emitted events and test the following test
    // await expect(tx).to.emit(clearingHouse, "PositionChanged").withArgs(perpLemma.address, baseToken.address, baseAmount, undefined, undefined, undefined, undefined, undefined);
  });
  it("should withdraw with exact ethCollateral correctly", async function () {
    const openWAmount = parseUnits("100", usdCollateralDecimals);
    await usdCollateral.approve(usdLemma.address, openWAmount);

    await usdLemma.depositToWExactCollateral(
      defaultSigner.address,
      openWAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      0,
      0,
      usdCollateral.address,
    );
    //trying to get back only half of the usdCollateral
    //tests for all the usdCollateral to get back is after this test
    const usdlBalanceBefore = await this.xethl.balanceOf(defaultSigner.address);
    const [baseAmount, quoteAmount] = await callStaticOpenShortPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      usdlBalanceBefore,
    );
    const collateralBalanceBefore = await usdCollateral.balanceOf(signer1.address);
    let tx = await usdLemma.withdrawToWExactCollateral(
      signer1.address,
      quoteAmount,
      0,
      baseAmount,
      usdCollateral.address,
    );
    const collateralBalanceAfter = await usdCollateral.balanceOf(signer1.address);
    const usdlBalanceAfter = await this.xethl.balanceOf(defaultSigner.address);

    expect(collateralBalanceAfter.sub(collateralBalanceBefore)).to.equal(
      quoteAmount.mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
    );
    expect(usdlBalanceAfter).to.equal(0);

    await expect(tx)
      .to.emit(usdLemma, "WithdrawTo")
      .withArgs(
        0,
        usdCollateral.address,
        signer1.address,
        usdlBalanceBefore,
        quoteAmount.mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
      );

    // right now there is no way to check only a subset of the emitted events in waffle: https://github.com/TrueFiEng/Waffle/issues/437
    // will need to add custom method to extract the args from the emitted events and test the following test
    // await expect(tx).to.emit(clearingHouse, "PositionChanged").withArgs(perpLemma.address, baseToken.address, baseAmount, undefined, undefined, undefined, undefined, undefined);
  });
  it("should close entire position correctly with exact ethCollateral, depositToWExactCollateral & withdrawTo", async function () {
    const openWAmount = parseUnits("100", usdCollateralDecimals);
    await usdCollateral.approve(usdLemma.address, openWAmount);
    await usdLemma.depositToWExactCollateral(
      defaultSigner.address,
      openWAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      0,
      0,
      usdCollateral.address,
    );

    const usdlBalance = await this.xethl.balanceOf(defaultSigner.address);
    const amount = usdlBalance;
    const [baseAmount, quoteAmount] = await callStaticOpenShortPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      amount,
    );

    //input is whatever it costs to go long on the current usdl balance
    const collateralBalanceBefore = await usdCollateral.balanceOf(signer1.address);
    await this.xethl.approve(usdLemma.address, amount);
    let tx = await usdLemma.withdrawTo(signer1.address, baseAmount, 0, quoteAmount, usdCollateral.address);
    const collateralBalanceAfter = await usdCollateral.balanceOf(signer1.address);
    const usdlBalanceAfter = await this.xethl.balanceOf(defaultSigner.address);

    expect(collateralBalanceAfter.sub(collateralBalanceBefore)).to.equal(
      quoteAmount.mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
    );
    expect(usdlBalanceAfter).to.eq(ZERO);

    await expect(tx)
      .to.emit(usdLemma, "WithdrawTo")
      .withArgs(
        0,
        usdCollateral.address,
        signer1.address,
        baseAmount,
        quoteAmount.mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
      );
  });
  it("depositTo & WithdrawTo", async function () {
    const openWAmount = parseUnits("100", usdCollateralDecimals);
    await usdCollateral.approve(usdLemma.address, openWAmount);

    await usdLemma.depositToWExactCollateral(
      defaultSigner.address,
      openWAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      0,
      0,
      usdCollateral.address,
    );

    const ethAmount = parseUnits("1", ethCollateralDecimals);
    await usdCollateral.approve(usdLemma.address, openWAmount);
    let [baseAmount, quoteAmount] = await callStaticOpenLongPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      ethAmount,
    );
    await usdCollateral.approve(usdLemma.address, MaxUint256);
    let tx = await usdLemma.depositTo(defaultSigner.address, baseAmount, 0, quoteAmount, usdCollateral.address);

    const usdlBalanceBefore = await this.xethl.balanceOf(defaultSigner.address);
    // expect(quoteAmount).to.equal(usdlBalanceBefore);

    let amount = usdlBalanceBefore;
    let [baseAmount1, quoteAmount1] = await callStaticOpenShortPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      amount,
    );
    //input is whatever it costs to go long on the current usdl balance
    const collateralBalanceBefore = await usdCollateral.balanceOf(signer1.address);
    await this.xethl.approve(usdLemma.address, amount);
    let tx1 = await usdLemma.withdrawTo(signer1.address, baseAmount1, 0, quoteAmount1, usdCollateral.address);
    const collateralBalanceAfter = await usdCollateral.balanceOf(signer1.address);
    const usdlBalanceAfter = await this.xethl.balanceOf(defaultSigner.address);

    expect(collateralBalanceAfter.sub(collateralBalanceBefore)).to.equal(
      quoteAmount1.mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
    );
    expect(usdlBalanceAfter).to.eq(ZERO);

    await expect(tx1)
      .to.emit(usdLemma, "WithdrawTo")
      .withArgs(
        0,
        usdCollateral.address,
        signer1.address,
        baseAmount1,
        quoteAmount1.mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
      );
  });
  it("deposit & Withdraw", async function () {
    const openWAmount = parseUnits("100", usdCollateralDecimals);
    await usdCollateral.approve(usdLemma.address, openWAmount);

    await usdLemma.depositToWExactCollateral(
      defaultSigner.address,
      openWAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      0,
      0,
      usdCollateral.address,
    );

    const ethAmount = parseUnits("1", ethCollateralDecimals);
    await usdCollateral.approve(usdLemma.address, openWAmount);
    let [baseAmount, quoteAmount] = await callStaticOpenLongPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      ethAmount,
    );
    await usdCollateral.approve(usdLemma.address, MaxUint256);
    let tx = await usdLemma.deposit(baseAmount, 0, quoteAmount, usdCollateral.address);

    const usdlBalanceBefore = await this.xethl.balanceOf(defaultSigner.address);
    // expect(quoteAmount).to.equal(usdlBalanceBefore);

    let amount = usdlBalanceBefore;
    let [baseAmount1, quoteAmount1] = await callStaticOpenShortPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      amount,
    );
    //input is whatever it costs to go long on the current usdl balance
    const collateralBalanceBefore = await usdCollateral.balanceOf(defaultSigner.address);
    await this.xethl.approve(usdLemma.address, amount);
    let tx1 = await usdLemma.withdraw(baseAmount1, 0, quoteAmount1, usdCollateral.address);
    const collateralBalanceAfter = await usdCollateral.balanceOf(defaultSigner.address);
    const usdlBalanceAfter = await this.xethl.balanceOf(defaultSigner.address);

    expect(collateralBalanceAfter.sub(collateralBalanceBefore)).to.equal(
      quoteAmount1.mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
    );
    expect(usdlBalanceAfter).to.eq(ZERO);

    await expect(tx1)
      .to.emit(usdLemma, "WithdrawTo")
      .withArgs(
        0,
        usdCollateral.address,
        defaultSigner.address,
        baseAmount1,
        quoteAmount1.mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
      );
  });
  describe("Rebalance", async function () {
    const sqrtPriceLimitX96 = 0;
    const deadline = ethers.constants.MaxUint256;
    let openWAmount: BigNumber;
    let lemmaTreasuryBalanceBefore: BigNumber;
    let stackingContractBalanceBefore: BigNumber;
    before(async function () {
      await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);

      const openWAmount = parseUnits("100", usdCollateralDecimals);
      await usdCollateral.approve(usdLemma.address, openWAmount);

      await usdLemma.depositToWExactCollateral(
        defaultSigner.address,
        openWAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
        0,
        0,
        usdCollateral.address,
      );

      // //send some USDL to stackingContract and lemmaTreasury to see if they get burnt when funding Payment is negative
      // stackingContractBalanceBefore = utils.parseEther("0.00002");
      // await usdLemma.transfer(stackingContract.address, stackingContractBalanceBefore); //not enough to be able to test

      // lemmaTreasuryBalanceBefore = openWAmount.div(2);
      // await usdLemma.transfer(lemmaTreasury.address, lemmaTreasuryBalanceBefore); //enough to cover the rest of burn quoteAMount

      // await usdLemma.connect(stackingContract).approve(usdLemma.address, MaxUint256);
      // await usdLemma.connect(lemmaTreasury).approve(usdLemma.address, MaxUint256);
    });

    async function forwardTimestamp(clearingHouse, step) {
      const now = await clearingHouse.getBlockTimestamp();
      await clearingHouse.setBlockTimestamp(now.add(step), {
        gasPrice: 100,
        gasLimit: 9000000,
      });
    }

    function bigNumberToBig(val: BigNumber, decimals: number = 18): bn {
      return new bn(val.toString()).div(new bn(10).pow(decimals));
    }

    function formatSqrtPriceX96ToPrice(value: BigNumber, decimals: number = 18): string {
      return bigNumberToBig(value, 0).div(new bn(2).pow(96)).pow(2).dp(decimals).toString();
    }

    async function checkAndSyncPrice() {
      const slot0 = await pool.slot0();
      const sqrtPrice = slot0.sqrtPriceX96;
      const price = formatSqrtPriceX96ToPrice(sqrtPrice, 18);
      let ethPrice = new bn(price).multipliedBy(1e6).toFixed(0);
      await mockedBaseAggregator.setLatestRoundData(0, ethPrice, 0, 0, 0);
      let ethPrice_1e18 = new bn(price).multipliedBy(1e30).toFixed(0).toString();
      return [ethPrice, ethPrice_1e18];
    }

    it("Force error, Rebalance", async function () {
      await expect(
        usdLemma
          .connect(reBalancer)
          .reBalance(
            123,
            ethCollateral.address,
            100,
            ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
          ),
      ).to.be.revertedWith("invalid DEX/collateral"); // when dex index is not valid
    });

    it("when fundingPNL is negative(-ve)", async function () {
      await openPosition(clearingHouse, longAddress, baseToken.address, true, false, parseEther("2000")); // vUSD amount
      await openPosition(clearingHouse, longAddress, baseToken.address, false, true, parseEther("3000")); // vUSD amount

      await usdCollateral.approve(usdLemma.address, parseUnits("100", ethCollateralDecimals));
      await usdLemma.depositToWExactCollateral(
        defaultSigner.address,
        parseUnits("99", ethCollateralDecimals),
        0,
        0,
        usdCollateral.address,
      );
      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);
      await forwardTimestamp(clearingHouse, 200);
      await usdLemma.depositToWExactCollateral(
        defaultSigner.address,
        parseUnits("1", ethCollateralDecimals),
        0,
        0,
        usdCollateral.address,
      );
      await forwardTimestamp(clearingHouse, 200);
      await perpLemma.settleAllFunding();
      await forwardTimestamp(clearingHouse, 200);

      let fundingPNL = await perpLemma.getFundingPNL();
      let totalFundingPNL = await perpLemma.totalFundingPNL();
      let realizedFundingPnl = await perpLemma.realizedFundingPNL();
      let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

      let rebalanceAmountInEth;
      if (rebalanceAmount.gt(ZERO)) {
        let baseAndQuoteValue = await callStaticOpenLongPositionWithExactQuote(
          clearingHouse,
          longAddress,
          baseToken.address,
          rebalanceAmount,
        );
        rebalanceAmountInEth = baseAndQuoteValue[0];
      } else {
        let baseAndQuoteValue = await callStaticOpenShortPositionWithExactQuote(
          clearingHouse,
          longAddress,
          baseToken.address,
          rebalanceAmount.abs(),
        );
        rebalanceAmountInEth = baseAndQuoteValue[0];
        rebalanceAmountInEth = BigNumber.from("-" + rebalanceAmountInEth.toString()); //negative amount
      }

      let usdlBalStakingContractBefore = await usdLemma.balanceOf(this.xethl.address);
      let usdlBallemmatreasuryBefore = await usdLemma.balanceOf(lemmaTreasury.address);

      let tx = await usdLemma
        .connect(reBalancer)
        .reBalance(
          0,
          usdCollateral.address,
          rebalanceAmountInEth,
          ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
        );

      let usdlBalStakingContractAfter = await usdLemma.balanceOf(this.xethl.address);
      let usdlBallemmatreasuryAfter = await usdLemma.balanceOf(lemmaTreasury.address);

      // console.log("usdlBalStakingContractBefore: ", usdlBalStakingContractBefore.toString());
      // console.log("usdlBallemmatreasuryBefore: ", usdlBallemmatreasuryBefore.toString());
      // console.log("usdlBalStakingContractAfter: ", usdlBalStakingContractAfter.toString());
      // console.log("usdlBallemmatreasuryAfter: ", usdlBallemmatreasuryAfter.toString());

      expect(usdlBalStakingContractBefore).to.gt(usdlBalStakingContractAfter);
      // expect(usdlBallemmatreasuryBefore).to.gt(usdlBallemmatreasuryAfter);
    });

    it("when fundingPNL is positive(+ve)", async function () {
      await openPosition(clearingHouse, longAddress, baseToken.address, false, false, parseEther("3000")); // vUSD amount

      await usdCollateral.approve(usdLemma.address, parseUnits("100", ethCollateralDecimals));
      await usdLemma.depositToWExactCollateral(
        defaultSigner.address,
        parseUnits("19000", ethCollateralDecimals),
        0,
        0,
        usdCollateral.address,
      );
      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);
      await forwardTimestamp(clearingHouse, 200);
      await usdLemma.depositToWExactCollateral(
        defaultSigner.address,
        parseUnits("1000", ethCollateralDecimals),
        0,
        0,
        usdCollateral.address,
      );
      await forwardTimestamp(clearingHouse, 200);
      await perpLemma.settleAllFunding();
      await forwardTimestamp(clearingHouse, 200);

      let fundingPNL = await perpLemma.getFundingPNL();
      let totalFundingPNL = await perpLemma.totalFundingPNL();
      let realizedFundingPnl = await perpLemma.realizedFundingPNL();
      let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

      let rebalanceAmountInEth;
      if (rebalanceAmount.gt(ZERO)) {
        let baseAndQuoteValue = await callStaticOpenLongPositionWithExactQuote(
          clearingHouse,
          longAddress,
          baseToken.address,
          rebalanceAmount,
        );
        rebalanceAmountInEth = baseAndQuoteValue[0];
      } else {
        let baseAndQuoteValue = await callStaticOpenShortPositionWithExactQuote(
          clearingHouse,
          longAddress,
          baseToken.address,
          rebalanceAmount.abs(),
        );
        rebalanceAmountInEth = baseAndQuoteValue[0];
        rebalanceAmountInEth = BigNumber.from("-" + rebalanceAmountInEth.toString()); //negative amount
      }

      let usdlBalStakingContractBefore = await usdLemma.balanceOf(stackingContract.address);
      let usdlBallemmatreasuryBefore = await usdLemma.balanceOf(lemmaTreasury.address);

      let tx = await usdLemma
        .connect(reBalancer)
        .reBalance(
          0,
          usdCollateral.address,
          rebalanceAmountInEth,
          ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
        );

      let usdlBalStakingContractAfter = await usdLemma.balanceOf(this.xethl.address);
      let usdlBallemmatreasuryAfter = await usdLemma.balanceOf(lemmaTreasury.address);

      // console.log("usdlBalStakingContractBefore: ", usdlBalStakingContractBefore.toString());
      // console.log("usdlBallemmatreasuryBefore: ", usdlBallemmatreasuryBefore.toString());
      // console.log("usdlBalStakingContractAfter: ", usdlBalStakingContractAfter.toString());
      // console.log("usdlBallemmatreasuryAfter: ", usdlBallemmatreasuryAfter.toString());

      expect(usdlBalStakingContractBefore).to.lt(usdlBalStakingContractAfter);
      expect(usdlBallemmatreasuryBefore).to.lt(usdlBallemmatreasuryAfter);
    });
  });
  it("Force Error, depositTo", async function () {
    await expect(usdLemma.depositTo(defaultSigner.address, 100, 100, 100, usdCollateral.address)).to.be.revertedWith(
      "invalid DEX/collateral",
    ); // when dex index is not valid
    await expect(usdLemma.depositTo(defaultSigner.address, 100, 0, 100, AddressZero)).to.be.revertedWith(
      "invalid DEX/collateral",
    ); //when collateral address is not valid
    const openWAmount = parseUnits("1", usdCollateralDecimals);
    await usdCollateral.approve(usdLemma.address, openWAmount);
    let [baseAmount, quoteAmount] = await callStaticOpenLongPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      openWAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
    );
    await usdCollateral.approve(usdLemma.address, baseAmount);
    await expect(
      usdLemma.depositTo(defaultSigner.address, openWAmount, 0, 1, usdCollateral.address),
    ).to.be.revertedWith("collateral required execeeds maximum");
  });
  it("Force Error, withdrawTo", async function () {
    const openWAmount = parseUnits("100", usdCollateralDecimals);
    await usdCollateral.approve(usdLemma.address, openWAmount);

    await usdLemma.depositToWExactCollateral(
      defaultSigner.address,
      openWAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      0,
      0,
      usdCollateral.address,
    );

    const ethAmount = parseUnits("1", ethCollateralDecimals);
    await usdCollateral.approve(usdLemma.address, openWAmount);
    let [baseAmount, quoteAmount] = await callStaticOpenLongPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      ethAmount,
    );
    await usdCollateral.approve(usdLemma.address, MaxUint256);
    const usdlBalanceBefore = await this.xethl.balanceOf(defaultSigner.address);
    let tx = await usdLemma.depositTo(defaultSigner.address, baseAmount, 0, quoteAmount, usdCollateral.address);
    const usdlBalanceAfter = await this.xethl.balanceOf(defaultSigner.address);
    expect(baseAmount).to.equal(usdlBalanceAfter.sub(usdlBalanceBefore));

    await usdLemma.approve(usdLemma.address, 100);
    await expect(usdLemma.withdrawTo(defaultSigner.address, 100, 100, 100, usdCollateral.address)).to.be.revertedWith(
      "invalid DEX/collateral",
    ); // when dex index is not valid
    await expect(usdLemma.withdrawTo(defaultSigner.address, 100, 0, 100, AddressZero)).to.be.revertedWith(
      "invalid DEX/collateral",
    ); //when collateral address is not valid

    let amount = usdlBalanceBefore;
    let [baseAmount1, quoteAmount1] = await callStaticOpenShortPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      amount,
    );
    await usdLemma.approve(usdLemma.address, amount);
    await expect(
      usdLemma.withdrawTo(defaultSigner.address, baseAmount1, 0, quoteAmount1.mul(2), usdCollateral.address),
    ).to.be.revertedWith("collateral got back is too low");
    tx = await usdLemma.withdrawTo(signer1.address, baseAmount1, 0, quoteAmount1, usdCollateral.address);
    await expect(tx)
      .to.emit(usdLemma, "WithdrawTo")
      .withArgs(
        0,
        usdCollateral.address,
        signer1.address,
        baseAmount1,
        quoteAmount1.mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
      );
  });
  it("Force Error, depositToWExactCollateral", async function () {
    const openWAmount = parseUnits("100", usdCollateralDecimals);
    await expect(
      usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 120, 0, usdCollateral.address),
    ).to.be.revertedWith("invalid DEX/collateral"); // when dex index is not valid
    await expect(
      usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, AddressZero),
    ).to.be.revertedWith("invalid DEX/collateral"); //when collateral address is not valid

    await usdCollateral.approve(usdLemma.address, openWAmount);
    await expect(
      usdLemma.depositToWExactCollateral(
        defaultSigner.address,
        openWAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
        0,
        parseEther("10000"),
        usdCollateral.address,
      ),
    ).to.be.revertedWith("ETHL minted too low");
  });
  it("Force Error, withdrawToWExactCollateral", async function () {
    const openWAmount = utils.parseEther("1");
    await usdCollateral.approve(usdLemma.address, openWAmount);
    await usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, usdCollateral.address);
    //trying to get back only half of the usdCollateral
    //tests for all the usdCollateral to get back is after this test
    const amount = openWAmount.div(BigNumber.from("2"));

    const usdlBalanceBefore = await this.xethl.balanceOf(defaultSigner.address);
    const [, quoteAmount] = await callStaticOpenShortPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      usdlBalanceBefore,
    );

    await expect(
      usdLemma.withdrawToWExactCollateral(defaultSigner.address, openWAmount, 120, 0, usdCollateral.address),
    ).to.be.revertedWith("invalid DEX/collateral"); // when dex index is not valid
    await expect(
      usdLemma.withdrawToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, AddressZero),
    ).to.be.revertedWith("invalid DEX/collateral"); //when collateral address is not valid

    await usdLemma.approve(usdLemma.address, openWAmount);
    await expect(
      usdLemma.withdrawToWExactCollateral(defaultSigner.address, quoteAmount, 0, 0, usdCollateral.address),
    ).to.be.revertedWith("ETHL burnt exceeds maximum");
  });
});
