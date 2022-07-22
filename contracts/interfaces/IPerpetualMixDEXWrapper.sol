// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.3;

interface IPerpetualMixDEXWrapper {
    enum Basis {IsUsdl, IsSynth, IsRebalance, IsSettle}

    function trade(uint256 amount, bool isShorting, bool isExactInput) external returns (uint256 base, uint256 quote);
    function getRelativeMargin() external view returns(uint256);
    function getMargin() external view returns(int256);

    function getDeltaExposure() external view returns(int256);
    function getExposureDetails() external view returns(uint256, uint256, int256, int256, uint256);


    function getRequiredUSDCToBackMinting(uint256 amount) external view returns(bool, uint256);
    function getAccountValue() external view returns(int256);
    function getUsdlCollateralDecimals() external view returns(uint256);
    function getIndexPrice() external view returns(uint256);

    // Convenience trading functions 
    function openLongWithExactBase(uint256 amount, address collateralIn, uint256 amountIn) external returns(uint256, uint256);
    function openLongWithExactQuote(uint256 amount, address collateralIn, uint256 amountIn) external returns(uint256, uint256);
    function closeLongWithExactBase(uint256 amount, address collateralOut, uint256 amountOut) external returns(uint256, uint256);
    function closeLongWithExactQuote(uint256 amount, address collateralOut, uint256 amountOut) external returns(uint256, uint256);


    function openShortWithExactBase(uint256 amount, address collateralIn, uint256 amountIn) external returns(uint256, uint256);
    function openShortWithExactQuote(uint256 amount, address collateralIn, uint256 amountIn) external returns(uint256, uint256);
    function closeShortWithExactBase(uint256 amount, address collateralOut, uint256 amountOut) external returns(uint256, uint256);
    function closeShortWithExactQuote(uint256 amount, address collateralOut, uint256 amountOut) external returns(uint256, uint256);
    /////////

    function getMaxSettlementTokenAcceptableByVault() external view returns(uint256);
    function getSettlementTokenAmountInVault() external view returns(int256);
    function depositSettlementToken(uint256 _amount) external;
    function withdrawSettlementToken(uint256 _amount) external;

    function deposit(uint256 amount, address collateral) external;
    function withdraw(uint256 amount, address collateral) external;

    function rebalance(address router, uint256 routerType, int256 amountBase, bool isCheckProfit) external returns(uint256, uint256);

    function reBalance(
        address _reBalancer,
        int256 amount,
        bytes calldata data
    ) external returns (bool);

    function getTotalPosition() external view returns (int256);

    function getAmountInCollateralDecimalsForPerp(
        uint256 amount,
        address collateral,
        bool roundUp
    ) external view returns (uint256);

    function getFees() external view returns (uint256);

    function settle() external;


/////////////// UNNECESSARY METHODS /////////////

    /*
    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        external
        returns (uint256 collateralAmountRequired);


    function getAmountInCollateralDecimals(uint256 amount, bool roundUp) external view returns (uint256);

    function open(uint256 amount, uint256 collateralAmountRequired) external;

    function close(uint256 amount, uint256 collateralAmountRequired) external;

    function openWExactCollateral(uint256 collateralAmount) external returns (uint256 USDLToMint);

    function closeWExactCollateral(uint256 collateralAmount) external returns (uint256 USDLToBurn);

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

    function getCollateralAmountGivenUnderlyingAssetAmountForPerp(
        uint256 amount,
        bool isShorting,
        bool isUsdl
    ) external returns (uint256 collateralAmountRequired);
    */

}
