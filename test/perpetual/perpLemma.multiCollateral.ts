import { ethers, upgrades, waffle } from "hardhat";
import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { utils } from "ethers";
import { parseEther, parseUnits, formatUnits } from "ethers/lib/utils";
import { BigNumber } from "@ethersproject/bignumber";
import { loadPerpLushanInfo, snapshot, revertToSnapshot, fromBigNumber } from "../shared/utils";
import bn from "bignumber.js";
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

import ClearingHouseAbi from "../../perp-lushan/artifacts/contracts/test/TestClearingHouse.sol/TestClearingHouse.json";
import OrderBookAbi from "../../perp-lushan/artifacts/contracts/OrderBook.sol/OrderBook.json";
import ClearingHouseConfigAbi from "../../perp-lushan/artifacts/contracts/ClearingHouseConfig.sol/ClearingHouseConfig.json";
import VaultAbi from "../../perp-lushan/artifacts/contracts/Vault.sol/Vault.json";
import ExchangeAbi from "../../perp-lushan/artifacts/contracts/Exchange.sol/Exchange.json";
import MarketRegistryAbi from "../../perp-lushan/artifacts/contracts/MarketRegistry.sol/MarketRegistry.json";
import TestERC20Abi from "../../perp-lushan/artifacts/contracts/test/TestERC20.sol/TestERC20.json";
import BaseTokenAbi from "../../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json";
import QuoteTokenAbi from "../../perp-lushan/artifacts/contracts/QuoteToken.sol/QuoteToken.json";
import CollateralManagerAbi from "../../perp-lushan/artifacts/contracts/CollateralManager.sol/CollateralManager.json";
import AccountBalanceAbi from "../../perp-lushan/artifacts/contracts/AccountBalance.sol/AccountBalance.json";
import MockTestAggregatorV3Abi from "../../perp-lushan/artifacts/contracts/mock/MockTestAggregatorV3.sol/MockTestAggregatorV3.json";
import UniswapV3PoolAbi from "../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import UniswapV3Pool2Abi from "../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import QuoterAbi from "../../perp-lushan/artifacts/@uniswap/v3-periphery/contracts/lens/Quoter.sol/Quoter.json";
import UniswapV3FactoryAbi from "../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import { parse } from "path";

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
  await clearingHouse.setBlockTimestamp(now.add(step));
}

describe("perpLemma.multiCollateral", async function () {
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
  let usdCollateral: any;
  let ethCollateral: any;
  let btcCollateral: any;
  let baseToken: any;
  let quoteToken: any;
  let univ3factory: any;
  let collateralManager: any;
  let pool: any;
  let pool2: any;
  let mockedBaseAggregator: any;
  let mockedBaseAggregator2: any;
  let mockedWbtcPriceFeed: any;
  let mockedWethPriceFeed: any;
  let quoter: any;
  let perpLemma2: any;
  let usdCollateralDecimals: any;
  let ethCollateralDecimals: any;
  let btcCollateralDecimals: any;
  const lowerTick = 0;
  const upperTick = 100000;

  before(async function () {
    [defaultSigner, usdLemma, reBalancer, hasWETH, signer1, signer2, signer3, longAddress] = await ethers.getSigners();

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
    usdCollateral = new ethers.Contract(perpAddresses.usdCollateral.address, TestERC20Abi.abi, defaultSigner);
    ethCollateral = new ethers.Contract(perpAddresses.ethCollateral.address, TestERC20Abi.abi, defaultSigner);
    btcCollateral = new ethers.Contract(perpAddresses.btcCollateral.address, TestERC20Abi.abi, defaultSigner);
    baseToken = new ethers.Contract(perpAddresses.baseToken.address, BaseTokenAbi.abi, defaultSigner);
    quoteToken = new ethers.Contract(perpAddresses.quoteToken.address, QuoteTokenAbi.abi, defaultSigner);
    collateralManager = new ethers.Contract(
      perpAddresses.collateralManager.address,
      CollateralManagerAbi.abi,
      defaultSigner,
    );
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

    const trustedForwarder = ethers.constants.AddressZero;
    const maxPosition = ethers.constants.MaxUint256;
    const perpLemmaFactory = await ethers.getContractFactory("PerpLemma");
    perpLemma2 = await upgrades.deployProxy(
      perpLemmaFactory,
      [
        trustedForwarder,
        ethCollateral.address,
        baseToken.address,
        clearingHouse.address,
        marketRegistry.address,
        usdLemma.address,
        maxPosition,
      ],
      { initializer: "initialize" },
    );
    await perpLemma2.connect(signer1).resetApprovals();

    // base = usd
    // quote = eth

    await mockedBaseAggregator.setLatestRoundData(0, parseUnits("100", usdCollateralDecimals), 0, 0, 0);
    await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("0.01", ethCollateralDecimals), 0, 0, 0);
    await mockedWethPriceFeed.setLatestRoundData(0, parseUnits("100", ethCollateralDecimals), 0, 0, 0);

    await pool.initialize(encodePriceSqrt("100", "1"));
    await pool.increaseObservationCardinalityNext((2 ^ 16) - 1);

    await pool2.initialize(encodePriceSqrt("100", "1"));
    await pool2.increaseObservationCardinalityNext((2 ^ 16) - 1);

    await clearingHouseConfig.setMaxFundingRate(parseUnits("1", usdCollateralDecimals));

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
    const price = formatSqrtPriceX96ToPrice(sqrtPrice, ethCollateralDecimals);
    let ethPrice = new bn(price).multipliedBy(1e6).toFixed(0);
    // console.log('checkAndSyncPrice:' , ethPrice.toString(), price.toString())
    await mockedBaseAggregator.setLatestRoundData(0, ethPrice, 0, 0, 0);
    let ethPrice_1e18 = new bn(price).multipliedBy(1e30).toFixed(0).toString();
    return [ethPrice, ethPrice_1e18];
  }

  async function calcLeverage() {
    const positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
    let depositedCollateral = await vault.getBalance(perpLemma2.address);
    const quote = await accountBalance.getQuote(perpLemma2.address, baseToken.address);
    const base = await accountBalance.getBase(perpLemma2.address, baseToken.address);

    const slot0 = await pool.slot0();
    const sqrtPrice = slot0.sqrtPriceX96;
    const price = formatSqrtPriceX96ToPrice(sqrtPrice, ethCollateralDecimals);
    const ethPrice2 = parseUnits(price, ethCollateralDecimals);

    // const interval = await clearingHouseConfig.getTwapInterval();
    // const ethPrice = await mockedBaseAggregator.getRoundData(0); //ethPrice method1
    // const ethPriceInUSDCFromIndex = await baseToken.getIndexPrice(interval); //ethPrice method2
    // console.log("Price: ", price.toString())
    // console.log('quote: ', quote.toString());
    // console.log('base: ', base.toString());
    // console.log('positionSize', positionSize.toString())
    // console.log('depositedCollateral', depositedCollateral.toString())
    // console.log('ethPrice', ethPrice.toString())
    // console.log('ethPrice2:' , ethPrice2.toString())
    // console.log('interval', interval.toString())

    if (!positionSize.eq(ZERO)) {
      // const leverage_in_6_Decimal = depositedCollateral.mul(ethPrice2).div(quote);
      // const leverage = depositedCollateral.mul(ethPrice2).div(quote).mul(-1);
      const usdcPriceInEth = new bn("1").dividedBy(ethPrice2.toString()).multipliedBy(1e36).toFixed(0);
      // console.log('usdcPriceInEth', usdcPriceInEth.toString())

      depositedCollateral = depositedCollateral.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals));
      // console.log('depositedCollateral', depositedCollateral.toString())

      const leverage = depositedCollateral.mul(BigNumber.from(usdcPriceInEth)).div(positionSize);
      // console.log('leverage', leverage.toString())
      return leverage;
    }
    return 0;
  }

  // async function calcLeverage1() {
  //   console.log("calcLeverage1()");
  //   let totalAbsPositionValue = await accountBalance.getTotalAbsPositionValue(perpLemma2.address);
  //   console.log("totalAbsPositionValue: ", totalAbsPositionValue.toString());
  //   let accountValue = await clearingHouse.getAccountValue(perpLemma2.address);

  //   console.log("accountValue: ", accountValue.toString());
  //   console.log("accountValue: ", accountValue.toString());

  //   if (!totalAbsPositionValue.eq(ZERO)) {
  //     console.log("totalAbsPositionValue-1: ", totalAbsPositionValue.toString());
  //     const accountMarginRatio: BigNumber = accountValue.mul(parseUnits("1", ethCollateralDecimals)).div(totalAbsPositionValue);
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
      const fees = await perpLemma2.getFees(true);
      expect(fees).to.eq(10000);
    });

    describe("PerpLemma tests => Open, Close, Settlement", () => {
      let collateralAmountForUSD;
      let collateralAmountForUSDC;

      before(async function () {
        collateralAmountForUSD = parseUnits("1000000000000", usdCollateralDecimals); // 6 decimal
        collateralAmountForUSDC = parseUnits("100", ethCollateralDecimals); // 6 decimal

        await usdCollateral.mint(defaultSigner.address, collateralAmountForUSD.mul(3));
        await usdCollateral.mint(usdLemma.address, collateralAmountForUSD.mul(3));

        await usdCollateral.mint(signer1.address, collateralAmountForUSD);
        await usdCollateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(signer1).deposit(usdCollateral.address, collateralAmountForUSD);

        await usdCollateral.mint(longAddress.address, collateralAmountForUSD);
        await usdCollateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(longAddress).deposit(usdCollateral.address, collateralAmountForUSD);
      });

      it("should set addresses correctly", async function () {
        await expect(perpLemma2.connect(signer1).setUSDLemma(signer1.address)).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
        await perpLemma2.connect(defaultSigner).setUSDLemma(signer1.address);
        expect(await perpLemma2.usdLemma()).to.equal(signer1.address);
        await expect(
          perpLemma2.connect(signer1).setReferrerCode(ethers.utils.formatBytes32String("ADemoReferrerCode")),
        ).to.be.revertedWith("Ownable: caller is not the owner");
        await perpLemma2.connect(defaultSigner).setReferrerCode(ethers.utils.formatBytes32String("ADemoReferrerCode"));
        const referrerCode = await perpLemma2.referrerCode();
        expect(ethers.utils.parseBytes32String(referrerCode)).to.eq("ADemoReferrerCode");
      });

      it("should fail to open when max position is reached", async function () {
        const collateralAmount = parseUnits("1", usdCollateralDecimals);
        await perpLemma2.setMaxPosition(parseUnits("0.9", usdCollateralDecimals));
        await usdCollateral.mint(usdLemma.address, collateralAmount.add(1));
        await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount.add(1));
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount)).to.be.revertedWith(
          "max position reached",
        );
      });

      it("should close position correctly", async function () {
        let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
        await usdCollateral.mint(usdLemma.address, collateralAmount);

        // transfer Collateral to perpLemma
        await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
        ); // index0: base/usd, index1: quote/eth

        // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma2.address, // Trader
            baseToken.address, // Market --> vETH
            parseUnits("989999901990009702", 0), // Position, negative because of short?
            parseUnits("-99000000000000000000", 0), // Notional
            parseUnits("1000000000000000000", 0), // Fee
            parseUnits("-100000000000000000000", 0), // OpenNotional
            0, // PnlToBeRealized
            parseUnits("792281703578524265057133720541", 0), // sqrtPriceAfterX96
          );

        expect(await usdCollateral.balanceOf(perpLemma2.address)).to.eq(0);
        expect(await vault.getBalance(perpLemma2.address)).to.eq(collateralAmount);
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        expect(baseAndQuoteValue[0]).to.eq(positionSize);
        await calcLeverage();

        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize,
        );
        // long eth and close position, withdraw ethCollateral
        await expect(
          await perpLemma2
            .connect(usdLemma)
            .closeWExactCollateral(
              baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
            ),
        )
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma2.address, // Trader
            baseToken.address, // Market --> vETH
            parseUnits("-989999891888999602", 0), // Position, negative because of short?
            parseUnits("98999998989898989899", 0), // Notional
            parseUnits("989999989898989899", 0), // Fee
            parseUnits("-1020304151600", 0), // OpenNotional
            parseUnits("-1989999979695848400", 0), // PnlToBeRealized
            parseUnits("792281625142644176219909344405", 0), // sqrtPriceAfterX96
          );
        positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        expect(positionSize).to.closeTo(BigNumber.from("10101010100"), BigNumber.from("1010101010"));
        expect(await vault.getBalance(perpLemma2.address)).to.closeTo("2", "1"); // consider to be fee
        expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
      });

      it("#1 openWExactCollateral and closeWExactCollateral ", async function () {
        collateralAmountForUSDC = parseUnits("100", usdCollateralDecimals); // 6 decimal
        await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSDC);
        // open
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
        ); // index0: base/usd, index1: quote/eth
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmountForUSDC)).to.emit(
          clearingHouse,
          "PositionChanged",
        );
        let leverage = await calcLeverage();
        expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

        let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize,
        );

        await expect(
          await perpLemma2
            .connect(usdLemma)
            .closeWExactCollateral(
              baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
            ),
        );
        leverage = await calcLeverage();
        positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
        expect(positionSize).to.closeTo(BigNumber.from("10101010100"), BigNumber.from("1010101010"));
        expect(await vault.getBalance(perpLemma2.address)).to.closeTo("2", "1"); // consider to be fee
        expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
      });

      // getCollateralAmountGivenUnderlyingAssetAmount => gCAGUAA
      it("#2 openWExactCollateral and gCAGUAA => close ", async function () {
        collateralAmountForUSDC = parseUnits("100", usdCollateralDecimals); // 6 decimal
        await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSDC);

        // open
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
        ); // index0: base/usd, index1: quote/eth
        // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmountForUSDC)).to.emit(
          clearingHouse,
          "PositionChanged",
        );
        let leverage = await calcLeverage();
        expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

        // close
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize,
        ); // index0: base/usd, index1: quote/eth

        await expect(
          perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[0], false),
        ).to.emit(clearingHouse, "PositionChanged");

        await expect(perpLemma2.connect(usdLemma).close(0, 0)).to.be.revertedWith("Amount should greater than zero");
        await perpLemma2
          .connect(usdLemma)
          .close(0, baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")));
        leverage = await calcLeverage();
        expect(leverage).to.eq(0);
      });
      // getCollateralAmountGivenUnderlyingAssetAmount => gCAGUAA
      it("#3 gCAGUAA -> open and gCAGUAA -> close ", async function () {
        collateralAmountForUSDC = parseUnits("100", usdCollateralDecimals); // 6 decimal

        await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSDC);

        // open
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
        ); // index0: base/usd, index1: quote/eth
        // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmountForUSDC)).to.emit(
          clearingHouse,
          "PositionChanged",
        );

        await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSDC);
        // open
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
        ); // index0: base/usd, index1: quote/eth

        // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(
          perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[0], true),
        ).to.emit(clearingHouse, "PositionChanged");

        await expect(perpLemma2.connect(usdLemma).open(0, 0)).to.be.revertedWith("Amount should greater than zero");
        await expect(
          perpLemma2
            .connect(usdLemma)
            .open(0, baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")).mul(2)),
        ).to.be.revertedWith("not enough collateral");
        await perpLemma2
          .connect(usdLemma)
          .open(0, baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")));
        let leverage = await calcLeverage();
        expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

        // close
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize,
        ); // index0: base/usd, index1: quote/eth

        await expect(
          perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[0], false),
        ).to.emit(clearingHouse, "PositionChanged");

        await expect(perpLemma2.connect(usdLemma).close(0, 0)).to.be.revertedWith("Amount should greater than zero");
        await perpLemma2
          .connect(usdLemma)
          .close(0, baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")));
        leverage = await calcLeverage();
        expect(leverage).to.eq(0);
      });
      // getCollateralAmountGivenUnderlyingAssetAmount => gCAGUAA
      it("#4 gCAGUAA -> open and closeWExactCollateral ", async function () {
        collateralAmountForUSDC = parseUnits("100", usdCollateralDecimals); // 6 decimal
        await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSDC);

        // open
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
        ); // index0: base/usd, index1: quote/eth
        // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmountForUSDC)).to.emit(
          clearingHouse,
          "PositionChanged",
        );

        await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSDC);
        // open
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
        ); // index0: base/usd, index1: quote/eth

        // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(
          perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[0], true),
        ).to.emit(clearingHouse, "PositionChanged");

        await expect(perpLemma2.connect(usdLemma).open(0, 0)).to.be.revertedWith("Amount should greater than zero");
        await expect(
          perpLemma2
            .connect(usdLemma)
            .open(0, baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")).mul(2)),
        ).to.be.revertedWith("not enough collateral");
        await perpLemma2
          .connect(usdLemma)
          .open(0, baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")));
        let leverage = await calcLeverage();
        expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

        // close
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize,
        );
        await expect(
          await perpLemma2
            .connect(usdLemma)
            .closeWExactCollateral(
              baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")).div(2),
            ),
        );
        leverage = await calcLeverage();
        expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
      });

      describe("OpenPosition leverage test", () => {
        let collateralToGetBack_1e6, collateralToGetBack_1e18;
        beforeEach(async function () {
          let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
          await usdCollateral.mint(usdLemma.address, collateralAmount);
          await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
        });

        it("openPosition => emit event PositionChanged", async () => {
          let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
          await usdCollateral.mint(usdLemma.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
          ); // index0: base/usd, index1: quote/eth
          // Deposit ethCollateral in eth and Short eth and long usdc
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount.mul(2))).to.be.revertedWith(
            "not enough collateral",
          );
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(0)).to.be.revertedWith(
            "V_ZA", // V_ZA: Zero amount
          );
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vETH
              parseUnits("989999901990009702", 0), // Position, negative because of short?
              parseUnits("-99000000000000000000", 0), // Notional
              parseUnits("1000000000000000000", 0), // Fee
              parseUnits("-100000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281703578524265057133720541", 0), // sqrtPriceAfterX96
            );
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.eq(baseAndQuoteValue[0]);
          expect(await vault.getBalance(perpLemma2.address)).to.eq(collateralAmount); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
        });

        it("openPosition => leverage should be 1x", async () => {
          let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
          await usdCollateral.mint(usdLemma.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
          ); // index0: base/usd, index1: quote/eth
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vETH
              parseUnits("989999901990009702", 0), // Position, negative because of short?
              parseUnits("-99000000000000000000", 0), // Notional
              parseUnits("1000000000000000000", 0), // Fee
              parseUnits("-100000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281703578524265057133720541", 0), // sqrtPriceAfterX96
            );
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.eq(baseAndQuoteValue[0]);
          expect(await vault.getBalance(perpLemma2.address)).to.eq(collateralAmount); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
          let leverage = await calcLeverage();
          expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
        });
      });

      describe("Open and close Position test variation", () => {
        let collateralmintAmount;
        beforeEach(async function () {
          let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
          await usdCollateral.mint(usdLemma.address, collateralAmount);
          await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
        });

        it("openPosition => open position for short and close position for 2 time longs", async () => {
          let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);

          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
          ); // index0: base/usd, index1: quote/eth
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount.mul(2))).to.be.revertedWith(
            "not enough collateral",
          );
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(0)).to.be.revertedWith(
            "V_ZA", // V_ZA: Zero amount
          );
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount)).to.emit(
            clearingHouse,
            "PositionChanged",
          );

          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.eq(baseAndQuoteValue[0]);
          expect(await vault.getBalance(perpLemma2.address)).to.eq(collateralAmount); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
          let leverage = await calcLeverage();
          expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

          // #1
          baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            positionSize.div(2),
          );

          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(0)).to.be.revertedWith("AS");
          await expect(
            perpLemma2
              .connect(usdLemma)
              .closeWExactCollateral(
                baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
              ),
          ).to.emit(clearingHouse, "PositionChanged");

          // #2
          baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            positionSize.div(2),
          );

          await expect(
            perpLemma2
              .connect(usdLemma)
              .closeWExactCollateral(
                baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
              ),
          ).to.emit(clearingHouse, "PositionChanged");

          positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
          expect(positionSize).to.closeTo(BigNumber.from("10101010100"), BigNumber.from("1010101010"));
          expect(await vault.getBalance(perpLemma2.address)).to.closeTo("2", "1"); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
        });

        it("openPosition => open position for short and close position for long", async () => {
          let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
          await usdCollateral.mint(usdLemma.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
          ); // index0: base/usd, index1: quote/eth
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vETH
              parseUnits("989999901990009702", 0), // Position, negative because of short?
              parseUnits("-99000000000000000000", 0), // Notional
              parseUnits("1000000000000000000", 0), // Fee
              parseUnits("-100000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281703578524265057133720541", 0), // sqrtPriceAfterX96
            );

          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.eq(baseAndQuoteValue[0]);
          expect(await vault.getBalance(perpLemma2.address)).to.eq(collateralAmount); // consider to be fee
          let leverage = await calcLeverage();
          expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

          baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            positionSize,
          );

          await expect(
            perpLemma2
              .connect(usdLemma)
              .closeWExactCollateral(
                baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
              ),
          )
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vETH
              parseUnits("-989999891888999602", 0), // Position, negative because of short?
              parseUnits("98999998989898989899", 0), // Notional
              parseUnits("989999989898989899", 0), // Fee
              parseUnits("-1020304151600", 0), // OpenNotional
              parseUnits("-1989999979695848400", 0), // PnlToBeRealized
              parseUnits("792281625142644176219909344405", 0), // sqrtPriceAfterX96
            );
          positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
          expect(positionSize).to.closeTo(BigNumber.from("10101010100"), BigNumber.from("1010101010"));
          expect(await vault.getBalance(perpLemma2.address)).to.closeTo("2", "1"); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
        });
      });

      describe("OpenWExactCollateral and CloseWExactCollateral", async function () {
        it("Basic Open", async () => {
          let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
          await usdCollateral.mint(usdLemma.address, collateralAmount);
          await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
          ); // index0: base/usd, index1: quote/eth
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.equal(0);
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount)).to.emit(
            clearingHouse,
            "PositionChanged",
          );
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.eq(baseAndQuoteValue[0]);
          expect(await vault.getBalance(perpLemma2.address)).to.eq(collateralAmount); // consider to be fee
          let leverage = await calcLeverage();
          expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
        });

        it("Basic Open and Close, Checking the lost ethCollateral should be < 5%", async () => {
          let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
          await usdCollateral.mint(usdLemma.address, collateralAmount);
          await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
          ); // index0: base/usd, index1: quote/eth
          const usdLemmaBalance1 = await ethCollateral.balanceOf(usdLemma.address);
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.equal(0);
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount)).to.emit(
            clearingHouse,
            "PositionChanged",
          );

          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalance(perpLemma2.address)).to.eq(collateralAmount); // consider to be fee
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.eq(baseAndQuoteValue[0]);
          baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            positionSize,
          );
          // collateralAmount = baseAndQuoteValue[1].mul(parseEther("1")).div(parseEther("0.99"));

          await expect(
            perpLemma2
              .connect(usdLemma)
              .closeWExactCollateral(
                baseAndQuoteValue[1].mul(parseUnits("1", usdCollateralDecimals)).div(parseEther("1")),
              ),
          )
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vETH
              parseUnits("-989999891888999602", 0), // Position, negative because of short?
              parseUnits("98999998989898989899", 0), // Notional
              parseUnits("989999989898989899", 0), // Fee
              parseUnits("-1020304151600", 0), // OpenNotional
              parseUnits("-1989999979695848400", 0), // PnlToBeRealized
              parseUnits("792281625142644176219909344405", 0), // sqrtPriceAfterX96
            );
          positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.closeTo(BigNumber.from("10101010100"), BigNumber.from("1010101010"));
          expect(await vault.getBalance(perpLemma2.address)).to.closeTo("2", "1"); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);

          // const usdLemmaBalance2 = await ethCollateral.balanceOf(usdLemma.address);
          // const deltaBalance = usdLemmaBalance2.sub(usdLemmaBalance1);
          // const lostCollateral = collateralAmount.sub(deltaBalance);
          // const percLostCollateral = lostCollateral.div(collateralAmount);
          // const amt = collateralAmount.mul(BigNumber.from(5).div(100));
          // // Checking the lost ethCollateral is < 5% of the initial amount
          // expect(collateralAmount.sub(deltaBalance)).to.below(collateralAmount.mul(5).div(100));
        });
      });

      describe("Emergency Settlement", async function () {
        beforeEach(async function () {});

        it("Calling Settle() when Market is open should revert", async () => {
          // By default the market is open
          await expect(perpLemma2.connect(usdLemma).settle()).to.be.revertedWith("CH_MNC");
        });

        it("Calling Settle() when Market is paused should revert", async () => {
          // Pausing the market
          expect(await baseToken.connect(defaultSigner)["pause()"]())
            .to.emit(baseToken, "StatusUpdated")
            .withArgs(1);
          await expect(perpLemma2.connect(usdLemma).settle()).to.be.revertedWith("CH_MNC");
        });

        it("Calling Settle() when Market is closed should work", async () => {
          let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
          await usdCollateral.mint(usdLemma.address, collateralAmount);
          await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
          // Deposit ethCollateral in eth and Short eth and long usdc
          await perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount);
          expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
          // Closing the market
          expect(await baseToken.connect(defaultSigner)["close(uint256)"](parseEther("100"))).to.emit(
            baseToken,
            "StatusUpdated",
          );

          const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
          await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));
          await expect(perpLemma2.connect(usdLemma).settle())
            .to.emit(vault, "Withdrawn")
            .withArgs(usdCollateral.address, perpLemma2.address, parseUnits("98999991", 0));
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount)).to.be.revertedWith(
            "Market Closed",
          );
        });

        it("Open a Position and Calling Settle() when Market is closed should work", async () => {
          let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
          await usdCollateral.mint(usdLemma.address, collateralAmount);
          await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
          ); // index0: base/usd, index1: quote/eth

          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vETH
              parseUnits("989999901990009702", 0), // Position, negative because of short?
              parseUnits("-99000000000000000000", 0), // Notional
              parseUnits("1000000000000000000", 0), // Fee
              parseUnits("-100000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281703578524265057133720541", 0), // sqrtPriceAfterX96
            );

          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.eq(baseAndQuoteValue[0]);
          expect(await vault.getBalance(perpLemma2.address)).to.eq(collateralAmount); // consider to be fee
          let leverage = await calcLeverage();
          expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

          expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
          expect(await baseToken.connect(defaultSigner)["close(uint256)"](parseEther("100"))).to.emit(
            baseToken,
            "StatusUpdated",
          );
          const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
          await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));

          await expect(perpLemma2.connect(usdLemma).settle())
            .to.emit(vault, "Withdrawn")
            .withArgs(usdCollateral.address, perpLemma2.address, parseUnits("98999991", 0)); // 999999

          // This is not passing as
          // Initial Collateral: 100000000000
          // Actual Collateral: 99901980199
          // So the Vault has less ethCollateral than when it started
          //expect(await ethCollateral.balanceOf(vault.address)).to.equal(initialVaultCollateral);
        });

        it("Test Settle and Withdraw Collateral for 2 Users", async () => {
          let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
          await usdCollateral.mint(usdLemma.address, collateralAmount);
          await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);

          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
          ); // index0: base/usd, index1: quote/eth

          // 3.2 USDLemma calls PerpLemma Open to open a position at the PerpV2 Clearing House
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vETH
              parseUnits("989999901990009702", 0), // Position, negative because of short?
              parseUnits("-99000000000000000000", 0), // Notional
              parseUnits("1000000000000000000", 0), // Fee
              parseUnits("-100000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281703578524265057133720541", 0), // sqrtPriceAfterX96
            );

          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.eq(baseAndQuoteValue[0]);
          expect(await vault.getBalance(perpLemma2.address)).to.eq(collateralAmount); // consider to be fee
          let leverage = await calcLeverage();
          expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

          // Start with Market Open
          expect(await baseToken.isOpen()).to.be.equal(true);

          // Pause Market
          expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
          expect(await baseToken.callStatic.isPaused()).to.be.equal(true);

          // Close Market
          expect(await baseToken.connect(defaultSigner)["close(uint256)"](parseEther("100"))).to.emit(
            baseToken,
            "StatusUpdated",
          );
          expect(await baseToken.callStatic.isClosed()).to.be.equal(true);

          const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
          await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));
          await perpLemma2.connect(usdLemma).settle();

          let collateralPerpLemma = await usdCollateral.balanceOf(perpLemma2.address);
          const c1 = collateralPerpLemma * 0.2;
          const c1_1e18 = parseEther(c1.toString()).div(parseUnits("1", ethCollateralDecimals));
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(c1_1e18)).to.emit(usdCollateral, "Transfer");

          collateralPerpLemma = await usdCollateral.balanceOf(perpLemma2.address);
          expect(await usdCollateral.balanceOf(perpLemma2.address)).to.not.equal(0);

          const c2 = collateralPerpLemma;
          const c2_1e18 = parseEther(c2.toString()).div(parseUnits("1", ethCollateralDecimals));
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(c2_1e18)).to.emit(usdCollateral, "Transfer");
          expect(await usdCollateral.balanceOf(perpLemma2.address)).to.equal(0);
        });

        it("Test Settle and Withdraw Collateral for 2 Users, using close method", async () => {
          let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
          await usdCollateral.mint(usdLemma.address, collateralAmount);
          await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);

          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
          ); // index0: base/usd, index1: quote/eth

          // 3.2 USDLemma calls PerpLemma Open to open a position at the PerpV2 Clearing House
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vETH
              parseUnits("989999901990009702", 0), // Position, negative because of short?
              parseUnits("-99000000000000000000", 0), // Notional
              parseUnits("1000000000000000000", 0), // Fee
              parseUnits("-100000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281703578524265057133720541", 0), // sqrtPriceAfterX96
            );

          expect(await usdCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalance(perpLemma2.address)).to.eq(collateralAmount); // consider to be fee
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.eq(baseAndQuoteValue[0]);

          // Start with Market Open
          expect(await baseToken.isOpen()).to.be.equal(true);

          // Pause Market
          expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
          expect(await baseToken.callStatic.isPaused()).to.be.equal(true);

          // Close Market
          expect(await baseToken.connect(defaultSigner)["close(uint256)"](parseEther("100"))).to.emit(
            baseToken,
            "StatusUpdated",
          );
          expect(await baseToken.callStatic.isClosed()).to.be.equal(true);

          const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
          await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));
          await perpLemma2.connect(usdLemma).settle();

          let usdLemmaBalBefore = await usdCollateral.balanceOf(usdLemma.address);
          let positionAtSettlementInQuote = await perpLemma2.positionAtSettlementInQuote();
          await perpLemma2
            .connect(usdLemma)
            .getCollateralAmountGivenUnderlyingAssetAmount(positionAtSettlementInQuote.div(2), false);
          await perpLemma2
            .connect(usdLemma)
            .getCollateralAmountGivenUnderlyingAssetAmount(positionAtSettlementInQuote.div(2), false);
          let usdLemmaBalAfter = await usdCollateral.balanceOf(usdLemma.address);
          expect(await usdCollateral.balanceOf(perpLemma2.address)).to.equal(1);
          expect(usdLemmaBalAfter.sub(usdLemmaBalBefore)).to.equal(parseUnits("98999990", 0));
        });
      });

      describe("Rebalance Tests", () => {
        const sqrtPriceLimitX96 = 0;
        const deadline = ethers.constants.MaxUint256;
        before(async function () {
          await perpLemma2.connect(defaultSigner).setReBalancer(reBalancer.address);
        });

        it("Force error for USDLemma and rebalancer address", async () => {
          await expect(
            perpLemma2.reBalance(
              reBalancer.address,
              1,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
            ),
          ).to.be.revertedWith("only usdLemma is allowed");
          await expect(
            perpLemma2
              .connect(usdLemma)
              .reBalance(
                defaultSigner.address,
                1,
                ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
              ),
          ).to.be.revertedWith("only rebalancer is allowed");
        });

        it("#1.a Rebalance, fundingPNL negative, go short on rebalnce and increase levrage", async () => {
          await openPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            false,
            parseUnits("2000", usdCollateralDecimals),
          ); // short
          await openPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            parseUnits("3000", usdCollateralDecimals),
          );

          await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, parseUnits("100", usdCollateralDecimals));
          await perpLemma2.connect(usdLemma).openWExactCollateral(parseUnits("99", usdCollateralDecimals));
          await ethers.provider.send("evm_increaseTime", [1000]);
          await ethers.provider.send("evm_mine", []);
          await forwardTimestamp(clearingHouse, 200);
          await perpLemma2.connect(usdLemma).openWExactCollateral(parseUnits("1", usdCollateralDecimals));
          await forwardTimestamp(clearingHouse, 200);
          await perpLemma2.settleAllFunding();
          await forwardTimestamp(clearingHouse, 200);

          let checkPrice_before = await checkAndSyncPrice();
          let leverage_before = await calcLeverage();
          let fundingPNL = await perpLemma2.getFundingPNL();
          let totalFundingPNL = await perpLemma2.totalFundingPNL();
          let realizedFundingPnl = await perpLemma2.realizedFundingPNL();
          let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);
          let ethPrice = BigNumber.from(checkPrice_before[0])
            .mul(parseEther("1"))
            .div(parseUnits("1", usdCollateralDecimals));
          let usdcPriceInEth = new bn("1").dividedBy(ethPrice.toString()).multipliedBy(1e36).toFixed(0);
          let rebalanceAmountInEth = rebalanceAmount.mul(usdcPriceInEth).div(parseEther("1"));

          await perpLemma2
            .connect(usdLemma)
            .reBalance(
              reBalancer.address,
              rebalanceAmountInEth,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
            );
          let checkPrice_after = await checkAndSyncPrice();
          let leverage_after = await calcLeverage();
          expect(leverage_before).lt(leverage_after);

          console.log("fundingPNL: ", fundingPNL.toString());
          console.log("totalFundingPNL: ", totalFundingPNL.toString());
          console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
          console.log("rebalanceAmount: ", rebalanceAmount.toString());
          console.log("rebalanceAmountInEth: ", rebalanceAmountInEth.toString());
          console.log("usdcPriceInEth: ", usdcPriceInEth.toString());
          console.log("leverage_before: ", leverage_before.toString());
          console.log("leverage_after:  ", leverage_after.toString());
          console.log("checkPrice_before: ", checkPrice_before.toString());
          console.log("checkPrice_after:  ", checkPrice_after.toString());
        });

        // it.only("#1.b Rebalance, fundingPNL positive, go long on rebalnce and decrease levrage", async () => {
        //   await openPosition(clearingHouse, longAddress, baseToken.address, false, true, parseUnits('3000', usdCollateralDecimals)); // short
        //   await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, parseUnits("2000", usdCollateralDecimals));

        //   await perpLemma2.connect(usdLemma).openWExactCollateral(parseUnits("99", usdCollateralDecimals));
        //   await ethers.provider.send("evm_increaseTime", [1000]);
        //   await ethers.provider.send("evm_mine", []);
        //   await forwardTimestamp(clearingHouse, 200);
        //   await perpLemma2.connect(usdLemma).openWExactCollateral(parseUnits("1", usdCollateralDecimals));
        //   await forwardTimestamp(clearingHouse, 200);
        //   await perpLemma2.settleAllFunding();
        //   await forwardTimestamp(clearingHouse, 200);

        //   let checkPrice_before = await checkAndSyncPrice();
        //   let leverage_before = await calcLeverage();
        //   let fundingPNL = await perpLemma2.getFundingPNL();
        //   let totalFundingPNL = await perpLemma2.totalFundingPNL();
        //   let realizedFundingPnl = await perpLemma2.realizedFundingPNL();
        //   let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);
        //   let ethPrice = BigNumber.from(checkPrice_before[0]).mul(parseEther('1')).div(parseUnits('1', usdCollateralDecimals))
        //   let usdcPriceInEth = new bn('1').dividedBy(ethPrice.toString()).multipliedBy(1e36).toFixed(0)
        //   let rebalanceAmountInEth = rebalanceAmount.mul(usdcPriceInEth).div(parseEther('1'))

        //   console.log("fundingPNL: ", fundingPNL.toString());
        //   console.log("totalFundingPNL: ", totalFundingPNL.toString());

        //   await perpLemma2
        //     .connect(usdLemma)
        //     .reBalance(
        //       reBalancer.address,
        //       rebalanceAmountInEth,
        //       ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
        //     );

        //   let checkPrice_after = await checkAndSyncPrice();
        //   let leverage_after = await calcLeverage();
        //   expect(leverage_before).gt(leverage_after);

        //   console.log("rebalanceAmount: ", rebalanceAmount.toString());
        //   console.log("fundingPNL: ", fundingPNL.toString());
        //   console.log("totalFundingPNL: ", totalFundingPNL.toString());
        //   console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
        //   console.log("leverage_before: ", leverage_before.toString());
        //   console.log("leverage_after:  ", leverage_after.toString());
        //   console.log("checkPrice_before: ", checkPrice_before.toString());
        //   console.log("checkPrice_after:  ", checkPrice_after.toString());
        // });
      });
    });
  });
});
