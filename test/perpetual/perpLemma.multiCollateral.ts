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

describe("perpLemma2.multiCollateral", async function () {
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

    const trustedForwarder = ethers.constants.AddressZero;
    const maxPosition = ethers.constants.MaxUint256;
    const perpLemmaFactory = await ethers.getContractFactory("PerpLemma");
    perpLemma2 = await upgrades.deployProxy(
      perpLemmaFactory,
      [
        trustedForwarder,
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
    await perpLemma2.connect(signer1).resetApprovals();

    // base = usd
    // quote = eth

    await mockedBaseAggregator.setLatestRoundData(0, parseUnits("0.01", ethCollateralDecimals), 0, 0, 0);
    await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("100", ethCollateralDecimals), 0, 0, 0);
    await mockedWethPriceFeed.setLatestRoundData(0, parseUnits("100", ethCollateralDecimals), 0, 0, 0);

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
  });

  beforeEach(async function () {
    snapshotId = await snapshot();
  });

  afterEach(async function () {
    // await calcLeverage1();
    await revertToSnapshot(snapshotId);
  });

  async function calcLeverage() {
    console.log('\ncalcLeverage()')
    const positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
    const depositedCollateral = await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address);

    const ethPrice = await mockedBaseAggregator2.getRoundData(0); //ethPrice
    const interval = await clearingHouseConfig.getTwapInterval();

    // method 1 to get usdc price in eth
    const usdcPriceInETHFromIndex = await baseToken.getIndexPrice(interval);

    // console.log('ethPrice: ', ethPrice[1].toString(), interval.toString())
    // console.log('usdcPriceInETHFromIndex: ', usdcPriceInETHFromIndex.toString())
    // console.log('positionSize: ', positionSize.toString())
    // console.log('depositedCollateral: ', depositedCollateral.toString())
    if (!positionSize.eq(ZERO)) {
      const leverage_in_6_Decimal = depositedCollateral.mul(parseUnits("1", 35)).div(positionSize.mul(usdcPriceInETHFromIndex.toString()));
      const leverage_in_1 = depositedCollateral.mul(parseUnits("1", 18)).div(positionSize.mul(usdcPriceInETHFromIndex.toString()));
      console.log('calcLeverage()', leverage_in_6_Decimal.toString(), leverage_in_1.toString())
      console.log('\n');
      return [leverage_in_6_Decimal, leverage_in_1];
    }
    console.log('calcLeverage()-positionSize-zero, 0, 0')
    console.log('\n');
    return [0, 0];
  }

  async function calcLeverage1() {
    console.log('calcLeverage1()')
    let totalAbsPositionValue = await accountBalance.getTotalAbsPositionValue(perpLemma2.address);
    console.log('totalAbsPositionValue: ', totalAbsPositionValue.toString())
    let accountValue = await clearingHouse.getAccountValue(perpLemma2.address);
    console.log('accountValue: ', accountValue.toString())

    if (!totalAbsPositionValue.eq(ZERO)) {
      console.log('totalAbsPositionValue-1: ', totalAbsPositionValue.toString())
      const accountMarginRatio: BigNumber = accountValue.mul(parseUnits("1", 18)).div(totalAbsPositionValue);
      console.log('accountMarginRatio-1: ', formatUnits(accountMarginRatio, BigNumber.from(18)).toString())
      // const leverage: any = BigNumber.from(1).div(formatUnits(accountMarginRatio, BigNumber.from(18)));
      const leverage: any = new bn(1e18).dividedBy(accountMarginRatio.toString())
      console.log('leverage-1: ', leverage.toString())
      console.log("leverage", leverage.toFixed(5));
    }
  }

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
        parseEther("1000000000"), // usdc
        parseEther("10000000"), // eth
        -887200,
        887200,
      );
    });

    function formatSqrtPriceX96ToPrice(value: BigNumber, decimals: number = 18): string {
      return bigNumberToBig(value, 0).div(new bn(2).pow(96)).pow(2).dp(decimals).toString()
    }

    function bigNumberToBig(val: BigNumber, decimals: number = 18): bn {
      return new bn(val.toString()).div(new bn(10).pow(decimals))
    }

    describe("PerpLemma tests => Open, Close", () => {

      let collateralAmountForUSD
      let collateralAmountForETH

      before(async function () {
        collateralAmountForUSD = parseUnits("10000", usdCollateralDecimals); // 6 decimal
        collateralAmountForETH = parseUnits("100", ethCollateralDecimals); // 6 decimal

        await usdCollateral.mint(defaultSigner.address, collateralAmountForUSD.mul(3));
        await usdCollateral.mint(usdLemma.address, collateralAmountForUSD.mul(3));
        await ethCollateral.mint(usdLemma.address, collateralAmountForETH.mul(3));
        await ethCollateral.mint(signer2.address, collateralAmountForETH.mul(3));

        // transfer Collateral to perpLemma2
        await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSD);
        // await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForETH);
        // await ethCollateral.connect(signer2).transfer(perpLemma2.address, collateralAmountForETH);

        const depositSettlement = parseUnits("100", usdCollateralDecimals); // usdc is settlement token
        await usdCollateral.approve(perpLemma2.address, ethers.constants.MaxUint256);
        await perpLemma2.depositSettlementToken(depositSettlement)

        const signer1Amount = parseUnits("1000000", ethCollateralDecimals);
        await ethCollateral.mint(signer1.address, signer1Amount);
        await ethCollateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(signer1).deposit(ethCollateral.address, collateralAmountForETH);
        await clearingHouse.connect(signer1).openPosition({
          baseToken: baseToken.address,
          isBaseToQuote: false,
          isExactInput: true,
          oppositeAmountBound: 0,
          amount: collateralAmountForETH,
          sqrtPriceLimitX96: 0,
          deadline: ethers.constants.MaxUint256,
          referralCode: ethers.constants.HashZero,
        })

        const signer2Amount = parseUnits("1000000", ethCollateralDecimals);
        await ethCollateral.mint(signer3.address, signer2Amount);
        await ethCollateral.connect(signer3).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(signer3).deposit(ethCollateral.address, collateralAmountForETH);
        await clearingHouse.connect(signer3).openPosition({
          baseToken: baseToken.address,
          isBaseToQuote: false,
          isExactInput: true,
          oppositeAmountBound: 0,
          amount: collateralAmountForETH,
          sqrtPriceLimitX96: 0,
          deadline: ethers.constants.MaxUint256,
          referralCode: ethers.constants.HashZero,
        })

        await clearingHouse.connect(signer3).openPosition({
          baseToken: baseToken.address,
          isBaseToQuote: true,
          isExactInput: false,
          oppositeAmountBound: 0,
          amount: collateralAmountForETH.div(2),
          sqrtPriceLimitX96: 0,
          deadline: ethers.constants.MaxUint256,
          referralCode: ethers.constants.HashZero,
        })
      })

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
        const collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
        await perpLemma2.setMaxPosition(parseEther("90"));
        await ethCollateral.mint(usdLemma.address, collateralAmount.add(1));
        await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount.add(1));
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount)).to.be.revertedWith(
          "max position reached",
        );
      });

      it("should close position correctly", async function () {
        let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
        await ethCollateral.mint(usdLemma.address, collateralAmount);
  
        // transfer Collateral to perpLemma
        await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, parseEther("1"));
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmount,
        ); // index0: base/usd, index1: quote/eth
  
        // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma2.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("98997069864045003795", 0), // Position, negative because of short?
            parseUnits("-990000000000000000", 0), // Notional
            parseUnits("10000000000000000", 0), // Fee
            parseUnits("-1000000000000000000", 0), // OpenNotional
            0, // PnlToBeRealized
            parseUnits("7922933893323528841264017076", 0), // sqrtPriceAfterX96
          );
  
        expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
        expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        expect(baseAndQuoteValue[0]).to.eq(positionSize);
  
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize,
        );
        // long eth and close position, withdraw ethCollateral
        await expect(await perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[1]))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma2.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("-98997069864045003697", 0), // Position, negative because of short?
            parseUnits("989999999999999999", 0), // Notional
            parseUnits("9900000000000000", 0), // Fee
            parseUnits("-1", 0), // OpenNotional
            parseUnits("-19900000000000000", 0), // PnlToBeRealized
            parseUnits("7922933108964719950047075696", 0), // sqrtPriceAfterX96
          );
        positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        expect(positionSize).to.closeTo(BigNumber.from("1000"), BigNumber.from("1000"));
        expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.gt(0); // consider to be fee
        expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
      });

      it("#1 openWExactCollateral and closeWExactCollateral ", async function () {
        collateralAmountForETH = parseUnits("1", ethCollateralDecimals); // 6 decimal
        await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForETH);

        // open
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmountForETH.mul(parseEther('1')).div(parseUnits('1', ethCollateralDecimals)),
        ); // index0: base/usd, index1: quote/eth
        console.log('baseAndQuoteValue-1: ', baseAndQuoteValue.toString())
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(baseAndQuoteValue[1])).to.emit(clearingHouse, "PositionChanged")
        let leverage = await calcLeverage()
        expect(leverage[1]).to.eq('1');

        let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        console.log('positionSize-1: ', positionSize.toString())

        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize
        );

        console.log('baseAndQuoteValue-2: ', baseAndQuoteValue.toString())
        await expect(await perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[1]))
        leverage = await calcLeverage()

        positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        console.log('positionSize-2: ', positionSize.toString())
      });
      // getCollateralAmountGivenUnderlyingAssetAmount => gCAGUAA
      it("#2 openWExactCollateral and gCAGUAA => close ", async function () {
        collateralAmountForETH = parseUnits("1", ethCollateralDecimals); // 6 decimal
        await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForETH);

        // open
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmountForETH,
        ); // index0: base/usd, index1: quote/eth
        console.log('baseAndQuoteValue-1: ', baseAndQuoteValue.toString())

        // Deposit ethCollateral in eth and Short eth and long usdc
        collateralAmountForETH = parseUnits("1", ethCollateralDecimals);
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(baseAndQuoteValue[1]))
          .to.emit(clearingHouse, "PositionChanged")

        let leverage = await calcLeverage()
        expect(leverage[1]).to.eq('1');

        let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        console.log('positionSize-1: ', positionSize.toString())

        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize,
        );
        console.log('baseAndQuoteValue-2: ', baseAndQuoteValue.toString())

        await expect(perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[0], false))
          .to.emit(clearingHouse, "PositionChanged")
        await perpLemma2.connect(usdLemma).close(0, baseAndQuoteValue[1])
        leverage = await calcLeverage()

        positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        console.log('positionSize-2: ', positionSize.toString())
      });
      // getCollateralAmountGivenUnderlyingAssetAmount => gCAGUAA
      it("#3 gCAGUAA -> open and gCAGUAA -> close ", async function () {
        collateralAmountForETH = parseUnits("100", ethCollateralDecimals); // 6 decimal
        await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForETH);
        // open
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmountForETH.mul(parseEther('1')).div(parseUnits('1', ethCollateralDecimals)),
        ); // index0: base/usd, index1: quote/eth
        console.log('baseAndQuoteValue[1]: ', baseAndQuoteValue.toString())

        // Deposit ethCollateral in eth and Short eth and long usdc
        collateralAmountForETH = parseUnits("100", ethCollateralDecimals);
        await expect(perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[0], true))
          .to.emit(clearingHouse, "PositionChanged")

        await perpLemma2.connect(usdLemma).open(0, baseAndQuoteValue[1])
        let leverage = await calcLeverage()
        expect(leverage[1]).to.eq('1');

        // close
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        console.log('positionSize: ', positionSize.toString())

        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize
        ); // index0: base/usd, index1: quote/eth
        console.log('baseAndQuoteValue[1]: ', baseAndQuoteValue.toString())

        await expect(perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[0], false))
          .to.emit(clearingHouse, "PositionChanged")

        await perpLemma2.connect(usdLemma).close(0, baseAndQuoteValue[1])
        leverage = await calcLeverage()
        expect(leverage[1]).to.eq(0)
      });
      // getCollateralAmountGivenUnderlyingAssetAmount => gCAGUAA
      it("#4 gCAGUAA -> open and closeWExactCollateral ", async function () {
        collateralAmountForETH = parseUnits("100", ethCollateralDecimals);
        await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForETH);
        // open
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmountForETH.mul(parseEther('1')).div(parseUnits('1', ethCollateralDecimals)),
        ); // index0: base/usd, index1: quote/eth
        console.log('baseAndQuoteValue[1]: ', baseAndQuoteValue.toString())

        // Deposit ethCollateral in eth and Short eth and long usdc
        collateralAmountForETH = parseUnits("100", ethCollateralDecimals);
        await expect(perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[0], true))
          .to.emit(clearingHouse, "PositionChanged")

        await perpLemma2.connect(usdLemma).open(0, baseAndQuoteValue[1])
        let leverage = await calcLeverage()
        expect(leverage[1]).to.eq('1');

        // close
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        console.log('positionSize-1: ', positionSize.toString())

        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize
        );

        console.log('baseAndQuoteValue-2: ', baseAndQuoteValue.toString())
        await expect(await perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[1].div(2)))
        leverage = await calcLeverage()

        positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        console.log('positionSize-2: ', positionSize.toString())
      });

      describe("OpenPosition leverage test", () => {
        let collateralToGetBack_1e6, collateralToGetBack_1e18;
        beforeEach(async function () {
          const collateralAmount = parseEther("1");
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
        });
  
        it("openPosition => emit event PositionChanged", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          // Deposit ethCollateral in eth and Short eth and long usdc
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("98997069864045003795", 0), // Position, negative because of short?
              parseUnits("-990000000000000000", 0), // Notional
              parseUnits("10000000000000000", 0), // Fee
              parseUnits("-1000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("7922933893323528841264017076", 0), // sqrtPriceAfterX96
            );
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize);
        });
  
        it("openPosition => leverage should be 1x", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("98997069864045003795", 0), // Position, negative because of short?
              parseUnits("-990000000000000000", 0), // Notional
              parseUnits("10000000000000000", 0), // Fee
              parseUnits("-1000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("7922933893323528841264017076", 0), // sqrtPriceAfterX96
            );
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize);
          const depositedCollateral = await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address);
          const ethPrice = await mockedBaseAggregator2.getRoundData(0); //ethPrice
          const leverage = depositedCollateral.mul(ethPrice[1]).div(positionSize); // 979999(close to 1e6 or 1x)
          expect(leverage).to.be.closeTo(parseUnits("1", ethCollateralDecimals), parseEther("0.031")); // leverage should be 1x(1e6) or close to 1e6
        });
      });

      describe("Open and close Position test variation", () => {
        let collateralmintAmount;
        beforeEach(async function () {
          collateralmintAmount = parseEther("1");
          await ethCollateral.mint(usdLemma.address, collateralmintAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralmintAmount);
        });
  
        it("openPosition => open position for short and close position for 2 time longs", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("98997069864045003795", 0), // Position, negative because of short?
              parseUnits("-990000000000000000", 0), // Notional
              parseUnits("10000000000000000", 0), // Fee
              parseUnits("-1000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("7922933893323528841264017076", 0), // sqrtPriceAfterX96
            );
  
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
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
  
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[1]))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-49498534932022501799", 0), // Position, negative because of short?
              parseUnits("495000024502137392", 0), // Notional
              parseUnits("4950000245021374", 0), // Fee
              parseUnits("-500000000000000001", 0), // OpenNotional
              parseUnits("-9949975742883981", 0), // PnlToBeRealized
              parseUnits("7922933501144104983062313588", 0), // sqrtPriceAfterX96
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
  
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[1]))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-49498534932022501798", 0), // Position, negative because of short?
              parseUnits("494999975497862606", 0), // Notional
              parseUnits("4949999754978627", 0), // Fee
              parseUnits("-3", 0), // OpenNotional
              parseUnits("-9950024257116019", 0), // PnlToBeRealized
              parseUnits("7922933108964719950047076488", 0), // sqrtPriceAfterX96
            );
  
          positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.closeTo(BigNumber.from("1000"), BigNumber.from("1000"));
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.gt(0); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
        });
  
        it("openPosition => open position for short and close position for long", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("98997069864045003795", 0), // Position, negative because of short?
              parseUnits("-990000000000000000", 0), // Notional
              parseUnits("10000000000000000", 0), // Fee
              parseUnits("-1000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("7922933893323528841264017076", 0), // sqrtPriceAfterX96
            );
  
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize);
  
          baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            positionSize,
          );
  
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[1]))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-98997069864045003697", 0), // Position, negative because of short?
              parseUnits("989999999999999999", 0), // Notional
              parseUnits("9900000000000000", 0), // Fee
              parseUnits("-1", 0), // OpenNotional
              parseUnits("-19900000000000000", 0), // PnlToBeRealized
              parseUnits("7922933108964719950047075696", 0), // sqrtPriceAfterX96
            );
          positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.closeTo(BigNumber.from("1000"), BigNumber.from("1000"));
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.gt(0); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
        });
      });

      describe("OpenWExactCollateral and CloseWExactCollateral", async function () {
        it("Basic Open", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.equal(collateralAmount);
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("98997069864045003795", 0), // Position, negative because of short?
              parseUnits("-990000000000000000", 0), // Notional
              parseUnits("10000000000000000", 0), // Fee
              parseUnits("-1000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("7922933893323528841264017076", 0), // sqrtPriceAfterX96
            );
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize);
        });
  
        it("Basic Open and Close, Checking the lost ethCollateral should be < 5%", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          const usdLemmaBalance1 = await ethCollateral.balanceOf(usdLemma.address);
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.equal(collateralAmount);
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("98997069864045003795", 0), // Position, negative because of short?
              parseUnits("-990000000000000000", 0), // Notional
              parseUnits("10000000000000000", 0), // Fee
              parseUnits("-1000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("7922933893323528841264017076", 0), // sqrtPriceAfterX96
            );
  
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize);
          baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            positionSize,
          );
          // collateralAmount = baseAndQuoteValue[1].mul(parseEther("1")).div(parseEther("0.99"));
  
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[1]))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-98997069864045003697", 0), // Position, negative because of short?
              parseUnits("989999999999999999", 0), // Notional
              parseUnits("9900000000000000", 0), // Fee
              parseUnits("-1", 0), // OpenNotional
              parseUnits("-19900000000000000", 0), // PnlToBeRealized
              parseUnits("7922933108964719950047075696", 0), // sqrtPriceAfterX96
            );
          positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.closeTo(BigNumber.from("1000"), BigNumber.from("1000"));
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.gt(0); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
  
          const usdLemmaBalance2 = await ethCollateral.balanceOf(usdLemma.address);
          const deltaBalance = usdLemmaBalance2.sub(usdLemmaBalance1);
          const lostCollateral = collateralAmount.sub(deltaBalance);
          const percLostCollateral = lostCollateral.div(collateralAmount);
          const amt = collateralAmount.mul(BigNumber.from(5).div(100));
  
          console.log(collateralAmount.mul(5).div(100).toString());
          console.log(collateralAmount.sub(deltaBalance).toString());
          // Checking the lost ethCollateral is < 5% of the initial amount
          expect(collateralAmount.sub(deltaBalance)).to.below(collateralAmount.mul(5).div(100));
        });
      });

      describe("Emergency Settlement", async function () {
        beforeEach(async function () { });
  
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
          const collateralAmount = parseEther("1");
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
          // Deposit ethCollateral in eth and Short eth and long usdc
          await perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount);
          expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
          // Closing the market
          expect(await baseToken.connect(defaultSigner)["close(uint256)"](1)).to.emit(baseToken, "StatusUpdated");
  
          const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
          await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));
          await expect(perpLemma2.connect(usdLemma).settle())
            .to.emit(vault, "Withdrawn")
            .withArgs(ethCollateral.address, perpLemma2.address, parseUnits("1000000000000000000", 0));
        });
  
        it("Open a Position and Calling Settle() when Market is closed should work", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          collateralAmount = parseUnits("1", ethCollateralDecimals);
  
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("98997069864045003795", 0), // Position, negative because of short?
              parseUnits("-990000000000000000", 0), // Notional
              parseUnits("10000000000000000", 0), // Fee
              parseUnits("-1000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("7922933893323528841264017076", 0), // sqrtPriceAfterX96
            );
  
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize);
  
          expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
          expect(await baseToken.connect(defaultSigner)["close(uint256)"](1)).to.emit(baseToken, "StatusUpdated");
          const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
          await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));
  
          await expect(perpLemma2.connect(usdLemma).settle())
            .to.emit(vault, "Withdrawn")
            .withArgs(ethCollateral.address, perpLemma2.address, parseUnits("1000000000000000000", 0)); // 999999
  
          // This is not passing as
          // Initial Collateral: 100000000000
          // Actual Collateral: 99901980199
          // So the Vault has less ethCollateral than when it started
          //expect(await ethCollateral.balanceOf(vault.address)).to.equal(initialVaultCollateral);
        });
  
        it("Test Settle and Withdraw Collateral for 2 Users", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
          
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            false,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
  
          // 3.2 USDLemma calls PerpLemma Open to open a position at the PerpV2 Clearing House
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("98997069864045003795", 0), // Position, negative because of short?
              parseUnits("-990000000000000000", 0), // Notional
              parseUnits("10000000000000000", 0), // Fee
              parseUnits("-1000000000000000000", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("7922933893323528841264017076", 0), // sqrtPriceAfterX96
            );
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize);
  
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
          await perpLemma2.connect(usdLemma).settle();
  
          let collateralPerpLemma = await ethCollateral.balanceOf(perpLemma2.address);
          const c1 = collateralPerpLemma * 0.2;
          const c1_1e18 = parseEther(c1.toString()).div(parseUnits("1", ethCollateralDecimals));
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(c1_1e18)).to.emit(ethCollateral, "Transfer");
  
          collateralPerpLemma = await ethCollateral.balanceOf(perpLemma2.address);
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.not.equal(0);
  
          // console.log("Trying to call PerpLemma.close() after market settlement to withdraw the remaining 80% of the initial ethCollateral that is now the 100% of the remaining ethCollateral");
          const c2 = collateralPerpLemma;
          const c2_1e18 = parseEther(c2.toString()).div(parseUnits("1", ethCollateralDecimals));
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(c2_1e18)).to.emit(ethCollateral, "Transfer");
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.equal(0);
        });
      });

    });

    describe("Rebalance Tests", () => {
      before(async function () {
        await perpLemma2.connect(defaultSigner).setReBalancer(reBalancer.address);
        await addLiquidity(
          clearingHouse,
          signer2,
          baseToken.address,
          parseEther("1000000000"),
          parseEther("10000000"),
          -887200,
          887200,
        );
  
        // alice add long limit order
        await ethCollateral.mint(signer1.address, parseUnits("10000000000", ethCollateralDecimals));
        await ethCollateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(signer1).deposit(ethCollateral.address, parseUnits("10000", ethCollateralDecimals));
  
        await ethCollateral.mint(signer2.address, parseUnits("10000000000", ethCollateralDecimals));
        await ethCollateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(signer2).deposit(ethCollateral.address, parseUnits("100000", ethCollateralDecimals));
  
        await ethCollateral.mint(longAddress.address, parseUnits("10000000000", ethCollateralDecimals));
        await ethCollateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(longAddress).deposit(ethCollateral.address, parseUnits("10000", ethCollateralDecimals));
  
        await ethCollateral.mint(usdLemma.address, parseUnits("10000000000", ethCollateralDecimals));
        await ethCollateral.connect(usdLemma).approve(vault.address, ethers.constants.MaxUint256);
        await vault.connect(usdLemma).deposit(ethCollateral.address, parseUnits("10000", ethCollateralDecimals));
      });
  
      it("#1.a Rebalance, only usdLemma with short eth", async () => {
        await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, parseEther("1"));
        await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("1"));
        await forwardTimestamp(clearingHouse, 200);
        await clearingHouse.settleAllFunding(perpLemma2.address);
        await forwardTimestamp(clearingHouse, 200);
        let fundingPayment = await exchange.getPendingFundingPayment(perpLemma2.address, baseToken.address);
        console.log("fundingPayment: ", fundingPayment.toString());
        let leverage_before = await calcLeverage();
        console.log("leverage_before_in_6_decimal: ", leverage_before[0].toString());
        console.log("leverage_before_in_1: ", leverage_before[1].toString());
        let fundingPNL = await perpLemma2.getFundingPNL();
        let realizedFundingPnl = await perpLemma2.realizedFundingPNL();
        console.log("fundingPNL: ", fundingPNL.toString());
        console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
        const sqrtPriceLimitX96 = 0;
        const deadline = ethers.constants.MaxUint256;
        await perpLemma2
          .connect(usdLemma)
          .reBalance(
            reBalancer.address,
            fundingPNL.sub(realizedFundingPnl),
            ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
          );
        let leverage_after = await calcLeverage();
        console.log("leverage_after_in_6_decimal: ", leverage_after[0].toString());
        console.log("leverage_after_in_1: ", leverage_after[1].toString());
        expect(leverage_after[1]).eq(1);
      });
  
      it("#1.b Rebalance, longAddress(signer) with long eth, only usdLemma short eth", async () => {
        await openPosition(clearingHouse, longAddress, baseToken.address, true, false, parseEther("8"));
        await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, parseEther("1"));
        await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("0.1"));
        await forwardTimestamp(clearingHouse, 200);
        await clearingHouse.settleAllFunding(perpLemma2.address);
        await forwardTimestamp(clearingHouse, 200);
        let fundingPayment = await exchange.getPendingFundingPayment(perpLemma2.address, baseToken.address);
        console.log("fundingPayment: ", fundingPayment.toString());
        let leverage_before = await calcLeverage();
        console.log("leverage_before_in_6_decimal: ", leverage_before[0].toString());
        console.log("leverage_before_in_1: ", leverage_before[1].toString());
        let fundingPNL = await perpLemma2.getFundingPNL();
        let realizedFundingPnl = await perpLemma2.realizedFundingPNL();
        let totalFundingPNL = await perpLemma2.totalFundingPNL();
        console.log("fundingPNL: ", fundingPNL.toString());
        console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
        const sqrtPriceLimitX96 = 0;
        const deadline = ethers.constants.MaxUint256;
        await perpLemma2
          .connect(usdLemma)
          .reBalance(
            reBalancer.address,
            fundingPNL.sub(realizedFundingPnl),
            ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
          );
        let leverage_after = await calcLeverage();
        console.log("leverage_after_in_6_decimal: ", leverage_after[0].toString());
        console.log("leverage_after_in_1: ", leverage_after[1].toString());
  
        expect(leverage_after[0]).lt(leverage_before[0]);
        expect(leverage_after[1]).eq(1);
      });
  
      it("#1.c Rebalance, longAddress(signer) with long eth, signer1(signer) with short eth, and usdLemma short eth", async () => {
        await openPosition(clearingHouse, longAddress, baseToken.address, true, false, parseEther("8"));
        await openPosition(clearingHouse, signer1, baseToken.address, false, true, parseEther("5"));
        await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, parseEther("1"));
        await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("1"));

        // const oracleDecimals = 6
        // const slot0 = await pool.slot0()
        // const sqrtPrice = slot0.sqrtPriceX96
        // console.log('sqrtPrice: ', sqrtPrice.toString())
        // const price = formatSqrtPriceX96ToPrice(sqrtPrice, oracleDecimals)
        // console.log('price: ', price.toString())
        // await mockedBaseAggregator.setLatestRoundData(0, parseUnits(price, ethCollateralDecimals), 0, 0, 0);

        await forwardTimestamp(clearingHouse, 200);
        await clearingHouse.settleAllFunding(perpLemma2.address);
        await forwardTimestamp(clearingHouse, 3000);
        let fundingPayment = await exchange.getPendingFundingPayment(perpLemma2.address, baseToken.address);
        console.log("fundingPayment: ", fundingPayment.toString());
        let leverage_before = await calcLeverage();
        console.log("leverage_before_in_6_decimal: ", leverage_before[0].toString());
        console.log("leverage_before_in_1: ", leverage_before[1].toString());
        let fundingPNL = await perpLemma2.getFundingPNL();
        let realizedFundingPnl = await perpLemma2.realizedFundingPNL();
        let totalFundingPNL = await perpLemma2.totalFundingPNL();
        console.log("fundingPNL: ", fundingPNL.toString());
        console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
        const sqrtPriceLimitX96 = 0;
        const deadline = ethers.constants.MaxUint256;
        await perpLemma2
          .connect(usdLemma)
          .reBalance(
            reBalancer.address,
            fundingPNL.sub(realizedFundingPnl),
            ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
          );
        let leverage_after = await calcLeverage();
        console.log("leverage_after_in_6_decimal: ", leverage_after[0].toString());
        console.log("leverage_after_in_1: ", leverage_after[1].toString());
        expect(leverage_after[0]).lt(leverage_before[0]);
        expect(leverage_after[1]).eq(1);
      });
    });
  });
});
