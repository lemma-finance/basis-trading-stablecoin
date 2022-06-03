// SPDX-License-Identifier: MIT
pragma solidity ^0.8.3;

import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

contract SynthBeacon {

    UpgradeableBeacon public beacon;
    address public synthLogic;

    constructor(address _synthLogic) {
        beacon = new UpgradeableBeacon(_synthLogic);
        synthLogic = _synthLogic;
    }

    function update(address _synthLogic) public {
        beacon.upgradeTo(_synthLogic);
        synthLogic = _synthLogic;
    }

    function implementation() public view returns(address) {
        return beacon.implementation(); 
    }
}
