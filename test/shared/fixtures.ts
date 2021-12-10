import { ethers, upgrades, network} from "hardhat"
import { JsonRpcProvider } from '@ethersproject/providers';
import { expect } from "chai"
import { BigNumber, constants } from "ethers";
const { AddressZero, MaxUint256, MaxInt256 } = constants;
import  { displayNicely, 
    // tokenTransfers, 
    loadMCDEXInfo, toBigNumber, fromBigNumber, snapshot, revertToSnapshot } from "./utils";
import { CHAIN_ID_TO_POOL_CREATOR_ADDRESS, PoolCreatorFactory, ReaderFactory, LiquidityPoolFactory, IERC20Factory, CHAIN_ID_TO_READER_ADDRESS, getLiquidityPool, getAccountStorage, computeAccount, normalizeBigNumberish, DECIMALS, computeAMMTrade, computeIncreasePosition, _0, _1, computeDecreasePosition, computeAMMTradeAmountByMargin } from '@mcdex/mai3.js';
import { MCDEXLemma, USDLemma } from "../../types";
import hre from "hardhat";
const arbProvider = new JsonRpcProvider(hre.waffle.provider.connection.url);

interface UsdlFixture {
    mcdexLemma: MCDEXLemma
    usdLemma: USDLemma
    reader: ReaderFactory
    liquidityPool: LiquidityPoolFactory
    collateral: IERC20Factory
}

// caller of this function should ensure that (base, quote) = (token0, token1) is always true
export function createUsdlFixture(canMockTime: boolean = true): () => Promise<UsdlFixture> {
    return async (): Promise<UsdlFixture> => {
        let defaultSigner, reBalancer, hasWETH, keeperGasReward, stackingContract, lemmaTreasury, signer1, signer2;
        const perpetualIndex = 0; //in Kovan the 0th perp for 0th liquidity pool = inverse ETH-USD
        const provider = ethers.provider;
        const ZERO = BigNumber.from("0");
        let snapshotId;
        let liquidityPool, reader, mcdexAddresses;
        let collateralDecimals;
        let mcdexLemma: any
        let usdLemma: any
        let collateral: any

        mcdexAddresses = await loadMCDEXInfo();
        [defaultSigner, reBalancer, hasWETH, stackingContract, lemmaTreasury, signer1, signer2] = await ethers.getSigners();

        console.log('defaultSigner: ', defaultSigner.address)

        const poolCreatorAddress = mcdexAddresses.PoolCreator.address;
        const readerAddress = mcdexAddresses.Reader.address;

        console.log('poolCreatorAddress: ', poolCreatorAddress)

        const poolCreator = PoolCreatorFactory.connect(poolCreatorAddress, defaultSigner);
        reader = ReaderFactory.connect(readerAddress, defaultSigner);
        const poolCount = await poolCreator.getLiquidityPoolCount();
        const liquidityPools = await poolCreator.listLiquidityPools(ZERO, poolCount);
        const liquidityPoolAddress = liquidityPools[0];
        liquidityPool = LiquidityPoolFactory.connect(liquidityPoolAddress, defaultSigner);
        const perpetualInfo = await liquidityPool.getPerpetualInfo(perpetualIndex);
        const nums = perpetualInfo.nums;
        keeperGasReward = nums[11];

        //deploy mcdexLemma
        const maxPosition = MaxUint256;
        const MCDEXLemma = await ethers.getContractFactory("MCDEXLemma");
        mcdexLemma = await upgrades.deployProxy(MCDEXLemma, [AddressZero, liquidityPool.address, perpetualIndex, AddressZero, reBalancer.address, maxPosition], { initializer: 'initialize' });
        collateralDecimals = await mcdexLemma.collateralDecimals();
        const collateralAddress = await mcdexLemma.collateral();
        const ERC20 = IERC20Factory.connect(collateralAddress, defaultSigner);//choose USDLemma ust because it follows IERC20 interface
        collateral = ERC20.attach(collateralAddress);//WETH
        const USDLemma = await ethers.getContractFactory("USDLemma");
        usdLemma = await upgrades.deployProxy(USDLemma, [AddressZero, collateralAddress, mcdexLemma.address], { initializer: 'initialize' });
        await mcdexLemma.setUSDLemma(usdLemma.address);

        return {
            mcdexLemma,
            usdLemma,
            reader,
            liquidityPool,
            collateral
        }
    }
}
