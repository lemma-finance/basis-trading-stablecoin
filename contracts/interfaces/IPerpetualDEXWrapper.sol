// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;

interface IPerpetualDEXWrapper {
    function open(uint256 amount) external;

    function close(uint256 amount) external;

    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        external
        view
        returns (uint256 collateralAmountRequired);

    function reBalance(
        address _reBalancer,
        int256 amount,
        bytes calldata data
    ) external returns (bool);
}
