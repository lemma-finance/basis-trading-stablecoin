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
} = require("../test/shared/utils");
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
  ethCollateral = new ethers.Contract(perpAddresses.ethCollateral.address, TestERC20Abi.abi, defaultSigner);
  usdCollateral = new ethers.Contract(perpAddresses.usdCollateral.address, TestERC20Abi.abi, defaultSigner);
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
  mockedWethPriceFeed = new ethers.Contract(
    perpAddresses.mockedWethPriceFeed.address,
    MockTestAggregatorV3Abi.abi,
    defaultSigner,
  );
  pool = new ethers.Contract(perpAddresses.pool.address, UniswapV3PoolAbi.abi, defaultSigner);
  pool2 = new ethers.Contract(perpAddresses.pool2.address, UniswapV3Pool2Abi.abi, defaultSigner);
  quoter = new ethers.Contract(perpAddresses.quoter.address, QuoterAbi.abi, defaultSigner);

  const maxPosition = ethers.constants.MaxUint256;
  const perpLemmaFactory = await ethers.getContractFactory("PerpLemma");
  perpLemma = await upgrades.deployProxy(
    perpLemmaFactory,
    [
      AddressZero,
      baseToken.address,
      clearingHouse.address,
      marketRegistry.address,
      AddressZero, // It is USDLemma contract address, it will set below by setUSDLemma
      maxPosition,
    ],
    { initializer: "initialize" },
  );
  collateralDecimals = await perpLemma.collateralDecimals(); // collateral decimal
  console.log('collateralDecimals: ', collateralDecimals.toString())
  await perpLemma.connect(signer1).resetApprovals();
  await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);

  // // console.log(hre.network);
  // const arbProvider = ethers.getDefaultProvider(hre.network.config.url);
  // const { chainId } = await arbProvider.getNetwork();

  await mockedBaseAggregator.setLatestRoundData(0, parseUnits("100", 6), 0, 0, 0);
  // await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("0.01", collateralDecimals), 0, 0, 0);
  await mockedWethPriceFeed.setLatestRoundData(0, parseUnits("100", 18), 0, 0, 0);

  await pool.initialize(encodePriceSqrt("100", "1"));
  await pool.increaseObservationCardinalityNext((2 ^ 16) - 1);

  await pool2.initialize(encodePriceSqrt("100", "1"));
  await pool2.increaseObservationCardinalityNext((2 ^ 16) - 1);

  await clearingHouseConfig.setMaxFundingRate(parseUnits("1", 6));

  await marketRegistry.addPool(baseToken.address, 10000);
  // await marketRegistry.addPool(baseToken2.address, 10000)
  await marketRegistry.setFeeRatio(baseToken.address, 10000);
  // await marketRegistry.setFeeRatio(baseToken2.address, 10000)
  await exchange.setMaxTickCrossedWithinBlock(baseToken.address, 887272 * 2);

  const usdcRichAddress = "0xCFFAd3200574698b78f32232aa9D63eABD290703";
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [usdcRichAddress],
  });
  let richUSDCSigner = await ethers.provider.getSigner(usdcRichAddress);

  // weth rich address 0xF977814e90dA44bFA03b6295A0616a897441aceC

  const amountOfCollateralToMint = parseUnits("20000000", collateralDecimals); // 6 decimal
  await usdCollateral.connect(richUSDCSigner).transfer(signer1.address, amountOfCollateralToMint);
  await usdCollateral.connect(richUSDCSigner).transfer(signer2.address, amountOfCollateralToMint);
  await usdCollateral.connect(richUSDCSigner).transfer(longAddress.address, amountOfCollateralToMint);

  await usdCollateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
  await usdCollateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256);
  await usdCollateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);

  await vault.connect(signer1).deposit(usdCollateral.address, parseUnits("100000", collateralDecimals));
  await vault.connect(signer2).deposit(usdCollateral.address, parseUnits("150000", collateralDecimals));
  await vault.connect(longAddress).deposit(usdCollateral.address, parseUnits("100000", collateralDecimals));

  console.log('Done')

  await clearingHouse.connect(signer2).addLiquidity({
    baseToken: baseToken.address,
    base: parseEther("1000"),
    quote: parseEther("100000"),
    lowerTick: -887200, //50000,
    upperTick: 887200, //50400,
    minBase: 0,
    minQuote: 0,
    useTakerBalance: false,
    deadline: ethers.constants.MaxUint256,
  });

  usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // mainnet address
  usdcWhaleAddress = "0x06601571AA9D3E8f5f7CDd5b993192618964bAB5";

  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [usdcWhaleAddress],
  });

  // const usdcWhale = await ethers.provider.getSigner(usdcWhaleAddress);
  // const depositSettlement = parseUnits("10000", 6); // usdc is settlement token
  // await usdCollateral.connect(usdcWhale).transfer(defaultSigner.address, depositSettlement);
  // await usdCollateral.connect(defaultSigner).approve(perpLemma.address, ethers.constants.MaxUint256);
  // await perpLemma.connect(defaultSigner).depositSettlementToken(depositSettlement);

  const LemmaETH = await ethers.getContractFactory("LemmaETH");
  const lemmaETH = await upgrades.deployProxy(LemmaETH, [AddressZero, usdCollateral.address, perpLemma.address], {
    initializer: "initialize",
  });
  await perpLemma.setUSDLemma(lemmaETH.address);

  //deploy stackingContract
  const XETHL = await ethers.getContractFactory("xETHL");
  const peripheryAddress = AddressZero;
  const xETHL = await upgrades.deployProxy(XETHL, [AddressZero, lemmaETH.address, peripheryAddress], {
    initializer: "initialize",
  });
  console.log("xETHL", xETHL.address);
  console.log("LemmaETH", await xETHL.usdl());

  // //deposit keeper gas reward
  // //get some WETH first
  // //get the keeper gas reward

  // // const amountOfCollateralToMint = utils.parseEther("2000");
  // // await defaultSigner.sendTransaction({ to: usdCollateral.address, value: amountOfCollateralToMint });
  // // await hasWETH.sendTransaction({ to: usdCollateral.address, value: amountOfCollateralToMint });

  //set fees
  const fees = 3000; //30%
  await lemmaETH.setFees(fees);
  //set stacking contract address
  await lemmaETH.setStakingContractAddress(xETHL.address);
  //set lemma treasury address
  await lemmaETH.setLemmaTreasury(lemmaTreasury.address);

  deployedContracts["LemmaETH"] = {
    name: "LemmaETH",
    address: lemmaETH.address,
  };

  deployedContracts["XETHL"] = {
    name: "XETHL",
    address: xETHL.address,
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
