const ethers = require("ethers");
const fs = require("fs");
const myArgs = process.argv.slice(2);
const res = {
  isFound: myArgs[0],
  direction: myArgs[1],
  amount: myArgs[2],
};

const data = JSON.stringify(res);

//console.log("[write_config.js] Writing Arb");

fs.writeFile("bot/arb.json", data, err => {
  if (err) {
    throw err;
  }

  //console.log(ethers.utils.defaultAbiCoder.encode([`uint256`], [1]));
  //console.log("JSON data is saved.");
});
