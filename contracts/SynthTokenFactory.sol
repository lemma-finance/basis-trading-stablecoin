// SPDX-License-Identifier: MIT
pragma solidity ^0.8.3;

import "./SynthToken.sol";
import "./interfaces/IGenericProxyFactory.sol";
import "hardhat/console.sol";

contract SynthTokenFactory {
    
    /// @notice SynthToken Contract
    SynthToken public synthInstance;

    /// @notice GenericProxyFactory Contract with OZ ClonesUpgradable
    IGenericProxyFactory public iGenericProxyFactory;

    /**
     * @notice constructor of SynthToken factory contract
     * @param _iGenericProxyFactory it is used to clone the synthToken, underthehood it is using OZ ClonesUpgradable
     */
    constructor(address _iGenericProxyFactory) {
        synthInstance = new SynthToken();
        iGenericProxyFactory = IGenericProxyFactory(_iGenericProxyFactory);
    }
    
    /**
     * @notice createNewProxy will create clone of SynthToken
     * @return instanceCreated new address of instance created 
     */
    function createNewProxy(
        address trustedForwarder,
        address collateralAddress,
        address perpetualDEXWrapperAddress,
        string memory name,
        string memory symbol
    ) public returns (address instanceCreated, bytes memory result) {
            (instanceCreated, result)= iGenericProxyFactory.create(address(synthInstance), '' );
            SynthToken newSynthInstance = SynthToken(instanceCreated);
            newSynthInstance.initialize(
                trustedForwarder,
                collateralAddress,
                perpetualDEXWrapperAddress,
                name,
                symbol
            );
    }
}