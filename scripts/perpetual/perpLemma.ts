import hre from "hardhat";
const { ethers, upgrades } = hre;
const { constants } = ethers;
const { AddressZero } = constants;
import { fetchFromURL, delay } from "../../test/hardhat/shared/utils";
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
import { SettlementTokenManager__factory, USDLemma__factory } from "../../types";
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
  // let perpV2Config = await fetchFromURL(testnetAddressesURL);
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

  const peripheryAddress = AddressZero;
  const wbtcCollateral = "0xf69460072321ed663Ad8E69Bc15771A57D18522d";
  const USDLemmaAddress = "0x3e193e134eF0f9187b07cbD6d0DBaD56E1B5542B";
  const SettlementTokenManagerAddress = "0xCE7808D62FCC4B9cc4A2e661273d61C1a66fcFa0";
  const perpIndex = "0";

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
  // let collateral = new ethers.Contract(collaterals[2].address, TestERC20Abi.abi, defaultSigner); //WETH
  // let collateral2 = new ethers.Contract(collaterals[1].address, TestERC20Abi.abi, defaultSigner); //WBTC
  let collateral = new ethers.Contract(wbtcCollateral, TestERC20Abi.abi, defaultSigner);
  let baseToken = new ethers.Contract(contracts.vBTC.address, BaseTokenAbi.abi, defaultSigner);
  let quoteToken = new ethers.Contract(contracts.QuoteToken.address, QuoteTokenAbi.abi, defaultSigner);
  let accountBalance = new ethers.Contract(contracts.AccountBalance.address, AccountBalanceAbi.abi, defaultSigner);
  let usdLemma = new ethers.Contract(USDLemmaAddress, USDLemma__factory.abi, defaultSigner);
  let settlementTokenManager = new ethers.Contract(
    SettlementTokenManagerAddress,
    SettlementTokenManager__factory.abi,
    defaultSigner,
  );

  let uniswapV3Factory = new ethers.Contract(
    externalContracts.UniswapV3Factory,
    UniswapV3FactoryAbi.abi,
    defaultSigner,
  );
  // let pool = new ethers.Contract(perpV2Config.pools[4].address, UniswapV3PoolAbi.abi, defaultSigner);
  // console.log(pool.address)

  const stmRebalancer = defaultSigner.address;
  const settlementToken = await vault.getSettlementToken(); // usdc

  console.log("deploying perpLemma");
  const maxPosition = ethers.constants.MaxUint256;
  const perpLemmaFactory = await ethers.getContractFactory("PerpLemmaCommon");
  let perpLemma = await upgrades.deployProxy(
    perpLemmaFactory,
    [
      config[chainId].trustedForwarder,
      wbtcCollateral,
      baseToken.address,
      clearingHouse.address,
      marketRegistry.address,
      usdLemma.address,
      AddressZero,
      maxPosition,
    ],
    { initializer: "initialize" },
  );
  console.log("perpLemma.address: ", perpLemma.address);
  await delay(10000);

  // Deploy lemmaSynth
  const LemmaSynth = await ethers.getContractFactory("LemmaSynth");
  const lemmaSynth = await upgrades.deployProxy(
    LemmaSynth,
    [config[chainId].trustedForwarder, perpLemma.address, settlementToken, wbtcCollateral, "LSynthWbtc", "LSWbtc"],
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
    [config[chainId].trustedForwarder, lemmaSynth.address, peripheryAddress, "xLSynthWbtc", "xLSWbtc"],
    {
      initializer: "initialize",
    },
  );
  console.log("xLemmaSynth.address: ", xLemmaSynth.address);
  await delay(10000);

  console.log("configuring parameters");

  await perpLemma.connect(defaultSigner).setSettlementTokenManager(SettlementTokenManagerAddress);
  await delay(10000);

  await perpLemma.connect(defaultSigner).setReBalancer(config[chainId].reBalancer);
  await delay(10000);

  await perpLemma.setLemmaSynth(lemmaSynth.address);
  await delay(10000);

  await usdLemma.addPerpetualDEXWrapper(perpIndex, wbtcCollateral, perpLemma.address);

  await xLemmaSynth.setMinimumLock("100");
  await delay(10000);

  deployedContracts["USDLemma"] = {
    name: "USDLemma",
    address: usdLemma.address,
  };

  deployedContracts["PerpLemmaWbtc"] = {
    name: "PerpLemmaWbtc",
    address: perpLemma.address,
  };

  deployedContracts["LemmaSynthWbtc"] = {
    name: "LemmaSynthWbtc",
    address: lemmaSynth.address,
  };

  deployedContracts["XLemmaSynthWbtc"] = {
    name: "XLemmaSynthWbtc",
    address: xLemmaSynth.address,
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
