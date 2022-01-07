const { ethers } = require("hardhat");
const { expect, use } = require("chai");
const {solidity} = require('ethereum-waffle');
const { utils } = require('ethers');
const { parseEther, parseUnits } = require("ethers/lib/utils")
const { BigNumber } = require("@ethersproject/bignumber")
const { loadPerpLushanInfo, snapshot, revertToSnapshot, fromBigNumber } = require("./utils");
const bn = require("bignumber.js");
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

const ClearingHouseAbi = require('../perp-lushan/artifacts/contracts/test/TestClearingHouse.sol/TestClearingHouse.json')
const OrderBookAbi = require('../perp-lushan/artifacts/contracts/OrderBook.sol/OrderBook.json')
const ClearingHouseConfigAbi = require('../perp-lushan/artifacts/contracts/ClearingHouseConfig.sol/ClearingHouseConfig.json')
const VaultAbi = require('../perp-lushan/artifacts/contracts/Vault.sol/Vault.json')
const ExchangeAbi = require('../perp-lushan/artifacts/contracts/Exchange.sol/Exchange.json')
const MarketRegistryAbi = require('../perp-lushan/artifacts/contracts/MarketRegistry.sol/MarketRegistry.json')
const TestERC20Abi = require('../perp-lushan/artifacts/contracts/test/TestERC20.sol/TestERC20.json')
const BaseTokenAbi = require('../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json')
const BaseToken2Abi = require('../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json')
const QuoteTokenAbi = require('../perp-lushan/artifacts/contracts/QuoteToken.sol/QuoteToken.json')
const AccountBalanceAbi = require('../perp-lushan/artifacts/contracts/AccountBalance.sol/AccountBalance.json')
const MockTestAggregatorV3Abi = require('../perp-lushan/artifacts/contracts/mock/MockTestAggregatorV3.sol/MockTestAggregatorV3.json')
const UniswapV3PoolAbi = require('../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json')
const UniswapV3Pool2Abi = require('../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json');
const QuoterAbi = require('../perp-lushan/artifacts/@uniswap/v3-periphery/contracts/lens/Quoter.sol/Quoter.json')
const UniswapV3FactoryAbi = require('../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Factory.sol/UniswapV3Factory.json');

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

describe("perpLemma", async function () {
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
        [defaultSigner, usdLemma, reBalancer, hasWETH, signer1, signer2, usdl2] = await ethers.getSigners();
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
                clearingHouseConfig.address,
                vault.address,
                accountBalance.address,
                quoter.address,
                usdLemma.address,
                maxPosition
        ], { initializer: 'initialize' });
        await perpLemma.connect(signer1).resetApprovals()

        await mockedBaseAggregator.setLatestRoundData(0, parseUnits("100", collateralDecimals), 0, 0, 0)

        await pool.initialize(encodePriceSqrt("100", "1"))
        // the initial number of oracle can be recorded is 1; thus, have to expand it
        await pool.increaseObservationCardinalityNext((2 ^ 16) - 1)
        await pool2.initialize(encodePriceSqrt("100", "1")) // tick = 50200 (1.0001^50200 = 151.373306858723226652)

        await marketRegistry.addPool(baseToken.address, 10000)
        await marketRegistry.addPool(baseToken2.address, 10000)
        await marketRegistry.setFeeRatio(baseToken.address, 10000)
        await marketRegistry.setFeeRatio(baseToken2.address, 10000)

        // prepare collateral for maker
        const makerCollateralAmount = parseUnits("1000000", collateralDecimals)
        await collateral.mint(signer1.address, makerCollateralAmount)
        await collateral.mint(signer2.address, makerCollateralAmount)
        
        const parsedAmount = parseUnits("100000", collateralDecimals)
        await collateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256)
        await collateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256)

        // Deposit into vault
        // await vault.connect(signer1).deposit(collateral.address, parsedAmount)
        await vault.connect(signer2).deposit(collateral.address, parsedAmount)
        await clearingHouse.connect(signer2).addLiquidity({
            baseToken: baseToken.address,
            base: parseEther('100'),
            quote: parseEther('10000'),
            lowerTick: -887200, //50000,
            upperTick: 887200, //50400,
            minBase: 0,
            minQuote: 0,
            useTakerBalance: false,
            deadline: ethers.constants.MaxUint256,
        })
    })
    
    beforeEach(async function () {
        snapshotId = await snapshot();
    });
    
    afterEach(async function () {
        await revertToSnapshot(snapshotId);
    });

    it("should set addresses correctly", async function () {
        //setUSDLemma
        await expect(perpLemma.connect(signer1).setUSDLemma(signer1.address)).to.be.revertedWith("Ownable: caller is not the owner");
        await perpLemma.connect(defaultSigner).setUSDLemma(signer1.address);
        expect(await perpLemma.usdLemma()).to.equal(signer1.address);

        //setReferrer
        await expect(perpLemma.connect(signer1).setReferrerCode(
            ethers.utils.formatBytes32String("Hello World")
        )).to.be.revertedWith("Ownable: caller is not the owner");

        await perpLemma.connect(defaultSigner).setReferrerCode(
            ethers.utils.formatBytes32String("Hello World")
        );
            
        const byteCode = await perpLemma.referrerCode()
        expect(ethers.utils.parseBytes32String(byteCode)).to.eq("Hello World")
    });

    it("should fail to open when max position is reached", async function () {
        const amount = utils.parseEther("10000");
        await collateral.mint(usdLemma.address, amount)

        const collateralAmount = parseUnits("100", collateralDecimals) // 6 decimal
        const parsedAmount =  collateralAmount.mul(parseEther('1')).div(BigNumber.from('1000000')) // 18 decimal
        const leveragedAmount = parsedAmount.mul('1') // for 1x
        await perpLemma.setMaxPosition(leveragedAmount);

        await collateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount)
        await expect(perpLemma.connect(usdLemma).open(leveragedAmount.add(1), collateralAmount)).to.be.revertedWith("max position reached");
    })

    // need to correct more for collateralAmountToGetBack in close() position
    it("should close position correctly", async function () {
        const collateralAmount = parseUnits("100", collateralDecimals) // 6 decimal
        await collateral.mint(usdLemma.address, collateralAmount)
        
        let collateralToGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(parseEther('1'), true)
        let collateralToGetBack_1e6 = collateralToGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
        await collateral.connect(usdLemma).transfer(perpLemma.address, collateralToGetBack_1e6)
        await perpLemma.connect(usdLemma).open(parseEther('1'), collateralToGetBack_1e6)

        let collateralGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(parseEther('1'), false)
        let collateralGetBack_1e16 = collateralGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
        await expect(perpLemma.connect(usdLemma).close(parseEther('1'),collateralGetBack_1e16)).to.emit(clearingHouse, 'PositionChanged')
    })

    describe("OpenPosition", () => {
        let collateralToGetBack_1e6, collateralToGetBack_1e18
        beforeEach(async function () {

            const collateralAmount = parseUnits("100", collateralDecimals) // 6 decimal
            await collateral.mint(usdLemma.address, collateralAmount)
            
            collateralToGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(parseEther('1'), true)
            collateralToGetBack_1e6 = collateralToGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralToGetBack_1e6)
        });

        it("openPosition => emit event PositionChanged", async () => {
            await expect(perpLemma.connect(usdLemma).open(parseEther('1'), collateralToGetBack_1e6)).to.emit(clearingHouse, 'PositionChanged')            
        });

        it("openPosition => leverage should be 1x", async () => {
            await expect(perpLemma.connect(usdLemma).open(parseEther('1'), collateralToGetBack_1e6)).to.emit(clearingHouse, 'PositionChanged')            
            const marginRequirementForLiquidation = await accountBalance.getMarginRequirementForLiquidation(perpLemma.address)            
            expect(marginRequirementForLiquidation).to.be.eq(parseEther('6.25'))

            // const depositedCollateral = await vault.getBalance(perpLemma.address)
            // const positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)
            // const positionValue = await accountBalance.getTotalPositionValue(perpLemma.address, baseToken.address)
            // const interval = await clearingHouseConfig.getTwapInterval()
            // const indexPrice = await baseToken.getIndexPrice(interval)

            // const divisor = positionSize.mul(indexPrice).div(parseEther('1'))
            // const depositedCollateralWith1e18 = depositedCollateral.mul(parseEther('1'))
            // const leverage = depositedCollateralWith1e18.div(divisor).mul(-1) // 979999(close to 1e6 or 1x)
            // expect(leverage).to.be.closeTo(parseUnits('1', 6), BigNumber.from('50000')); // leverage should be 1x(1e6) or close to 1e6
        });
    })

    describe("OpenPosition with getCollateralAmountGivenUnderlyingAssetAmount", () => {
        beforeEach(async function () {
            let collateralmintAmount = parseUnits("1000", collateralDecimals) // 6 decimal
            await collateral.mint(usdLemma.address, collateralmintAmount)
        });

        it("openPosition => open position for short and close position for 2 time longs", async () => {
            let collateralToGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(parseEther('1'), true)
            let collateralToGetBack_1e6 = collateralToGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralToGetBack_1e6)
            await perpLemma.connect(usdLemma).open(parseEther('1'), collateralToGetBack_1e6)

            const marginRequirementForLiquidation = await accountBalance.getMarginRequirementForLiquidation(perpLemma.address)            
            expect(marginRequirementForLiquidation).to.be.eq(parseEther('6.25'))

            let collateralGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(parseEther('0.1'), false)
            let collateralGetBack_1e16 = collateralGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
            await expect(perpLemma.connect(usdLemma).close(parseEther('0.1'),collateralGetBack_1e16)).to.emit(clearingHouse, 'PositionChanged')
        
            collateralGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(parseEther('0.9'), false)
            collateralGetBack_1e16 = collateralGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
            await expect(perpLemma.connect(usdLemma).close(parseEther('0.9'), collateralGetBack_1e16)).to.emit(clearingHouse, 'PositionChanged')

            positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address) 
            ratioforMm1 = await vault.getFreeCollateralByRatio(perpLemma.address, 0)
            bal2 = await collateral.balanceOf(usdLemma.address)
            expect(positionSize).to.be.eq(parseEther('0'))
            expect(ratioforMm1).to.be.eq(parseEther('0'))
        });

        it("openPosition => open position for short and close position for long", async () => {
            let collateralToGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(parseEther('1'), true)
            let collateralToGetBack_1e6 = collateralToGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralToGetBack_1e6)
            await perpLemma.connect(usdLemma).open(parseEther('1'), collateralToGetBack_1e6)

            const marginRequirementForLiquidation = await accountBalance.getMarginRequirementForLiquidation(perpLemma.address)            
            expect(marginRequirementForLiquidation).to.be.eq(parseEther('6.25'))

            let collateralGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(parseEther('1'), false)
            let collateralGetBack_1e16 = collateralGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
            await expect(perpLemma.connect(usdLemma).close(parseEther('1'),collateralGetBack_1e16)).to.emit(clearingHouse, 'PositionChanged')
        
            positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address) 
            ratioforMm1 = await vault.getFreeCollateralByRatio(perpLemma.address, 0)
            bal2 = await collateral.balanceOf(usdLemma.address)
            expect(positionSize).to.be.eq(parseEther('0'))
            expect(ratioforMm1).to.be.eq(parseEther('0'))

        });
    })

    describe("re balance", async function () {
        let collateralmintAmount, collateralAmount, parsedAmount, leveragedAmount
        before(async function () {
            await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);
        })
        beforeEach(async function () {
            collateralmintAmount = parseUnits("100000", collateralDecimals) // 6 decimal
            collateralAmount = parseUnits("1000", collateralDecimals) // 6 decimal
            parsedAmount =  collateralAmount.mul(parseEther('1')).div(parseUnits('1', 6)) // 18 decimal
            leveragedAmount = parsedAmount.mul('1') // for 1x
            await collateral.mint(usdLemma.address, collateralmintAmount)
        });

        it("if amount is positive then it should long", async () => {
            const sqrtPriceLimitX96 = 0;
            const deadline = ethers.constants.MaxUint256;
            // await expect(perpLemma.connect(usdLemma).open(leveragedAmount, collateralAmount)).to.emit(clearingHouse, 'PositionChanged')
            let collateralToGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(parseEther('1'), true)
            let collateralToGetBack_1e6 = collateralToGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralToGetBack_1e6)
            await perpLemma.connect(usdLemma).open(parseEther('1'), collateralToGetBack_1e6)
            const rebalanceAmount = parseEther('0.05') // 5% of 1 ether
            await perpLemma.connect(usdLemma).reBalance(
                reBalancer.address, 
                BigNumber.from(rebalanceAmount), // positive amount(+ve)
                ethers.utils.defaultAbiCoder.encode(
                    ["uint160", "uint256"], 
                    [sqrtPriceLimitX96, deadline]
                )
            );
        })

        it("if amount is negative then it should short", async () => {
            const sqrtPriceLimitX96 = 0;
            const deadline = ethers.constants.MaxUint256;
            // await expect(perpLemma.connect(usdLemma).open(leveragedAmount, collateralAmount)).to.emit(clearingHouse, 'PositionChanged')
            let collateralToGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(parseEther('1'), true)
            let collateralToGetBack_1e6 = collateralToGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralToGetBack_1e6)
            await perpLemma.connect(usdLemma).open(parseEther('1'), collateralToGetBack_1e6)
            const rebalanceAmount = parseEther('0.05') // 5% of 1 ether
            await perpLemma.connect(usdLemma).reBalance(
                reBalancer.address, 
                BigNumber.from(rebalanceAmount).mul(-1), // negative amount(-ve)
                ethers.utils.defaultAbiCoder.encode(
                    ["uint160", "uint256"], 
                    [sqrtPriceLimitX96, deadline]
                )
            );
        })
    })


    describe("Emergency Settlement", async function () {
        //let collateralmintAmount, collateralAmount, parsedAmount, leveragedAmount

        /*
        before(async function () {

        })
        */
        beforeEach(async function () {
            // Open a Position

        });

        /*
        it("Test1", async () => {
            await expect(perpLemma.connect(usdLemma).settle()).to.be.revertedWith("CH_MNC");
        })


        it("Test2", async () => {
            await expect(baseToken.connect(defaultSigner).pause(0)).to.emit(baseToken, 'StatusUpdated');
            await expect(perpLemma.connect(usdLemma).settle()).to.be.revertedWith("CH_MNC");
        })
        */


        it("Test3", async () => {
            // 1. Mint
            const collateralAmount = parseUnits("100", collateralDecimals) // 6 decimal
            await collateral.mint(usdLemma.address, collateralAmount)
            
            const collateralUSDLemma_t0 = await collateral.balanceOf(usdLemma.address);
            const collateralPerpLemma_t0 = await collateral.balanceOf(perpLemma.address);

            console.log("Initial Balances");
            console.log(`USDLemma Balance = ${collateralUSDLemma_t0}`); 
            console.log(`PerpLemma Balance = ${collateralPerpLemma_t0}`);



            // 2. Get amount of collateral
            const perpPosition = parseEther('1');
            collateralRequired_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount2(perpPosition, true)
            collateralRequired_1e6 = collateralRequired_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
            console.log(`Collateral Required to Open a short ${perpPosition} (1e18) on BaseToken (vUSD) = ${collateralRequired_1e6} (1e6) Collateral (ETH)`);

            // 3. Open Position
            // 3.1 Transfer from USDLemma (High Level Abstraction Trader)  --> PerpLemma (Backend Protocol Specific Trader)
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralRequired_1e6);

            const collateralUSDLemma_t1 = await collateral.balanceOf(usdLemma.address);
            const collateralPerpLemma_t1 = await collateral.balanceOf(perpLemma.address);

            console.log("Balances after transfer");
            console.log(`USDLemma Balance = ${collateralUSDLemma_t1}, delta = ${collateralUSDLemma_t1 - collateralUSDLemma_t0}`); 
            console.log(`PerpLemma Balance = ${collateralPerpLemma_t1}, delta = ${collateralPerpLemma_t1 - collateralPerpLemma_t0}`);

            // 3.2 USDLemma calls PerpLemma Open to open a position at the PerpV2 Clearing House
            await expect(perpLemma.connect(usdLemma).open(parseEther('1'), collateralRequired_1e6)).to.emit(clearingHouse, 'PositionChanged');



            const collateralUSDLemma_t2 = await collateral.balanceOf(usdLemma.address);
            const collateralPerpLemma_t2 = await collateral.balanceOf(perpLemma.address);

            console.log("Balances after transfer");
            console.log(`USDLemma Balance = ${collateralUSDLemma_t2}, delta = ${collateralUSDLemma_t2 - collateralUSDLemma_t1}`); 
            console.log(`PerpLemma Balance = ${collateralPerpLemma_t2}, delta = ${collateralPerpLemma_t2 - collateralPerpLemma_t1}`);



            console.log("Test3 Initial Balance");
            const collateralUSDLemma_t3 = await collateral.balanceOf(usdLemma.address);
            const collateralPerpLemma_t3 = await collateral.balanceOf(perpLemma.address);

            console.log("Balances after transfer");
            console.log(`USDLemma Balance = ${collateralUSDLemma_t3}`); 
            console.log(`PerpLemma Balance = ${collateralPerpLemma_t3}`);


            //await expect(baseToken.connect(defaultSigner).pause(0)).to.emit(baseToken, 'StatusUpdated');
            //console.dir(baseToken.connect(defaultSigner).methods);
            //const status = await baseToken.callStatic.getStatus();
            //console.log(`Status = ${status}`);
            //console.dir(baseToken.connect(defaultSigner)["pause(uint256)"](1));

            //console.log(`Settlement Token = ${await vault.getSettlementToken()}`);

            // Start with Market Open
            expect(await baseToken.getStatus()).to.be.equal(0);

            // Pause Market
            expect(await (baseToken.connect(defaultSigner)["pause(uint256)"](0))).to.emit(baseToken, 'StatusUpdated');
            expect(await baseToken.callStatic.getStatus()).to.be.equal(1);

            // Close Market
            expect(await (baseToken.connect(defaultSigner)["close(uint256)"](1))).to.emit(baseToken, 'StatusUpdated');
            expect(await baseToken.callStatic.getStatus()).to.be.equal(2);
            //await baseToken.connect(defaultSigner).close(1);
            //await expect(baseToken.connect(defaultSigner).close()).to.emit(baseToken, 'StatusUpdated');

            expect(await perpLemma.connect(usdLemma).settle()).to.emit(clearingHouse, 'PositionChanged');


            console.log("Test3 Final Balance");
            const collateralUSDLemma_t32 = await collateral.balanceOf(usdLemma.address);
            const collateralPerpLemma_t32 = await collateral.balanceOf(perpLemma.address);

            console.log("Balances after transfer");
            console.log(`USDLemma Balance = ${collateralUSDLemma_t32}, delta = ${collateralUSDLemma_t32 - collateralUSDLemma_t3}`); 
            console.log(`PerpLemma Balance = ${collateralPerpLemma_t32}, delta = ${collateralPerpLemma_t32 - collateralPerpLemma_t3}, delta with initial ${collateralPerpLemma_t32 - collateralPerpLemma_t1}`);
        })


    })

})
