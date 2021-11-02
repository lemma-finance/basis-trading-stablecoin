const hre = require("hardhat");
const { ethers, upgrades } = hre;
const { constants, BigNumber } = ethers;
const { AddressZero } = constants;
const { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS, getLiquidityPool, computeAMMCloseAndOpenAmountWithPrice } = require('@mcdex/mai3.js');
const { tokenTransfers } = require("../test/utils");
const { MaxUint256 } = require("@ethersproject/constants");

const fs = require('fs');
const SAVE_PREFIX = "./deployments/";
const SAVE_POSTFIX = "mainnet.deployment.js";

const ZERO = BigNumber.from("0");
//add it in prod
// const TRUSTED_FORWARDER = {
//     42: "0xF82986F574803dfFd9609BE8b9c7B92f63a1410E",
// };
const printTx = async (hash) => {
    await tokenTransfers.print(hash, [], false);
};
const delay = ms => new Promise(res => setTimeout(res, ms));

let deployedContracts = {};

const save = async () => {
    await fs.writeFileSync(SAVE_PREFIX + SAVE_POSTFIX, JSON.stringify(deployedContracts, null, 2));
};

const opts = { gasLimit: 1000000 };

async function main() {
    [defaultSigner, reBalancer, lemmaTreasury, trustedForwarder] = await ethers.getSigners();
    trustedForwarder = {
        address: "0x67454E169d613a8e9BA6b06af2D267696EAaAf41"
    }
    lemmaTreasury = {
        address: "0x67454E169d613a8e9BA6b06af2D267696EAaAf41"
    }
    console.log("defaultSigner::", defaultSigner.address);
    // console.log(hre.network);
    const arbProvider = ethers.getDefaultProvider(hre.network.config.url);
    const { chainId } = await arbProvider.getNetwork();

    // const chainId = 42;//kovan
    // const arbProvider = ethers.getDefaultProvider('https://kovan.infura.io/v3/2a1a54c3aa374385ae4531da66fdf150');


    const poolCreator = PoolCreatorFactory.connect(CHAIN_ID_TO_POOL_CREATOR_ADDRESS[chainId], arbProvider);
    reader = ReaderFactory.connect(CHAIN_ID_TO_READER_ADDRESS[chainId], defaultSigner);
    console.log("poolCreatorAddress::", poolCreator.address);

    const poolCount = await poolCreator.getLiquidityPoolCount();
    console.log("poolCount", poolCount.toString());
    // const liquidityPools = await poolCreator.listLiquidityPools(ZERO, poolCount);

    // const liquidityPoolAddress = liquidityPools[0];//liquidityPool + perpetualIndex needs to be an inverse perpetual
    const liquidityPoolAddress = "0x95a8030ce95e40a97ecc50b04074c1d71977f23a";
    const perpetualIndex = ZERO;
    const liquidityPool = LiquidityPoolFactory.connect(liquidityPoolAddress, defaultSigner);
    console.log("liquidity pool address", liquidityPool.address);


    //deploy mcdexLemma
    console.log(`Deploying MCDEXLemma`);
    const maxPosition = MaxUint256;
    const MCDEXLemma = await ethers.getContractFactory("MCDEXLemma");
    const mcdexLemma = await upgrades.deployProxy(MCDEXLemma, [trustedForwarder.address, liquidityPool.address, perpetualIndex, AddressZero, defaultSigner.address, maxPosition], { initializer: 'initialize' });
    console.log("mcdexLemma", mcdexLemma.address);

    // await delay(60000);

    const collateralAddress = await mcdexLemma.collateral();
    console.log("collateralAddress", collateralAddress);
    //deploy USDLemma
    const USDLemma = await ethers.getContractFactory("USDLemma");
    const usdLemma = await upgrades.deployProxy(USDLemma, [trustedForwarder.address, collateralAddress, mcdexLemma.address], { initializer: 'initialize' });
    console.log("USDL", usdLemma.address);
    // await delay(60000);
    //deploy stackingContract
    const peripheryContract = AddressZero;
    const XUSDL = await ethers.getContractFactory("xUSDL");
    const xUSDL = await upgrades.deployProxy(XUSDL, [trustedForwarder.address, usdLemma.address, peripheryContract], { initializer: 'initialize' });
    console.log("xUSDL", xUSDL.address);
    // await delay(60000);

    //setUSDLemma address in MCDEXLemma contract
    console.log(`Setting usdlemma`);
    let tx = await mcdexLemma.setUSDLemma(usdLemma.address, opts);
    await tx.wait();
    // await delay(60000);
    console.log("USDL", await mcdexLemma.usdLemma());

    //set Fees
    const fees = 3000;//30%
    console.log(`Setting fees`);
    tx = await usdLemma.setFees(fees, opts);
    await tx.wait();
    // await delay(60000);
    //set stacking contract address
    console.log(`Setting staking contract`);
    tx = await usdLemma.setStakingContractAddress(xUSDL.address, opts);
    await tx.wait();
    // await delay(60000);

    //set lemma treasury address
    console.log(`Setting lemma treasury`);
    tx = await usdLemma.setLemmaTreasury(trustedForwarder.address, opts);
    await tx.wait();
    // await delay(60000);
    //deposit keeper gas reward
    //get some WETH first
    //get the keeper gas reward
    const ERC20 = IERC20Factory.connect(collateralAddress, defaultSigner);
    const collateral = ERC20.attach(collateralAddress);//WETH

    const perpetualInfo = await liquidityPool.getPerpetualInfo(perpetualIndex);
    const nums = perpetualInfo.nums;
    const keeperGasReward = nums[11];
    console.log("keeperGasReward", keeperGasReward.toString());
    tx = await collateral.approve(mcdexLemma.address, keeperGasReward, opts);
    await tx.wait();
    // await delay(60000);
    tx = await defaultSigner.sendTransaction({ to: collateral.address, value: keeperGasReward });
    await tx.wait();
    // await delay(60000);
    tx = await mcdexLemma.depositKeeperGasReward(opts);
    await tx.wait();
    // await delay(60000);

    tx = await defaultSigner.sendTransaction({ to: collateral.address, value: ethers.utils.parseEther("0.1") });//deposit ETH to WETH contract
    await tx.wait();
    // await delay(60000);
    console.log("balance", (await collateral.balanceOf(defaultSigner.address)).toString());
    tx = await collateral.approve(usdLemma.address, MaxUint256, opts);
    await tx.wait();
    // await delay(60000);
    console.log("depositing");
    tx = await usdLemma.deposit(ethers.utils.parseEther("100"), 0, MaxUint256, collateral.address, opts);
    await tx.wait();
    // await delay(60000);
    await printTx(tx.hash);
    console.log("balance of USDL", (await usdLemma.balanceOf(defaultSigner.address)).toString());

    deployedContracts['USDLemma'] = {
        name: 'USDLemma',
        address: usdLemma.address
    };

    deployedContracts['XUSDL'] = {
        name: 'XUSDL',
        address: xUSDL.address
    };

    deployedContracts['MCDEXLemma'] = {
        name: 'MCDEXLemma',
        address: mcdexLemma.address
    };

    deployedContracts['WETH'] = {
        name: 'WETH',
        address: collateralAddress
    }

    await save();
    
}
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });