
var colors = require('colors');
const { utils, BigNumber } = require('ethers');
const { normalizeBigNumberish } = require("@mcdex/mai3.js");

const toBigNumber = (amount) => {
    const amountBN = normalizeBigNumberish(amount.toString());
    const ONE = normalizeBigNumberish(utils.parseEther("1").toString());
    return amountBN.div(ONE);
};
const fromBigNumber = (amount) => {
    const ONE = new normalizeBigNumberish(utils.parseEther("1").toString());
    const amountInWei = (amount.times(ONE)).integerValue().toFixed(); //ignore after 18 decimals (add toFixed to have the value in string format)
    // console.log("amountInWei", amountInWei.toString());
    return BigNumber.from(amountInWei.toString());
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

module.exports = { toBigNumber, fromBigNumber, displayNicely };

