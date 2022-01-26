const { ethers } = require("hardhat");
const { expect, use } = require("chai");
const {solidity} = require('ethereum-waffle');
const { utils } = require('ethers');
const { parseEther, parseUnits } = require("ethers/lib/utils")
const { BigNumber } = require("@ethersproject/bignumber")
const { loadPerpLushanInfo, snapshot, revertToSnapshot, fromBigNumber } = require("../utils");
const bn = require("bignumber.js");
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

const AddressZero = "0x0000000000000000000000000000000000000000";
const MaxInt256 = ( /*#__PURE__*/BigNumber.from("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"));

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

function fromD1toD2(x, d1, d2)
{
    x = x.toString();
    return parseUnits(x, 0).mul(parseUnits('1', d2)).div(parseUnits('1', d1));
}

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
                baseToken.address,
                quoteToken.address,
                clearingHouse.address,
                clearingHouseConfig.address,
                vault.address,
                accountBalance.address,
                marketRegistry.address,
                quoter.address,
                collateral.address,         // TODO: Fix it
                maxPosition
        ], { initializer: 'initialize' });

        const USDLemma = await ethers.getContractFactory("USDLemma");
        usdLemma = await upgrades.deployProxy(USDLemma, [AddressZero, collateral.address, perpLemma.address], { initializer: 'initialize' });
        await perpLemma.setUSDLemma(usdLemma.address);

        //await addPerpetualDEXWrapper

        await perpLemma.connect(signer1).resetApprovals()

        await mockedBaseAggregator.setLatestRoundData(0, parseUnits("1", collateralDecimals), 0, 0, 0)
        await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("100", collateralDecimals), 0, 0, 0)

        await pool.initialize(encodePriceSqrt("1", "100"))
        // the initial number of oracle can be recorded is 1; thus, have to expand it
        await pool.increaseObservationCardinalityNext((2 ^ 16) - 1)
        await pool2.initialize(encodePriceSqrt("1", "100")) // tick = 50200 (1.0001^50200 = 151.373306858723226652)

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
            base: parseEther('10000'),
            quote: parseEther('100'),
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
    
    /*
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
        const collateralAmount = parseUnits("1", collateralDecimals) // 6 decimal
        await perpLemma.setMaxPosition(collateralAmount);
        await collateral.mint(usdLemma.address, collateralAmount.add(1))
        await collateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount.add(1))
        await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralAmount.add(1))).to.be.revertedWith("max position reached");
    })

    // need to correct more for collateralAmountToGetBack in close() position
    it("should close position correctly", async function () {
        const collateralAmount = parseUnits("100", collateralDecimals) // 6 decimal
        await collateral.mint(usdLemma.address, collateralAmount)

        // transfer Collateral to perpLemma
        await collateral.connect(usdLemma).transfer(perpLemma.address, parseEther('1'))
        // Deposit collateral in eth and Short eth and long usdc 
        await perpLemma.connect(usdLemma).openWExactCollateral(parseEther('1'))

        positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address) 
        // long eth and close position, withdraw collateral
        await expect(await perpLemma.connect(usdLemma).closeWExactCollateral(positionSize)).to.emit(clearingHouse, 'PositionChanged')
    })

    describe("OpenPosition", () => {
        let collateralToGetBack_1e6, collateralToGetBack_1e18
        beforeEach(async function () {

            const collateralAmount = parseEther('1')
            await collateral.mint(usdLemma.address, collateralAmount)
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralAmount)
        });

        it("openPosition => emit event PositionChanged", async () => {
            await expect(perpLemma.connect(usdLemma).openWExactCollateral(parseEther('1'))).to.emit(clearingHouse, 'PositionChanged')            
        });

        it("openPosition => leverage should be 1x", async () => {
            await expect(perpLemma.connect(usdLemma).openWExactCollateral(parseEther('1'))).to.emit(clearingHouse, 'PositionChanged')            
            const depositedCollateral = await vault.getBalance(perpLemma.address)
            const positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)
            const ethPrice = await mockedBaseAggregator2.getRoundData(0) //ethPrice
            const leverage = depositedCollateral.mul(ethPrice[1]).div(positionSize) // 979999(close to 1e6 or 1x)
            // console.log('positionSize:' , positionSize.toString())
            // console.log('ethPrice:' , ethPrice[1].toString())
            // console.log('divisor:' , divisor.toString())
            // console.log('depositedCollateral:' , depositedCollateral.toString())
            // console.log('leverage:' , leverage.toString())
            expect(leverage).to.be.closeTo(parseUnits('1', collateralDecimals), parseEther('0.031')); // leverage should be 1x(1e6) or close to 1e6
        });
    })

    describe("OpenPosition with getCollateralAmountGivenUnderlyingAssetAmount", () => {
        let collateralmintAmount
        beforeEach(async function () {
            collateralmintAmount = parseEther('1')
            await collateral.mint(usdLemma.address, collateralmintAmount)
        });

        it("openPosition => open position for short and close position for 2 time longs", async () => {
            // let collateralToGetBack_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(parseEther('1'), true)
            // let collateralToGetBack_1e6 = collateralToGetBack_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralmintAmount)
            await perpLemma.connect(usdLemma).openWExactCollateral(parseEther('1'))

            let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)
            // #1    
            await expect(perpLemma.connect(usdLemma).closeWExactCollateral(positionSize.div(2))).to.emit(clearingHouse, 'PositionChanged')
            // #2
            await expect(perpLemma.connect(usdLemma).closeWExactCollateral(positionSize.div(2))).to.emit(clearingHouse, 'PositionChanged')
            positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address) 
            expect(positionSize).to.be.closeTo(parseEther('1'), parseEther('0.1'))
        });

        it("openPosition => open position for short and close position for long", async () => {
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralmintAmount)
            await perpLemma.connect(usdLemma).openWExactCollateral(collateralmintAmount)
            let positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)
            await expect(perpLemma.connect(usdLemma).closeWExactCollateral(positionSize)).to.emit(clearingHouse, 'PositionChanged')
            positionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address) 
            expect(positionSize).to.be.closeTo(parseEther('1'), parseEther('0.1'))
        });
    })

    describe("re balance", async function () {
        let collateralmintAmount, collateralAmount, parsedAmount, leveragedAmount
        before(async function () {
            await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);
        })
        beforeEach(async function () {
            collateralmintAmount = parseEther('1')
            // collateralAmount = parseUnits("1000", collateralDecimals) // 6 decimal
            // parsedAmount =  collateralAmount.mul(parseEther('1')).div(parseUnits('1', 6)) // 18 decimal
            // leveragedAmount = parsedAmount.mul('1') // for 1x
            await collateral.mint(usdLemma.address, collateralmintAmount)
        });

        it("if amount is positive then it should long", async () => {
            const sqrtPriceLimitX96 = 0;
            const deadline = ethers.constants.MaxUint256;
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralmintAmount)
            await perpLemma.connect(usdLemma).openWExactCollateral(collateralmintAmount)
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
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralmintAmount)
            await perpLemma.connect(usdLemma).openWExactCollateral(collateralmintAmount)
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
    */


    describe("USDLemma OpenWExactCollateral and CloseWExactCollateral", async function () {
        /*
        it("OpenWExactCollateral", async function () {
            // Deposit fee is expected to be 1% --> 10000 in 1e6
            const fee_perc = parseUnits('10000', 0);
            const fee_unit = parseUnits('1', 6);
            await collateral.mint(defaultSigner.address, parseUnits('100', collateralDecimals));
            const collateralBalanceBefore = await collateral.balanceOf(defaultSigner.address);
            console.log(`Initial Balance of DefaultSigner = ${collateralBalanceBefore}`);

            const collateralNeeded_1eD = parseUnits('1', collateralDecimals);
            const collateralNeeded_1e18 = fromD1toD2(collateralNeeded_1eD, collateralDecimals, 18);

            //const collateralNeeded = await this.mcdexLemma.getAmountInCollateralDecimals(await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true), true);
            await collateral.connect(defaultSigner).approve(usdLemma.address, collateralNeeded_1eD);
            let tx = await usdLemma.depositToWExactCollateral(defaultSigner.address, collateralNeeded_1e18, 0, 0, collateral.address);

            const collateralBalanceAfter = await collateral.balanceOf(defaultSigner.address);
            console.log(`After Open Balance of Default Signer = ${collateralBalanceAfter}`);
            expect(collateralNeeded_1eD).to.equal(collateralBalanceBefore.sub(collateralBalanceAfter));

            const positionSize_1e18 = parseUnits((await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)).toString(), 0);
            const positionQuote_1e18 = parseUnits((await accountBalance.getQuote(perpLemma.address, baseToken.address)).toString(), 0);
            console.log(`Position Open with ${collateralNeeded_1e18} (1e18) eq ${collateralNeeded_1eD} (1eD) --> positionSize_1e18 = ${positionSize_1e18} eq ${fromD1toD2(positionSize_1e18, 18, collateralDecimals)}`);
            console.log(`Position Open with ${collateralNeeded_1e18} (1e18) eq ${collateralNeeded_1eD} (1eD) --> positionQuote_1e18 = ${positionQuote_1e18} eq ${fromD1toD2(positionQuote_1e18, 18, collateralDecimals)}`);
            const fee_paid = collateralNeeded_1e18.mul(fee_perc).div(fee_unit);
            expect(positionQuote_1e18).to.equal(parseUnits('-1', 0).mul(collateralNeeded_1e18.sub(fee_paid)));
            //expect(await usdLemma.balanceOf(defaultSigner.address)).to.equal(utils.parseEther("100"));
            //expect(tx).to.emit(this.usdLemma, "DepositTo").withArgs(0, collateral.address, defaultSigner.address, amount, collateralNeeded);
        });


        it("OpenWExactCollateral and CloseWExactCollateral the full position with 1 ETH", async function () {
            // Common Part
            const fee_perc = parseUnits('10000', 0);
            const fee_unit = parseUnits('1', 6);
            const collateralDecimals = await collateral.decimals();
            console.log(`Collateral Decimals = ${collateralDecimals}`);
            await collateral.mint(defaultSigner.address, parseUnits('100', collateralDecimals));
            const collateralBalanceBefore = await collateral.balanceOf(defaultSigner.address);
            console.log(`Initial Balance of DefaultSigner = ${collateralBalanceBefore}`);


            // Open Position Params 
            const collateralNeeded_1eD = parseUnits('1', collateralDecimals);
            const collateralNeeded_1e18 = fromD1toD2(collateralNeeded_1eD, collateralDecimals, 18);
            console.log(`collateralNeeded = ${collateralNeeded_1e18} --> ${collateralNeeded_1eD}`);

            //const collateralNeeded = await this.mcdexLemma.getAmountInCollateralDecimals(await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true), true);
            await collateral.connect(defaultSigner).approve(usdLemma.address, collateralNeeded_1eD);
            await usdLemma.depositToWExactCollateral(defaultSigner.address, collateralNeeded_1e18, 0, 0, collateral.address);
            const fee_paid = collateralNeeded_1e18.mul(fee_perc).div(fee_unit);
            const positionQuote_1e18 = parseUnits((await accountBalance.getQuote(perpLemma.address, baseToken.address)).toString(), 0);
            const positionQuote_1eD = fromD1toD2(positionQuote_1e18, 18, collateralDecimals);
            expect(positionQuote_1e18).to.equal(parseUnits('-1', 0).mul(collateralNeeded_1e18.sub(fee_paid)));

            // Open Done 
            const collateralBalanceAfter = await collateral.balanceOf(defaultSigner.address);
            console.log(`After Open Balance of Default Signer = ${collateralBalanceAfter}`);
            expect(collateralNeeded_1eD).to.equal(collateralBalanceBefore.sub(collateralBalanceAfter));

            const positionSize_1e18 = parseUnits((await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)).toString(), 0);
            const positionBase_1e18 = parseUnits((await accountBalance.getBase(perpLemma.address, baseToken.address)).toString(), 0);

            const balance0 = await collateral.balanceOf(defaultSigner.address);
            console.log(`Withdrawing this one --> Position Quote ${positionQuote_1e18} --> ${positionQuote_1eD}`);
            const desiredCollateral_1e18 = parseUnits('-1',0).mul(positionQuote_1e18);
            const desiredCollateral_1eD = fromD1toD2(desiredCollateral_1e18, 18, collateralDecimals);
            await usdLemma.withdrawToWExactCollateral(defaultSigner.address, desiredCollateral_1e18, 0, MaxInt256, collateral.address);
            const balance1 = await collateral.balanceOf(defaultSigner.address);
            const deltaBalance = parseUnits((balance1 - balance0).toString(), 0);
            const recoveredCollateralPerc = (deltaBalance.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            const restOfCollateral = desiredCollateral_1eD.sub(deltaBalance);
            const restOfCollateralPerc = (restOfCollateral.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            const totalPositionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);

            expect(Math.abs(restOfCollateralPerc - 1.99) < 0.000001);
            expect(totalPositionSize).to.equal(0);

            console.log(`Delta Balance = ${deltaBalance}, desiredCollateral = ${desiredCollateral_1eD}, Delta = ${restOfCollateral}`);
            console.log(`recoveredCollateralPerc = ${recoveredCollateralPerc}%, restOfCollateralPerc = ${restOfCollateralPerc}%`);
            console.log(`totalPositionSize = ${totalPositionSize}`);
        });





        it("OpenWExactCollateral and CloseWExactCollateral the full position with 5 ETH", async function () {
            // Common Part
            const fee_perc = parseUnits('10000', 0);
            const fee_unit = parseUnits('1', 6);
            const collateralDecimals = await collateral.decimals();
            //console.log(`Collateral Decimals = ${collateralDecimals}`);

            await collateral.mint(defaultSigner.address, parseUnits('5', collateralDecimals));
            const collateralBalanceBefore = await collateral.balanceOf(defaultSigner.address);
            //console.log(`Initial Balance of DefaultSigner = ${collateralBalanceBefore}`);


            // Open Position Params 
            const collateralNeeded_1eD = parseUnits('5', collateralDecimals);
            const collateralNeeded_1e18 = fromD1toD2(collateralNeeded_1eD, collateralDecimals, 18);
            //console.log(`collateralNeeded = ${collateralNeeded_1e18} --> ${collateralNeeded_1eD}`);

            //const collateralNeeded = await this.mcdexLemma.getAmountInCollateralDecimals(await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true), true);
            await collateral.connect(defaultSigner).approve(usdLemma.address, collateralNeeded_1eD);
            await usdLemma.depositToWExactCollateral(defaultSigner.address, collateralNeeded_1e18, 0, 0, collateral.address);
            const fee_paid = collateralNeeded_1e18.mul(fee_perc).div(fee_unit);
            const positionQuote_1e18 = parseUnits((await accountBalance.getQuote(perpLemma.address, baseToken.address)).toString(), 0);
            const positionQuote_1eD = fromD1toD2(positionQuote_1e18, 18, collateralDecimals);
            expect(positionQuote_1e18).to.equal(parseUnits('-1', 0).mul(collateralNeeded_1e18.sub(fee_paid)));

            // Open Done 
            const collateralBalanceAfter = await collateral.balanceOf(defaultSigner.address);
            //console.log(`After Open Balance of Default Signer = ${collateralBalanceAfter}`);
            expect(collateralNeeded_1eD).to.equal(collateralBalanceBefore.sub(collateralBalanceAfter));

            const positionSize_1e18 = parseUnits((await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)).toString(), 0);
            const positionBase_1e18 = parseUnits((await accountBalance.getBase(perpLemma.address, baseToken.address)).toString(), 0);

            const balance0 = await collateral.balanceOf(defaultSigner.address);
            //console.log(`Withdrawing this one --> Position Quote ${positionQuote_1e18} --> ${positionQuote_1eD}`);
            const desiredCollateral_1e18 = parseUnits('-1',0).mul(positionQuote_1e18);
            const desiredCollateral_1eD = fromD1toD2(desiredCollateral_1e18, 18, collateralDecimals);
            await usdLemma.withdrawToWExactCollateral(defaultSigner.address, desiredCollateral_1e18, 0, MaxInt256, collateral.address);
            const balance1 = await collateral.balanceOf(defaultSigner.address);
            const deltaBalance = parseUnits((balance1 - balance0).toString(), 0);
            const recoveredCollateralPerc = (deltaBalance.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            const restOfCollateral = desiredCollateral_1eD.sub(deltaBalance);
            const restOfCollateralPerc = (restOfCollateral.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            const totalPositionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);

            expect(Math.abs(restOfCollateralPerc - 1.99) < 0.000001);
            expect(totalPositionSize).to.equal(0);

            // console.log(`Delta Balance = ${deltaBalance}, desiredCollateral = ${desiredCollateral_1eD}, Delta = ${restOfCollateral}`);
            // console.log(`recoveredCollateralPerc = ${recoveredCollateralPerc}%, restOfCollateralPerc = ${restOfCollateralPerc}%`);
            // console.log(`totalPositionSize = ${totalPositionSize}`);
        });

        it("OpenWExactCollateral and CloseWExactCollateral the full position with 100 ETH", async function () {
            // Common Part
            const fee_perc = parseUnits('10000', 0);
            const fee_unit = parseUnits('1', 6);
            const collateralDecimals = await collateral.decimals();
            //console.log(`Collateral Decimals = ${collateralDecimals}`);
            await collateral.mint(defaultSigner.address, parseUnits('100', collateralDecimals));
            const collateralBalanceBefore = await collateral.balanceOf(defaultSigner.address);
            //console.log(`Initial Balance of DefaultSigner = ${collateralBalanceBefore}`);


            // Open Position Params 
            const collateralNeeded_1eD = parseUnits('100', collateralDecimals);
            const collateralNeeded_1e18 = fromD1toD2(collateralNeeded_1eD, collateralDecimals, 18);
            //console.log(`collateralNeeded = ${collateralNeeded_1e18} --> ${collateralNeeded_1eD}`);

            //const collateralNeeded = await this.mcdexLemma.getAmountInCollateralDecimals(await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true), true);
            await collateral.connect(defaultSigner).approve(usdLemma.address, collateralNeeded_1eD);
            await usdLemma.depositToWExactCollateral(defaultSigner.address, collateralNeeded_1e18, 0, 0, collateral.address);
            const fee_paid = collateralNeeded_1e18.mul(fee_perc).div(fee_unit);
            const positionQuote_1e18 = parseUnits((await accountBalance.getQuote(perpLemma.address, baseToken.address)).toString(), 0);
            const positionQuote_1eD = fromD1toD2(positionQuote_1e18, 18, collateralDecimals);
            expect(positionQuote_1e18).to.equal(parseUnits('-1', 0).mul(collateralNeeded_1e18.sub(fee_paid)));

            // Open Done 
            const collateralBalanceAfter = await collateral.balanceOf(defaultSigner.address);
            //console.log(`After Open Balance of Default Signer = ${collateralBalanceAfter}`);
            expect(collateralNeeded_1eD).to.equal(collateralBalanceBefore.sub(collateralBalanceAfter));

            const positionSize_1e18 = parseUnits((await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)).toString(), 0);
            const positionBase_1e18 = parseUnits((await accountBalance.getBase(perpLemma.address, baseToken.address)).toString(), 0);

            const balance0 = await collateral.balanceOf(defaultSigner.address);
            //console.log(`Withdrawing this one --> Position Quote ${positionQuote_1e18} --> ${positionQuote_1eD}`);
            const desiredCollateral_1e18 = parseUnits('-1',0).mul(positionQuote_1e18);
            const desiredCollateral_1eD = fromD1toD2(desiredCollateral_1e18, 18, collateralDecimals);
            await usdLemma.withdrawToWExactCollateral(defaultSigner.address, desiredCollateral_1e18, 0, MaxInt256, collateral.address);
            const balance1 = await collateral.balanceOf(defaultSigner.address);
            const deltaBalance = parseUnits((balance1 - balance0).toString(), 0);
            const recoveredCollateralPerc = (deltaBalance.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            const restOfCollateral = desiredCollateral_1eD.sub(deltaBalance);
            const restOfCollateralPerc = (restOfCollateral.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            const totalPositionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);

            expect(Math.abs(restOfCollateralPerc - 1.99) < 0.000001);
            expect(totalPositionSize).to.equal(0);

            // console.log(`Delta Balance = ${deltaBalance}, desiredCollateral = ${desiredCollateral_1eD}, Delta = ${restOfCollateral}`);
            // console.log(`recoveredCollateralPerc = ${recoveredCollateralPerc}%, restOfCollateralPerc = ${restOfCollateralPerc}%`);
            // console.log(`totalPositionSize = ${totalPositionSize}`);
        });
        */

        /*
        it("OpenWExactCollateral and CloseWExactCollateral with FreeCollateral the full position with 1 ETH", async function () {
            // Common Part
            const fee_perc = parseUnits('10000', 0);
            const fee_unit = parseUnits('1', 6);
            const collateralDecimals = await collateral.decimals();
            //console.log(`Collateral Decimals = ${collateralDecimals}`);
            await collateral.mint(defaultSigner.address, parseUnits('100', collateralDecimals));
            const collateralBalanceBefore = await collateral.balanceOf(defaultSigner.address);
            //console.log(`Initial Balance of DefaultSigner = ${collateralBalanceBefore}`);


            // Open Position Params 
            const collateralNeeded_1eD = parseUnits('100', collateralDecimals);
            const collateralNeeded_1e18 = fromD1toD2(collateralNeeded_1eD, collateralDecimals, 18);
            //console.log(`collateralNeeded = ${collateralNeeded_1e18} --> ${collateralNeeded_1eD}`);

            //const collateralNeeded = await this.mcdexLemma.getAmountInCollateralDecimals(await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true), true);
            await collateral.connect(defaultSigner).approve(usdLemma.address, collateralNeeded_1eD);
            await usdLemma.depositToWExactCollateral(defaultSigner.address, collateralNeeded_1e18, 0, 0, collateral.address);
            const fee_paid = collateralNeeded_1e18.mul(fee_perc).div(fee_unit);
            const positionQuote_1e18 = parseUnits((await accountBalance.getQuote(perpLemma.address, baseToken.address)).toString(), 0);
            const positionQuote_1eD = fromD1toD2(positionQuote_1e18, 18, collateralDecimals);
            expect(positionQuote_1e18).to.equal(parseUnits('-1', 0).mul(collateralNeeded_1e18.sub(fee_paid)));

            // Open Done 
            const collateralBalanceAfter = await collateral.balanceOf(defaultSigner.address);
            //console.log(`After Open Balance of Default Signer = ${collateralBalanceAfter}`);
            expect(collateralNeeded_1eD).to.equal(collateralBalanceBefore.sub(collateralBalanceAfter));

            const positionSize_1e18 = parseUnits((await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)).toString(), 0);
            const positionBase_1e18 = parseUnits((await accountBalance.getBase(perpLemma.address, baseToken.address)).toString(), 0);

            const balance0 = await collateral.balanceOf(defaultSigner.address);
            //console.log(`Withdrawing this one --> Position Quote ${positionQuote_1e18} --> ${positionQuote_1eD}`);
            const desiredCollateral_1e18 = parseUnits('-1',0).mul(positionQuote_1e18);
            const desiredCollateral_1eD = fromD1toD2(desiredCollateral_1e18, 18, collateralDecimals);

            const freeCollateral_1eD = await vault.getFreeCollateral(perpLemma.address);
            const freeCollateral_1e18 = fromD1toD2(freeCollateral_1eD, collateralDecimals, 18);

            await usdLemma.withdrawToWExactCollateral(defaultSigner.address, freeCollateral_1e18, 0, MaxInt256, collateral.address);
            const balance1 = await collateral.balanceOf(defaultSigner.address);
            const deltaBalance = parseUnits((balance1 - balance0).toString(), 0);
            const recoveredCollateralPerc = (deltaBalance.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            const restOfCollateral = desiredCollateral_1eD.sub(deltaBalance);
            const restOfCollateralPerc = (restOfCollateral.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            const totalPositionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);

            expect(Math.abs(restOfCollateralPerc - 1.99) < 0.000001);
            expect(totalPositionSize).to.equal(0);

            // console.log(`Delta Balance = ${deltaBalance}, desiredCollateral = ${desiredCollateral_1eD}, Delta = ${restOfCollateral}`);
            // console.log(`recoveredCollateralPerc = ${recoveredCollateralPerc}%, restOfCollateralPerc = ${restOfCollateralPerc}%`);
            // console.log(`totalPositionSize = ${totalPositionSize}`);
        });
        */




        
        
        it("OpenWExactCollateral with 5 ETH and CloseWExactCollateral with 50% ETH and 50% ETH", async function () {
            // Common Part
            const fee_perc = parseUnits('10000', 0);
            const fee_unit = parseUnits('1', 6);
            const collateralDecimals = await collateral.decimals();
            //console.log(`Collateral Decimals = ${collateralDecimals}`);

            await collateral.mint(defaultSigner.address, parseUnits('5', collateralDecimals));
            const collateralBalanceBefore = await collateral.balanceOf(defaultSigner.address);
            //console.log(`Initial Balance of DefaultSigner = ${collateralBalanceBefore}`);


            // Open Position Params 
            const collateralNeeded_1eD = parseUnits('5', collateralDecimals);
            const collateralNeeded_1e18 = fromD1toD2(collateralNeeded_1eD, collateralDecimals, 18);
            //console.log(`collateralNeeded = ${collateralNeeded_1e18} --> ${collateralNeeded_1eD}`);

            //const collateralNeeded = await this.mcdexLemma.getAmountInCollateralDecimals(await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true), true);
            await collateral.connect(defaultSigner).approve(usdLemma.address, collateralNeeded_1eD);
            await usdLemma.depositToWExactCollateral(defaultSigner.address, collateralNeeded_1e18, 0, 0, collateral.address);
            const fee_paid = collateralNeeded_1e18.mul(fee_perc).div(fee_unit);
            const positionQuote_1e18 = parseUnits((await accountBalance.getQuote(perpLemma.address, baseToken.address)).toString(), 0);
            const positionQuote_1eD = fromD1toD2(positionQuote_1e18, 18, collateralDecimals);
            expect(positionQuote_1e18).to.equal(parseUnits('-1', 0).mul(collateralNeeded_1e18.sub(fee_paid))); 

            // Open Done 
            const collateralBalanceAfter = await collateral.balanceOf(defaultSigner.address);
            //console.log(`After Open Balance of Default Signer = ${collateralBalanceAfter}`);
            expect(collateralNeeded_1eD).to.equal(collateralBalanceBefore.sub(collateralBalanceAfter));

            // const positionSize_1e18 = parseUnits((await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)).toString(), 0);
            // const positionBase_1e18 = parseUnits((await accountBalance.getBase(perpLemma.address, baseToken.address)).toString(), 0);

            const balance0 = await collateral.balanceOf(defaultSigner.address);
            //console.log(`Withdrawing this one --> Position Quote ${positionQuote_1e18} --> ${positionQuote_1eD}`);
            const desiredCollateral1_1e18 = ((parseUnits('-1',0).mul(positionQuote_1e18)).mul(parseUnits('50',0)).div(parseUnits('100',0)));
            const desiredCollateral1_1eD = fromD1toD2(desiredCollateral1_1e18, 18, collateralDecimals);
            console.log(`Trying to close with 50% of the Quote Position so ${desiredCollateral1_1eD}`);
            await usdLemma.withdrawToWExactCollateral(defaultSigner.address, desiredCollateral1_1e18, 0, MaxInt256, collateral.address);
            // const balance1 = await collateral.balanceOf(defaultSigner.address);
            // const deltaBalance = parseUnits((balance1 - balance0).toString(), 0);
            // const recoveredCollateralPerc = (deltaBalance.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            // const restOfCollateral = desiredCollateral_1eD.sub(deltaBalance);
            // const restOfCollateralPerc = (restOfCollateral.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            // const totalPositionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);

            const positionQuote2_1e18 = parseUnits((await accountBalance.getQuote(perpLemma.address, baseToken.address)).toString(), 0);

            //const balance0 = await collateral.balanceOf(defaultSigner.address);
            //console.log(`Withdrawing this one --> Position Quote ${positionQuote_1e18} --> ${positionQuote_1eD}`);

            // const desiredCollateral2_1e18 = ((parseUnits('-1',0).mul(positionQuote2_1e18)).mul(parseUnits('1000', 0))).div(parseUnits('1000', 0));
            // const desiredCollateral2_1eD = fromD1toD2(desiredCollateral2_1e18, 18, collateralDecimals);
            // const freeCollateral_1eD = await vault.getFreeCollateral(perpLemma.address);
            // const freeCollateral_1e18 = fromD1toD2(freeCollateral_1eD, collateralDecimals, 18);
            // console.log(`Trying to close with remaining Quote Position so ${desiredCollateral2_1eD}, while freeCollateral = ${freeCollateral_1eD}`);
            await usdLemma.withdrawToWExactCollateral(defaultSigner.address, desiredCollateral1_1e18, 0, MaxInt256, collateral.address);
            const balance1 = await collateral.balanceOf(defaultSigner.address);
            const deltaBalance = parseUnits((balance1 - balance0).toString(), 0);
            const recoveredCollateralPerc = (deltaBalance.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            const restOfCollateral = (desiredCollateral1_1eD.mul(parseUnits('2', 0))).sub(deltaBalance);
            const restOfCollateralPerc = (restOfCollateral.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            const totalPositionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);

            const positionQuote3_1e18 = parseUnits((await accountBalance.getQuote(perpLemma.address, baseToken.address)).toString(), 0);

            //expect(Math.abs(restOfCollateralPerc - 1.99)).to.lt(0.000001);
            expect(totalPositionSize).to.equal(0);

            console.log(`Delta Balance = ${deltaBalance}, desiredCollateral = ${desiredCollateral1_1eD.toNumber()*2}, Delta = ${restOfCollateral}`);
            console.log(`recoveredCollateralPerc = ${recoveredCollateralPerc}%, restOfCollateralPerc = ${restOfCollateralPerc}%`);
            console.log(`positionQuote3_1e18 = ${positionQuote3_1e18}, totalPositionSize = ${totalPositionSize}`);
        });
        

        it("OpenWExactCollateral with 5 ETH and CloseWExactCollateral with 80% ETH and 20% ETH", async function () {
            // Common Part
            const fee_perc = parseUnits('10000', 0);
            const fee_unit = parseUnits('1', 6);
            const collateralDecimals = await collateral.decimals();
            //console.log(`Collateral Decimals = ${collateralDecimals}`);

            await collateral.mint(defaultSigner.address, parseUnits('5', collateralDecimals));
            const collateralBalanceBefore = await collateral.balanceOf(defaultSigner.address);
            //console.log(`Initial Balance of DefaultSigner = ${collateralBalanceBefore}`);


            // Open Position Params 
            const collateralNeeded_1eD = parseUnits('5', collateralDecimals);
            const collateralNeeded_1e18 = fromD1toD2(collateralNeeded_1eD, collateralDecimals, 18);
            //console.log(`collateralNeeded = ${collateralNeeded_1e18} --> ${collateralNeeded_1eD}`);

            //const collateralNeeded = await this.mcdexLemma.getAmountInCollateralDecimals(await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true), true);
            await collateral.connect(defaultSigner).approve(usdLemma.address, collateralNeeded_1eD);
            await usdLemma.depositToWExactCollateral(defaultSigner.address, collateralNeeded_1e18, 0, 0, collateral.address);
            const fee_paid = collateralNeeded_1e18.mul(fee_perc).div(fee_unit);
            const positionQuote_1e18 = parseUnits((await accountBalance.getQuote(perpLemma.address, baseToken.address)).toString(), 0);
            const positionQuote_1eD = fromD1toD2(positionQuote_1e18, 18, collateralDecimals);
            expect(positionQuote_1e18).to.equal(parseUnits('-1', 0).mul(collateralNeeded_1e18.sub(fee_paid))); 

            // Open Done 
            const collateralBalanceAfter = await collateral.balanceOf(defaultSigner.address);
            //console.log(`After Open Balance of Default Signer = ${collateralBalanceAfter}`);
            expect(collateralNeeded_1eD).to.equal(collateralBalanceBefore.sub(collateralBalanceAfter));

            // const positionSize_1e18 = parseUnits((await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address)).toString(), 0);
            // const positionBase_1e18 = parseUnits((await accountBalance.getBase(perpLemma.address, baseToken.address)).toString(), 0);

            const balance0 = await collateral.balanceOf(defaultSigner.address);
            //console.log(`Withdrawing this one --> Position Quote ${positionQuote_1e18} --> ${positionQuote_1eD}`);
            const desiredCollateral1_1e18 = ((parseUnits('-1',0).mul(positionQuote_1e18)).mul(parseUnits('80',0)).div(parseUnits('100',0)));
            const desiredCollateral1_1eD = fromD1toD2(desiredCollateral1_1e18, 18, collateralDecimals);
            console.log(`Trying to close with 50% of the Quote Position so ${desiredCollateral1_1eD}`);
            await usdLemma.withdrawToWExactCollateral(defaultSigner.address, desiredCollateral1_1e18, 0, MaxInt256, collateral.address);
            // const balance1 = await collateral.balanceOf(defaultSigner.address);
            // const deltaBalance = parseUnits((balance1 - balance0).toString(), 0);
            // const recoveredCollateralPerc = (deltaBalance.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            // const restOfCollateral = desiredCollateral_1eD.sub(deltaBalance);
            // const restOfCollateralPerc = (restOfCollateral.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            // const totalPositionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);

            const positionQuote2_1e18 = parseUnits((await accountBalance.getQuote(perpLemma.address, baseToken.address)).toString(), 0);

            //const balance0 = await collateral.balanceOf(defaultSigner.address);
            //console.log(`Withdrawing this one --> Position Quote ${positionQuote_1e18} --> ${positionQuote_1eD}`);

            const desiredCollateral2_1e18 = ((parseUnits('-1',0).mul(positionQuote_1e18)).mul(parseUnits('20',0)).div(parseUnits('100',0)));
            const desiredCollateral2_1eD = fromD1toD2(desiredCollateral2_1e18, 18, collateralDecimals);
            // const freeCollateral_1eD = await vault.getFreeCollateral(perpLemma.address);
            // const freeCollateral_1e18 = fromD1toD2(freeCollateral_1eD, collateralDecimals, 18);
            // console.log(`Trying to close with remaining Quote Position so ${desiredCollateral2_1eD}, while freeCollateral = ${freeCollateral_1eD}`);
            await usdLemma.withdrawToWExactCollateral(defaultSigner.address, desiredCollateral2_1e18, 0, MaxInt256, collateral.address);
            const balance1 = await collateral.balanceOf(defaultSigner.address);
            const deltaBalance = parseUnits((balance1 - balance0).toString(), 0);
            const recoveredCollateralPerc = (deltaBalance.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            const restOfCollateral = (desiredCollateral1_1eD.add(desiredCollateral2_1eD)).sub(deltaBalance);
            const restOfCollateralPerc = (restOfCollateral.toNumber() / (-1 * positionQuote_1eD.toNumber())) * 100;
            const totalPositionSize = await accountBalance.getTotalPositionSize(perpLemma.address, baseToken.address);

            const positionQuote3_1e18 = parseUnits((await accountBalance.getQuote(perpLemma.address, baseToken.address)).toString(), 0);

            //expect(Math.abs(restOfCollateralPerc - 1.99)).to.lt(0.000001);
            expect(totalPositionSize).to.equal(0);

            console.log(`Delta Balance = ${deltaBalance}, desiredCollateral = ${desiredCollateral1_1eD.toNumber() + desiredCollateral2_1eD.toNumber()}, Delta = ${restOfCollateral}`);
            console.log(`recoveredCollateralPerc = ${recoveredCollateralPerc}%, restOfCollateralPerc = ${restOfCollateralPerc}%`);
            console.log(`positionQuote3_1e18 = ${positionQuote3_1e18}, totalPositionSize = ${totalPositionSize}`);
        });
        





    })

    /*
    describe("OpenWExactCollateral and CloseWExactCollateral", async function () {
        
        it("Basic Open", async () => {
            const collateralAmount = parseUnits("100", collateralDecimals) // 6 decimal
            await collateral.mint(usdLemma.address, collateralAmount);

            // Open a Position
            // getCollateralAmountGivenUnderlyingAssetAmount() DEPRECATED --> Let's replace with a fixed Collateral Amount 1 ETH position
            //const desiredAmountUSDL = parseEther('1');
            collateralRequired_1e18 = parseEther('1');
            //collateralRequired_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(desiredAmountUSDL, true)
            collateralRequired_1eCollateralDecimals = collateralRequired_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))

            console.log(`T1 Collateral Required in 1e18 = ${collateralRequired_1e18} and in 1e${collateralDecimals} = ${collateralRequired_1eCollateralDecimals}`);
            
            // We need to convety
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralRequired_1eCollateralDecimals);
            expect(await collateral.balanceOf(perpLemma.address)).to.equal(collateralRequired_1eCollateralDecimals);

            
            await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralRequired_1e18)).to.emit(clearingHouse, 'PositionChanged').withArgs(
                perpLemma.address,                                                  // Trader
                baseToken.address,                                                  // Market --> vUSD
                parseUnits('97058727412628824887', 0),                              // Position, negative because of short? 
                parseUnits('-980100000000000000', 0),                               // Notional
                parseUnits('9900000000000000', 0),                                  // Fee
                parseUnits('-990000000000000000', 0),                               // OpenNotional
                0,                                                                  // PnlToBeRealized
                parseUnits('8000467773506664236629439201', 0)                       // sqrtPriceAfterX96
            );

            expect(await collateral.balanceOf(perpLemma.address)).to.equal(0);
            
        })
    

        
        it("Basic Open and Close", async () => {
            const collateralAmount = parseUnits("100", collateralDecimals) // 6 decimal
            await collateral.mint(usdLemma.address, collateralAmount);

            // Open a Position
            // getCollateralAmountGivenUnderlyingAssetAmount() DEPRECATED --> Let's replace with a fixed Collateral Amount 1 ETH position
            //const desiredAmountUSDL = parseEther('1');
            collateralRequired_1e18 = parseEther('1');
            //collateralRequired_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(desiredAmountUSDL, true)
            collateralRequired_1eCollateralDecimals = collateralRequired_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))

            console.log(`T1 Collateral Required in 1e18 = ${collateralRequired_1e18} and in 1e${collateralDecimals} = ${collateralRequired_1eCollateralDecimals}`);
            // We need to convety
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralRequired_1eCollateralDecimals);
            const usdLemmaBalance1 = await collateral.balanceOf(usdLemma.address);
            expect(await collateral.balanceOf(perpLemma.address)).to.equal(collateralRequired_1eCollateralDecimals);

            await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralRequired_1e18)).to.emit(clearingHouse, 'PositionChanged').withArgs(
                perpLemma.address,                                                  // Trader
                baseToken.address,                                                  // Market --> vUSD
                parseUnits('97058727412628824887', 0),                              // Taker Position 
                parseUnits('-980100000000000000', 0),                               // Notional
                parseUnits('9900000000000000', 0),                                  // Fee
                parseUnits('-990000000000000000', 0),                               // OpenNotional
                0,                                                                  // PnlToBeRealized
                parseUnits('8000467773506664236629439201', 0)                       // sqrtPriceAfterX96
            );

            expect(await collateral.balanceOf(perpLemma.address)).to.equal(0);

            // const imRatio = await clearingHouseConfig.getImRatio();
            // const totalCollateralAvailable = await vault.getFreeCollateralByRatio(perpLemma.address, 0);
            const takerPositionSize = await accountBalance.getTakerPositionSize(perpLemma.address, baseToken.address);
            expect(parseUnits(takerPositionSize.toString(), 0)).to.equal(parseUnits('97058727412628824887', 0));
            console.log(`Taker Position Size in Collateral = ${takerPositionSize}`);

            const res = await accountBalance.getPnlAndPendingFee(perpLemma.address);
            console.log(`Pnl and Pending Fees OwedRealizedPnl=${res[0]}, UnrealizedPnl=${res[1]}, PendingFee=${res[2]}`);


            //const c2 = totalCollateralAvailable;
            //const c2_1e18 = parseEther( c2.toString() ).div(parseUnits('1', collateralDecimals));
            await expect(perpLemma.connect(usdLemma).closeWExactCollateral(takerPositionSize)).to.emit(collateral, 'Transfer');

            // const imRatio = await clearingHouseConfig.getImRatio();
            // const totalCollateralAvailable = await vault.getFreeCollateralByRatio(perpLemma.address, imRatio);
            // console.log(`At the end Total Collateral Available = ${totalCollateralAvailable}`);

            const usdLemmaBalance2 = await collateral.balanceOf(usdLemma.address);

            const deltaBalance = usdLemmaBalance2 - usdLemmaBalance1;

            const lostCollateral = collateralRequired_1eCollateralDecimals - deltaBalance;

            const percLostCollateral = lostCollateral / collateralRequired_1eCollateralDecimals;

            console.log(`Spent Collateral = ${collateralRequired_1eCollateralDecimals}, Recovered Collateral = ${deltaBalance}, Lost Collateral = ${lostCollateral}, percLostCollateral = ${percLostCollateral}`);

            // Checking the lost collateral is < 5% of the initial amount 
            expect(collateralRequired_1eCollateralDecimals - deltaBalance).to.below(collateralRequired_1eCollateralDecimals*0.05);


            // const totalCollateralAvailable1 = await accountBalance.getTakerPositionSize(perpLemma.address, baseToken.address);
            // console.log(`Final Total Collateral Available = ${totalCollateralAvailable1}`);
        })
        

    })
    */

    /*
    describe("Emergency Settlement", async function () {
        //let collateralmintAmount, collateralAmount, parsedAmount, leveragedAmount
        beforeEach(async function () {

        });

        it("Calling Settle() when Market is open should revert", async () => {
            // By default the market is open
            await expect(perpLemma.connect(usdLemma).settle()).to.be.revertedWith("CH_MNC");
        })

        it("Calling Settle() when Market is paused should revert", async () => {
            // Pausing the market
            expect(await (baseToken.connect(defaultSigner)["pause(uint256)"](0))).to.emit(baseToken, 'StatusUpdated').withArgs(1);
            await expect(perpLemma.connect(usdLemma).settle()).to.be.revertedWith("CH_MNC");
        })

        it("Calling Settle() when Market is closed should work", async () => {
            // Pausing the market
            expect(await (baseToken.connect(defaultSigner)["pause(uint256)"](0))).to.emit(baseToken, 'StatusUpdated').withArgs(1);
            // Closing the market
            expect(await (baseToken.connect(defaultSigner)["close(uint256)"](1))).to.emit(baseToken, 'StatusUpdated').withArgs(2);
            await expect(perpLemma.connect(usdLemma).settle()).to.emit(vault, "Withdrawn").withArgs(collateral.address, perpLemma.address, 0);
        })

        it("Open a Position and Calling Settle() when Market is closed should work", async () => {
            const collateralAmount = parseUnits("100", collateralDecimals) // 6 decimal
            await collateral.mint(usdLemma.address, collateralAmount)

            // getCollateralAmountGivenUnderlyingAssetAmount() DEPRECATED --> Let's replace with a fixed Collateral Amount 1 ETH position
            //const desiredAmountUSDL = parseEther('1');
            collateralRequired_1e18 = parseEther('1');
            //collateralRequired_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(desiredAmountUSDL, true)
            collateralRequired_1e6 = collateralRequired_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))

            console.log(`T1 Collateral Required in 1e18 = ${collateralRequired_1e18} and in 1e${collateralDecimals} = ${collateralRequired_1e6}`);
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralRequired_1e6);
            expect(await collateral.balanceOf(perpLemma.address)).to.equal(collateralRequired_1e6);

            // Initially the Vault should have no collateral
            const initialVaultCollateral = await collateral.balanceOf(vault.address);
            //expect(await collateral.balanceOf(vault.address)).to.equal(0);

            await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralRequired_1e18)).to.emit(clearingHouse, 'PositionChanged').withArgs(
                perpLemma.address,                                                  // Trader
                baseToken.address,                                                  // Market --> vUSD
                parseUnits('97058727412628824887', 0),                              // Position, negative because of short? 
                parseUnits('-980100000000000000', 0),                               // Notional
                parseUnits('9900000000000000', 0),                                  // Fee
                parseUnits('-990000000000000000', 0),                               // OpenNotional
                0,                                                                  // PnlToBeRealized
                parseUnits('8000467773506664236629439201', 0)                       // sqrtPriceAfterX96
            );

            // All the collateral computed with `getCollateralAmountGivenUnderlyingAssetAmount()` is transferred to PerpLemma that deposits all in the Vault to Open a Position 
            expect(await collateral.balanceOf(perpLemma.address)).to.equal(0);

            // Pausing the market
            expect(await (baseToken.connect(defaultSigner)["pause(uint256)"](0))).to.emit(baseToken, 'StatusUpdated').withArgs(1);
            // Closing the market
            expect(await (baseToken.connect(defaultSigner)["close(uint256)"](1))).to.emit(baseToken, 'StatusUpdated').withArgs(2);
            expect(await perpLemma.connect(usdLemma).settle()).to.emit(vault, "Withdrawn").withArgs(
                collateral.address, 
                perpLemma.address, 
                parseUnits("10001", 0)); // 999999

            // This is not passing as 
            // Initial Collateral: 100000000000
            // Actual Collateral: 99901980199
            // So the Vault has less collateral than when it started
            //expect(await collateral.balanceOf(vault.address)).to.equal(initialVaultCollateral);
        })

        it("Test Settle and Withdraw Collateral for 2 Users", async () => {
            // 1. Mint
            const collateralAmount = parseUnits("100", collateralDecimals) // 6 decimal
            await collateral.mint(usdLemma.address, collateralAmount)
            
            const collateralUSDLemma_t0 = await collateral.balanceOf(usdLemma.address);
            const collateralPerpLemma_t0 = await collateral.balanceOf(perpLemma.address);

            console.log("1. Initial Balances");
            console.log(`1. USDLemma Balance = ${collateralUSDLemma_t0}`); 
            console.log(`1. PerpLemma Balance = ${collateralPerpLemma_t0}`);



            // 2. Get amount of collateral
            // getCollateralAmountGivenUnderlyingAssetAmount() DEPRECATED --> Let's replace with a fixed Collateral Amount 1 ETH position
            //const desiredAmountUSDL = parseEther('1');
            collateralRequired_1e18 = parseEther('1');
            //collateralRequired_1e18 = await perpLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(desiredAmountUSDL, true)
            collateralRequired_1e6 = collateralRequired_1e18.mul(parseUnits('1', collateralDecimals)).div(parseEther('1'))
            //console.log(`Collateral Required to Open a short ${perpPosition} (1e18) on BaseToken (vUSD) = ${collateralRequired_1e6} (1e6) Collateral (ETH)`);

            // 3. Open Position
            // 3.1 Transfer from USDLemma (High Level Abstraction Trader)  --> PerpLemma (Backend Protocol Specific Trader)
            await collateral.connect(usdLemma).transfer(perpLemma.address, collateralRequired_1e6);

            const collateralUSDLemma_t1 = await collateral.balanceOf(usdLemma.address);
            const collateralPerpLemma_t1 = await collateral.balanceOf(perpLemma.address);

            console.log("2. Balances after transfer");
            console.log(`2. USDLemma Balance = ${collateralUSDLemma_t1}, delta = ${collateralUSDLemma_t1 - collateralUSDLemma_t0}`); 
            console.log(`2. PerpLemma Balance = ${collateralPerpLemma_t1}, delta = ${collateralPerpLemma_t1 - collateralPerpLemma_t0}`);

            // 3.2 USDLemma calls PerpLemma Open to open a position at the PerpV2 Clearing House
            await expect(perpLemma.connect(usdLemma).openWExactCollateral(collateralRequired_1e18)).to.emit(clearingHouse, 'PositionChanged');

            const collateralUSDLemma_t2 = await collateral.balanceOf(usdLemma.address);
            const collateralPerpLemma_t2 = await collateral.balanceOf(perpLemma.address);

            console.log("3. Balances after Open");
            console.log(`3. USDLemma Balance = ${collateralUSDLemma_t2}, delta = ${collateralUSDLemma_t2 - collateralUSDLemma_t1}`); 
            console.log(`3. PerpLemma Balance = ${collateralPerpLemma_t2}, delta = ${collateralPerpLemma_t2 - collateralPerpLemma_t1}`);

            // Start with Market Open
            expect(await baseToken.getStatus()).to.be.equal(0);

            // Pause Market
            expect(await (baseToken.connect(defaultSigner)["pause(uint256)"](0))).to.emit(baseToken, 'StatusUpdated');
            expect(await baseToken.callStatic.getStatus()).to.be.equal(1);

            // Close Market
            expect(await (baseToken.connect(defaultSigner)["close(uint256)"](1))).to.emit(baseToken, 'StatusUpdated');
            expect(await baseToken.callStatic.getStatus()).to.be.equal(2);

            await perpLemma.connect(usdLemma).settle()
            //expect(await perpLemma.connect(usdLemma).settle()).to.emit(clearingHouse, 'PositionChanged');


            const collateralUSDLemma_t32 = await collateral.balanceOf(usdLemma.address);
            const collateralPerpLemma_t32 = await collateral.balanceOf(perpLemma.address);

            console.log("5. Balances after Settlement");
            console.log(`5. USDLemma Balance = ${collateralUSDLemma_t32}, delta = ${collateralUSDLemma_t32 - collateralUSDLemma_t2}`); 
            console.log(`5. PerpLemma Balance = ${collateralPerpLemma_t32}, delta = ${collateralPerpLemma_t32 - collateralPerpLemma_t2}, delta with initial ${collateralPerpLemma_t32 - collateralPerpLemma_t1}`);
            
            console.log(`5. PositionAtSettlement = ${await perpLemma.positionAtSettlement()}`);

            console.log("Trying to call PerpLemma.close() after market settlement to withdraw 20% of collateral");
            // No need to specify the expected collateral amount when the market is closed, it is computed as a percentage of the positionAtSettlement
            const c1 = collateralPerpLemma_t32*0.2
            const c1_1e18 = parseEther( c1.toString() ).div(parseUnits('1', collateralDecimals));
            console.log(`c1_1e18 = ${c1_1e18}`);
            await expect(perpLemma.connect(usdLemma).closeWExactCollateral(c1_1e18)).to.emit(collateral, 'Transfer');
            console.log("Closed 20% DONE");

            const collateralUSDLemma_t33 = await collateral.balanceOf(usdLemma.address);
            const collateralPerpLemma_t33 = await collateral.balanceOf(perpLemma.address);

            console.log("Balances after transfer");
            console.log(`USDLemma Balance = ${collateralUSDLemma_t33}, delta = ${collateralUSDLemma_t33 - collateralUSDLemma_t32}`); 
            console.log(`PerpLemma Balance = ${collateralPerpLemma_t33}, delta = ${collateralPerpLemma_t33 - collateralPerpLemma_t32}`);

            expect(await collateral.balanceOf(perpLemma.address)).to.not.equal(0);

            console.log("Trying to call PerpLemma.close() after market settlement to withdraw the remaining 80% of the initial collateral that is now the 100% of the remaining collateral");
            const c2 = collateralPerpLemma_t33;
            const c2_1e18 = parseEther( c2.toString() ).div(parseUnits('1', collateralDecimals));
            await expect(perpLemma.connect(usdLemma).closeWExactCollateral(c2_1e18)).to.emit(collateral, 'Transfer');

            const collateralUSDLemma_t35 = await collateral.balanceOf(usdLemma.address);
            const collateralPerpLemma_t35 = await collateral.balanceOf(perpLemma.address);

            console.log("Balances after transfer");
            console.log(`USDLemma Balance = ${collateralUSDLemma_t35}, delta = ${collateralUSDLemma_t35 - collateralUSDLemma_t33}`); 
            console.log(`PerpLemma Balance = ${collateralPerpLemma_t35}, delta = ${collateralPerpLemma_t35 - collateralPerpLemma_t33}`);

            expect(await collateral.balanceOf(perpLemma.address)).to.equal(0);
        })

    })
    */

})
