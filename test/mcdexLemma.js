const { JsonRpcProvider } = require('@ethersproject/providers');
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS, getLiquidityPool, getAccountStorage, computeAccount, normalizeBigNumberish, DECIMALS } = require('@mcdex/mai3.js');
const { utils } = require('ethers');
const { BigNumber, constants } = ethers;
const { AddressZero, MaxUint256 } = constants;
const mcdexAddresses = require("../mai-protocol-v3/deployments/local.deployment.json");


const arbProvider = new JsonRpcProvider(hre.network.url);

const balanceOf = async (erc20, userAddress) => {
    return await erc20.balanceOf(userAddress);
};
describe("mcdexLemma", function () {

    let usdLemma, reBalancer, hasWETH, keeperGasReward;
    let liquidityPool, reader;
    const perpetualIndex = 0; //in Kovan the 0th perp for 0th liquidity pool = inverse ETH-USD
    const provider = ethers.provider;
    const ZERO = BigNumber.from("0");
    beforeEach(async function () {
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

        //get the collateral tokens
        const collateralAddress = mcdexAddresses.WETH9.address;
        const ERC20 = IERC20Factory.connect(collateralAddress, defaultSinger);
        this.collateral = ERC20.attach(collateralAddress);

        const amountOfCollateralToMint = utils.parseEther("100");
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
        // await collateralWithMintMethod.connect(defaultSinger).mint(hasWETH._signer._address, amountOfCollateralToMint);
        // await collateralWithMintMethod.connect(defaultSinger).mint(defaultSinger._signer._address, amountOfCollateralToMint);

        //deposit ETH to WETH contract
        await defaultSinger.sendTransaction({ to: this.collateral.address, value: amountOfCollateralToMint });
        await hasWETH.sendTransaction({ to: this.collateral.address, value: amountOfCollateralToMint });
        //deploy mcdexLemma
        const MCDEXLemma = await ethers.getContractFactory("MCDEXLemma");
        this.mcdexLemma = await upgrades.deployProxy(MCDEXLemma, [AddressZero, liquidityPool.address, perpetualIndex, usdLemma.address, reBalancer.address], { initializer: 'initialize' });

        //add liquidity to the liquidity Pool
        const liquidityToAdd = utils.parseEther("10");
        if ((await this.collateral.allowance(defaultSinger.address, liquidityPool.address)).lt(liquidityToAdd)) {
            let tx = await this.collateral.approve(liquidityPool.address, MaxUint256);
            await tx.wait();
        }
        await liquidityPool.addLiquidity(liquidityToAdd);
    });
    it("should initialize correctly", async function () {
        expect(await this.mcdexLemma.owner()).to.equal(defaultSinger.address);
        expect(await this.mcdexLemma.liquidityPool()).to.equal(liquidityPool.address);
        expect((await this.mcdexLemma.perpetualIndex()).toString()).to.equal(perpetualIndex.toString());
        expect(await this.mcdexLemma.collateral()).to.equal(mcdexAddresses.WETH9.address);
        expect(await this.mcdexLemma.isSettled()).to.equal(false);
        expect(await this.mcdexLemma.reBalancer()).to.equal(reBalancer.address);
        expect(await this.mcdexLemma.usdLemma()).to.equal(usdLemma.address);
        expect(await this.collateral.allowance(this.mcdexLemma.address, liquidityPool.address)).to.equal(MaxUint256);
        //get target leverage
        const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        expect(traderInfo.targetLeverage.toString()).to.equal("1");
    });
    it("should set addresses correctly", async function () {
        //setUSDLemma
        await expect(this.mcdexLemma.connect(signer1).setUSDLemma(signer1.address)).to.be.revertedWith("Ownable: caller is not the owner");
        await this.mcdexLemma.connect(defaultSinger).setUSDLemma(signer1.address);
        expect(await this.mcdexLemma.usdLemma()).to.equal(signer1.address);

        //setReferrer
        await expect(this.mcdexLemma.connect(signer1).setReferrer(signer1.address)).to.be.revertedWith("Ownable: caller is not the owner");
        await this.mcdexLemma.connect(defaultSinger).setReferrer(signer1.address);
        expect(await this.mcdexLemma.referrer()).to.equal(signer1.address);
    });
    it("should deposit keeper reward correctly", async function () {
        const traderInfoBefore = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        expect(traderInfoBefore.cashBalance.toString()).to.equal("0");
        await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
        await this.mcdexLemma.depositKeeperGasReward();
        const traderInfoAfter = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        expect(traderInfoAfter.cashBalance.toString()).to.equal(normalizeBigNumberish(keeperGasReward).shiftedBy(-DECIMALS).toString());
    });

    it("should open and close position correctly", async function () {
        //deposit keeper Gas reward
        // console.log("depositing keeper gas reward");
        if ((await this.collateral.allowance(defaultSinger.address, this.mcdexLemma.address)).lt(keeperGasReward)) {
            let tx = await this.collateral.approve(this.mcdexLemma.address, MaxUint256);
            await tx.wait();
        }
        tx = await this.mcdexLemma.depositKeeperGasReward();
        await tx.wait();

        const trader = this.mcdexLemma.address;
        //find an address with the WETH 
        const amount = utils.parseUnits("1", "18");
        //The WETH on kovan deployment of MCDEX has 18 decimals
        // console.log("amount", amount.toString());
        // console.log("collateral decimals", (await this.collateral.decimals()).toString());

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