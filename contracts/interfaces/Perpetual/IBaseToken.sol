// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.3;

interface IBaseToken {
    // Do NOT change the order of enum values because it will break backwards compatibility
    enum Status {
        Open,
        Paused,
        Closed
    }

    event PriceFeedChanged(address indexed priceFeed);
    event StatusUpdated(Status indexed status);

    function pause() external;

    function close() external;

    function close(uint256 closedPrice) external;

    /// @notice Get the price feed address
    /// @return priceFeed the current price feed
    function getPriceFeed() external view returns (address priceFeed);

    function getPausedTimestamp() external view returns (uint256);

    function getPausedIndexPrice() external view returns (uint256);

    function getClosedPrice() external view returns (uint256);

    function isOpen() external view returns (bool);

    function isPaused() external view returns (bool);

    function isClosed() external view returns (bool);

    function owner() external view returns (address);
}
