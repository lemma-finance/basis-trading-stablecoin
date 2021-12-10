import { JsonRpcProvider } from '@ethersproject/providers';
import { ethers, upgrades } from "hardhat";
import hre from "hardhat";
import { expect, util } from "chai";
import { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS, getLiquidityPool, getAccountStorage, computeAccount, normalizeBigNumberish, DECIMALS, computeAMMTrade, computeIncreasePosition, _0, _1, computeDecreasePosition, computeAMMTradeAmountByMargin } from '@mcdex/mai3.js';
import { utils } from 'ethers';
const { BigNumber, constants } = ethers;
const { AddressZero, MaxUint256, MaxInt256 } = constants;
// const mcdexAddresses = require("../mai-protocol-v3/deployments/local.deployment.json");

import { displayNicely, 
    // tokenTransfers, 
    loadMCDEXInfo, toBigNumber, fromBigNumber, snapshot, revertToSnapshot } from "./shared/utils";

const arbProvider = new JsonRpcProvider('http://localhost:8545');
const MASK_USE_TARGET_LEVERAGE = 0x08000000;

const bn = require("bignumber.js");

// const printTx = async (hash: any) => {
//     await tokenTransfers.print(hash, [], false);
// };

const convertToCollateralDecimals = (numString: any, collateralDecimals: any) => {
    let decimalPos = utils.formatEther(numString).indexOf(".");
    if (decimalPos < 0) {
        return numString;
    }
    let trimmedNumber = utils.formatEther(numString).substring(0, collateralDecimals.toNumber() + decimalPos + 1);
    return utils.parseUnits(trimmedNumber, collateralDecimals);
};

describe("mcdexLemma", async function () {

    let defaultSigner: any, usdLemma: any, reBalancer: any, hasWETH: any, keeperGasReward: any, signer1: any, signer2: any, usdl2: any;

    let liquidityPool: any, reader: any, mcdexAddresses: any;
    const perpetualIndex = 0; //in Kovan the 0th perp for 0th liquidity pool = inverse ETH-USD
    const provider = ethers.provider;
    const ZERO = BigNumber.from("0");
    let snapshotId: any;
    before(async function () {
        mcdexAddresses = await loadMCDEXInfo();
        [defaultSigner, usdLemma, reBalancer, hasWETH, signer1, signer2, usdl2] = await ethers.getSigners();
        const poolCreatorAddress = mcdexAddresses.PoolCreator.address;
        const readerAddress = mcdexAddresses.Reader.address;
        const poolCreator = PoolCreatorFactory.connect(poolCreatorAddress, arbProvider);
        reader = ReaderFactory.connect(readerAddress, defaultSigner);
        const poolCount = await poolCreator.getLiquidityPoolCount();
        const liquidityPools = await poolCreator.listLiquidityPools(ZERO, poolCount);
        const liquidityPoolAddress = liquidityPools[0];
        liquidityPool = LiquidityPoolFactory.connect(liquidityPoolAddress, defaultSigner);

        const perpetualInfo = await liquidityPool.getPerpetualInfo(perpetualIndex);
        const nums = perpetualInfo.nums;
        keeperGasReward = nums[11];

        //get the collateral tokens
        const collateralAddress = mcdexAddresses.WETH9.address;
        const ERC20 = IERC20Factory.connect(collateralAddress, defaultSigner);
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
        // await collateralWithMintMethod.connect(defaultSigner).mint(hasWETH._signer._address, amountOfCollateralToMint);
        // await collateralWithMintMethod.connect(defaultSigner).mint(defaultSigner._signer._address, amountOfCollateralToMint);

        //deposit ETH to WETH contract
        await defaultSigner.sendTransaction({ to: this.collateral.address, value: amountOfCollateralToMint });
        await usdLemma.sendTransaction({ to: this.collateral.address, value: amountOfCollateralToMint });
        await hasWETH.sendTransaction({ to: this.collateral.address, value: amountOfCollateralToMint });

        const maxPosition = MaxUint256;
        const trustedForwarder = AddressZero;
        //deploy mcdexLemma
        const MCDEXLemma = await ethers.getContractFactory("MCDEXLemma");
        this.mcdexLemma = await upgrades.deployProxy(MCDEXLemma, [trustedForwarder, liquidityPool.address, perpetualIndex, usdLemma.address, reBalancer.address, maxPosition], { initializer: 'initialize' });
        this.collateralDecimals = await this.mcdexLemma.collateralDecimals();

        //add liquidity to the liquidity Pool
        const liquidityToAdd = utils.parseEther("10");
        if ((await this.collateral.allowance(defaultSigner.address, liquidityPool.address)).lt(liquidityToAdd)) {
            let tx = await this.collateral.approve(liquidityPool.address, MaxUint256);
            await tx.wait();
        }
        await liquidityPool.addLiquidity(liquidityToAdd);
    });
    beforeEach(async function () {
        snapshotId = await snapshot();
    });
    afterEach(async function () {
        await revertToSnapshot(snapshotId);
    });
    it("should initialize correctly", async function () {
        expect(await this.mcdexLemma.owner()).to.equal(defaultSigner.address);
        expect(await this.mcdexLemma.liquidityPool()).to.equal(liquidityPool.address);
        expect((await this.mcdexLemma.perpetualIndex()).toString()).to.equal(perpetualIndex.toString());
        expect(await this.mcdexLemma.collateral()).to.equal(mcdexAddresses.WETH9.address);
        expect(await this.mcdexLemma.collateralDecimals()).to.equal(await this.collateral.decimals());
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
        await this.mcdexLemma.connect(defaultSigner).setUSDLemma(signer1.address);
        expect(await this.mcdexLemma.usdLemma()).to.equal(signer1.address);

        //setReferrer
        await expect(this.mcdexLemma.connect(signer1).setReferrer(signer1.address)).to.be.revertedWith("Ownable: caller is not the owner");
        await this.mcdexLemma.connect(defaultSigner).setReferrer(signer1.address);
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
        let collaterAmountInDecimals = await this.mcdexLemma.getAmountInCollateralDecimals(collateralToTransfer, true);
        let preBalance = await this.collateral.balanceOf(this.mcdexLemma.address);
        await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collaterAmountInDecimals);
        await this.mcdexLemma.connect(usdLemma).open(amount, collateralToTransfer);
        let postBalance = await this.collateral.balanceOf(this.mcdexLemma.address);
        const traderInfoAfterOpen = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        expect(traderInfoAfterOpen.positionAmount.toString()).to.equal("1000"); //amount/10^18
        expect(postBalance.sub(preBalance)).to.equal(ZERO);
    });
    it("should fail to open when max position is reached", async function () {
        const amount = utils.parseEther("1000");
        await this.mcdexLemma.setMaxPosition(amount);

        //deposit keeper gas reward
        await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
        await this.mcdexLemma.depositKeeperGasReward();

        //transfer collateral to mcdexLemma (transfer + open is supposed to be done in one transaction)
        const collateralToTransfer = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        let collaterAmountInDecimals = await this.mcdexLemma.getAmountInCollateralDecimals(collateralToTransfer, true);

        await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collaterAmountInDecimals);
        await expect(this.mcdexLemma.connect(usdLemma).open(amount.add(1), collateralToTransfer)).to.be.revertedWith("max position reached");
        await expect(this.mcdexLemma.connect(usdLemma).open(amount, collateralToTransfer)).not.to.be.reverted;
    });
    it("should close position correctly", async function () {
        const amount = utils.parseEther("1000");

        await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
        await this.mcdexLemma.depositKeeperGasReward();

        const collateralToTransfer = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collateralToTransfer);
        await this.mcdexLemma.connect(usdLemma).open(amount, collateralToTransfer);

        const traderInfoBeforeClose = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        expect(traderInfoBeforeClose.positionAmount.toString()).to.equal("1000");

        const collateralToGetBack = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
        await this.mcdexLemma.connect(usdLemma).close(amount, collateralToGetBack);
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

    // it("should calculate fundingPNL correctly", async function () {
    // computeAMM simulating is not working as expected
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
    //     tx = await this.mcdexLemma.connect(usdLemma).open(utils.parseEther(amount),collateralToTransfer);
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
            await liquidityPool.trade(perpetualIndex, defaultSigner.address, "-" + (utils.parseEther("10000")).toString(), "0", MaxUint256, AddressZero, MASK_USE_TARGET_LEVERAGE);
        });
        afterEach(async function () {
            const price = normalizeBigNumberish(utils.parseUnits("5", "14").toString());
            const amount = "1000";
            //deposit keeper gas reward
            await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
            await this.mcdexLemma.depositKeeperGasReward();

            let entryFunding: any = _0;
            for (let i = 0; i <= 3; i++) {
                //increase position
                const collateralToTransfer = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(utils.parseEther(amount), true);
                await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collateralToTransfer.mul(2));//add more than required as it won't be accurate
                await this.mcdexLemma.connect(usdLemma).open(utils.parseEther(amount), collateralToTransfer);

                const entryFundingFromContract = await this.mcdexLemma.entryFunding();
                //entryFunding only changes by the amount it was increased with that is why doing the simulation after the trade has happened yields the same results
                const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
                let traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
                traderInfo.entryFunding = entryFunding;
                const accountStorage = computeIncreasePosition(liquidityPoolInfo, perpetualIndex, traderInfo, price, normalizeBigNumberish(amount));
                entryFunding = accountStorage.entryFunding;

                expect(BigNumber.from(entryFunding.shiftedBy(DECIMALS).integerValue().toString())).to.be.closeTo(entryFundingFromContract, 1000);
            }
            for (let i = 0; i <= 2; i++) {
                //decrease position
                const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
                let traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
                traderInfo.entryFunding = entryFunding;
                const accountStorage = computeDecreasePosition(liquidityPoolInfo, perpetualIndex, traderInfo, price, normalizeBigNumberish("-" + amount));
                entryFunding = accountStorage.entryFunding;

                const collateralToTransfer = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(utils.parseEther(amount), false);
                await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collateralToTransfer);
                await this.mcdexLemma.connect(usdLemma).close(utils.parseEther(amount), collateralToTransfer);

                const entryFundingFromContract = await this.mcdexLemma.entryFunding();
                expect(BigNumber.from(entryFunding.shiftedBy(DECIMALS).integerValue().toString())).to.be.closeTo(entryFundingFromContract, 1000);
            }

            const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
            let traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
            traderInfo.entryFunding = entryFunding;

            const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
            const fundingPNL: any = account.accountComputed.fundingPNL;
            const fundingPNLFromContract = await this.mcdexLemma.getFundingPNL();

            expect(BigNumber.from(fundingPNL.shiftedBy(DECIMALS).integerValue().toString())).to.be.closeTo(fundingPNLFromContract, 1000);
        });
    });
    describe("when settled", async function () {
        beforeEach(async function () {
            const amount = utils.parseEther("1000");

            await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
            await this.mcdexLemma.depositKeeperGasReward();

            const collateralToTransfer = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
            await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collateralToTransfer);
            await this.mcdexLemma.connect(usdLemma).open(amount, collateralToTransfer);

            //terminate the oracle as prerequisite of setting emergency state
            const oracleAdaptorAddress = mcdexAddresses.OracleAdaptor.address;
            const oracleAdaptor = new ethers.Contract(oracleAdaptorAddress, ["function setTerminated(bool isTerminated_)"], defaultSigner);
            await oracleAdaptor.setTerminated(true);

            await liquidityPool.setEmergencyState(perpetualIndex);

            const activeAccounts = await liquidityPool.getActiveAccountCount(perpetualIndex);
            // console.log("activeAccounts", parseInt(activeAccounts));
            for (let i = 0; i < activeAccounts; i++) {
                await liquidityPool.connect(signer2).clear(perpetualIndex);//keeper = any account
            }
            const liquidityPoolInfo: any = await getLiquidityPool(reader, liquidityPool.address);
            expect(liquidityPoolInfo.perpetuals.get(perpetualIndex).state).to.equal(4);//cleared
        });
        it("should not be able to deposit keeper gas reward", async function () {
            await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
            await expect(this.mcdexLemma.depositKeeperGasReward()).to.be.revertedWith("perpetual should be in NORMAL state");
        });
        it("should not be able to open", async function () {
            const amount = utils.parseEther("1000");
            await expect(this.mcdexLemma.getCollateralAmountGivenUnderlyingAssetAmount(amount, true)).to.be.revertedWith("cannot open when perpetual has settled");
        });
        it("should close correctly", async function () {
            const amount = utils.parseEther("1000");
            const collateralBalanceBefore = await this.collateral.balanceOf(usdLemma.address);
            let { settleableMargin } = await liquidityPool.getMarginAccount(
                perpetualIndex,
                this.mcdexLemma.address
            );
            settleableMargin = await this.mcdexLemma.getAmountInCollateralDecimals(settleableMargin, false);
            const collateralToGetBack = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
            await this.mcdexLemma.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
            await this.mcdexLemma.connect(usdLemma).close(amount, collateralToGetBack);
            const collateralBalanceAfter = await this.collateral.balanceOf(usdLemma.address);
            let diff = collateralBalanceAfter.sub(collateralBalanceBefore);
            //usdlemma balance change == settleableMargin
            const amt: any = utils.parseUnits("0.05", this.collateralDecimals)
            expect(diff).to.be.closeTo(settleableMargin, amt);
        });
        it("should settle + close correctly", async function () {
            const amount = utils.parseEther("1000");
            let { settleableMargin } = await liquidityPool.getMarginAccount(
                perpetualIndex,
                this.mcdexLemma.address
            );
            const collateralBalanceBefore = await this.collateral.balanceOf(usdLemma.address);
            let preBalance = await this.collateral.balanceOf(this.mcdexLemma.address);

            await this.mcdexLemma.settle();

            let settledDiff = (await this.collateral.balanceOf(this.mcdexLemma.address)).sub(preBalance);
            expect((await this.collateral.balanceOf(this.mcdexLemma.address)).sub(preBalance)).to.equal(convertToCollateralDecimals(settleableMargin.toString(), this.collateralDecimals));

            const collateralToGetBack = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
            await this.mcdexLemma.connect(usdLemma).close(amount, collateralToGetBack);
            settledDiff = (await this.collateral.balanceOf(this.mcdexLemma.address)).sub(preBalance);
            // await printTx(tx.hash);
            const amt: any = utils.parseUnits("0.05", this.collateralDecimals)
            expect(await this.collateral.balanceOf(this.mcdexLemma.address)).to.be.closeTo(preBalance, amt);
            const collateralBalanceAfter = await this.collateral.balanceOf(usdLemma.address);
            //usdlemma balance change == settleableMargin
            expect(collateralBalanceAfter.sub(collateralBalanceBefore)).to.be.closeTo(convertToCollateralDecimals(settleableMargin.toString(), this.collateralDecimals), amt);
        });
        it("should return collateral required correctly", async function () {
            const amount = utils.parseEther("1000");
            //fails if tries to open
            await expect(this.mcdexLemma.getCollateralAmountGivenUnderlyingAssetAmount(amount, true)).to.be.revertedWith("cannot open when perpetual has settled");
            const collateralRequiredFromContractForAllAmount = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
            const account = await liquidityPool.getMarginAccount(
                perpetualIndex,
                this.mcdexLemma.address
            );
            const amt: any = utils.parseUnits("0.05", 18)
            expect(collateralRequiredFromContractForAllAmount).to.be.closeTo(account.settleableMargin, amt);

            const collateralRequiredForHalfAmount = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount.div(2), false);
            expect(collateralRequiredForHalfAmount).to.be.closeTo(account.settleableMargin.div(2), amt);
        });
    });
    describe("re balance", async function () {
        beforeEach(async function () {
            const amount = utils.parseEther("1000");

            await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
            await this.mcdexLemma.depositKeeperGasReward();

            const collateralToTransfer = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
            await this.collateral.connect(usdLemma).transfer(this.mcdexLemma.address, collateralToTransfer);
            await this.mcdexLemma.connect(usdLemma).open(amount, collateralToTransfer);
        });

        it("when fundingPNL is positive", async function () {
            await liquidityPool.trade(perpetualIndex, defaultSigner.address, "-" + (utils.parseEther("10000")).toString(), "0", MaxUint256, AddressZero, MASK_USE_TARGET_LEVERAGE);
        });
        it("when fundingPNL is negative", async function () {

        });
        afterEach(async function () {
            //increase time
            //to make sure that funding payment has a meaning impact
            await hre.network.provider.request({
                method: "evm_increaseTime",
                params: [60 * 60 * 30 * 10]
            }
            );
            await hre.network.provider.request({
                method: "evm_mine",
                params: []
            }
            );

            await liquidityPool.forceToSyncState();
            const fundingPNL = await this.mcdexLemma.getFundingPNL();
            const realizedFundingPNL = await this.mcdexLemma.realizedFundingPNL();
            const unrealizedFundingPNL = fundingPNL.sub(realizedFundingPNL);

            const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
            const perpetualInfo: any = liquidityPoolInfo.perpetuals.get(perpetualIndex);
            const marginChange = (await toBigNumber(unrealizedFundingPNL)).negated();
            const feeRate = perpetualInfo.lpFeeRate.plus(liquidityPoolInfo.vaultFeeRate).plus(perpetualInfo.operatorFeeRate);
            const marginChangeWithFeesConsidered = marginChange.times((await toBigNumber(utils.parseEther("1"))).minus(feeRate));//0.07%
            const amountWithFeesConsidered = computeAMMTradeAmountByMargin(liquidityPoolInfo, perpetualIndex, marginChangeWithFeesConsidered);

            const limitPrice = amountWithFeesConsidered.isNegative() ? 0 : MaxInt256;
            const deadline = MaxUint256;
            await this.mcdexLemma.connect(usdLemma).reBalance(reBalancer.address, await fromBigNumber(amountWithFeesConsidered), ethers.utils.defaultAbiCoder.encode(["int256", "uint256"], [limitPrice, deadline]));
            {
                const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
                const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
                const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
                //expect the leverage to be ~1
                expect(await fromBigNumber(account.accountComputed.leverage)).to.be.closeTo(utils.parseEther("1"), 1e14);
            }
            //TODO: need to also add test to check that the trade actually happens on MCDEX via events
        });
    });

    it("should round up correctly", async function () {
        const collateralDecimals = (await this.mcdexLemma.collateralDecimals()).toString();
        const SYSTEM_DECIMALS = "18";
        if (collateralDecimals != SYSTEM_DECIMALS) {
            const amount = "1";
            const roundUpAmount = await this.mcdexLemma.getAmountInCollateralDecimals(amount, true);
            expect(roundUpAmount).to.equal("1");
            const notRoundedUpAmount = await this.mcdexLemma.getAmountInCollateralDecimals(amount, false);
            expect(notRoundedUpAmount).to.equal("0");
        }
    });

    it("should update USDL", async function () {
        let tx = await this.mcdexLemma.setUSDLemma(usdl2.address);
        expect(tx).to.emit(this.mcdexLemma, "USDLemmaUpdated").withArgs(usdl2.address);
        await this.mcdexLemma.setUSDLemma(usdLemma.address);
    });

    it("should update referrer", async function () {
        let tx = await this.mcdexLemma.setReferrer(signer1.address);
        expect(tx).to.emit(this.mcdexLemma, "ReferrerUpdated").withArgs(signer1.address);
    });

    it("should update rebalancer", async function () {
        let tx = await this.mcdexLemma.setReBalancer(signer1.address);
        expect(tx).to.emit(this.mcdexLemma, "RebalancerUpdated").withArgs(signer1.address);
        await this.mcdexLemma.setReBalancer(reBalancer.address);
    });

    it("should update max position", async function () {
        let tx = await this.mcdexLemma.setMaxPosition(utils.parseEther("100000"));
        expect(tx).to.emit(this.mcdexLemma, "MaxPositionUpdated").withArgs(utils.parseEther("100000"));
        await this.mcdexLemma.setMaxPosition(MaxUint256);
    });

});