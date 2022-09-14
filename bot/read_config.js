const ethers = require("ethers");
const config = require("./config.json");
const myArgs = process.argv.slice(2);

cmd = myArgs[0];

// console.log(cmd);

// cmd = `config["config"]["deployment"]`;

// const n = myArgs[0];
// const idx = myArgs[1];
// cmd = `config["traces"]["tracesOf${n}"][${idx}]`;
const res = eval(cmd);

// console.log(res);
console.log(ethers.utils.defaultAbiCoder.encode([`uint256`], [res]));
