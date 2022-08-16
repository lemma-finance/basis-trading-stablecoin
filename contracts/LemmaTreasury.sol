// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;


import "./interfaces/ILemmaTreasury.sol";
import { IPerpetualMixDEXWrapper } from "./interfaces/IPerpetualMixDEXWrapper.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IPerpetualMixDEXWrapper } from "./interfaces/IPerpetualMixDEXWrapper.sol";
import "./interfaces/IERC20Decimals.sol";
import "forge-std/Test.sol";

contract LemmaTreasury is ILemmaTreasury {
    // NOTE: Requires approve from all the PerpDEXWrappers


    // NOTE: Add Custom Logic to check this 
    function isCollateralAvailable(address collateral, uint256 amount) public view override returns(bool) {
        // NOTE: Now naive logic 
        return IERC20Decimals(collateral).balanceOf(address(this)) >= amount;
    }



    // TODO: Add role check
    function recapitalizeWrapper(address wrapper, uint256 amount) external override {
        address settlementToken = IPerpetualMixDEXWrapper(wrapper).getSettlementToken();
        require(isCollateralAvailable(settlementToken, amount), "Collateral not available in enough quantity");
        SafeERC20Upgradeable.safeApprove(IERC20Decimals(settlementToken), wrapper, 0);
        SafeERC20Upgradeable.safeApprove(IERC20Decimals(settlementToken), wrapper, amount);
        console.log("[recapitalizeWrapper()] Trying to recapitalize PerpWrapper for USDC Amount = ", amount);
        IPerpetualMixDEXWrapper(wrapper).depositSettlementToken(amount);
    }

}






