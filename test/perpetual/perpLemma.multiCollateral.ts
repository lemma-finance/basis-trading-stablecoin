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
  let perpLemma: any;
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

    const maxPosition = ethers.constants.MaxUint256;
    const perpLemmaFactory = await ethers.getContractFactory("PerpLemma");
    perpLemma2 = await upgrades.deployProxy(
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
    await perpLemma2.connect(signer1).resetApprovals();

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
  });

  beforeEach(async function () {
    snapshotId = await snapshot();
  });

  afterEach(async function () {
    // await calcLeverage1();
    await revertToSnapshot(snapshotId);
  });

  async function calcLeverage() {
    console.log('calcLeverage()')
    const positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
    const depositedCollateral = await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address);

    const ethPrice = await mockedBaseAggregator2.getRoundData(0); //ethPrice
    const interval = await clearingHouseConfig.getTwapInterval();

    // method 1 to get usdc price in eth
    const usdcPriceInETHFromIndex = await baseToken.getIndexPrice(interval);

    console.log('\nethPrice: ', ethPrice[1].toString(), interval.toString())
    console.log('usdcPriceInETHFromIndex: ', usdcPriceInETHFromIndex.toString())
    console.log('positionSize: ', positionSize.toString())
    console.log('depositedCollateral: ', depositedCollateral.toString())
    if (!positionSize.eq(ZERO)) {
      const leverage_in_6_Decimal = depositedCollateral.mul(parseUnits("1", 26)).div(positionSize.mul(usdcPriceInETHFromIndex.toString()));
      const leverage_in_1 = depositedCollateral.mul(parseUnits("1", 18)).div(positionSize.mul(usdcPriceInETHFromIndex.toString()));
      console.log('calcLeverage()', leverage_in_6_Decimal.toString(), leverage_in_1.toString())
      return [leverage_in_6_Decimal, leverage_in_1];
    }
    console.log('calcLeverage()-positionSize-zero, 0, 0')
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
  
        await usdCollateral.mint(usdLemma.address, collateralAmountForUSD.mul(3));
        await ethCollateral.mint(usdLemma.address, collateralAmountForETH.mul(3));
        await ethCollateral.mint(signer2.address, collateralAmountForETH.mul(3));

        // transfer Collateral to perpLemma2
        await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSD);
        await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForETH);
        await ethCollateral.connect(signer2).transfer(perpLemma2.address, collateralAmountForETH);

        const depositSettlement = parseUnits("100", usdCollateralDecimals); // usdc is settlement token
        await perpLemma2.connect(usdLemma).depositSettlementToken(depositSettlement)

        const signer1Amount = parseUnits("1000000", ethCollateralDecimals);
        await ethCollateral.mint(signer1.address, signer1Amount);
        await ethCollateral.connect(signer1).transfer(perpLemma2.address, collateralAmountForETH);
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
        await ethCollateral.connect(signer3).transfer(perpLemma2.address, collateralAmountForETH);
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

        await ethCollateral.mint(signer2.address, collateralAmountForETH);
        await ethCollateral.connect(signer2).transfer(perpLemma2.address, collateralAmountForETH);
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmountForETH
        ); // index0: base/usd, index1: quote/eth
        console.log('baseAndQuoteValue-1: ', baseAndQuoteValue.toString())
  
        // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(perpLemma2.connect(signer2).openWExactCollateral(baseAndQuoteValue[1]))
        .to.emit(clearingHouse, "PositionChanged")

        await calcLeverage()

        let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        console.log('positionSize-before: ', positionSize.toString())
        console.log('aftre before')
      })

      it("#1 openWExactCollateral and closeWExactCollateral ", async function () {
        collateralAmountForETH = parseUnits("1", ethCollateralDecimals); // 6 decimal

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
      it("#2 openWExactCollateral and getCollateralAmountGivenUnderlyingAssetAmount => close ", async function () {
        collateralAmountForETH = parseUnits("1", ethCollateralDecimals); // 6 decimal

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
    })

    // it("#1", async function () {
    //   let collateralAmountForUSD = parseUnits("10000", usdCollateralDecimals); // 6 decimal
    //   let collateralAmountForETH = parseUnits("100", ethCollateralDecimals); // 6 decimal

    //   await usdCollateral.mint(usdLemma.address, collateralAmountForUSD);
    //   await ethCollateral.mint(usdLemma.address, collateralAmountForETH);

    //   // transfer Collateral to perpLemma2
    //   await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSD);
    //   await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForETH);

    //   let baseAndQuoteValue = await callStaticOpenPosition(
    //     clearingHouse,
    //     longAddress,
    //     baseToken.address,
    //     false,
    //     true,
    //     collateralAmountForETH.mul(parseEther('1')).div(parseUnits('1', ethCollateralDecimals)),
    //   ); // index0: base/usd, index1: quote/eth
    //   console.log('baseAndQuoteValue[1]: ', baseAndQuoteValue.toString())

    //   const depositSettlement = parseUnits("1", usdCollateralDecimals); // usdc is settlement token
    //   await perpLemma2.connect(usdLemma).depositSettlementToken(depositSettlement)

    //   // Deposit ethCollateral in eth and Short eth and long usdc
    //   collateralAmountForETH = parseUnits("100", ethCollateralDecimals);
    //   await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmountForETH)).to.emit(clearingHouse, "PositionChanged")
    //   let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
    //   console.log('positionSize: ', positionSize.toString())
    //   await calcLeverage()
    // });

    // it("#2", async function () {
    //   let collateralAmountForUSD = parseUnits("10000", usdCollateralDecimals); // 6 decimal
    //   let collateralAmountForETH = parseUnits("100", ethCollateralDecimals); // 6 decimal

    //   await usdCollateral.mint(usdLemma.address, collateralAmountForUSD);
    //   await ethCollateral.mint(usdLemma.address, collateralAmountForETH);

    //   // transfer Collateral to perpLemma2
    //   await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSD);
    //   await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForETH);

    //   // cut fees 1%
    //   collateralAmountForETH = collateralAmountForETH.sub(collateralAmountForETH.mul(BigNumber.from("10000")).div(BigNumber.from("1000000")));
    //   console.log('collateral-001', collateralAmountForETH.toString())
    //   console.log('amt : ', collateralAmountForETH.mul(parseEther('1')).div(parseUnits('1', ethCollateralDecimals)).toString())
      
    //   let baseAndQuoteValue = await callStaticOpenPosition(
    //     clearingHouse,
    //     longAddress,
    //     baseToken.address,
    //     false,
    //     true,
    //     collateralAmountForETH.mul(parseEther('1')).div(parseUnits('1', ethCollateralDecimals)),
    //   ); // index0: base/usd, index1: quote/eth
    //   console.log('baseAndQuoteValue[1]: ', baseAndQuoteValue.toString())

    //   // const depositSettlement = parseUnits("1", usdCollateralDecimals); // usdc is settlement token
    //   // await perpLemma2.connect(usdLemma).depositSettlementToken(depositSettlement)

    //   // // Deposit ethCollateral in eth and Short eth and long usdc
    //   // collateralAmountForETH = parseUnits("100", ethCollateralDecimals);
    //   // const usdAmount = parseUnits('10000', ethCollateralDecimals)
    //   // await expect(perpLemma2.connect(usdLemma).openWExactCollateral2(collateralAmountForETH, usdAmount)).to.emit(clearingHouse, "PositionChanged")
    //   // // await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmountForETH)).to.emit(clearingHouse, "PositionChanged")
    //   // let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
    //   // console.log('positionSize: ', positionSize.toString())
    //   // await calcLeverage()
    // });

    // it("#3", async function () {
    //   let collateralAmountForUSD = parseUnits("10000", usdCollateralDecimals); // 6 decimal
    //   let collateralAmountForETH = parseUnits("100", ethCollateralDecimals); // 6 decimal

    //   await usdCollateral.mint(usdLemma.address, collateralAmountForUSD);
    //   await ethCollateral.mint(usdLemma.address, collateralAmountForETH);

    //   // transfer Collateral to perpLemma2
    //   await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSD);
    //   await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForETH);

    //   let baseAndQuoteValue = await callStaticOpenPosition(
    //     clearingHouse,
    //     longAddress,
    //     baseToken.address,
    //     false,
    //     true,
    //     collateralAmountForETH.mul(parseEther('1')).div(parseUnits('1', ethCollateralDecimals)),
    //   ); // index0: base/usd, index1: quote/eth
    //   console.log('baseAndQuoteValue[1]: ', baseAndQuoteValue.toString())

    //   const depositSettlement = parseUnits("1", usdCollateralDecimals); // usdc is settlement token
    //   await perpLemma2.connect(usdLemma).depositSettlementToken(depositSettlement)

    //   // Deposit ethCollateral in eth and Short eth and long usdc
    //   collateralAmountForETH = parseUnits("100", ethCollateralDecimals);
    //   await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmountForETH)).to.emit(clearingHouse, "PositionChanged")
    //   let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
    //   console.log('positionSize: ', positionSize.toString())
    //   await calcLeverage()

    //   console.log('open2: ', positionSize.toString())
    //   baseAndQuoteValue = await callStaticOpenPosition(
    //     clearingHouse,
    //     longAddress,
    //     baseToken.address,
    //     false,
    //     true,
    //     collateralAmountForETH.mul(parseEther('1')).div(parseUnits('1', ethCollateralDecimals)),
    //   ); // index0: base/usd, index1: quote/eth
    //   console.log('baseAndQuoteValue[2]: ', baseAndQuoteValue.toString())

    //   await ethCollateral.mint(usdLemma.address, collateralAmountForETH);
    //   await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForETH);
    //   await expect(
    //     perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[0], true))
    //   .to.emit(clearingHouse, "PositionChanged")

    //   await perpLemma2.connect(usdLemma).open(0, collateralAmountForETH)
    //   await calcLeverage()

    // });

    // it("#4", async function () {
    //   let collateralAmountForUSD = parseUnits("10000", usdCollateralDecimals); // 6 decimal
    //   let collateralAmountForETH = parseUnits("100", ethCollateralDecimals); // 6 decimal

    //   await usdCollateral.mint(usdLemma.address, collateralAmountForUSD);
    //   await ethCollateral.mint(usdLemma.address, collateralAmountForETH);

    //   // transfer Collateral to perpLemma2
    //   await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSD);
    //   await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForETH);

    //   let baseAndQuoteValue = await callStaticOpenPosition(
    //     clearingHouse,
    //     longAddress,
    //     baseToken.address,
    //     false,
    //     true,
    //     collateralAmountForETH.mul(parseEther('1')).div(parseUnits('1', ethCollateralDecimals)),
    //   ); // index0: base/usd, index1: quote/eth
    //   console.log('baseAndQuoteValue[1]: ', baseAndQuoteValue.toString())

    //   const depositSettlement = parseUnits("100", usdCollateralDecimals); // usdc is settlement token
    //   await perpLemma2.connect(usdLemma).depositSettlementToken(depositSettlement)

    //   // Deposit ethCollateral in eth and Short eth and long usdc
    //   collateralAmountForETH = parseUnits("100", ethCollateralDecimals);
    //   await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmountForETH)).to.emit(clearingHouse, "PositionChanged")
    //   let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
    //   console.log('positionSize: ', positionSize.toString())
    //   // await calcLeverage()
    //   console.log('Done')

    //   await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(collateralAmountForETH))
    //     .to.emit(clearingHouse, "PositionChanged");
    //   await calcLeverage()

    //   console.log('open2: ', positionSize.toString())
    //   baseAndQuoteValue = await callStaticOpenPosition(
    //     clearingHouse,
    //     longAddress,
    //     baseToken.address,
    //     false,
    //     true,
    //     collateralAmountForETH.mul(parseEther('1')).div(parseUnits('1', ethCollateralDecimals)),
    //   ); // index0: base/usd, index1: quote/eth
    //   console.log('baseAndQuoteValue[2]: ', baseAndQuoteValue.toString())

    //   await ethCollateral.mint(usdLemma.address, collateralAmountForETH);
    //   await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForETH);
    //   await expect(
    //     perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[0], true))
    //   .to.emit(clearingHouse, "PositionChanged")

    //   await perpLemma2.connect(usdLemma).open(0, baseAndQuoteValue[1])
    //   await calcLeverage()
    // });
  });
});
