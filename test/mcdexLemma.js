const { JsonRpcProvider } = require('@ethersproject/providers');
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS, getLiquidityPool } = require('@mcdex/mai3.js');
const { utils } = require('ethers');
const { BigNumber, constants } = ethers;
const { AddressZero, MaxUint256 } = constants;
const mcdexAddresses = require("../mai-protocol-v3/deployments/local.deployment.json");

const arbProvider = new JsonRpcProvider(hre.network.url);

// const chainId = 421611; //rinkeby arbitrum
// const arbProvider = new JsonRpcProvider('https://rinkeby.arbitrum.io/rpc');
const balanceOf = async (erc20, userAddress) => {
    return await erc20.balanceOf(userAddress);
};
describe("mcdexLemma", function () {

    let usdLemma, reInvestor, hasWETH, keeperGasReward;
    //reInvestor = reBalancer
    let liquidityPool, reader;
    const perpetualIndex = 0; //in Kovan the 0th perp for 0th liquidity pool = inverse ETH-USD
    const provider = ethers.provider;
    const ZERO = BigNumber.from("0");
    beforeEach(async function () {

        [defaultSinger, usdLemma, reInvestor, hasWETH] = await ethers.getSigners();

        // const poolCreator = PoolCreatorFactory.connect(CHAIN_ID_TO_POOL_CREATOR_ADDRESS[chainId], arbProvider);
        // reader = ReaderFactory.connect(CHAIN_ID_TO_READER_ADDRESS[chainId], defaultSinger);

        const poolCreatorAddress = mcdexAddresses.PoolCreator.address;
        const readerAddress = mcdexAddresses.Reader.address;

        const poolCreator = PoolCreatorFactory.connect(poolCreatorAddress, arbProvider);
        reader = ReaderFactory.connect(readerAddress, defaultSinger);

        console.log("poolCreatorAddress", poolCreator.address);

        const poolCount = await poolCreator.getLiquidityPoolCount();
        console.log("poolCount", poolCount.toString());
        const liquidityPools = await poolCreator.listLiquidityPools(ZERO, poolCount);

        const liquidityPoolAddress = liquidityPools[0];

        liquidityPool = LiquidityPoolFactory.connect(liquidityPoolAddress, defaultSinger);
        console.log("liquidity pool address", liquidityPool.address);

        const perpetualInfo = await liquidityPool.getPerpetualInfo(perpetualIndex);
        const nums = perpetualInfo.nums;
        keeperGasReward = nums[11];

        //deploy mcdexLemma
        const MCDEXLemma = await ethers.getContractFactory("MCDEXLemma");
        this.mcdexLemma = await upgrades.deployProxy(MCDEXLemma, [AddressZero, liquidityPool.address, perpetualIndex, usdLemma.address, reInvestor.address], { initializer: 'initialize' });

        const collateralAddress = await this.mcdexLemma.collateral();
        const ERC20 = IERC20Factory.connect(collateralAddress, defaultSinger);//choose USDLemma ust because it follows IERC20 interface
        this.collateral = ERC20.attach(collateralAddress);

        console.log("collateral address", collateralAddress);

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
        const balanceOfHasWETH = await this.collateral.balanceOf(hasWETH._signer._address);
        console.log("balance of hasWETH", balanceOfHasWETH.toString());

        {
            const accountsResult = await reader.callStatic.getAccountStorage(liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
            const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
            const perpetualInfo = liquidityPoolInfo.perpetuals.get(perpetualIndex);

            console.log("fundingRate", perpetualInfo.fundingRate.toString());
            console.log("unitAccumulativeFunding", perpetualInfo.unitAccumulativeFunding.toString());

            ///need to use .callStatic as to explicitly tell to node that it is not a state changing transaction and return the result (We have to do this because the reader contract implements this method without making it a "view" method even though it is)

            console.log(accountsResult.toString());
        }

        //add liquidity to the liquidity Pool
        const liquidityToAdd = utils.parseEther("1");
        if ((await this.collateral.allowance(defaultSinger.address, liquidityPool.address)).lt(liquidityToAdd)) {
            let tx = await this.collateral.approve(liquidityPool.address, MaxUint256);
            await tx.wait();
        }
        await liquidityPool.addLiquidity(liquidityToAdd);




        //deposit keeper Gas reward
        console.log("depositing keeper gas reward");
        if ((await this.collateral.allowance(defaultSinger.address, this.mcdexLemma.address)).lt(keeperGasReward)) {
            let tx = await this.collateral.approve(this.mcdexLemma.address, MaxUint256);
            await tx.wait();
        }
        tx = await this.mcdexLemma.depositKeeperGasReward();
        await tx.wait();

    });
    it("should initialize correctly", async function () {
        expect(await this.mcdexLemma.usdLemma()).to.equal(usdLemma.address);
    });
    it("should open and close position correctly", async function () {
        const trader = this.mcdexLemma.address;
        //find an address with the WETH 
        const amount = utils.parseUnits("1", "18");
        //The WETH on kovan deployment of MCDEX has 18 decimals
        console.log("amount", amount.toString());
        console.log("collateral decimals", (await this.collateral.decimals()).toString());

        const balanceOfHasWETH = await this.collateral.balanceOf(hasWETH._signer._address);
        if (balanceOfHasWETH.lt(amount)) {
            throw new Error("not enough balance");
        }

        await this.collateral.connect(hasWETH).transfer(this.mcdexLemma.address, amount);

        const amountInUSD = utils.parseUnits("1000", "18");
        await this.mcdexLemma.open(amountInUSD);

        await liquidityPool.forceToSyncState();

        // const amountInUSDClose = utils.parseUnits("1000", "18");
        // await this.mcdexLemma.close(amountInUSDClose);

        // const accountsResult = await reader.callStatic.getAccountStorage(liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        //need to use .callStatic as to explicitly tell to node that it is not a state changing transaction and return the result (We have to do this because the reader contract implements this method without making it a "view" method even though it is)

        // console.log(accountsResult);
        // console.log(accountsResult.toString());

        // const marginAccount = await liquidityPool.getMarginAccount(perpetualIndex, trader);
        // console.log(marginAccount);
        // console.log(marginAccount.toString());
        // String
        // notifier.notify('Test done');
    });

    // it("check how the funding rate changes things", async function () {
    //     const trader = this.mcdexLemma.address;
    //     //find an address with the WETH 
    //     const amount = utils.parseUnits("1", "18");
    //     //The WETH on kovan deployment of MCDEX has 18 decimals
    //     console.log("amount", amount.toString());
    //     console.log("collateral decimals", (await this.collateral.decimals()).toString());

    //     await this.collateral.connect(hasWETH).transfer(this.mcdexLemma.address, amount);
    //     console.log("WETH transferred");
    //     const amountInUSD = utils.parseUnits("2000", "18");
    //     await this.mcdexLemma.open(amountInUSD);

    //     await liquidityPool.forceToSyncState();

    //     {
    //         const accountsResult = await reader.callStatic.getAccountStorage(liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
    //         const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
    //         const perpetualInfo = liquidityPoolInfo.perpetuals.get(perpetualIndex);

    //         console.log("fundingRate", perpetualInfo.fundingRate.toString());
    //         console.log("unitAccumulativeFunding", perpetualInfo.unitAccumulativeFunding.toString());

    //         ///need to use .callStatic as to explicitly tell to node that it is not a state changing transaction and return the result (We have to do this because the reader contract implements this method without making it a "view" method even though it is)

    //         console.log(accountsResult.toString());
    //     }

    //     await this.mcdexLemma.reBalance();

    //     //go forward in time to be able to distribute the fundingPayments
    //     await hre.network.provider.request({
    //         method: "evm_increaseTime",
    //         params: [60 * 60 * 9] //8 hours
    //     }
    //     );
    //     await hre.network.provider.request({
    //         method: "evm_mine",
    //     }
    //     );

    //     ///update the cumulative funding Rate
    //     await liquidityPool.forceToSyncState();
    //     {
    //         const accountsResult = await reader.callStatic.getAccountStorage(liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
    //         const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
    //         const perpetualInfo = liquidityPoolInfo.perpetuals.get(perpetualIndex);

    //         console.log("fundingRate", perpetualInfo.fundingRate.toString());
    //         console.log("unitAccumulativeFunding", perpetualInfo.unitAccumulativeFunding.toString());

    //         ///need to use .callStatic as to explicitly tell to node that it is not a state changing transaction and return the result (We have to do this because the reader contract implements this method without making it a "view" method even though it is)

    //         console.log(accountsResult.toString());
    //     }
    //     await this.mcdexLemma.reBalance();
    // });
});