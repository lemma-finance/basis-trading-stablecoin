import { ethers, upgrades, waffle } from "hardhat";
import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { utils } from "ethers";
import { parseEther, parseUnits, formatUnits } from "ethers/lib/utils";
import { BigNumber } from "@ethersproject/bignumber";
import { snapshot, revertToSnapshot } from "../shared/utils";
import { createClearingHouseFixture } from "../shared/perpFixture/fixtures_local";
import bn from "bignumber.js";
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

const isUsdlCollateralTailAsset = true; 

const ZERO = BigNumber.from("0");

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
  // Quoter,
  CollateralManager,
} from "../../perp-lushan/typechain";
import { QuoteToken } from "../../perp-lushan/typechain/QuoteToken";
import { TestPerpLemma } from "../../types/TestPerpLemma";

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
  // let quoter: Quoter;
  let perpLemma: any;
  let usdCollateralDecimals: number;
  let ethCollateralDecimals: number;

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
    // quoter = _clearingHouseFixture.quoter;
    usdCollateralDecimals = await usdCollateral.decimals();
    ethCollateralDecimals = await ethCollateral.decimals();

    const trustedForwarder = ethers.constants.AddressZero;
    const maxPosition = ethers.constants.MaxUint256;
    const perpLemmaFactory = await ethers.getContractFactory("PerpLemmaCommon");

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
    )) as TestPerpLemma;
    await perpLemma.connect(signer1).resetApprovals();
    // base = eth
    // quote = usd

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
    await mockedBaseAggregator.setLatestRoundData(0, ethPrice, 0, 0, 0);
    let ethPrice_1e18 = new bn(price).multipliedBy(1e30).toFixed(0).toString();
    return [ethPrice, ethPrice_1e18];
  }

  async function tradeLongWExactCollateral(isOpen, collateralAmount) {  
    // let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
    await usdCollateral.mint(usdLemma.address, collateralAmount);
  
    // // NOTE: This is not zero since we start by depositing a bunch of USDC because of the assumption we make in the tail asset case
    // const initialVaultBalance = parseUnits((await vault.getBalance(perpLemma.address)).toString(), 0);
  
    // transfer Collateral to perpLemma
    const initialBefore = (await usdCollateral.balanceOf(perpLemma.address)).toString();
    // console.log(`T1 initialBefore = ${initialBefore}`);
    // expect(parseUnits(initialBefore, 0)).to.eq(ZERO);
  
    // Open a Long Position --> This is done manually in these tests but in reality it does done automatically by USDLemma.sol contract
    // 1. Transfer collateral
    await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
    const initialUsdcBalance = (await usdCollateral.balanceOf(perpLemma.address)).toString();
    console.log(`[tradeLongWExactCollateral()] T1 initialUsdcBalance = ${initialUsdcBalance}`);
    // expect(parseUnits(initialUsdcBalance, 0)).to.eq(collateralAmount);
    // console.log("T2");
  
    const baseAmount_1e18 = collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals));
    // Simulate the trade to know the reference value for the comparison
    let baseAndQuoteValue = await callStaticOpenPosition(
      clearingHouse,
      longAddress,
      baseToken.address,
      !isOpen,
      !isOpen, // true,
      baseAmount_1e18,
      // collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
    ); // index0: base/usd, index1: quote/eth
  
    // 2. Open the Position on the underlying Perp
    await expect(
      perpLemma
        .connect(usdLemma)
        .trade(
          baseAmount_1e18,
          // collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)), 
          !isOpen, 
          !isOpen),
    ).to.emit(clearingHouse, "PositionChanged");
  
    // await expect(
    //   perpLemma
    //     .connect(usdLemma)
    //     .openLongWithExactCollateral(collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals))),
    // ).to.emit(clearingHouse, "PositionChanged");
  
    // 3. Cover the position with collateral
    if(isOpen) {
      await perpLemma.connect(usdLemma).deposit(collateralAmount, usdCollateral.address);
    }
    else {
      await perpLemma.connect(usdLemma).withdraw(collateralAmount, usdCollateral.address);
    }

    return baseAndQuoteValue;  
  }  
  
  // NOTE: Compute leverage in 1e6 format
  // NOTE: For longs, we do not actually need to check the leverage == 1 since we are not trying to be delta neutral, we just want to know if we are far enough from margin call to avoid liquidation so 
  // Should we use `getMarginRequirementForLiquidation()` instead ? 
  // https://github.com/yashnaman/perp-lushan/blob/main/contracts/AccountBalance.sol#L225
  async function calcLeverage() {
    // Return the position in Quote Token using the TWAP on the Index Price --> maybe better than the vAMM one? 
    const positionValue = parseUnits((await accountBalance.getTotalPositionValue(perpLemma.address, baseToken.address)).abs().toString(), 0);   // Probably in Base
    const depositedCollateral = parseUnits((await vault.getBalance(perpLemma.address)).toString(), 0);                                  // Probably in Quote
    return positionValue.mul(1e6).div(depositedCollateral);
  }

  async function calcLeverage1() {
    const positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
    let depositedCollateral = await vault.getBalance(perpLemma.address);
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
      depositedCollateral = depositedCollateral.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals));
      const leverage = depositedCollateral.mul(BigNumber.from(usdcPriceInEth)).div(positionSize);
      // console.log('leverage', leverage.toString())
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
      const fees = await perpLemma.getFees(baseToken.address);
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





        // NOTE: If working with tail assets, deposit a large initial amount of USDC 
        if(isUsdlCollateralTailAsset) {
          // NOTE: Setting USDL collateral as tail asset 
          await perpLemma.setIsUsdlCollateralTailAsset(true);

          // // NOTE: Also Synth Collateral can be anything
          // await perpLemma.setIsSynthCollateralTailAsset(true);

          // NOTE: This is because we assume we have plenty of USDC deposited in Perp when working with tail assets 
          const initialDepositedUsdcAmount = parseEther("10");
          await usdCollateral.mint(signer1.address, initialDepositedUsdcAmount);
          await usdCollateral.connect(signer1).approve(perpLemma.address, initialDepositedUsdcAmount);
          await perpLemma.connect(signer1).depositSettlementToken(initialDepositedUsdcAmount);
          
          const depositedCollateral = parseUnits((await vault.getBalance(perpLemma.address)).toString(), 0);
          expect(depositedCollateral).to.eq(initialDepositedUsdcAmount);
          // perpLemma.connect(signer1).setIsUsdlCollateralTailAsset(true);
          // const initialUsdcAmount = parseEther("100");
          // usdCollateral.mint(perpLemma.address, initialUsdcAmount);
          // perpLemma.connect(signer1).depositSettlementToken(initialUsdcAmount);
        }

      });


      // PASSING 
      it("should set addresses correctly", async function () {
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
        let collateralAmount = parseUnits("1", usdCollateralDecimals);
        await perpLemma.setMaxPosition(parseUnits("0.9", usdCollateralDecimals));
        await usdCollateral.mint(usdLemma.address, collateralAmount.add(1));
        await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount.add(1));
        collateralAmount = parseUnits("1", ethCollateralDecimals);

        // const positionSize = parseUnits((await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)).toString(), 0);
        // expect(positionSize).to.eq(parseUnits("9899999990199000", 0));

        // NOTE: Comparing Position Sizes with and without tail assets on the Solidity side 
        // Tail Asset 
        // [openLongWithExactCollateral()] positionSize.abs().toUint256() =  9899999990199000
        // 
        // Non Tail Asset 
        // [openLongWithExactCollateral()] positionSize.abs().toUint256() =  9899999990199000

        await expect(perpLemma.connect(usdLemma).trade(collateralAmount, false, false)).to.be.revertedWith(
          "max position reached",
        );

        // await expect(perpLemma.connect(usdLemma).openLongWithExactCollateral(collateralAmount)).to.be.revertedWith(
        //   "max position reached",
        // );
      });

      it("should open and close position correctly", async function () {
        let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
        await usdCollateral.mint(usdLemma.address, collateralAmount);

        // NOTE: This is not zero since we start by depositing a bunch of USDC because of the assumption we make in the tail asset case
        const initialVaultBalance = parseUnits((await vault.getBalance(perpLemma.address)).toString(), 0);

        // transfer Collateral to perpLemma
        const initialBefore = (await usdCollateral.balanceOf(perpLemma.address)).toString();
        console.log(`T1 initialBefore = ${initialBefore}`);
        expect(parseUnits(initialBefore, 1)).to.eq(parseUnits("0", 1));

        // Open a Long Position --> This is done manually in these tests but in reality it does done automatically by USDLemma.sol contract
        // 1. Transfer collateral
        await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
        const initialUsdcBalance = (await usdCollateral.balanceOf(perpLemma.address)).toString();
        console.log(`T2 initialUsdcBalance = ${initialUsdcBalance}`);
        expect(parseUnits(initialUsdcBalance, 0)).to.eq(collateralAmount);
        console.log("T2");

        const baseAmount_1e18 = collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals));
        // Simulate the trade to know the reference value for the comparison
        let baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          false, // true,
          baseAmount_1e18,
          // collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
        ); // index0: base/usd, index1: quote/eth

        // 2. Open the Position on the underlying Perp
        await expect(
          perpLemma
            .connect(usdLemma)
            .trade(
              baseAmount_1e18,
              // collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)), 
              false, 
              false),
        ).to.emit(clearingHouse, "PositionChanged");

        // await expect(
        //   perpLemma
        //     .connect(usdLemma)
        //     .openLongWithExactCollateral(collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals))),
        // ).to.emit(clearingHouse, "PositionChanged");

        // 3. Cover the position with collateral
        await perpLemma.connect(usdLemma).deposit(collateralAmount, usdCollateral.address);


        console.log("T3");
        // NOTE: Checking that tail asset remains in PerpLemma
        const balanceAfter = (await usdCollateral.balanceOf(perpLemma.address)).toString();
        console.log(`T3 balanceAfter = ${balanceAfter}`);
        const expectedBalanceAfter = (isUsdlCollateralTailAsset) ? collateralAmount : ZERO;
        // NOTE: Checking all the collateral has been deposited in Perp
        expect(parseUnits(balanceAfter, 0)).to.eq(expectedBalanceAfter);
        // expect(parseUnits(balanceAfter, 0)).to.eq(collateralAmount);

        console.log("T6");
        const vaultBalance = parseUnits((await vault.getBalance(perpLemma.address)).toString(), 0);
        const expectedVaultBalance = (isUsdlCollateralTailAsset) ? ZERO : expectedBalanceAfter;
        // NOTE: In the tail asset case, the collateral does not get deposited in the Vault
        expect(vaultBalance.sub(initialVaultBalance)).to.eq(expectedVaultBalance);
        // expect(vaultBalance).to.eq(collateralAmount);

        console.log("T7");
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(baseAndQuoteValue[0]).to.eq(positionSize);
        console.log("T9");
        const lev1 = await calcLeverage();
        console.log(`T10 Leverafe = ${lev1}`);

        // NOTE: If USDL Collateral is tail asset, the amount of USDC is deposited in advance is big and biases the leverage
        if(!isUsdlCollateralTailAsset) {
          expect(lev1).to.eq(1e6);
        }


        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize,
        );

        // long eth and close position, withdraw ethCollateral
        await expect(await perpLemma.connect(usdLemma).trade(baseAndQuoteValue[0], true, true)).to.emit(
          clearingHouse,
          "PositionChanged",
        );


        // await expect(await perpLemma.connect(usdLemma).closeShortWithExactCollateral(baseAndQuoteValue[1])).to.emit(
        //   clearingHouse,
        //   "PositionChanged",
        // );
        console.log("T10");
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(positionSize).to.eq(0);
        console.log("T11");

        // NOTE: Removing because the vault balance is altered by the initial USDC amount we deposit for the tail asset assumption
        // expect(await vault.getBalance(perpLemma.address)).to.closeTo("2", "1"); // consider to be fee
        // console.log("T12");
        const finalUsdcBalance = await usdCollateral.balanceOf(perpLemma.address);
        expect(finalUsdcBalance).to.be.equal(initialUsdcBalance);
        console.log("T15");
      });


      it("#1 openLongWithExactCollateral and closeLongWithExactCollateral", async function () {
        let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
        // NOTE: This is not zero since we start by depositing a bunch of USDC because of the assumption we make in the tail asset case
        const initialVaultBalance = parseUnits((await vault.getBalance(perpLemma.address)).toString(), 0); 

        // Open Long With Exact Collateral
        let baseAndQuoteValue = await tradeLongWExactCollateral(true, collateralAmount);

        console.log("T3");
        // NOTE: Checking that tail asset remains in PerpLemma
        const balanceAfter = (await usdCollateral.balanceOf(perpLemma.address)).toString();
        console.log(`T3 balanceAfter = ${balanceAfter}`);
        const expectedBalanceAfter = (isUsdlCollateralTailAsset) ? collateralAmount : ZERO;
        // NOTE: Checking all the collateral has been deposited in Perp
        expect(parseUnits(balanceAfter, 0)).to.eq(expectedBalanceAfter);
        // expect(parseUnits(balanceAfter, 0)).to.eq(collateralAmount);

        console.log("T6");
        const vaultBalance = parseUnits((await vault.getBalance(perpLemma.address)).toString(), 0);
        const expectedVaultBalance = (isUsdlCollateralTailAsset) ? ZERO : expectedBalanceAfter;
        // NOTE: In the tail asset case, the collateral does not get deposited in the Vault
        expect(vaultBalance.sub(initialVaultBalance)).to.eq(expectedVaultBalance);
        // expect(vaultBalance).to.eq(collateralAmount);

        console.log("T7");
        let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(baseAndQuoteValue[0]).to.eq(positionSize);
        console.log("T9");
        await calcLeverage();

        // Close Long With Exact Collateral
        baseAndQuoteValue = await tradeLongWExactCollateral(false, collateralAmount);

        // await expect(await perpLemma.connect(usdLemma).closeShortWithExactCollateral(baseAndQuoteValue[1])).to.emit(
        //   clearingHouse,
        //   "PositionChanged",
        // );
        console.log("T10");
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(positionSize).to.eq(0);
        console.log("T11");

        // NOTE: Removing because the vault balance is altered by the initial USDC amount we deposit for the tail asset assumption
        // expect(await vault.getBalance(perpLemma.address)).to.closeTo("2", "1"); // consider to be fee
        // console.log("T12");
        const finalUsdcBalance = await usdCollateral.balanceOf(perpLemma.address);
        console.log("T15");
      });


      // // getCollateralAmountGivenUnderlyingAssetAmountForPerp => gCAGUAA
      // it("#2 openLongWithExactCollateral and gCAGUAA => close ", async function () {
      //   collateralAmountForUSDC = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //   await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmountForUSDC);

      //   // open
      //   let baseAndQuoteValue = await callStaticOpenPosition(
      //     clearingHouse,
      //     longAddress,
      //     baseToken.address,
      //     false,
      //     false, // true,
      //     collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //   ); // index0: base/usd, index1: quote/eth

      //   // Deposit ethCollateral in eth and Short eth and long usdc
      //   await expect(
      //     perpLemma
      //       .connect(usdLemma)
      //       .trade(collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)), false, false),
      //   ).to.emit(clearingHouse, "PositionChanged");

      //   // await expect(
      //   //   perpLemma
      //   //     .connect(usdLemma)
      //   //     .openLongWithExactCollateral(
      //   //       collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //   //     ),
      //   // ).to.emit(clearingHouse, "PositionChanged");
      //   let leverage = await calcLeverage();
      //   expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

      //   // close
      //   let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //   baseAndQuoteValue = await callStaticOpenPosition(
      //     clearingHouse,
      //     longAddress,
      //     baseToken.address,
      //     true,
      //     true,
      //     positionSize,
      //   ); // index0: base/usd, index1: quote/eth

      //   await expect(await perpLemma.connect(usdLemma).trade(baseAndQuoteValue[0], true, true)).to.emit(
      //     clearingHouse,
      //     "PositionChanged",
      //   );
        
      //   // await expect(
      //   //   perpLemma.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmountForPerp(baseAndQuoteValue[0], true, false),
      //   // ).to.emit(clearingHouse, "PositionChanged");
      //   // await expect(perpLemma.connect(usdLemma).closeShortWithExactBaseForSynth(0, 0)).to.be.revertedWith("Amount should greater than zero");
      //   // await perpLemma.connect(usdLemma).closeShortWithExactBaseForSynth(0, baseAndQuoteValue[1]);
      //   leverage = await calcLeverage();
      //   expect(leverage).to.eq(0);
      // });



      // // getCollateralAmountGivenUnderlyingAssetAmountForPerp => gCAGUAA
      // it("#3 gCAGUAA -> open and gCAGUAA -> close ", async function () {
      //   collateralAmountForUSDC = parseUnits("100", usdCollateralDecimals); // 6 decimal

      //   await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmountForUSDC);

      //   // open
      //   let baseAndQuoteValue = await callStaticOpenPosition(
      //     clearingHouse,
      //     longAddress,
      //     baseToken.address,
      //     false,
      //     true,
      //     collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //   ); // index0: base/usd, index1: quote/eth
      //   // Deposit ethCollateral in eth and Short eth and long usdc
      //   await expect(
      //     perpLemma
      //       .connect(usdLemma)
      //       .openLongWithExactCollateral(
      //         collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //       ),
      //   ).to.emit(clearingHouse, "PositionChanged");

      //   await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmountForUSDC);
      //   // open
      //   baseAndQuoteValue = await callStaticOpenPosition(
      //     clearingHouse,
      //     longAddress,
      //     baseToken.address,
      //     false,
      //     true,
      //     collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //   ); // index0: base/usd, index1: quote/eth

      //   // Deposit ethCollateral in eth and Short eth and long usdc
      //   await expect(
      //     perpLemma.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmountForPerp(baseAndQuoteValue[0], false, false),
      //   ).to.emit(clearingHouse, "PositionChanged");

      //   await expect(perpLemma.connect(usdLemma).openLongWithExactBaseForSynth(0, 0)).to.be.revertedWith("Amount should greater than zero");
      //   await expect(perpLemma.connect(usdLemma).openLongWithExactBaseForSynth(0, baseAndQuoteValue[1].mul(2))).to.be.revertedWith(
      //     "not enough collateral",
      //   );
      //   await perpLemma.connect(usdLemma).openLongWithExactBaseForSynth(0, baseAndQuoteValue[1]);
      //   let leverage = await calcLeverage();
      //   expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

      //   // close
      //   let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //   baseAndQuoteValue = await callStaticOpenPosition(
      //     clearingHouse,
      //     longAddress,
      //     baseToken.address,
      //     true,
      //     true,
      //     positionSize,
      //   ); // index0: base/usd, index1: quote/eth

      //   await expect(
      //     perpLemma.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmountForPerp(baseAndQuoteValue[0], true, false),
      //   ).to.emit(clearingHouse, "PositionChanged");

      //   await expect(perpLemma.connect(usdLemma).closeShortWithExactBaseForSynth(0, 0)).to.be.revertedWith("Amount should greater than zero");
      //   await perpLemma.connect(usdLemma).closeShortWithExactBaseForSynth(0, baseAndQuoteValue[1]);
      //   leverage = await calcLeverage();
      //   expect(leverage).to.eq(0);
      // });
      // // getCollateralAmountGivenUnderlyingAssetAmountForPerp => gCAGUAA
      // it("#4 gCAGUAA -> open and closeShortWithExactCollateral ", async function () {
      //   collateralAmountForUSDC = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //   await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmountForUSDC);

      //   // open
      //   let baseAndQuoteValue = await callStaticOpenPosition(
      //     clearingHouse,
      //     longAddress,
      //     baseToken.address,
      //     false,
      //     true,
      //     collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //   ); // index0: base/usd, index1: quote/eth
      //   // Deposit ethCollateral in eth and Short eth and long usdc
      //   await expect(
      //     perpLemma
      //       .connect(usdLemma)
      //       .openLongWithExactCollateral(
      //         collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //       ),
      //   ).to.emit(clearingHouse, "PositionChanged");

      //   await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmountForUSDC);
      //   // open
      //   baseAndQuoteValue = await callStaticOpenPosition(
      //     clearingHouse,
      //     longAddress,
      //     baseToken.address,
      //     false,
      //     true,
      //     collateralAmountForUSDC.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //   ); // index0: base/usd, index1: quote/eth

      //   // Deposit ethCollateral in eth and Short eth and long usdc
      //   await expect(
      //     perpLemma.connect(usdLemma).getCollateralAmountGivenUnderlyingAssetAmountForPerp(baseAndQuoteValue[0], false, false),
      //   ).to.emit(clearingHouse, "PositionChanged");

      //   await expect(perpLemma.connect(usdLemma).openLongWithExactBaseForSynth(0, 0)).to.be.revertedWith("Amount should greater than zero");
      //   await expect(perpLemma.connect(usdLemma).openLongWithExactBaseForSynth(0, baseAndQuoteValue[1].mul(2))).to.be.revertedWith(
      //     "not enough collateral",
      //   );
      //   await perpLemma.connect(usdLemma).openLongWithExactBaseForSynth(0, baseAndQuoteValue[1]);
      //   let leverage = await calcLeverage();
      //   expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

      //   // close
      //   let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //   baseAndQuoteValue = await callStaticOpenPosition(
      //     clearingHouse,
      //     longAddress,
      //     baseToken.address,
      //     true,
      //     true,
      //     positionSize,
      //   );
      //   await expect(await perpLemma.connect(usdLemma).closeShortWithExactCollateral(baseAndQuoteValue[1].div(2)));
      //   leverage = await calcLeverage();
      //   expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
      // });

      // describe("OpenPosition leverage test", () => {
      //   let collateralToGetBack_1e6, collateralToGetBack_1e18;
      //   beforeEach(async function () {
      //     let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //     await usdCollateral.mint(usdLemma.address, collateralAmount);
      //     await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
      //   });

      //   it("openPosition => emit event PositionChanged", async () => {
      //     let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //     await usdCollateral.mint(usdLemma.address, collateralAmount);
      //     let baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       false,
      //       true,
      //       collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //     ); // index0: base/usd, index1: quote/eth
      //     // Deposit ethCollateral in eth and Short eth and long usdc
      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .openLongWithExactCollateral(
      //           collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)).mul(2),
      //         ),
      //     ).to.be.revertedWith("Not enough collateral for openLongWithExactCollateral");
      //     await expect(perpLemma.connect(usdLemma).openLongWithExactCollateral(0)).to.be.revertedWith(
      //       "Amount should greater than zero",
      //     );
      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .openLongWithExactCollateral(collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals))),
      //     )
      //       .to.emit(clearingHouse, "PositionChanged")
      //       .withArgs(
      //         perpLemma.address, // Trader
      //         baseToken.address, // Market --> vETH
      //         parseUnits("989999901990009702", 0), // Position, negative because of short?
      //         parseUnits("-99000000000000000000", 0), // Notional
      //         parseUnits("1000000000000000000", 0), // Fee
      //         parseUnits("-100000000000000000000", 0), // OpenNotional
      //         0, // PnlToBeRealized
      //         parseUnits("792281703578524265057133720541", 0), // sqrtPriceAfterX96
      //       );
      //     let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //     expect(positionSize).to.eq(baseAndQuoteValue[0]);
      //     expect(await vault.getBalance(perpLemma.address)).to.eq(collateralAmount); // consider to be fee
      //     expect(await ethCollateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
      //   });

      //   it("openPosition => leverage should be 1x", async () => {
      //     let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //     await usdCollateral.mint(usdLemma.address, collateralAmount);
      //     let baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       false,
      //       true,
      //       collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //     ); // index0: base/usd, index1: quote/eth
      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .openLongWithExactCollateral(collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals))),
      //     )
      //       .to.emit(clearingHouse, "PositionChanged")
      //       .withArgs(
      //         perpLemma.address, // Trader
      //         baseToken.address, // Market --> vETH
      //         parseUnits("989999901990009702", 0), // Position, negative because of short?
      //         parseUnits("-99000000000000000000", 0), // Notional
      //         parseUnits("1000000000000000000", 0), // Fee
      //         parseUnits("-100000000000000000000", 0), // OpenNotional
      //         0, // PnlToBeRealized
      //         parseUnits("792281703578524265057133720541", 0), // sqrtPriceAfterX96
      //       );
      //     let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //     expect(positionSize).to.eq(baseAndQuoteValue[0]);
      //     expect(await vault.getBalance(perpLemma.address)).to.eq(collateralAmount); // consider to be fee
      //     expect(await ethCollateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
      //     let leverage = await calcLeverage();
      //     expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
      //   });
      // });

      // describe("Open and close Position test variation", () => {
      //   let collateralmintAmount;
      //   beforeEach(async function () {
      //     let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //     await usdCollateral.mint(usdLemma.address, collateralAmount);
      //     await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
      //   });

      //   it("openPosition => open position for short and close position for 2 time longs", async () => {
      //     let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //     await ethCollateral.mint(usdLemma.address, collateralAmount);

      //     let baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       false,
      //       true,
      //       collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //     ); // index0: base/usd, index1: quote/eth
      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .openLongWithExactCollateral(
      //           collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)).mul(2),
      //         ),
      //     ).to.be.revertedWith("Not enough collateral for openLongWithExactCollateral");
      //     await expect(perpLemma.connect(usdLemma).openLongWithExactCollateral(0)).to.be.revertedWith(
      //       "Amount should greater than zero",
      //     );
      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .openLongWithExactCollateral(collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals))),
      //     ).to.emit(clearingHouse, "PositionChanged");

      //     let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //     expect(positionSize).to.eq(baseAndQuoteValue[0]);
      //     expect(await vault.getBalance(perpLemma.address)).to.eq(collateralAmount); // consider to be fee
      //     expect(await ethCollateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
      //     let leverage = await calcLeverage();
      //     expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

      //     // #1
      //     baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       true,
      //       true,
      //       positionSize.div(2),
      //     );

      //     await expect(perpLemma.connect(usdLemma).closeShortWithExactCollateral(0)).to.be.revertedWith("AS");
      //     await expect(perpLemma.connect(usdLemma).closeShortWithExactCollateral(baseAndQuoteValue[1])).to.emit(
      //       clearingHouse,
      //       "PositionChanged",
      //     );

      //     // #2
      //     baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       true,
      //       true,
      //       positionSize.div(2),
      //     );

      //     await expect(perpLemma.connect(usdLemma).closeShortWithExactCollateral(baseAndQuoteValue[1])).to.emit(
      //       clearingHouse,
      //       "PositionChanged",
      //     );

      //     positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //     expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
      //     expect(positionSize).to.eq(0);
      //     expect(await vault.getBalance(perpLemma.address)).to.closeTo("2", "1"); // consider to be fee
      //     expect(await ethCollateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
      //   });

      //   it("openPosition => open position for short and close position for long", async () => {
      //     let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //     await usdCollateral.mint(usdLemma.address, collateralAmount);
      //     let baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       false,
      //       true,
      //       collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //     ); // index0: base/usd, index1: quote/eth
      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .openLongWithExactCollateral(collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals))),
      //     ).to.emit(clearingHouse, "PositionChanged");

      //     let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //     expect(positionSize).to.eq(baseAndQuoteValue[0]);
      //     expect(await vault.getBalance(perpLemma.address)).to.eq(collateralAmount); // consider to be fee
      //     let leverage = await calcLeverage();
      //     expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

      //     baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       true,
      //       true,
      //       positionSize,
      //     );

      //     await expect(perpLemma.connect(usdLemma).closeShortWithExactCollateral(baseAndQuoteValue[1])).to.emit(
      //       clearingHouse,
      //       "PositionChanged",
      //     );
      //     positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //     expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
      //     expect(positionSize).to.eq(0);
      //     expect(await vault.getBalance(perpLemma.address)).to.closeTo("2", "1"); // consider to be fee
      //     expect(await ethCollateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
      //   });
      // });

      // describe("OpenWExactCollateral and CloseWExactCollateral", async function () {
      //   it("Basic Open", async () => {
      //     let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //     await usdCollateral.mint(usdLemma.address, collateralAmount);
      //     await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
      //     let baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       false,
      //       true,
      //       collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //     ); // index0: base/usd, index1: quote/eth
      //     expect(await ethCollateral.balanceOf(perpLemma.address)).to.equal(0);
      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .openLongWithExactCollateral(collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals))),
      //     ).to.emit(clearingHouse, "PositionChanged");
      //     let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //     expect(positionSize).to.eq(baseAndQuoteValue[0]);
      //     expect(await vault.getBalance(perpLemma.address)).to.eq(collateralAmount); // consider to be fee
      //     let leverage = await calcLeverage();
      //     expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);
      //   });

      //   it("Basic Open and Close, Checking the lost ethCollateral should be < 5%", async () => {
      //     let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //     await usdCollateral.mint(usdLemma.address, collateralAmount);
      //     await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
      //     let baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       false,
      //       true,
      //       collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //     ); // index0: base/usd, index1: quote/eth
      //     const lemmaEthBalance1 = await ethCollateral.balanceOf(usdLemma.address);
      //     expect(await ethCollateral.balanceOf(perpLemma.address)).to.equal(0);
      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .openLongWithExactCollateral(collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals))),
      //     ).to.emit(clearingHouse, "PositionChanged");

      //     expect(await ethCollateral.balanceOf(perpLemma.address)).to.eq(0);
      //     expect(await vault.getBalance(perpLemma.address)).to.eq(collateralAmount); // consider to be fee
      //     let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //     expect(positionSize).to.eq(baseAndQuoteValue[0]);
      //     baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       true,
      //       true,
      //       positionSize,
      //     );
      //     // collateralAmount = baseAndQuoteValue[1].mul(parseEther("1")).div(parseEther("0.99"));

      //     await expect(perpLemma.connect(usdLemma).closeShortWithExactCollateral(baseAndQuoteValue[1])).to.emit(
      //       clearingHouse,
      //       "PositionChanged",
      //     );
      //     positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //     expect(positionSize).to.eq(0);
      //     expect(await vault.getBalance(perpLemma.address)).to.closeTo("2", "1"); // consider to be fee
      //     expect(await ethCollateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);

      //     // const lemmaEthBalance2 = await ethCollateral.balanceOf(usdLemma.address);
      //     // const deltaBalance = lemmaEthBalance2.sub(lemmaEthBalance1);
      //     // const lostCollateral = collateralAmount.sub(deltaBalance);
      //     // const percLostCollateral = lostCollateral.div(collateralAmount);
      //     // const amt = collateralAmount.mul(BigNumber.from(5).div(100));
      //     // // Checking the lost ethCollateral is < 5% of the initial amount
      //     // expect(collateralAmount.sub(deltaBalance)).to.below(collateralAmount.mul(5).div(100));
      //   });
      // });

      // describe("Emergency Settlement", async function () {
      //   beforeEach(async function () {});

      //   it("Calling Settle() when Market is open should revert", async () => {
      //     // By default the market is open
      //     await expect(perpLemma.connect(usdLemma).settle()).to.be.revertedWith("CH_MNC");
      //   });

      //   it("Calling Settle() when Market is paused should revert", async () => {
      //     // Pausing the market
      //     expect(await baseToken.connect(defaultSigner)["pause()"]())
      //       .to.emit(baseToken, "StatusUpdated")
      //       .withArgs(1);
      //     await expect(perpLemma.connect(usdLemma).settle()).to.be.revertedWith("CH_MNC");
      //   });

      //   it("Calling Settle() when Market is closed should work", async () => {
      //     let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //     await usdCollateral.mint(usdLemma.address, collateralAmount);
      //     await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
      //     // Deposit ethCollateral in eth and Short eth and long usdc
      //     await perpLemma
      //       .connect(usdLemma)
      //       .openLongWithExactCollateral(collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)));
      //     expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
      //     // Closing the market
      //     expect(await baseToken.connect(defaultSigner)["close(uint256)"](parseEther("100"))).to.emit(
      //       baseToken,
      //       "StatusUpdated",
      //     );

      //     const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
      //     await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));
      //     await expect(perpLemma.connect(usdLemma).settle())
      //       .to.emit(vault, "Withdrawn")
      //       .withArgs(usdCollateral.address, perpLemma.address, parseUnits("98999991", 0));
      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .openLongWithExactCollateral(collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals))),
      //     ).to.be.revertedWith("Market Closed");
      //   });

      //   it("Open a Position and Calling Settle() when Market is closed should work", async () => {
      //     let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //     await usdCollateral.mint(usdLemma.address, collateralAmount);
      //     await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
      //     let baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       false,
      //       true,
      //       collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //     ); // index0: base/usd, index1: quote/eth

      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .openLongWithExactCollateral(collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals))),
      //     ).to.emit(clearingHouse, "PositionChanged");

      //     // let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //     // expect(positionSize).to.eq(baseAndQuoteValue[0]);
      //     // expect(await vault.getBalance(perpLemma.address)).to.eq(collateralAmount); // consider to be fee
      //     // let leverage = await calcLeverage();
      //     // expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

      //     // expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
      //     // expect(await baseToken.connect(defaultSigner)["close(uint256)"](parseEther("100"))).to.emit(
      //     //   baseToken,
      //     //   "StatusUpdated",
      //     // );
      //     // const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
      //     // await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));

      //     // await expect(perpLemma.connect(usdLemma).settle())
      //     //   .to.emit(vault, "Withdrawn")
      //     //   .withArgs(usdCollateral.address, perpLemma.address, parseUnits("98999991", 0)); // 999999

      //     // This is not passing as
      //     // Initial Collateral: 100000000000
      //     // Actual Collateral: 99901980199
      //     // So the Vault has less ethCollateral than when it started
      //     //expect(await ethCollateral.balanceOf(vault.address)).to.equal(initialVaultCollateral);
      //   });

      //   it("Test Settle and Withdraw Collateral for 2 Users", async () => {
      //     let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //     await usdCollateral.mint(usdLemma.address, collateralAmount);
      //     await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);

      //     let baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       false,
      //       true,
      //       collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //     ); // index0: base/usd, index1: quote/eth

      //     // 3.2 LemmaETH calls PerpLemma Open to open a position at the PerpV2 Clearing House
      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .openLongWithExactCollateral(
      //           collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals))
      //         ),
      //     ).to.emit(clearingHouse, "PositionChanged");

      //     let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //     expect(positionSize).to.eq(baseAndQuoteValue[0]);
      //     expect(await vault.getBalance(perpLemma.address)).to.eq(collateralAmount); // consider to be fee
      //     let leverage = await calcLeverage();
      //     expect(BigNumber.from(leverage).div(parseEther("1"))).to.eq(1);

      //     // Start with Market Open
      //     expect(await baseToken.isOpen()).to.be.equal(true);

      //     // Pause Market
      //     expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
      //     expect(await baseToken.callStatic.isPaused()).to.be.equal(true);

      //     // Close Market
      //     expect(await baseToken.connect(defaultSigner)["close(uint256)"](parseEther("100"))).to.emit(
      //       baseToken,
      //       "StatusUpdated",
      //     );
      //     expect(await baseToken.callStatic.isClosed()).to.be.equal(true);

      //     const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
      //     await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));
      //     await perpLemma.connect(usdLemma).settle();

      //     let collateralPerpLemma = await usdCollateral.balanceOf(perpLemma.address);
      //     // const c1 = collateralPerpLemma * 0.2;
      //     const c1 = collateralPerpLemma.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals));

      //     // console.log('collateralPerpLemma:', collateralPerpLemma.toString(), c1.toString());
      //     // const c1_1e18 = parseEther(c1.toString()).div(parseUnits("1", ethCollateralDecimals));
      //     // console.log('c1_1e18: ', c1.div(2).toString());

      //     await expect(perpLemma.connect(usdLemma).closeShortWithExactCollateral(c1.div(2))).to.emit(usdCollateral, "Transfer");

      //     collateralPerpLemma = await usdCollateral.balanceOf(perpLemma.address);
      //     expect(await usdCollateral.balanceOf(perpLemma.address)).to.not.equal(0);

      //     const c2 = collateralPerpLemma.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals));
      //     const c2_1e18 = parseEther(c2.toString()).div(parseUnits("1", ethCollateralDecimals));
      //     // console.log('c2_1e18: ', c2_1e18.toString());

      //     await expect(perpLemma.connect(usdLemma).closeShortWithExactCollateral(c2_1e18)).to.emit(usdCollateral, "Transfer");
      //     expect(await usdCollateral.balanceOf(perpLemma.address)).to.equal(0);
      //   });

      //   it("Test Settle and Withdraw Collateral for 2 Users, using close method", async () => {
      //     let collateralAmount = parseUnits("100", usdCollateralDecimals); // 6 decimal
      //     await usdCollateral.mint(usdLemma.address, collateralAmount);
      //     await usdCollateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);

      //     let baseAndQuoteValue = await callStaticOpenPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       false,
      //       true,
      //       collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)),
      //     ); // index0: base/usd, index1: quote/eth

      //     // 3.2 LemmaETH calls PerpLemma Open to open a position at the PerpV2 Clearing House
      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .openLongWithExactCollateral(collateralAmount.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals))),
      //     ).to.emit(clearingHouse, "PositionChanged");

      //     expect(await usdCollateral.balanceOf(perpLemma.address)).to.eq(0);
      //     expect(await vault.getBalance(perpLemma.address)).to.eq(collateralAmount); // consider to be fee
      //     let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      //     expect(positionSize).to.eq(baseAndQuoteValue[0]);

      //     // Start with Market Open
      //     expect(await baseToken.isOpen()).to.be.equal(true);

      //     // Pause Market
      //     expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
      //     expect(await baseToken.callStatic.isPaused()).to.be.equal(true);

      //     // Close Market
      //     expect(await baseToken.connect(defaultSigner)["close(uint256)"](parseEther("100"))).to.emit(
      //       baseToken,
      //       "StatusUpdated",
      //     );
      //     expect(await baseToken.callStatic.isClosed()).to.be.equal(true);

      //     const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
      //     await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));
      //     await perpLemma.connect(usdLemma).settle();

      //     let lemmaEthBalBefore = await usdCollateral.balanceOf(usdLemma.address);
      //     let positionAtSettlementInQuoteForSynth = await perpLemma.positionAtSettlementInQuoteForSynth();
      //     await perpLemma
      //       .connect(usdLemma)
      //       .getCollateralAmountGivenUnderlyingAssetAmountForPerp(
      //         positionAtSettlementInQuoteForSynth.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)).div(2),
      //         true,
      //         false
      //       );
      //     await perpLemma
      //       .connect(usdLemma)
      //       .getCollateralAmountGivenUnderlyingAssetAmountForPerp(
      //         positionAtSettlementInQuoteForSynth.mul(parseEther("1")).div(parseUnits("1", usdCollateralDecimals)).div(2),
      //         true,
      //         false
      //       );
      //     let lemmaEthBalAfter = await usdCollateral.balanceOf(usdLemma.address);
      //     expect(await usdCollateral.balanceOf(perpLemma.address)).to.equal(1);
      //     expect(lemmaEthBalAfter.sub(lemmaEthBalBefore)).to.equal(parseUnits("98999990", 0));
      //   });
      // });

      // describe("Rebalance Tests", () => {
      //   const sqrtPriceLimitX96 = 0;
      //   const deadline = ethers.constants.MaxUint256;
      //   before(async function () {
      //     await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);
      //   });

      //   it("Force error for LemmaETH and rebalancer address", async () => {
      //     await expect(
      //       perpLemma.reBalance(
      //         reBalancer.address,
      //         1,
      //         ethers.utils.defaultAbiCoder.encode(["uint160", "uint256", "bool"], [sqrtPriceLimitX96, deadline, false]),
      //       ),
      //     ).to.be.revertedWith("only usdLemma is allowed");
      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .reBalance(
      //           defaultSigner.address,
      //           1,
      //           ethers.utils.defaultAbiCoder.encode(["uint160", "uint256", "bool"], [sqrtPriceLimitX96, deadline, false]),
      //         ),
      //     ).to.be.revertedWith("only rebalancer is allowed");
      //   });

      //   it("#Force Error, not allowed", async () => {
      //     await openPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       false,
      //       true,
      //       parseUnits("3000", ethCollateralDecimals),
      //     );
      //     await usdCollateral.connect(usdLemma).transfer(perpLemma.address, parseUnits("20000", usdCollateralDecimals));

      //     await perpLemma.connect(usdLemma).openLongWithExactCollateral(parseUnits("99", ethCollateralDecimals));
      //     await ethers.provider.send("evm_increaseTime", [1000]);
      //     await ethers.provider.send("evm_mine", []);
      //     await forwardTimestamp(clearingHouse, 200);
      //     await perpLemma.connect(usdLemma).openLongWithExactCollateral(parseUnits("1", ethCollateralDecimals));
      //     await forwardTimestamp(clearingHouse, 200);
      //     await perpLemma.settleAllFunding();
      //     await forwardTimestamp(clearingHouse, 200);

      //     let totalFundingPNL = await perpLemma.totalFundingPNL();
      //     let realizedFundingPnl = await perpLemma.realizedFundingPNL();
      //     let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

      //     let rebalanceAmountInEth;
      //     if (rebalanceAmount.gt(ZERO)) {
      //       let baseAndQuoteValue = await callStaticOpenPosition(
      //         clearingHouse,
      //         longAddress,
      //         baseToken.address,
      //         false,
      //         true,
      //         rebalanceAmount,
      //       ); //long eth (increase our position as ETHL is getting minted)
      //       rebalanceAmountInEth = baseAndQuoteValue[0];
      //     } else {
      //       let baseAndQuoteValue = await callStaticOpenPosition(
      //         clearingHouse,
      //         longAddress,
      //         baseToken.address,
      //         true,
      //         false,
      //         rebalanceAmount.abs(),
      //       ); //short (decrease our position as ETHL is getting burnt)
      //       rebalanceAmountInEth = baseAndQuoteValue[0];
      //       rebalanceAmountInEth = BigNumber.from("-" + rebalanceAmountInEth.toString()); //negative amount
      //     }

      //     await expect(
      //       perpLemma
      //         .connect(usdLemma)
      //         .reBalance(
      //           reBalancer.address,
      //           rebalanceAmountInEth.mul(100),
      //           ethers.utils.defaultAbiCoder.encode(["uint160", "uint256", "bool"], [sqrtPriceLimitX96, deadline, false]),
      //         ),
      //     ).to.be.revertedWith("not allowed");
      //   });

      //   it("#1.a Rebalance, fundingPNL negative, go short on eth rebalnce and increase levrage", async () => {
      //     await openPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       true,
      //       false,
      //       parseUnits("2000", ethCollateralDecimals), // 2000 vUSD
      //     ); // short

      //     await openPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       false,
      //       true,
      //       parseUnits("3000", ethCollateralDecimals), // 3000 vUSD
      //     );

      //     await usdCollateral.connect(usdLemma).transfer(perpLemma.address, parseUnits("100", usdCollateralDecimals));
      //     await perpLemma.connect(usdLemma).openLongWithExactCollateral(
      //       parseUnits("99", ethCollateralDecimals), // 99 vUSD
      //     );
      //     await ethers.provider.send("evm_increaseTime", [1000]);
      //     await ethers.provider.send("evm_mine", []);
      //     await forwardTimestamp(clearingHouse, 200);
      //     await perpLemma.connect(usdLemma).openLongWithExactCollateral(parseUnits("1", ethCollateralDecimals)); // 1 vUSD
      //     await forwardTimestamp(clearingHouse, 200);
      //     await perpLemma.settleAllFunding();
      //     await forwardTimestamp(clearingHouse, 200);

      //     let checkPrice_before = await checkAndSyncPrice();
      //     let leverage_before = await calcLeverage();
      //     let fundingPNL = await perpLemma.getFundingPNL(baseToken.address);
      //     let totalFundingPNL = await perpLemma.totalFundingPNL();
      //     let realizedFundingPnl = await perpLemma.realizedFundingPNL();
      //     let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

      //     let rebalanceAmountInEth;
      //     if (rebalanceAmount.gt(ZERO)) {
      //       let baseAndQuoteValue = await callStaticOpenPosition(
      //         clearingHouse,
      //         longAddress,
      //         baseToken.address,
      //         false,
      //         true,
      //         rebalanceAmount,
      //       ); //long eth (increase our position as ETHL is getting minted)
      //       rebalanceAmountInEth = baseAndQuoteValue[0];
      //     } else {
      //       let baseAndQuoteValue = await callStaticOpenPosition(
      //         clearingHouse,
      //         longAddress,
      //         baseToken.address,
      //         true,
      //         false,
      //         rebalanceAmount.abs(),
      //       ); //short (decrease our position as ETHL is getting burnt)
      //       rebalanceAmountInEth = baseAndQuoteValue[0];
      //       rebalanceAmountInEth = BigNumber.from("-" + rebalanceAmountInEth.toString()); //negative amount
      //     }

      //     await perpLemma
      //       .connect(usdLemma)
      //       .reBalance(
      //         reBalancer.address,
      //         rebalanceAmountInEth,
      //         ethers.utils.defaultAbiCoder.encode(["uint160", "uint256", "bool"], [sqrtPriceLimitX96, deadline, false]),
      //       );
      //     let checkPrice_after = await checkAndSyncPrice();
      //     let leverage_after = await calcLeverage();
      //     expect(leverage_before).lt(leverage_after);

      //     // console.log("fundingPNL: ", fundingPNL.toString());
      //     // console.log("totalFundingPNL: ", totalFundingPNL.toString());
      //     // console.log("realizedFundingPnl ", realizedFundingPnl.toString());
      //     // console.log("rebalanceAmount: ", rebalanceAmount.toString());
      //     // console.log("rebalanceAmountInEth: ", rebalanceAmountInEth.toString());
      //     // console.log("leverage_before: ", leverage_before.toString());
      //     // console.log("leverage_after:  ", leverage_after.toString());
      //     // console.log("checkPrice_before: ", checkPrice_before.toString());
      //     // console.log("checkPrice_after:  ", checkPrice_after.toString());
      //   });

      //   it("#1.b Rebalance, fundingPNL positive, go long on eth rebalnce and decrease levrage", async () => {
      //     await openPosition(
      //       clearingHouse,
      //       longAddress,
      //       baseToken.address,
      //       false,
      //       false,
      //       parseUnits("3000", ethCollateralDecimals),
      //     );
      //     await usdCollateral.connect(usdLemma).transfer(perpLemma.address, parseUnits("20000", usdCollateralDecimals));

      //     await perpLemma.connect(usdLemma).openLongWithExactCollateral(parseUnits("19000", ethCollateralDecimals));
      //     await ethers.provider.send("evm_increaseTime", [1000]);
      //     await ethers.provider.send("evm_mine", []);
      //     await forwardTimestamp(clearingHouse, 200);
      //     await perpLemma.connect(usdLemma).openLongWithExactCollateral(parseUnits("1000", ethCollateralDecimals));
      //     await forwardTimestamp(clearingHouse, 200);
      //     await perpLemma.settleAllFunding();
      //     await forwardTimestamp(clearingHouse, 200);

      //     let checkPrice_before = await checkAndSyncPrice();
      //     let leverage_before = await calcLeverage();
      //     let fundingPNL = await perpLemma.getFundingPNL(baseToken.address);
      //     let totalFundingPNL = await perpLemma.totalFundingPNL();
      //     let realizedFundingPnl = await perpLemma.realizedFundingPNL();
      //     let rebalanceAmount = totalFundingPNL.sub(realizedFundingPnl);

      //     // let ethPrice = BigNumber.from(checkPrice_before[0]).mul(parseEther('1')).div(parseUnits('1', usdCollateralDecimals))
      //     // let usdcPriceInEth = new bn('1').dividedBy(ethPrice.toString()).multipliedBy(1e36).toFixed(0)
      //     // let rebalanceAmountInEth = rebalanceAmount.mul(usdcPriceInEth).div(parseEther('1'))

      //     let rebalanceAmountInEth;
      //     if (rebalanceAmount.gt(ZERO)) {
      //       let baseAndQuoteValue = await callStaticOpenPosition(
      //         clearingHouse,
      //         longAddress,
      //         baseToken.address,
      //         false,
      //         true,
      //         rebalanceAmount,
      //       ); //long eth (increase our position as ETHL is getting minted)
      //       rebalanceAmountInEth = baseAndQuoteValue[0];
      //     } else {
      //       let baseAndQuoteValue = await callStaticOpenPosition(
      //         clearingHouse,
      //         longAddress,
      //         baseToken.address,
      //         true,
      //         false,
      //         rebalanceAmount.abs(),
      //       ); //short (decrease our position as ETHL is getting burnt)
      //       rebalanceAmountInEth = baseAndQuoteValue[0];
      //       rebalanceAmountInEth = BigNumber.from("-" + rebalanceAmountInEth.toString()); //negative amount
      //     }

      //     await perpLemma
      //       .connect(usdLemma)
      //       .reBalance(
      //         reBalancer.address,
      //         rebalanceAmountInEth,
      //         ethers.utils.defaultAbiCoder.encode(["uint160", "uint256", "bool"], [sqrtPriceLimitX96, deadline, false]),
      //       );

      //     let checkPrice_after = await checkAndSyncPrice();
      //     let leverage_after = await calcLeverage();
      //     expect(leverage_before).gt(leverage_after);

      //     // console.log("fundingPNL: ", fundingPNL.toString());
      //     // console.log("totalFundingPNL: ", totalFundingPNL.toString());
      //     // console.log("realizedFundingPnl ", realizedFundingPnl.toString());
      //     // console.log("rebalanceAmount: ", rebalanceAmount.toString());
      //     // console.log("rebalanceAmountInEth: ", rebalanceAmountInEth.toString());
      //     // console.log("leverage_before: ", leverage_before.toString());
      //     // console.log("leverage_after:  ", leverage_after.toString());
      //     // console.log("checkPrice_before: ", checkPrice_before.toString());
      //     // console.log("checkPrice_after:  ", checkPrice_after.toString());
      //   });
      // });
    });
  });
});