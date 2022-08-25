// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.3;

// Source 
// https://github.com/perpetual-protocol/perp-oracle-contract/blob/main/contracts/interface/IPriceFeed.sol
interface IPriceFeed {
    function decimals() external view returns (uint8);

    /// @dev Returns the index price of the token.
    /// @param interval The interval represents twap interval.
    function getPrice(uint256 interval) external view returns (uint256);
}


// Source 
// https://github.com/perpetual-protocol/perp-oracle-contract/blob/main/contracts/interface/IPriceFeedV2.sol
interface IPriceFeedV2 is IPriceFeed {
    /// @dev Returns the cached index price of the token.
    /// @param interval The interval represents twap interval.
    function cacheTwap(uint256 interval) external returns (uint256);
}

contract MockPriceFeed is IPriceFeedV2 {
    address public realPriceFeed;
    bool public isOverride;
    uint256 public latestPrice;
    uint8 public _decimals;

    function setRealPriceFeed(address _realPriceFeed) external {
        realPriceFeed = _realPriceFeed;
        _decimals = IPriceFeedV2(realPriceFeed).decimals();
    }

    function setPrice(uint256 _price) external {
        isOverride = true;
        // TODO: Understand why this fixing factor
        latestPrice = _price / 10**(_decimals+2);
    }

    function decimals() public view override returns(uint8) {
        return _decimals;
    }

    function cacheTwap(uint256 interval) external override returns (uint256) {
        // TODO: Implement
        return IPriceFeedV2(realPriceFeed).cacheTwap(interval);
    }

    function getPrice(uint256 interval) external view override returns(uint256) {
        return (isOverride) ? latestPrice : IPriceFeedV2(realPriceFeed).getPrice(interval);
    }

}

