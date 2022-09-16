const ethers = require("ethers");
const config = require("./config.json");
const myArgs = process.argv.slice(2);

cmd = myArgs[0];
type = myArgs[1];

// console.log(cmd);

// cmd = `config["config"]["deployment"]`;

// const n = myArgs[0];
// const idx = myArgs[1];
// cmd = `config["traces"]["tracesOf${n}"][${idx}]`;



if(type=="address") {
    const res = eval(cmd);

    // console.log(res);
    console.log(ethers.utils.defaultAbiCoder.encode([`address`], [res]));
} 

if(type=="number") {
    const res = eval(cmd);

    // console.log(res);
    console.log(ethers.utils.defaultAbiCoder.encode([`uint256`], [res]));    
}

if(type=="amount") {
    const b = eval(`${cmd}[\"base\"]`);
    const e = eval(`${cmd}[\"exp\"]`);

    // console.log(res);
    console.log(ethers.utils.defaultAbiCoder.encode([`uint256`, `uint256`], [b,e]));    
}

