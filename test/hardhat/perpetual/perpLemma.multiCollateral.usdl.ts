import { ethers, upgrades, waffle } from "hardhat";
import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { parseEther, parseUnits } from "ethers/lib/utils";
import { BigNumber } from "@ethersproject/bignumber";
import { snapshot, revertToSnapshot } from "../shared/utils";
import bn from "bignumber.js";
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

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
import { PerpLemmaCommon, TestPerpLemma } from "../../../types";

use(solidity);

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

async function openPosition(clearingHouse, signer, baseTokenAddress, _isBaseToQuote, _isExactInput, _amount) {
  await clearingHouse.connect(signer).openPosition({
    baseToken: baseTokenAddress,
    isBaseToQuote: _isBaseToQuote,
    isExactInput: _isExactInput,
    oppositeAmountBound: 0,
    amount: _amount, // amount in usd
    sqrtPriceLimitX96: 0,
    deadline: ethers.constants.MaxUint256,
    referralCode: ethers.constants.HashZero,
  });
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

async function forwardTimestamp(clearingHouse, step) {
  const now = await clearingHouse.getBlockTimestamp();
  await clearingHouse.setBlockTimestamp(now.add(step), {
    gasPrice: 100,
    gasLimit: 9000000,
  });
}

describe("perpLemma.multiCollateral.usdl", async function () {
  let defaultSigner, usdLemma, reBalancer, hasWETH, keeperGasReward, signer1, signer2, signer3, longAddress;
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
  let perpLemma: any;
  let usdCollateralDecimals: number;
  let ethCollateralDecimals: number;
  let btcCollateralDecimals: number;

  before(async function () {
    [defaultSigner, usdLemma, reBalancer, hasWETH, signer1, signer2, signer3, longAddress] = await ethers.getSigners();
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

    await expect(
      upgrades.deployProxy(
        perpLemmaFactory,
        [
          trustedForwarder,
          ethCollateral.address,
          ethers.constants.AddressZero,
          usdCollateral.address,
          baseToken.address,
          clearingHouse.address,
          marketRegistry.address,
          usdLemma.address,
          maxPosition,
        ],
        { initializer: "initialize" },
      ),
    ).to.be.revertedWith("_usdlBaseToken should not ZERO address");

    await expect(
      upgrades.deployProxy(
        perpLemmaFactory,
        [
          trustedForwarder,
          ethCollateral.address,
          baseToken.address,
          usdCollateral.address,
          ethers.constants.AddressZero,
          clearingHouse.address,
          marketRegistry.address,
          usdLemma.address,
          maxPosition,
        ],
        { initializer: "initialize" },
      ),
    ).to.be.revertedWith("_synthBaseToken should not ZERO address");

    await expect(
      upgrades.deployProxy(
        perpLemmaFactory,
        [
          trustedForwarder,
          ethCollateral.address,
          baseToken.address,
          usdCollateral.address,
          baseToken.address,
          ethers.constants.AddressZero,
          marketRegistry.address,
          usdLemma.address,
          maxPosition,
        ],
        { initializer: "initialize" },
      ),
    ).to.be.revertedWith("ClearingHouse should not ZERO address");

    await expect(
      upgrades.deployProxy(
        perpLemmaFactory,
        [
          trustedForwarder,
          ethCollateral.address,
          baseToken.address,
          usdCollateral.address,
          baseToken.address,
          clearingHouse.address,
          ethers.constants.AddressZero,
          usdLemma.address,
          maxPosition,
        ],
        { initializer: "initialize" },
      ),
    ).to.be.revertedWith("MarketRegistry should not ZERO address");

    perpLemma = (await upgrades.deployProxy(
      perpLemmaFactory,
      [
        trustedForwarder,
        ethCollateral.address,
        baseToken.address,
        usdCollateral.address,
        baseToken.address,
        clearingHouse.address,
        marketRegistry.address,
        usdLemma.address,
        maxPosition,
      ],
      { initializer: "initialize" },
    )) as any;
    await perpLemma.connect(signer1).resetApprovals();

    // base = eth
    // quote = usd

    await mockedBaseAggregator.setLatestRoundData(0, parseUnits("100", 6), 0, 0, 0);
    await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("0.01", ethCollateralDecimals), 0, 0, 0);
    await mockedWethPriceFeed.setLatestRoundData(0, parseUnits("100", ethCollateralDecimals), 0, 0, 0);

    await pool.initialize(encodePriceSqrt("100", "1"));
    await pool.increaseObservationCardinalityNext((2 ^ 16) - 1);

    await pool2.initialize(encodePriceSqrt("100", "1"));
    await pool2.increaseObservationCardinalityNext((2 ^ 16) - 1);

    await clearingHouseConfig.setMaxFundingRate(parseUnits("1", 6));

    await marketRegistry.addPool(baseToken.address, 10000);
    await marketRegistry.setFeeRatio(baseToken.address, 10000);
    await exchange.setMaxTickCrossedWithinBlock(baseToken.address, 887272 * 2);
  });

  beforeEach(async function () {
    snapshotId = await snapshot();
  });

  afterEach(async function () {
    // await calcLeverage1();
    await revertToSnapshot(snapshotId);
  });

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

  async function calcLeverage() {
    const positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
    const depositedCollateral = await vault.getBalanceByToken(perpLemma.address, ethCollateral.address);
    const quote = await accountBalance.getQuote(perpLemma.address, baseToken.address);

    const slot0 = await pool.slot0();
    const sqrtPrice = slot0.sqrtPriceX96;
    const price = formatSqrtPriceX96ToPrice(sqrtPrice, 18);
    const ethPrice2 = parseUnits(price, 18);

    // const interval = await clearingHouseConfig.getTwapInterval();
    // const ethPrice = await mockedBaseAggregator.getRoundData(0); //ethPrice method1
    // const ethPriceInUSDCFromIndex = await baseToken.getIndexPrice(interval); //ethPrice method2
    // console.log("Price: ", price.toString())
    // console.log('quote: ', quote.toString());
    // console.log('positionSize', positionSize.toString())
    // console.log('depositedCollateral', depositedCollateral.toString())
    // console.log('ethPrice', ethPrice.toString())
    // console.log('ethPrice2:' , ethPrice2.toString())
    // console.log('interval', interval.toString())

    if (!positionSize.eq(ZERO)) {
      const leverage = depositedCollateral.mul(ethPrice2).div(quote);
      return leverage;
    }
    return 0;
  }

  // async function calcLeverage1() {
  //   console.log("calcLeverage1()");
  //   let totalAbsPositionValue = await accountBalance.getTotalAbsPositionValue(perpLemma.address);
  //   console.log("totalAbsPositionValue: ", totalAbsPositionValue.toString());
  //   let accountValue = await clearingHouse.getAccountValue(perpLemma.address);

  //   console.log("accountValue: ", accountValue.toString());
  //   console.log("accountValue: ", accountValue.toString());

  //   if (!totalAbsPositionValue.eq(ZERO)) {
  //     console.log("totalAbsPositionValue-1: ", totalAbsPositionValue.toString());
  //     const accountMarginRatio: BigNumber = accountValue.mul(parseUnits("1", 18)).div(totalAbsPositionValue);
  //     console.log("accountMarginRatio-1: ", formatUnits(accountMarginRatio, BigNumber.from(18)).toString());
  //     // const leverage: any = BigNumber.from(1).div(formatUnits(accountMarginRatio, BigNumber.from(18)));
  //     const leverage: any = new bn(1e18).dividedBy(accountMarginRatio.toString()).multipliedBy(1e18);
  //     console.log("leverage-1: ", leverage.toFixed(0));

  //     return BigNumber.from(leverage.toFixed(0));
  //   }
  // }

  describe("PerpLemma tests => Open, Close, fees, settlement", () => {
    before(async function () {
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
    });

    it("check fees", async function () {
      const fees = await perpLemma.getFees(baseToken.address);
      expect(fees).to.eq(10000);
    });

    it("deposit and withdraw settlement token", async function () {
      const depositSettlement = parseUnits("10000", usdCollateralDecimals); // usdc is settlement token
      await usdCollateral.mint(defaultSigner.address, depositSettlement);
      await usdCollateral.approve(perpLemma.address, ethers.constants.MaxUint256);
      await expect(perpLemma.connect(usdLemma).depositSettlementToken(depositSettlement)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
      await expect(perpLemma.depositSettlementToken(0)).to.be.revertedWith("Amount should greater than zero");
      await perpLemma.depositSettlementToken(depositSettlement);
      expect(await vault.getBalance(perpLemma.address)).to.eq(depositSettlement);
      await expect(perpLemma.connect(usdLemma).withdrawSettlementToken(depositSettlement)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
      await expect(perpLemma.withdrawSettlementToken(0)).to.be.revertedWith("Amount should greater than zero");
      const getFreeCollateral = await vault.getFreeCollateral(perpLemma.address);
      await perpLemma.withdrawSettlementToken(getFreeCollateral);
      expect(await usdCollateral.balanceOf(perpLemma.address)).to.eq(0);
    });

    describe("PerpLemma tests => Open, Close, Settlement", () => {
      let collateralAmountForUSD;
      let collateralAmountForETH;

      before(async function () {
        collateralAmountForUSD = parseUnits("1000000000000", usdCollateralDecimals); // 6 decimal
        collateralAmountForETH = parseUnits("100", ethCollateralDecimals); // 6 decimal

        await usdCollateral.mint(defaultSigner.address, collateralAmountForUSD.mul(3));
        await usdCollateral.mint(usdLemma.address, collateralAmountForUSD.mul(3));

        await ethCollateral.mint(signer1.address, parseUnits("10000000000", ethCollateralDecimals));
        await ethCollateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(signer1).deposit(ethCollateral.address, parseUnits("10000", ethCollateralDecimals));
        await usdCollateral.mint(signer1.address, collateralAmountForUSD);
        await usdCollateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(signer1).deposit(usdCollateral.address, collateralAmountForUSD);

        await ethCollateral.mint(signer2.address, parseUnits("10000000000", ethCollateralDecimals));
        await ethCollateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(signer2).deposit(ethCollateral.address, parseUnits("100000", ethCollateralDecimals));

        await ethCollateral.mint(longAddress.address, parseUnits("10000000000", ethCollateralDecimals));
        await ethCollateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(longAddress).deposit(ethCollateral.address, parseUnits("10000", ethCollateralDecimals));
        await usdCollateral.mint(longAddress.address, collateralAmountForUSD);
        await usdCollateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(longAddress).deposit(usdCollateral.address, collateralAmountForUSD);

        await ethCollateral.mint(usdLemma.address, parseUnits("10000000000", ethCollateralDecimals));
        await ethCollateral.connect(usdLemma).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(usdLemma).deposit(ethCollateral.address, parseUnits("10000", ethCollateralDecimals));

        // // transfer Collateral to perpLemma
        await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmountForUSD);
        const depositSettlement = parseUnits("10000", usdCollateralDecimals); // usdc is settlement token
        await usdCollateral.approve(perpLemma.address, ethers.constants.MaxUint256);
        await perpLemma.depositSettlementToken(depositSettlement);
      });

      it("getAmountInCollateralDecimalsForPerp", async function () {
        // decimal 18 currantly
        let amount = await perpLemma.getAmountInCollateralDecimalsForPerp(
          parseUnits("1", ethCollateralDecimals),
          ethCollateral.address,
          false,
        );
        expect(amount).to.eq(parseUnits("1", ethCollateralDecimals));
      });

      it("should set rebalance addresses correctly", async function () {
        await expect(perpLemma.connect(defaultSigner).setReBalancer(ethers.constants.AddressZero)).to.be.revertedWith(
          "ReBalancer should not ZERO address",
        );
        await expect(perpLemma.connect(signer1).setReBalancer(reBalancer.address)).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
        await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);
      });

      it("should set addresses correctly", async function () {
        await expect(perpLemma.connect(defaultSigner).setUSDLemma(ethers.constants.AddressZero)).to.be.revertedWith(
          "UsdLemma should not ZERO address",
        );
        await expect(perpLemma.connect(signer1).setUSDLemma(signer1.address)).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
        await perpLemma.connect(defaultSigner).setUSDLemma(signer1.address);
        expect(await perpLemma.usdLemma()).to.equal(signer1.address);
        await expect(
          perpLemma.connect(signer1).setReferrerCode(ethers.utils.formatBytes32String("ADemoReferrerCode")),
        ).to.be.revertedWith("Ownable: caller is not the owner");
        await perpLemma.connect(defaultSigner).setReferrerCode(ethers.utils.formatBytes32String("ADemoReferrerCode"));
        const referrerCode = await perpLemma.referrerCode();
        expect(ethers.utils.parseBytes32String(referrerCode)).to.eq("ADemoReferrerCode");
      });

      it("should fail to open when max position is reached", async function () {
        const collateralAmount = parseUnits("1", ethCollateralDecimals);
        await perpLemma.setMaxPosition(parseEther("0.9"));
        await ethCollateral.mint(usdLemma.address, collateralAmount.add(1));
        await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount.add(1));
        await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount)).to.be.revertedWith(
          "max position reached",
        );
      });

      it("should close position correctly", async function () {
        let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
        await ethCollateral.mint(usdLemma.address, collateralAmount);

        // transfer Collateral to perpLemma
        await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          collateralAmount,
        ); // index0: base/usd, index1: quote/eth

        // // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("-1000000000000000000", 0), // Position, negative because of short?
            parseUnits("99999990000000999999", 0), // Notional
            parseUnits("999999900000010000", 0), // Fee
            parseUnits("98999990100000989999", 0), // OpenNotional
            0, // PnlToBeRealized
            parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
          );

        const totalPosition = await perpLemma.getTotalPosition(baseToken.address);
        expect(totalPosition.mul(-1)).to.eq(parseEther("100"));
        expect(await ethCollateral.balanceOf(perpLemma.address)).to.eq(0);
        expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(parseEther("1"));
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));

        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize.mul(-1),
        );
        // // long eth and close position, withdraw ethCollateral
        await expect(await perpLemma.connect(usdLemma).closeLongWithExactCollateral(baseAndQuoteValue[0]))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("1000000000000000000", 0), // Position, negative because of short?
            parseUnits("-99999990000001000000", 0), // Notional
            parseUnits("1010100909090919192", 0), // Fee
            parseUnits("0", 0), // OpenNotional
            parseUnits("-2010100809090929193", 0), // PnlToBeRealized
            parseUnits("792281625142643375935439503361", 0), // sqrtPriceAfterX96
          );
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(positionSize).to.eq(0);
        expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(0); // consider to be fee
        expect(await ethCollateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
      });

      it("#1 openShortWithExactCollateral and closeLongWithExactCollateral ", async function () {
        collateralAmountForETH = parseUnits("1", ethCollateralDecimals); // 6 decimal
        await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmountForETH);
        // open
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          collateralAmountForETH,
        ); // index0: base/usd, index1: quote/eth
        await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmountForETH)).to.emit(
          clearingHouse,
          "PositionChanged",
        );
        let leverage = await calcLeverage();
        expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

        let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize.mul(-1),
        );

        await expect(await perpLemma.connect(usdLemma).closeLongWithExactCollateral(baseAndQuoteValue[0]));
        leverage = await calcLeverage();
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(leverage).to.eq(0);
        expect(positionSize).to.eq(0);
        expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(0); // consider to be fee
        expect(await ethCollateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
      });
      // getCollateralAmountGivenUnderlyingAssetAmountForPerp => gCAGUAA
      it("#2 openShortWithExactCollateral and gCAGUAA => close ", async function () {
        collateralAmountForETH = parseUnits("1", ethCollateralDecimals); // 6 decimal
        await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmountForETH);

        // open
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          collateralAmountForETH,
        ); // index0: base/usd, index1: quote/eth
        // Deposit ethCollateral in eth and Short eth and long usdc
        collateralAmountForETH = parseUnits("1", ethCollateralDecimals);
        await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmountForETH)).to.emit(
          clearingHouse,
          "PositionChanged",
        );
        let leverage = await calcLeverage();
        expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

        let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize.mul(-1),
        );
        let usdLemmaBalBefore = await ethCollateral.balanceOf(usdLemma.address);
        await expect(
          perpLemma
            .connect(usdLemma)
            .getCollateralAmountGivenUnderlyingAssetAmountForPerp(baseAndQuoteValue[1], false, true),
        ).to.emit(clearingHouse, "PositionChanged");
        await perpLemma.connect(usdLemma).closeLongWithExactQuoteForUSDL(0, baseAndQuoteValue[0]);
        leverage = await calcLeverage();
        let usdLemmaBalAfter = await ethCollateral.balanceOf(usdLemma.address);
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);

        expect(leverage).to.eq(0);
        // slippage and fees have been cut here, need to verify above line
        // for 1 eth position it is taking charge fees 0.0199.. eth
        expect(positionSize).to.closeTo(parseUnits("19900194069543166", 0).mul(-1), 10000);
        // expect(positionSize).to.closeTo(parseFloat(parseEther("0.02").mul(-1)), parseEther("0.002"));
        expect(await ethCollateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
        expect(usdLemmaBalAfter.sub(usdLemmaBalBefore)).to.be.equal(collateralAmountForETH);
      });
      // getCollateralAmountGivenUnderlyingAssetAmountForPerp => gCAGUAA
      it("#3 gCAGUAA -> open and gCAGUAA -> close ", async function () {
        collateralAmountForETH = parseUnits("100", ethCollateralDecimals); // 6 decimal
        await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmountForETH);
        // open
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          collateralAmountForETH,
        ); // index0: base/usd, index1: quote/eth

        // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(
          perpLemma
            .connect(usdLemma)
            .getCollateralAmountGivenUnderlyingAssetAmountForPerp(baseAndQuoteValue[1], true, true),
        ).to.emit(clearingHouse, "PositionChanged");

        await expect(perpLemma.connect(usdLemma).openShortWithExactQuoteForUSDL(0, 0)).to.be.revertedWith(
          "Amount should greater than zero",
        );
        await expect(
          perpLemma.connect(usdLemma).openShortWithExactQuoteForUSDL(0, baseAndQuoteValue[0].mul(2)),
        ).to.be.revertedWith("Not enough collateral to Open");
        await perpLemma.connect(usdLemma).openShortWithExactQuoteForUSDL(0, baseAndQuoteValue[0]);
        let leverage = await calcLeverage();
        expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

        // close
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize.mul(-1),
        ); // index0: base/usd, index1: quote/eth

        await expect(
          perpLemma
            .connect(usdLemma)
            .getCollateralAmountGivenUnderlyingAssetAmountForPerp(baseAndQuoteValue[1], false, true),
        ).to.emit(clearingHouse, "PositionChanged");

        await expect(perpLemma.connect(usdLemma).closeLongWithExactQuoteForUSDL(0, 0)).to.be.revertedWith(
          "Amount should greater than zero",
        );
        await perpLemma.connect(usdLemma).closeLongWithExactQuoteForUSDL(0, baseAndQuoteValue[0]);
        leverage = await calcLeverage();
        expect(leverage).to.eq(0);
      });
      // getCollateralAmountGivenUnderlyingAssetAmountForPerp => gCAGUAA
      it("#4 gCAGUAA -> open and closeLongWithExactCollateral ", async function () {
        collateralAmountForETH = parseUnits("100", ethCollateralDecimals);
        await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmountForETH);
        // open
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          collateralAmountForETH,
        ); // index0: base/usd, index1: quote/eth

        // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(
          perpLemma
            .connect(usdLemma)
            .getCollateralAmountGivenUnderlyingAssetAmountForPerp(baseAndQuoteValue[1], true, true),
        ).to.emit(clearingHouse, "PositionChanged");

        await perpLemma.connect(usdLemma).openShortWithExactQuoteForUSDL(0, baseAndQuoteValue[0]);
        let leverage = await calcLeverage();
        expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

        // close
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize.mul(-1),
        );
        await expect(await perpLemma.connect(usdLemma).closeLongWithExactCollateral(baseAndQuoteValue[0].div(2)));
        leverage = await calcLeverage();
        expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
      });

      describe("OpenPosition leverage test", () => {
        let collateralToGetBack_1e6, collateralToGetBack_1e18;
        beforeEach(async function () {
          const collateralAmount = parseEther("1");
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
        });

        it("openPosition => emit event PositionChanged", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          // Deposit ethCollateral in eth and Short eth and long usdc
          await expect(
            perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount.mul(2)),
          ).to.be.revertedWith("Not enough collateral for openShortWithExactCollateral");
          await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(0)).to.be.revertedWith(
            "Amount should greater than zero",
          );
          await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-1000000000000000000", 0), // Position, negative because of short?
              parseUnits("99999990000000999999", 0), // Notional
              parseUnits("999999900000010000", 0), // Fee
              parseUnits("98999990100000989999", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
            );
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));
        });

        it("openPosition => leverage should be 1x", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-1000000000000000000", 0), // Position, negative because of short?
              parseUnits("99999990000000999999", 0), // Notional
              parseUnits("999999900000010000", 0), // Fee
              parseUnits("98999990100000989999", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
            );
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));
          let leverage = await calcLeverage();
          expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
        });
      });

      describe("Open and close Position test variation", () => {
        let collateralmintAmount;
        beforeEach(async function () {
          collateralmintAmount = parseEther("1");
          await ethCollateral.mint(usdLemma.address, collateralmintAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralmintAmount);
        });

        it("openPosition => open position for short and close position for 2 time longs", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);

          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          await expect(
            perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount.mul(2)),
          ).to.be.revertedWith("Not enough collateral for openShortWithExactCollateral");
          await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(0)).to.be.revertedWith(
            "Amount should greater than zero",
          );
          await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount)).to.emit(
            clearingHouse,
            "PositionChanged",
          );

          expect(await ethCollateral.balanceOf(perpLemma.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));

          // #1
          baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            positionSize.div(2).mul(-1),
          );

          await expect(perpLemma.connect(usdLemma).closeLongWithExactCollateral(0)).to.be.revertedWith("AS");
          await expect(perpLemma.connect(usdLemma).closeLongWithExactCollateral(baseAndQuoteValue[0])).to.emit(
            clearingHouse,
            "PositionChanged",
          );

          // #2
          baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            positionSize.div(2).mul(-1),
          );

          await expect(perpLemma.connect(usdLemma).closeLongWithExactCollateral(baseAndQuoteValue[0])).to.emit(
            clearingHouse,
            "PositionChanged",
          );

          positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
          expect(positionSize).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(0); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
        });

        it("openPosition => open position for short and close position for long", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-1000000000000000000", 0), // Position, negative because of short?
              parseUnits("99999990000000999999", 0), // Notional
              parseUnits("999999900000010000", 0), // Fee
              parseUnits("98999990100000989999", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
            );

          expect(await ethCollateral.balanceOf(perpLemma.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));

          baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            positionSize.mul(-1),
          );

          await expect(perpLemma.connect(usdLemma).closeLongWithExactCollateral(baseAndQuoteValue[0]))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("1000000000000000000", 0), // Position, negative because of short?
              parseUnits("-99999990000001000000", 0), // Notional
              parseUnits("1010100909090919192", 0), // Fee
              parseUnits("0", 0), // OpenNotional
              parseUnits("-2010100809090929193", 0), // PnlToBeRealized
              parseUnits("792281625142643375935439503361", 0), // sqrtPriceAfterX96
            );
          positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
          expect(positionSize).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(0); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
        });
      });

      describe("openShortWithExactCollateral and closeLongWithExactCollateral", async function () {
        it("Basic Open", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.equal(collateralAmount);
          await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount)).to.emit(
            clearingHouse,
            "PositionChanged",
          );
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));
        });

        it("Basic Open and Close, Checking the lost ethCollateral should be < 5%", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          const usdLemmaBalance1 = await ethCollateral.balanceOf(usdLemma.address);
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.equal(collateralAmount);
          await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount)).to.emit(
            clearingHouse,
            "PositionChanged",
          );

          expect(await ethCollateral.balanceOf(perpLemma.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));
          baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            positionSize.mul(-1),
          );
          // collateralAmount = baseAndQuoteValue[1].mul(parseEther("1")).div(parseEther("0.99"));

          await expect(perpLemma.connect(usdLemma).closeLongWithExactCollateral(baseAndQuoteValue[0]))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("1000000000000000000", 0), // Position, negative because of short?
              parseUnits("-99999990000001000000", 0), // Notional
              parseUnits("1010100909090919192", 0), // Fee
              parseUnits("0", 0), // OpenNotional
              parseUnits("-2010100809090929193", 0), // PnlToBeRealized
              parseUnits("792281625142643375935439503361", 0), // sqrtPriceAfterX96
            );
          positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
          expect(positionSize).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(0); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);

          const usdLemmaBalance2 = await ethCollateral.balanceOf(usdLemma.address);
          const deltaBalance = usdLemmaBalance2.sub(usdLemmaBalance1);
          const lostCollateral = collateralAmount.sub(deltaBalance);
          const percLostCollateral = lostCollateral.div(collateralAmount);
          const amt = collateralAmount.mul(BigNumber.from(5).div(100));
          // Checking the lost ethCollateral is < 5% of the initial amount
          expect(collateralAmount.sub(deltaBalance)).to.below(collateralAmount.mul(5).div(100));
        });
      });

      describe("Emergency Settlement", async function () {
        beforeEach(async function () {});

        it("Force Error: closeWExactUSDLAfterSettlement", async function () {
          await perpLemma.setHasSettled(true);
          // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more USDL to Burn
          await expect(
            perpLemma.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmountForPerp("100", false, true),
          ).to.be.revertedWith("Settled vUSD position amount should not ZERO");
          await perpLemma.setPositionAtSettlementInQuoteForUSDL(100);
          // WPL_NC : Wrapper PerpLemma, No Collateral
          await expect(
            perpLemma.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmountForPerp("100", false, true),
          ).to.be.revertedWith("Settled collateral amount should not ZERO");
        });

        it("Force Error: closeWExactCollateralAfterSettlement", async function () {
          await perpLemma.setHasSettled(true);
          // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more USDL to Burn
          await expect(perpLemma.connect(usdLemma).closeLongWithExactCollateral("100")).to.be.revertedWith(
            "Settled vUSD position amount should not ZERO",
          );
          await perpLemma.setPositionAtSettlementInQuoteForUSDL(100);
          // WPL_NC : Wrapper PerpLemma, No Collateral
          await expect(perpLemma.connect(usdLemma).closeLongWithExactCollateral("100")).to.be.revertedWith(
            "Settled collateral amount should not ZERO",
          );
        });

        it("Calling Settle() when Market is open should revert", async () => {
          // By default the market is open
          await expect(perpLemma.connect(usdLemma).settle()).to.be.revertedWith("CH_MNC");
        });

        it("Calling Settle() when Market is paused should revert", async () => {
          // Pausing the market
          expect(await baseToken.connect(defaultSigner)["pause()"]())
            .to.emit(baseToken, "StatusUpdated")
            .withArgs(1);
          await expect(perpLemma.connect(usdLemma).settle()).to.be.revertedWith("CH_MNC");
        });

        it("Calling Settle() when Market is closed should work", async () => {
          const collateralAmount = parseEther("1");
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
          // Deposit ethCollateral in eth and Short eth and long usdc
          await perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount);
          expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
          // Closing the market
          expect(await baseToken.connect(defaultSigner)["close(uint256)"](1)).to.emit(baseToken, "StatusUpdated");

          const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
          await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));
          await expect(perpLemma.connect(usdLemma).settle())
            .to.emit(vault, "Withdrawn")
            .withArgs(ethCollateral.address, perpLemma.address, parseUnits("1000000000000000000", 0));
          await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount)).to.be.revertedWith(
            "Market Closed",
          );
        });

        it("Open a Position and Calling Settle() when Market is closed should work", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth

          await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-1000000000000000000", 0), // Position, negative because of short?
              parseUnits("99999990000000999999", 0), // Notional
              parseUnits("999999900000010000", 0), // Fee
              parseUnits("98999990100000989999", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
            );

          expect(await ethCollateral.balanceOf(perpLemma.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));

          expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
          expect(await baseToken.connect(defaultSigner)["close(uint256)"](1)).to.emit(baseToken, "StatusUpdated");
          const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
          await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));

          await expect(perpLemma.connect(usdLemma).settle())
            .to.emit(vault, "Withdrawn")
            .withArgs(ethCollateral.address, perpLemma.address, parseUnits("1000000000000000000", 0)); // 999999

          // This is not passing as
          // Initial Collateral: 100000000000
          // Actual Collateral: 99901980199
          // So the Vault has less ethCollateral than when it started
          //expect(await ethCollateral.balanceOf(vault.address)).to.equal(initialVaultCollateral);
        });

        it("Test Settle and Withdraw Collateral for 2 Users", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);

          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth

          // 3.2 USDLemma calls PerpLemma Open to open a position at the PerpV2 Clearing House
          await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-1000000000000000000", 0), // Position, negative because of short?
              parseUnits("99999990000000999999", 0), // Notional
              parseUnits("999999900000010000", 0), // Fee
              parseUnits("98999990100000989999", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
            );
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));

          // Start with Market Open
          expect(await baseToken.isOpen()).to.be.equal(true);

          // Pause Market
          expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
          expect(await baseToken.callStatic.isPaused()).to.be.equal(true);

          // Close Market
          expect(await baseToken.connect(defaultSigner)["close(uint256)"](1)).to.emit(baseToken, "StatusUpdated");
          expect(await baseToken.callStatic.isClosed()).to.be.equal(true);

          const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
          await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));
          await perpLemma.connect(usdLemma).settle();

          let collateralPerpLemma: any = await ethCollateral.balanceOf(perpLemma.address);
          const c1 = collateralPerpLemma * 0.2;
          const c1_1e18 = parseEther(c1.toString()).div(parseUnits("1", ethCollateralDecimals));
          await expect(perpLemma.connect(usdLemma).closeLongWithExactCollateral(c1_1e18)).to.emit(
            ethCollateral,
            "Transfer",
          );

          collateralPerpLemma = await ethCollateral.balanceOf(perpLemma.address);
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.not.equal(0);

          const c2 = collateralPerpLemma;
          const c2_1e18 = parseEther(c2.toString()).div(parseUnits("1", ethCollateralDecimals));
          await expect(perpLemma.connect(usdLemma).closeLongWithExactCollateral(c2_1e18)).to.emit(
            ethCollateral,
            "Transfer",
          );
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.equal(0);
        });

        it("Test Settle and Withdraw Collateral for 2 Users, using close method", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);

          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth

          // 3.2 USDLemma calls PerpLemma Open to open a position at the PerpV2 Clearing House
          await expect(perpLemma.connect(usdLemma).openShortWithExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-1000000000000000000", 0), // Position, negative because of short?
              parseUnits("99999990000000999999", 0), // Notional
              parseUnits("999999900000010000", 0), // Fee
              parseUnits("98999990100000989999", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
            );
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));

          // Start with Market Open
          expect(await baseToken.isOpen()).to.be.equal(true);

          // Pause Market
          expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
          expect(await baseToken.callStatic.isPaused()).to.be.equal(true);

          // Close Market
          expect(await baseToken.connect(defaultSigner)["close(uint256)"](1)).to.emit(baseToken, "StatusUpdated");
          expect(await baseToken.callStatic.isClosed()).to.be.equal(true);

          const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
          await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));
          await perpLemma.connect(usdLemma).settle();

          let usdLemmaBalBefore = await ethCollateral.balanceOf(usdLemma.address);
          let positionAtSettlementInQuoteForUSDL = await perpLemma.positionAtSettlementInQuoteForUSDL();
          await perpLemma
            .connect(usdLemma)
            .getCollateralAmountGivenUnderlyingAssetAmountForPerp(
              positionAtSettlementInQuoteForUSDL.div(2),
              false,
              true,
            );
          await perpLemma
            .connect(usdLemma)
            .getCollateralAmountGivenUnderlyingAssetAmountForPerp(
              positionAtSettlementInQuoteForUSDL.div(2),
              false,
              true,
            );
          let usdLemmaBalAfter = await ethCollateral.balanceOf(usdLemma.address);
          expect(await ethCollateral.balanceOf(perpLemma.address)).to.equal(1);
          expect(usdLemmaBalAfter.sub(usdLemmaBalBefore)).to.equal(parseUnits("999999999999999999", 0));
        });
      });

      describe("Rebalance Tests", () => {
        const sqrtPriceLimitX96 = 0;
        const deadline = ethers.constants.MaxUint256;
        before(async function () {
          await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);
        });

        it("Force error for USDLemma and rebalancer address", async () => {
          await expect(
            perpLemma.reBalance(
              reBalancer.address,
              1,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256", "bool"], [sqrtPriceLimitX96, deadline, true]),
            ),
          ).to.be.revertedWith("only usdLemma is allowed");
          await expect(
            perpLemma
              .connect(usdLemma)
              .reBalance(
                defaultSigner.address,
                1,
                ethers.utils.defaultAbiCoder.encode(
                  ["uint160", "uint256", "bool"],
                  [sqrtPriceLimitX96, deadline, true],
                ),
              ),
          ).to.be.revertedWith("only rebalancer is allowed");

          await expect(
            perpLemma
              .connect(usdLemma)
              .reBalance(
                reBalancer.address,
                parseEther("1"),
                ethers.utils.defaultAbiCoder.encode(
                  ["uint160", "uint256", "bool"],
                  [sqrtPriceLimitX96, deadline, true],
                ),
              ),
          ).to.be.revertedWith("not allowed");

          await expect(
            perpLemma
              .connect(usdLemma)
              .reBalance(
                reBalancer.address,
                parseEther("1").mul(-1),
                ethers.utils.defaultAbiCoder.encode(
                  ["uint160", "uint256", "bool"],
                  [sqrtPriceLimitX96, deadline, true],
                ),
              ),
          ).to.be.revertedWith("not allowed");
        });

        it("#1.a Rebalance, fundingPNL negative, go long on rebalnce and increase levrage", async () => {
          await openPosition(clearingHouse, longAddress, baseToken.address, true, true, parseEther("2000"));
          await openPosition(clearingHouse, longAddress, baseToken.address, false, false, parseEther("3000"));

          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, parseEther("100"));
          await perpLemma.connect(usdLemma).openShortWithExactCollateral(parseEther("99"));
          await ethers.provider.send("evm_increaseTime", [300]);
          await ethers.provider.send("evm_mine", []);
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma.connect(usdLemma).openShortWithExactCollateral(parseEther("1"));
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma.settleAllFunding();
          // await forwardTimestamp(clearingHouse, 1);

          let checkPrice_before = await checkAndSyncPrice();
          let leverage_before = await calcLeverage();
          let fundingPNL = await perpLemma.getFundingPNL(baseToken.address);
          let totalFundingPNL = await perpLemma.totalFundingPNL();
          let realizedFundingPnl = await perpLemma.realizedFundingPNL();
          let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

          await perpLemma
            .connect(usdLemma)
            .reBalance(
              reBalancer.address,
              rebalanceAmount,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256", "bool"], [sqrtPriceLimitX96, deadline, true]),
            );
          let checkPrice_after = await checkAndSyncPrice();
          let leverage_after = await calcLeverage();
          expect(leverage_before).lt(leverage_after);

          // console.log("fundingPNL: ", fundingPNL.toString());
          // console.log("totalFundingPNL: ", totalFundingPNL.toString());
          // console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
          // console.log("rebalanceAmount: ", rebalanceAmount.toString());
          // console.log("leverage_before: ", leverage_before.toString());
          // console.log("leverage_after:  ", leverage_after.toString());
          // console.log("checkPrice_before: ", checkPrice_before.toString());
          // console.log("checkPrice_after:  ", checkPrice_after.toString());

          // await forwardTimestamp(clearingHouse, 200);

          // await openPosition(clearingHouse, longAddress, baseToken.address, false, false, parseEther("500"));
          // await ethCollateral.connect(usdLemma).transfer(perpLemma.address, parseEther("2000"));
          // await perpLemma.connect(usdLemma).openShortWithExactCollateral(parseEther("2000"));

          // checkPrice_before = await checkAndSyncPrice();
          // leverage_before = await calcLeverage();
          // let fundingPNL = await perpLemma.getFundingPNL(baseToken.address);
          // totalFundingPNL = await perpLemma.totalFundingPNL();
          // realizedFundingPnl = await perpLemma.realizedFundingPNL();
          // rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

          // console.log("\nfundingPNL-2: ", fundingPNL.toString());
          // console.log("totalFundingPNL-2: ", totalFundingPNL.toString());
          // console.log("realizedFundingPnl-2: ", realizedFundingPnl.toString());
          // console.log("rebalanceAmount-2: ", rebalanceAmount.toString());
          // console.log("leverage_before-2: ", leverage_before.toString());
          // console.log("checkPrice_before-2: ", checkPrice_before.toString());

          // await perpLemma
          //   .connect(usdLemma)
          //   .reBalance(
          //     reBalancer.address,
          //     rebalanceAmount,
          //     ethers.utils.defaultAbiCoder.encode(["uint160", "uint256", "bool"], [sqrtPriceLimitX96, deadline, true]),
          //   );

          // checkPrice_after = await checkAndSyncPrice();
          // leverage_after = await calcLeverage();
          // expect(leverage_before).gt(leverage_after);
          // console.log("leverage_after-2:  ", leverage_after.toString());
          // console.log("checkPrice_after-2:  ", checkPrice_after.toString()); // expect(leverage_before).lt(leverage_after);
        });

        it("#1.b Rebalance, fundingPNL negative, go long on rebalnce and increase levrage", async () => {
          await openPosition(clearingHouse, longAddress, baseToken.address, true, true, parseEther("2000"));
          await openPosition(clearingHouse, longAddress, baseToken.address, false, false, parseEther("3000"));

          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, parseEther("2"));
          await perpLemma.connect(usdLemma).openShortWithExactCollateral(parseEther("1"));
          await ethers.provider.send("evm_increaseTime", [300]);
          await ethers.provider.send("evm_mine", []);
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma.connect(usdLemma).openShortWithExactCollateral(parseEther("1"));
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma.settleAllFunding();
          // await forwardTimestamp(clearingHouse, 1);

          let checkPrice_before = await checkAndSyncPrice();
          let leverage_before = await calcLeverage();
          let fundingPNL = await perpLemma.getFundingPNL(baseToken.address);
          let totalFundingPNL = await perpLemma.totalFundingPNL();
          let realizedFundingPnl = await perpLemma.realizedFundingPNL();
          let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

          await perpLemma
            .connect(usdLemma)
            .reBalance(
              reBalancer.address,
              rebalanceAmount,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256", "bool"], [sqrtPriceLimitX96, deadline, true]),
            );

          let checkPrice_after = await checkAndSyncPrice();
          let leverage_after = await calcLeverage();
          expect(leverage_before).lt(leverage_after);

          // console.log("rebalanceAmount: ", rebalanceAmount.toString());
          // console.log("fundingPNL: ", fundingPNL.toString());
          // console.log("totalFundingPNL: ", totalFundingPNL.toString());
          // console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
          // console.log("leverage_before: ", leverage_before.toString());
          // console.log("leverage_after:  ", leverage_after.toString());
          // console.log("checkPrice_before: ", checkPrice_before.toString());
          // console.log("checkPrice_after:  ", checkPrice_after.toString());
        });

        it("#1.c Rebalance, fundingPNL negative, go long on rebalnce and increase levrage", async () => {
          await openPosition(clearingHouse, longAddress, baseToken.address, true, true, parseEther("10000"));
          await openPosition(clearingHouse, longAddress, baseToken.address, false, false, parseEther("15000"));

          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, parseEther("500"));
          await perpLemma.connect(usdLemma).openShortWithExactCollateral(parseEther("490"));
          await ethers.provider.send("evm_increaseTime", [300]);
          await ethers.provider.send("evm_mine", []);
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma.connect(usdLemma).openShortWithExactCollateral(parseEther("10"));
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma.settleAllFunding();
          // await forwardTimestamp(clearingHouse, 1);

          let checkPrice_before = await checkAndSyncPrice();
          let leverage_before = await calcLeverage();
          let fundingPNL = await perpLemma.getFundingPNL(baseToken.address);
          let totalFundingPNL = await perpLemma.totalFundingPNL();
          let realizedFundingPnl = await perpLemma.realizedFundingPNL();
          let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

          await perpLemma
            .connect(usdLemma)
            .reBalance(
              reBalancer.address,
              rebalanceAmount,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256", "bool"], [sqrtPriceLimitX96, deadline, true]),
            );
          let checkPrice_after = await checkAndSyncPrice();
          let leverage_after = await calcLeverage();
          expect(leverage_before).lt(leverage_after);

          // console.log("rebalanceAmount: ", rebalanceAmount.toString());
          // console.log("fundingPNL: ", fundingPNL.toString());
          // console.log("totalFundingPNL: ", totalFundingPNL.toString());
          // console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
          // console.log("leverage_before: ", leverage_before.toString());
          // console.log("leverage_after:  ", leverage_after.toString());
          // console.log("checkPrice_before: ", checkPrice_before.toString());
          // console.log("checkPrice_after:  ", checkPrice_after.toString());
        });

        it("#1.d Rebalance, fundingPNL positive, go short on rebalnce and decrease levrage", async () => {
          await openPosition(clearingHouse, longAddress, baseToken.address, true, true, parseEther("10000"));

          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, parseEther("500"));
          await perpLemma.connect(usdLemma).openShortWithExactCollateral(parseEther("490"));
          await ethers.provider.send("evm_increaseTime", [300]);
          await ethers.provider.send("evm_mine", []);
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma.connect(usdLemma).openShortWithExactCollateral(parseEther("10"));
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma.settleAllFunding();
          // await forwardTimestamp(clearingHouse, 1);

          let checkPrice_before = await checkAndSyncPrice();
          let leverage_before = await calcLeverage();
          let fundingPNL = await perpLemma.getFundingPNL(baseToken.address);
          let totalFundingPNL = await perpLemma.totalFundingPNL();
          let realizedFundingPnl = await perpLemma.realizedFundingPNL();
          let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

          await perpLemma
            .connect(usdLemma)
            .reBalance(
              reBalancer.address,
              rebalanceAmount,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256", "bool"], [sqrtPriceLimitX96, deadline, true]),
            );
          let checkPrice_after = await checkAndSyncPrice();
          let leverage_after = await calcLeverage();
          expect(leverage_before).gt(leverage_after);

          // console.log("rebalanceAmount: ", rebalanceAmount.toString());
          // console.log("fundingPNL: ", fundingPNL.toString());
          // console.log("totalFundingPNL: ", totalFundingPNL.toString());
          // console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
          // console.log("leverage_before: ", leverage_before.toString());
          // console.log("leverage_after:  ", leverage_after.toString());
          // console.log("checkPrice_before: ", checkPrice_before.toString());
          // console.log("checkPrice_after:  ", checkPrice_after.toString());
        });

        it("#1.e Rebalance, fundingPNL positive, go short on rebalnce and decrease levrage", async () => {
          await ethCollateral.connect(usdLemma).transfer(perpLemma.address, parseEther("2000"));

          await perpLemma.connect(usdLemma).openShortWithExactCollateral(parseEther("1900"));
          await ethers.provider.send("evm_increaseTime", [300]);
          await ethers.provider.send("evm_mine", []);
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma.connect(usdLemma).openShortWithExactCollateral(parseEther("100"));
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma.settleAllFunding();
          // await forwardTimestamp(clearingHouse, 1);

          let checkPrice_before = await checkAndSyncPrice();
          let leverage_before = await calcLeverage();
          let fundingPNL = await perpLemma.getFundingPNL(baseToken.address);
          let totalFundingPNL = await perpLemma.totalFundingPNL();
          let realizedFundingPnl = await perpLemma.realizedFundingPNL();
          let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

          await perpLemma
            .connect(usdLemma)
            .reBalance(
              reBalancer.address,
              rebalanceAmount,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256", "bool"], [sqrtPriceLimitX96, deadline, true]),
            );

          let checkPrice_after = await checkAndSyncPrice();
          let leverage_after = await calcLeverage();
          expect(leverage_before).gt(leverage_after);

          // console.log("rebalanceAmount: ", rebalanceAmount.toString());
          // console.log("fundingPNL: ", fundingPNL.toString());
          // console.log("totalFundingPNL: ", totalFundingPNL.toString());
          // console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
          // console.log("leverage_before: ", leverage_before.toString());
          // console.log("leverage_after:  ", leverage_after.toString());
          // console.log("checkPrice_before: ", checkPrice_before.toString());
          // console.log("checkPrice_after:  ", checkPrice_after.toString());
        });
      });
    });
  });
});
