// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

contract TestSetPriceFeed {
    function decimals() external pure returns (uint8) {
        return 18;
    }

    /// @dev Returns the index price of the token.
    /// @param interval The interval represents twap interval.
    function getPrice(uint256 interval) external pure returns (uint256) {
        return 1098e18;
    }
}
