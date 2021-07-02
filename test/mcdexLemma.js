const { JsonRpcProvider } = require('@ethersproject/providers');
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS } = require('@mcdex/mai3.js');
const { utils } = require('ethers');
const { BigNumber, constants } = ethers;
const notifier = require('node-notifier');


const chainId = 42;//kovan
const arbProvider = new JsonRpcProvider('https://kovan.infura.io/v3/2a1a54c3aa374385ae4531da66fdf150');

// const chainId = 421611; //rinkeby arbitrum
// const arbProvider = new JsonRpcProvider('https://rinkeby.arbitrum.io/rpc');

describe("mcdexLemma", function () {
    let usdLemma, reInvestor, hasWETH;
    let liquidityPool, reader;
    const perpetualIndex = "0"; //in Kovan the 0th perp for 0th liquidity pool = inverse ETH-USD
    const provider = ethers.provider;
    const ZERO = BigNumber.from("0");
    beforeEach(async function () {
        [defaultSinger, usdLemma, reInvestor] = await ethers.getSigners();
        const poolCreator = PoolCreatorFactory.connect(CHAIN_ID_TO_POOL_CREATOR_ADDRESS[chainId], arbProvider);
        reader = ReaderFactory.connect(CHAIN_ID_TO_READER_ADDRESS[chainId], defaultSinger);
        console.log("poolCreatorAddress", poolCreator.address);

        const poolCount = await poolCreator.getLiquidityPoolCount();
        console.log("poolCount", poolCount.toString());
        const liquidityPools = await poolCreator.listLiquidityPools(ZERO, poolCount);

        const liquidityPoolAddress = liquidityPools[0];

        liquidityPool = LiquidityPoolFactory.connect(liquidityPoolAddress, defaultSinger);
        console.log("liquidity pool address", liquidityPool.address);


        //deploy mcdexLemma
        const MCDEXLemma = await ethers.getContractFactory("MCDEXLemma");
        this.mcdexLemma = await upgrades.deployProxy(MCDEXLemma, [liquidityPool.address, perpetualIndex, usdLemma.address, reInvestor.address], { initializer: 'initialize' });

        const collateralAddress = await this.mcdexLemma.collateral();
        const ERC20 = IERC20Factory.connect(collateralAddress, defaultSinger);//choose USDLemma ust because it follows IERC20 interface
        this.collateral = ERC20.attach(collateralAddress);

        console.log("collateral address", collateralAddress);

        await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x5FD7d6382De0D4c4A00B19Ed10c11dfD96C27340"]
        }
        );
        hasWETH = await ethers.provider.getSigner("0x5FD7d6382De0D4c4A00B19Ed10c11dfD96C27340");

        const balanceOfHasWETH = await this.collateral.balanceOf("0x5FD7d6382De0D4c4A00B19Ed10c11dfD96C27340");
        console.log("balance of hasWETH", balanceOfHasWETH.toString());

    });
    // it("should initialize correctly", async function () {
    //     expect(await this.mcdexLemma.usdLemma()).to.equal(usdLemma.address);
    // });
    it("should open position correctly", async function () {
        const trader = this.mcdexLemma.address;
        //find an address with the WETH 
        const amount = utils.parseUnits("1", "18");
        //The WETH on kovan deployment of MCDEX has 18 decimals
        console.log("amount", amount.toString());
        console.log("collateral decimals", (await this.collateral.decimals()).toString());

        await this.collateral.connect(hasWETH).transfer(this.mcdexLemma.address, amount);
        const amountInUSD = utils.parseUnits("2000", "18");
        await this.mcdexLemma.open(amountInUSD);

        await liquidityPool.forceToSyncState();

        const amountInUSDClose = utils.parseUnits("1990", "18");
        await this.mcdexLemma.close(amountInUSDClose);

        // const accountsResult = await reader.callStatic.getAccountStorage(liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        //need to use .callStatic as to explicitly tell to node that it is not a state changing transaction and return the result (We have to do this because the reader contract implements this method without making it a "view" method even though it is)

        // console.log(accountsResult);
        // console.log(accountsResult.toString());

        // const marginAccount = await liquidityPool.getMarginAccount(perpetualIndex, trader);
        // console.log(marginAccount);
        // console.log(marginAccount.toString());
        // String
        notifier.notify('Test done');
    });
});