import hre from "hardhat";
const { ethers, upgrades } = hre;
const { constants } = ethers;
const { AddressZero } = constants;
import { fetchFromURL, delay } from "../../test/shared/utils";
import config from "./constants.json";
import fs from "fs";
import ClearingHouseAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/ClearingHouse.sol/ClearingHouse.json";
import OrderBookAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/OrderBook.sol/OrderBook.json";
import ClearingHouseConfigAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/ClearingHouseConfig.sol/ClearingHouseConfig.json";
import VaultAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/Vault.sol/Vault.json";
import ExchangeAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/Exchange.sol/Exchange.json";
import MarketRegistryAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/MarketRegistry.sol/MarketRegistry.json";
import TestERC20Abi from "@perp/curie-deployments/optimism/core/artifacts/contracts/interface/IERC20Metadata.sol/IERC20Metadata.json";
import BaseTokenAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/BaseToken.sol/BaseToken.json";
import QuoteTokenAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/QuoteToken.sol/QuoteToken.json";
import AccountBalanceAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/AccountBalance.sol/AccountBalance.json";
import UniswapV3PoolAbi from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import UniswapV3FactoryAbi from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import bn from "bignumber.js";
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

const SAVE_PREFIX = "./deployments/";
const SAVE_POSTFIX = ".deployment.perp.js";
const mainnetAddressesURL = "https://metadata.perp.exchange/v2/optimism.json";
const testnetAddressesURL = "https://metadata.perp.exchange/v2/optimism-kovan.json";
let deployedContracts = {};

const save = async network => {
  await fs.writeFileSync(SAVE_PREFIX + network + SAVE_POSTFIX, JSON.stringify(deployedContracts, null, 2));
};

async function main() {
  let { chainId } = await ethers.provider.getNetwork();
  console.log("chainId: ", chainId);
  let perpV2Config;

  if (chainId == 10) {
    perpV2Config = await fetchFromURL(mainnetAddressesURL);
  } else if (chainId == 69) {
    perpV2Config = await fetchFromURL(testnetAddressesURL);
  }

  const network = perpV2Config.network;
  const contracts = perpV2Config.contracts;
  const collaterals = perpV2Config.collaterals;
  const externalContracts = perpV2Config.externalContracts;

  let [defaultSigner]: any = await ethers.getSigners();
  let clearingHouse = new ethers.Contract(contracts.ClearingHouse.address, ClearingHouseAbi.abi, defaultSigner);
  let orderBook = new ethers.Contract(contracts.OrderBook.address, OrderBookAbi.abi, defaultSigner);
  let clearingHouseConfig = new ethers.Contract(
    contracts.ClearingHouseConfig.address,
    ClearingHouseConfigAbi.abi,
    defaultSigner,
  );
  let vault = new ethers.Contract(contracts.Vault.address, VaultAbi.abi, defaultSigner);
  let exchange = new ethers.Contract(contracts.Exchange.address, ExchangeAbi.abi, defaultSigner);
  let marketRegistry = new ethers.Contract(contracts.MarketRegistry.address, MarketRegistryAbi.abi, defaultSigner);
  let collateral = new ethers.Contract(
    chainId == 10 ? collaterals[0].address : collaterals[2].address,
    TestERC20Abi.abi,
    defaultSigner,
  ); //WETH
  let baseToken = new ethers.Contract(contracts.vETH.address, BaseTokenAbi.abi, defaultSigner);
  let baseToken2 = new ethers.Contract(contracts.vBTC.address, TestERC20Abi.abi, defaultSigner);
  let quoteToken = new ethers.Contract(contracts.QuoteToken.address, QuoteTokenAbi.abi, defaultSigner);
  let accountBalance = new ethers.Contract(contracts.AccountBalance.address, AccountBalanceAbi.abi, defaultSigner);

  let uniswapV3Factory = new ethers.Contract(
    externalContracts.UniswapV3Factory,
    UniswapV3FactoryAbi.abi,
    defaultSigner,
  );
  // let pool = new ethers.Contract(perpV2Config.pools[9].address, UniswapV3PoolAbi.abi, defaultSigner); //vETH-vUSD pool

  const stmRebalancer = defaultSigner.address;
  const settlementToken = await vault.getSettlementToken(); // usdc

  const etherBalanceBefore = await ethers.provider.getBalance(defaultSigner.address);
  console.log("etherBalanceBefore", etherBalanceBefore.toString());

  console.log("deploying perpLemma");
  const maxPosition = ethers.constants.MaxUint256;
  const perpLemmaFactory = await ethers.getContractFactory("PerpLemmaCommon");
  let perpLemma = await upgrades.deployProxy(
    perpLemmaFactory,
    [
      config[chainId].trustedForwarder,
      collateral.address,
      baseToken.address,
      clearingHouse.address,
      marketRegistry.address,
      AddressZero,
      AddressZero,
      maxPosition,
    ],
    { initializer: "initialize" },
  );
  console.log("perpLemma.address: ", perpLemma.address);
  await delay(10000);

  // Deploy SettlementTokenManager
  const stmFactory = await ethers.getContractFactory("SettlementTokenManager");
  let settlementTokenManager = await upgrades.deployProxy(stmFactory, [AddressZero, stmRebalancer, settlementToken]);
  console.log("settlementTokenManager.address: ", settlementTokenManager.address);
  await delay(10000);

  console.log("deploying USDLemma");
  const USDLemma = await ethers.getContractFactory("USDLemma");
  const usdLemma = await upgrades.deployProxy(
    USDLemma,
    [
      config[chainId].trustedForwarder,
      collateral.address,
      perpLemma.address,
      settlementTokenManager.address,
      settlementToken,
    ],
    {
      initializer: "initialize",
    },
  );
  console.log("usdLemma.address: ", usdLemma.address);
  await delay(10000);

  // deploy LemmaTreasury
  console.log("deploying LemmaTreasury");
  const LemmaTreasury = await ethers.getContractFactory("LemmaTreasury");
  const lemmaTreasury = await upgrades.deployProxy(LemmaTreasury);
  console.log("lemmaTreasury.address: ", lemmaTreasury.address);
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
  console.log("xUSDL.address: ", xUSDL.address);
  await delay(10000);

  // Deploy lemmaSynth
  const LemmaSynth = await ethers.getContractFactory("LemmaSynth");
  const lemmaSynth = await upgrades.deployProxy(
    LemmaSynth,
    [config[chainId].trustedForwarder, perpLemma.address, settlementToken, collateral.address, "LSynthEth", "LSEth"],
    {
      initializer: "initialize",
    },
  );
  console.log("lemmaSynth.address: ", lemmaSynth.address);
  await delay(10000);

  // Deploy xLemmaSynth
  console.log("deploying xLemmaSynth");
  const XLemmaSynth = await ethers.getContractFactory("xLemmaSynth");
  const xLemmaSynth = await upgrades.deployProxy(
    XLemmaSynth,
    [config[chainId].trustedForwarder, lemmaSynth.address, peripheryAddress, "xLSynthEth", "xLSEth"],
    {
      initializer: "initialize",
    },
  );
  console.log("xLemmaSynth.address: ", xLemmaSynth.address);
  await delay(10000);

  console.log("configuring parameters");

  await perpLemma.connect(defaultSigner).setSettlementTokenManager(settlementTokenManager.address);
  await delay(10000);

  await perpLemma.connect(defaultSigner).setReBalancer(config[chainId].reBalancer);
  await delay(10000);

  await perpLemma.setUSDLemma(usdLemma.address);
  await delay(10000);

  await perpLemma.setLemmaSynth(lemmaSynth.address);
  await delay(10000);

  await settlementTokenManager.setIsSettlementAllowed(true);
  await delay(10000);

  await settlementTokenManager.setUSDLemma(usdLemma.address);
  await delay(10000);

  const fees = 3000; //30%
  await usdLemma.setFees(fees);
  await delay(10000);

  //set lemma treasury address
  await usdLemma.setLemmaTreasury(lemmaTreasury.address);
  await delay(10000);

  await usdLemma.connect(defaultSigner).setSettlementTokenManager(settlementTokenManager.address);
  await delay(10000);

  //set minimum lock
  await xUSDL.setMinimumLock("100");
  await delay(10000);

  await xLemmaSynth.setMinimumLock("100");
  await delay(10000);

  deployedContracts["LemmaTreasury"] = {
    name: "LemmaTreasury",
    address: lemmaTreasury.address,
  };

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

  deployedContracts["LemmaSynth"] = {
    name: "LemmaSynth",
    address: lemmaSynth.address,
  };

  deployedContracts["XLemmaSynth"] = {
    name: "XLemmaSynth",
    address: xLemmaSynth.address,
  };
  deployedContracts = Object.assign(contracts, deployedContracts);
  await save(network);

  const etherBalanceAfter = await ethers.provider.getBalance(defaultSigner.address);
  console.log("etherBalanceAfter", etherBalanceAfter.toString());

  console.log("cost", etherBalanceBefore.sub(etherBalanceAfter).toString()); //26725501000000000 cost on optimism Kovan with 1 wei
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
