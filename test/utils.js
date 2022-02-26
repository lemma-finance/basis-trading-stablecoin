var colors = require("colors");
const fs = require("fs");
const hre = require("hardhat");
const { BigNumber } = hre.ethers;
const { utils } = require("ethers");
const tokenTransfers = require("truffle-token-test-utils");
tokenTransfers.setCurrentProvider(hre.network.config.url);
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const bn = require("bignumber.js");
const { parseUnits } = require("ethers/lib/utils");

const deployMCDEXLocally = async function () {
  // console.log("deploying MCDEX locally,please wait...");
  const { stdout, stderr } = await exec(
    "cd mai-protocol-v3/ && pwd && npx hardhat run scripts/deploy.ts --network local && cd ..  && pwd",
  );
  if (stderr) {
    console.error(`error: ${stderr}`);
  }
  // console.log(`output: ${stdout}`);
  // console.log("deployment done");
};

const loadMCDEXInfo = async function () {
  //deploy mcdex and then load
  await deployMCDEXLocally();
  //get MCDEXAddresses
  const data = fs.readFileSync(__dirname + "/../mai-protocol-v3/deployments/local.deployment.js", "utf8");
  return JSON.parse(data);
};

const deployPerpLocally = async function () {
  // console.log("deploying MCDEX locally,please wait...");
  const { stdout, stderr } = await exec(
    "cd perp-lushan/ && pwd && npx hardhat run scripts/deploy_local.ts --network local && cd ..  && pwd",
  );
  if (stderr) {
    console.error(`error: ${stderr}`);
  }
  // console.log(`output: ${stdout}`);
  // console.log("deployment done");
};

const loadPerpLushanInfo = async function () {
  //deploy mcdex and then load
  await deployPerpLocally();
  //get MCDEXAddresses
  const data = fs.readFileSync(__dirname + "/../perp-lushan/deployments/local.deployment.js", "utf8");
  return JSON.parse(data);
};

const deployPerpLocallyMainnet = async function () {
  // console.log("deploying MCDEX locally,please wait...");
  const { stdout, stderr } = await exec(
    "cd perp-lushan/ && pwd && npx hardhat run scripts/deploy_local_perp_mainnet.ts --network local && cd ..  && pwd",
  );
  if (stderr) {
    console.error(`error: ${stderr}`);
  }
  // console.log(`output: ${stdout}`);
  // console.log("deployment done");
};

const loadPerpLushanInfoMainnet = async function () {
  //deploy mcdex and then load
  await deployPerpLocallyMainnet();
  //get MCDEXAddresses
  const data = fs.readFileSync(__dirname + "/../perp-lushan/deployments/local.deployment.js", "utf8");
  return JSON.parse(data);
};

const toBigNumber = amount => {
  const amountBN = new bn(amount.toString());
  const ONE = new bn(utils.parseEther("1").toString());
  return amountBN.div(ONE);
};
const fromBigNumber = amount => {
  const ONE = new bn(utils.parseEther("1").toString());
  const amountInWei = amount.times(ONE).integerValue(); //ignore after 18 decimals
  return BigNumber.from(amountInWei.toString());
};
const rpcCall = async (callType, params) => {
  return await hre.network.provider.request({
    method: callType,
    params: params,
  });
};
const snapshot = async () => {
  return await rpcCall("evm_snapshot", []);
};
const revertToSnapshot = async snapId => {
  return await rpcCall("evm_revert", [snapId]);
};
const displayNicely = function (Obj) {
  colors.setTheme({
    key: "bgGreen",
    value: "cyan",
  });
  Object.keys(Obj).forEach(function (key) {
    const value = Obj[key];
    let showValue = value;
    if (value == null) {
      console.log(`${key.bgGreen} : ${showValue}`);
    } else if (BigNumber.isBigNumber(value)) {
      showValue = value.toString();
    } else if (typeof value === "object") {
      console.log("\n");
      console.log(key);
      if (value instanceof Map) {
        for (let i = 0; i < value.size; i++) {
          console.log(i);
          displayNicely(value.get(i));
        }
      } else {
        displayNicely(value);
      }
      showValue = null;
    }
    if (showValue !== null) {
      console.log(`${key.bgGreen} : ${showValue}`);
    }
  });
};

const convertToExpectedDecimals = (amount, currentDecimals, expectedDecimals) => {
  return amount.mul(parseUnits("1", expectedDecimals)).div(parseUnits("1", currentDecimals));
};

module.exports = {
  convertToExpectedDecimals,
  displayNicely,
  tokenTransfers,
  loadMCDEXInfo,
  loadPerpLushanInfo,
  loadPerpLushanInfoMainnet,
  toBigNumber,
  fromBigNumber,
  snapshot,
  revertToSnapshot,
};
