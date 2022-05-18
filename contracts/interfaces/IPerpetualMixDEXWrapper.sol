// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.3;

interface IPerpetualMixDEXWrapper {

    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        external
        returns (uint256 collateralAmountRequired);
    function open(uint256 amount, uint256 collateralAmountRequired) external;
    function close(uint256 amount, uint256 collateralAmountRequired) external;
    function openWExactCollateral(uint256 collateralAmount) external returns (uint256 USDLToMint);
    function closeWExactCollateral(uint256 collateralAmount) external returns (uint256 USDLToBurn);
    function getAmountInCollateralDecimals(uint256 amount, bool roundUp) external view returns (uint256);

    // For USDLemma
    function openShortWithExactCollateral(uint256 collateralAmount) external returns (uint256 USDLToMint);
    function closeLongWithExactCollateral(uint256 collateralAmount) external returns (uint256 USDLToBurn);
    function openShortWithExactQuoteForUSDL(uint256 amount, uint256 collateralAmountRequired) external;
    function closeLongWithExactQuoteForUSDL(uint256 amount, uint256 collateralAmountToGetBack) external;

    // For LemmaETH
    function openLongWithExactCollateral(uint256 collateralAmount) external returns (uint256 USDLToMint);
    function closeShortWithExactCollateral(uint256 collateralAmount) external returns (uint256 USDLToBurn);
    function openLongWithExactBaseForSynth(uint256 amount, uint256 collateralAmountRequired) external;
    function closeShortWithExactBaseForSynth(uint256 amount, uint256 collateralAmountToGetBack) external;

    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting, bool isUsdl)
        external
    returns (uint256 collateralAmountRequired);

    function reBalance(
        address _reBalancer,
        int256 amount,
        bytes calldata data
    ) external returns (bool);

    function getTotalPosition(address baseTokenAddress) external view returns (int256);
    function getAmountInCollateralDecimals(uint256 amount, address collateral, bool roundUp) external view returns (uint256);
    function getFees(address baseTokenAddress) external view returns (uint256);
    function settle() external;
}
