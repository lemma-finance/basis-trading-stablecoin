// SPDX-License-Identifier: MIT License
pragma solidity >=0.6.0 <0.9.0;

contract TestSetPriceFeed {
    function decimals() external view returns (uint8) {
        return 18;
    }

    /// @dev Returns the index price of the token.
    /// @param interval The interval represents twap interval.
    function getPrice(uint256 interval) external view returns (uint256) {
        return 1098e18;
    }
}
