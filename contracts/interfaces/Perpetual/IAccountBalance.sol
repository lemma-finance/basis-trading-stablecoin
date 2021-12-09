// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.3;
// pragma abicoder v2;

interface IAccountBalance {
    function getPositionSize(address trader, address baseToken) external view returns (int256);
}
