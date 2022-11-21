// SPDX-License-Identifier: GPL-2.0-or-later
// pragma solidity 0.7.6;
// pragma abicoder v2;

import { Collateral } from "./lib/Collateral.sol";

interface ICollateralManager {
    function getPrice(address token, uint256 interval) external view returns (uint256);
    function getPriceFeedDecimals(address token) external view returns (uint8);
    function getCollateralConfig(address token) external view returns (Collateral.Config memory);
}