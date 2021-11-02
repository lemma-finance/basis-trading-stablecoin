const hre = require("hardhat");
const { ethers } = hre;

async function main() {
    [defaultSigner, reBalancer,] = await ethers.getSigners();
    console.log("defaultSigner", defaultSigner.address);

    const Helper = await ethers.getContractFactory("Helper");
    const helper = await Helper.deploy();

    console.log(`helper Deployed at ${helper.address}`);
}
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });