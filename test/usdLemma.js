const { JsonRpcProvider } = require('@ethersproject/providers');
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS, getLiquidityPool, computeAccount, getAccountStorage, _2, computeIncreasePosition } = require('@mcdex/mai3.js');
const { utils } = require('ethers');
const { BigNumber, constants } = ethers;
const { AddressZero, MaxUint256 } = constants;
const mcdexAddresses = require("../mai-protocol-v3/deployments/local.deployment.json");
var colors = require('colors');


const chainId = 42;//kovan
// const arbProvider = new JsonRpcProvider('https://kovan.infura.io/v3/2a1a54c3aa374385ae4531da66fdf150');
const arbProvider = new JsonRpcProvider(hre.network.url);

// const chainId = 421611; //rinkeby arbitrum
// const arbProvider = new JsonRpcProvider('https://rinkeby.arbitrum.io/rpc');
const approveMAX = async (erc20, signer, to, amount) => {
    if ((await erc20.allowance(signer.address, to)).lt(amount)) {
        let tx = await erc20.connect(signer).approve(to, MaxUint256);
        await tx.wait();
    }
};
const balanceOf = async (erc20, userAddress) => {
    return await erc20.balanceOf(userAddress);
};

const displayNicely = function (Obj) {
    colors.setTheme({
        key: 'bgGreen',
        value: 'cyan',
    });
    Object.keys(Obj).forEach(function (key) {
        const value = Obj[key];
        let showValue = value;
        if (value == null) {
            console.log(`${key.bgGreen} : ${showValue}`);
        }
        else if (BigNumber.isBigNumber(value)) {
            showValue = value.toString();
        }
        else if (typeof value === 'object') {
            console.log("\n");
            console.log(key);
            displayNicely(value);
            showValue = null;
        }
        if (showValue !== null) {
            console.log(`${key.bgGreen} : ${showValue}`);
        }
    });
};
describe("mcdexLemma", function () {

    let reInvestor, hasWETH, keeperGasReward;
    //reInvestor = reBalancer
    let liquidityPool, reader;
    const perpetualIndex = 0; //in Kovan the 0th perp for 0th liquidity pool = inverse ETH-USD
    const provider = ethers.provider;
    const ZERO = BigNumber.from("0");

    const calcLeverage = async function (traderAddress) {
        const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
        const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, traderAddress);
        const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
        return account.accountComputed.leverage;
    };

    beforeEach(async function () {
        [defaultSinger, reInvestor, hasWETH] = await ethers.getSigners();
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
        this.mcdexLemma = await upgrades.deployProxy(MCDEXLemma, [AddressZero, liquidityPool.address, perpetualIndex, AddressZero, reInvestor.address], { initializer: 'initialize' });

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

        {
            const accountsResult = await reader.callStatic.getAccountStorage(liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
            const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
            const perpetualInfo = liquidityPoolInfo.perpetuals.get(perpetualIndex);

            console.log("fundingRate", perpetualInfo.fundingRate.toString());
            console.log("unitAccumulativeFunding", perpetualInfo.unitAccumulativeFunding.toString());

            ///need to use .callStatic as to explicitly tell to node that it is not a state changing transaction and return the result (We have to do this because the reader contract implements this method without making it a "view" method even though it is)

            console.log(accountsResult.toString());
        }
    });

    it("should initialize correctly", async function () {
        expect(await this.mcdexLemma.usdLemma()).to.equal(this.usdLemma.address);
        console.log(await this.usdLemma.perpetualDEXWrappers("0", this.collateral.address));
        expect(await this.usdLemma.perpetualDEXWrappers("0", this.collateral.address)).to.equal(this.mcdexLemma.address);
    });
    it("should deposit correctly", async function () {
        const collateralAddress = this.collateral.address;
        const amount = utils.parseEther("1000");//amount of USDL to mint

        const collateralBalanceBefore = await this.collateral.balanceOf(defaultSinger.address);
        const collateralRequired = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        if (keeperGasReward.add(collateralRequired).gt(collateralBalanceBefore)) {
            throw new Error('not enough collateral balance');
        }
        //deposit keeper Gas reward
        console.log("owner", await this.mcdexLemma.owner());
        console.log("defaultSinger", defaultSinger.address);
        console.log("depositing keeper gas reward");
        if ((await this.collateral.allowance(defaultSinger.address, this.mcdexLemma.address)).lt(keeperGasReward)) {
            let tx = await this.collateral.approve(this.mcdexLemma.address, MaxUint256);
            await tx.wait();
        }
        tx = await this.mcdexLemma.depositKeeperGasReward();
        await tx.wait();


        console.log("collateral required", collateralRequired.toString());
        console.log("mcdex collateral Balance Before", (await balanceOf(this.collateral, this.mcdexLemma.address)).toString());
        console.log("collateral Balance Before", (await this.collateral.balanceOf(defaultSinger.address)).toString());

        if ((await this.collateral.allowance(defaultSinger.address, this.usdLemma.address)).lt(amount)) {
            let tx = await this.collateral.approve(this.usdLemma.address, MaxUint256);
            await tx.wait();
        }
        const collateralBalanceBeforeDepositing = await balanceOf(this.collateral, defaultSinger.address);

        if (collateralBalanceBeforeDepositing.lt(collateralRequired)) {
            throw new Error("not enough collateral");
        }

        await hre.network.provider.request({
            method: "evm_increaseTime",
            params: [3600]
        }
        );

        await hre.network.provider.request({
            method: "evm_mine",
            params: []
        }
        );


        const liquidityPoolInfoAtStart = await getLiquidityPool(reader, liquidityPool.address);
        const traderInfoAtStart = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        const accountAtStart = computeAccount(liquidityPoolInfoAtStart, perpetualIndex, traderInfoAtStart);

        displayNicely(accountAtStart);

        //increase position by amount with price = collateralRequired / amount
        const price = collateralRequired.mul(utils.parseEther("1")).div(amount);
        console.log("price", price.toString());

        const accountAfterIncreasingPosition = computeIncreasePosition(liquidityPoolInfoAtStart, perpetualIndex, accountAtStart, price, amount);

        console.log("account increased artificially");
        displayNicely(accountAfterIncreasingPosition);





        await liquidityPool.forceToSyncState();

        tx = await this.usdLemma.deposit(amount, ZERO, collateralRequired, collateralAddress);
        await tx.wait();
        const collateralBalanceAfter = await balanceOf(this.collateral, defaultSinger.address);

        expect(collateralBalanceBeforeDepositing.sub(collateralBalanceAfter)).to.equal(collateralRequired);
        expect(await balanceOf(this.collateral, this.mcdexLemma.address)).to.equal(ZERO);

        expect(await balanceOf(this.usdLemma, defaultSinger.address)).to.equal(amount);


        //calculate the leverage of mcdexLemma
        //should be 1
        // for (let i = 0; i < 2; i++) {
        //open a trade on the opposite side of above so that we do not have to deal with the changed prices
        //approve max collateral to the liquidityPool address
        await approveMAX(this.collateral, defaultSinger, liquidityPool.address, MaxUint256);
        await liquidityPool.deposit(perpetualIndex, defaultSinger.address, collateralRequired);
        await liquidityPool.trade(
            perpetualIndex,
            defaultSinger.address,
            utils.parseEther("-1000"), //the negative of the trade made by mcdexLemma
            0,
            MaxUint256,
            AddressZero,
            0
        );

        const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
        const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
        const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);

        displayNicely(account);


        //     tx = await this.usdLemma.deposit(amount, ZERO, MaxUint256, collateralAddress);
        //     await tx.wait();
        // }
    });

});