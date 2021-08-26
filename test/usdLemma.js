const { JsonRpcProvider } = require('@ethersproject/providers');
const { ethers } = require("hardhat");
const { expect, util } = require("chai");
const { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS, getLiquidityPool, getAccountStorage, computeAccount, normalizeBigNumberish, DECIMALS, computeAMMTrade, computeIncreasePosition, _0, _1, computeDecreasePosition } = require('@mcdex/mai3.js');
const { utils } = require('ethers');
const { BigNumber, constants } = ethers;
const { AddressZero, MaxUint256 } = constants;
// const mcdexAddresses = require("../mai-protocol-v3/deployments/local.deployment.json");

const { displayNicely, tokenTransfers, loadMCDEXInfo } = require("./utils");

const arbProvider = new JsonRpcProvider(hre.network.config.url);
const MASK_USE_TARGET_LEVERAGE = 0x08000000;

const printTx = async (hash) => {
    await tokenTransfers.print(hash, [], false);
};

describe("usdLemma", async function () {

    let usdLemma, reBalancer, hasWETH, keeperGasReward, signer1, signer2;

    let liquidityPool, reader, mcdexAddresses;
    const perpetualIndex = 0; //in Kovan the 0th perp for 0th liquidity pool = inverse ETH-USD
    const provider = ethers.provider;
    const ZERO = BigNumber.from("0");
    beforeEach(async function () {
        mcdexAddresses = await loadMCDEXInfo();
        [defaultSinger, usdLemma, reBalancer, hasWETH, signer1, signer2] = await ethers.getSigners();

        const poolCreatorAddress = mcdexAddresses.PoolCreator.address;
        const readerAddress = mcdexAddresses.Reader.address;
        const poolCreator = PoolCreatorFactory.connect(poolCreatorAddress, arbProvider);
        reader = ReaderFactory.connect(readerAddress, defaultSinger);
        const poolCount = await poolCreator.getLiquidityPoolCount();
        const liquidityPools = await poolCreator.listLiquidityPools(ZERO, poolCount);
        const liquidityPoolAddress = liquidityPools[0];
        liquidityPool = LiquidityPoolFactory.connect(liquidityPoolAddress, defaultSinger);
        const perpetualInfo = await liquidityPool.getPerpetualInfo(perpetualIndex);
        const nums = perpetualInfo.nums;
        keeperGasReward = nums[11];


        //deploy mcdexLemma
        const MCDEXLemma = await ethers.getContractFactory("MCDEXLemma");
        this.mcdexLemma = await upgrades.deployProxy(MCDEXLemma, [AddressZero, liquidityPool.address, perpetualIndex, AddressZero, reBalancer.address], { initializer: 'initialize' });

        const collateralAddress = await this.mcdexLemma.collateral();
        const ERC20 = IERC20Factory.connect(collateralAddress, defaultSinger);//choose USDLemma ust because it follows IERC20 interface
        this.collateral = ERC20.attach(collateralAddress);//WETH
        const USDLemma = await ethers.getContractFactory("USDLemma");
        this.usdLemma = await upgrades.deployProxy(USDLemma, [AddressZero, collateralAddress, this.mcdexLemma.address], { initializer: 'initialize' });
        let tx;
        tx = await this.mcdexLemma.setUSDLemma(this.usdLemma.address);
        await tx.wait();

        // const mintABI = [
        //     {
        //         "inputs": [
        //             {
        //                 "internalType": "address",
        //                 "name": "",
        //                 "type": "address"
        //             },
        //             {
        //                 "internalType": "uint256",
        //                 "name": "",
        //                 "type": "uint256"
        //             }
        //         ],
        //         "name": "mint",
        //         "outputs": [],
        //         "stateMutability": "nonpayable",
        //         "type": "function"
        //     }
        // ];

        // const collateralWithMintMethod = new ethers.Contract(this.collateral.address, mintABI, hasWETH);
        // await collateralWithMintMethod.connect(defaultSinger).mint(hasWETH._signer._address, utils.parseUnits("1000000000", "18"));//a large number
        // await collateralWithMintMethod.connect(defaultSinger).mint(defaultSinger._signer._address, utils.parseUnits("10000000000", "18"));//a large number

        await defaultSinger.sendTransaction({ to: this.collateral.address, value: utils.parseEther("10") });//deposit ETH to WETH contract
        await hasWETH.sendTransaction({ to: this.collateral.address, value: utils.parseEther("10") });


        //add liquidity to the liquidity Pool
        const liquidityToAdd = utils.parseEther("1");
        if ((await this.collateral.allowance(defaultSinger.address, liquidityPool.address)).lt(liquidityToAdd)) {
            let tx = await this.collateral.approve(liquidityPool.address, MaxUint256);
            await tx.wait();
        }
        await liquidityPool.addLiquidity(liquidityToAdd);

        //deposit the keeper gas reward
        await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
        await this.mcdexLemma.depositKeeperGasReward();
    });
    it("should initialize correctly", async function () {
        expect(await this.mcdexLemma.usdLemma()).to.equal(this.usdLemma.address);
        expect(await this.usdLemma.perpetualDEXWrappers("0", this.collateral.address)).to.equal(this.mcdexLemma.address);
    });

    it("should deposit correctly", async function () {

        let tx = await this.collateral.approve(this.usdLemma.address, utils.parseEther("10"));
        await tx.wait();

        tx = await this.usdLemma.deposit(utils.parseEther("1000"), 0, utils.parseEther("1"), this.collateral.address)
        await tx.wait();
        
        let balance = await this.usdLemma.balanceOf(defaultSinger.address);

        expect(balance).to.equal(utils.parseEther("1000"));

    })


    it("should withdraw correctly", async function () {

        let tx = await this.collateral.approve(this.usdLemma.address, utils.parseEther("10"));
        await tx.wait();
        const preBalanceDeposit = await this.collateral.balanceOf(defaultSinger.address);
        tx = await this.usdLemma.deposit(utils.parseEther("1000"), 0, utils.parseEther("1"), this.collateral.address)
        await tx.wait();
        
        const preBalance = await this.collateral.balanceOf(defaultSinger.address);

        tx = await this.usdLemma.withdraw(utils.parseEther("1000"), 0, utils.parseEther("0.5"), this.collateral.address);
        await tx.wait();

        const postBalance = await this.collateral.balanceOf(defaultSinger.address);

        expect(postBalance.sub(preBalance)).to.gte(preBalanceDeposit.sub(preBalance).mul("998").div("1000"));

    })

});