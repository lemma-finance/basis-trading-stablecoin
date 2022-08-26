// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.3;
import "forge-std/Test.sol";

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

contract MockPriceFeed is IPriceFeedV2, Test {
    address public realPriceFeed;
    bool public isOverride;
    uint256 public latestPrice;
    uint8 public _decimals;

    function setRealPriceFeed(address _realPriceFeed) external {
        realPriceFeed = _realPriceFeed;
        _decimals = IPriceFeedV2(realPriceFeed).decimals();
        // NOTE: Typically Perp uses interval=900 as it has observed from logs on the mocked `getPrice(interval)` called by Perp Protocol 
        latestPrice = IPriceFeedV2(realPriceFeed).getPrice(900);
    }

    function setPriceFromPriceFeed(uint256 _price) external {
        isOverride = true;
        // TODO: Understand why this fixing factor
        latestPrice = _price / 10**(_decimals+2);
    }

    function setPrice(uint256 _price) public {
        isOverride = true;
        // TODO: Understand why this fixing factor
        latestPrice = _price;
    }

    function advancePerc(uint256 deltaT, int256 pricePerc) external returns(uint256 nextPrice) {
        console.log("[_advancePerc()] Current Price = ", latestPrice);
        nextPrice = uint256(int256(latestPrice) * (int256(1e6) + pricePerc) / 1e6);
        console.log("[_advancePerc()] nextPrice = ", nextPrice);
        vm.warp(block.timestamp + deltaT);
        setPrice(nextPrice);
    }


    function decimals() public view override returns(uint8) {
        return _decimals;
    }

    function cacheTwap(uint256 interval) external override returns (uint256) {
        // TODO: Implement
        return IPriceFeedV2(realPriceFeed).cacheTwap(interval);
    }

    function getPrice(uint256 interval) public view override returns(uint256) {
        // console.log("[MockOracle getPrice()] interval = ", interval);
        return latestPrice;
        // return (isOverride) ? latestPrice : IPriceFeedV2(realPriceFeed).getPrice(interval);
    }

}

