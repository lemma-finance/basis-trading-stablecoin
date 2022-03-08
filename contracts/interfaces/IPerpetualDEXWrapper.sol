pragma solidity =0.8.3;

interface IPerpetualDEXWrapper {
    function open(uint256 amount, uint256 collateralAmountRequired) external;

    function openWExactCollateral(uint256 collateralAmount) external returns (uint256 USDLToMint);

    function openWExactCollateralForSqueeth(uint256 _ethToDeposit, uint256 msgValue) external returns (uint256 USDLToMint);

    function close(uint256 amount, uint256 collateralAmountToGetBack) external;

    function closeWExactCollateral(uint256 collateralAmount) external returns (uint256 USDLToBurn);

    function closeWExactCollateralForSqueeth(uint256 _crabAmount, uint256 _maxEthToPay) external returns (uint256 USDLToBurn);

    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        external
        returns (uint256 collateralAmountRequired);

    function reBalance(
        address _reBalancer,
        int256 amount,
        bytes calldata data
    ) external returns (bool);

    function getAmountInCollateralDecimals(uint256 amount, bool roundUp) external view returns (uint256);
}
