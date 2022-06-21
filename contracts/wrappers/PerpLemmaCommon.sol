// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;

import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { IPerpetualMixDEXWrapper } from "../interfaces/IPerpetualMixDEXWrapper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import { Utils } from "../libraries/Utils.sol";
import { SafeMathExt } from "../libraries/SafeMathExt.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../libraries/TransferHelper.sol";
import "../interfaces/IERC20Decimals.sol";
import "../interfaces/Perpetual/IClearingHouse.sol";
import "../interfaces/Perpetual/IClearingHouseConfig.sol";
import "../interfaces/Perpetual/IIndexPrice.sol";
import "../interfaces/Perpetual/IAccountBalance.sol";
import "../interfaces/Perpetual/IMarketRegistry.sol";
import "../interfaces/Perpetual/IExchange.sol";
import "../interfaces/Perpetual/IPerpVault.sol";
import "../interfaces/Perpetual/IUSDLemma.sol";

// NOTE: There is an incompatibility between Foundry and Hardhat `console.log()` 
import "forge-std/Test.sol";
// import "hardhat/console.sol";

contract PerpLemmaCommon is OwnableUpgradeable, ERC2771ContextUpgradeable, IPerpetualMixDEXWrapper {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using Utils for int256;
    using SafeMathExt for int256;

    address public usdLemma;
    address public reBalancer;

    address public usdlBaseTokenAddress;
    // address public synthBaseTokenAddress;
    bytes32 public referrerCode;

    IClearingHouse public clearingHouse;
    IClearingHouseConfig public clearingHouseConfig;
    IPerpVault public perpVault;
    IAccountBalance public accountBalance;
    IMarketRegistry public marketRegistry;
    IExchange public exchange;

    bool public isUsdlCollateralTailAsset;
    // bool public isSynthCollateralTailAsset;
    IERC20Decimals public usdlCollateral;
    // IERC20Decimals public synthCollateral;
    IERC20Decimals public usdc;


    uint256 public constant MAX_UINT256 = type(uint256).max;
    uint256 public maxPosition;
    uint256 public usdlCollateralDecimals;
    // uint256 public synthCollateralDecimals;

    int256 public amountBase;
    int256 public amountQuote;
    uint256 public amountUsdlCollateralDeposited;

    // Gets set only when Settlement has already happened
    // NOTE: This should be equal to the amount of USDL minted depositing on that dexIndex
    uint256 public positionAtSettlementInQuoteForUSDL;
    // uint256 public positionAtSettlementInQuoteForSynth;
    uint256 public positionAtSettlementInBaseForUSDL;
    // uint256 public positionAtSettlementInBaseForSynth;

    int256 public totalFundingPNL;
    int256 public realizedFundingPNL;

    // Has the Market Settled
    bool public hasSettled;

    address public rebalancer;

    // events
    event USDLemmaUpdated(address usdlAddress);
    event ReferrerUpdated(bytes32 referrerCode);
    event RebalancerUpdated(address rebalancerAddress);
    event MaxPositionUpdated(uint256 maxPos);

    modifier onlyUSDLemma() {
        // TODO: Re-enable
        // require(msg.sender == usdLemma, "only usdLemma is allowed");
        _;
    }

    modifier onlyRebalancer() {
        // TODO: Re-enable
        // require(_msgSender() == rebalancer, "! Rebalancer");
        _;
    }

    ////////////////////////
    /// EXTERNAL METHODS ///
    ////////////////////////

    function initialize(
        address _trustedForwarder,
        address _usdlCollateral,
        address _usdlBaseToken,
        address _synthCollateral,
        address _synthBaseToken,
        address _clearingHouse,
        address _marketRegistry,
        address _usdLemma,
        uint256 _maxPosition
    ) external initializer {
        __Ownable_init();
        __ERC2771Context_init(_trustedForwarder);

        require(_usdlBaseToken != address(0), "_usdlBaseToken should not ZERO address");
        // require(_synthBaseToken != address(0), "_synthBaseToken should not ZERO address");
        require(_clearingHouse != address(0), "ClearingHouse should not ZERO address");
        require(_marketRegistry != address(0), "MarketRegistry should not ZERO address");

        usdLemma = _usdLemma;
        maxPosition = _maxPosition;

        clearingHouse = IClearingHouse(_clearingHouse);
        clearingHouseConfig = IClearingHouseConfig(clearingHouse.getClearingHouseConfig());
        perpVault = IPerpVault(clearingHouse.getVault());
        exchange = IExchange(clearingHouse.getExchange());
        accountBalance = IAccountBalance(clearingHouse.getAccountBalance());

        marketRegistry = IMarketRegistry(_marketRegistry);

        usdc = IERC20Decimals(perpVault.getSettlementToken());

        usdlBaseTokenAddress = _usdlBaseToken;
        usdlCollateral = IERC20Decimals(_usdlCollateral);
        usdlCollateralDecimals = usdlCollateral.decimals(); // need to verify
        usdlCollateral.approve(_clearingHouse, MAX_UINT256);

        // synthBaseTokenAddress = _synthBaseToken;
        // synthCollateral = IERC20Decimals(_synthCollateral);
        // synthCollateralDecimals = synthCollateral.decimals(); // need to verify
        // synthCollateral.approve(_clearingHouse, MAX_UINT256);

        // NOTE: Even though it is not necessary, it is for clarity
        hasSettled = false;

        SafeERC20Upgradeable.safeApprove(usdlCollateral, address(perpVault), MAX_UINT256);
        // SafeERC20Upgradeable.safeApprove(synthCollateral, address(perpVault), MAX_UINT256);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), MAX_UINT256);

        if(usdLemma != address(0)) {
            SafeERC20Upgradeable.safeApprove(usdc, usdLemma, 0);
            SafeERC20Upgradeable.safeApprove(usdc, usdLemma, MAX_UINT256);
            SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, 0);
            SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, MAX_UINT256);
        }
    }

    function setRebalancer(address _rebalancer) external onlyOwner {
        // NOTE: Setting it to address(0) is allowed, it just disables rebalancing temporarily
        rebalancer = _rebalancer;

        // TODO: Add emit event 
    }

    // TODO: Add only owner
    function setIsUsdlCollateralTailAsset(bool _x) external {
        isUsdlCollateralTailAsset = _x;
    }

    // function setIsSynthCollateralTailAsset(bool _x) external onlyOwner {
    //     isSynthCollateralTailAsset = _x;
    // }

    function getUsdlCollateralDecimals() override external view returns(uint256) {
        return usdlCollateralDecimals;
    }

    function getIndexPrice() override external view returns(uint256) {
        uint256 _twapInterval = IClearingHouseConfig(clearingHouseConfig).getTwapInterval();
        console.log("[getIndexPrice()] _twapInterval = ", _twapInterval);
        uint256 _price = IIndexPrice(usdlBaseTokenAddress).getIndexPrice(_twapInterval);
        console.log("[getIndexPrice()] _price = ", _price);
        return _price;
    }

    /// @notice getFees fees charge by perpV2 protocol for each trade
    function getFees() external view override returns (uint256) {
        // NOTE: Removed prev arg address baseTokenAddress
        IMarketRegistry.MarketInfo memory marketInfo = marketRegistry.getMarketInfo(usdlBaseTokenAddress);
        return marketInfo.exchangeFeeRatio;
    }

    /// @notice getTotalPosition in terms of quoteToken(in our case vUSD)
    /// https://github.com/yashnaman/perp-lushan/blob/main/contracts/interface/IAccountBalance.sol#L224
    /// https://github.com/yashnaman/perp-lushan/blob/main/contracts/AccountBalance.sol#L320
    function getTotalPosition() external view override returns (int256) {
        return accountBalance.getTotalPositionValue(address(this), usdlBaseTokenAddress);
    }

    ///@notice sets USDLemma address - only owner can set
    ///@param _usdLemma USDLemma address to set
    function setUSDLemma(address _usdLemma) external onlyOwner {
        require(_usdLemma != address(0), "UsdLemma should not ZERO address");

        if(usdLemma != address(0)) {
            SafeERC20Upgradeable.safeApprove(usdc, usdLemma, 0);
            SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, 0);
        }

        usdLemma = _usdLemma;

        SafeERC20Upgradeable.safeApprove(usdc, usdLemma, 0);
        SafeERC20Upgradeable.safeApprove(usdc, usdLemma, MAX_UINT256);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, 0);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, MAX_UINT256);

        emit USDLemmaUpdated(usdLemma);
    }

    ///@notice sets refferer code - only owner can set
    ///@param _referrerCode referrerCode of address to set
    function setReferrerCode(bytes32 _referrerCode) external onlyOwner {
        referrerCode = _referrerCode;
        emit ReferrerUpdated(referrerCode);
    }

    ///@notice sets reBalncer address - only owner can set
    ///@param _reBalancer reBalancer address to set
    function setReBalancer(address _reBalancer) external onlyOwner {
        require(_reBalancer != address(0), "ReBalancer should not ZERO address");
        reBalancer = _reBalancer;
        emit RebalancerUpdated(reBalancer);
    }

    ///@notice sets maximum position the wrapper can take (in terms of base) - only owner can set
    ///@param _maxPosition reBalancer address to set
    function setMaxPosition(uint256 _maxPosition) external onlyOwner {
        maxPosition = _maxPosition;
        emit MaxPositionUpdated(maxPosition);
    }

    /// @notice reset approvals
    function resetApprovals() external {
        SafeERC20Upgradeable.safeApprove(usdlCollateral, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, address(perpVault), MAX_UINT256);

        // SafeERC20Upgradeable.safeApprove(synthCollateral, address(perpVault), 0);
        // SafeERC20Upgradeable.safeApprove(synthCollateral, address(perpVault), MAX_UINT256);

        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), MAX_UINT256);
    }

    function getSettlementTokenAmountInVault() override external view returns(int256) {
        return perpVault.getBalance(address(this));
    }

    /// @notice depositSettlementToken is used to deposit settlement token USDC into perp vault - only owner can deposit
    /// @param _amount USDC amount need to deposit into perp vault
    function depositSettlementToken(uint256 _amount) override external {
        require(_amount > 0, "Amount should greater than zero");
        SafeERC20Upgradeable.safeTransferFrom(usdc, msg.sender, address(this), _amount);
        perpVault.deposit(address(usdc), _amount);
    }

    /// @notice withdrawSettlementToken is used to withdraw settlement token USDC from perp vault - only owner can withdraw
    /// @param _amount USDC amount need to withdraw from perp vault
    function withdrawSettlementToken(uint256 _amount) override external onlyOwner {
        require(_amount > 0, "Amount should greater than zero");
        perpVault.withdraw(address(usdc), _amount);
        SafeERC20Upgradeable.safeTransfer(usdc, msg.sender, _amount);
    }


    // function tradeCovered(
    //     uint256 amountPos,
    //     bool isShorting, 
    //     bool isExactInput,
    //     address collateralIn,
    //     uint256 amountIn,
    //     address collateralOut,
    //     uint256 amountOut
    // ) external override onlyUSDLemma returns(uint256, uint256) {
    //     if( (amountIn > 0) && (collateralIn != address(0)) ) {
    //         SafeERC20Upgradeable.safeTransferFrom(IERC20Decimals(collateralIn), msg.sender, address(this), amountIn);
    //         _deposit(amountIn, collateralIn);
    //     }

    //     if( (amountOut > 0) && (collateralOut != address(0)) ) {
    //         _withdraw(amountOut, collateralOut);
    //         SafeERC20Upgradeable.safeTransfer(IERC20Decimals(collateralOut), msg.sender, amountOut);
    //     }

    //     return trade(amountPos, isShorting, isExactInput);
    // }

    // Returns the leverage in 1e18 format
    // TODO: Take into account tail assets
    function getRelativeMargin() override external view returns(uint256) {
        // NOTE: Returns totalCollateralValue + unrealizedPnL
        // https://github.com/yashnaman/perp-lushan/blob/main/contracts/interface/IClearingHouse.sol#L254
        int256 _accountValue_1e18 = clearingHouse.getAccountValue(address(this));
        uint256 _accountValue = getAmountInCollateralDecimalsForPerp(
            _accountValue_1e18.abs().toUint256(),
            address(usdlCollateral),
            false
        );

        // NOTE: Returns the margin requirement taking into account the position PnL
        // NOTE: This is what can be compared with the Account Value according to Perp Doc 
        // https://github.com/yashnaman/perp-lushan/blob/main/contracts/interface/IAccountBalance.sol#L158
        int256 _margin = accountBalance.getMarginRequirementForLiquidation(address(this));

        console.log("[getRelativeMargin()] _accountValue_1e18 = %s %d", (_accountValue < 0) ? "-":"+", _accountValue_1e18.abs().toUint256());
        console.log("[getRelativeMargin()] _accountValue = ", _accountValue);
        console.log("[getRelativeMargin()] _margin = %s %d", (_margin < 0) ? "-":"+", _margin.abs().toUint256());

        return ((_accountValue_1e18 <= int256(0) || (_margin < 0)) ? 
                type(uint256).max           // No Collateral Deposited --> Max Leverage Possible
                : 
                _margin.abs().toUint256() * 1e18 / _accountValue);

        // Returns the position balance in Settlmenet Token --> USDC 
        // https://github.com/yashnaman/perp-lushan/blob/main/contracts/Vault.sol#L242
        // int256 _accountValue = perpVault.getBalance(address(this));
        // int256 _totalPosValue_1e18 = accountBalance.getTotalPositionValue(address(this), usdlBaseTokenAddress);
        // uint256 _totalPosValue = getAmountInCollateralDecimalsForPerp(
        //     _totalPosValue_1e18.abs().toUint256(),
        //     address(usdlCollateral),
        //     false
        // );

        // console.log("[getLeverage()] _totalPosValue_1e18 = %s %d", (_totalPosValue_1e18 < 0) ? "-":"+", _totalPosValue_1e18.abs().toUint256());
        // console.log("[getLeverage()] _totalPosValue = ", _totalPosValue);
        // console.log("[getLeverage()] _vaultBalance = %s %d", (_vaultBalance < 0) ? "-":"+", _vaultBalance.abs().toUint256());
        // return ((_vaultBalance == int256(0)) ? 
        //         type(uint256).max           // No Collateral Deposited --> Max Leverage Possible
        //         : 
        //         _totalPosValue * 1e6 / _vaultBalance.abs().toUint256());
    }

    // NOTE: Computes the delta exposure 
    // NOTE: It does not take into account if the deposited collateral gets silently converted in USDC so that we lose positive delta exposure
    function getDeltaExposure() override external view returns(int256) {
        (uint256 _usdlCollateralAmount, uint256 _usdlCollateralDepositedAmount, int256 _longOrShort,,) = getExposureDetails();
        uint256 _longOnly = (_usdlCollateralAmount + _usdlCollateralDepositedAmount) * 10**(18 - usdlCollateralDecimals);         // Both usdlCollateralDecimals format

        console.log("[getDeltaExposure()] _longOnly = ", _longOnly);
        console.log("[getDeltaExposure()] _longOrShort = %s %d", (_longOrShort < 0) ? "-":"+", _longOrShort.abs().toUint256() );

        int256 _deltaLongShort = int256(_longOnly) + _longOrShort;
        console.log("[getDeltaExposure()] _deltaLongShort = %s %d", (_deltaLongShort < 0) ? "-":"+", _deltaLongShort.abs().toUint256() );
        uint256 _absTot = _longOnly + _longOrShort.abs().toUint256();
        console.log("[getDeltaExposure()] _absTot = ", _absTot);
        int256 _delta = (_absTot == 0) ? int256(0) : _deltaLongShort * 1e6 / int256(_absTot);
        console.log("[getDeltaExposure()] getDeltaExposure = %s %d", (_delta < 0) ? "-":"+", _delta.abs().toUint256());
        return _delta;
    }

    function getExposureDetails() override public view returns(uint256, uint256, int256, int256, uint256) {
        return (
            usdlCollateral.balanceOf(address(this)),
            amountUsdlCollateralDeposited,
            amountBase,                     // All the other terms are in 1e6 
            perpVault.getBalance(address(this)),            // This number could change when PnL gets realized so it is better to read it from the Vault directly
            usdc.balanceOf(address(this))
        );
    }

    function getMargin() override external view returns(int256) {
        int256 _margin = accountBalance.getMarginRequirementForLiquidation(address(this));
        console.log("[getMargin()] Margin = %s %d", (_margin < 0) ? "-":"+", _margin.abs().toUint256());
        return _margin;
    }

    function trade(
        uint256 amount,
        bool isShorting,
        bool isExactInput
    ) public override onlyUSDLemma returns (uint256, uint256) {
        // TODO: Fix
        // TODO: Check,we need to take into account what we close after the market has settled is the net short or long position 
        // if (hasSettled) return closeWExactUSDLAfterSettlementForUSDL(amount);

        bool _isBaseToQuote = isShorting;
        bool _isExactInput = isExactInput;

        console.log("[trade()] Before base = %s %d", (amountBase < 0) ? "-":"+", amountBase.abs().toUint256());
        console.log("[trade()] Before quote = %s %d", (amountQuote < 0) ? "-":"+", amountQuote.abs().toUint256());
        console.log("[trade()] Trying to Trade isBaseToQuote = %d, isExactInput = %d, amount = %d",  
            (_isBaseToQuote) ? 1 : 0,
            (_isExactInput) ? 1 : 0,
            amount
        );

        // totalFundingPNL = getFundingPNL();
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: usdlBaseTokenAddress,
            isBaseToQuote: _isBaseToQuote,
            isExactInput: _isExactInput,
            amount: amount,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });

        // NOTE: It returns the base and quote of the last trade only
        (uint256 _amountBase, uint256 _amountQuote) = clearingHouse.openPosition(params);
        amountBase += (_isBaseToQuote) ? -1 * int256(_amountBase) : int256(_amountBase);
        amountQuote += (_isBaseToQuote) ? int256(_amountQuote) : -1 * int256(_amountQuote);

        console.log("[trade()] After base = %s %d", (amountBase < 0) ? "-":"+", amountBase.abs().toUint256());
        console.log("[trade()] After quote = %s %d", (amountQuote < 0) ? "-":"+", amountQuote.abs().toUint256());

        int256 positionSize = accountBalance.getTotalPositionSize(address(this), usdlBaseTokenAddress);
        console.log("[trade()] positionSize.abs().toUint256() = %s %d", (positionSize < 0) ? "-" : "+", positionSize.abs().toUint256());
        require(positionSize.abs().toUint256() <= maxPosition, "max position reached");
        return (_amountBase, _amountQuote);
    }


    function deposit(uint256 amount, address collateral) external override onlyUSDLemma {
        _deposit(amount, collateral);
    }

    function withdraw(uint256 amount, address collateral) external override onlyUSDLemma {
        _withdraw(amount, collateral);
    }



    /////////// TRADING - CONVENIENCE FUNCTIONS //////////

    function openLongWithExactBase(uint256 amount, address collateralIn, uint256 amountIn) public override onlyUSDLemma returns(uint256, uint256) {
        // Open Long: Quote --> Base 
        // ExactInput: False
        
        if((collateralIn != address(0)) && (amountIn > 0)) _deposit(amountIn, collateralIn);

        return trade(amount, false, false);
    }

    function openLongWithExactQuote(uint256 amount, address collateralIn, uint256 amountIn) public override onlyUSDLemma returns(uint256, uint256) {
        // Open Long: Quote --> Base 
        // ExactInput: True

        if((collateralIn != address(0)) && (amountIn > 0)) _deposit(amountIn, collateralIn);

        return trade(amount, false, true);
    }


    function closeLongWithExactBase(uint256 amount, address collateralOut, uint256 amountOut) public override onlyUSDLemma returns(uint256, uint256) {
        // Close Long: Base --> Quote 
        // ExactInput: True

        if((collateralOut != address(0)) && (amountOut > 0)) _withdraw(amountOut, collateralOut);

        return trade(amount, true, true);
    }

    function closeLongWithExactQuote(uint256 amount, address collateralOut, uint256 amountOut) public override onlyUSDLemma returns(uint256, uint256) {
        // Close Long: Base --> Quote 
        // ExactInput: False

        if((collateralOut != address(0)) && (amountOut > 0)) _withdraw(amountOut, collateralOut);

        return trade(amount, true, false);
    }



    function openShortWithExactBase(uint256 amount, address collateralIn, uint256 amountIn) public override onlyUSDLemma returns(uint256, uint256) {
        if((collateralIn != address(0)) && (amountIn > 0)) _deposit(amountIn, collateralIn);
        return closeLongWithExactBase(amount, address(0), 0);
    }

    function openShortWithExactQuote(uint256 amount, address collateralIn, uint256 amountIn) public override onlyUSDLemma returns(uint256, uint256) {
        if((collateralIn != address(0)) && (amountIn > 0)) _deposit(amountIn, collateralIn);
        return closeLongWithExactQuote(amount, address(0), 0);
    }


    function closeShortWithExactBase(uint256 amount, address collateralOut, uint256 amountOut) public override onlyUSDLemma returns(uint256, uint256) {
        if((collateralOut != address(0)) && (amountOut > 0)) _withdraw(amountOut, collateralOut);
        return openLongWithExactBase(amount, address(0), 0);
    }

    function closeShortWithExactQuote(uint256 amount, address collateralOut, uint256 amountOut) public override onlyUSDLemma returns(uint256, uint256) {
        if((collateralOut != address(0)) && (amountOut > 0)) _withdraw(amountOut, collateralOut);
        return openLongWithExactQuote(amount, address(0), 0);
    }










    //// @notice when perpetual is in CLEARED state, withdraw the collateral
    function settle() external override {
        positionAtSettlementInQuoteForUSDL = accountBalance
            .getQuote(address(this), usdlBaseTokenAddress)
            .abs()
            .toUint256();

        // NOTE: This checks the market is in CLOSED state, otherwise reverts
        // NOTE: For some reason, the amountQuoteClosed < freeCollateral and freeCollateral is the max withdrawable for us so this is the one we want to use to withdraw

        clearingHouse.quitMarket(address(this), usdlBaseTokenAddress);

        // if (usdlBaseTokenAddress != synthBaseTokenAddress) {
        //     clearingHouse.quitMarket(address(this), usdlBaseTokenAddress);
        //     clearingHouse.quitMarket(address(this), synthBaseTokenAddress);
        // } else {
        //     clearingHouse.quitMarket(address(this), usdlBaseTokenAddress);
        // }

        // NOTE: Settle pending funding rates
        settleAllFunding();

        // NOTE: This amount of free collateral is the one internally used to check for the V_NEFC error, so this is the max withdrawable
        uint256 freeCollateralUSDL = perpVault.getFreeCollateralByToken(address(this), address(usdlCollateral));
        positionAtSettlementInBaseForUSDL = freeCollateralUSDL;

        // uint256 freeCollateralForSynth = perpVault.getFreeCollateralByToken(address(this), address(synthCollateral));
        // positionAtSettlementInQuoteForSynth = freeCollateralForSynth;

        _withdraw(positionAtSettlementInBaseForUSDL, address(usdlCollateral));
        // _withdraw(positionAtSettlementInQuoteForSynth, address(synthCollateral));

        // if(! isUsdlCollateralTailAsset) {
        //     perpVault.withdraw(address(usdlCollateral), positionAtSettlementInBaseForUSDL);
        // }

        // if(! isUsdlCollateralTailAsset) {
        //     perpVault.withdraw(address(synthCollateral), positionAtSettlementInQuoteForSynth);
        // }


        // All the collateral is now back
        hasSettled = true;
    }

    function _swapOnDEXSpot(address router, uint256 routerType, bool isBuyUSDLCollateral, uint256 amountIn) internal returns(uint256) {
        if(routerType == 0) {
            // NOTE: UniV3 
            return _swapOnUniV3(router, isBuyUSDLCollateral, amountIn);
        }
        // NOTE: Unsupported Router --> Using UniV3 as default
        return _swapOnUniV3(router, isBuyUSDLCollateral, amountIn);
    }



    function _swapOnUniV3(address router, bool isUSDLCollateralToUSDC, uint256 amountIn) internal returns(uint256) {
        address tokenIn = (isUSDLCollateralToUSDC) ? address(usdlCollateral) : address(usdc);
        address tokenOut = (isUSDLCollateralToUSDC) ? address(usdc) : address(usdlCollateral);


        IERC20Decimals(tokenIn).approve(router, type(uint256).max);

        ISwapRouter.ExactInputSingleParams memory temp = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: 3000,
            recipient: address(this),
            deadline: type(uint256).max,
            amountIn: amountIn,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });
        return ISwapRouter(router).exactInputSingle(temp);
    }

    /// @notice Rebalances USDL or Synth emission swapping by Perp backed to Token backed  
    /// @dev USDL can be backed by both: 1) Floating Collateral + Perp Short of the same Floating Collateral or 2) USDC 
    /// @dev LemmaX (where X can be ETH, ...) can be backed by both: 1) USDC collateralized Perp Long or 2) X token itself 
    /// @dev The idea is to use this mechanism for this purposes like Arbing between Mark and Spot Price or adjusting our tokens in our balance sheet for LemmaSwap supply 
    /// @dev Details at https://www.notion.so/lemmafinance/Rebalance-Details-f72ad11a5d8248c195762a6ac6ce037e
    /// 
    /// @param router The Router to execute the swap on
    /// @param routerType The Router Type: 0 --> UniV3, ... 
    /// @param isOpenLong If true, we need to increase long = close short which means buying base at Mark and sell base on Spot, otherwise it is the opposite way
    /// @param amount The Amount of Base Token to buy or sell on Perp and consequently the amount of corresponding colletarl to sell or buy on Spot 
    /// @return Amount of USDC resulting from the operation. It can also be negative as we can use this mechanism for purposes other than Arb See https://www.notion.so/lemmafinance/Rebalance-Details-f72ad11a5d8248c195762a6ac6ce037e#ffad7b09a81a4b049348e3cd38e57466 here 
    function rebalance(address router, uint256 routerType, bool isOpenLong, uint256 amount) override external onlyRebalancer returns(uint256, uint256) {
        console.log("[rebalance()] Start");
        uint256 usdlCollateralAmount;
        uint256 usdcAmount;

        // NOTE: Changing the position on Perp requires checking we are properly collateralized all the time otherwise doing the trade risks to revert the TX 
        // NOTE: Call to perps that can revert the TX: withdraw(), openPosition()
        // NOTE: Actually, probably also deposit() is not safe as some max threshold can be crossed but this is something different from the above
        if(isOpenLong) {
            console.log("[rebalance()] OpenLong: Increase Base");
            if(amountBase < 0) {
                // NOTE: Net Short Position --> USDL Collateral is currently deposited locally if tail asset or in Perp otherwise 
                // NOTE: In this case, we need to shrink our position before we can withdraw to swap so 
                (usdlCollateralAmount, ) = closeShortWithExactQuote(usdcAmount, address(0), 0);
                // NOTE: Only withdraws from Perp if it is a non tail asset 
                _withdraw(amount, address(usdlCollateral));
                usdcAmount = _swapOnDEXSpot(router, routerType, true, amount);
            } else {
                // NOTE: Net Long Position --> USDL Collateral is not deposited in Perp but floating in the local balance sheet so we do not have to do anything before the trade
                usdcAmount = _swapOnDEXSpot(router, routerType, true, amount);
                _deposit(usdcAmount, address(usdc));
                (usdlCollateralAmount, ) = openLongWithExactQuote(usdcAmount, address(0), 0);
            }

            // TODO: Implement 
            // 1.1 Take `amount` of ETH in this contract or Perp Vault and swap it on Uniswap for USDC

            // NOTE: We have to assume this usdlCollateral is not deposited in Perp, even though it is not a tail asset, as in that 
            // if(!isUsdlCollateralTailAsset) {
            //     // TODO: Implement usdlCollateral withdrawing beforehand 
            //     perpVault.withdraw(address(usdlCollateral), amount);
            // }

            // usdcAmount = _swapOnDEXSpot(router, routerType, true, amount);
            // // 1.2 Increase Long = Reduce Short using openLongWithExactQuote() using the above amount of USDC as quote amount
            // // perpVault.deposit(address(usdc), usdcAmount);

            // (usdlCollateralAmount, ) = openLongWithExactQuote(usdcAmount, address(0), 0);
        } else {
            console.log("[rebalance()] OpenLong: Decrease Base");
            // TODO: Fix the following --> the commented part should be the right one 
            // if(amountBase < 0) {
            //     // NOTE: We are net short 
            //     usdlCollateralAmount = _swapOnDEXSpot(router, routerType, false, usdcAmount);
            //     _deposit(usdlCollateralAmount, address(usdlCollateral));
            //     (, usdcAmount) = openShortWithExactBase(usdlCollateralAmount, address(0), 0); 
            // } else {
            //     // NOTE: We are net long
            //     (, usdcAmount) = closeLongWithExactBase(amount, address(0), 0); 
            //     _withdraw(usdcAmount, address(usdc));
            //     usdlCollateralAmount = _swapOnDEXSpot(router, routerType, false, usdcAmount);
            // }
            // 1.1 Reduce Long = Increase Short using closeLongWithExactBase() for `amount` and get the corresponding quote amount
            (, usdcAmount) = closeLongWithExactBase(amount, address(0), 0);

            // TODO: Reactivate 
            perpVault.withdraw(address(usdc), usdcAmount);

            // 1.2 Take quote amount of USDC and swap it on Uniswap for ETH and deposit ETH as collateral 
            usdlCollateralAmount = _swapOnDEXSpot(router, routerType, false, usdcAmount);
        }
        // Compute Profit and return it
        // if(isCheckProfit) require(usdlCollateralAmount >= amount, "Unprofitable");
        return (usdlCollateralAmount, usdcAmount);
    }

    /// @notice Rebalance position of dex based on accumulated funding, since last rebalancing
    /// @param _reBalancer Address of rebalancer who called function on USDL contract
    /// @param amount Amount of accumulated funding fees used to rebalance by opening or closing a short position
    /// NOTE: amount will be in vUSD or as quoteToken
    /// @param data Abi encoded data to call respective perpetual function, contains limitPrice, deadline and fundingPNL(while calling rebalance)
    /// @return True if successful, False if unsuccessful
    function reBalance(
        address _reBalancer,
        int256 amount,
        bytes calldata data
    ) external override onlyUSDLemma returns (bool) {
        require(_reBalancer == reBalancer, "only rebalancer is allowed");

        // (uint160 _sqrtPriceLimitX96, uint256 _deadline, bool isUsdl) = abi.decode(data, (uint160, uint256, bool));

        // bool _isBaseToQuote;
        // bool _isExactInput;
        // address baseTokenAddress;

        // int256 fundingPNL = totalFundingPNL;
        // if (isUsdl) {
        //     // only if USDL rebalance
        //     // If USDL rebalace happens then realizedFundingPNL will set before trade
        //     realizedFundingPNL += amount;

        //     baseTokenAddress = usdlBaseTokenAddress;
        //     if (amount < 0) {
        //         // open long position for eth and amount in vUSD
        //         _isBaseToQuote = false;
        //         _isExactInput = true;
        //     } else {
        //         // open short position for eth and amount in vUSD
        //         _isBaseToQuote = true;
        //         _isExactInput = false;
        //     }
        // } else {
        //     // only if Synth rebalance
        //     baseTokenAddress = synthBaseTokenAddress;
        //     if (amount < 0) {
        //         // open short position for eth and amount in vETH
        //         _isBaseToQuote = true;
        //         _isExactInput = true;
        //     } else {
        //         // open long position for eth and amount in vETH
        //         _isBaseToQuote = false;
        //         _isExactInput = false;
        //     }
        // }

        // totalFundingPNL = getFundingPNL(baseTokenAddress);

        // IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
        //     baseToken: baseTokenAddress,
        //     isBaseToQuote: _isBaseToQuote,
        //     isExactInput: _isExactInput,
        //     amount: uint256(amount.abs()),
        //     oppositeAmountBound: 0,
        //     deadline: _deadline,
        //     sqrtPriceLimitX96: _sqrtPriceLimitX96,
        //     referralCode: referrerCode
        // });
        // (, uint256 quote) = clearingHouse.openPosition(params);

        // if (!isUsdl) {
        //     // If Synth rebalace happens then realizedFundingPNL will set after trade
        //     if (amount < 0) {
        //         realizedFundingPNL -= int256(quote);
        //     } else {
        //         realizedFundingPNL += int256(quote);
        //     }
        // }

        // int256 difference = fundingPNL - realizedFundingPNL;
        // // //error +-10**12 is allowed in calculation
        // require(difference.abs() <= 10**12, "not allowed");
        // return true;
    }

    /// @notice settleAllFunding will getPendingFundingPayment of perpLemma wrapper and then settle funding
    function settleAllFunding() public {
        totalFundingPNL = getFundingPNL();
        // totalFundingPNL = getFundingPNL(synthBaseTokenAddress);
        clearingHouse.settleAllFunding(address(this));
    }

    //////////////////////
    /// PUBLIC METHODS ///
    //////////////////////

    /// @notice Get funding PnL for this address till now
    /// @return fundingPNL Funding PnL accumulated till now
    function getFundingPNL() public view returns (int256 fundingPNL) {
        return totalFundingPNL + exchange.getPendingFundingPayment(address(this), usdlBaseTokenAddress);
    }

    /// @notice Get Amount in collateral decimals, provided amount is in 18 decimals
    /// @param amount Amount in 18 decimals
    /// @param roundUp If needs to round up
    /// @return decimal adjusted value
    function getAmountInCollateralDecimalsForPerp(
        uint256 amount,
        address collateral,
        bool roundUp
    ) public view override returns (uint256) {
        uint256 collateralDecimals = IERC20Decimals(collateral).decimals();
        if (roundUp && (amount % (uint256(10**(18 - collateralDecimals))) != 0)) {
            return amount / uint256(10**(18 - collateralDecimals)) + 1; // need to verify
        }
        return amount / uint256(10**(18 - collateralDecimals));
    }

    ////////////////////////
    /// INTERNAL METHODS ///
    ////////////////////////

    /// @notice to deposit collateral in vault for short or open position
    /// @notice If collateral is tail asset no need to deposit it in Perp, it has to stay in this contract balance sheet 
    function _deposit(uint256 collateralAmount, address collateral) internal {
        console.log("[_deposit()] Trying to deposit amount = ", collateralAmount);
        if( (collateral == address(usdlCollateral)) && (!isUsdlCollateralTailAsset) ) 
        {
            console.log("[_deposit()] Not a tail asset");
            perpVault.deposit(collateral, collateralAmount);
            amountUsdlCollateralDeposited += collateralAmount;
        }
        else {
            console.log("[_deposit()] Tail Asset");
        }

        // // NOTE: Allowing also USDLemma to deposit USDC 
        // if(collateral == address(usdc)) {
        //     perpVault.deposit(address(usdc), collateralAmount);
        // }
    }

    /// @notice to withdraw collateral from vault after long or close position
    /// @notice If collateral is tail asset no need to withdraw it from Perp, it is already in this contract balance sheet 
    function _withdraw(uint256 amountToWithdraw, address collateral) internal {
        if( (collateral == address(usdlCollateral)) && (!isUsdlCollateralTailAsset) ) 
        {
            console.log("[_withdraw()] Not a tail asset");
            // NOTE: This is problematic with ETH
            perpVault.withdraw(collateral, amountToWithdraw);
            amountUsdlCollateralDeposited -= amountToWithdraw;
        }
        else {
            console.log("[_withdraw()] Tail Asset");
        }

        // // NOTE: Allowing also USDLemma to deposit USDC 
        // if(collateral == address(usdc)) {
        //     perpVault.withdraw(address(usdc), amountToWithdraw);
        // }
    }

    /// NOTE: for USDL ineternal,
    /// closeWExactCollateralAfterSettlementForUSDL & closeWExactUSDLAfterSettlementForUSDL

    /// @notice closeWExactCollateralAfterSettlementForUSDL is use to distribute collateral using on pro rata based user's share(USDL).
    /// @param collateralAmount this method distribute collateral by exact collateral
    function closeWExactCollateralAfterSettlementForUSDL(uint256 collateralAmount)
        internal
        returns (uint256 USDLToBurn)
    {
        //No Position at settlement --> no more USDL to Burn
        require(positionAtSettlementInQuoteForUSDL > 0, "Settled vUSD position amount should not ZERO");
        //No collateral --> no more collateralt to give out
        require(usdlCollateral.balanceOf(address(this)) > 0, "Settled collateral amount should not ZERO");
        uint256 amountCollateralToTransfer = getAmountInCollateralDecimalsForPerp(
            collateralAmount,
            address(usdlCollateral),
            false
        );
        require(amountCollateralToTransfer > 0, "Amount should greater than zero");
        USDLToBurn =
            (amountCollateralToTransfer * positionAtSettlementInQuoteForUSDL) /
            usdlCollateral.balanceOf(address(this));
        SafeERC20Upgradeable.safeTransfer(usdlCollateral, usdLemma, amountCollateralToTransfer);
        positionAtSettlementInQuoteForUSDL -= USDLToBurn;
    }

    /// @notice closeWExactUSDLAfterSettlementForUSDL is used to distribute collateral using on pro rata based user's share(USDL).
    /// @param usdlAmount this method distribute collateral by exact usdlAmount
    function closeWExactUSDLAfterSettlementForUSDL(uint256 usdlAmount)
        internal
        returns (uint256 amountCollateralToTransfer1e_18)
    {
        // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more USDL to Burn
        require(positionAtSettlementInQuoteForUSDL > 0, "Settled vUSD position amount should not ZERO");
        // WPL_NC : Wrapper PerpLemma, No Collateral
        require(usdlCollateral.balanceOf(address(this)) > 0, "Settled collateral amount should not ZERO");
        amountCollateralToTransfer1e_18 =
            (usdlAmount * usdlCollateral.balanceOf(address(this))) /
            positionAtSettlementInQuoteForUSDL;
        uint256 amountCollateralToTransfer = getAmountInCollateralDecimalsForPerp(
            amountCollateralToTransfer1e_18,
            address(usdlCollateral),
            false
        );
        require(amountCollateralToTransfer > 0, "Amount should greater than zero");
        SafeERC20Upgradeable.safeTransfer(usdlCollateral, usdLemma, amountCollateralToTransfer);
        positionAtSettlementInQuoteForUSDL -= usdlAmount;
    }

    /*
    /// NOTE: for Synth ineternal,
    /// closeWExactCollateralAfterSettlementForSynth & closeWExactETHLAfterSettlementForSynth
    /// @notice closeWExactCollateralAfterSettlementForSynth is use to distribute collateral using on pro rata based user's share(ETHL).
    /// @param collateralAmount this method distribute collateral by exact collateral
    // function closeWExactCollateralAfterSettlementForSynth(uint256 collateralAmount)
    //     internal
    //     returns (uint256 ETHLToBurn)
    // {
    //     // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more ETHL to Burn
    //     require(positionAtSettlementInQuoteForSynth > 0, "Settled vUSD position amount should not ZERO");
    //     // WPL_NC : Wrapper PerpLemma, No Collateral
    //     require(synthCollateral.balanceOf(address(this)) > 0, "Settled collateral amount should not ZERO");
    //     uint256 amountCollateralToTransfer = getAmountInCollateralDecimalsForPerp(
    //         collateralAmount,
    //         address(synthCollateral),
    //         false
    //     );
    //     ETHLToBurn =
    //         (amountCollateralToTransfer * positionAtSettlementInQuoteForSynth) /
    //         synthCollateral.balanceOf(address(this));
    //     SafeERC20Upgradeable.safeTransfer(synthCollateral, usdLemma, amountCollateralToTransfer);
    //     positionAtSettlementInQuoteForSynth -= ETHLToBurn;
    // }
    */


    /*
    /// @notice closeWExactETHLAfterSettlementForSynth is use to distribute collateral using on pro rata based user's share(ETHL).
    /// @param ethlAmount this method distribute collateral by exact ethlAmount
    // function closeWExactETHLAfterSettlementForSynth(uint256 ethlAmount) internal returns (uint256 ETHLToBurn) {
    //     // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more ETHL to Burn
    //     require(positionAtSettlementInQuoteForSynth > 0, "Settled vUSD position amount should not ZERO");
    //     // WPL_NC : Wrapper PerpLemma, No Collateral
    //     require(synthCollateral.balanceOf(address(this)) > 0, "Settled collateral amount should not ZERO");
    //     ethlAmount = getAmountInCollateralDecimalsForPerp(ethlAmount, address(synthCollateral), false);
    //     uint256 amountCollateralToTransfer = (ethlAmount * synthCollateral.balanceOf(address(this))) /
    //         positionAtSettlementInQuoteForSynth;
    //     SafeERC20Upgradeable.safeTransfer(synthCollateral, usdLemma, amountCollateralToTransfer);
    //     positionAtSettlementInQuoteForSynth -= ethlAmount;
    //     ETHLToBurn = ethlAmount;
    // }
    */

    function _msgSender()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        return super._msgSender();
    }

    function _msgData()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata)
    {
        return super._msgData();
    }

//////////////////// UNNECESSARY CODE ////////////////

    /*
    /// METHODS WITH EXACT USDL or vUSD(quote or vUSD)
    /// 1). getCollateralAmountGivenUnderlyingAssetAmountForPerp and openShortWithExactQuoteForUSDL
    /// 2). getCollateralAmountGivenUnderlyingAssetAmountForPerp and closeLongWithExactQuoteForUSDL

    /// METHODS WITH EXACT ETH or vETH(base or vETH)
    /// 3). getCollateralAmountGivenUnderlyingAssetAmountForPerp and openLongWithExactBaseForSynth
    /// 4). getCollateralAmountGivenUnderlyingAssetAmountForPerp and closeShortWithExactBaseForSynth

    /// @notice getCollateralAmountGivenUnderlyingAssetAmountForPerp will create short or long position and give base or quote amount as collateral
    /// @param amount is for exact amount of USDL will use to create a short or long position instead ethCollateral
    /// @param isShorting is bool for need to do short or long
    function getCollateralAmountGivenUnderlyingAssetAmountForPerp1(
        uint256 amount,
        bool isShorting
        // bool isUsdl
    ) external override onlyUSDLemma returns (uint256 collateral) {
        bool _isBaseToQuote;
        bool _isExactInput;
        address baseTokenAddress;

        baseTokenAddress = usdlBaseTokenAddress;
        if (isShorting) {
            // before openShortWithExactQuoteForUSDL
            // open short position for eth and amount in vUSD
            _isBaseToQuote = true;
            _isExactInput = false;
        } else {
            // before closeLongWithExactQuoteForUSDL
            // open long position for eth and amount in vUSD
            _isBaseToQuote = false;
            _isExactInput = true;
            if (hasSettled) return closeWExactUSDLAfterSettlementForUSDL(amount);
        }

        // if (isUsdl) {
        //     baseTokenAddress = usdlBaseTokenAddress;
        //     if (isShorting) {
        //         // before openShortWithExactQuoteForUSDL
        //         // open short position for eth and amount in vUSD
        //         _isBaseToQuote = true;
        //         _isExactInput = false;
        //     } else {
        //         // before closeLongWithExactQuoteForUSDL
        //         // open long position for eth and amount in vUSD
        //         _isBaseToQuote = false;
        //         _isExactInput = true;
        //         if (hasSettled) return closeWExactUSDLAfterSettlementForUSDL(amount);
        //     }
        // } else {
        //     baseTokenAddress = synthBaseTokenAddress;
        //     if (isShorting) {
        //         // before closeShortWithExactBaseForSynth
        //         _isBaseToQuote = true;
        //         _isExactInput = true;
        //         if (hasSettled) return closeWExactCollateralAfterSettlementForSynth(amount);
        //     } else {
        //         // before openLongWithExactBaseForSynth
        //         _isBaseToQuote = false;
        //         _isExactInput = false;
        //     }
        // }

        totalFundingPNL = getFundingPNL(baseTokenAddress);
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: _isBaseToQuote,
            isExactInput: _isExactInput,
            amount: amount,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (uint256 base, uint256 quote) = clearingHouse.openPosition(params);
        collateral = base;

        // if (isUsdl) {
        //     collateral = base;
        // } else {
        //     collateral = quote;
        // }
    }

    // NOT IMPLEMENTED

    function getCollateralAmountGivenUnderlyingAssetAmount(uint256, bool) public override returns (uint256) {
        revert("not supported");
    }

    function open(uint256, uint256) public override {
        revert("not supported");
    }

    function close(uint256, uint256) public override {
        revert("not supported");
    }

    function openWExactCollateral(uint256) public override returns (uint256) {
        revert("not supported");
    }

    function closeWExactCollateral(uint256) public override returns (uint256) {
        revert("not supported");
    }

    function getAmountInCollateralDecimals(uint256, bool) public pure override returns (uint256) {
        revert("not supported");
    }

    // /// getCollateralAmountGivenUnderlyingAssetAmountForPerp =>
    // /// @notice Open short position for eth(baseToken) on gCAGUAAFP method first using exact amount of USDL(or vUSD you can say) and then deposit collateral here
    // /// @param collateralAmountRequired collateral amount required to open the position
    // function openShortWithExactQuoteForUSDL(uint256 amount, address collateral) external override onlyUSDLemma returns(uint256 amountBase) {
    //     require(amount > 0, "Input Amount should be greater than zero");

    //     // isShorting = true 
    //     // isExactUSDL = true
    //     (amountBase, _) = _trade(amount, true, true);

    //     // uint256 _collateralAmountRequired = _trade(amount, true, true);
    //     // uint256 _collateralAmountToDeposit = getAmountInCollateralDecimalsForPerp(
    //     //     _collateralAmountRequired,
    //     //     address(usdlCollateral),
    //     //     false
    //     // );
    //     // require(_collateralAmountToDeposit > 0, "Collateral to deposit Amount should be greater than zero");
    //     // require(usdlCollateral.balanceOf(address(this)) >= _collateralAmountToDeposit, "Not enough collateral to Open");


    //     // // NOTE: Only non-tail assets can be deposited in Perp, the other assets have to remain in this contract balance sheet
    //     // _deposit(collateralAmountToDeposit, address(collateral));
    // }


    // /// @notice Open long position for eth(baseToken) on gCAGUAAFP first using exact amount of USDL(or vUSD you can say) and withdraw collateral here
    // /// @param collateralAmountToGetBack collateral amount to withdraw after close position
    // function closeLongWithExactQuoteForUSDL(uint256, uint256 collateralAmountToGetBack) external override onlyUSDLemma {
    //     require(collateralAmountToGetBack > 0, "Amount should be greater than zero");
    //     uint256 amountToWithdraw = getAmountInCollateralDecimalsForPerp(
    //         collateralAmountToGetBack,
    //         address(usdlCollateral),
    //         false
    //     );
    //     require(amountToWithdraw > 0, "Amount should be greater than zero");

    //     // NOTE: Only non-tail asset can be withdrawn, the other one is already on this contract balance sheet 
    //     _withdraw(amountToWithdraw, address(usdlCollateral));
    //     SafeERC20Upgradeable.safeTransfer(usdlCollateral, usdLemma, amountToWithdraw);
    // }

    // /// @notice Open long position for eth(baseToken) on gCAGUAAFP first and deposit collateral here
    // /// @param collateralAmountRequired collateral amount required to open the position
    // function openLongWithExactBaseForSynth(uint256, uint256 collateralAmountRequired) external override onlyUSDLemma {
    //     require(collateralAmountRequired > 0, "Amount should greater than zero");
    //     uint256 collateralAmountToDeposit = getAmountInCollateralDecimalsForPerp(
    //         collateralAmountRequired,
    //         address(synthCollateral),
    //         false
    //     );
    //     require(collateralAmountToDeposit > 0, "Amount should greater than zero");
    //     require(synthCollateral.balanceOf(address(this)) >= collateralAmountToDeposit, "not enough collateral");
    //     _deposit(collateralAmountToDeposit, address(synthCollateral));
    //     // _deposit(collateralAmountToDeposit, address(synthCollateral));
    // }

    // /// @notice Open short position for eth(quoteToken) on gCAGUAAFP first and withdraw collateral here
    // /// @param collateralAmountToGetBack collateral amount to withdraw after close position
    // function closeShortWithExactBaseForSynth(uint256, uint256 collateralAmountToGetBack)
    //     external
    //     override
    //     onlyUSDLemma
    // {
    //     require(collateralAmountToGetBack > 0, "Amount should greater than zero");
    //     uint256 amountToWithdraw = getAmountInCollateralDecimalsForPerp(
    //         collateralAmountToGetBack,
    //         address(synthCollateral),
    //         false
    //     );
    //     require(amountToWithdraw > 0, "Amount should greater than zero");
    //     _withdraw(amountToWithdraw, address(synthCollateral));
    //     SafeERC20Upgradeable.safeTransfer(synthCollateral, usdLemma, amountToWithdraw);
    // }

    // /// METHODS WITH EXACT COLLATERAL FOR USDL Token(Base or Eth)
    // /// 1). openShortWithExactCollateral
    // /// 2). closeLongWithExactCollateral

    // /// @notice Open short position for eth(baseToken) first and deposit collateral here
    // /// @param collateralAmount collateral amount required to open the position
    // function openShortWithExactCollateral(uint256 collateralAmount)
    //     external
    //     override
    //     onlyUSDLemma
    //     returns (uint256 USDLToMint)
    // {
    //     require(!hasSettled, "Market Closed");
    //     uint256 collateralAmountToDeposit = getAmountInCollateralDecimalsForPerp(
    //         collateralAmount,
    //         address(usdlCollateral),
    //         false
    //     );
    //     require(collateralAmountToDeposit > 0, "Amount should greater than zero");
    //     require(
    //         usdlCollateral.balanceOf(address(this)) >= collateralAmountToDeposit,
    //         "Not enough collateral for openShortWithExactCollateral"
    //     );

    //     totalFundingPNL = getFundingPNL(usdlBaseTokenAddress);

    //     _deposit(collateralAmountToDeposit, address(usdlCollateral));

    //     // if(! isUsdlCollateralTailAsset) {
    //     //     perpVault.deposit(address(usdlCollateral), collateralAmountToDeposit);
    //     // }


    //     // create long for usdc and short for eth position by giving isBaseToQuote=true
    //     // and amount in eth(baseToken) by giving isExactInput=true
    //     IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
    //         baseToken: usdlBaseTokenAddress,
    //         isBaseToQuote: true,
    //         isExactInput: true,
    //         amount: collateralAmount,
    //         oppositeAmountBound: 0,
    //         deadline: MAX_UINT256,
    //         sqrtPriceLimitX96: 0,
    //         referralCode: referrerCode
    //     });
    //     (, uint256 quote) = clearingHouse.openPosition(params);

    //     int256 positionSize = accountBalance.getTotalPositionSize(address(this), usdlBaseTokenAddress);
    //     require(positionSize.abs().toUint256() <= maxPosition, "max position reached");
    //     USDLToMint = quote;
    // }

    // /// @notice Open long position for eth(baseToken) first and withdraw collateral here
    // /// @param collateralAmount collateral amount require to close or long position
    // function closeLongWithExactCollateral(uint256 collateralAmount)
    //     external
    //     override
    //     onlyUSDLemma
    //     returns (uint256 USDLToBurn)
    // {
    //     if (hasSettled) return closeWExactCollateralAfterSettlementForUSDL(collateralAmount);

    //     totalFundingPNL = getFundingPNL(usdlBaseTokenAddress);

    //     //simillar to openWExactCollateral but for close
    //     IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
    //         baseToken: usdlBaseTokenAddress,
    //         isBaseToQuote: false,
    //         isExactInput: false,
    //         amount: collateralAmount,
    //         oppositeAmountBound: 0,
    //         deadline: MAX_UINT256,
    //         sqrtPriceLimitX96: 0,
    //         referralCode: referrerCode
    //     });
    //     (, uint256 quote) = clearingHouse.openPosition(params);
    //     USDLToBurn = quote;

    //     uint256 amountToWithdraw = getAmountInCollateralDecimalsForPerp(
    //         collateralAmount,
    //         address(usdlCollateral),
    //         false
    //     );
    //     require(amountToWithdraw > 0, "Amount should greater than zero");

    //     _withdraw(amountToWithdraw, address(usdlCollateral));
    //     // if(! isUsdlCollateralTailAsset) {
    //     //     perpVault.withdraw(address(usdlCollateral), amountToWithdraw); // withdraw closed position fund            
    //     // }

    //     SafeERC20Upgradeable.safeTransfer(usdlCollateral, usdLemma, amountToWithdraw);
    // }

    // /// METHODS WITH EXACT COLLATERAL FOR SyntheticToken(Base or Eth)
    // /// 1). openLongWithExactCollateral
    // /// 2). closeShortWithExactCollateral

    // /// @notice Open long position for eth(quoteToken) first and deposit collateral here
    // /// @param collateralAmount collateral amount required to open the position. amount is in vUSD(quoteToken)
    // function openLongWithExactCollateral(uint256 collateralAmount)
    //     external
    //     override
    //     onlyUSDLemma
    //     returns (uint256 ETHLToMint)
    // {
    //     console.log("[openLongWithExactCollateral()] T1");
    //     require(!hasSettled, "Market Closed");
    //     console.log("[openLongWithExactCollateral()] T2");
    //     uint256 collateralAmountToDeposit = getAmountInCollateralDecimalsForPerp(
    //         collateralAmount,
    //         address(synthCollateral),
    //         false
    //     );
    //     require(collateralAmountToDeposit > 0, "Amount should greater than zero");
    //     console.log("[openLongWithExactCollateral()] T3");
    //     require(
    //         synthCollateral.balanceOf(address(this)) >= collateralAmountToDeposit,
    //         "Not enough collateral for openLongWithExactCollateral"
    //     );
    //     console.log("[openLongWithExactCollateral()] T5");

    //     totalFundingPNL = getFundingPNL(usdlBaseTokenAddress);
    //     // totalFundingPNL = getFundingPNL(synthBaseTokenAddress);
    //     _deposit(collateralAmountToDeposit, address(synthCollateral));
    //     console.log("[openLongWithExactCollateral()] T6");

    //     // if(! isUsdlCollateralTailAsset) {
    //     //     perpVault.deposit(address(synthCollateral), collateralAmountToDeposit);
    //     // }


    //     // create long for usdc and short for eth position by giving isBaseToQuote=false
    //     // and amount in usdc(quoteToken) by giving isExactInput=true
    //     IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
    //         baseToken: synthBaseTokenAddress,
    //         isBaseToQuote: false,
    //         isExactInput: true,
    //         amount: collateralAmount,
    //         oppositeAmountBound: 0,
    //         deadline: MAX_UINT256,
    //         sqrtPriceLimitX96: 0,
    //         referralCode: referrerCode
    //     });
    //     (uint256 base, ) = clearingHouse.openPosition(params);
    //     console.log("[openLongWithExactCollateral()] T7");

    //     int256 positionSize = accountBalance.getTotalPositionSize(address(this), synthBaseTokenAddress);
    //     console.log("[openLongWithExactCollateral()] positionSize.abs().toUint256() = ", positionSize.abs().toUint256());
    //     require(positionSize.abs().toUint256() <= maxPosition, "max position reached");
    //     console.log("[openLongWithExactCollateral()] T10");
    //     ETHLToMint = base;
    // }

    // /// @notice Open short position for eth(quoteToken) first and withdraw collateral here
    // /// @param collateralAmount collateral amount require to close or long position. amount is in vUSD(quoteToken)
    // function closeShortWithExactCollateral(uint256 collateralAmount)
    //     external
    //     override
    //     onlyUSDLemma
    //     returns (uint256 ETHLToBurn)
    // {
    //     if (hasSettled) return closeWExactETHLAfterSettlementForSynth(collateralAmount);

    //     totalFundingPNL = getFundingPNL(synthBaseTokenAddress);

    //     // simillar to openWExactCollateral but for close
    //     IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
    //         baseToken: synthBaseTokenAddress,
    //         isBaseToQuote: true,
    //         isExactInput: false,
    //         amount: collateralAmount,
    //         oppositeAmountBound: 0,
    //         deadline: MAX_UINT256,
    //         sqrtPriceLimitX96: 0,
    //         referralCode: referrerCode
    //     });
    //     (uint256 base, ) = clearingHouse.openPosition(params);
    //     ETHLToBurn = base;

    //     uint256 amountToWithdraw = getAmountInCollateralDecimalsForPerp(
    //         collateralAmount,
    //         address(synthCollateral),
    //         false
    //     );
    //     require(amountToWithdraw > 0, "Amount should greater than zero");
    //     _withdraw(amountToWithdraw, address(synthCollateral));
    //     // if(! isUsdlCollateralTailAsset) {
    //     //     perpVault.withdraw(address(synthCollateral), amountToWithdraw); // withdraw closed position fund
    //     // }

    //     SafeERC20Upgradeable.safeTransfer(synthCollateral, usdLemma, amountToWithdraw);
    // }


    */



}
