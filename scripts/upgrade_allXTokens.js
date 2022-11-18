const hre = require("hardhat");
const { ethers, upgrades } = hre;

async function main() {

    const xUSDLAddress = "0x252ea7e68a27390ce0d53851192839a39ab8b38c";
    const xLemmaSynthAddresses = [
        "0x89c4e9a23Db43641e1B3C5E0691b100E64b50E32",
        "0x7D39583e262CBe75a1D698A6D79cd5a2958cb61d",
        "0x823c55654d6E860F40070ee5625ff8b091df4269",
        "0x90356c24c1F95CF29543D45122f2554b6A74f201",
        "0x754E6134872D7a501fFEbA6c186e187DBFdf6f4a",
        "0x3C7E63ba04FF4d5f0673bc93bBD9E73E9DD37Ed2"
    ];

    const xUSDL = await ethers.getContractFactory("xUSDL");
    await upgrades.upgradeProxy(xUSDLAddress, xUSDL);

    const xLemmaSynth = await ethers.getContractFactory("xLemmaSynth");
    for (let i = 0; i < xLemmaSynthAddresses.length; i++) {
        const xLemmaSynthAddress = xLemmaSynthAddresses[i];
        await upgrades.upgradeProxy(xLemmaSynthAddress, xLemmaSynth);
    }
    console.log("all the xTokens upgraded");
}
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
