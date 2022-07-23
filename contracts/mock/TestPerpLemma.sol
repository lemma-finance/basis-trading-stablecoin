// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;

import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { PerpLemmaCommon } from "../wrappers/PerpLemmaCommon.sol";
import "../interfaces/IERC20Decimals.sol";
import "forge-std/Test.sol";

contract TestPerpLemma is PerpLemmaCommon {
    function depositAnyAsset(uint256 amount, address collateral) public {
        SafeERC20Upgradeable.safeTransferFrom(IERC20Decimals(collateral), msg.sender, address(this), amount);
    }

    function withdrawAnyAsset(uint256 amount, address collateral, address to) public {
        SafeERC20Upgradeable.safeTransfer(IERC20Decimals(collateral), to, amount);
    }
}
