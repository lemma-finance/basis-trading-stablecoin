import hre from "hardhat";
const { ethers, upgrades } = hre;
const { constants } = ethers;
const { AddressZero } = constants;
import { fetchFromURL, delay } from "../../test/shared/utils";
import config from "./constants.json";
import fs from "fs";
import ClearingHouseAbi from "../../perp-lushan/artifacts/contracts/test/TestClearingHouse.sol/TestClearingHouse.json";
import OrderBookAbi from "../../perp-lushan/artifacts/contracts/OrderBook.sol/OrderBook.json";
import ClearingHouseConfigAbi from "../../perp-lushan/artifacts/contracts/ClearingHouseConfig.sol/ClearingHouseConfig.json";
import VaultAbi from "../../perp-lushan/artifacts/contracts/Vault.sol/Vault.json";
import ExchangeAbi from "../../perp-lushan/artifacts/contracts/Exchange.sol/Exchange.json";
import MarketRegistryAbi from "../../perp-lushan/artifacts/contracts/MarketRegistry.sol/MarketRegistry.json";
import TestERC20Abi from "../../perp-lushan/artifacts/contracts/test/TestERC20.sol/TestERC20.json";
import BaseTokenAbi from "../../perp-lushan/artifacts/contracts/BaseToken.sol/BaseToken.json";
import QuoteTokenAbi from "../../perp-lushan/artifacts/contracts/QuoteToken.sol/QuoteToken.json";
import AccountBalanceAbi from "../../perp-lushan/artifacts/contracts/AccountBalance.sol/AccountBalance.json";
import UniswapV3PoolAbi from "../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import UniswapV3FactoryAbi from "../../perp-lushan/artifacts/@uniswap/v3-core/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import bn from "bignumber.js";
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });
const SAVE_PREFIX = "./deployments/";
const SAVE_POSTFIX = ".deployment.perp.js";
const testnetAddressesURL = "https://metadata.perp.exchange/v2/optimism-kovan.json";
let deployedContracts = {};

const save = async network => {
  await fs.writeFileSync(SAVE_PREFIX + network + SAVE_POSTFIX, JSON.stringify(deployedContracts, null, 2));
};

async function main() {
  let perpV2Config = await fetchFromURL(testnetAddressesURL);
  const network = perpV2Config.network;
  const contracts = perpV2Config.contracts;
  const collaterals = perpV2Config.collaterals;
  const externalContracts = perpV2Config.externalContracts;
  const chainId = perpV2Config.chainId;

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
  let collateral = new ethers.Contract(externalContracts.USDC, TestERC20Abi.abi, defaultSigner);
  let baseToken = new ethers.Contract(contracts.vETH.address, BaseTokenAbi.abi, defaultSigner);
  let quoteToken = new ethers.Contract(contracts.QuoteToken.address, QuoteTokenAbi.abi, defaultSigner);
  let accountBalance = new ethers.Contract(contracts.AccountBalance.address, AccountBalanceAbi.abi, defaultSigner);

  let uniswapV3Factory = new ethers.Contract(
    externalContracts.UniswapV3Factory,
    UniswapV3FactoryAbi.abi,
    defaultSigner,
  );
  let pool = new ethers.Contract(perpV2Config.pools[0].address, UniswapV3PoolAbi.abi, defaultSigner); //vETH-vUSD pool
  let collateralDecimals = await collateral.decimals();

  console.log("deploying perpLemma");
  const maxPosition = ethers.constants.MaxUint256;
  const perpLemmaFactory = await ethers.getContractFactory("PerpLemma");
  let perpLemma = await upgrades.deployProxy(
    perpLemmaFactory,
    [
      config[chainId].trustedForwarder,
      baseToken.address,
      clearingHouse.address,
      marketRegistry.address,
      AddressZero,
      maxPosition,
    ],
    { initializer: "initialize" },
  );
  console.log("perpLemma", perpLemma.address);
  await delay(10000);
  await perpLemma.connect(defaultSigner).setReBalancer(config[chainId].reBalancer);
  await delay(10000);

  collateralDecimals = await perpLemma.collateralDecimals();
  const collateralAddress = await perpLemma.collateral();

  console.log("deploying LemmaETH");
  const LemmaETH = await ethers.getContractFactory("LemmaETH");
  const lemmaETH = await upgrades.deployProxy(
    LemmaETH,
    [config[chainId].trustedForwarder, collateralAddress, perpLemma.address],
    {
      initializer: "initialize",
    },
  );
  await delay(10000);
  await perpLemma.setLemmaEth(lemmaETH.address);
  await delay(10000);
  //deploy stackingContract
  console.log("deploying xETHL");
  const XETHL = await ethers.getContractFactory("xETHL");
  const peripheryAddress = AddressZero;
  const xETHL = await upgrades.deployProxy(
    XETHL,
    [config[chainId].trustedForwarder, lemmaETH.address, peripheryAddress],
    {
      initializer: "initialize",
    },
  );
  // const usdl: any = await xETHL.usdl()
  console.log("xETHL", xETHL.address);
  // console.log("LemmaETH", usdl);
  await delay(10000);

  console.log("configuring parameters");
  //set fees
  const fees = 3000; //30%
  await lemmaETH.setFees(fees);
  await delay(10000);
  //set stacking contract address
  await lemmaETH.setStakingContractAddress(xETHL.address);
  await delay(10000);
  //set lemma treasury address
  await lemmaETH.setLemmaTreasury(config[chainId].lemmaTreasury);
  await delay(10000);
  //set minimum lock
  await xETHL.setMinimumLock("100");
  await delay(10000);

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
  deployedContracts = Object.assign(contracts, deployedContracts);
  await save(network);
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
