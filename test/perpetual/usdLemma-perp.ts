import { ethers, upgrades, waffle } from "hardhat";
import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { utils, constants } from "ethers";
import { parseEther, parseUnits } from "ethers/lib/utils";
import { BigNumber } from "@ethersproject/bignumber";
import { snapshot, revertToSnapshot } from "../shared/utils";
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
import { createClearingHouseFixture } from "../shared/perpFixture/fixtures_local";
import { TestPerpLemma, USDLemma } from "../../types";

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
  let defaultSigner, reBalancer, stackingContract, keeperGasReward, signer1, signer2, lemmaTreasury, longAddress, maker;
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
  let usdLemma: USDLemma;
  let usdCollateralDecimals: number;
  let ethCollateralDecimals: number;
  let btcCollateralDecimals: number;

  before(async function () {
    [defaultSigner, reBalancer, stackingContract, signer1, signer2, lemmaTreasury, longAddress, maker] =
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
    const perpLemmaFactory = await ethers.getContractFactory("PerpLemma");
    perpLemma = (await upgrades.deployProxy(
      perpLemmaFactory,
      [
        trustedForwarder,
        ethCollateral.address,
        baseToken.address,
        clearingHouse.address,
        marketRegistry.address,
        AddressZero,
        maxPosition,
      ],
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
    await perpLemma.connect(defaultSigner).depositSettlementToken(parseEther("1"));

    //deploy USDLemma
    const USDLemma = await ethers.getContractFactory("USDLemma");
    usdLemma = (await upgrades.deployProxy(USDLemma, [AddressZero, ethCollateral.address, perpLemma.address], {
      initializer: "initialize",
    })) as USDLemma;
    await perpLemma.setUSDLemma(usdLemma.address);

    //extra setup for tests
    await ethCollateral.mint(defaultSigner.address, parseEther("1000"));

    //set fees
    const fees = 3000; //30%
    await usdLemma.setFees(fees);
    //set stacking contract address
    await usdLemma.setStakingContractAddress(stackingContract.address);
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
    expect(await usdLemma.perpetualDEXWrappers("0", ethCollateral.address)).to.equal(perpLemma.address);
  });

  it("getFees", async function () {
    await expect(usdLemma.getFees(0, AddressZero)).to.be.revertedWith("DEX Wrapper should not ZERO address");
    await expect(usdLemma.getFees(100, AddressZero)).to.be.revertedWith("DEX Wrapper should not ZERO address");
    const fees = await usdLemma.getFees(0, ethCollateral.address);
    expect(fees).to.eq(10000);
  });

  it("getTotalPosition", async function () {
    const openWAmount = utils.parseEther("1");
    await ethCollateral.approve(usdLemma.address, openWAmount);
    await usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, ethCollateral.address);
    await expect(usdLemma.getTotalPosition(0, AddressZero)).to.be.revertedWith("DEX Wrapper should not ZERO address");
    const position = await usdLemma.getTotalPosition(0, ethCollateral.address);
    expect(position).to.eq(parseEther("100").mul(-1));
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
    const collateralBalanceBefore = await ethCollateral.balanceOf(defaultSigner.address);
    const amount = utils.parseEther("1");
    await ethCollateral.approve(usdLemma.address, amount);
    const [, quoteAmount] = await callStaticOpenShortPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      amount,
    );
    // console.log("quoteAmount", quoteAmount.toString());
    let tx = await usdLemma.depositToWExactCollateral(signer1.address, amount, 0, quoteAmount, ethCollateral.address);
    //perpLemma related tests
    const positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
    expect(positionSize.isNegative()).to.be.true;
    expect(amount).to.eq(positionSize.abs());

    const collateralBalanceAfter = await ethCollateral.balanceOf(defaultSigner.address);
    expect(collateralBalanceBefore.sub(collateralBalanceAfter)).to.equal(amount);
    expect(quoteAmount).to.equal(await usdLemma.balanceOf(signer1.address));
    await expect(tx)
      .to.emit(usdLemma, "DepositTo")
      .withArgs(0, ethCollateral.address, signer1.address, quoteAmount, amount);
    //right now there is no way to check only a subset of the emitted events in waffle: https://github.com/TrueFiEng/Waffle/issues/437
    // will need to add custom method to extract the args from the emitted events and test the following test
    // await expect(tx).to.emit(clearingHouse, "PositionChanged").withArgs(perpLemma.address, baseToken.address, baseAmount, undefined, undefined, undefined, undefined, undefined);
  });
  it("should withdraw with exact ethCollateral correctly", async function () {
    const openWAmount = utils.parseEther("1");
    await ethCollateral.approve(usdLemma.address, openWAmount);
    await usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, ethCollateral.address);
    //trying to get back only half of the ethCollateral
    //tests for all the ethCollateral to get back is after this test
    const amount = openWAmount.div(BigNumber.from("2"));

    const [, quoteAmount] = await callStaticOpenLongPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      amount,
    );
    const collateralBalanceBefore = await ethCollateral.balanceOf(signer1.address);
    const usdlBalanceBefore = await usdLemma.balanceOf(defaultSigner.address);
    let tx = await usdLemma.withdrawToWExactCollateral(signer1.address, amount, 0, quoteAmount, ethCollateral.address);
    const collateralBalanceAfter = await ethCollateral.balanceOf(signer1.address);
    const usdlBalanceAfter = await usdLemma.balanceOf(defaultSigner.address);

    expect(collateralBalanceAfter.sub(collateralBalanceBefore)).to.equal(amount);
    expect(usdlBalanceBefore.sub(usdlBalanceAfter)).to.equal(quoteAmount);

    await expect(tx)
      .to.emit(usdLemma, "WithdrawTo")
      .withArgs(0, ethCollateral.address, signer1.address, quoteAmount, amount);

    //right now there is no way to check only a subset of the emitted events in waffle: https://github.com/TrueFiEng/Waffle/issues/437
    // will need to add custom method to extract the args from the emitted events and test the following test
    // await expect(tx).to.emit(clearingHouse, "PositionChanged").withArgs(perpLemma.address, baseToken.address, baseAmount, undefined, undefined, undefined, undefined, undefined);
  });
  it("should close entire position correctly with exact ethCollateral, depositToWExactCollateral & withdrawTo", async function () {
    const openWAmount = utils.parseEther("1");
    await ethCollateral.approve(usdLemma.address, openWAmount);
    await usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, ethCollateral.address);

    const usdlBalance = await usdLemma.balanceOf(defaultSigner.address);
    const amount = usdlBalance;
    const [baseAmount] = await callStaticOpenLongPositionWithExactQuote(
      clearingHouse,
      longAddress,
      baseToken.address,
      amount,
    );

    //input is whatever it costs to go long on the current usdl balance
    const collateralBalanceBefore = await ethCollateral.balanceOf(signer1.address);
    await usdLemma.approve(usdLemma.address, amount);
    let tx = await usdLemma.withdrawTo(signer1.address, amount, 0, baseAmount, ethCollateral.address);
    const collateralBalanceAfter = await ethCollateral.balanceOf(signer1.address);
    const usdlBalanceAfter = await usdLemma.balanceOf(defaultSigner.address);

    expect(collateralBalanceAfter.sub(collateralBalanceBefore)).to.equal(baseAmount);
    expect(usdlBalanceAfter).to.eq(ZERO);

    await expect(tx)
      .to.emit(usdLemma, "WithdrawTo")
      .withArgs(0, ethCollateral.address, signer1.address, amount, baseAmount);
  });
  it("depositTo & WithdrawTo", async function () {
    const openWAmount = utils.parseEther("1");
    await ethCollateral.approve(usdLemma.address, openWAmount);
    let [baseAmount, quoteAMount] = await callStaticOpenShortPositionWithExactQuote(
      clearingHouse,
      longAddress,
      baseToken.address,
      openWAmount,
    );
    await ethCollateral.approve(usdLemma.address, baseAmount);
    let tx = await usdLemma.depositTo(defaultSigner.address, openWAmount, 0, baseAmount, ethCollateral.address);

    const usdlBalanceBefore = await usdLemma.balanceOf(defaultSigner.address);
    expect(quoteAMount).to.equal(usdlBalanceBefore);

    let amount = usdlBalanceBefore;
    let [baseAmount1] = await callStaticOpenLongPositionWithExactQuote(
      clearingHouse,
      longAddress,
      baseToken.address,
      amount,
    );
    const collateralBalanceBefore = await ethCollateral.balanceOf(signer1.address);
    await usdLemma.approve(usdLemma.address, amount);
    tx = await usdLemma.withdrawTo(signer1.address, amount, 0, baseAmount1, ethCollateral.address);
    const collateralBalanceAfter = await ethCollateral.balanceOf(signer1.address);
    const usdlBalanceAfter = await usdLemma.balanceOf(defaultSigner.address);

    expect(collateralBalanceAfter.sub(collateralBalanceBefore)).to.equal(baseAmount1);
    expect(usdlBalanceBefore.sub(usdlBalanceAfter)).to.equal(amount);

    await expect(tx)
      .to.emit(usdLemma, "WithdrawTo")
      .withArgs(0, ethCollateral.address, signer1.address, amount, baseAmount1);
  });
  it("deposit & Withdraw", async function () {
    const openWAmount = utils.parseEther("1");
    await ethCollateral.approve(usdLemma.address, openWAmount);
    let [baseAmount, quoteAMount] = await callStaticOpenShortPositionWithExactQuote(
      clearingHouse,
      longAddress,
      baseToken.address,
      openWAmount,
    );
    await ethCollateral.approve(usdLemma.address, baseAmount);
    let tx = await usdLemma.deposit(openWAmount, 0, baseAmount, ethCollateral.address);

    const usdlBalanceBefore = await usdLemma.balanceOf(defaultSigner.address);
    expect(quoteAMount).to.equal(usdlBalanceBefore);

    let amount = usdlBalanceBefore;
    let [baseAmount1] = await callStaticOpenLongPositionWithExactQuote(
      clearingHouse,
      longAddress,
      baseToken.address,
      amount,
    );
    const collateralBalanceBefore = await ethCollateral.balanceOf(defaultSigner.address);
    await usdLemma.approve(usdLemma.address, amount);
    tx = await usdLemma.withdraw(amount, 0, baseAmount1, ethCollateral.address);
    const collateralBalanceAfter = await ethCollateral.balanceOf(defaultSigner.address);
    const usdlBalanceAfter = await usdLemma.balanceOf(defaultSigner.address);

    expect(collateralBalanceAfter.sub(collateralBalanceBefore)).to.equal(baseAmount1);
    expect(usdlBalanceBefore.sub(usdlBalanceAfter)).to.equal(amount);

    await expect(tx)
      .to.emit(usdLemma, "WithdrawTo")
      .withArgs(0, ethCollateral.address, defaultSigner.address, amount, baseAmount1);
  });

  describe("Rebalance", async function () {
    const sqrtPriceLimitX96 = 0;
    const deadline = ethers.constants.MaxUint256;
    let openWAmount: BigNumber;
    let lemmaTreasuryBalanceBefore: BigNumber;
    let stackingContractBalanceBefore: BigNumber;
    before(async function () {
      await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);

      const openWAmount = utils.parseEther("1");
      await ethCollateral.approve(usdLemma.address, openWAmount);
      let [baseAmount, quoteAMount] = await callStaticOpenShortPositionWithExactBase(
        clearingHouse,
        longAddress,
        baseToken.address,
        openWAmount,
      );

      await ethCollateral.approve(usdLemma.address, baseAmount);
      let tx = await usdLemma.depositTo(defaultSigner.address, quoteAMount, 0, baseAmount, ethCollateral.address);

      //send some USDL to stackingContract and lemmaTreasury to see if they get burnt when funding Payment is negative
      stackingContractBalanceBefore = utils.parseEther("0.00002");
      await usdLemma.transfer(stackingContract.address, stackingContractBalanceBefore); //not enough to be able to test

      lemmaTreasuryBalanceBefore = quoteAMount.div(2);
      await usdLemma.transfer(lemmaTreasury.address, lemmaTreasuryBalanceBefore); //enough to cover the rest of burn quoteAMount

      await usdLemma.connect(stackingContract).approve(usdLemma.address, MaxUint256);
      await usdLemma.connect(lemmaTreasury).approve(usdLemma.address, MaxUint256);
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
      // console.log('checkAndSyncPrice:' , ethPrice.toString(), price.toString())
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
      await openPosition(clearingHouse, longAddress, baseToken.address, true, true, parseEther("2000"));
      await openPosition(clearingHouse, longAddress, baseToken.address, false, false, parseEther("3000"));

      openWAmount = utils.parseEther("99");
      await ethCollateral.approve(usdLemma.address, openWAmount);
      await usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, ethCollateral.address);
      await ethers.provider.send("evm_increaseTime", [300]);
      await ethers.provider.send("evm_mine", []);
      await forwardTimestamp(clearingHouse, 1);
      openWAmount = utils.parseEther("1");
      await ethCollateral.approve(usdLemma.address, openWAmount);
      await usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, ethCollateral.address);
      await forwardTimestamp(clearingHouse, 1);
      await perpLemma.settleAllFunding();

      let checkPrice_before = await checkAndSyncPrice();
      let fundingPNL = await perpLemma.getFundingPNL();
      let totalFundingPNL = await perpLemma.totalFundingPNL();
      let realizedFundingPnl = await perpLemma.realizedFundingPNL();
      let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

      // console.log("fundingPNL: ", fundingPNL.toString());
      // console.log("totalFundingPNL: ", totalFundingPNL.toString());
      // console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
      // console.log("rebalanceAmount: ", rebalanceAmount.toString());
      // console.log("checkPrice_before: ", checkPrice_before.toString());

      let usdlBalStakingContractBefore = await usdLemma.balanceOf(stackingContract.address);
      let usdlBallemmatreasuryBefore = await usdLemma.balanceOf(lemmaTreasury.address);

      let tx = await usdLemma
        .connect(reBalancer)
        .reBalance(
          0,
          ethCollateral.address,
          rebalanceAmount,
          ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
        );

      expect(tx).to.emit(usdLemma, "Rebalance");

      let usdlBalStakingContractAfter = await usdLemma.balanceOf(stackingContract.address);
      let usdlBallemmatreasuryAfter = await usdLemma.balanceOf(lemmaTreasury.address);

      expect(usdlBalStakingContractBefore).to.gt(usdlBalStakingContractAfter);
      expect(usdlBallemmatreasuryBefore).to.gt(usdlBallemmatreasuryAfter);

      // console.log("usdlBalStakingContractBefore: ", usdlBalStakingContractBefore.toString());
      // console.log("usdlBallemmatreasuryBefore: ", usdlBallemmatreasuryBefore.toString());
      // console.log("usdlBalStakingContractAfter: ", usdlBalStakingContractAfter.toString());
      // console.log("usdlBallemmatreasuryAfter: ", usdlBallemmatreasuryAfter.toString());
    });

    it("when fundingPNL is positive(+ve)", async function () {
      await openPosition(clearingHouse, longAddress, baseToken.address, true, true, parseEther("10000"));
      openWAmount = utils.parseEther("490");
      await ethCollateral.approve(usdLemma.address, openWAmount);
      await usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, ethCollateral.address);
      await ethers.provider.send("evm_increaseTime", [300]);
      await ethers.provider.send("evm_mine", []);
      await forwardTimestamp(clearingHouse, 1);
      openWAmount = utils.parseEther("10");
      await ethCollateral.approve(usdLemma.address, openWAmount);
      await usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, ethCollateral.address);
      await forwardTimestamp(clearingHouse, 1);
      await perpLemma.settleAllFunding();

      let checkPrice_before = await checkAndSyncPrice();
      let fundingPNL = await perpLemma.getFundingPNL();
      let totalFundingPNL = await perpLemma.totalFundingPNL();
      let realizedFundingPnl = await perpLemma.realizedFundingPNL();
      let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

      // console.log("fundingPNL: ", fundingPNL.toString());
      // console.log("totalFundingPNL: ", totalFundingPNL.toString());
      // console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
      // console.log("rebalanceAmount: ", rebalanceAmount.toString());
      // console.log("checkPrice_before: ", checkPrice_before.toString());

      let usdlBalStakingContractBefore = await usdLemma.balanceOf(stackingContract.address);
      let usdlBallemmatreasuryBefore = await usdLemma.balanceOf(lemmaTreasury.address);

      let tx = await usdLemma
        .connect(reBalancer)
        .reBalance(
          0,
          ethCollateral.address,
          rebalanceAmount,
          ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
        );

      expect(tx).to.emit(usdLemma, "Rebalance");
      let usdlBalStakingContractAfter = await usdLemma.balanceOf(stackingContract.address);
      let usdlBallemmatreasuryAfter = await usdLemma.balanceOf(lemmaTreasury.address);

      expect(usdlBalStakingContractBefore).to.lt(usdlBalStakingContractAfter);
      expect(usdlBallemmatreasuryBefore).to.lt(usdlBallemmatreasuryAfter);

      // console.log("usdlBalStakingContractBefore: ", usdlBalStakingContractBefore.toString());
      // console.log("usdlBallemmatreasuryBefore: ", usdlBallemmatreasuryBefore.toString());
      // console.log("usdlBalStakingContractAfter: ", usdlBalStakingContractAfter.toString());
      // console.log("usdlBallemmatreasuryAfter: ", usdlBallemmatreasuryAfter.toString());
    });
  });

  it("Force Error, depositTo", async function () {
    await expect(usdLemma.depositTo(defaultSigner.address, 100, 100, 100, ethCollateral.address)).to.be.revertedWith(
      "invalid DEX/collateral",
    ); // when dex index is not valid
    await expect(usdLemma.depositTo(defaultSigner.address, 100, 0, 100, AddressZero)).to.be.revertedWith(
      "invalid DEX/collateral",
    ); //when collateral address is not valid
    const openWAmount = utils.parseEther("1");
    await ethCollateral.approve(usdLemma.address, openWAmount);
    let [baseAmount, quoteAMount] = await callStaticOpenShortPositionWithExactQuote(
      clearingHouse,
      longAddress,
      baseToken.address,
      openWAmount,
    );
    await ethCollateral.approve(usdLemma.address, baseAmount);
    await expect(
      usdLemma.depositTo(defaultSigner.address, openWAmount, 0, 1, ethCollateral.address),
    ).to.be.revertedWith("collateral required execeeds maximum");
  });
  it("Force Error, withdrawTo", async function () {
    const openWAmount = utils.parseEther("1");
    await ethCollateral.approve(usdLemma.address, openWAmount);
    let [baseAmount, quoteAMount] = await callStaticOpenShortPositionWithExactQuote(
      clearingHouse,
      longAddress,
      baseToken.address,
      openWAmount,
    );
    await ethCollateral.approve(usdLemma.address, baseAmount);
    let tx = await usdLemma.depositTo(defaultSigner.address, openWAmount, 0, baseAmount, ethCollateral.address);

    const usdlBalanceBefore = await usdLemma.balanceOf(defaultSigner.address);
    expect(quoteAMount).to.equal(usdlBalanceBefore);

    await usdLemma.approve(usdLemma.address, 100);
    await expect(usdLemma.withdrawTo(defaultSigner.address, 100, 100, 100, ethCollateral.address)).to.be.revertedWith(
      "invalid DEX/collateral",
    ); // when dex index is not valid
    await expect(usdLemma.withdrawTo(defaultSigner.address, 100, 0, 100, AddressZero)).to.be.revertedWith(
      "invalid DEX/collateral",
    ); //when collateral address is not valid

    let amount = usdlBalanceBefore;
    let [baseAmount1] = await callStaticOpenLongPositionWithExactQuote(
      clearingHouse,
      longAddress,
      baseToken.address,
      amount,
    );
    await usdLemma.approve(usdLemma.address, amount);
    await expect(
      usdLemma.withdrawTo(defaultSigner.address, amount, 0, baseAmount1.mul(2), ethCollateral.address),
    ).to.be.revertedWith("collateral got back is too low");
    tx = await usdLemma.withdrawTo(signer1.address, amount, 0, baseAmount1, ethCollateral.address);
    await expect(tx)
      .to.emit(usdLemma, "WithdrawTo")
      .withArgs(0, ethCollateral.address, signer1.address, amount, baseAmount1);
  });
  it("Force Error, depositToWExactCollateral", async function () {
    const openWAmount = utils.parseEther("1");
    await expect(
      usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 120, 0, ethCollateral.address),
    ).to.be.revertedWith("invalid DEX/collateral"); // when dex index is not valid
    await expect(
      usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, AddressZero),
    ).to.be.revertedWith("invalid DEX/collateral"); //when collateral address is not valid

    await ethCollateral.approve(usdLemma.address, openWAmount);
    await expect(
      usdLemma.depositToWExactCollateral(
        defaultSigner.address,
        openWAmount,
        0,
        parseEther("10000"),
        ethCollateral.address,
      ),
    ).to.be.revertedWith("USDL minted too low");
  });
  it("Force Error, withdrawToWExactCollateral", async function () {
    const openWAmount = utils.parseEther("1");
    await ethCollateral.approve(usdLemma.address, openWAmount);
    await usdLemma.depositToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, ethCollateral.address);
    //trying to get back only half of the ethCollateral
    //tests for all the ethCollateral to get back is after this test
    const amount = openWAmount.div(BigNumber.from("2"));

    const [, quoteAmount] = await callStaticOpenLongPositionWithExactBase(
      clearingHouse,
      longAddress,
      baseToken.address,
      amount,
    );

    await expect(
      usdLemma.withdrawToWExactCollateral(defaultSigner.address, openWAmount, 120, 0, ethCollateral.address),
    ).to.be.revertedWith("invalid DEX/collateral"); // when dex index is not valid
    await expect(
      usdLemma.withdrawToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, AddressZero),
    ).to.be.revertedWith("invalid DEX/collateral"); //when collateral address is not valid

    await usdLemma.approve(usdLemma.address, openWAmount);
    await expect(
      usdLemma.withdrawToWExactCollateral(defaultSigner.address, openWAmount, 0, 0, ethCollateral.address),
    ).to.be.revertedWith("USDL burnt exceeds maximum");
  });
});
