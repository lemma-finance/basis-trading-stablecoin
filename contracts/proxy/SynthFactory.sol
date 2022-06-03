// SPDX-License-Identifier: MIT
pragma solidity ^0.8.3;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "./SynthBeacon.sol";
import "../SynthToken.sol";
import "hardhat/console.sol";

contract SynthFactory {

    struct SynthStruct {
        address proxyAddress;
        address trustedForwarder;
        address collateralAddress;
        address perpetualDEXWrapperAddress;
        string name;
        string symbol;
    }
    mapping(address => SynthStruct) public synthMapping;
    SynthBeacon public beacon;

    constructor(address _synthLogic) {
        beacon = new SynthBeacon(_synthLogic);
    }

    function create(
        address _trustedForwarder,
        address _collateralAddress,
        address _perpetualDEXWrapperAddress,
        string memory _name,
        string memory _symbol
    ) external returns(address) {
        BeaconProxy proxy = new BeaconProxy(address(beacon), 
            abi.encodeWithSelector(
                SynthToken(address(0)).initialize.selector, 
                _trustedForwarder, 
                _collateralAddress,
                _perpetualDEXWrapperAddress,
                _name,
                _symbol
            )
        );
        SynthStruct memory newSynthData = SynthStruct({
            proxyAddress: address(proxy),
            trustedForwarder: _trustedForwarder,
            collateralAddress: _collateralAddress,
            perpetualDEXWrapperAddress: _perpetualDEXWrapperAddress,
            name: _name,
            symbol: _symbol
        });
        synthMapping[_collateralAddress] = newSynthData;
        return address(proxy);
    }

    function getImplementation() public view returns(address) {
        return beacon.implementation(); 
    }

    function getBeacon() public view returns(address) {
        return address(beacon); 
    }

    function getSynthData(address _collateralAddress) public view returns(SynthStruct memory) {
        return synthMapping[_collateralAddress];
    }
}