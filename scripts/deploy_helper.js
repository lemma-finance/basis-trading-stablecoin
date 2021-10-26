const hre = require("hardhat");
const { ethers } = hre;
const { constants, BigNumber } = ethers;
const { AddressZero } = constants;
const { MaxUint256 } = require("@ethersproject/constants");
const { utils } = require("ethers");

const mainnet = {
    "USDLemma": "0xB801A252d8996444929391519251B659c87b8eCb",
    "MCDEXLemma": "0x1ECC6F87e16a11ad31C46D0d2fc5fD0cbff58638",
    "XUSDL": "0xb1293BFF647c497E839AF95908cEA12cfd9Bf551",
    "LemmaRouter": "0x04b703d9b6433f84F1ef968462aA3CE52AE89334",
    "WETH": "0x207eD1742cc0BeBD03E50e855d3a14E41f93A461"
};

const ZERO = BigNumber.from("0");
//add it in prod
// const TRUSTED_FORWARDER = {
//     42: "0xF82986F574803dfFd9609BE8b9c7B92f63a1410E",
// };
const printTx = async (hash) => {
    await tokenTransfers.print(hash, [], false);
};
async function main() {
    [defaultSigner, reBalancer, lemmaTreasury, trustedForwarder] = await ethers.getSigners();
    console.log("defaultSigner", defaultSigner.address);
    // console.log(hre.network);
    const arbProvider = ethers.getDefaultProvider(hre.network.config.url);
    const { chainId } = await arbProvider.getNetwork();

    // const chainId = 42;//kovan
    // const arbProvider = ethers.getDefaultProvider('https://kovan.infura.io/v3/2a1a54c3aa374385ae4531da66fdf150');

    const Helper = await ethers.getContractFactory("Helper");
    const helper = await helper.deploy();

    console.log(`helper Deployed at ${helper.address}`);
}
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });