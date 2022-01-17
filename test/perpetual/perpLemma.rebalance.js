const { ethers } = require("hardhat");
const { expect, use } = require("chai");
const {solidity} = require('ethereum-waffle');
const { waffle } = ("hardhat")

const { utils } = require('ethers');
const { parseEther, parseUnits } = require("ethers/lib/utils")
const { BigNumber } = require("@ethersproject/bignumber")
const { loadPerpLushanInfo, snapshot, revertToSnapshot, fromBigNumber } = require("../utils");
const bn = require("bignumber.js");
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

const ClearingHouseAbi = require('../../perp-lushan/artifacts/contracts/test/TestClearingHouse.sol/TestClearingHouse.json')
const OrderBookAbi = require('../../perp-lushan/artifacts/contracts/OrderBook.sol/OrderBook.json')
const ClearingHouseConfigAbi = require('../../perp-lushan/artifacts/contracts/ClearingHouseConfig.sol/ClearingHouseConfig.json')
const VaultAbi = require('../../perp-lushan/artifacts/contracts/Vault.sol/Vault.json')
const ExchangeAbi = require('../../perp-lushan/artifacts/contracts/Exchange.sol/Exchange.json')
const MarketRegistryAbi = require('../../perp-lushan/artifacts/contracts/MarketRegistry.sol/MarketRegistry.json')
const TestERC20Abi = require('../../perp-lushan/artifacts/contracts/test/TestERC20.sol/TestERC20.json')
const BaseTokenAbi = require('../../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json')
const BaseToken2Abi = require('../../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json')
const QuoteTokenAbi = require('../../perp-lushan/artifacts/contracts/QuoteToken.sol/QuoteToken.json')
const AccountBalanceAbi = require('../../perp-lushan/artifacts/contracts/AccountBalance.sol/AccountBalance.json')
const MockTestAggregatorV3Abi = require('../../perp-lushan/artifacts/contracts/mock/MockTestAggregatorV3.sol/MockTestAggregatorV3.json')
const UniswapV3PoolAbi = require('../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json')
const UniswapV3Pool2Abi = require('../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json');
const QuoterAbi = require('../../perp-lushan/artifacts/@uniswap/v3-periphery/contracts/lens/Quoter.sol/Quoter.json')
const UniswapV3FactoryAbi = require('../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Factory.sol/UniswapV3Factory.json');

use(solidity);

function encodePriceSqrt(reserve1, reserve0) {
    return BigNumber.from(
        new bn(reserve1.toString())
            .div(reserve0.toString())
            .sqrt()
            .multipliedBy(new bn(2).pow(96))
            .integerValue(3)
            .toString(),
    )
}

async function forward(seconds) {
    const lastTimestamp = (await ethers.provider.getBlock('latest')).timestamp;
    console.log('lastTimestamp: ', lastTimestamp)
    await ethers.provider.send("evm_setNextBlockTimestamp", [lastTimestamp + seconds])
    await ethers.provider.send("evm_mine", [])
}

async function forwardTimestamp(clearingHouse, step) {
    const now = await clearingHouse.getBlockTimestamp()
    await clearingHouse.setBlockTimestamp(now.add(step))
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
    })
    return openPositionParams
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
    })
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
    })
}

describe("perpLemma.rebalance", async function () {
    let defaultSigner, usdLemma, reBalancer, hasWETH, keeperGasReward, signer1, signer2, usdl2;
    let perpAddresses;
    const ZERO = BigNumber.from("0");
    let snapshotId;

    let clearingHouse
    let marketRegistry
    let clearingHouseConfig
    let exchange
    let orderBook
    let accountBalance
    let vault
    let collateral
    let baseToken
    let baseToken2
    let quoteToken
    let univ3factory
    let pool
    let pool2
    let mockedBaseAggregator
    let mockedBaseAggregator2
    let quoter
    let perpLemma
    let collateralDecimals
    const lowerTick = 0
    const upperTick = 100000

    before(async function () {
        [defaultSigner, usdLemma, reBalancer, hasWETH, signer1, signer2, usdl2, longAddress] = await ethers.getSigners();
        perpAddresses = await loadPerpLushanInfo();
        clearingHouse = new ethers.Contract(perpAddresses.clearingHouse.address, ClearingHouseAbi.abi, defaultSigner)
        orderBook = new ethers.Contract(perpAddresses.orderBook.address, OrderBookAbi.abi, defaultSigner);
        clearingHouseConfig = new ethers.Contract(perpAddresses.clearingHouseConfig.address, ClearingHouseConfigAbi.abi, defaultSigner);
        vault = new ethers.Contract(perpAddresses.vault.address, VaultAbi.abi, defaultSigner);
        exchange = new ethers.Contract(perpAddresses.exchange.address, ExchangeAbi.abi, defaultSigner);
        marketRegistry = new ethers.Contract(perpAddresses.marketRegistry.address, MarketRegistryAbi.abi, defaultSigner);
        collateral = new ethers.Contract(perpAddresses.collateral.address, TestERC20Abi.abi, defaultSigner);
        baseToken = new ethers.Contract(perpAddresses.baseToken.address, BaseTokenAbi.abi, defaultSigner);
        baseToken2 = new ethers.Contract(perpAddresses.baseToken2.address, BaseToken2Abi.abi, defaultSigner);
        quoteToken = new ethers.Contract(perpAddresses.quoteToken.address, QuoteTokenAbi.abi, defaultSigner);
        univ3factory = new ethers.Contract(perpAddresses.univ3factory.address, UniswapV3FactoryAbi.abi, defaultSigner)
        accountBalance = new ethers.Contract(perpAddresses.accountBalance.address, AccountBalanceAbi.abi, defaultSigner);
        mockedBaseAggregator = new ethers.Contract(perpAddresses.mockedBaseAggregator.address, MockTestAggregatorV3Abi.abi, defaultSigner);
        mockedBaseAggregator2 = new ethers.Contract(perpAddresses.mockedBaseAggregator2.address, MockTestAggregatorV3Abi.abi, defaultSigner);
        pool = new ethers.Contract(perpAddresses.pool.address, UniswapV3PoolAbi.abi, defaultSigner);
        pool2 = new ethers.Contract(perpAddresses.pool2.address, UniswapV3Pool2Abi.abi, defaultSigner);
        quoter = new ethers.Contract(perpAddresses.quoter.address, QuoterAbi.abi, defaultSigner)
        collateralDecimals = await collateral.decimals()

        const maxPosition = ethers.constants.MaxUint256;
        const perpLemmaFactory = await ethers.getContractFactory("PerpLemma")
        perpLemma = await upgrades.deployProxy(perpLemmaFactory, 
            [
                baseToken.address,
                quoteToken.address,
                clearingHouse.address,
                marketRegistry.address,
                usdLemma.address,
                maxPosition
        ], { initializer: 'initialize' });
        await perpLemma.connect(signer1).resetApprovals()

        // alice add long limit order
        await collateral.mint(signer1.address, parseUnits("10000000000", collateralDecimals))
        await collateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256)
        await vault.connect(signer1).deposit(collateral.address, parseUnits("10000", collateralDecimals))

        await collateral.mint(signer2.address, parseUnits("10000000000", collateralDecimals))
        await collateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256)
        await vault.connect(signer2).deposit(collateral.address, parseUnits("100000", collateralDecimals))

        await collateral.mint(longAddress.address, parseUnits("10000000000", collateralDecimals))
        await collateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256)
        await vault.connect(longAddress).deposit(collateral.address, parseUnits("10000", collateralDecimals))

        await collateral.mint(usdLemma.address, parseUnits("10000000000", collateralDecimals))
        await collateral.connect(usdLemma).approve(vault.address, ethers.constants.MaxUint256)
        await vault.connect(usdLemma).deposit(collateral.address, parseUnits("10000", collateralDecimals))
    })
    
    beforeEach(async function () {
        snapshotId = await snapshot();
    });
    
    afterEach(async function () {
        await revertToSnapshot(snapshotId);
    });

    async function calcLeverage() {
        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)
        depositedCollateral = await vault.getBalance(perpLemma.address)
        ethPrice = await mockedBaseAggregator2.getRoundData(0) //ethPrice
        interval = await clearingHouseConfig.getTwapInterval()
        usdcPriceInEth = await baseToken.getIndexPrice(interval)
        leverage_in_6_Decimal = depositedCollateral.mul(parseUnits('1', 26)).div(positionSize.mul(usdcPriceInEth))
        leverage_in_1 = depositedCollateral.mul(parseUnits('1', 18)).div(positionSize.mul(usdcPriceInEth))

        // console.log('\nethPrice: ', ethPrice[1].toString())
        // console.log('usdcPriceInEth: ', usdcPriceInEth.toString())
        // console.log('positionSize: ', positionSize.toString())
        // console.log('depositedCollateral: ', depositedCollateral.toString())

        return [ leverage_in_6_Decimal, leverage_in_1 ]
    }

    describe("#Rebalance Tests", async function () {

        beforeEach("Before each Rebalance", async () => {
            await mockedBaseAggregator.setLatestRoundData(0, parseUnits("0.01", collateralDecimals), 0, 0, 0)
            await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("100", collateralDecimals), 0, 0, 0)
            await pool.initialize(encodePriceSqrt("1", "100"))
            await pool.increaseObservationCardinalityNext((2 ^ 16) - 1)
            await marketRegistry.addPool(baseToken.address, 10000)
            await marketRegistry.setFeeRatio(baseToken.address, 10000)
            await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);
            await addLiquidity(
                clearingHouse, signer2, baseToken.address, 
                parseEther('100000'), parseEther('1000'), -887200, 887200
            )
        })

        it("#1.a Rebalance, only usdLemma with short eth", async () => {
            await collateral.connect(usdLemma).transfer(perpLemma.address, parseEther('1'))
            await perpLemma.connect(usdLemma).openWExactCollateral(parseEther('1')) 
            await forwardTimestamp(clearingHouse, 200)
            await clearingHouse.settleAllFunding(perpLemma.address)
            await forwardTimestamp(clearingHouse, 200)
            let fundingPayment = await exchange.getPendingFundingPayment(perpLemma.address, baseToken.address)
            console.log('fundingPayment: ', fundingPayment.toString())
            let leverage_before  = await calcLeverage()
            console.log('leverage_before_in_6_decimal: ', leverage_before[0].toString())
            console.log('leverage_before_in_1: ', leverage_before[1].toString())
            fundingPNL = await perpLemma.getFundingPNL()
            realizedFundingPnl = await perpLemma.realizedFundingPNL()
            console.log('fundingPNL: ', fundingPNL.toString())
            console.log('realizedFundingPnl: ', realizedFundingPnl.toString())
            const sqrtPriceLimitX96 = 0;
            const deadline = ethers.constants.MaxUint256;
            await perpLemma.connect(usdLemma).reBalance(
                reBalancer.address,
                fundingPNL.sub(realizedFundingPnl),
                ethers.utils.defaultAbiCoder.encode(
                    ["uint160", "uint256"],
                    [sqrtPriceLimitX96, deadline]
                )
            );
            let leverage_after  = await calcLeverage()
            console.log('leverage_after_in_6_decimal: ', leverage_after[0].toString())
            console.log('leverage_after_in_1: ', leverage_after[1].toString())
            expect(leverage_after[1]).eq(1)
        })

        it("#1.b Rebalance, longAddress(signer) with long eth, only usdLemma short eth", async () => {
            await openPosition(clearingHouse, longAddress, baseToken.address, true, false, parseEther('8'))
            await collateral.connect(usdLemma).transfer(perpLemma.address, parseEther('1'))
            await perpLemma.connect(usdLemma).openWExactCollateral(parseEther('1')) 
            await forwardTimestamp(clearingHouse, 200)
            await clearingHouse.settleAllFunding(perpLemma.address)
            await forwardTimestamp(clearingHouse, 200)
            let fundingPayment = await exchange.getPendingFundingPayment(perpLemma.address, baseToken.address)
            console.log('fundingPayment: ', fundingPayment.toString())
            let leverage_before  = await calcLeverage()
            console.log('leverage_before_in_6_decimal: ', leverage_before[0].toString())
            console.log('leverage_before_in_1: ', leverage_before[1].toString())
            fundingPNL = await perpLemma.getFundingPNL()
            realizedFundingPnl = await perpLemma.realizedFundingPNL()
            totalFundingPNL = await perpLemma.totalFundingPNL()
            console.log('fundingPNL: ', fundingPNL.toString())
            console.log('realizedFundingPnl: ', realizedFundingPnl.toString())
            const sqrtPriceLimitX96 = 0;
            const deadline = ethers.constants.MaxUint256;
            await perpLemma.connect(usdLemma).reBalance(
                reBalancer.address,
                fundingPNL.sub(realizedFundingPnl),
                ethers.utils.defaultAbiCoder.encode(
                    ["uint160", "uint256"],
                    [sqrtPriceLimitX96, deadline]
                )
            );
            let leverage_after  = await calcLeverage()
            console.log('leverage_after_in_6_decimal: ', leverage_after[0].toString())
            console.log('leverage_after_in_1: ', leverage_after[1].toString())

            expect(leverage_after[0]).lt(leverage_before[0])
            expect(leverage_after[1]).eq(1)
        })

        it("#1.c Rebalance, longAddress(signer) with long eth, signer1(signer) with short eth, and usdLemma short eth", async () => {
            await openPosition(clearingHouse, longAddress, baseToken.address, true, false, parseEther('8'))
            await openPosition(clearingHouse, signer1, baseToken.address, false, true, parseEther('5'))
            await collateral.connect(usdLemma).transfer(perpLemma.address, parseEther('1'))
            await perpLemma.connect(usdLemma).openWExactCollateral(parseEther('1')) 
            await forwardTimestamp(clearingHouse, 200)
            await clearingHouse.settleAllFunding(perpLemma.address)
            await forwardTimestamp(clearingHouse, 200)
            let fundingPayment = await exchange.getPendingFundingPayment(perpLemma.address, baseToken.address)
            console.log('fundingPayment: ', fundingPayment.toString())
            let leverage_before  = await calcLeverage()
            console.log('leverage_before_in_6_decimal: ', leverage_before[0].toString())
            console.log('leverage_before_in_1: ', leverage_before[1].toString())
            fundingPNL = await perpLemma.getFundingPNL()
            realizedFundingPnl = await perpLemma.realizedFundingPNL()
            totalFundingPNL = await perpLemma.totalFundingPNL()
            console.log('fundingPNL: ', fundingPNL.toString())
            console.log('realizedFundingPnl: ', realizedFundingPnl.toString())
            const sqrtPriceLimitX96 = 0;
            const deadline = ethers.constants.MaxUint256;
            await perpLemma.connect(usdLemma).reBalance(
                reBalancer.address,
                fundingPNL.sub(realizedFundingPnl),
                ethers.utils.defaultAbiCoder.encode(
                    ["uint160", "uint256"],
                    [sqrtPriceLimitX96, deadline]
                )
            );
            let leverage_after  = await calcLeverage()
            console.log('leverage_after_in_6_decimal: ', leverage_after[0].toString())
            console.log('leverage_after_in_1: ', leverage_after[1].toString())
            expect(leverage_after[0]).lt(leverage_before[0])
            expect(leverage_after[1]).eq(1)
        })
    })
})
