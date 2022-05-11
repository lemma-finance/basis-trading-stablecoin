import { ethers, upgrades, network } from "hardhat";
import { BigNumber, constants } from "ethers";
const { AddressZero, MaxUint256, MaxInt256 } = constants;
import {
  loadMCDEXInfo,
} from "./utils";
import {
  PoolCreatorFactory,
  ReaderFactory,
  LiquidityPoolFactory,
  IERC20Factory,
  _0,
  _1,
} from "@mcdex/mai3.js";
import { MCDEXLemma } from "../../types/MCDEXLemma";
import { LemmaETH } from "../../types/LemmaETH";

interface EthlFixture {
  mcdexLemma: MCDEXLemma;
  lemmaEth: LemmaETH;
  reader: ReaderFactory;
  liquidityPool: LiquidityPoolFactory;
  collateral: IERC20Factory;
  oracleAdaptorAddress: string;
}

// caller of this function should ensure that (base, quote) = (token0, token1) is always true
export function createEthlFixture(canMockTime: boolean = true): () => Promise<EthlFixture> {
  return async (): Promise<EthlFixture> => {
    let defaultSigner, reBalancer, hasWETH, keeperGasReward, stackingContract, lemmaTreasury, signer1, signer2;
    const perpetualIndex = 0; //in Kovan the 0th perp for 0th liquidity pool = inverse ETH-USD
    const ZERO = BigNumber.from("0");
    let liquidityPool, reader, mcdexAddresses;
    let collateralDecimals;
    let mcdexLemma: any;
    let lemmaEth: any;
    let collateral: any;

    mcdexAddresses = await loadMCDEXInfo();
    [defaultSigner, reBalancer, hasWETH, stackingContract, lemmaTreasury, signer1, signer2] = await ethers.getSigners();
    const poolCreatorAddress = mcdexAddresses.PoolCreator.address;
    const readerAddress = mcdexAddresses.Reader.address;
    const oracleAdaptorAddress = mcdexAddresses.OracleAdaptor.address;
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
    mcdexLemma = await upgrades.deployProxy(
      MCDEXLemma,
      [AddressZero, liquidityPool.address, perpetualIndex, AddressZero, reBalancer.address, maxPosition],
      { initializer: "initialize" },
    );
    collateralDecimals = await mcdexLemma.collateralDecimals();
    const collateralAddress = await mcdexLemma.collateral();
    const ERC20 = IERC20Factory.connect(collateralAddress, defaultSigner); //choose LemmaETH ust because it follows IERC20 interface
    collateral = ERC20.attach(collateralAddress); //WETH
    const LemmaETH = await ethers.getContractFactory("LemmaETH");
    lemmaEth = await upgrades.deployProxy(LemmaETH, [AddressZero, collateralAddress, mcdexLemma.address], {
      initializer: "initialize",
    });
    await mcdexLemma.setUSDLemma(lemmaEth.address);

    return {
      mcdexLemma,
      lemmaEth,
      reader,
      liquidityPool,
      collateral,
      oracleAdaptorAddress,
    };
  };
}
