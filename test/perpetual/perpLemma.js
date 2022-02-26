const { ethers } = require("hardhat");
const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { utils } = require("ethers");
const { parseEther, parseUnits } = require("ethers/lib/utils");
const { BigNumber } = require("@ethersproject/bignumber");
const { loadPerpLushanInfo, snapshot, revertToSnapshot, fromBigNumber } = require("../utils");
const bn = require("bignumber.js");
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

const ClearingHouseAbi = require("../../perp-lushan/artifacts/contracts/test/TestClearingHouse.sol/TestClearingHouse.json");
const OrderBookAbi = require("../../perp-lushan/artifacts/contracts/OrderBook.sol/OrderBook.json");
const ClearingHouseConfigAbi = require("../../perp-lushan/artifacts/contracts/ClearingHouseConfig.sol/ClearingHouseConfig.json");
const VaultAbi = require("../../perp-lushan/artifacts/contracts/Vault.sol/Vault.json");
const ExchangeAbi = require("../../perp-lushan/artifacts/contracts/Exchange.sol/Exchange.json");
const MarketRegistryAbi = require("../../perp-lushan/artifacts/contracts/MarketRegistry.sol/MarketRegistry.json");
const TestERC20Abi = require("../../perp-lushan/artifacts/contracts/test/TestERC20.sol/TestERC20.json");
const BaseTokenAbi = require("../../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json");
const BaseToken2Abi = require("../../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json");
const QuoteTokenAbi = require("../../perp-lushan/artifacts/contracts/QuoteToken.sol/QuoteToken.json");
const AccountBalanceAbi = require("../../perp-lushan/artifacts/contracts/AccountBalance.sol/AccountBalance.json");
const MockTestAggregatorV3Abi = require("../../perp-lushan/artifacts/contracts/mock/MockTestAggregatorV3.sol/MockTestAggregatorV3.json");
const UniswapV3PoolAbi = require("../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");
const UniswapV3Pool2Abi = require("../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");
const QuoterAbi = require("../../perp-lushan/artifacts/@uniswap/v3-periphery/contracts/lens/Quoter.sol/Quoter.json");
const UniswapV3FactoryAbi = require("../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");

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

describe("perpLemma", async function () {
  let defaultSigner, usdLemma, reBalancer, hasWETH, keeperGasReward, signer1, signer2, usdl2, longAddress;
  let perpAddresses;
  const ZERO = BigNumber.from("0");
  let snapshotId;

  let clearingHouse;
  let marketRegistry;
  let clearingHouseConfig;
  let exchange;
  let orderBook;
  let accountBalance;
  let vault;
  let collateral;
  let baseToken;
  let baseToken2;
  let quoteToken;
  let univ3factory;
  let pool;
  let pool2;
  let mockedBaseAggregator;
  let mockedBaseAggregator2;
  let quoter;
  let perpLemma;
  let collateralDecimals;
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
    await perpLemma.connect(signer1).resetApprovals();

    // base = usd
    // quote = eth

    await mockedBaseAggregator.setLatestRoundData(0, parseUnits("0.01", collateralDecimals), 0, 0, 0);
    await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("100", collateralDecimals), 0, 0, 0);

    await pool.initialize(encodePriceSqrt("1", "100"));
    await pool.increaseObservationCardinalityNext((2 ^ 16) - 1);

    await pool2.initialize(encodePriceSqrt("1", "100"));
    await pool2.increaseObservationCardinalityNext((2 ^ 16) - 1);

    await clearingHouseConfig.setMaxFundingRate(parseUnits("1", 6));

    await marketRegistry.addPool(baseToken.address, 10000);
    await marketRegistry.addPool(baseToken2.address, 10000);
    await marketRegistry.setFeeRatio(baseToken.address, 10000);
    await marketRegistry.setFeeRatio(baseToken2.address, 10000);
  });

  beforeEach(async function () {
    snapshotId = await snapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(snapshotId);
  });

  async function calcLeverage() {
    positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
    depositedCollateral = await vault.getBalance(perpLemma.address);
    ethPrice = await mockedBaseAggregator2.getRoundData(0); //ethPrice
    interval = await clearingHouseConfig.getTwapInterval();
    usdcPriceInEth = await baseToken.getIndexPrice(interval);
    leverage_in_6_Decimal = depositedCollateral.mul(parseUnits("1", 26)).div(positionSize.mul(usdcPriceInEth));
    leverage_in_1 = depositedCollateral.mul(parseUnits("1", 18)).div(positionSize.mul(usdcPriceInEth));

    // console.log('\nethPrice: ', ethPrice[1].toString())
    // console.log('usdcPriceInEth: ', usdcPriceInEth.toString())
    // console.log('positionSize: ', positionSize.toString())
    // console.log('depositedCollateral: ', depositedCollateral.toString())

    return [leverage_in_6_Decimal, leverage_in_1];
  }

  describe("PerpLemma tests => Open, Close, fees, settlement", () => {
    before(async function () {
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
      await vault.connect(signer2).deposit(collateral.address, parsedAmount);
      await addLiquidity(
        clearingHouse,
        signer2,
        baseToken.address,
        parseEther("10000"),
        parseEther("100"),
        -887200,
        887200,
      );
    });

    it("should set addresses correctly", async function () {
      await expect(perpLemma.connect(signer1).setUSDLemma(signer1.address)).to.be.revertedWith(
        "Ownable: caller is not the owner",
      );
      await perpLemma.connect(defaultSigner).setUSDLemma(signer1.address);
      expect(await perpLemma.usdLemma()).to.equal(signer1.address);
      await expect(
        perpLemma.connect(signer1).setReferrerCode(ethers.utils.formatBytes32String("Hello World")),
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await perpLemma.connect(defaultSigner).setReferrerCode(ethers.utils.formatBytes32String("Hello World"));
      const byteCode = await perpLemma.referrerCode();
      expect(ethers.utils.parseBytes32String(byteCode)).to.eq("Hello World");
    });

    it("should fail to open when max position is reached", async function () {
      const collateralAmount = parseUnits("1", collateralDecimals); // 6 decimal
      await perpLemma.setMaxPosition(parseEther("90"));
      await collateral.mint(usdLemma.address, collateralAmount.add(1));
      await collateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount.add(1));
      await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralAmount)).to.be.revertedWith(
        "max position reached",
      );
    });

    it("should close position correctly", async function () {
      let collateralAmount = parseUnits("1", collateralDecimals); // 6 decimal
      await collateral.mint(usdLemma.address, collateralAmount);

      // transfer Collateral to perpLemma
      await collateral.connect(usdLemma).transfer(perpLemma.address, parseEther("1"));
      collateralAmount = collateralAmount.sub(
        collateralAmount.mul(BigNumber.from("10000")).div(BigNumber.from("1000000")),
      );
      baseAndQuoteValue = await callStaticOpenPosition(
        clearingHouse,
        longAddress,
        baseToken.address,
        false,
        true,
        collateralAmount,
      ); // index0: base/usd, index1: quote/eth

      collateralAmount = parseUnits("1", collateralDecimals);
      // Deposit collateral in eth and Short eth and long usdc
      await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralAmount))
        .to.emit(clearingHouse, "PositionChanged")
        .withArgs(
          perpLemma.address, // Trader
          baseToken.address, // Market --> vUSD
          parseUnits("97058727412628824887", 0), // Position, negative because of short?
          parseUnits("-980100000000000000", 0), // Notional
          parseUnits("9900000000000000", 0), // Fee
          parseUnits("-990000000000000000", 0), // OpenNotional
          0, // PnlToBeRealized
          parseUnits("8000467773506664236629439201", 0), // sqrtPriceAfterX96
        );

      expect(await collateral.balanceOf(perpLemma.address)).to.eq(0);
      expect(await vault.getBalance(perpLemma.address)).to.eq(parseEther("1"));
      positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      expect(baseAndQuoteValue[0]).to.eq(positionSize);

      baseAndQuoteValue = await callStaticOpenPosition(
        clearingHouse,
        longAddress,
        baseToken.address,
        true,
        true,
        positionSize,
      );
      collateralAmount = baseAndQuoteValue[1].mul(parseEther("1")).div(parseEther("0.99"));
      // long eth and close position, withdraw collateral
      await expect(await perpLemma.connect(usdLemma).closeWExactCollateral(collateralAmount))
        .to.emit(clearingHouse, "PositionChanged")
        .withArgs(
          perpLemma.address, // Trader
          baseToken.address, // Market --> vUSD
          parseUnits("-97058727412628824788", 0), // Position, negative because of short?
          parseUnits("980099999999999999", 0), // Notional
          parseUnits("9801000000000000", 0), // Fee
          parseUnits("-2", 0), // OpenNotional
          parseUnits("-19700999999999999", 0), // PnlToBeRealized
          parseUnits("7922816251426433759433623195", 0), // sqrtPriceAfterX96
        );
      // .withArgs(
      //     perpLemma.address,                                                  // Trader
      //     baseToken.address,                                                  // Market --> vUSD
      //     parseUnits('-96078723462815946048', 0),                             // Position, negative because of short?
      //     parseUnits('970299000000000000', 0),                                // Notional
      //     parseUnits('9702990000000000', 0),                                  // Fee
      //     parseUnits('-9996050187121161', 0),                                 // OpenNotional
      //     parseUnits('-19407939812878839', 0),                                // PnlToBeRealized
      //     parseUnits('7923592766647236064127145474', 0)                       // sqrtPriceAfterX96
      // );
      positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
      expect(positionSize).to.closeTo(BigNumber.from("1000"), BigNumber.from("1000"));
      expect(await vault.getBalance(perpLemma.address)).to.gt(0); // consider to be fee
      expect(await collateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
    });

    describe("OpenPosition test1", () => {
      let collateralToGetBack_1e6, collateralToGetBack_1e18;
      beforeEach(async function () {
        const collateralAmount = parseEther("1");
        await collateral.mint(usdLemma.address, collateralAmount);
        await collateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
      });

      it("openPosition => emit event PositionChanged", async () => {
        let collateralAmount = parseUnits("1", collateralDecimals); // 6 decimal
        await collateral.mint(usdLemma.address, collateralAmount);
        collateralAmount = collateralAmount.sub(
          collateralAmount.mul(BigNumber.from("10000")).div(BigNumber.from("1000000")),
        );
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmount,
        ); // index0: base/usd, index1: quote/eth
        collateralAmount = parseUnits("1", collateralDecimals);
        // Deposit collateral in eth and Short eth and long usdc
        await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("97058727412628824887", 0), // Position, negative because of short?
            parseUnits("-980100000000000000", 0), // Notional
            parseUnits("9900000000000000", 0), // Fee
            parseUnits("-990000000000000000", 0), // OpenNotional
            0, // PnlToBeRealized
            parseUnits("8000467773506664236629439201", 0), // sqrtPriceAfterX96
          );
        expect(await collateral.balanceOf(perpLemma.address)).to.eq(0);
        expect(await vault.getBalance(perpLemma.address)).to.eq(parseEther("1"));
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(baseAndQuoteValue[0]).to.eq(positionSize);
      });

      it("openPosition => leverage should be 1x", async () => {
        let collateralAmount = parseUnits("1", collateralDecimals); // 6 decimal
        await collateral.mint(usdLemma.address, collateralAmount);
        collateralAmount = collateralAmount.sub(
          collateralAmount.mul(BigNumber.from("10000")).div(BigNumber.from("1000000")),
        );
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmount,
        ); // index0: base/usd, index1: quote/eth
        collateralAmount = parseUnits("1", collateralDecimals);
        await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("97058727412628824887", 0), // Position, negative because of short?
            parseUnits("-980100000000000000", 0), // Notional
            parseUnits("9900000000000000", 0), // Fee
            parseUnits("-990000000000000000", 0), // OpenNotional
            0, // PnlToBeRealized
            parseUnits("8000467773506664236629439201", 0), // sqrtPriceAfterX96
          );
        expect(await collateral.balanceOf(perpLemma.address)).to.eq(0);
        expect(await vault.getBalance(perpLemma.address)).to.eq(parseEther("1"));
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(baseAndQuoteValue[0]).to.eq(positionSize);
        const depositedCollateral = await vault.getBalance(perpLemma.address);
        const ethPrice = await mockedBaseAggregator2.getRoundData(0); //ethPrice
        const leverage = depositedCollateral.mul(ethPrice[1]).div(positionSize); // 979999(close to 1e6 or 1x)
        expect(leverage).to.be.closeTo(parseUnits("1", collateralDecimals), parseEther("0.031")); // leverage should be 1x(1e6) or close to 1e6
      });
    });

    describe("OpenPosition tests2", () => {
      let collateralmintAmount;
      beforeEach(async function () {
        collateralmintAmount = parseEther("1");
        await collateral.mint(usdLemma.address, collateralmintAmount);
        await collateral.connect(usdLemma).transfer(perpLemma.address, collateralmintAmount);
      });

      it("openPosition => open position for short and close position for 2 time longs", async () => {
        let collateralAmount = parseUnits("1", collateralDecimals); // 6 decimal
        await collateral.mint(usdLemma.address, collateralAmount);
        collateralAmount = collateralAmount.sub(
          collateralAmount.mul(BigNumber.from("10000")).div(BigNumber.from("1000000")),
        );
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmount,
        ); // index0: base/usd, index1: quote/eth
        collateralAmount = parseUnits("1", collateralDecimals);
        await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("97058727412628824887", 0), // Position, negative because of short?
            parseUnits("-980100000000000000", 0), // Notional
            parseUnits("9900000000000000", 0), // Fee
            parseUnits("-990000000000000000", 0), // OpenNotional
            0, // PnlToBeRealized
            parseUnits("8000467773506664236629439201", 0), // sqrtPriceAfterX96
          );

        expect(await collateral.balanceOf(perpLemma.address)).to.eq(0);
        expect(await vault.getBalance(perpLemma.address)).to.eq(parseEther("1"));
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
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

        await expect(perpLemma.connect(usdLemma).closeWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address,
            parseUnits("-48529363706314412426", 0), // Position, negative because of short?
            parseUnits("492439778913434713", 0), // Notional
            parseUnits("4924397789134348", 0), // Fee
            parseUnits("-495000000000000001", 0), // OpenNotional
            parseUnits("-7484618875699634", 0), // PnlToBeRealized
            parseUnits("7961452674674422230504018035", 0), // Market --> vUSD
            // parseUnits('-48041715784969225897', 0),                             // Position, negative because of short?
            // parseUnits('487515381124300366', 0),                                // Notional
            // parseUnits('4875153811243004', 0),                                  // Fee
            // parseUnits('-499974013723457483', 0),                                 // OpenNotional
            // parseUnits('-7385758963485155', 0),                                                                  // PnlToBeRealized
            // parseUnits('7961842825662744650554972586', 0)                       // sqrtPriceAfterX96
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

        await expect(perpLemma.connect(usdLemma).closeWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("-48529363706314412363", 0), // Position, negative because of short?
            parseUnits("487660221086565286", 0), // Notional
            parseUnits("4876602210865653", 0), // Fee
            parseUnits("-2", 0), // OpenNotional
            parseUnits("-12216381124300366", 0), // PnlToBeRealized
            parseUnits("7922816251426433759433623194", 0),
            // parseUnits('-48041727150513801827', 0),                             // Position, negative because of short?
            // parseUnits('482830822831654162', 0),                                // Notional
            // parseUnits('4828308228316542', 0),                                  // Fee
            // parseUnits('-9947911518245487', 0),                               // OpenNotional
            // parseUnits('-12023587601874376', 0),                                                                  // PnlToBeRealized
            // parseUnits('7923589026764542382606987206', 0)                       // sqrtPriceAfterX96
          );

        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(positionSize).to.closeTo(BigNumber.from("1000"), BigNumber.from("1000"));
        expect(await vault.getBalance(perpLemma.address)).to.gt(0); // consider to be fee
        expect(await collateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
      });

      it("openPosition => open position for short and close position for long", async () => {
        let collateralAmount = parseUnits("1", collateralDecimals); // 6 decimal
        await collateral.mint(usdLemma.address, collateralAmount);
        collateralAmount = collateralAmount.sub(
          collateralAmount.mul(BigNumber.from("10000")).div(BigNumber.from("1000000")),
        );
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmount,
        ); // index0: base/usd, index1: quote/eth
        collateralAmount = parseUnits("1", collateralDecimals);
        await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("97058727412628824887", 0), // Position, negative because of short?
            parseUnits("-980100000000000000", 0), // Notional
            parseUnits("9900000000000000", 0), // Fee
            parseUnits("-990000000000000000", 0), // OpenNotional
            0, // PnlToBeRealized
            parseUnits("8000467773506664236629439201", 0), // sqrtPriceAfterX96
          );

        expect(await collateral.balanceOf(perpLemma.address)).to.eq(0);
        expect(await vault.getBalance(perpLemma.address)).to.eq(parseEther("1"));
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(baseAndQuoteValue[0]).to.eq(positionSize);

        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize,
        );
        collateralAmount = baseAndQuoteValue[1].mul(parseEther("1")).div(parseEther("0.99"));

        await expect(perpLemma.connect(usdLemma).closeWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("-97058727412628824788", 0), // Position, negative because of short?
            parseUnits("980099999999999999", 0), // Notional
            parseUnits("9801000000000000", 0), // Fee
            parseUnits("-2", 0), // OpenNotional
            parseUnits("-19700999999999999", 0), // PnlToBeRealized
            parseUnits("7922816251426433759433623195", 0), // sqrtPriceAfterX96
          );
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(positionSize).to.closeTo(BigNumber.from("1000"), BigNumber.from("1000"));
        expect(await vault.getBalance(perpLemma.address)).to.gt(0); // consider to be fee
        expect(await collateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);
      });
    });

    describe("OpenWExactCollateral and CloseWExactCollateral", async function () {
      it("Basic Open", async () => {
        let collateralAmount = parseUnits("1", collateralDecimals); // 6 decimal
        await collateral.mint(usdLemma.address, collateralAmount);
        await collateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
        collateralAmount = collateralAmount.sub(
          collateralAmount.mul(BigNumber.from("10000")).div(BigNumber.from("1000000")),
        );
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmount,
        ); // index0: base/usd, index1: quote/eth
        collateralAmount = parseUnits("1", collateralDecimals);
        expect(await collateral.balanceOf(perpLemma.address)).to.equal(collateralAmount);
        await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("97058727412628824887", 0), // Position, negative because of short?
            parseUnits("-980100000000000000", 0), // Notional
            parseUnits("9900000000000000", 0), // Fee
            parseUnits("-990000000000000000", 0), // OpenNotional
            0, // PnlToBeRealized
            parseUnits("8000467773506664236629439201", 0), // sqrtPriceAfterX96
          );
        expect(await collateral.balanceOf(perpLemma.address)).to.eq(0);
        expect(await vault.getBalance(perpLemma.address)).to.eq(parseEther("1"));
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(baseAndQuoteValue[0]).to.eq(positionSize);
      });

      it("Basic Open and Close, Checking the lost collateral should be < 5%", async () => {
        let collateralAmount = parseUnits("1", collateralDecimals); // 6 decimal
        await collateral.mint(usdLemma.address, collateralAmount);
        await collateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
        collateralAmount = collateralAmount.sub(
          collateralAmount.mul(BigNumber.from("10000")).div(BigNumber.from("1000000")),
        );
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmount,
        ); // index0: base/usd, index1: quote/eth
        collateralAmount = parseUnits("1", collateralDecimals);
        const usdLemmaBalance1 = await collateral.balanceOf(usdLemma.address);
        expect(await collateral.balanceOf(perpLemma.address)).to.equal(collateralAmount);
        await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("97058727412628824887", 0), // Taker Position
            parseUnits("-980100000000000000", 0), // Notional
            parseUnits("9900000000000000", 0), // Fee
            parseUnits("-990000000000000000", 0), // OpenNotional
            0, // PnlToBeRealized
            parseUnits("8000467773506664236629439201", 0), // sqrtPriceAfterX96
          );

        expect(await collateral.balanceOf(perpLemma.address)).to.eq(0);
        expect(await vault.getBalance(perpLemma.address)).to.eq(parseEther("1"));
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(baseAndQuoteValue[0]).to.eq(positionSize);
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize,
        );
        collateralAmount = baseAndQuoteValue[1].mul(parseEther("1")).div(parseEther("0.99"));

        await expect(perpLemma.connect(usdLemma).closeWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("-97058727412628824788", 0), // Position, negative because of short?
            parseUnits("980099999999999999", 0), // Notional
            parseUnits("9801000000000000", 0), // Fee
            parseUnits("-2", 0), // OpenNotional
            parseUnits("-19700999999999999", 0), // PnlToBeRealized
            parseUnits("7922816251426433759433623195", 0), // sqrtPriceAfterX96
          );
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(positionSize).to.closeTo(BigNumber.from("1000"), BigNumber.from("1000"));
        expect(await vault.getBalance(perpLemma.address)).to.gt(0); // consider to be fee
        expect(await collateral.balanceOf(perpLemma.address)).to.be.equal(ZERO);

        const usdLemmaBalance2 = await collateral.balanceOf(usdLemma.address);
        const deltaBalance = usdLemmaBalance2 - usdLemmaBalance1;
        const lostCollateral = collateralAmount - deltaBalance;
        const percLostCollateral = lostCollateral / collateralAmount;
        // Checking the lost collateral is < 5% of the initial amount
        expect(collateralAmount - deltaBalance).to.below(collateralAmount * 0.05);
      });
    });

    describe("Emergency Settlement", async function () {
      beforeEach(async function () {});

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
        await collateral.mint(usdLemma.address, collateralAmount);
        await collateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
        // Deposit collateral in eth and Short eth and long usdc
        await perpLemma.connect(usdLemma).openWExactCollateral(collateralAmount);
        expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
        // Closing the market
        expect(await baseToken.connect(defaultSigner)["close(uint256)"](1)).to.emit(baseToken, "StatusUpdated");

        const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
        await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));
        await expect(perpLemma.connect(usdLemma).settle())
          .to.emit(vault, "Withdrawn")
          .withArgs(collateral.address, perpLemma.address, parseUnits("10000000000000097", 0));
      });

      it("Open a Position and Calling Settle() when Market is closed should work", async () => {
        let collateralAmount = parseUnits("1", collateralDecimals); // 6 decimal
        await collateral.mint(usdLemma.address, collateralAmount);
        await collateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
        collateralAmount = collateralAmount.sub(
          collateralAmount.mul(BigNumber.from("10000")).div(BigNumber.from("1000000")),
        );
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmount,
        ); // index0: base/usd, index1: quote/eth
        collateralAmount = parseUnits("1", collateralDecimals);

        await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("97058727412628824887", 0), // Position, negative because of short?
            parseUnits("-980100000000000000", 0), // Notional
            parseUnits("9900000000000000", 0), // Fee
            parseUnits("-990000000000000000", 0), // OpenNotional
            0, // PnlToBeRealized
            parseUnits("8000467773506664236629439201", 0), // sqrtPriceAfterX96
          );

        expect(await collateral.balanceOf(perpLemma.address)).to.eq(0);
        expect(await vault.getBalance(perpLemma.address)).to.eq(parseEther("1"));
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        expect(baseAndQuoteValue[0]).to.eq(positionSize);

        expect(await baseToken.connect(defaultSigner)["pause()"]()).to.emit(baseToken, "StatusUpdated");
        expect(await baseToken.connect(defaultSigner)["close(uint256)"](1)).to.emit(baseToken, "StatusUpdated");
        const lastTimestamp = (await waffle.provider.getBlock("latest")).timestamp;
        await clearingHouse.setBlockTimestamp(BigNumber.from(lastTimestamp).add(100));

        await expect(perpLemma.connect(usdLemma).settle())
          .to.emit(vault, "Withdrawn")
          .withArgs(collateral.address, perpLemma.address, parseUnits("10000000000000097", 0)); // 999999

        // This is not passing as
        // Initial Collateral: 100000000000
        // Actual Collateral: 99901980199
        // So the Vault has less collateral than when it started
        //expect(await collateral.balanceOf(vault.address)).to.equal(initialVaultCollateral);
      });

      it("Test Settle and Withdraw Collateral for 2 Users", async () => {
        let collateralAmount = parseUnits("1", collateralDecimals); // 6 decimal
        await collateral.mint(usdLemma.address, collateralAmount);
        await collateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount);
        collateralAmount = collateralAmount.sub(
          collateralAmount.mul(BigNumber.from("10000")).div(BigNumber.from("1000000")),
        );
        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          false,
          true,
          collateralAmount,
        ); // index0: base/usd, index1: quote/eth
        collateralAmount = parseUnits("1", collateralDecimals);

        // 3.2 USDLemma calls PerpLemma Open to open a position at the PerpV2 Clearing House
        await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralAmount))
          .to.emit(clearingHouse, "PositionChanged")
          .withArgs(
            perpLemma.address, // Trader
            baseToken.address, // Market --> vUSD
            parseUnits("97058727412628824887", 0), // Position, negative because of short?
            parseUnits("-980100000000000000", 0), // Notional
            parseUnits("9900000000000000", 0), // Fee
            parseUnits("-990000000000000000", 0), // OpenNotional
            0, // PnlToBeRealized
            parseUnits("8000467773506664236629439201", 0), // sqrtPriceAfterX96
          );
        expect(await collateral.balanceOf(perpLemma.address)).to.eq(0);
        expect(await vault.getBalance(perpLemma.address)).to.eq(parseEther("1"));
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
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

        await perpLemma.connect(usdLemma).settle();

        let collateralPerpLemma = await collateral.balanceOf(perpLemma.address);
        const c1 = collateralPerpLemma * 0.2;
        const c1_1e18 = parseEther(c1.toString()).div(parseUnits("1", collateralDecimals));
        await expect(perpLemma.connect(usdLemma).closeWExactCollateral(c1_1e18)).to.emit(collateral, "Transfer");

        collateralPerpLemma = await collateral.balanceOf(perpLemma.address);

        expect(await collateral.balanceOf(perpLemma.address)).to.not.equal(0);

        // console.log("Trying to call PerpLemma.close() after market settlement to withdraw the remaining 80% of the initial collateral that is now the 100% of the remaining collateral");
        const c2 = collateralPerpLemma;
        const c2_1e18 = parseEther(c2.toString()).div(parseUnits("1", collateralDecimals));
        await expect(perpLemma.connect(usdLemma).closeWExactCollateral(c2_1e18)).to.emit(collateral, "Transfer");
        expect(await collateral.balanceOf(perpLemma.address)).to.equal(0);
      });
    });

    describe("Fees module", async function () {
      it("should open and deduct fees, and close deduct fees, perpLemma should have fees at the end", async function () {
        const collateralAmount = parseUnits("100", collateralDecimals); // 6 decimal
        await collateral.mint(usdLemma.address, collateralAmount);

        // transfer Collateral to perpLemma
        await collateral.connect(usdLemma).transfer(perpLemma.address, parseEther("1"));
        // Deposit collateral in eth and Short eth and long usdc
        await perpLemma.connect(usdLemma).openWExactCollateral(parseEther("1"));

        getBase = await accountBalance.getBase(perpLemma.address, baseToken.address);
        getQuote = await accountBalance.getQuote(perpLemma.address, baseToken.address);
        positionValue = await accountBalance.getTotalPositionValue(perpLemma.address, baseToken.address);
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        ratioforMm1 = await vault.getFreeCollateralByRatio(perpLemma.address, 0);
        depositedCollateral = await vault.getBalance(perpLemma.address);

        // console.log('\ngetBase: ', getBase.toString())
        // console.log('getQuote: ', getQuote.toString())
        // console.log('positionValue: ', positionValue.toString())
        // console.log('positionSize: ', positionSize.toString())
        // console.log('ratioforMm1: ', ratioforMm1.toString())
        // console.log('depositedCollateral: ', depositedCollateral.toString())

        // const interval = await clearingHouseConfig.getTwapInterval()
        // const indexPrice = await baseToken.getIndexPrice(interval) //
        const ethPrice = await mockedBaseAggregator2.getRoundData(0); //ethPrice
        const divisor = positionSize.mul(ethPrice[1]).div(parseEther("1"));
        const depositedCollateralWith1e18 = depositedCollateral.mul(parseEther("1"));
        const leverage = depositedCollateralWith1e18.div(divisor); // 979999(close to 1e6 or 1x)

        // console.log('indexPrice: ', indexPrice.toString())
        // console.log('ethPrice: ', ethPrice[1].toString())
        // console.log('divisor: ', divisor.toString())
        console.log("leverage: ", leverage.toString());

        fee1 = (
          await clearingHouse.connect(signer2).callStatic.removeLiquidity({
            baseToken: baseToken.address,
            lowerTick: -887200, //50000,
            upperTick: 887200, //50400,
            liquidity: 0,
            minBase: 0,
            minQuote: 0,
            deadline: ethers.constants.MaxUint256,
          })
        ).fee;
        // console.log('\nfee1: ', fee1.toString())
        expect(fee1).to.be.gt(0); // (> 0)

        baseAndQuoteValue = await callStaticOpenPosition(
          clearingHouse,
          longAddress,
          baseToken.address,
          true,
          true,
          positionSize,
        );

        // long eth and close position, withdraw collateral
        await perpLemma.connect(usdLemma).closeWExactCollateral(baseAndQuoteValue[1]);

        // after close
        fee2 = (
          await clearingHouse.connect(signer2).callStatic.removeLiquidity({
            baseToken: baseToken.address,
            lowerTick: -887200, //50000,
            upperTick: 887200, //50400,
            liquidity: 0,
            minBase: 0,
            minQuote: 0,
            deadline: ethers.constants.MaxUint256,
          })
        ).fee;
        // console.log('fee2: ', fee2.toString())
        expect(fee2).to.be.gt(0); // (> 0)

        getBase = await accountBalance.getBase(perpLemma.address, baseToken.address);
        getQuote = await accountBalance.getQuote(perpLemma.address, baseToken.address);
        positionValue = await accountBalance.getTotalPositionValue(perpLemma.address, baseToken.address);
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);
        ratioforMm1 = await vault.getFreeCollateralByRatio(perpLemma.address, 0);
        depositedCollateral = await vault.getBalance(perpLemma.address);

        // console.log('\ngetBase: ', getBase.toString())
        // console.log('getQuote: ', getQuote.toString())
        // console.log('positionValue: ', positionValue.toString())
        // console.log('positionSize: ', positionSize.toString())
        // console.log('ratioforMm1: ', ratioforMm1.toString())
        // console.log('depositedCollateral: ', depositedCollateral.toString())

        const perpBalance = await collateral.balanceOf(perpLemma.address);
        expect(perpBalance).to.be.eq(0); // (= 0) Fees charged by perplemma

        expect(getBase).to.be.closeTo(parseEther("1"), parseEther("0.1"));
        expect(getQuote.mul(-1)).to.be.closeTo(parseEther("0.0099"), parseEther("0.0009"));
        expect(positionSize).to.be.closeTo(parseEther("1"), parseEther("0.1"));
      });
    });
  });

  describe("Rebalance Tests", () => {
    before(async function () {
      await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);
      await addLiquidity(
        clearingHouse,
        signer2,
        baseToken.address,
        parseEther("100000"),
        parseEther("1000"),
        -887200,
        887200,
      );

      // alice add long limit order
      await collateral.mint(signer1.address, parseUnits("10000000000", collateralDecimals));
      await collateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
      await vault.connect(signer1).deposit(collateral.address, parseUnits("10000", collateralDecimals));

      await collateral.mint(signer2.address, parseUnits("10000000000", collateralDecimals));
      await collateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256);
      await vault.connect(signer2).deposit(collateral.address, parseUnits("100000", collateralDecimals));

      await collateral.mint(longAddress.address, parseUnits("10000000000", collateralDecimals));
      await collateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);
      await vault.connect(longAddress).deposit(collateral.address, parseUnits("10000", collateralDecimals));

      await collateral.mint(usdLemma.address, parseUnits("10000000000", collateralDecimals));
      await collateral.connect(usdLemma).approve(vault.address, ethers.constants.MaxUint256);
      await vault.connect(usdLemma).deposit(collateral.address, parseUnits("10000", collateralDecimals));
    });

    it("#1.a Rebalance, only usdLemma with short eth", async () => {
      await collateral.connect(usdLemma).transfer(perpLemma.address, parseEther("1"));
      await perpLemma.connect(usdLemma).openWExactCollateral(parseEther("1"));
      await forwardTimestamp(clearingHouse, 200);
      await clearingHouse.settleAllFunding(perpLemma.address);
      await forwardTimestamp(clearingHouse, 200);
      let fundingPayment = await exchange.getPendingFundingPayment(perpLemma.address, baseToken.address);
      console.log("fundingPayment: ", fundingPayment.toString());
      let leverage_before = await calcLeverage();
      console.log("leverage_before_in_6_decimal: ", leverage_before[0].toString());
      console.log("leverage_before_in_1: ", leverage_before[1].toString());
      fundingPNL = await perpLemma.getFundingPNL();
      realizedFundingPnl = await perpLemma.realizedFundingPNL();
      console.log("fundingPNL: ", fundingPNL.toString());
      console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
      const sqrtPriceLimitX96 = 0;
      const deadline = ethers.constants.MaxUint256;
      await perpLemma
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
      await collateral.connect(usdLemma).transfer(perpLemma.address, parseEther("1"));
      await perpLemma.connect(usdLemma).openWExactCollateral(parseEther("1"));
      await forwardTimestamp(clearingHouse, 200);
      await clearingHouse.settleAllFunding(perpLemma.address);
      await forwardTimestamp(clearingHouse, 200);
      let fundingPayment = await exchange.getPendingFundingPayment(perpLemma.address, baseToken.address);
      console.log("fundingPayment: ", fundingPayment.toString());
      let leverage_before = await calcLeverage();
      console.log("leverage_before_in_6_decimal: ", leverage_before[0].toString());
      console.log("leverage_before_in_1: ", leverage_before[1].toString());
      fundingPNL = await perpLemma.getFundingPNL();
      realizedFundingPnl = await perpLemma.realizedFundingPNL();
      totalFundingPNL = await perpLemma.totalFundingPNL();
      console.log("fundingPNL: ", fundingPNL.toString());
      console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
      const sqrtPriceLimitX96 = 0;
      const deadline = ethers.constants.MaxUint256;
      await perpLemma
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
      await collateral.connect(usdLemma).transfer(perpLemma.address, parseEther("1"));
      await perpLemma.connect(usdLemma).openWExactCollateral(parseEther("1"));
      await forwardTimestamp(clearingHouse, 200);
      await clearingHouse.settleAllFunding(perpLemma.address);
      await forwardTimestamp(clearingHouse, 200);
      let fundingPayment = await exchange.getPendingFundingPayment(perpLemma.address, baseToken.address);
      console.log("fundingPayment: ", fundingPayment.toString());
      let leverage_before = await calcLeverage();
      console.log("leverage_before_in_6_decimal: ", leverage_before[0].toString());
      console.log("leverage_before_in_1: ", leverage_before[1].toString());
      fundingPNL = await perpLemma.getFundingPNL();
      realizedFundingPnl = await perpLemma.realizedFundingPNL();
      totalFundingPNL = await perpLemma.totalFundingPNL();
      console.log("fundingPNL: ", fundingPNL.toString());
      console.log("realizedFundingPnl: ", realizedFundingPnl.toString());
      const sqrtPriceLimitX96 = 0;
      const deadline = ethers.constants.MaxUint256;
      await perpLemma
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
