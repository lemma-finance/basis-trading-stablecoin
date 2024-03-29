import colors from "colors";
import fs from "fs";
import hre from "hardhat";
import { utils } from "ethers";
import tokenTransfers from "truffle-token-test-utils";
import util from "util";
import axios from "axios";
const exec = util.promisify(require("child_process").exec);
import bn from "bignumber.js";

const { BigNumber } = hre.ethers;
tokenTransfers.setCurrentProvider(hre.ethers.providers.JsonRpcProvider);

export async function deployMCDEXLocally() {
  // console.log("deploying MCDEX locally,please wait...");
  const { stdout, stderr } = await exec(
    "cd mai-protocol-v3/ && pwd && npx hardhat run scripts/deploy.ts --network local && cd ..  && pwd",
  );
  if (stderr) {
    console.error(`error1: ${stderr}`);
  }
  // console.log(`output: ${stdout}`);
  // console.log("deployment done");
}

export async function loadMCDEXInfo() {
  //deploy mcdex and then load
  await deployMCDEXLocally();
  //get MCDEXAddresses
  const data = fs.readFileSync(__dirname + "/../../mai-protocol-v3/deployments/local.deployment.js", "utf8");
  // console.log(JSON.parse(data))
  return JSON.parse(data);
}

export async function fetchFromURL(url) {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.log(error.response.body);
  }
}

export const delay = ms => new Promise(res => setTimeout(res, ms));

export async function toBigNumber(amount: any) {
  const amountBN = new bn(amount.toString());
  const ONE = new bn(utils.parseEther("1").toString());
  return amountBN.div(ONE);
}

export async function fromBigNumber(amount: any) {
  const ONE = new bn(utils.parseEther("1").toString());
  const amountInWei = amount.times(ONE).integerValue(); //ignore after 18 decimals
  return BigNumber.from(amountInWei.toString());
}

export async function rpcCall(callType: any, params: any) {
  return await hre.network.provider.request({
    method: callType,
    params: params,
  });
}

export async function snapshot() {
  return await rpcCall("evm_snapshot", []);
}

export async function revertToSnapshot(snapId: any) {
  return await rpcCall("evm_revert", [snapId]);
}

export async function displayNicely(Obj: any) {
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
}
