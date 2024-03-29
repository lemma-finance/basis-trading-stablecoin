// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

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

    function getMarginRequirementForLiquidation(address trader)
        external
        view
        returns (int256 marginRequirementForLiquidation);

    function getBase(address trader, address baseToken) external view returns (int256 baseAmount);

    function getQuote(address trader, address baseToken) external view returns (int256);

    function settleOwedRealizedPnl(address trader) external returns (int256);
}
