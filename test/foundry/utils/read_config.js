const ethers = require("ethers");
const config = require("./config.json");
const myArgs = process.argv.slice(2);

let traceGroup = `${config['config']['traceGroup']}`;
let idx = `${config['config']['traceIdx']}`;

let cmd = `config["traces"]["${traceGroup}"][${idx}]['data']`;

if(myArgs.length == 2) {
    cmd = `config["traces"]["${myArgs[0]}"][${myArgs[1]}]['data']`;
} 

// cmd = `config["traces"]["${traceGroup}"][${idx}]['data']`;
// cmd = `config["traces"]["${config['config']['traceGroup']}"][${config['config']['traceIdx']}]['data']`;

// cmd = `config["traces"]["tracesOf${n}"][${idx}]`;
const res = eval(cmd);
// console.log(`Converting res = ${res}`);
arr = []

for (i=0; i<res.length; ++i) {
    arr.push(res[i]["dt"]);
    arr.push(res[i]["dp"]);
}


// console.log(arr);

console.log(ethers.utils.defaultAbiCoder.encode([`int256[]`], [arr]));



