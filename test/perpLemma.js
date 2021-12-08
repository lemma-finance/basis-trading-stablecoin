const { MockContract } = require("@eth-optimism/smock")
const { JsonRpcProvider } = require('@ethersproject/providers');
const { ethers, waffle } = require("hardhat");
const { expect, util } = require("chai");
const { utils } = require('ethers');
const { parseEther, parseUnits } = require("ethers/lib/utils")

const { BigNumber, constants, BigNumberish } = ethers;
const { AddressZero, MaxUint256, MaxInt256 } = constants;

const { displayNicely, tokenTransfers, loadMCDEXInfo, loadPerpLushanInfo, toBigNumber, fromBigNumber, snapshot, revertToSnapshot } = require("./utils");

const arbProvider = new JsonRpcProvider(hre.network.config.url);
const MASK_USE_TARGET_LEVERAGE = 0x08000000;

const bn = require("bignumber.js");
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

const ClearingHouseAbi = require('../perp-lushan/artifacts/contracts/ClearingHouse.sol/ClearingHouse.json')
const OrderBookAbi = require('../perp-lushan/artifacts/contracts/OrderBook.sol/OrderBook.json')
const ClearingHouseConfigAbi = require('../perp-lushan/artifacts/contracts/ClearingHouseConfig.sol/ClearingHouseConfig.json')
const VaultAbi = require('../perp-lushan/artifacts/contracts/Vault.sol/Vault.json')
const ExchangeAbi = require('../perp-lushan/artifacts/contracts/Exchange.sol/Exchange.json')
const MarketRegistryAbi = require('../perp-lushan/artifacts/contracts/MarketRegistry.sol/MarketRegistry.json')
const TestERC20Abi = require('../perp-lushan/artifacts/contracts/test/TestERC20.sol/TestERC20.json')
const BaseTokenAbi = require('../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json')
const BaseToken2Abi = require('../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json')
const QuoteTokenAbi = require('../perp-lushan/artifacts/contracts/QuoteToken.sol/QuoteToken.json')
// const ClearingHouseAbi = require('../perp-lushan/artifacts/contracts/ClearingHouse.sol/ClearingHouse.json')
// const ClearingHouseAbi = require('../perp-lushan/artifacts/contracts/ClearingHouse.sol/ClearingHouse.json')
const UniswapV3PoolAbi = require('../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json')
const UniswapV3Pool2Abi = require('../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json')

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
    // const [admin, maker, maker2, taker, carol] = waffle.provider.getWallets()
    let defaultSigner, usdLemma, reBalancer, hasWETH, keeperGasReward, signer1, signer2, usdl2;
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
        console.log(perpAddresses)
        clearingHouse = new ethers.Contract(perpAddresses.clearingHouse.address, ClearingHouseAbi.abi, hasWETH);
        orderBook = new ethers.Contract(perpAddresses.orderBook.address, OrderBookAbi.abi, hasWETH);
        clearingHouseConfig = new ethers.Contract(perpAddresses.clearingHouseConfig.address, ClearingHouseConfigAbi.abi, hasWETH);
        vault = new ethers.Contract(perpAddresses.vault.address, VaultAbi.abi, hasWETH);
        exchange = new ethers.Contract(perpAddresses.exchange.address, ExchangeAbi.abi, hasWETH);
        marketRegistry = new ethers.Contract(perpAddresses.marketRegistry.address, MarketRegistryAbi.abi, hasWETH);
        collateral = new ethers.Contract(perpAddresses.collateral.address, TestERC20Abi.abi, hasWETH);
        baseToken = new ethers.Contract(perpAddresses.baseToken.address, BaseTokenAbi.abi, hasWETH);
        baseToken2 = new ethers.Contract(perpAddresses.baseToken2.address, BaseToken2Abi.abi, hasWETH);
        quoteToken = new ethers.Contract(perpAddresses.quoteToken.address, QuoteTokenAbi.abi, hasWETH);
        // const mockedBaseAggregator = new ethers.Contract(perpAddresses.mockedBaseAggregator.address, ClearingHouseAbi.abi, hasWETH);
        // const mockedBaseAggregator2 = new ethers.Contract(perpAddresses.mockedBaseAggregator2.address, ClearingHouseAbi.abi, hasWETH);
        const pool = new ethers.Contract(perpAddresses.pool.address, UniswapV3PoolAbi.abi, hasWETH);
        const pool2 = new ethers.Contract(perpAddresses.pool2.address, UniswapV3Pool2Abi.abi, hasWETH);
        // collateralDecimals = await baseToken.decimals()

        const perpLemmaFactory = await ethers.getContractFactory("PerpLemma")
        perpLemma = await upgrades.deployProxy(perpLemmaFactory, 
            [
            collateral.address,
            clearingHouse.address,
            vault.address
        ], { initializer: 'initialize' });

    });
    beforeEach(async function () {
        snapshotId = await snapshot();
    });
    afterEach(async function () {
        await revertToSnapshot(snapshotId);
    });
    it("should get baseToken decimals", async function () {
        console.log('Demo to get error on PerpLemma')
        const decimals = await baseToken.decimals()
    });
});