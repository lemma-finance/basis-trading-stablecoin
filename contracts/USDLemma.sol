// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;
import { ERC20Upgradeable, IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { Utils } from "./libraries/Utils.sol";
import { IPerpetualDEXWrapper } from "./interfaces/IPerpetualDEXWrapper.sol";

import "hardhat/console.sol";

//TODO: consider adding permit function
contract USDLemma is ERC20Upgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {
    using SafeCastUpgradeable for int256;
    using Utils for int256;

    address public lemmaTreasury;
    address public stakingContractAddress;
    uint256 public fees;

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
        lemmaTreasury = 0x0000000000000000000000000000000000000004;
        stakingContractAddress = 0x0000000000000000000000000000000000000005;
        fees = 30;
    }

    function setStakingContractAddress(address _stakingContractAddress) public onlyOwner {
        stakingContractAddress = _stakingContractAddress;
    }

    function setLemmaTreasury(address _lemmaTreasury) public onlyOwner {
        lemmaTreasury = _lemmaTreasury;
    }

    function setFees(uint256 _fees) public onlyOwner {
        fees = _fees;
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

    function reBalance(
        uint256 perpetualDEXIndex,
        IERC20Upgradeable collateral,
        int256 amount,
        bytes calldata data
    ) external {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(perpDEXWrapper.reBalance(msg.sender, amount, data), "rebalance not done");
        //burn or mint from the staker contract
        if (amount >= 0) {
            uint256 totalAmountToMint = amount.toUint256();
            uint256 amountToLemmaTreasury = (totalAmountToMint * fees) / 10**4;
            uint256 amountToStakingContract = totalAmountToMint - amountToLemmaTreasury;
            _mint(lemmaTreasury, amountToLemmaTreasury);
            _mint(stakingContractAddress, amountToStakingContract);
        } else {
            uint256 totalAmountToBurn = amount.neg().toUint256();
            uint256 balanceOfStakingContract = balanceOf(stakingContractAddress);
            uint256 balanceOfLemmaTreasury = balanceOf(lemmaTreasury);

            uint256 amountBurntFromStakingContract = min(balanceOfStakingContract, totalAmountToBurn);
            uint256 amountBurntFromLemmaTreasury = min(
                balanceOfLemmaTreasury,
                totalAmountToBurn - amountBurntFromStakingContract
            );

            if (amountBurntFromStakingContract > 0) {
                _burn(stakingContractAddress, amountBurntFromStakingContract);
            }
            if (amountBurntFromLemmaTreasury > 0) {
                _burn(lemmaTreasury, amountBurntFromLemmaTreasury);
            }
            if ((amountBurntFromStakingContract + amountBurntFromLemmaTreasury) != totalAmountToBurn) {
                //need to handle this case via burning Lemma? or just let USDL value go down?
            }
        }
    }

    //TODO: move to the safeMathExt library
    function min(uint256 x, uint256 y) internal pure returns (uint256) {
        return (x < y) ? x : y;
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
