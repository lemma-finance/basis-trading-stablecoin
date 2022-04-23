// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface IERC20Decimals is IERC20Upgradeable {
    function decimals() external view returns (uint8);
}
