// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;
import { ERC20Upgradeable, IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { IPerpetualDEXWrapper } from "./interfaces/IPerpetualDEXWrapper.sol";

//TODO: consider adding permit function
contract USDLemma is ERC20Upgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {
    mapping(uint256 => mapping(address => address)) perpetualDEXWrappers;

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
        IERC20Upgradeable collateral
    ) public {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        uint256 collateralRequired = perpDEXWrapper.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
        collateral.transferFrom(_msgSender(), address(perpDEXWrapper), collateralRequired);
        perpDEXWrapper.open(amount);
        _mint(to, amount);
    }

    function withdrawTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        IERC20Upgradeable collateral
    ) public {
        _burn(_msgSender(), amount);
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        uint256 collateralToGetBack = perpDEXWrapper.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
        perpDEXWrapper.close(amount);
        collateral.transfer(to, collateralToGetBack);
    }

    function deposit(
        uint256 amount,
        uint256 perpetualDEXIndex,
        IERC20Upgradeable collateral
    ) external {
        depositTo(_msgSender(), amount, perpetualDEXIndex, collateral);
    }

    function withdraw(
        uint256 amount,
        uint256 perpetualDEXIndex,
        IERC20Upgradeable collateral
    ) external {
        withdrawTo(_msgSender(), amount, perpetualDEXIndex, collateral);
    }

    //TODO: make a helper contract that used onTransfer hook

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
