
import hre from "hardhat";
const { ethers, upgrades, waffle } = hre;
const { constants, BigNumber } = ethers;
import { utils } from "ethers";
import { parseEther, parseUnits } from "ethers/lib/utils";
import { createClearingHouseFixture } from "../../test/shared/perpFixture/fixtures_mainnet";
import fs from "fs";
import bn from "bignumber.js";
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });
const { AddressZero, MaxInt256, MaxUint256 } = constants;
const SAVE_PREFIX = "./deployments/";
const SAVE_POSTFIX = "mainnetfork.deployment.perp.js";
let deployedContracts = {};

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
      ethCollateral.address,
      baseToken.address,
      clearingHouse.address,
      marketRegistry.address,
      AddressZero, // It is USDLemma contract address, it will set below by setUSDLemma
      maxPosition,
    ],
    { initializer: "initialize" },
  ) as any;
  let ethCollateralDecimals = await perpLemma.collateralDecimals(); // collateral decimal
  await perpLemma.connect(signer1).resetApprovals();
  await perpLemma.connect(defaultSigner).setReBalancer(reBalancer.address);

  await mockedBaseAggregator.setLatestRoundData(0, parseUnits("100", 6), 0, 0, 0);
  await mockedBaseAggregator2.setLatestRoundData(0, parseUnits("0.01", ethCollateralDecimals), 0, 0, 0);
  await mockedWethPriceFeed.setLatestRoundData(0, parseUnits("100", ethCollateralDecimals), 0, 0, 0);

  await pool.initialize(encodePriceSqrt("100", "1"));
  await pool.increaseObservationCardinalityNext((2 ^ 16) - 1);

  await pool2.initialize(encodePriceSqrt("100", "1"));
  await pool2.increaseObservationCardinalityNext((2 ^ 16) - 1);

  await clearingHouseConfig.setMaxFundingRate(parseUnits("1", 6));

  await marketRegistry.addPool(baseToken.address, 10000);
  await marketRegistry.setFeeRatio(baseToken.address, 10000);
  await exchange.setMaxTickCrossedWithinBlock(baseToken.address, 887272 * 2);

  const amountOfCollateralToMint = utils.parseEther("2000");
  await signer1.sendTransaction({ to: ethCollateral.address, value: amountOfCollateralToMint });
  await signer2.sendTransaction({ to: ethCollateral.address, value: amountOfCollateralToMint });
  await longAddress.sendTransaction({ to: ethCollateral.address, value: amountOfCollateralToMint });

  await ethCollateral.connect(signer1).approve(vault.address, ethers.constants.MaxUint256);
  await ethCollateral.connect(signer2).approve(vault.address, ethers.constants.MaxUint256);
  await ethCollateral.connect(longAddress).approve(vault.address, ethers.constants.MaxUint256);

  await vault.connect(signer1).deposit(ethCollateral.address, parseUnits("1000", ethCollateralDecimals));
  await vault.connect(signer2).deposit(ethCollateral.address, parseUnits("1500", ethCollateralDecimals));
  await vault.connect(longAddress).deposit(ethCollateral.address, parseUnits("1000", ethCollateralDecimals));

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

  let usdcWhaleAddress = "0x06601571AA9D3E8f5f7CDd5b993192618964bAB5";
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [usdcWhaleAddress],
  });

  const usdcWhale: any = await ethers.provider.getSigner(usdcWhaleAddress);
  const depositSettlement = parseUnits("10000", 6); // usdc is settlement token
  await usdCollateral.connect(usdcWhale).transfer(defaultSigner.address, depositSettlement);
  await usdCollateral.connect(defaultSigner).approve(perpLemma.address, ethers.constants.MaxUint256);
  await perpLemma.connect(defaultSigner).depositSettlementToken(depositSettlement);

  const USDLemma = await ethers.getContractFactory("USDLemma");
  const usdLemma = await upgrades.deployProxy(USDLemma, [AddressZero, ethCollateral.address, perpLemma.address], {
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

  //set fees
  const fees = 3000; //30%
  await usdLemma.setFees(fees);
  //set stacking contract address
  await usdLemma.setStakingContractAddress(xUSDL.address);
  //set lemma treasury address
  await usdLemma.setLemmaTreasury(lemmaTreasury.address);

  const data = fs.readFileSync(__dirname + "/../../deployments/mainnetfork.deployment.perp.js", "utf8");
  perpAddresses = JSON.parse(data);

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
