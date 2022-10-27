// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.3;

import "../interfaces/IERC20Decimals.sol";
import "./Perpetual/IPerpVault.sol";

interface IPerpetualMixDEXWrapper {
    enum Basis {
        IsUsdl,
        IsSynth,
        IsRebalance,
        IsSettle
    }

    function getSettlementToken() external view returns (address);

    function getMinFreeCollateral() external view returns (uint256);

    function getMinMarginSafeThreshold() external view returns (uint256);

    function getCollateralRatios() external view returns (uint24 imRatio, uint24 mmRatio);

    function getFreeCollateral() external view returns (uint256);

    function computeRequiredUSDCForTrade(uint256 amount, bool isShort) external view returns (uint256);

    function isAdditionalUSDCAcceptable(uint256 amount) external view returns (bool);

    function setMinFreeCollateral(uint256 _margin) external;

    function setMinMarginSafeThreshold(uint256 _margin) external;

    function setCollateralRatio(uint24 _ratio) external;

    function setPercFundingPaymentsToUSDLHolders(uint256) external;

    function setXUsdl(address _xUsdl) external;

    function setXSynth(address _xSynth) external;

    function hasSettled() external view returns (bool);

    function getMarkPrice() external view returns (uint256);

    function getPendingFundingPayment() external view returns (int256);

    function settlePendingFundingPayments() external;

    function distributeFundingPayments()
        external
        returns (
            bool,
            uint256,
            uint256
        );

    function getCollateralBackAfterSettlement(
        uint256 amount,
        address to,
        bool isUsdl
    ) external;

    function trade(
        uint256 amount,
        bool isShorting,
        bool isExactInput
    ) external returns (uint256 base, uint256 quote);

    function getAccountValue() external view returns (int256);

    function getRelativeMargin() external view returns (uint256);

    function getMargin() external view returns (int256);

    function getDeltaExposure() external view returns (int256);

    function getLeverage(bool, int256) external view returns(uint256);

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

    function getUsdlCollateralDecimals() external view returns (uint256);

    function getIndexPrice() external view returns (uint256);

    // Convenience trading functions
    function openLongWithExactBase(uint256 amount) external returns (uint256, uint256);

    function openLongWithExactQuote(uint256 amount) external returns (uint256, uint256);

    function closeLongWithExactBase(uint256 amount) external returns (uint256, uint256);

    function closeLongWithExactQuote(uint256 amount) external returns (uint256, uint256);

    function openShortWithExactBase(uint256 amount) external returns (uint256, uint256);

    function openShortWithExactQuote(uint256 amount) external returns (uint256, uint256);

    function closeShortWithExactBase(uint256 amount) external returns (uint256, uint256);

    function closeShortWithExactQuote(uint256 amount) external returns (uint256, uint256);

    /////////

    function calculateMintingAsset(
        uint256 amount,
        Basis basis,
        bool isOpenShort
    ) external;

    function getMaxSettlementTokenAcceptableByVault() external view returns (uint256);

    function getSettlementTokenAmountInVault() external view returns (int256);

    function depositSettlementToken(uint256 _amount) external;

    function withdrawSettlementToken(uint256 _amount) external;

    function deposit(uint256 amount, address collateral) external;

    function withdraw(uint256 amount, address collateral) external;

    // function rebalance(
    //     address router,
    //     uint256 routerType,
    //     int256 amountBase,
    //     bool isCheckProfit
    // ) external returns (uint256, uint256);

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

    function usdc() external view returns (IERC20Decimals);

    function perpVault() external view returns (IPerpVault);

    function settle() external;
}
