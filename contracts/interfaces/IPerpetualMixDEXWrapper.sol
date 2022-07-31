// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.3;

import "../interfaces/IERC20Decimals.sol";

interface IPerpetualMixDEXWrapper {
    enum Basis {
        IsUsdl,
        IsSynth,
        IsRebalance,
        IsSettle
    }

    function hasSettled() external view returns (bool);

    function getCollateralBackAfterSettlement(
        uint256 amount,
        address to,
        bool isUsdl
    ) external returns (uint256 collateralAmount1, uint256 collateralAmount2);

    function trade(
        uint256 amount,
        bool isShorting,
        bool isExactInput
    ) external returns (uint256 base, uint256 quote);

    function getRelativeMargin() external view returns (uint256);

    function getMargin() external view returns (int256);

    function getDeltaExposure() external view returns (int256);

    function getExposureDetails()
        external
        view
        returns (
            uint256,
            uint256,
            int256,
            int256,
            uint256
        );

    function getCollateralTokens() external view returns (address[] memory res);

    function getRequiredUSDCToBackMinting(uint256 amount, bool isShort) external view returns (bool, uint256);

    function getAccountValue() external view returns (int256);

    function getUsdlCollateralDecimals() external view returns (uint256);

    function getIndexPrice() external view returns (uint256);

    // Convenience trading functions
    function openLongWithExactBase(uint256 amount, Basis basis) external returns (uint256, uint256);

    function openLongWithExactQuote(uint256 amount, Basis basis) external returns (uint256, uint256);

    function closeLongWithExactBase(uint256 amount, Basis basis) external returns (uint256, uint256);

    function closeLongWithExactQuote(uint256 amount, Basis basis) external returns (uint256, uint256);

    function openShortWithExactBase(uint256 amount, Basis basis) external returns (uint256, uint256);

    function openShortWithExactQuote(uint256 amount, Basis basis) external returns (uint256, uint256);

    function closeShortWithExactBase(uint256 amount, Basis basis) external returns (uint256, uint256);

    function closeShortWithExactQuote(uint256 amount, Basis basis) external returns (uint256, uint256);

    /////////

    function getMaxSettlementTokenAcceptableByVault() external view returns (uint256);

    function getSettlementTokenAmountInVault() external view returns (int256);

    function depositSettlementToken(uint256 _amount) external;

    function withdrawSettlementToken(uint256 _amount) external;

    function deposit(
        uint256 amount,
        address collateral,
        Basis basis
    ) external;

    function withdraw(
        uint256 amount,
        address collateral,
        Basis basis
    ) external;

    function rebalance(
        address router,
        uint256 routerType,
        int256 amountBase,
        bool isCheckProfit
    ) external returns (uint256, uint256);

    // function reBalance(
    //     address _reBalancer,
    //     int256 amount,
    //     bytes calldata data
    // ) external returns (bool);

    function getTotalPosition() external view returns (int256);

    function getAmountInCollateralDecimalsForPerp(
        uint256 amount,
        address collateral,
        bool roundUp
    ) external view returns (uint256);

    function getFees() external view returns (uint256);

    function settle() external;
}
