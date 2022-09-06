const ethers = require("ethers");
const config = require("./config.json");
const myArgs = process.argv.slice(2);

cmd = `config["traces"]["${config['config']['traceGroup']}"][${config['config']['traceIdx']}]['data']`;

// const n = myArgs[0];
// const idx = myArgs[1];
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


