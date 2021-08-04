// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;
import { ERC20Upgradeable, IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { IPerpetualDEXWrapper } from "./interfaces/IPerpetualDEXWrapper.sol";

import "hardhat/console.sol";

//TODO: consider adding permit function
contract USDLemma is ERC20Upgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {
    mapping(uint256 => mapping(address => address)) public perpetualDEXWrappers;

    function initialize(
        address trustedForwarder,
        address collateralAddress,
        address perpetualDEXWrapperAddress
    ) external initializer {
        __Ownable_init();
        __ERC20_init("USDLemma", "USDL");
        __ERC2771Context_init(trustedForwarder);
        addPerpetualDEXWrapper(0, collateralAddress, perpetualDEXWrapperAddress);
    }

    function addPerpetualDEXWrapper(
        uint256 perpetualDEXIndex,
        address collateralAddress,
        address perpetualDEXWrapperAddress
    ) public onlyOwner {
        perpetualDEXWrappers[perpetualDEXIndex][collateralAddress] = perpetualDEXWrapperAddress;
    }

    function depositTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 maxCollateralRequired,
        IERC20Upgradeable collateral
    ) public {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        uint256 collateralRequired = perpDEXWrapper.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        require(collateralRequired <= maxCollateralRequired, "collateral required execeeds maximum");
        collateral.transferFrom(_msgSender(), address(perpDEXWrapper), collateralRequired);
        perpDEXWrapper.open(amount);
        _mint(to, amount);
    }

    function withdrawTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 minCollateralToGetBack,
        IERC20Upgradeable collateral
    ) public {
        _burn(_msgSender(), amount);
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        uint256 collateralToGetBack = perpDEXWrapper.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
        require(collateralToGetBack >= minCollateralToGetBack, "collateral got back is too low");
        perpDEXWrapper.close(amount);
        collateral.transfer(to, collateralToGetBack);
    }

    function deposit(
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 maxCollateralRequired,
        IERC20Upgradeable collateral
    ) public {
        depositTo(_msgSender(), amount, perpetualDEXIndex, maxCollateralRequired, collateral);
    }

    function withdraw(
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 minCollateralToGetBack,
        IERC20Upgradeable collateral
    ) public { 
        withdrawTo(_msgSender(), amount, perpetualDEXIndex, minCollateralToGetBack, collateral);
    }

    //TODO: make a helper contract that uses onTransfer hook

    function _msgSender()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        //ERC2771ContextUpgradeable._msgSender();
        return super._msgSender();
    }

    function _msgData()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata)
    {
        //ERC2771ContextUpgradeable._msgData();
        return super._msgData();
    }
}
