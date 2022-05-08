import hre from "hardhat";
const { ethers, upgrades, waffle } = hre;
const { constants, BigNumber } = ethers;
import { utils } from "ethers";
import { parseEther, parseUnits } from "ethers/lib/utils";
import fs from "fs";
import bn from "bignumber.js";
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

const { AddressZero, MaxInt256, MaxUint256 } = constants;
const SAVE_PREFIX = "./deployments/";
const SAVE_POSTFIX = "mainnetfork.deployment.perp.js";
const ZERO = BigNumber.from("0");
let deployedContracts = {};

import { createClearingHouseFixture } from "../../test/shared/perpFixtureMainnet/fixture";
import { PerpLemma } from "../../types/PerpLemma";

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

  let [defaultSigner, reBalancer, hasWETH, keeperGasReward, signer1, signer2, longAddress, lemmaTreasury]: any = await ethers.getSigners();
  const loadFixture: ReturnType<typeof waffle.createFixtureLoader> = waffle.createFixtureLoader([defaultSigner]);
  let perpAddresses = await loadFixture(createClearingHouseFixture(defaultSigner));

  let clearingHouse = perpAddresses.clearingHouse;
  let orderBook = perpAddresses.orderBook;
  let accountBalance = perpAddresses.accountBalance;
  let clearingHouseConfig = perpAddresses.clearingHouseConfig;
  let vault = perpAddresses.vault;
  let exchange = perpAddresses.exchange;
  let marketRegistry = perpAddresses.marketRegistry;
  let usdCollateral = perpAddresses.USDC;
  let ethCollateral = perpAddresses.WETH;
  let btcCollateral = perpAddresses.WBTC;
  let baseToken = perpAddresses.baseToken;
  let baseToken2 = perpAddresses.baseToken2;
  let quoteToken = perpAddresses.quoteToken;
  let mockedBaseAggregator = perpAddresses.mockedBaseAggregator;
  let mockedBaseAggregator2 = perpAddresses.mockedBaseAggregator2;
  let mockedWethPriceFeed = perpAddresses.mockedWethPriceFeed;
  let mockedWbtcPriceFeed = perpAddresses.mockedWbtcPriceFeed;
  let collateralManager = perpAddresses.collateralManager;
  let pool = perpAddresses.pool;
  let pool2 = perpAddresses.pool2;
  let univ3factory = perpAddresses.uniV3Factory;
  let quoter = perpAddresses.quoter;

  const maxPosition = ethers.constants.MaxUint256;
  const perpLemmaFactory = await ethers.getContractFactory("PerpLemma");
  let perpLemma = await upgrades.deployProxy(
    perpLemmaFactory,
    [
      AddressZero,
      baseToken.address,
      clearingHouse.address,
      marketRegistry.address,
      AddressZero, // It is LemmaETH contract address, it will set below by setUSDLemma
      maxPosition,
    ],
    { initializer: "initialize" },
  ) as PerpLemma;
  let collateralDecimals = await perpLemma.collateralDecimals(); // collateral decimal
  await perpLemma.connect(signer1).resetApprovals();
  await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);

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
  let richUSDCSigner : any = await ethers.provider.getSigner(usdcRichAddress);

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

  let usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // mainnet address
  let usdcWhaleAddress = "0x06601571AA9D3E8f5f7CDd5b993192618964bAB5";

  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [usdcWhaleAddress],
  });

  const LemmaETH = await ethers.getContractFactory("LemmaETH");
  const lemmaETH = await upgrades.deployProxy(LemmaETH, [AddressZero, usdCollateral.address, perpLemma.address], {
    initializer: "initialize",
  });
  await perpLemma.setLemmaEth(lemmaETH.address);

  //deploy stackingContract
  const XETHL = await ethers.getContractFactory("xETHL");
  const peripheryAddress = AddressZero;
  const xETHL = await upgrades.deployProxy(XETHL, [AddressZero, lemmaETH.address, peripheryAddress], {
    initializer: "initialize",
  });
  console.log("xETHL", xETHL.address);
  console.log("LemmaETH", await xETHL.ethl());

  //set fees
  const fees = 3000; //30%
  await lemmaETH.setFees(fees);
  //set stacking contract address
  await lemmaETH.setStakingContractAddress(xETHL.address);
  //set lemma treasury address
  await lemmaETH.setLemmaTreasury(lemmaTreasury.address);

  const data = fs.readFileSync(__dirname + "/../../deployments/mainnetfork.deployment.perp.js", "utf8");
  perpAddresses = JSON.parse(data);

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
