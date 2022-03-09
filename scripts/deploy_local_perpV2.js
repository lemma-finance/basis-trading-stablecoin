const hre = require("hardhat");
const { ethers, upgrades } = hre;
const { constants, BigNumber } = ethers;
const { utils } = require("ethers");
const { AddressZero, MaxInt256, MaxUint256 } = constants;
const { parseEther, parseUnits } = require("ethers/lib/utils");
const {
  displayNicely,
  tokenTransfers,
  loadPerpLushanInfoMainnet,
  toBigNumber,
  fromBigNumber,
  snapshot,
  revertToSnapshot,
} = require("../test/utils");
const {
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
} = require("@mcdex/mai3.js");
const fs = require("fs");
const SAVE_PREFIX = "./deployments/";
const SAVE_POSTFIX = "local.deployment.perp.js";
let deployedContracts = {};
const ZERO = BigNumber.from("0");
const bn = require("bignumber.js");
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

const ClearingHouseAbi = require("../perp-lushan/artifacts/contracts/test/TestClearingHouse.sol/TestClearingHouse.json");
const OrderBookAbi = require("../perp-lushan/artifacts/contracts/OrderBook.sol/OrderBook.json");
const ClearingHouseConfigAbi = require("../perp-lushan/artifacts/contracts/ClearingHouseConfig.sol/ClearingHouseConfig.json");
const VaultAbi = require("../perp-lushan/artifacts/contracts/Vault.sol/Vault.json");
const ExchangeAbi = require("../perp-lushan/artifacts/contracts/Exchange.sol/Exchange.json");
const MarketRegistryAbi = require("../perp-lushan/artifacts/contracts/MarketRegistry.sol/MarketRegistry.json");
const TestERC20Abi = require("../perp-lushan/artifacts/contracts/test/TestERC20.sol/TestERC20.json");
const BaseTokenAbi = require("../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json");
const BaseToken2Abi = require("../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json");
const QuoteTokenAbi = require("../perp-lushan/artifacts/contracts/QuoteToken.sol/QuoteToken.json");
const AccountBalanceAbi = require("../perp-lushan/artifacts/contracts/AccountBalance.sol/AccountBalance.json");
const MockTestAggregatorV3Abi = require("../perp-lushan/artifacts/contracts/mock/MockTestAggregatorV3.sol/MockTestAggregatorV3.json");
const UniswapV3PoolAbi = require("../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");
const UniswapV3Pool2Abi = require("../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");
const QuoterAbi = require("../perp-lushan/artifacts/@uniswap/v3-periphery/contracts/lens/Quoter.sol/Quoter.json");
const UniswapV3FactoryAbi = require("../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");

//add it in prod
// const TRUSTED_FORWARDER = {
//     42: "0xF82986F574803dfFd9609BE8b9c7B92f63a1410E",
// };
const printTx = async hash => {
  await tokenTransfers.print(hash, [], false);
};

const save = async () => {
  await fs.writeFileSync(SAVE_PREFIX + SAVE_POSTFIX, JSON.stringify(deployedContracts, null, 2));
};

function encodePriceSqrt(reserve1, reserve0) {
  return BigNumber.from(
    new bn(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString(),
  );
}

async function main() {
  let perpAddresses;
  perpAddresses = await loadPerpLushanInfoMainnet();

  let [defaultSigner, reBalancer, hasWETH, keeperGasReward, signer1, signer2, longAddress, lemmaTreasury] =
    await ethers.getSigners();
  clearingHouse = new ethers.Contract(perpAddresses.clearingHouse.address, ClearingHouseAbi.abi, defaultSigner);
  orderBook = new ethers.Contract(perpAddresses.orderBook.address, OrderBookAbi.abi, defaultSigner);
  clearingHouseConfig = new ethers.Contract(
    perpAddresses.clearingHouseConfig.address,
    ClearingHouseConfigAbi.abi,
    defaultSigner,
  );
  vault = new ethers.Contract(perpAddresses.vault.address, VaultAbi.abi, defaultSigner);
  exchange = new ethers.Contract(perpAddresses.exchange.address, ExchangeAbi.abi, defaultSigner);
  marketRegistry = new ethers.Contract(perpAddresses.marketRegistry.address, MarketRegistryAbi.abi, defaultSigner);
  collateral = new ethers.Contract(perpAddresses.ethCollateral.address, TestERC20Abi.abi, defaultSigner);
  baseToken = new ethers.Contract(perpAddresses.baseToken.address, BaseTokenAbi.abi, defaultSigner);
  baseToken2 = new ethers.Contract(perpAddresses.baseToken2.address, BaseToken2Abi.abi, defaultSigner);
  quoteToken = new ethers.Contract(perpAddresses.quoteToken.address, QuoteTokenAbi.abi, defaultSigner);
  univ3factory = new ethers.Contract(perpAddresses.univ3factory.address, UniswapV3FactoryAbi.abi, defaultSigner);
  accountBalance = new ethers.Contract(perpAddresses.accountBalance.address, AccountBalanceAbi.abi, defaultSigner);
  mockedBaseAggregator = new ethers.Contract(
    perpAddresses.mockedBaseAggregator.address,
    MockTestAggregatorV3Abi.abi,
    defaultSigner,
  );
  mockedBaseAggregator2 = new ethers.Contract(
    perpAddresses.mockedBaseAggregator2.address,
    MockTestAggregatorV3Abi.abi,
    defaultSigner,
  );
  pool = new ethers.Contract(perpAddresses.pool.address, UniswapV3PoolAbi.abi, defaultSigner);
  pool2 = new ethers.Contract(perpAddresses.pool2.address, UniswapV3Pool2Abi.abi, defaultSigner);
  quoter = new ethers.Contract(perpAddresses.quoter.address, QuoterAbi.abi, defaultSigner);
  collateralDecimals = await collateral.decimals();

  const maxPosition = ethers.constants.MaxUint256;
  const perpLemmaFactory = await ethers.getContractFactory("PerpLemma");
  perpLemma = await upgrades.deployProxy(
    perpLemmaFactory,
    [baseToken.address, quoteToken.address, clearingHouse.address, marketRegistry.address, AddressZero, maxPosition],
    { initializer: "initialize" },
  );
  await perpLemma.connect(signer1).resetApprovals();
  await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);

  // // console.log(hre.network);
  // const arbProvider = ethers.getDefaultProvider(hre.network.config.url);
  // const { chainId } = await arbProvider.getNetwork();

  await mockedBaseAggregator.setLatestRoundData(0, parseUnits("0.01", collateralDecimals), 0, 0, 0);
  // await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("100", collateralDecimals), 0, 0, 0)

  await pool.initialize(encodePriceSqrt("1", "100"));
  // the initial number of oracle can be recorded is 1; thus, have to expand it
  await pool.increaseObservationCardinalityNext((2 ^ 16) - 1);
  await pool2.initialize(encodePriceSqrt("1", "100")); // tick = 50200 (1.0001^50200 = 151.373306858723226652)

  await marketRegistry.addPool(baseToken.address, 10000);
  // await marketRegistry.addPool(baseToken2.address, 10000)
  await marketRegistry.setFeeRatio(baseToken.address, 10000);
  // await marketRegistry.setFeeRatio(baseToken2.address, 10000)

  // weth rich address 0xF977814e90dA44bFA03b6295A0616a897441aceC
  const amountOfCollateralToMint = utils.parseEther("2000");

  console.log("signer1: ", signer1.address);

  await signer1.sendTransaction({ to: collateral.address, value: amountOfCollateralToMint });
  await signer2.sendTransaction({ to: collateral.address, value: amountOfCollateralToMint });
  await longAddress.sendTransaction({ to: collateral.address, value: amountOfCollateralToMint });

  await collateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
  await collateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256);
  await collateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);

  await vault.connect(signer1).deposit(collateral.address, parseUnits("1000", collateralDecimals));
  await vault.connect(signer2).deposit(collateral.address, parseUnits("1000", collateralDecimals));
  await vault.connect(longAddress).deposit(collateral.address, parseUnits("1000", collateralDecimals));

  await clearingHouse.connect(signer2).addLiquidity({
    baseToken: baseToken.address,
    base: parseEther("10000"),
    quote: parseEther("100"),
    lowerTick: -887200, //50000,
    upperTick: 887200, //50400,
    minBase: 0,
    minQuote: 0,
    useTakerBalance: false,
    deadline: ethers.constants.MaxUint256,
  });

  collateralDecimals = await perpLemma.collateralDecimals();
  const collateralAddress = await perpLemma.collateral();
  // const ERC20 = IERC20Factory.connect(collateralAddress, defaultSigner);//choose USDLemma ust because it follows IERC20 interface
  // collateral = ERC20.attach(collateralAddress);//WETH
  // console.log("collateral", collateralAddress);

  const USDLemma = await ethers.getContractFactory("USDLemma");
  const usdLemma = await upgrades.deployProxy(USDLemma, [AddressZero, collateralAddress, perpLemma.address], {
    initializer: "initialize",
  });
  await perpLemma.setUSDLemma(usdLemma.address);

  //deploy stackingContract
  const XUSDL = await ethers.getContractFactory("xUSDL");
  const peripheryAddress = AddressZero;
  const xUSDL = await upgrades.deployProxy(XUSDL, [AddressZero, usdLemma.address, peripheryAddress], {
    initializer: "initialize",
  });
  console.log("xUSDL", xUSDL.address);
  console.log("USDLemma", await xUSDL.usdl());

  // //deposit keeper gas reward
  // //get some WETH first
  // //get the keeper gas reward

  // // const amountOfCollateralToMint = utils.parseEther("2000");
  // // await defaultSigner.sendTransaction({ to: collateral.address, value: amountOfCollateralToMint });
  // // await hasWETH.sendTransaction({ to: collateral.address, value: amountOfCollateralToMint });

  //set fees
  const fees = 3000; //30%
  await usdLemma.setFees(fees);
  //set stacking contract address
  await usdLemma.setStakingContractAddress(xUSDL.address);
  //set lemma treasury address
  await usdLemma.setLemmaTreasury(lemmaTreasury.address);

  deployedContracts["USDLemma"] = {
    name: "USDLemma",
    address: usdLemma.address,
  };

  deployedContracts["XUSDL"] = {
    name: "XUSDL",
    address: xUSDL.address,
  };

  deployedContracts["PerpLemma"] = {
    name: "PerpLemma",
    address: perpLemma.address,
  };
  deployedContracts = Object.assign(perpAddresses, deployedContracts);
  await save();
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
