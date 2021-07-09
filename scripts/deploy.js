const hre = require("hardhat");
const { ethers, upgrades } = hre;
const { constants, BigNumber } = ethers;
const { AddressZero } = constants;


const { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS, getLiquidityPool, computeAMMCloseAndOpenAmountWithPrice } = require('@mcdex/mai3.js');


const ZERO = BigNumber.from("0");
//add it in prod
// const TRUSTED_FORWARDER = {
//     42: "0xF82986F574803dfFd9609BE8b9c7B92f63a1410E",
// };
async function main() {
    [defaultSinger, reInvestor] = await ethers.getSigners();
    // console.log(defaultSinger);
    // console.log(hre.network);
    const arbProvider = ethers.getDefaultProvider(hre.network.config.url);
    const { chainId } = await arbProvider.getNetwork();

    // const chainId = 42;//kovan
    // const arbProvider = ethers.getDefaultProvider('https://kovan.infura.io/v3/2a1a54c3aa374385ae4531da66fdf150');


    const poolCreator = PoolCreatorFactory.connect(CHAIN_ID_TO_POOL_CREATOR_ADDRESS[chainId], arbProvider);
    reader = ReaderFactory.connect(CHAIN_ID_TO_READER_ADDRESS[chainId], defaultSinger);
    console.log("poolCreatorAddress", poolCreator.address);

    const poolCount = await poolCreator.getLiquidityPoolCount();
    console.log("poolCount", poolCount.toString());
    const liquidityPools = await poolCreator.listLiquidityPools(ZERO, poolCount);

    const liquidityPoolAddress = liquidityPools[0];
    const perpetualIndex = ZERO;
    const liquidityPool = LiquidityPoolFactory.connect(liquidityPoolAddress, defaultSinger);
    console.log("liquidity pool address", liquidityPool.address);


    //deploy mcdexLemma
    const MCDEXLemma = await ethers.getContractFactory("MCDEXLemma");
    const mcdexLemma = await upgrades.deployProxy(MCDEXLemma, [AddressZero, liquidityPool.address, perpetualIndex, AddressZero, reInvestor.address], { initializer: 'initialize' });
    console.log("mcdexLemma", mcdexLemma.address);

    const collateralAddress = await mcdexLemma.collateral();
    console.log("collateralAddress", collateralAddress);
    //deploy USDLemma
    const USDLemma = await ethers.getContractFactory("USDLemma");
    const usdLemma = await upgrades.deployProxy(USDLemma, [AddressZero, collateralAddress, mcdexLemma.address], { initializer: 'initialize' });
    console.log("USDL", usdLemma.address);

    let tx = await mcdexLemma.setUSDLemma(usdLemma.address);
    await tx.wait();

    console.log("USDL", await mcdexLemma.usdLemma());
}
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });