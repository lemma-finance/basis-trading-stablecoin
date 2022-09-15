// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.3;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IPerpetualMixDEXWrapper } from "./interfaces/IPerpetualMixDEXWrapper.sol";
import "./interfaces/ILemmaTreasury.sol";
import "./interfaces/IERC20Decimals.sol";

contract LemmaTreasury is ILemmaTreasury, AccessControlUpgradeable {

    // Different Roles to perform restricted tx
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    function initialize() external initializer {
        __AccessControl_init();
        _setRoleAdmin(OWNER_ROLE, ADMIN_ROLE);
        _setupRole(ADMIN_ROLE, msg.sender);
        grantRole(OWNER_ROLE, msg.sender);
    }

    /// @notice changeAdmin is to change address of admin role
    /// Only current admin can change admin and after new admin current admin address will be no more admin
    /// @param newAdmin new admin address
    function changeAdmin(address newAdmin) external onlyRole(ADMIN_ROLE) {
        require(newAdmin != address(0), "NewAdmin should not ZERO address");
        require(newAdmin != msg.sender, "Admin Addresses should not be same");
        _setupRole(ADMIN_ROLE, newAdmin);
        renounceRole(ADMIN_ROLE, msg.sender);
    }

    // NOTE: Requires approve from all the PerpDEXWrappers
    // NOTE: Add Custom Logic to check this
    function isCollateralAvailable(address collateral, uint256 amount) public view override returns (bool) {
        // NOTE: Now naive logic
        return IERC20Decimals(collateral).balanceOf(address(this)) >= amount;
    }

    function recapitalizeWrapper(address wrapper, uint256 amount) external override onlyRole(OWNER_ROLE)  {
        address settlementToken = IPerpetualMixDEXWrapper(wrapper).getSettlementToken();
        require(isCollateralAvailable(settlementToken, amount), "Collateral not available in enough quantity");
        SafeERC20Upgradeable.safeApprove(IERC20Decimals(settlementToken), wrapper, 0);
        SafeERC20Upgradeable.safeApprove(IERC20Decimals(settlementToken), wrapper, amount);
        IPerpetualMixDEXWrapper(wrapper).depositSettlementToken(amount);
    }
}
