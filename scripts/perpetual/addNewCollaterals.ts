import hre from "hardhat";
const { ethers, upgrades } = hre;
const { constants } = ethers;
const { AddressZero } = constants;
import { fetchFromURL, delay } from "../../test/hardhat/shared/utils";
import config from "./config/config_addNewCollaterals.json";
import fs from "fs";
import ClearingHouseAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/ClearingHouse.sol/ClearingHouse.json";
import VaultAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/Vault.sol/Vault.json";
import MarketRegistryAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/MarketRegistry.sol/MarketRegistry.json";
import TestERC20Abi from "@perp/curie-deployments/optimism/core/artifacts/contracts/interface/IERC20Metadata.sol/IERC20Metadata.json";
import BaseTokenAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/BaseToken.sol/BaseToken.json";
import LemmaSwapAbi from "./config/ABIs/Lemmaswap.json";
import FeesAccumulatorAbi from "./config/ABIs/FeesAccumulator.json";
import bn from "bignumber.js";
import { USDLemma__factory } from "../../types";
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });
const SAVE_PREFIX = "./deployments/";
const SAVE_POSTFIX = ".deployment.perp.json";
const mainnetAddressesURL = "https://metadata.perp.exchange/v2/optimism.json";
const testnetAddressesURL = "https://metadata.perp.exchange/v2/optimism-kovan.json";
let deployedContracts = {};

const save = async network => {
  await fs.writeFileSync(SAVE_PREFIX + network + SAVE_POSTFIX, JSON.stringify(deployedContracts, null, 2));
};
const readFile = async network => {
  return await fs.readFileSync(SAVE_PREFIX + network + SAVE_POSTFIX, "utf8");
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

  deployedContracts = JSON.parse(await readFile(network));

  const perpCollaterals = perpV2Config.collaterals;
  const externalContracts = perpV2Config.externalContracts;
  const peripheryAddress = AddressZero;

  const trustedForwarder = config[chainId].trustedForwarder;

  const USDLemmaAddress = config[chainId].USDLemmaAddress;
  const LemmaSwapAddress = config[chainId].LemmaSwapAddress;
  const FeesAccumulatorAddress = config[chainId].FeesAccumulatorAddress;
  const reBalancer = config[chainId].reBalancer;
  const SettlementTokenManagerAddress = config[chainId].SettlementTokenManagerAddress;
  const xUSDL = config[chainId].xUSDL;
  const perpIndex = config[chainId].perpIndex;
  const percFundingPaymentsToUSDLHolder = config[chainId].percFundingPaymentsToUSDLHolder;

  const minFreeCollateral = config[chainId].minFreeCollateral;
  const minMarginSafeThreshold = config[chainId].minMarginSafeThreshold;
  const collateralRatio = config[chainId].collateralRatio;
  const lemmaSynthSetFees = config[chainId].lemmaSynthSetFees;

  const [defaultSigner]: any = await ethers.getSigners();
  const clearingHouse = new ethers.Contract(contracts.ClearingHouse.address, ClearingHouseAbi.abi, defaultSigner);
  const vault = new ethers.Contract(contracts.Vault.address, VaultAbi.abi, defaultSigner);
  const marketRegistry = new ethers.Contract(contracts.MarketRegistry.address, MarketRegistryAbi.abi, defaultSigner);

  const usdLemma = new ethers.Contract(USDLemmaAddress, USDLemma__factory.abi, defaultSigner);
  const lemmaSwap = new ethers.Contract(LemmaSwapAddress, LemmaSwapAbi.abi, defaultSigner);
  const feesAccumulator = new ethers.Contract(FeesAccumulatorAddress, FeesAccumulatorAbi.abi, defaultSigner);

  const settlementToken = await vault.getSettlementToken(); // usdc

  const collaterals = config[chainId].collaterals;

  for (let i = 0; i < collaterals.length; i++) {
    const collateralAddress = config[chainId].collaterals[i];
    const maxPosition = config[chainId].collateralParameters[collateralAddress].maxPosition;
    const collateralSymbol = config[chainId].collateralParameters[collateralAddress].symbol;
    const collateralName = config[chainId].collateralParameters[collateralAddress].name;
    const baseTokenAddress = contracts["v" + collateralSymbol].address; //vLINK

    let collateral = new ethers.Contract(collateralAddress, TestERC20Abi.abi, defaultSigner);
    let baseToken = new ethers.Contract(baseTokenAddress, BaseTokenAbi.abi, defaultSigner);

    console.log("baseTokenAddress", baseTokenAddress);

    console.log("deploying perpLemma");
    const perpLemmaFactory = await ethers.getContractFactory("PerpLemmaCommon");
    let perpLemma = await upgrades.deployProxy(
      perpLemmaFactory,
      [
        trustedForwarder,
        collateralAddress,
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

    const lemmaSynthName = "Lemma" + collateralSymbol; //LemmaETH
    const lemmaSynthSymbol = "l" + collateralSymbol; //lETH
    const lemmaSynth = await upgrades.deployProxy(
      LemmaSynth,
      [trustedForwarder, perpLemma.address, settlementToken, collateralAddress, lemmaSynthName, lemmaSynthSymbol],
      {
        initializer: "initialize",
      },
    );
    console.log("lemmaSynth.address: ", lemmaSynth.address);
    await delay(10000);

    // Deploy xLemmaSynth
    console.log("deploying xLemmaSynth");

    const xLemmaSynthName = "x" + lemmaSynthName; //xLemmaETH
    const xLemmaSynthSymbol = "x" + lemmaSynthSymbol; //xlETH

    const XLemmaSynth = await ethers.getContractFactory("xLemmaSynth");
    const xLemmaSynth = await upgrades.deployProxy(
      XLemmaSynth,
      [trustedForwarder, lemmaSynth.address, peripheryAddress, xLemmaSynthName, xLemmaSynthSymbol],
      {
        initializer: "initialize",
      },
    );
    console.log("xLemmaSynth.address: ", xLemmaSynth.address);
    await delay(10000);

    console.log("configuring parameters");

    await perpLemma.connect(defaultSigner).setSettlementTokenManager(SettlementTokenManagerAddress);
    await delay(10000);

    await perpLemma.connect(defaultSigner).setReBalancer(reBalancer);
    await delay(10000);

    await perpLemma.setLemmaSynth(lemmaSynth.address);
    await delay(10000);

    await perpLemma.setXUsdl(xUSDL);
    await delay(10000);

    await perpLemma.setXSynth(xLemmaSynth.address);
    await delay(10000);

    await perpLemma.setPercFundingPaymentsToUSDLHolders(percFundingPaymentsToUSDLHolder);
    await delay(10000);

    // await perpLemma.setMinFreeCollateral(minFreeCollateral);
    // await delay(10000);

    // await perpLemma.setMinMarginSafeThreshold(minMarginSafeThreshold);
    // await delay(10000);

    await perpLemma.setCollateralRatio(collateralRatio);
    await delay(10000);

    await usdLemma.addPerpetualDEXWrapper(perpIndex, collateralAddress, perpLemma.address);
    await delay(10000);

    await lemmaSynth.setXSynth(xLemmaSynth.address);
    await delay(10000);

    await lemmaSynth.setFees(lemmaSynthSetFees);
    await delay(10000);

    await xLemmaSynth.setMinimumLock("100");
    await delay(10000);

    // TODO: add setPeriphery as well
    // await xLemmaSynth.setPeriphery("LemmaRouter")

    await perpLemma.setIsUsdlCollateralTailAsset(true);
    await delay(1000);

    const perpLemmaName = "PerpLemma" + collateralSymbol; // PerpLemmaETH

    deployedContracts[perpLemmaName] = {
      name: perpLemmaName,
      address: perpLemma.address,
    };

    deployedContracts[lemmaSynthName] = {
      name: lemmaSynthName,
      address: lemmaSynth.address,
    };

    deployedContracts[xLemmaSynthName] = {
      name: xLemmaSynthName,
      address: xLemmaSynth.address,
    };

    //add support in LemmaSwap

    await lemmaSwap.setCollateralToDexIndex(collateralAddress, perpIndex);
    await delay(10000);

    await feesAccumulator.setCollateralToDexIndexForUsdl(collateralAddress, perpIndex);
    await delay(10000);

    await feesAccumulator.setCollateralToSynth(collateralAddress, lemmaSynth.address, xLemmaSynth.address);
    await delay(10000);
  }

  await save(network);
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
