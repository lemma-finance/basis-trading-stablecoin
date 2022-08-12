// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;

import "forge-std/Script.sol";
import "../contracts/USDLemma.sol";
import "../contracts/xUSDL.sol";
import "../contracts/SettlementTokenManager.sol";
import "../contracts/wrappers/PerpLemmaCommon.sol";
import "forge-std/Test.sol";

contract xUSDLDeploy is Script {
    address usdLemmaAddress = 0xc34E7f18185b381d1d7aab8aeEC507e01f4276EE;
    xUSDL xusdl;

    function run() external {
        vm.startBroadcast();
        console.log('msg.sender-xUSDLDeploy', msg.sender);
        console.log('address(this)-xUSDLDeploy', address(this));
        xusdl = new xUSDL();
        xusdl.initialize(
            msg.sender,
            usdLemmaAddress,
            address(0)
        );
        console.log('xUSDL: ', address(xusdl));
        vm.stopBroadcast();
    }
}
