const hre = require("hardhat");
const { ethers, waffle } = require("hardhat");
const { expect, util, use } = require("chai");
const {deployMockContract, MockProvider, solidity} = require('ethereum-waffle');
const { utils } = require('ethers');
const { parseEther, parseUnits } = require("ethers/lib/utils")
const { BigNumber } = ethers;
const { loadPerpLushanInfo, snapshot, revertToSnapshot } = require("./utils");
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
const UniswapV3Pool2Abi = require('../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json')

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

describe("perpLemma1", async function () {
    // const [admin, maker, maker2, taker, carol] = waffle.provider.getWallets()
    let defaultSigner, usdLemma, reBalancer, hasWETH, keeperGasReward, signer1, signer2, usdl2;
    // let admin;
    let perpAddresses;
    const perpetualIndex = 0; //in Kovan the 0th perp for 0th liquidity pool = inverse ETH-USD
    const provider = ethers.provider;
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
    let pool
    let pool2
    let mockedBaseAggregator
    let mockedBaseAggregator2
    let collateralDecimals
    let perpLemma
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
        accountBalance = new ethers.Contract(perpAddresses.accountBalance.address, AccountBalanceAbi.abi, defaultSigner);
        const mockedBaseAggregator = new ethers.Contract(perpAddresses.mockedBaseAggregator.address, MockTestAggregatorV3Abi.abi, defaultSigner);
        const mockedBaseAggregator2 = new ethers.Contract(perpAddresses.mockedBaseAggregator2.address, MockTestAggregatorV3Abi.abi, defaultSigner);
        const pool = new ethers.Contract(perpAddresses.pool.address, UniswapV3PoolAbi.abi, defaultSigner);
        const pool2 = new ethers.Contract(perpAddresses.pool2.address, UniswapV3Pool2Abi.abi, defaultSigner);
        
        collateralDecimals = await collateral.decimals()
        console.log("collateralDecimals: ", collateralDecimals.toString())

        const perpLemmaFactory = await ethers.getContractFactory("PerpLemma")
        perpLemma = await upgrades.deployProxy(perpLemmaFactory, 
            [
            collateral.address,
            baseToken.address,
            quoteToken.address,
            clearingHouse.address,
            vault.address,
            accountBalance.address
        ], { initializer: 'initialize' });
        await perpLemma.connect(defaultSigner).setUSDLemma(signer1.address);
        await perpLemma.connect(signer1).resetApprovals()

        // await mockedBaseAggregator.setLatestRoundData(0, parseUnits("100", 6), 0, 0, 0)
        await pool.initialize(encodePriceSqrt("151.373306858723226652", "1")) // tick = 50200 (1.0001^50200 = 151.373306858723226652)
        // the initial number of oracle can be recorded is 1; thus, have to expand it
        await pool.increaseObservationCardinalityNext((2 ^ 16) - 1)
        await pool2.initialize(encodePriceSqrt("151.373306858723226652", "1")) // tick = 50200 (1.0001^50200 = 151.373306858723226652)
        
        await marketRegistry.addPool(baseToken.address, 10000)
        await marketRegistry.addPool(baseToken2.address, 10000)
        await marketRegistry.setFeeRatio(baseToken.address, 10000)
        await marketRegistry.setFeeRatio(baseToken2.address, 10000)

        const marketPool = await marketRegistry.getPool(baseToken.address)
        console.log('marketPool: ', marketPool.toString())

        // prepare collateral for maker
        const makerCollateralAmount = parseUnits("1000000", collateralDecimals)
        await collateral.mint(signer1.address, makerCollateralAmount)
        await collateral.mint(signer2.address, makerCollateralAmount)
        
        const decimals = await collateral.decimals()
        const parsedAmount = parseUnits("100000", decimals)
        await collateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256)
        await collateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256)

        // Deposit into vault
        await vault.connect(signer1).deposit(collateral.address, parsedAmount)
        await vault.connect(signer2).deposit(collateral.address, parsedAmount)

        // Check vault balance
        const vaultBalance = await vault.getBalance(signer1.address)
        console.log('vaultBalance: ', vaultBalance.toString())

        await clearingHouse.connect(signer1).addLiquidity({
            baseToken: baseToken.address,
            base: parseEther("65.943787"),
            quote: parseEther("10000"),
            lowerTick: 50000,
            upperTick: 50400,
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

    describe("OpenPosition", () => {
        it("openPosition using perpLemma", async () => {
            await perpLemma.connect(signer1).resetApprovals()
            const parsedAmount = parseUnits("100000", 6)
            await collateral.mint(signer1.address, parsedAmount)
            await collateral.connect(signer1).transfer(perpLemma.address, parsedAmount)
            await perpLemma.connect(signer1).open(parsedAmount, 0)
        });
    })

    describe("OpenPosition and closePosition", () => {
        it("openPosition using perpLemma", async () => {
            await perpLemma.connect(signer1).resetApprovals()
            const parsedAmount = parseUnits("100000", 6)
            await collateral.mint(signer1.address, parsedAmount)
            await collateral.connect(signer1).transfer(perpLemma.address, parsedAmount)
            await perpLemma.connect(signer1).open(parsedAmount, 0)
            await perpLemma.connect(signer1).close(parsedAmount, 0)
        });
    })
})