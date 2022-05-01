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
  wbtcWhaleAddress = "0xE78388b4CE79068e89Bf8aA7f218eF6b9AB0e9d0";
  wbtc = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
  wbtcSigner = await ethers.provider.getSigner(wbtcWhaleAddress);
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [wbtcWhaleAddress],
  });

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
  btcCollateral = new ethers.Contract(perpAddresses.btcCollateral.address, TestERC20Abi.abi, defaultSigner);
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
  mockedWbtcPriceFeed = new ethers.Contract(
    perpAddresses.mockedWbtcPriceFeed.address,
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
      btcCollateral.address,
      baseToken.address,
      clearingHouse.address,
      marketRegistry.address,
      AddressZero, // It is USDLemma contract address, it will set below by setUSDLemma
      maxPosition,
    ],
    { initializer: "initialize" },
  );
  btcCollateralDecimals = await perpLemma.collateralDecimals(); // collateral decimal
  await perpLemma.connect(signer1).resetApprovals();
  await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);

  // // console.log(hre.network);
  // const arbProvider = ethers.getDefaultProvider(hre.network.config.url);
  // const { chainId } = await arbProvider.getNetwork();

  await mockedBaseAggregator.setLatestRoundData(0, parseUnits("100", 6), 0, 0, 0);
  await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("0.01", 18), 0, 0, 0);
  await mockedWethPriceFeed.setLatestRoundData(0, parseUnits("100", 18), 0, 0, 0);
  await mockedWbtcPriceFeed.setLatestRoundData(0, parseUnits("100", 18), 0, 0, 0);

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

  // weth rich address 0xF977814e90dA44bFA03b6295A0616a897441aceC
  const amountOfCollateralToMint = utils.parseUnits("2000", btcCollateralDecimals);

  // await signer1.sendTransaction({ to: btcCollateral.address, value: amountOfCollateralToMint });
  // await signer2.sendTransaction({ to: btcCollateral.address, value: amountOfCollateralToMint });
  // await longAddress.sendTransaction({ to: btcCollateral.address, value: amountOfCollateralToMint });

  await btcCollateral.connect(wbtcSigner).transfer(signer1.address, amountOfCollateralToMint);
  await btcCollateral.connect(wbtcSigner).transfer(signer2.address, amountOfCollateralToMint);
  await btcCollateral.connect(wbtcSigner).transfer(longAddress.address, amountOfCollateralToMint);

  await btcCollateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
  await btcCollateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256);
  await btcCollateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);

  await vault.connect(signer1).deposit(btcCollateral.address, parseUnits("1000", btcCollateralDecimals));
  await vault.connect(signer2).deposit(btcCollateral.address, parseUnits("1500", btcCollateralDecimals));
  await vault.connect(longAddress).deposit(btcCollateral.address, parseUnits("1000", btcCollateralDecimals));

  await clearingHouse.connect(signer2).addLiquidity({
    baseToken: baseToken.address,
    base: parseEther("750"),
    quote: parseEther("75000"),
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

  const usdcWhale = await ethers.provider.getSigner(usdcWhaleAddress);
  const depositSettlement = parseUnits("50000", 6); // usdc is settlement token
  await usdCollateral.connect(usdcWhale).transfer(defaultSigner.address, depositSettlement);
  await usdCollateral.connect(defaultSigner).approve(perpLemma.address, ethers.constants.MaxUint256);
  await perpLemma.connect(defaultSigner).depositSettlementToken(depositSettlement);

  const USDLemma = await ethers.getContractFactory("USDLemma");
  const usdLemma = await upgrades.deployProxy(USDLemma, [AddressZero, btcCollateral.address, perpLemma.address], {
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
  // // await defaultSigner.sendTransaction({ to: btcCollateral.address, value: amountOfCollateralToMint });
  // // await hasWETH.sendTransaction({ to: btcCollateral.address, value: amountOfCollateralToMint });

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
