require('dotenv').config();
var colors = require('colors/safe');

const ethers = require("ethers");
const { BigNumber, constants, utils } = ethers;
const { MaxInt256, MaxUint256, AddressZero, MinInt256 } = constants;
const { toBigNumber, fromBigNumber, displayNicely } = require("./utils");


const USDLemmaArtifacts = require("./abis/USDLemma.json");
// const MCDEXLemmaArtifacts = require("./abis/MCDEXLemma.json");
const config = require("./config.json");

const { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS, getLiquidityPool, getAccountStorage, computeAccount, computeAMMTradeAmountByMargin } = require('@mcdex/mai3.js');

const addresses = config.optimism;

const ZERO = BigNumber.from("0");
// const getPerpetualIndex = async (mcdexLemma) => {
//     const perpetualIndex = await mcdexLemma.perpetualIndex();
//     return parseInt(perpetualIndex.toString());
// };
// const getDexIndex = async (collateralAddress) => {
//     //when there are multiple DEXes integrated and multiple collateral integrated
//     //this won't be as simple as returning the index from the user
//     const mcdexIndex = addresses.PerpetualDEXIndex;
//     return mcdexIndex;
// };
// const getMCDEXAddress = async (dexIndex, collateralAddress, usdLemma) => {
//     return await usdLemma.perpetualDEXWrappers(dexIndex, collateralAddress);
// };
const main = async (arbProvider, signer) => {
    const usdLemma = new ethers.Contract(addresses.USDLemma, USDLemmaArtifacts.abi, signer);
    console.log(usdLemma.address);
    const mcdexLemmaGeneral = new ethers.Contract(addresses.MCDEXLemma, MCDEXLemmaArtifacts.abi, signer);

    const collateralAddress = addresses.collateral;
    const dexIndex = await getDexIndex(collateralAddress);
    const mcdexLemmaAddress = await getMCDEXAddress(dexIndex, collateralAddress, usdLemma);
    const mcdexLemma = mcdexLemmaGeneral.attach(mcdexLemmaAddress);

    const { chainId } = await arbProvider.getNetwork();
    // console.log("chainId", chainId);
    const reBalancerAddress = await mcdexLemma.reBalancer();


    const poolCreator = PoolCreatorFactory.connect(CHAIN_ID_TO_POOL_CREATOR_ADDRESS[chainId], arbProvider);
    const reader = ReaderFactory.connect(CHAIN_ID_TO_READER_ADDRESS[chainId], signer);
    console.log("poolCreatorAddress", poolCreator.address);

    const poolCount = await poolCreator.getLiquidityPoolCount();
    console.log("poolCount", poolCount.toString());
    // const liquidityPoolAddress = liquidityPools[0];//liquidityPool + perpetualIndex needs to be an inverse perpetual
    const liquidityPoolAddress = await mcdexLemma.liquidityPool();
    const perpetualIndex = 0;
    console.log("perpetualIndex", await getDexIndex(collateralAddress));
    const liquidityPool = LiquidityPoolFactory.connect(liquidityPoolAddress, signer);
    console.log("liquidity pool address", liquidityPool.address);

    console.log("collateralAddress", collateralAddress);
    const collateral = IERC20Factory.connect(collateralAddress, arbProvider);

    const totalSupply = await usdLemma.totalSupply();
    console.log(totalSupply);
    console.log("totalSupply", toBigNumber(totalSupply.toString()).toString());

    console.log(colors.yellow('\nBasic Info from main Function:'));
    var printTable = [
        ["chainId", chainId],
        ["rebalancer", reBalancerAddress],
        ["signer", signer.address],
        ["poolCreatorAddress", poolCreator.address],
        ["poolCount", poolCount.toString()],
        ["perpetualIndex", await getDexIndex(collateralAddress)],
        ["liquidity pool address", liquidityPool.address],
        ["collateralAddress", collateralAddress],
        ["totalSupply", toBigNumber(totalSupply).toString()],
    ];
    console.table(printTable);

    {

        const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
        const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, mcdexLemma.address);
        const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
        //expect the leverage to be ~1
        displayNicely(account);
    }

    {
        const [reBalanceAmount, limitPrice, deadline] = await calcRebalanceAmount(perpetualIndex, mcdexLemma, reader, liquidityPool);
        if (reBalanceAmount.abs().gte(utils.parseEther(addresses.ReBalanceAmountLimit.toString()))) {
            console.log(colors.red("reBalancing"));
            // let ABI = ["function reBalance(uint256 perpetualDEXIndex, address collateral, int256 amount, bytes calldata data)"];
            // let iface = new ethers.utils.Interface(ABI);
            // const data = iface.encodeFunctionData("reBalance", [perpetualIndex, collateral.address, reBalanceAmount, ethers.utils.defaultAbiCoder.encode(["int256", "uint256"], [limitPrice, deadline])]);
            // await gnosisTx(arbProvider, signer, usdLemma.address, data);
            try {
                const estimation = await usdLemma.estimateGas.reBalance(perpetualIndex, collateral.address, reBalanceAmount, ethers.utils.defaultAbiCoder.encode(["int256", "uint256"], [limitPrice, deadline]));
                console.log("estimation", estimation);
                let tx = await usdLemma.reBalance(perpetualIndex, collateral.address, reBalanceAmount, ethers.utils.defaultAbiCoder.encode(["int256", "uint256"], [limitPrice, deadline]));
                await tx.wait();
            }
            catch (e) {
                console.log(e);
            }

        }
        else {
            console.log(colors.red("rebalance amount is too low"));
        }
    }

    {

        const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
        const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, mcdexLemma.address);
        const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
        //expect the leverage to be ~1
        displayNicely(account);
    }
};

const calcRebalanceAmount = async (perpetualIndex, mcdexLemma, reader, liquidityPool) => {
    console.log(colors.yellow("\ncalculating the rebalance amount"));

    const [fundingPNL, realizedFundingPNL] = await Promise.all([mcdexLemma.getFundingPNL(), mcdexLemma.realizedFundingPNL()]);
    const unrealizedFundingPNL = fundingPNL.sub(realizedFundingPNL);
    // console.log("unrealizedFundingPNL", unrealizedFundingPNL.toString());

    const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
    const perpetualInfo = liquidityPoolInfo.perpetuals.get(perpetualIndex);
    const marginChange = toBigNumber(unrealizedFundingPNL).negated();
    //consider referralRebate fee rebate as well
    const feeRate = liquidityPoolInfo.operator === AddressZero ? perpetualInfo.lpFeeRate.plus(liquidityPoolInfo.vaultFeeRate) : perpetualInfo.operatorFeeRate.plus(perpetualInfo.lpFeeRate).plus(liquidityPoolInfo.vaultFeeRate);
    const marginChangeWithFeesConsidered = marginChange.times(toBigNumber(utils.parseEther("1")).minus(feeRate));//0.07%
    const amountWithFeesConsidered = computeAMMTradeAmountByMargin(liquidityPoolInfo, perpetualIndex, marginChangeWithFeesConsidered);
    // console.log("amountWithFeesConsidered", amountWithFeesConsidered.toString());
    const reBalanceAmount = fromBigNumber(amountWithFeesConsidered);
    //let's queryTrade and compare the tradePrice we get + total fees 
    const res = await liquidityPool.callStatic.queryTrade(perpetualIndex, mcdexLemma.address, reBalanceAmount, AddressZero, 0);
    const totalCost = res.tradePrice.mul(reBalanceAmount).div(utils.parseEther("1")).add(res.totalFee);

    // console.log("totalCost", totalCost.toString());
    // console.log("unrealizedFundingPNL", unrealizedFundingPNL.toString());
    // console.log("fundingPNL", fundingPNL.toString());
    const difference = totalCost.abs().sub(unrealizedFundingPNL.abs());
    //is the difference <10^12?
    const isBelow12 = difference.lt(utils.parseUnits("10", 12));
    // console.log("isBelow12", isBelow12);
    //calc limit price and deadline
    const limitPrice = amountWithFeesConsidered.isNegative() ? 0 : MaxInt256;
    var currentTimestamp = new Date().getTime() / 1000;
    const deadline = Math.floor(currentTimestamp) + 120;// CurrentTimestamp + 2 mins
    console.log(deadline);

    console.log(colors.yellow('Basic Info from calcRebalanceAmount function:'));
    var printTable = [
        ["reBalanceAmount", utils.formatEther(reBalanceAmount.toString()).toString()],
        ["limitPrice", utils.formatEther(limitPrice).toString()],
        ["deadline", deadline.toString()],
        ["isBelow12", isBelow12]
    ];
    console.table(printTable);
    return [reBalanceAmount, limitPrice, deadline];
};
const data = {
    privateKey: process.env.PRIV_KEY,
    provider: process.env.PROVIDER,
};
function validateInput() {
    console.log(colors.yellow("Validating input from .env config file..."));
    if (data.privateKey === undefined || data.privateKey === '') {
        console.log(colors.red("Please define PRIV_KEY variable in .env"));
        process.exit(-1);
    }
    if (data.provider === undefined || data.provider === '') {
        console.log(colors.red("Please define PROVIDER variable in .env"));
        process.exit(-1);
    }
    console.log(colors.green('All inputs were successfully validated!'));
}
// (
//     async function startUp() {
//         console.log("startUp");
//         validateInput();
//         const arbProvider = ethers.getDefaultProvider(process.env.PROVIDER);
//         const signer = new ethers.Wallet(process.env.PRIV_KEY, arbProvider);

//         main(arbProvider, signer);
//         setInterval(() => {
//             main(arbProvider, signer);
//         }, 50000);
//     }
// )();
module.exports = { main };