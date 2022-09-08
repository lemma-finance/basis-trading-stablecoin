// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;

import "forge-std/Script.sol";
import "../contracts/LemmaSynth.sol";
import "../contracts/xLemmaSynth.sol";
import "../contracts/SettlementTokenManager.sol";
import "../contracts/wrappers/PerpLemmaCommon.sol";
import "forge-std/Test.sol";

contract xLemmaSynthDeploy is Script {
    address lemmaSynthAddress = 0xac7b51F1D5Da49c64fAe5ef7D5Dc2869389A46FC;
    xLemmaSynth xLSynth;

    function run() external {
        vm.startBroadcast();
        xLSynth = new xLemmaSynth();
        xLSynth.initialize(
            msg.sender, lemmaSynthAddress, address(0), "xLemmaSynth", "xLSynth"
        );
        console.log("xLSynth: ", address(xLSynth));
        vm.stopBroadcast();
    }
}
