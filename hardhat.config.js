require("@nomiclabs/hardhat-waffle");
require("@openzeppelin/hardhat-upgrades");
require("@nomiclabs/hardhat-ethers");
require("solidity-coverage");
require('hardhat-deploy');
require('@giry/hardhat-test-solidity');
require("dotenv").config();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.8.3",
  networks: {
    hardhat: {
      // forking: {
      //   url: "https://kovan.infura.io/v3/" + process.env.INFURA_KEY,
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
        mnemonic: process.env.MNEMONIC
      }
    },
    kovan: {
      url: "https://kovan.infura.io/v3/" + process.env.INFURA_KEY,
      accounts: {
        mnemonic: process.env.MNEMONIC
      }
    }
  },
  solidity: {
    version: "0.8.3",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  mocha: {
    timeout: 1000000 //1000 secs
  },

};

