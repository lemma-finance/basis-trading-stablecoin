const { JsonRpcProvider } = require('@ethersproject/providers');
const { ethers } = require("hardhat");
const { expect, util } = require("chai");
const { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS, getLiquidityPool, getAccountStorage, computeAccount, normalizeBigNumberish, DECIMALS, computeAMMTrade, computeIncreasePosition, _0, _1, computeDecreasePosition, computeAMMTradeAmountByMargin } = require('@mcdex/mai3.js');
const { utils } = require('ethers');
const { BigNumber, constants } = ethers;
const { AddressZero, MaxUint256, MaxInt256 } = constants;
// const mcdexAddresses = require("../mai-protocol-v3/deployments/local.deployment.json");

const { displayNicely, tokenTransfers, loadMCDEXInfo, toBigNumber, fromBigNumber } = require("./utils");

const arbProvider = new JsonRpcProvider(hre.network.config.url);
const MASK_USE_TARGET_LEVERAGE = 0x08000000;

const printTx = async (hash) => {
    await tokenTransfers.print(hash, [], false);
};

describe("usdLemma", async function () {

    let reBalancer, hasWETH, keeperGasReward, stackingContract, lemmaTreasury, signer1, signer2;

    let liquidityPool, reader, mcdexAddresses;
    const perpetualIndex = 0; //in Kovan the 0th perp for 0th liquidity pool = inverse ETH-USD
    const provider = ethers.provider;
    const ZERO = BigNumber.from("0");
    beforeEach(async function () {
        mcdexAddresses = await loadMCDEXInfo();
        [defaultSigner, reBalancer, hasWETH, stackingContract, lemmaTreasury, signer1, signer2] = await ethers.getSigners();

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


        //deploy mcdexLemma
        const MCDEXLemma = await ethers.getContractFactory("MCDEXLemma");
        this.mcdexLemma = await upgrades.deployProxy(MCDEXLemma, [AddressZero, liquidityPool.address, perpetualIndex, AddressZero, reBalancer.address], { initializer: 'initialize' });

        const collateralAddress = await this.mcdexLemma.collateral();
        const ERC20 = IERC20Factory.connect(collateralAddress, defaultSigner);//choose USDLemma ust because it follows IERC20 interface
        this.collateral = ERC20.attach(collateralAddress);//WETH
        const USDLemma = await ethers.getContractFactory("USDLemma");
        this.usdLemma = await upgrades.deployProxy(USDLemma, [AddressZero, collateralAddress, this.mcdexLemma.address], { initializer: 'initialize' });
        await this.mcdexLemma.setUSDLemma(this.usdLemma.address);

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
        await hasWETH.sendTransaction({ to: this.collateral.address, value: amountOfCollateralToMint });

        //add liquidity to the liquidity Pool
        const liquidityToAdd = utils.parseEther("10");
        await this.collateral.approve(liquidityPool.address, MaxUint256);
        await liquidityPool.addLiquidity(liquidityToAdd);

        //deposit the keeper gas reward
        await this.collateral.approve(this.mcdexLemma.address, keeperGasReward);
        await this.mcdexLemma.depositKeeperGasReward();

        //set stacking contract address
        await this.usdLemma.setStakingContractAddress(stackingContract.address);
        //set lemma treasury address
        await this.usdLemma.setLemmaTreasury(lemmaTreasury.address);

    });
    it("should initialize correctly", async function () {
        expect(await this.mcdexLemma.usdLemma()).to.equal(this.usdLemma.address);
        expect(await this.usdLemma.perpetualDEXWrappers("0", this.collateral.address)).to.equal(this.mcdexLemma.address);
    });

    it("should deposit correctly", async function () {
        const collateralBalanceBefore = await this.collateral.balanceOf(defaultSigner.address);
        const amount = utils.parseEther("1000");
        const collateralNeeded = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        await this.collateral.approve(this.usdLemma.address, collateralNeeded);
        await this.usdLemma.deposit(amount, 0, collateralNeeded, this.collateral.address);
        const collateralBalanceAfter = await this.collateral.balanceOf(defaultSigner.address);
        expect(collateralNeeded).to.equal(collateralBalanceBefore.sub(collateralBalanceAfter));
        expect(await this.usdLemma.balanceOf(defaultSigner.address)).to.equal(utils.parseEther("1000"));
    });
    it("should depositTo correctly", async function () {
        const collateralBalanceBefore = await this.collateral.balanceOf(defaultSigner.address);
        const amount = utils.parseEther("1000");
        const collateralNeeded = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        await this.collateral.approve(this.usdLemma.address, collateralNeeded);
        await this.usdLemma.depositTo(signer1.address, amount, 0, collateralNeeded, this.collateral.address);
        const collateralBalanceAfter = await this.collateral.balanceOf(defaultSigner.address);
        expect(collateralNeeded).to.equal(collateralBalanceBefore.sub(collateralBalanceAfter));
        expect(await this.usdLemma.balanceOf(signer1.address)).to.equal(utils.parseEther("1000"));
    });

    it("should withdraw correctly", async function () {
        const amount = utils.parseEther("1000");
        const collateralNeeded = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        await this.collateral.approve(this.usdLemma.address, collateralNeeded);
        await this.usdLemma.deposit(amount, 0, collateralNeeded, this.collateral.address);

        const collateralBalanceBefore = await this.collateral.balanceOf(defaultSigner.address);
        const collateralToGetBack = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
        await this.usdLemma.withdraw(amount, 0, collateralToGetBack, this.collateral.address);
        const collateralBalanceAfter = await this.collateral.balanceOf(defaultSigner.address);
        expect(collateralToGetBack).to.equal(collateralBalanceAfter.sub(collateralBalanceBefore));
        expect(await this.usdLemma.balanceOf(defaultSigner.address)).to.equal(ZERO);
    });

    it("should withdrawTo correctly", async function () {
        const amount = utils.parseEther("1000");
        const collateralNeeded = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        await this.collateral.approve(this.usdLemma.address, collateralNeeded);
        await this.usdLemma.deposit(amount, 0, collateralNeeded, this.collateral.address);

        const collateralBalanceBefore = await this.collateral.balanceOf(signer1.address);
        const collateralToGetBack = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
        await this.usdLemma.withdrawTo(signer1.address, amount, 0, collateralToGetBack, this.collateral.address);
        const collateralBalanceAfter = await this.collateral.balanceOf(signer1.address);
        expect(collateralToGetBack).to.equal(collateralBalanceAfter.sub(collateralBalanceBefore));
        expect(await this.usdLemma.balanceOf(defaultSigner.address)).to.equal(ZERO);
    });
    describe("re balance", async function () {
        beforeEach(async function () {
            const amount = utils.parseEther("1000");

            const collateralNeeded = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
            await this.collateral.approve(this.usdLemma.address, collateralNeeded);
            await this.usdLemma.deposit(amount, 0, MaxUint256, this.collateral.address);
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
            const perpetualInfo = liquidityPoolInfo.perpetuals.get(perpetualIndex);
            const marginChange = toBigNumber(unrealizedFundingPNL).negated();
            const feeRate = perpetualInfo.lpFeeRate.plus(liquidityPoolInfo.vaultFeeRate).plus(perpetualInfo.operatorFeeRate);
            const marginChangeWithFeesConsidered = marginChange.times(toBigNumber(utils.parseEther("1")).minus(feeRate));//0.07%
            const amountWithFeesConsidered = computeAMMTradeAmountByMargin(liquidityPoolInfo, perpetualIndex, marginChangeWithFeesConsidered);

            const limitPrice = amountWithFeesConsidered.isNegative() ? 0 : MaxInt256;
            const deadline = MaxUint256;
            await this.usdLemma.connect(reBalancer).reBalance(perpetualIndex, this.collateral.address, fromBigNumber(amountWithFeesConsidered), ethers.utils.defaultAbiCoder.encode(["int256", "uint256"], [limitPrice, deadline]));
            {
                await liquidityPool.forceToSyncState();
                const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
                const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
                const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
                //expect the leverage to be ~1
                expect(fromBigNumber(account.accountComputed.leverage)).to.be.closeTo(utils.parseEther("1"), 1e14);
            }
        });
    });

});