// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.3;
// pragma abicoder v2;

interface IAccountBalance {
    function getTotalPositionSize(address trader, address baseToken) external view returns (int256);
    function getPositionSize(address trader, address baseToken) external view returns (int256);
    function getTotalPositionValue(address trader, address baseToken) external view returns (int256);
    function getPnlAndPendingFee(address trader)
    external
    view
    returns (
        int256 owedRealizedPnl,
        int256 unrealizedPnl,
        uint256 pendingFee
    );
    function getBase(address trader, address baseToken) external view returns (int256 baseAmount);
}
