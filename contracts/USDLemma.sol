// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;
import { ERC20Upgradeable, IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { IPerpetualDEXWrapper } from "./interfaces/IPerpetualDEXWrapper.sol";

//TODO: consider adding permit function
contract USDLemma is ERC20Upgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {
    //collateral to wrapper
    mapping(address => address) public mcdexWrappers;

    function initialize(address[] calldata collateralAddresses, address[] memory wrapperAddresses)
        external
        initializer
    {
        for (uint256 i = 0; i < collateralAddresses.length; i++) {
            setMCDEXWrapper(collateralAddresses[i], wrapperAddresses[i]);
        }
    }

    function setMCDEXWrapper(address collateralAddress, address wrapperAddress) public onlyOwner {
        mcdexWrappers[collateralAddress] = wrapperAddress;
    }

    // function setMCDEXWrappers(address[] calldata collateralAddresses, address[] calldata wrapperAddresses)
    //     external
    //     onlyOwner
    // {}

    function deposit(uint256 value, IERC20Upgradeable collateral) external {
        //1. transferFrom msg.sender to the mcdexLemma
        //2. call open which will deposit WETH as collateral and go short
        //3. mint USDL by getting the info from mcdexLemma about how much to mint
        IPerpetualDEXWrapper mcdexWrapper = IPerpetualDEXWrapper(mcdexWrappers[address(collateral)]);
        uint256 collateralRequired = mcdexWrapper.getCollateralAmountGivenUnderlyingAssetAmount(value, false);
        collateral.transferFrom(_msgSender(), address(mcdexWrapper), collateralRequired);
        mcdexWrapper.open(value);
        _mint(_msgSender(), value);
    }

    function withdraw(uint256 value, IERC20Upgradeable collateral) external {
        _burn(_msgSender(), value);

        IPerpetualDEXWrapper mcdexWrapper = IPerpetualDEXWrapper(mcdexWrappers[address(collateral)]);
        uint256 collateralToGetBack = mcdexWrapper.getCollateralAmountGivenUnderlyingAssetAmount(value, false);
        mcdexWrapper.close(value);
        collateral.transfer(_msgSender(), collateralToGetBack);
    }

    function depositTo(address to, uint256 value) external {}

    function withdrawTo(address to, uint256 value) external {
        _burn(_msgSender(), value);
    }

    function withdrawFrom(
        address from,
        address to,
        uint256 value
    ) external {
        //recreate _burnFrom instead of using the openzeppelin one as it should be clear that we do not want to allow burning of USDL
    }

    //TODO: use onTokenTransfer hook

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
