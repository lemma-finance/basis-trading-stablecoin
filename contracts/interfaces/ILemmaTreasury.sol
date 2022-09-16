// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.3;

import "../interfaces/IERC20Decimals.sol";

interface ILemmaTreasury {
    function isCollateralAvailable(address collateral, uint256 amount) external view returns (bool);

    function recapitalizeWrapper(address wrapper, uint256 amount) external;
}
