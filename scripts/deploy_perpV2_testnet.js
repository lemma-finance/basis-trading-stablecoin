const hre = require("hardhat");
const { ethers, upgrades } = hre;
const { constants, BigNumber } = ethers;
const { utils } = require("ethers");
const { AddressZero, MaxInt256, MaxUint256 } = constants;
const { parseEther, parseUnits } = require("ethers/lib/utils");
const { loadPerpLushanInfoMainnet, fetchFromURL, delay } = require("../test/shared/utils");
const config = require("./constants.json");

const fs = require("fs");
const network = "testnet";
const SAVE_PREFIX = "./deployments/";
const SAVE_POSTFIX = ".deployment.perp.js";
const testnetAddressesURL = "https://metadata.perp.exchange/v2/optimism-kovan.json";
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
const QuoteTokenAbi = require("../perp-lushan/artifacts/contracts/QuoteToken.sol/QuoteToken.json");
const AccountBalanceAbi = require("../perp-lushan/artifacts/contracts/AccountBalance.sol/AccountBalance.json");
const UniswapV3PoolAbi = require("../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");
const UniswapV3FactoryAbi = require("../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");

const save = async network => {
  await fs.writeFileSync(SAVE_PREFIX + network + SAVE_POSTFIX, JSON.stringify(deployedContracts, null, 2));
};

async function main() {
  perpV2Config = await fetchFromURL(testnetAddressesURL);
  const network = perpV2Config.network;
  const contracts = perpV2Config.contracts;
  const collaterals = perpV2Config.collaterals;
  const externalContracts = perpV2Config.externalContracts;
  const chainId = perpV2Config.chainId;

  let [defaultSigner] = await ethers.getSigners();
  clearingHouse = new ethers.Contract(contracts.ClearingHouse.address, ClearingHouseAbi.abi, defaultSigner);
  orderBook = new ethers.Contract(contracts.OrderBook.address, OrderBookAbi.abi, defaultSigner);
  clearingHouseConfig = new ethers.Contract(
    contracts.ClearingHouseConfig.address,
    ClearingHouseConfigAbi.abi,
    defaultSigner,
  );
  vault = new ethers.Contract(contracts.Vault.address, VaultAbi.abi, defaultSigner);
  exchange = new ethers.Contract(contracts.Exchange.address, ExchangeAbi.abi, defaultSigner);
  marketRegistry = new ethers.Contract(contracts.MarketRegistry.address, MarketRegistryAbi.abi, defaultSigner);
  collateral = new ethers.Contract(collaterals[2].address, TestERC20Abi.abi, defaultSigner);//WETH
  collateral2 = new ethers.Contract(collaterals[1].address, TestERC20Abi.abi, defaultSigner);//WBTC
  baseToken = new ethers.Contract(contracts.vETH.address, BaseTokenAbi.abi, defaultSigner);
  baseToken2 = new ethers.Contract(contracts.vBTC.address, TestERC20Abi.abi, defaultSigner);
  quoteToken = new ethers.Contract(contracts.QuoteToken.address, QuoteTokenAbi.abi, defaultSigner);
  accountBalance = new ethers.Contract(contracts.AccountBalance.address, AccountBalanceAbi.abi, defaultSigner);

  uniswapV3Factory = new ethers.Contract(externalContracts.UniswapV3Factory, UniswapV3FactoryAbi.abi, defaultSigner);
  pool = new ethers.Contract(perpV2Config.pools[0].address, UniswapV3PoolAbi.abi, defaultSigner); //vETH-vUSD pool
  collateralDecimals = await collateral.decimals();

  console.log("deploying perpLemma");
  const maxPosition = ethers.constants.MaxUint256;
  const perpLemmaFactory = await ethers.getContractFactory("PerpLemma");
  perpLemma = await upgrades.deployProxy(
    perpLemmaFactory,
    [
      config[chainId].trustedForwarder,
      collateral.address,
      baseToken.address,
      clearingHouse.address,
      marketRegistry.address,
      AddressZero,
      maxPosition,
    ],
    { initializer: "initialize" },
  );
  console.log("perpLemma-weth: ", perpLemma.address);
  await delay(10000);
  await perpLemma.connect(defaultSigner).setReBalancer(config[chainId].reBalancer);
  await delay(10000);

  collateralDecimals = await perpLemma.collateralDecimals();
  const collateralAddress = await perpLemma.collateral();

  console.log("deploying USDLemma");
  const USDLemma = await ethers.getContractFactory("USDLemma");
  const usdLemma = await upgrades.deployProxy(
    USDLemma,
    [config[chainId].trustedForwarder, collateralAddress, perpLemma.address],
    {
      initializer: "initialize",
    },
  );
  await delay(10000);
  console.log("deploying perpLemma2");
  perpLemma2 = await upgrades.deployProxy(
    perpLemmaFactory,
    [
      config[chainId].trustedForwarder,
      collateral2.address,
      baseToken2.address,
      clearingHouse.address,
      marketRegistry.address,
      usdLemma.address,
      maxPosition,
    ],
    { initializer: "initialize" },
  );
  console.log("perpLemma-wbtc: ", perpLemma2.address);
  await delay(10000);
  console.log("adding the second perplemma wrapper in usdllemma");
  await usdLemma.addPerpetualDEXWrapper(1, collateral2.address, perpLemma2.address);
  await delay(10000);
  //deploy stackingContract
  console.log("deploying xUSDL");
  const XUSDL = await ethers.getContractFactory("xUSDL");
  const peripheryAddress = AddressZero;
  const xUSDL = await upgrades.deployProxy(
    XUSDL,
    [config[chainId].trustedForwarder, usdLemma.address, peripheryAddress],
    {
      initializer: "initialize",
    },
  );
  const usdl = await xUSDL.usdl(); 
  console.log("xUSDL", xUSDL.address);
  console.log("USDLemma", usdl);
  await delay(10000);

  console.log("configuring parameters");
  //set fees
  const fees = 3000; //30%
  await usdLemma.setFees(fees);
  await delay(10000);
  //set stacking contract address
  await usdLemma.setStakingContractAddress(xUSDL.address);
  await delay(10000);
  //set lemma treasury address
  await usdLemma.setLemmaTreasury(config[chainId].lemmaTreasury);
  await delay(10000);
  //set minimum lock
  await xUSDL.setMinimumLock("100");
  await delay(10000);

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

  deployedContracts["PerpLemma2"] = {
    name: "PerpLemma2",
    address: perpLemma2.address,
  };
  deployedContracts = Object.assign(contracts, deployedContracts);
  await save(network);
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
