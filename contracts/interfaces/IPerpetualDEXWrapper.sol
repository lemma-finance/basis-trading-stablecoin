pragma solidity =0.8.3;

interface IPerpetualDEXWrapper {
    function open(uint256 amount, uint256 collateralAmountRequired) external;

    function openWExactCollateral(uint256 collateralAmount) external returns (uint256 USDLToMint);

    function close(uint256 amount, uint256 collateralAmountToGetBack) external;

    function closeWExactCollateral(uint256 collateralAmount) external returns (uint256 USDLToBurn);

    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        external
        returns (uint256 collateralAmountRequired);

    function reBalance(
        address _reBalancer,
        int256 amount,
        bytes calldata data
    ) external returns (bool);

    function getAmountInCollateralDecimals(uint256 amount, bool roundUp) external view returns (uint256);

    // Should return the total position for this PerpDEXWrapper (so the combination of a DEX + Collateral) in base token = USDL terms 
    function getTotalPosition() external view returns (int256);

    function getFeesPerc(bool isMinting) external view returns (uint256);

    function settle() external;
}
