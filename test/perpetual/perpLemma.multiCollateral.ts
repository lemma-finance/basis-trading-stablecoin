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
  await clearingHouse.setBlockTimestamp(now.add(step), {
    gasPrice: 100,
    gasLimit: 9000000,
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
    const perpLemmaFactory = await ethers.getContractFactory("TestPerpLemma");
    // await expect(perpLemma2.connect(usdLemma).withdrawSettlementToken(depositSettlement)).to.be.revertedWith(
    //   "Ownable: caller is not the owner",
    // );

    await expect(
      upgrades.deployProxy(
        perpLemmaFactory,
        [
          trustedForwarder,
          ethCollateral.address,
          ethers.constants.AddressZero,
          clearingHouse.address,
          marketRegistry.address,
          usdLemma.address,
          maxPosition,
        ],
        { initializer: "initialize" },
      ),
    ).to.be.revertedWith("!baseToken");

    await expect(
      upgrades.deployProxy(
        perpLemmaFactory,
        [
          trustedForwarder,
          ethCollateral.address,
          baseToken.address,
          ethers.constants.AddressZero,
          marketRegistry.address,
          usdLemma.address,
          maxPosition,
        ],
        { initializer: "initialize" },
      ),
    ).to.be.revertedWith("!clearingHouse");

    await expect(
      upgrades.deployProxy(
        perpLemmaFactory,
        [
          trustedForwarder,
          ethCollateral.address,
          baseToken.address,
          clearingHouse.address,
          ethers.constants.AddressZero,
          usdLemma.address,
          maxPosition,
        ],
        { initializer: "initialize" },
      ),
    ).to.be.revertedWith("!marketRegistry");

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
    const positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
    const depositedCollateral = await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address);
    const quote = await accountBalance.getQuote(perpLemma2.address, baseToken.address);

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
      // const leverage_in_6_Decimal = depositedCollateral.mul(ethPrice2).div(quote);
      const leverage = depositedCollateral.mul(ethPrice2).div(quote);
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
      const fees = await perpLemma2.getFees(true);
      expect(fees).to.eq(10000);
    });

    it("deposit and withdraw settlement token", async function () {
      const depositSettlement = parseUnits("10000", usdCollateralDecimals); // usdc is settlement token
      await usdCollateral.mint(defaultSigner.address, depositSettlement);
      await usdCollateral.approve(perpLemma2.address, ethers.constants.MaxUint256);
      await expect(perpLemma2.connect(usdLemma).depositSettlementToken(depositSettlement)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
      await expect(perpLemma2.depositSettlementToken(0)).to.be.revertedWith("Amount should greater than zero");
      await perpLemma2.depositSettlementToken(depositSettlement);
      expect(await vault.getBalance(perpLemma2.address)).to.eq(depositSettlement);
      await expect(perpLemma2.connect(usdLemma).withdrawSettlementToken(depositSettlement)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
      await expect(perpLemma2.withdrawSettlementToken(0)).to.be.revertedWith("Amount should greater than zero");
      const getFreeCollateral = await vault.getFreeCollateral(perpLemma2.address);
      await perpLemma2.withdrawSettlementToken(getFreeCollateral);
      expect(await usdCollateral.balanceOf(perpLemma2.address)).to.eq(0);
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

        // // transfer Collateral to perpLemma2
        await usdCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmountForUSD);
        const depositSettlement = parseUnits("10000", usdCollateralDecimals); // usdc is settlement token
        await usdCollateral.approve(perpLemma2.address, ethers.constants.MaxUint256);
        await perpLemma2.depositSettlementToken(depositSettlement);
      });

      it("getAmountInCollateralDecimals", async function () {
        let amount = await perpLemma2.getAmountInCollateralDecimals(parseUnits("1", ethCollateralDecimals), true);
        expect(amount).to.eq(parseUnits("1", ethCollateralDecimals));

        await perpLemma2.setCollateralDecimals(6);
        amount = await perpLemma2.getAmountInCollateralDecimals("123", true);
        expect(amount).to.eq(124);
      });

      it("should set rebalance addresses correctly", async function () {
        await expect(perpLemma2.connect(defaultSigner).setReBalancer(ethers.constants.AddressZero)).to.be.revertedWith(
          "!reBalancer",
        );
        await expect(perpLemma2.connect(signer1).setReBalancer(reBalancer.address)).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
        await perpLemma2.connect(defaultSigner).setReBalancer(reBalancer.address);
      });

      it("should set addresses correctly", async function () {
        await expect(perpLemma2.connect(defaultSigner).setUSDLemma(ethers.constants.AddressZero)).to.be.revertedWith(
          "!usdLemma",
        );
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
        const collateralAmount = parseUnits("1", ethCollateralDecimals);
        await perpLemma2.setMaxPosition(parseEther("0.9"));
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
        await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          collateralAmount,
        ); // index0: base/usd, index1: quote/eth

        // // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma2.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("-1000000000000000000", 0), // Position, negative because of short?
            parseUnits("99999990000000999999", 0), // Notional
            parseUnits("999999900000010000", 0), // Fee
            parseUnits("98999990100000989999", 0), // OpenNotional
            0, // PnlToBeRealized
            parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
          );

        const totalPosition = await perpLemma2.getTotalPosition();
        expect(totalPosition.mul(-1)).to.eq(parseEther("100"));
        expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
        expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
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
        await expect(await perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[0]))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma2.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("1000000000000000000", 0), // Position, negative because of short?
            parseUnits("-99999990000001000000", 0), // Notional
            parseUnits("1010100909090919192", 0), // Fee
            parseUnits("0", 0), // OpenNotional
            parseUnits("-2010100809090929193", 0), // PnlToBeRealized
            parseUnits("792281625142643375935439503361", 0), // sqrtPriceAfterX96
          );
        positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        expect(positionSize).to.eq(0);
        expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(0); // consider to be fee
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
          true,
          true,
          collateralAmountForETH,
        ); // index0: base/usd, index1: quote/eth
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmountForETH)).to.emit(
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
          positionSize.mul(-1),
        );

        await expect(await perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[0]));
        leverage = await calcLeverage();
        positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
        expect(leverage).to.eq(0);
        expect(positionSize).to.eq(0);
        expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(0); // consider to be fee
        expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
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
          true,
          true,
          collateralAmountForETH,
        ); // index0: base/usd, index1: quote/eth
        // Deposit ethCollateral in eth and Short eth and long usdc
        collateralAmountForETH = parseUnits("1", ethCollateralDecimals);
        await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmountForETH)).to.emit(
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
          positionSize.mul(-1),
        );
        let usdLemmaBalBefore = await ethCollateral.balanceOf(usdLemma.address);
        await expect(
          perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[1], false),
        ).to.emit(clearingHouse, "PositionChanged");
        await perpLemma2.connect(usdLemma).close(0, baseAndQuoteValue[0]);
        leverage = await calcLeverage();
        let usdLemmaBalAfter = await ethCollateral.balanceOf(usdLemma.address);
        positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);

        expect(leverage).to.eq(0);
        // slippage and fees have been cut here, need to verify above line
        // for 1 eth position it is taking charge fees 0.0199.. eth
        expect(positionSize).to.closeTo(parseEther("0.02").mul(-1), parseEther("0.002"));
        expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
        expect(usdLemmaBalAfter.sub(usdLemmaBalBefore)).to.be.equal(collateralAmountForETH);
        // console.log('usdLemmaBalAfter: ', usdLemmaBalAfter.toString(), usdLemmaBalAfter.sub(usdLemmaBalBefore).toString())
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
          true,
          true,
          collateralAmountForETH,
        ); // index0: base/usd, index1: quote/eth

        // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(
          perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[1], true),
        ).to.emit(clearingHouse, "PositionChanged");

        await expect(perpLemma2.connect(usdLemma).open(0, 0)).to.be.revertedWith("Amount should greater than zero");
        await expect(perpLemma2.connect(usdLemma).open(0, baseAndQuoteValue[0].mul(2))).to.be.revertedWith(
          "not enough collateral",
        );
        await perpLemma2.connect(usdLemma).open(0, baseAndQuoteValue[0]);
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
          positionSize.mul(-1),
        ); // index0: base/usd, index1: quote/eth

        await expect(
          perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[1], false),
        ).to.emit(clearingHouse, "PositionChanged");

        await expect(perpLemma2.connect(usdLemma).close(0, 0)).to.be.revertedWith("Amount should greater than zero");
        await perpLemma2.connect(usdLemma).close(0, baseAndQuoteValue[0]);
        leverage = await calcLeverage();
        expect(leverage).to.eq(0);
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
          true,
          true,
          collateralAmountForETH,
        ); // index0: base/usd, index1: quote/eth

        // Deposit ethCollateral in eth and Short eth and long usdc
        await expect(
          perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount(baseAndQuoteValue[1], true),
        ).to.emit(clearingHouse, "PositionChanged");

        await perpLemma2.connect(usdLemma).open(0, baseAndQuoteValue[0]);
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
          positionSize.mul(-1),
        );
        await expect(await perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[0].div(2)));
        leverage = await calcLeverage();
        expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
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
            true,
            true,
            collateralAmount,
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
              baseToken.address, // Market --> vUSD
              parseUnits("-1000000000000000000", 0), // Position, negative because of short?
              parseUnits("99999990000000999999", 0), // Notional
              parseUnits("999999900000010000", 0), // Fee
              parseUnits("98999990100000989999", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
            );
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
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
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-1000000000000000000", 0), // Position, negative because of short?
              parseUnits("99999990000000999999", 0), // Notional
              parseUnits("999999900000010000", 0), // Fee
              parseUnits("98999990100000989999", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
            );
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
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
          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralmintAmount);
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

          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
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

          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(0)).to.be.revertedWith("AS");
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[0])).to.emit(
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

          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[0])).to.emit(
            clearingHouse,
            "PositionChanged",
          );

          positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(0); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);
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
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-1000000000000000000", 0), // Position, negative because of short?
              parseUnits("99999990000000999999", 0), // Notional
              parseUnits("999999900000010000", 0), // Fee
              parseUnits("98999990100000989999", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
            );

          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));

          baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            positionSize.mul(-1),
          );

          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[0]))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("1000000000000000000", 0), // Position, negative because of short?
              parseUnits("-99999990000001000000", 0), // Notional
              parseUnits("1010100909090919192", 0), // Fee
              parseUnits("0", 0), // OpenNotional
              parseUnits("-2010100809090929193", 0), // PnlToBeRealized
              parseUnits("792281625142643375935439503361", 0), // sqrtPriceAfterX96
            );
          positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(0); // consider to be fee
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
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.equal(collateralAmount);
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount)).to.emit(
            clearingHouse,
            "PositionChanged",
          );
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));
        });

        it("Basic Open and Close, Checking the lost ethCollateral should be < 5%", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth
          const usdLemmaBalance1 = await ethCollateral.balanceOf(usdLemma.address);
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.equal(collateralAmount);
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount)).to.emit(
            clearingHouse,
            "PositionChanged",
          );

          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
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

          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[0]))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("1000000000000000000", 0), // Position, negative because of short?
              parseUnits("-99999990000001000000", 0), // Notional
              parseUnits("1010100909090919192", 0), // Fee
              parseUnits("0", 0), // OpenNotional
              parseUnits("-2010100809090929193", 0), // PnlToBeRealized
              parseUnits("792281625142643375935439503361", 0), // sqrtPriceAfterX96
            );
          positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(positionSize).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(0); // consider to be fee
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.be.equal(ZERO);

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
          await perpLemma2.setHasSettled(true);
          // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more USDL to Burn
          await expect(
            perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount("100", false),
          ).to.be.revertedWith("WPL_NP");
          await perpLemma2.setPositionAtSettlementInQuote(100);
          // WPL_NC : Wrapper PerpLemma, No Collateral
          await expect(
            perpLemma2.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmount("100", false),
          ).to.be.revertedWith("WPL_NC");
        });

        it("Force Error: closeWExactCollateralAfterSettlement", async function () {
          await perpLemma2.setHasSettled(true);
          // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more USDL to Burn
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral("100")).to.be.revertedWith("WPL_NP");
          await perpLemma2.setPositionAtSettlementInQuote(100);
          // WPL_NC : Wrapper PerpLemma, No Collateral
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral("100")).to.be.revertedWith("WPL_NC");
        });

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
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount)).to.be.revertedWith(
            "Market Closed",
          );
        });

        it("Open a Position and Calling Settle() when Market is closed should work", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);
          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth

          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-1000000000000000000", 0), // Position, negative because of short?
              parseUnits("99999990000000999999", 0), // Notional
              parseUnits("999999900000010000", 0), // Fee
              parseUnits("98999990100000989999", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
            );

          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
          expect(baseAndQuoteValue[0]).to.eq(positionSize.mul(-1));

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
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth

          // 3.2 USDLemma calls PerpLemma Open to open a position at the PerpV2 Clearing House
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-1000000000000000000", 0), // Position, negative because of short?
              parseUnits("99999990000000999999", 0), // Notional
              parseUnits("999999900000010000", 0), // Fee
              parseUnits("98999990100000989999", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
            );
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
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
          await perpLemma2.connect(usdLemma).settle();

          let collateralPerpLemma = await ethCollateral.balanceOf(perpLemma2.address);
          const c1 = collateralPerpLemma * 0.2;
          const c1_1e18 = parseEther(c1.toString()).div(parseUnits("1", ethCollateralDecimals));
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(c1_1e18)).to.emit(ethCollateral, "Transfer");

          collateralPerpLemma = await ethCollateral.balanceOf(perpLemma2.address);
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.not.equal(0);

          const c2 = collateralPerpLemma;
          const c2_1e18 = parseEther(c2.toString()).div(parseUnits("1", ethCollateralDecimals));
          await expect(perpLemma2.connect(usdLemma).closeWExactCollateral(c2_1e18)).to.emit(ethCollateral, "Transfer");
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.equal(0);
        });

        it("Test Settle and Withdraw Collateral for 2 Users, using close method", async () => {
          let collateralAmount = parseUnits("1", ethCollateralDecimals); // 6 decimal
          await ethCollateral.mint(usdLemma.address, collateralAmount);
          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, collateralAmount);

          let baseAndQuoteValue = await callStaticOpenPosition(
            clearingHouse,
            longAddress,
            baseToken.address,
            true,
            true,
            collateralAmount,
          ); // index0: base/usd, index1: quote/eth

          // 3.2 USDLemma calls PerpLemma Open to open a position at the PerpV2 Clearing House
          await expect(perpLemma2.connect(usdLemma).openWExactCollateral(collateralAmount))
            .to.emit(clearingHouse, "PositionChanged")
            .withArgs(
              perpLemma2.address, // Trader
              baseToken.address, // Market --> vUSD
              parseUnits("-1000000000000000000", 0), // Position, negative because of short?
              parseUnits("99999990000000999999", 0), // Notional
              parseUnits("999999900000010000", 0), // Fee
              parseUnits("98999990100000989999", 0), // OpenNotional
              0, // PnlToBeRealized
              parseUnits("792281545914488784486561055135", 0), // sqrtPriceAfterX96
            );
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.eq(0);
          expect(await vault.getBalanceByToken(perpLemma2.address, ethCollateral.address)).to.eq(parseEther("1"));
          let positionSize = await accountBalance.getTotalPositionSize(perpLemma2.address, baseToken.address);
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
          await perpLemma2.connect(usdLemma).settle();

          let usdLemmaBalBefore = await ethCollateral.balanceOf(usdLemma.address);
          let positionAtSettlementInQuote = await perpLemma2.positionAtSettlementInQuote();
          await perpLemma2
            .connect(usdLemma)
            .getCollateralAmountGivenUnderlyingAssetAmount(positionAtSettlementInQuote.div(2), false);
          await perpLemma2
            .connect(usdLemma)
            .getCollateralAmountGivenUnderlyingAssetAmount(positionAtSettlementInQuote.div(2), false);
          let usdLemmaBalAfter = await ethCollateral.balanceOf(usdLemma.address);
          expect(await ethCollateral.balanceOf(perpLemma2.address)).to.equal(1);
          expect(usdLemmaBalAfter.sub(usdLemmaBalBefore)).to.equal(parseUnits("999999999999999999", 0));
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

          await expect(
            perpLemma2
              .connect(usdLemma)
              .reBalance(
                reBalancer.address,
                parseEther("1"),
                ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
              ),
          ).to.be.revertedWith("not allowed");

          await expect(
            perpLemma2
              .connect(usdLemma)
              .reBalance(
                reBalancer.address,
                parseEther("1").mul(-1),
                ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
              ),
          ).to.be.revertedWith("not allowed");
        });

        it("#1.a Rebalance, fundingPNL negative, go long on rebalnce and increase levrage", async () => {
          await openPosition(clearingHouse, longAddress, baseToken.address, true, true, parseEther("2000"));
          await openPosition(clearingHouse, longAddress, baseToken.address, false, false, parseEther("3000"));

          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, parseEther("100"));
          await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("99"));
          await ethers.provider.send("evm_increaseTime", [300]);
          await ethers.provider.send("evm_mine", []);
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("1"));
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma2.settleAllFunding();
          // await forwardTimestamp(clearingHouse, 1);

          let checkPrice_before = await checkAndSyncPrice();
          let leverage_before = await calcLeverage();
          let fundingPNL = await perpLemma2.getFundingPNL();
          let totalFundingPNL = await perpLemma2.totalFundingPNL();
          let realizedFundingPnl = await perpLemma2.realizedFundingPNL();
          let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

          await perpLemma2
            .connect(usdLemma)
            .reBalance(
              reBalancer.address,
              rebalanceAmount,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
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
          // await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, parseEther("2000"));
          // await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("2000"));

          // checkPrice_before = await checkAndSyncPrice();
          // leverage_before = await calcLeverage();
          // fundingPNL = await perpLemma2.getFundingPNL();
          // totalFundingPNL = await perpLemma2.totalFundingPNL();
          // realizedFundingPnl = await perpLemma2.realizedFundingPNL();
          // rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

          // console.log("\nfundingPNL-2: ", fundingPNL.toString());
          // console.log("totalFundingPNL-2: ", totalFundingPNL.toString());
          // console.log("realizedFundingPnl-2: ", realizedFundingPnl.toString());
          // console.log("rebalanceAmount-2: ", rebalanceAmount.toString());
          // console.log("leverage_before-2: ", leverage_before.toString());
          // console.log("checkPrice_before-2: ", checkPrice_before.toString());

          // await perpLemma2
          //   .connect(usdLemma)
          //   .reBalance(
          //     reBalancer.address,
          //     rebalanceAmount,
          //     ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
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

          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, parseEther("2"));
          await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("1"));
          await ethers.provider.send("evm_increaseTime", [300]);
          await ethers.provider.send("evm_mine", []);
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("1"));
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma2.settleAllFunding();
          // await forwardTimestamp(clearingHouse, 1);

          let checkPrice_before = await checkAndSyncPrice();
          let leverage_before = await calcLeverage();
          let fundingPNL = await perpLemma2.getFundingPNL();
          let totalFundingPNL = await perpLemma2.totalFundingPNL();
          let realizedFundingPnl = await perpLemma2.realizedFundingPNL();
          let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

          await perpLemma2
            .connect(usdLemma)
            .reBalance(
              reBalancer.address,
              rebalanceAmount,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
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

          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, parseEther("500"));
          await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("490"));
          await ethers.provider.send("evm_increaseTime", [300]);
          await ethers.provider.send("evm_mine", []);
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("10"));
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma2.settleAllFunding();
          // await forwardTimestamp(clearingHouse, 1);

          let checkPrice_before = await checkAndSyncPrice();
          let leverage_before = await calcLeverage();
          let fundingPNL = await perpLemma2.getFundingPNL();
          let totalFundingPNL = await perpLemma2.totalFundingPNL();
          let realizedFundingPnl = await perpLemma2.realizedFundingPNL();
          let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

          await perpLemma2
            .connect(usdLemma)
            .reBalance(
              reBalancer.address,
              rebalanceAmount,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
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

          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, parseEther("500"));
          await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("490"));
          await ethers.provider.send("evm_increaseTime", [300]);
          await ethers.provider.send("evm_mine", []);
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("10"));
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma2.settleAllFunding();
          // await forwardTimestamp(clearingHouse, 1);

          let checkPrice_before = await checkAndSyncPrice();
          let leverage_before = await calcLeverage();
          let fundingPNL = await perpLemma2.getFundingPNL();
          let totalFundingPNL = await perpLemma2.totalFundingPNL();
          let realizedFundingPnl = await perpLemma2.realizedFundingPNL();
          let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

          await perpLemma2
            .connect(usdLemma)
            .reBalance(
              reBalancer.address,
              rebalanceAmount,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
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
          await ethCollateral.connect(usdLemma).transfer(perpLemma2.address, parseEther("2000"));

          await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("1900"));
          await ethers.provider.send("evm_increaseTime", [300]);
          await ethers.provider.send("evm_mine", []);
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma2.connect(usdLemma).openWExactCollateral(parseEther("100"));
          await forwardTimestamp(clearingHouse, 1);
          await perpLemma2.settleAllFunding();
          // await forwardTimestamp(clearingHouse, 1);

          let checkPrice_before = await checkAndSyncPrice();
          let leverage_before = await calcLeverage();
          let fundingPNL = await perpLemma2.getFundingPNL();
          let totalFundingPNL = await perpLemma2.totalFundingPNL();
          let realizedFundingPnl = await perpLemma2.realizedFundingPNL();
          let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

          await perpLemma2
            .connect(usdLemma)
            .reBalance(
              reBalancer.address,
              rebalanceAmount,
              ethers.utils.defaultAbiCoder.encode(["uint160", "uint256"], [sqrtPriceLimitX96, deadline]),
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
