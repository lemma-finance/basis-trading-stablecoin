import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@typechain/hardhat";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
import { HardhatUserConfig, task } from "hardhat/config";

task("accounts", "Prints the list of accounts", async (args, hre) => {
  const accounts = await hre.ethers.getSigners();
  for (const account of accounts) {
    console.log(await account.address);
  }
});

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      // forking: {
      //   url: "https://mainnet.infura.io/v3/" + process.env.INFURA_KEY,
      // },
      // accounts: {
      //   mnemonic: process.env.MNEMONIC
      // }
      allowUnlimitedContractSize: true,
    },
    local: {
      url: "http://localhost:8545",
    },
    localDocker: {
      url: "http://0.0.0.0:8545",
    },
    arbitrumTestnet: {
      url: "https://rinkeby.arbitrum.io/rpc",
      accounts: {
        mnemonic: process.env.MNEMONIC,
      },
    },
    optimismKovan: {
      url: "https://optimism-kovan.infura.io/v3/" + process.env.INFURA_KEY,
      accounts: {
        mnemonic: process.env.MNEMONIC,
      },
    },
    arbitrum: {
      // url: "https://arbitrum-mainnet.infura.io/v3/" + process.env.INFURA_KEY,
      url: "https://arb1.arbitrum.io/rpc",
      accounts: {
        mnemonic: process.env.MNEMONIC,
      },
    },
    kovan: {
      url: "https://kovan.infura.io/v3/" + process.env.INFURA_KEY,
      accounts: {
        mnemonic: process.env.MNEMONIC,
      },
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY,
  },
  solidity: {
    version: "0.8.3",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "istanbul",
    },
  },
  typechain: {
    outDir: "types",
    target: "ethers-v5",
  },
  mocha: {
    timeout: 1000000, //1000 secs
  },
};

export default config;
