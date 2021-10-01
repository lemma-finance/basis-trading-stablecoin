const hre = require("hardhat");
const { ethers, upgrades } = hre;
const { constants, BigNumber } = ethers;
const { utils } = require('ethers');
const { AddressZero } = constants;
const { displayNicely, tokenTransfers, loadMCDEXInfo, toBigNumber, fromBigNumber, snapshot, revertToSnapshot } = require("../test/utils");
const { MaxUint256 } = require("@ethersproject/constants");
const { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS, getLiquidityPool, getAccountStorage, computeAccount, normalizeBigNumberish, DECIMALS, computeAMMTrade, computeIncreasePosition, _0, _1, computeDecreasePosition, computeAMMTradeAmountByMargin } = require('@mcdex/mai3.js');
const fs = require('fs');
const SAVE_PREFIX = "./deployments/";
const SAVE_POSTFIX = "local.deployment.js";
let deployedContracts = {};
const ZERO = BigNumber.from("0");
//add it in prod
// const TRUSTED_FORWARDER = {
//     42: "0xF82986F574803dfFd9609BE8b9c7B92f63a1410E",
// };
const printTx = async (hash) => {
    await tokenTransfers.print(hash, [], false);
};



const save = async () => {
    await fs.writeFileSync(SAVE_PREFIX + SAVE_POSTFIX, JSON.stringify(deployedContracts, null, 2));
};


async function main() {

    let reBalancer, trustedForwarder, hasWETH, keeperGasReward, lemmaTreasury, signer1, signer2;

    let liquidityPool, reader, mcdexAddresses;
    const perpetualIndex = 0; //in Kovan the 0th perp for 0th liquidity pool = inverse ETH-USD
    const provider = ethers.provider;
    const ZERO = BigNumber.from("0");
    mcdexAddresses = await loadMCDEXInfo();

    [defaultSigner, reBalancer, hasWETH, lemmaTreasury, trustedForwarder, signer1, signer2] = await ethers.getSigners();
    console.log("defaultSigner", defaultSigner.address);
    // console.log(hre.network);
    const arbProvider = ethers.getDefaultProvider(hre.network.config.url);
    const { chainId } = await arbProvider.getNetwork();

    // const chainId = 42;//kovan
    // const arbProvider = ethers.getDefaultProvider('https://kovan.infura.io/v3/2a1a54c3aa374385ae4531da66fdf150');


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
    const mcdexLemma = await upgrades.deployProxy(MCDEXLemma, [AddressZero, liquidityPool.address, perpetualIndex, AddressZero, reBalancer.address], { initializer: 'initialize' });
    const collateralDecimals = await mcdexLemma.collateralDecimals();
    const collateralAddress = await mcdexLemma.collateral();
    const ERC20 = IERC20Factory.connect(collateralAddress, defaultSigner);//choose USDLemma ust because it follows IERC20 interface
    const collateral = ERC20.attach(collateralAddress);//WETH
    const USDLemma = await ethers.getContractFactory("USDLemma");
    console.log("mcdexLemma", mcdexLemma.address);
    const usdLemma = await upgrades.deployProxy(USDLemma, [AddressZero, collateralAddress, mcdexLemma.address], { initializer: 'initialize' });
    await mcdexLemma.setUSDLemma(usdLemma.address);
    console.log("mcdexLemma", await usdLemma.perpetualDEXWrappers("0", collateral.address));

    //deploy stackingContract
    const XUSDL = await ethers.getContractFactory("xUSDL");
    const peripheryAddress = AddressZero;
    const xUSDL = await upgrades.deployProxy(XUSDL, [AddressZero, usdLemma.address, peripheryAddress], { initializer: 'initialize' });
    console.log("xUSDL", xUSDL.address);
    console.log("USDLemma", xUSDL.usdl());

    //deposit keeper gas reward
    //get some WETH first
    //get the keeper gas reward

    const amountOfCollateralToMint = utils.parseEther("100");

    await defaultSigner.sendTransaction({ to: collateral.address, value: amountOfCollateralToMint });
    await hasWETH.sendTransaction({ to: collateral.address, value: amountOfCollateralToMint });

    //add liquidity to the liquidity Pool
    const liquidityToAdd = utils.parseEther("10");
    await collateral.approve(liquidityPool.address, MaxUint256);
    await liquidityPool.addLiquidity(liquidityToAdd);

    //deposit the keeper gas reward
    await collateral.approve(mcdexLemma.address, keeperGasReward);
    await mcdexLemma.depositKeeperGasReward();


    //set fees
    const fees = 3000;//30%
    await usdLemma.setFees(fees);
    //set stacking contract address
    await usdLemma.setStakingContractAddress(xUSDL.address);
    //set lemma treasury address
    await usdLemma.setLemmaTreasury(lemmaTreasury.address);

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

    deployedContracts = Object.assign(mcdexAddresses, deployedContracts);

    await save();

}
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });