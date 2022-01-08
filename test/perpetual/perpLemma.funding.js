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

describe("perpLemma.funding", async function () {
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
                collateral.address,
                quoteToken.address, // vUSD
                baseToken.address,
                quoteToken.address,
                clearingHouse.address,
                vault.address,
                accountBalance.address,
                quoter.address,
                usdLemma.address,
                maxPosition
        ], { initializer: 'initialize' });
        await perpLemma.connect(signer1).resetApprovals()

        await mockedBaseAggregator.setLatestRoundData(0, parseUnits("10", collateralDecimals), 0, 0, 0)

        await pool.initialize(encodePriceSqrt("10", "1"))
        // the initial number of oracle can be recorded is 1; thus, have to expand it
        await pool.increaseObservationCardinalityNext((2 ^ 16) - 1)
        // await pool2.initialize(encodePriceSqrt("10", "1")) // tick = 50200 (1.0001^50200 = 151.373306858723226652)

        await marketRegistry.addPool(baseToken.address, 10000)
        await marketRegistry.setFeeRatio(baseToken.address, 10000)

        // alice add long limit order
        await collateral.mint(signer1.address, parseUnits("10000000000", collateralDecimals))
        await collateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256)
        await vault.connect(signer1).deposit(collateral.address, parseUnits("10000", collateralDecimals))

        await collateral.mint(signer2.address, parseUnits("1000", collateralDecimals))
        await collateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256)
        await vault.connect(signer2).deposit(collateral.address, parseUnits("1000", collateralDecimals))

        await collateral.mint(longAddress.address, parseUnits("1000", collateralDecimals))
        await collateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256)
        await vault.connect(longAddress).deposit(collateral.address, parseUnits("1000", collateralDecimals))

        await collateral.mint(usdLemma.address, parseUnits("1000000000", collateralDecimals))
        await collateral.connect(usdLemma).approve(vault.address, ethers.constants.MaxUint256)
        await vault.connect(usdLemma).deposit(collateral.address, parseUnits("10000", collateralDecimals))
    })
    
    beforeEach(async function () {
        snapshotId = await snapshot();
    });
    
    afterEach(async function () {
        await revertToSnapshot(snapshotId);
    });

    describe("#Funding Payment", async function () {

        it("#1 Funding payment", async () => {
            // clearingHouse, signer, baseTokenAddress, _baseAmount, _quoteAmount, lowerTick, upperTick 
            await addLiquidity(clearingHouse, signer2, baseToken.address, parseEther('100'), parseEther('10000'), 22000, 24000)

            // long and amount in usd
            await openPosition(clearingHouse, longAddress, baseToken.address, false, true, parseEther('200'))
            // short and amount in usd
            await openPosition(clearingHouse, signer1, baseToken.address, true, false, parseEther('100'))
            
            // collateral get back for open method
            let openPositionParams = await callStaticOpenPosition(clearingHouse, longAddress, baseToken.address, true, true, parseEther('3'))
            let collateralToGetBack_1e6 = openPositionParams[1].mul(parseUnits('1', collateralDecimals)).div(parseEther('1')).toString() // 18 to 6
            console.log('collateralToGetBack_1e6: ', collateralToGetBack_1e6.toString())

            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralToGetBack_1e6)
            await perpLemma.connect(usdLemma).open(parseEther('3'), collateralToGetBack_1e6) // here

            await forwardTimestamp(clearingHouse, 200)
            await clearingHouse.settleAllFunding(perpLemma.address)
            await forwardTimestamp(clearingHouse, 200)
            await clearingHouse.settleAllFunding(perpLemma.address)

            let fundingPayment = await exchange.getPendingFundingPayment(perpLemma.address, baseToken.address)
            console.log('fundingPayment: ', fundingPayment.toString())

            await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);
            let depositedCollateral = await vault.getBalance(perpLemma.address)

            // let depositedCollateral = await clearingHouse.getAccountValue(perpLemma.address)
            // depositedCollateral = depositedCollateral.mul(parseUnits('1', collateralDecimals)).div(parseEther('1')) // 18 to 6
            
            let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)
            let positionValue = await accountBalance.getTotalPositionValue(perpLemma.address, baseToken.address)
            console.log('depositedCollateral:- ', depositedCollateral.toString())
            console.log('positionSize:- ', positionSize.toString())
            console.log('positionValue:- ', positionValue.toString())

            // collateral get back for rebalance method
            openPositionParams = await callStaticOpenPosition(clearingHouse, longAddress, baseToken.address, true, true, parseEther('3'))
            console.log('openPositionParams: ', openPositionParams[0].toString(), openPositionParams[1].toString())
            collateralToGetBack_1e6 = openPositionParams[1].mul(parseUnits('1', collateralDecimals)).div(parseEther('1')).toString() // 18 to 6
            console.log('collateralToGetBack_1e6: ', collateralToGetBack_1e6.toString())
            
            let rebalanceAmount = depositedCollateral.sub(collateralToGetBack_1e6)
            console.log('rebalanceAmount in 1e6: ', rebalanceAmount.toString())
            rebalanceAmount = rebalanceAmount.mul(parseEther('1')).div(parseUnits('1', collateralDecimals)).toString() // 6 to 18
            console.log('rebalanceAmount in 1e18: ', rebalanceAmount.toString())

            const sqrtPriceLimitX96 = 0;
            const deadline = ethers.constants.MaxUint256;
            await perpLemma.connect(usdLemma).reBalance(
                reBalancer.address,
                rebalanceAmount,
                ethers.utils.defaultAbiCoder.encode(
                    ["uint160", "uint256"],
                    [sqrtPriceLimitX96, deadline]
                )
            );

            // after rebalance
            openPositionParams = await callStaticOpenPosition(clearingHouse, longAddress, baseToken.address, true, true, parseEther('3'))
            console.log('openPositionParams: ', openPositionParams[0].toString(), openPositionParams[1].toString())
            
            collateralToGetBack_1e6 = openPositionParams[1].mul(parseUnits('1', collateralDecimals)).div(parseEther('1')).toString() // 18 to 6
            console.log('collateralToGetBack_1e6--: ', collateralToGetBack_1e6.toString())

            // depositedCollateral = await vault.getBalance(perpLemma.address)
            depositedCollateral = await clearingHouse.getAccountValue(perpLemma.address)
            depositedCollateral = depositedCollateral.mul(parseUnits('1', collateralDecimals)).div(parseEther('1')).toString() // 18 to 6
            positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)
            positionValue = await accountBalance.getTotalPositionValue(perpLemma.address, baseToken.address)
            console.log('depositedCollateral: ', depositedCollateral.toString())
            console.log('positionSize: ', positionSize.toString())
            console.log('positionValue: ', positionValue.toString())
            fundingPayment = await exchange.getPendingFundingPayment(perpLemma.address, baseToken.address)
            console.log('fundingPayment: ', fundingPayment.toString())
        })

        // it("#2 Funding payment", async () => {

        //     await clearingHouse.connect(signer2).addLiquidity({
        //         baseToken: baseToken.address,
        //         base: parseEther('10'),
        //         quote: parseEther('1000'),
        //         lowerTick: 22000,
        //         upperTick: 24000,
        //         minBase: 0,
        //         minQuote: 0,
        //         useTakerBalance: false,
        //         deadline: ethers.constants.MaxUint256,
        //     })

        //     let openPositionParams = await clearingHouse.connect(longAddress).callStatic.openPosition({
        //         baseToken: baseToken.address,
        //         isBaseToQuote: true,
        //         isExactInput: true,
        //         oppositeAmountBound: 0,
        //         amount: parseEther('3'),
        //         sqrtPriceLimitX96: 0,
        //         deadline: ethers.constants.MaxUint256,
        //         referralCode: ethers.constants.HashZero,
        //     })
        //     let collateralToGetBack_1e6 = openPositionParams[1].mul(parseUnits('1', collateralDecimals)).div(parseEther('1')).toString() // 18 to 6
        //     console.log('collateralToGetBack_1e6: ', collateralToGetBack_1e6.toString())

        //     // await collateral.mint(perpLemma.address, parseUnits("10", collateralDecimals))
        //     // await perpLemma.depositKeeperGasReward()
        //     // let collateralToGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(parseEther('1'), true)
        //     // let collateralToGetBack_1e6 = collateralToGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
        //     // console.log('collateralToGetBack_1e6--: ', collateralToGetBack_1e6.toString())

        //     await clearingHouse.connect(longAddress).openPosition({
        //         baseToken: baseToken.address,
        //         isBaseToQuote: false,
        //         isExactInput: true,
        //         oppositeAmountBound: 0,
        //         amount: parseEther('200'), // amount in usd
        //         sqrtPriceLimitX96: 0,
        //         deadline: ethers.constants.MaxUint256,
        //         referralCode: ethers.constants.HashZero,
        //     })
        //     console.log("Done OpenPosition for longAddress")

        //     // await clearingHouse.connect(signer1).openPosition({
        //     //     baseToken: baseToken.address,
        //     //     isBaseToQuote: true,
        //     //     isExactInput: false,
        //     //     oppositeAmountBound: 0,
        //     //     amount: parseEther('100'), // amount in usd
        //     //     sqrtPriceLimitX96: 0,
        //     //     deadline: ethers.constants.MaxUint256,
        //     //     referralCode: ethers.constants.HashZero,
        //     // })
        //     // console.log("Done OpenPosition for signer1")
            
        //     await collateral.connect(usdLemma).transfer(perpLemma.address, collateralToGetBack_1e6)
        //     console.log("Done transfer for UsdlLemma")
        //     await perpLemma.connect(usdLemma).open(parseEther('3'), collateralToGetBack_1e6)
        //     console.log("Done OpenPosition for UsdlLemma")
                        
        //     // const fee = (
        //     //     await clearingHouse.connect(signer2).callStatic.removeLiquidity({
        //     //         baseToken: baseToken.address,
        //     //         lowerTick: 22000,
        //     //         upperTick: 24000,
        //     //         liquidity: 0,
        //     //         minBase: 0,
        //     //         minQuote: 0,
        //     //         deadline: ethers.constants.MaxUint256,
        //     //     })
        //     // ).fee
        //     // console.log('fee: ', fee.toString())

        //     await forwardTimestamp(clearingHouse, 200)
        //     await clearingHouse.settleAllFunding(perpLemma.address)
        //     await forwardTimestamp(clearingHouse, 200)

        //     let fundingPayment = await exchange.getPendingFundingPayment(perpLemma.address, baseToken.address)
        //     console.log('fundingPayment: ', fundingPayment.toString())
        //     // expect(fundingPayment).to.be.gt(0)

        //     // collateralToGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(fundingPayment, false)
        //     // collateralToGetBack_1e6 = collateralToGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
        //     // console.log('collateralToGetBack_1e6: ', collateralToGetBack_1e6.toString())

        //     await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);
        //     let depositedCollateral = await vault.getBalance(perpLemma.address)
        //     let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)
        //     let positionValue = await accountBalance.getTotalPositionValue(perpLemma.address, baseToken.address)
        //     console.log('depositedCollateral: ', depositedCollateral.toString())
        //     console.log('positionSize: ', positionSize.toString())
        //     console.log('positionValue: ', positionValue.toString())

        //     openPositionParams = await clearingHouse.connect(longAddress).callStatic.openPosition({
        //         baseToken: baseToken.address,
        //         isBaseToQuote: true,
        //         isExactInput: true,
        //         oppositeAmountBound: 0,
        //         amount: parseEther('3'),
        //         sqrtPriceLimitX96: 0,
        //         deadline: ethers.constants.MaxUint256,
        //         referralCode: ethers.constants.HashZero,
        //     })
        //     console.log('openPositionParams: ', openPositionParams[0].toString(), openPositionParams[1].toString())
        //     collateralToGetBack_1e6 = openPositionParams[1].mul(parseUnits('1', collateralDecimals)).div(parseEther('1')).toString() // 18 to 6
        //     console.log('collateralToGetBack_1e6: ', collateralToGetBack_1e6.toString())

        //     let rebalanceAmount = depositedCollateral.sub(collateralToGetBack_1e6)
        //     console.log('rebalanceAmount in 1e6: ', rebalanceAmount.toString())
        //     rebalanceAmount = rebalanceAmount.mul(parseEther('1')).div(parseUnits('1', collateralDecimals)).toString()
        //     console.log('rebalanceAmount in 1e18: ', rebalanceAmount.toString())

        //     const sqrtPriceLimitX96 = 0;
        //     const deadline = ethers.constants.MaxUint256;
        //     await perpLemma.connect(usdLemma).reBalance(
        //         reBalancer.address,
        //         rebalanceAmount,
        //         ethers.utils.defaultAbiCoder.encode(
        //             ["uint160", "uint256"], 
        //             [sqrtPriceLimitX96, deadline]
        //         )
        //     );

        //     // after rebalance
        //     openPositionParams = await clearingHouse.connect(longAddress).callStatic.openPosition({
        //         baseToken: baseToken.address,
        //         isBaseToQuote: true,
        //         isExactInput: true,
        //         oppositeAmountBound: 0,
        //         amount: parseEther('3'),
        //         sqrtPriceLimitX96: 0,
        //         deadline: ethers.constants.MaxUint256,
        //         referralCode: ethers.constants.HashZero,
        //     })
        //     console.log('openPositionParams: ', openPositionParams[0].toString(), openPositionParams[1].toString())
        //     collateralToGetBack_1e6 = openPositionParams[1].mul(parseUnits('1', collateralDecimals)).div(parseEther('1')).toString() // 18 to 6
        //     console.log('collateralToGetBack_1e6--: ', collateralToGetBack_1e6.toString())

        //     depositedCollateral = await vault.getBalance(perpLemma.address)
        //     positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)
        //     positionValue = await accountBalance.getTotalPositionValue(perpLemma.address, baseToken.address)
        //     console.log('depositedCollateral: ', depositedCollateral.toString())
        //     console.log('positionSize: ', positionSize.toString())
        //     console.log('positionValue: ', positionValue.toString())

        //     fundingPayment = await exchange.getPendingFundingPayment(perpLemma.address, baseToken.address)
        //     console.log('fundingPayment: ', fundingPayment.toString())

        // })
    })

    // it("#1 Funding payment2", async () => {

    //     await mockedBaseAggregator.setLatestRoundData(0, parseUnits("10", collateralDecimals), 0, 0, 0)
    //     const orderIds = await orderBook.getOpenOrderIds(signer2.address, baseToken.address)

    //     for (const orderId of orderIds) {
    //         let { lowerTick, upperTick, liquidity } = await orderBook.getOpenOrderById(orderId)
    //         await clearingHouse.connect(signer2).removeLiquidity({
    //             baseToken: baseToken.address,
    //             lowerTick,
    //             upperTick,
    //             liquidity,
    //             minBase: 0,
    //             minQuote: 0,
    //             deadline: ethers.constants.MaxUint256,
    //         })
    //     }

    //     await clearingHouse.connect(signer2).addLiquidity({
    //         baseToken: baseToken.address,
    //         base: parseEther('10'),
    //         quote: parseEther('1000'),
    //         lowerTick: 22000,
    //         upperTick: 24000,
    //         minBase: 0,
    //         minQuote: 0,
    //         useTakerBalance: false,
    //         deadline: ethers.constants.MaxUint256,
    //     })

    //     await clearingHouse.connect(usdLemma).openPosition({
    //         baseToken: baseToken.address,
    //         isBaseToQuote: false,
    //         isExactInput: true,
    //         oppositeAmountBound: 0,
    //         amount: parseEther('20000'),
    //         sqrtPriceLimitX96: 0,
    //         deadline: ethers.constants.MaxUint256,
    //         referralCode: ethers.constants.HashZero,
    //     })

    //     const fee = (
    //         await clearingHouse.connect(signer2).callStatic.removeLiquidity({
    //             baseToken: baseToken.address,
    //             lowerTick: 22000,
    //             upperTick: 24000,
    //             liquidity: 0,
    //             minBase: 0,
    //             minQuote: 0,
    //             deadline: ethers.constants.MaxUint256,
    //         })
    //     ).fee
    //     console.log('fee: ', fee.toString())

    //     await forwardTimestamp(clearingHouse, 200)
    //     await clearingHouse.settleAllFunding(usdLemma.address)
    //     await forwardTimestamp(clearingHouse, 200)

    //     const fundingPayment = await exchange.getPendingFundingPayment(usdLemma.address, baseToken.address)
    //     console.log('fundingPayment: ', fundingPayment.toString(), fee.toString())
    //     expect(fundingPayment).to.be.gt(0)

    //     // await perpLemma.connect(signer2).reBalance(
    //     //     reBalancer.address, 
    //     //     fundingPayment.mul(-1), // negative amount(-ve)
    //     //     ethers.utils.defaultAbiCoder.encode(
    //     //         ["uint160", "uint256"], 
    //     //         [sqrtPriceLimitX96, deadline]
    //     //     )
    //     // );
    // })
})
