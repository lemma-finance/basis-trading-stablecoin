const ethers = require("ethers");
const config = require("./config.json");
const myArgs = process.argv.slice(2);

const trace = myArgs[0];
const idx = myArgs[1];
cmd = `config["traces"][${trace}]["trace"][${idx}]`;
const res = eval(cmd);
console.log(`Converting res = ${res}`);
console.log(ethers.utils.defaultAbiCoder.encode(["uint256[2]"], [[res["dt"], res["dp"]]]));
