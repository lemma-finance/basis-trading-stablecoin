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
  loadPerpLushanInfoMainnetForBTC,
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
  perpAddresses = fs.readFileSync(__dirname + '/../deployments/local.deployment.perp.js', 'utf8');
  perpAddresses = JSON.parse(perpAddresses);
  console.log('perpAddresses: ', perpAddresses)
  perpAddressesFromBTC = await loadPerpLushanInfoMainnetForBTC();
  console.log('perpAddressesFromBTC: ', perpAddressesFromBTC)

  let [defaultSigner, signer1, signer2, longAddress, reBalancer, hasWETH, keeperGasReward, lemmaTreasury] =
    await ethers.getSigners();
  
  clearingHouse = new ethers.Contract(perpAddressesFromBTC.clearingHouse2.address, ClearingHouseAbi.abi, defaultSigner);
  orderBook = new ethers.Contract(perpAddressesFromBTC.orderBook2.address, OrderBookAbi.abi, defaultSigner);
  clearingHouseConfig = new ethers.Contract(
    perpAddressesFromBTC.clearingHouseConfig2.address,
    ClearingHouseConfigAbi.abi,
    defaultSigner,
  );
  vault = new ethers.Contract(perpAddressesFromBTC.vault2.address, VaultAbi.abi, defaultSigner);
  exchange = new ethers.Contract(perpAddressesFromBTC.exchange2.address, ExchangeAbi.abi, defaultSigner);
  marketRegistry = new ethers.Contract(perpAddressesFromBTC.marketRegistry2.address, MarketRegistryAbi.abi, defaultSigner);
  collateral = new ethers.Contract(perpAddressesFromBTC.btcCollateral.address, TestERC20Abi.abi, defaultSigner);
  baseToken = new ethers.Contract(perpAddressesFromBTC.baseToken2.address, BaseTokenAbi.abi, defaultSigner);
  // baseToken2 = new ethers.Contract(perpAddressesFromBTC.baseToken2.address, BaseToken2Abi.abi, defaultSigner);
  quoteToken = new ethers.Contract(perpAddressesFromBTC.quoteToken2.address, QuoteTokenAbi.abi, defaultSigner);
  univ3factory = new ethers.Contract(perpAddressesFromBTC.univ3factory2.address, UniswapV3FactoryAbi.abi, defaultSigner);
  accountBalance = new ethers.Contract(perpAddressesFromBTC.accountBalance2.address, AccountBalanceAbi.abi, defaultSigner);
  mockedBaseAggregatorForBTC = new ethers.Contract(
    perpAddressesFromBTC.mockedBaseAggregatorForBTC.address,
    MockTestAggregatorV3Abi.abi,
    defaultSigner,
  );
  mockedBaseAggregatorForBTC2 = new ethers.Contract(
    perpAddressesFromBTC.mockedBaseAggregatorForBTC2.address,
    MockTestAggregatorV3Abi.abi,
    defaultSigner,
  );
  pool = new ethers.Contract(perpAddressesFromBTC.pool2.address, UniswapV3PoolAbi.abi, defaultSigner);
  // pool2 = new ethers.Contract(perpAddressesFromBTC.pool2.address, UniswapV3Pool2Abi.abi, defaultSigner);
  // quoter = new ethers.Contract(perpAddressesFromBTC.quoter.address, QuoterAbi.abi, defaultSigner);
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

  // 1 BTC == 10000 USD
  await mockedBaseAggregatorForBTC.setLatestRoundData(0, parseUnits("0.0001", 18), 0, 0, 0);
  // await mockedBaseAggregatorForBTC2.setLatestRoundData(0, parseUnits("100", collateralDecimals), 0, 0, 0)

  await pool.initialize(encodePriceSqrt("1", "10000"));
  // the initial number of oracle can be recorded is 1; thus, have to expand it
  await pool.increaseObservationCardinalityNext((2 ^ 16) - 1);
  // await pool2.initialize(encodePriceSqrt("1", "10000")); // tick = 50200 (1.0001^50200 = 151.373306858723226652)

  await marketRegistry.addPool(baseToken.address, 10000);
  // await marketRegistry.addPool(baseToken2.address, 10000)
  await marketRegistry.setFeeRatio(baseToken.address, 10000);
  // await marketRegistry.setFeeRatio(baseToken2.address, 10000)

  // BTC rich address 0xE78388b4CE79068e89Bf8aA7f218eF6b9AB0e9d0
  const btcRichAddress = "0xE78388b4CE79068e89Bf8aA7f218eF6b9AB0e9d0"
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [btcRichAddress],
  });
  let richBtcSigner = await ethers.provider.getSigner(btcRichAddress)

  const amountOfCollateralToMint = parseUnits("2000", collateralDecimals); // 6 decimal
  await collateral.connect(richBtcSigner).transfer(signer1.address, amountOfCollateralToMint)
  await collateral.connect(richBtcSigner).transfer(signer2.address, amountOfCollateralToMint)
  await collateral.connect(richBtcSigner).transfer(longAddress.address, amountOfCollateralToMint)

  console.log("signer1: ", signer1.address);

  await collateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
  await collateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256);
  await collateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);

  await vault.connect(signer1).deposit(collateral.address, parseUnits("1000", collateralDecimals));
  await vault.connect(signer2).deposit(collateral.address, parseUnits("1000", collateralDecimals));
  await vault.connect(longAddress).deposit(collateral.address, parseUnits("1000", collateralDecimals));

  await clearingHouse.connect(signer2).addLiquidity({
    baseToken: baseToken.address,
    base: parseEther("1000000"),
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

  // const USDLemma = await ethers.getContractFactory("USDLemma");
  // const usdLemma = await upgrades.deployProxy(USDLemma, [AddressZero, collateralAddress, perpLemma.address], {
  //   initializer: "initialize",
  // });
  await perpLemma.setUSDLemma(perpAddresses.USDLemma.address);

  //deploy stackingContract
  // const XUSDL = await ethers.getContractFactory("xUSDL");
  // const peripheryAddress = AddressZero;
  // const xUSDL = await upgrades.deployProxy(XUSDL, [AddressZero, usdLemma.address, peripheryAddress], {
  //   initializer: "initialize",
  // });
  // console.log("xUSDL", xUSDL.address);
  // console.log("USDLemma", await xUSDL.usdl());

  // //deposit keeper gas reward
  // //get some WETH first
  // //get the keeper gas reward

  // // const amountOfCollateralToMint = utils.parseEther("2000");
  // // await defaultSigner.sendTransaction({ to: collateral.address, value: amountOfCollateralToMint });
  // // await hasWETH.sendTransaction({ to: collateral.address, value: amountOfCollateralToMint });

  //set fees
  // const fees = 3000; //30%
  // await usdLemma.setFees(fees);
  //set stacking contract address
  // await usdLemma.setStakingContractAddress(xUSDL.address);
  //set lemma treasury address
  // await usdLemma.setLemmaTreasury(lemmaTreasury.address);

  // deployedContracts["USDLemma"] = {
  //   name: "USDLemma",
  //   address: usdLemma.address,
  // };

  // deployedContracts["XUSDL"] = {
  //   name: "XUSDL",
  //   address: xUSDL.address,
  // };

  deployedContracts["PerpLemma2"] = {
    name: "PerpLemma2",
    address: perpLemma.address,
  };
  deployedContracts = Object.assign(perpAddresses, perpAddressesFromBTC, deployedContracts);
  await save();
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
