const { JsonRpcProvider } = require('@ethersproject/providers');
const { ethers } = require("hardhat");
const { expect, util } = require("chai");
const { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS, getLiquidityPool, getAccountStorage, computeAccount, normalizeBigNumberish, DECIMALS, computeAMMTrade, computeIncreasePosition, _0, _1, computeDecreasePosition } = require('@mcdex/mai3.js');
const { utils } = require('ethers');
const { BigNumber, constants } = ethers;
const { AddressZero, MaxUint256 } = constants;
const mcdexAddresses = require("../mai-protocol-v3/deployments/local.deployment.json");
const { displayNicely, tokenTransfers } = require("./utils");

const arbProvider = new JsonRpcProvider(hre.network.url);
const MASK_USE_TARGET_LEVERAGE = 0x08000000;
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
        await usdLemma.sendTransaction({ to: this.collateral.address, value: amountOfCollateralToMint }); await hasWETH.sendTransaction({ to: this.collateral.address, value: amountOfCollateralToMint });
        //deploy mcdexLemma
        const MCDEXLemma = await ethers.getContractFactory("MockMCDEXLemma");
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
    it("should open position correctly", async function () {
        const amount = utils.parseEther("1000");
        //deposit keeper gas reward
        await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
        await this.mcdexLemma.depositKeeperGasReward();


        const traderInfoBeforeOpen = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        expect(traderInfoBeforeOpen.positionAmount.toString()).to.equal("0");

        //transfer collateral to mcdexLemma (transfer + open is supposed to be done in one transaction)
        const collateralToTransfer = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collateralToTransfer);
        await this.mcdexLemma.connect(usdLemma).open(amount);

        const traderInfoAfterOpen = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        expect(traderInfoAfterOpen.positionAmount.toString()).to.equal("1000"); //amount/10^18
        expect(await this.collateral.balanceOf(this.mcdexLemma.address)).to.equal(ZERO);
    });
    it("should close position correctly", async function () {
        const amount = utils.parseEther("1000");

        await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
        await this.mcdexLemma.depositKeeperGasReward();

        const collateralToTransfer = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collateralToTransfer);
        await this.mcdexLemma.connect(usdLemma).open(amount);

        const traderInfoBeforeClose = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        expect(traderInfoBeforeClose.positionAmount.toString()).to.equal("1000");

        await this.mcdexLemma.connect(usdLemma).close(amount);
        const traderInfoAfterClose = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        expect(traderInfoAfterClose.positionAmount.toString()).to.equal("0");
    });
    it("should return collateral amount required correctly", async function () {
        //deposit keeper gas reward
        await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
        await this.mcdexLemma.depositKeeperGasReward();

        const amount = "1000";
        const MASK_USE_TARGET_LEVERAGE = 0x08000000;
        const tradeFlag = 0;
        // const tradeFlag = MASK_USE_TARGET_LEVERAGE;

        const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
        const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);

        const tradeInfoForOpening = computeAMMTrade(liquidityPoolInfo, perpetualIndex, traderInfo, amount, tradeFlag);
        const deltaCashForOpening = tradeInfoForOpening.tradingPrice.times(normalizeBigNumberish(amount));
        const collateralToTransferForOpening = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(utils.parseEther(amount), true);
        expect(BigNumber.from(deltaCashForOpening.plus(tradeInfoForOpening.totalFee).shiftedBy(DECIMALS).integerValue().toString())).to.be.closeTo(collateralToTransferForOpening, 10000);

        const tradeInfoForClosing = computeAMMTrade(liquidityPoolInfo, perpetualIndex, traderInfo, "-1000", tradeFlag);
        const deltaCashForClosing = tradeInfoForClosing.tradingPrice.times(normalizeBigNumberish(amount));
        const collateralToTransferForClosing = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(utils.parseEther(amount), false);
        expect(BigNumber.from(deltaCashForClosing.minus(tradeInfoForClosing.totalFee).shiftedBy(DECIMALS).integerValue().toString())).to.be.closeTo(collateralToTransferForClosing, 10000);
    });
    // const printTx = async (hash) => {
    //     await tokenTransfers.print(hash, [], false);
    // };
    // it("should calculate fundingPNL correctly", async function () {
    //computeAMM simulating is not working as expected
    //     let tx;
    //     const amount = "1000";
    //     const MASK_USE_TARGET_LEVERAGE = 0x08000000;
    //     const tradeFlag = 0;
    //     // const tradeFlag = MASK_USE_TARGET_LEVERAGE;

    //     //deposit keeper gas reward
    //     await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
    //     await this.mcdexLemma.depositKeeperGasReward();

    //     const collateralToTransfer = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(utils.parseEther(amount), true);
    //     await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collateralToTransfer);
    //     //deposit to simulate correctly
    //     tx = await this.mcdexLemma.deposit(collateralToTransfer);
    //     await printTx(tx.hash);
    //     const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
    //     const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);

    //     displayNicely(traderInfo);
    //     const tradeInfo = computeAMMTrade(liquidityPoolInfo, perpetualIndex, traderInfo, normalizeBigNumberish(amount), tradeFlag);
    //     displayNicely(tradeInfo);
    //     //withdraw to reset 
    //     tx = await this.mcdexLemma.withdraw(collateralToTransfer);
    //     await printTx(tx.hash);
    //     tx = await this.mcdexLemma.connect(usdLemma).open(utils.parseEther(amount));
    //     await printTx(tx.hash);
    //     {
    //         const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
    //         console.log("actual liquidity pool");
    //         displayNicely(liquidityPoolInfo);
    //         const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
    //         const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
    //         console.log("actual account");
    //         displayNicely(account);
    //     }
    // });

    describe("should calculate fundingPNL correctly", async function () {
        it("when negative", async function () { });
        it("when positive", async function () {
            //short to get the PNL in positive
            await liquidityPool.trade(perpetualIndex, defaultSinger.address, "-" + (utils.parseEther("10000")).toString(), "0", MaxUint256, AddressZero, MASK_USE_TARGET_LEVERAGE);
        });
        afterEach(async function () {
            const price = normalizeBigNumberish(utils.parseUnits("5", "14").toString());
            const amount = "1000";
            //deposit keeper gas reward
            await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
            await this.mcdexLemma.depositKeeperGasReward();
            // //short to get the PNL in positive
            // await liquidityPool.trade(perpetualIndex, defaultSinger.address, "-" + (utils.parseEther("10000")).toString(), "0", MaxUint256, AddressZero, MASK_USE_TARGET_LEVERAGE);
            // console.log("increasing");
            // const collateralToTransfer = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(utils.parseEther("10000"), true);
            // await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collateralToTransfer);
            // await this.mcdexLemma.connect(usdLemma).open(utils.parseEther("10000"));

            let entryFunding = _0;
            // for (let i = 0; i <= 5; i++) {
            //     let x = (Math.floor(Math.random() * 2) == 0);
            for (let i = 0; i <= 3; i++) {
                //increase position
                // if (x) {
                const collateralToTransfer = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(utils.parseEther(amount), true);
                await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collateralToTransfer);
                await this.mcdexLemma.connect(usdLemma).open(utils.parseEther(amount));

                const entryFundingFromContract = await this.mcdexLemma.entryFunding();
                // console.log("entryFunding from the contract", (await this.mcdexLemma.entryFunding()).toString());

                // console.log("increasing");
                //entryFunding only changes by the amount it was increased with that is why doing the simulation after the trade has happened yields the same results
                const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
                let traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
                traderInfo.entryFunding = entryFunding;
                // const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
                const accountStorage = computeIncreasePosition(liquidityPoolInfo, perpetualIndex, traderInfo, price, normalizeBigNumberish(amount));
                entryFunding = accountStorage.entryFunding;

                // expect(normalizeBigNumberish(entryFundingFromContract.toString()).shiftedBy(-DECIMALS).toString()).to.equal(entryFunding.toString());
                // console.log("entryFunding calculated", entryFunding.toString());

                expect(BigNumber.from(entryFunding.shiftedBy(DECIMALS).integerValue().toString())).to.be.closeTo(entryFundingFromContract, 1000);
            }
            for (let i = 0; i <= 2; i++) {
                //decrease position
                // else {
                // console.log("decreasing");
                const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
                let traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
                traderInfo.entryFunding = entryFunding;
                // const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
                const accountStorage = computeDecreasePosition(liquidityPoolInfo, perpetualIndex, traderInfo, price, normalizeBigNumberish("-" + amount));
                entryFunding = accountStorage.entryFunding;
                // console.log("entryFunding calculated", entryFunding.toString());

                const collateralToTransfer = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(utils.parseEther(amount), false);
                await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collateralToTransfer);
                await this.mcdexLemma.connect(usdLemma).close(utils.parseEther(amount));

                const entryFundingFromContract = await this.mcdexLemma.entryFunding();
                // console.log("entryFunding from the contract", (await this.mcdexLemma.entryFunding()).toString());
                expect(BigNumber.from(entryFunding.shiftedBy(DECIMALS).integerValue().toString())).to.be.closeTo(entryFundingFromContract, 1000);
            }

            const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
            let traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
            traderInfo.entryFunding = entryFunding;

            const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
            const fundingPNL = account.accountComputed.fundingPNL;
            // console.log("fundingPNL simulation", account.accountComputed.fundingPNL.toString());

            const fundingPNLFromContract = await this.mcdexLemma.getFundingPNL();
            // console.log("fundingPNL from contract", fundingPNLFromContract.toString());

            expect(BigNumber.from(fundingPNL.shiftedBy(DECIMALS).integerValue().toString())).to.be.closeTo(fundingPNLFromContract, 1000);
            // }
        });
    });
});