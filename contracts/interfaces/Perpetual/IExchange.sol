// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

interface IExchange {
    /// @notice Get all the pending funding payment for a trader
    /// @return pendingFundingPayment The pending funding payment of the trader.
    /// Positive value means the trader pays funding, negative value means the trader receives funding.
    function getAllPendingFundingPayment(address trader) external view returns (int256 pendingFundingPayment);

    /// @notice Get the pending funding payment for a trader in a given market
    /// @dev this is the view version of _updateFundingGrowth()
    /// @return pendingFundingPayment The pending funding payment of a trader in one market,
    /// including liquidity & balance coefficients. Positive value means the trader pays funding,
    /// negative value means the trader receives funding.
    function getPendingFundingPayment(address trader, address baseToken)
        external
        view
        returns (int256 pendingFundingPayment);
}
