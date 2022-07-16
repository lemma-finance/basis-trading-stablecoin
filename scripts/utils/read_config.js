const ethers = require("ethers");
const config = require("./config.json");
const myArgs = process.argv.slice(2);



const res = eval(myArgs[0]);
// console.log(`Converting res = ${res}`);
console.log(ethers.utils.defaultAbiCoder.encode(["address"], [res]));

// test = "config['optimism']['UniswapV3']['router']";
// console.log(eval(test));

// const res = ethers.utils.defaultAbiCoder.encode(["string"], ["gm"]);
// console.log(res);
// console.log("0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002676d000000000000000000000000000000000000000000000000000000000000");
// console.log(`Len Argv = ${myArgs.length}`);
