// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

interface IIndexPrice {
    /// @dev Returns the index price of the token.
    /// @param interval The interval represents twap interval.
    /// @return indexPrice Twap price with interval
    function getIndexPrice(uint256 interval) external view returns (uint256 indexPrice);
}
