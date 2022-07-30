
const { exec } = require("child_process");

// var exec = require('child_process').exec;
function execute(command, callback){
    exec(command, function(error, stdout, stderr){ callback(stdout); });
};

const configFile = process.argv[2];
const args = process.argv.slice(3);
console.log(`Trying to open ${configFile}`);
const config = require(configFile);
let cmd = `CHAINID=${config['chainID']} forge test --ffi --fork-url ${config['rpc']} --fork-block-number ${config['blockNumber']} `;
for(i=0; i<args.length; ++i) {
    cmd += `${args[i]} `;
}

console.log(`Running\n${cmd}`);

execute(cmd, console.log);
