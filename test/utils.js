var colors = require('colors');
const fs = require("fs");
const hre = require("hardhat");
const { BigNumber } = hre.ethers;
const tokenTransfers = require("truffle-token-test-utils");
tokenTransfers.setCurrentProvider(hre.network.config.url);

const loadMCDEXInfo = function () {
    //get MCDEXAddresses
    const data = fs.readFileSync(__dirname + '/../mai-protocol-v3/deployments/local.deployment.js', 'utf8');
    return JSON.parse(data);

};
const displayNicely = function (Obj) {
    colors.setTheme({
        key: 'bgGreen',
        value: 'cyan',
    });
    Object.keys(Obj).forEach(function (key) {
        const value = Obj[key];
        let showValue = value;
        if (value == null) {
            console.log(`${key.bgGreen} : ${showValue}`);
        }
        else if (BigNumber.isBigNumber(value)) {
            showValue = value.toString();
        }
        else if (typeof value === 'object') {
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

module.exports = { displayNicely, tokenTransfers, loadMCDEXInfo };