import hre from "hardhat";
const { ethers, upgrades } = hre;
const { constants } = ethers;
const { AddressZero } = constants;
import { fetchFromURL, delay } from "../../test/hardhat/shared/utils";
import fs from "fs";
import VaultAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/Vault.sol/Vault.json";
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
  let [defaultSigner]: any = await ethers.getSigners();
  let vault = new ethers.Contract(contracts.Vault.address, VaultAbi.abi, defaultSigner);

  const stmRebalancer = defaultSigner.address;
  const settlementToken = await vault.getSettlementToken(); // usdc
  console.log("settlement token", settlementToken);
  const USDLAddress = "0x96F2539d3684dbde8B3242A51A73B66360a5B541";
  // Deploy SettlementTokenManager
  const stmFactory = await ethers.getContractFactory("SettlementTokenManager");
  let settlementTokenManager = await upgrades.deployProxy(stmFactory, [USDLAddress, stmRebalancer, settlementToken]);
  console.log("settlementTokenManager.address: ", settlementTokenManager.address);

  await delay(1000);
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
