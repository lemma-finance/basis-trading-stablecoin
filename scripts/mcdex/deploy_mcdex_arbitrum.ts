const hre = require("hardhat");
const { ethers, upgrades, network } = hre;
const { constants, BigNumber } = ethers;
import { utils } from "ethers";
const { AddressZero, MaxInt256, MaxUint256 } = constants;
import {
  displayNicely,
  loadMCDEXInfo,
  toBigNumber,
  fromBigNumber,
  snapshot,
  revertToSnapshot,
} from "../../test/shared/utils";
import {
  CHAIN_ID_TO_POOL_CREATOR_ADDRESS,
  PoolCreatorFactory,
  ReaderFactory,
  LiquidityPoolFactory,
  IERC20Factory,
  CHAIN_ID_TO_READER_ADDRESS,
  getLiquidityPool,
  getAccountStorage,
  computeAccount,
  normalizeBigNumberish,
  DECIMALS,
  computeAMMTrade,
  computeIncreasePosition,
  _0,
  _1,
  computeDecreasePosition,
  computeAMMTradeAmountByMargin,
} from "@mcdex/mai3.js";
import fs from "fs";
const SAVE_PREFIX = "./deployments/";
const SAVE_POSTFIX = "mainnet.deployment.js";

const ZERO = BigNumber.from("0");
// const printTx = async hash => {
//   await tokenTransfers.print(hash, [], false);
// };
const delay = ms => new Promise(res => setTimeout(res, ms));

let deployedContracts = {};

const save = async () => {
  await fs.writeFileSync(SAVE_PREFIX + SAVE_POSTFIX, JSON.stringify(deployedContracts, null, 2));
};

const opts = {
  // gasLimit: 1000000
};

const info = {
  arbitrumRinkebyTestnet: {
    trustedForwarder: "0x67454E169d613a8e9BA6b06af2D267696EAaAf41",
    lemmaTreasury: "0xa29bC5E0a0D12dc9928d0567cfabB258992346C6",
    liquidityPool: "0x95a8030ce95e40a97ecc50b04074c1d71977f23a",
  },
  arbitrumOneMainnet: {
    trustedForwarder: "0x6271ca63d30507f2dcbf99b52787032506d75bbf",
    lemmaTreasury: "0xa29bC5E0a0D12dc9928d0567cfabB258992346C6",
    liquidityPool: "0xc7b2ad78fded2bbc74b50dc1881ce0f81a7a0cca",
  },
};

async function main() {
  const addresses = info.arbitrumRinkebyTestnet;
  const maxPosition = utils.parseEther("2000000"); //20M
  const fees = 3000; //30%
  let [defaultSigner, reBalancer] = await ethers.getSigners();
  const trustedForwarder = addresses.trustedForwarder;
  const lemmaTreasury = addresses.lemmaTreasury;
  console.log("defaultSigner::", defaultSigner.address);
  // console.log(hre.network);
  const arbProvider = ethers.getDefaultProvider(network.config.url);
  const { chainId } = await arbProvider.getNetwork();

  const poolCreator = PoolCreatorFactory.connect(CHAIN_ID_TO_POOL_CREATOR_ADDRESS[chainId], arbProvider);
  const reader = ReaderFactory.connect(CHAIN_ID_TO_READER_ADDRESS[chainId], defaultSigner);
  console.log("poolCreatorAddress::", poolCreator.address);

  const poolCount = await poolCreator.getLiquidityPoolCount();
  console.log("poolCount", poolCount.toString());
  // const liquidityPools = await poolCreator.listLiquidityPools(ZERO, poolCount);

  // const liquidityPoolAddress = liquidityPools[0];//liquidityPool + perpetualIndex needs to be an inverse perpetual
  const liquidityPoolAddress = addresses.liquidityPool;
  const perpetualIndex = ZERO;
  const liquidityPool = LiquidityPoolFactory.connect(liquidityPoolAddress, defaultSigner);
  console.log("liquidity pool address", liquidityPool.address);

  //deploy mcdexLemma
  console.log(`Deploying MCDEXLemma`);
  const MCDEXLemma = await ethers.getContractFactory("MCDEXLemma");
  const mcdexLemma = await upgrades.deployProxy(
    MCDEXLemma,
    [trustedForwarder, liquidityPool.address, perpetualIndex, AddressZero, reBalancer.address, maxPosition],
    { initializer: "initialize" },
  );
  // console.log("mcdexLemma", mcdexLemma.address);
  // const mcdexLemma = MCDEXLemma.attach("0x3092eD676e1C59ee5Ab6Eb4Bf19a11BcA84D67bd");

  // await delay(60000);

  const collateralAddress = await mcdexLemma.collateral();
  console.log("collateralAddress", collateralAddress);

  //deploy USDLemma
  const USDLemma = await ethers.getContractFactory("USDLemma");
  const usdLemma = await upgrades.deployProxy(USDLemma, [trustedForwarder, collateralAddress, mcdexLemma.address], {
    initializer: "initialize",
  });
  // const usdLemma = USDLemma.attach("0xdb41ab644AbcA7f5ac579A5Cf2F41e606C2d6abc");
  console.log("USDL", usdLemma.address);
  // await delay(60000);
  //deploy stackingContract
  const peripheryContract = AddressZero;
  const XUSDL = await ethers.getContractFactory("xUSDL");
  const xUSDL = await upgrades.deployProxy(XUSDL, [trustedForwarder, usdLemma.address, peripheryContract], {
    initializer: "initialize",
  });
  // const xUSDL = XUSDL.attach("0x57c7E0D43C05bCe429ce030132Ca40F6FA5839d7");
  console.log("xUSDL", xUSDL.address);
  // await delay(60000);

  //setUSDLemma address in MCDEXLemma contract
  console.log(`Setting usdlemma`);
  let tx = await mcdexLemma.setUSDLemma(usdLemma.address, opts);
  await tx.wait();
  // await delay(60000);
  console.log("USDL", await mcdexLemma.usdLemma());

  //set Fees
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
  tx = await usdLemma.setLemmaTreasury(lemmaTreasury, opts);
  await tx.wait();
  // await delay(60000);
  //deposit keeper gas reward
  //get some WETH first
  //get the keeper gas reward
  const ERC20 = IERC20Factory.connect(collateralAddress, defaultSigner);
  const collateral = ERC20.attach(collateralAddress); //WETH

  const perpetualInfo = await liquidityPool.getPerpetualInfo(perpetualIndex);
  const nums = perpetualInfo.nums;
  const keeperGasReward = nums[11];
  console.log("keeperGasReward", keeperGasReward.toString());
  console.log("balance", (await collateral.balanceOf(defaultSigner.address)).toString());
  tx = await collateral.approve(mcdexLemma.address, keeperGasReward, opts);
  await tx.wait();

  // await delay(60000);
  tx = await defaultSigner.sendTransaction({ to: collateral.address, value: keeperGasReward });
  await tx.wait();
  // await delay(60000);
  tx = await mcdexLemma.depositKeeperGasReward(opts);
  await tx.wait();
  // await delay(60000);

  tx = await defaultSigner.sendTransaction({ to: collateral.address, value: ethers.utils.parseEther("0.1") }); //deposit ETH to WETH contract
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
  console.log("balance of USDL", (await usdLemma.balanceOf(defaultSigner.address)).toString());

  deployedContracts["USDLemma"] = {
    name: "USDLemma",
    address: usdLemma.address,
  };

  deployedContracts["XUSDL"] = {
    name: "XUSDL",
    address: xUSDL.address,
  };

  deployedContracts["MCDEXLemma"] = {
    name: "MCDEXLemma",
    address: mcdexLemma.address,
  };

  deployedContracts["WETH"] = {
    name: "WETH",
    address: collateralAddress,
  };

  await save();
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
