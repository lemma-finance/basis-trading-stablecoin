const hre = require("hardhat");
const { ethers, upgrades } = hre;

async function main() {
    const USDLAddress = "0xdb41ab644abca7f5ac579a5cf2f41e606c2d6abc";

    const USDLemma = await ethers.getContractFactory("USDLemma");
    await upgrades.upgradeProxy(USDLAddress, USDLemma);
    console.log("USDL upgraded");
}
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });