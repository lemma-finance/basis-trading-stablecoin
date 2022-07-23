// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;

import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
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
import "../interfaces/Perpetual/IBaseToken.sol";

// NOTE: There is an incompatibility between Foundry and Hardhat `console.log()`
import "forge-std/Test.sol";

// import "hardhat/console.sol";

contract PerpLemmaCommon is OwnableUpgradeable, ERC2771ContextUpgradeable, IPerpetualMixDEXWrapper, AccessControlUpgradeable {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using Utils for int256;
    using SafeMathExt for int256;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ONLY_OWNER = keccak256("ONLY_OWNER");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");
    bytes32 public constant PERPLEMMA_ROLE = keccak256("PERPLEMMA_ROLE");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    address public usdLemma;
    address public lemmaSynth;
    address public reBalancer;
    address public usdlBaseTokenAddress;
    bytes32 public referrerCode;

    IClearingHouse public clearingHouse;
    IClearingHouseConfig public clearingHouseConfig;
    IPerpVault public perpVault;
    IAccountBalance public accountBalance;
    IMarketRegistry public marketRegistry;
    IExchange public exchange;

    bool public isUsdlCollateralTailAsset;
    IERC20Decimals public usdlCollateral;
    IERC20Decimals public usdc;

    uint256 public constant MAX_UINT256 = type(uint256).max;
    uint256 public maxPosition;
    uint256 public usdlCollateralDecimals;

    int256 public amountBase;
    int256 public amountQuote;
    uint256 public amountUsdlCollateralDeposited;

    uint256 public totalUsdlCollateral; // Tail Asset
    uint256 public totalSynthCollateral; // USDC

    // Gets set only when Settlement has already happened
    // NOTE: This should be equal to the amount of USDL minted depositing on that dexIndex
    uint256 public mintedPositionUsdlForThisWrapper;
    uint256 public mintedPositionSynthForThisWrapper;

    // Has the Market Settled
    bool public override hasSettled;
    address public rebalancer;

    // events
    event USDLemmaUpdated(address usdlAddress);
    event ReferrerUpdated(bytes32 referrerCode);
    event RebalancerUpdated(address rebalancerAddress);
    event MaxPositionUpdated(uint256 maxPos);

    ////////////////////////
    /// EXTERNAL METHODS ///
    ////////////////////////

    function initialize(
        address _trustedForwarder,
        address _usdlCollateral,
        address _usdlBaseToken,
        address _clearingHouse,
        address _marketRegistry,
        address _usdLemma,
        address _lemmaSynth,
        uint256 _maxPosition
    ) external initializer {
        __Ownable_init();
        __ERC2771Context_init(_trustedForwarder);
        
        __AccessControl_init();
        _setRoleAdmin(PERPLEMMA_ROLE, ADMIN_ROLE);
        _setRoleAdmin(ONLY_OWNER, ADMIN_ROLE);
        _setRoleAdmin(USDC_TREASURY, ADMIN_ROLE);
        _setRoleAdmin(REBALANCER_ROLE, ADMIN_ROLE);
        _setupRole(ADMIN_ROLE, msg.sender);
        grantRole(ONLY_OWNER, msg.sender);
        grantRole(PERPLEMMA_ROLE, _usdLemma);
        grantRole(PERPLEMMA_ROLE, _lemmaSynth);

        require(_usdlBaseToken != address(0), "UsdlBaseToken should not ZERO address");
        require(_clearingHouse != address(0), "ClearingHouse should not ZERO address");
        require(_marketRegistry != address(0), "MarketRegistry should not ZERO address");

        // NOTE: Even though it is not necessary, it is for clarity
        hasSettled = false;
        usdLemma = _usdLemma;
        lemmaSynth = _lemmaSynth;
        usdlBaseTokenAddress = _usdlBaseToken;
        maxPosition = _maxPosition;

        clearingHouse = IClearingHouse(_clearingHouse);
        clearingHouseConfig = IClearingHouseConfig(clearingHouse.getClearingHouseConfig());
        perpVault = IPerpVault(clearingHouse.getVault());
        exchange = IExchange(clearingHouse.getExchange());
        accountBalance = IAccountBalance(clearingHouse.getAccountBalance());
        marketRegistry = IMarketRegistry(_marketRegistry);
        usdc = IERC20Decimals(perpVault.getSettlementToken());

        usdlCollateral = IERC20Decimals(_usdlCollateral);
        usdlCollateralDecimals = usdlCollateral.decimals(); // need to verify
        usdlCollateral.approve(_clearingHouse, MAX_UINT256);

        SafeERC20Upgradeable.safeApprove(usdlCollateral, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, address(perpVault), MAX_UINT256);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), MAX_UINT256);

        if (usdLemma != address(0)) {
            SafeERC20Upgradeable.safeApprove(usdc, usdLemma, 0);
            SafeERC20Upgradeable.safeApprove(usdc, usdLemma, MAX_UINT256);
            SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, 0);
            SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, MAX_UINT256);
        }

        if (lemmaSynth != address(0)) {
            SafeERC20Upgradeable.safeApprove(usdc, lemmaSynth, 0);
            SafeERC20Upgradeable.safeApprove(usdc, lemmaSynth, MAX_UINT256);
            SafeERC20Upgradeable.safeApprove(usdlCollateral, lemmaSynth, 0);
            SafeERC20Upgradeable.safeApprove(usdlCollateral, lemmaSynth, MAX_UINT256);
        }
    }

    function changeAdmin(address newAdmin) public onlyRole(ADMIN_ROLE) {
        require(newAdmin != msg.sender, "Admin Addresses should not be same");
        _setupRole(ADMIN_ROLE, newAdmin);
        renounceRole(ADMIN_ROLE, msg.sender);
    }

    ///@notice sets reBalncer address - only owner can set
    ///@param _reBalancer reBalancer address to set
    function setReBalancer(address _reBalancer) external onlyRole(ADMIN_ROLE) {
        require(_reBalancer != address(0), "ReBalancer should not ZERO address");
        grantRole(REBALANCER_ROLE, _reBalancer);
        emit RebalancerUpdated(_reBalancer);
    }

    /// @notice reset approvals
    function resetApprovals() external {
        SafeERC20Upgradeable.safeApprove(usdlCollateral, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, address(perpVault), MAX_UINT256);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), MAX_UINT256);
    }

    function getUsdlCollateralDecimals() external view override returns(uint256) {
        return usdlCollateralDecimals;
    }

    function getIndexPrice() external view override returns(uint256) {
        uint256 _twapInterval = IClearingHouseConfig(clearingHouseConfig).getTwapInterval();
        uint256 _price = IIndexPrice(usdlBaseTokenAddress).getIndexPrice(_twapInterval);
        console.log("[getIndexPrice()] _twapInterval = ", _twapInterval);
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

    function getSettlementTokenAmountInVault() external view override returns(int256) {
        return perpVault.getBalance(address(this));
    }

    // Returns the leverage in 1e18 format
    // TODO: Take into account tail assets
    function getRelativeMargin() external view override returns(uint256) {
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

        console.log(
            "[getRelativeMargin()] _accountValue_1e18 = %s %d",
            (_accountValue < 0) ? "-" : "+",
            _accountValue_1e18.abs().toUint256()
        );
        console.log("[getRelativeMargin()] _accountValue = ", _accountValue);
        console.log("[getRelativeMargin()] _margin = %s %d", (_margin < 0) ? "-" : "+", _margin.abs().toUint256());

        return (
            (_accountValue_1e18 <= int256(0) || (_margin < 0))
                ? type(uint256).max // No Collateral Deposited --> Max Leverage Possible
                : (_margin.abs().toUint256() * 1e18) / _accountValue
        );

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
    function getDeltaExposure() external view override returns(int256) {
        (uint256 _usdlCollateralAmount, uint256 _usdlCollateralDepositedAmount, int256 _longOrShort,,) = getExposureDetails();
        uint256 _longOnly = (_usdlCollateralAmount + _usdlCollateralDepositedAmount) * 10**(18 - usdlCollateralDecimals);         // Both usdlCollateralDecimals format

        console.log("[getDeltaExposure()] _longOnly = ", _longOnly);
        console.log(
            "[getDeltaExposure()] _longOrShort = %s %d",
            (_longOrShort < 0) ? "-" : "+",
            _longOrShort.abs().toUint256()
        );

        int256 _deltaLongShort = int256(_longOnly) + _longOrShort;
        console.log(
            "[getDeltaExposure()] _deltaLongShort = %s %d",
            (_deltaLongShort < 0) ? "-" : "+",
            _deltaLongShort.abs().toUint256()
        );
        uint256 _absTot = _longOnly + _longOrShort.abs().toUint256();
        console.log("[getDeltaExposure()] _absTot = ", _absTot);
        int256 _delta = (_absTot == 0) ? int256(0) : (_deltaLongShort * 1e6) / int256(_absTot);
        console.log(
            "[getDeltaExposure()] getDeltaExposure = %s %d",
            (_delta < 0) ? "-" : "+",
            _delta.abs().toUint256()
        );
        return _delta;
    }

    function getExposureDetails() public view override returns(uint256, uint256, int256, int256, uint256) {
        return (
            usdlCollateral.balanceOf(address(this)),
            amountUsdlCollateralDeposited,
            amountBase, // All the other terms are in 1e6
            perpVault.getBalance(address(this)), // This number could change when PnL gets realized so it is better to read it from the Vault directly
            usdc.balanceOf(address(this))
        );
    }

    function getMargin() external view override returns(int256) {
        int256 _margin = accountBalance.getMarginRequirementForLiquidation(address(this));
        console.log("[getMargin()] Margin = %s %d", (_margin < 0) ? "-" : "+", _margin.abs().toUint256());
        return _margin;
    }

    function setIsUsdlCollateralTailAsset(bool _x) external onlyRole(ONLY_OWNER) {
        isUsdlCollateralTailAsset = _x;
    }

    ///@notice sets USDLemma address - only owner can set
    ///@param _usdLemma USDLemma address to set
    function setUSDLemma(address _usdLemma) external onlyRole(ONLY_OWNER) {
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
    function setReferrerCode(bytes32 _referrerCode) external onlyRole(ONLY_OWNER) {
        referrerCode = _referrerCode;
        emit ReferrerUpdated(referrerCode);
    }

    ///@notice sets maximum position the wrapper can take (in terms of base) - only owner can set
    ///@param _maxPosition reBalancer address to set
    function setMaxPosition(uint256 _maxPosition) external onlyRole(ONLY_OWNER)  {
        maxPosition = _maxPosition;
        emit MaxPositionUpdated(maxPosition);
    }

    /// @notice depositSettlementToken is used to deposit settlement token USDC into perp vault - only owner can deposit
    /// @param _amount USDC amount need to deposit into perp vault
    function depositSettlementToken(uint256 _amount) external override onlyRole(USDC_TREASURY) {
        require(_amount > 0, "Amount should greater than zero");
        SafeERC20Upgradeable.safeTransferFrom(usdc, msg.sender, address(this), _amount);
        perpVault.deposit(address(usdc), _amount);
        totalSynthCollateral += _amount;
    }

    /// @notice withdrawSettlementToken is used to withdraw settlement token USDC from perp vault - only owner can withdraw
    /// @param _amount USDC amount need to withdraw from perp vault
    function withdrawSettlementToken(uint256 _amount) external override onlyRole(USDC_TREASURY) {
        require(_amount > 0, "Amount should greater than zero");
        perpVault.withdraw(address(usdc), _amount);
        SafeERC20Upgradeable.safeTransfer(usdc, msg.sender, _amount);
        totalSynthCollateral -= _amount;
    }

    function withdrawSettlementTokenTo(uint256 _amount, address to) external onlyRole(USDC_TREASURY) {
        require(_amount > 0, "Amount should greater than zero");
        require(hasSettled, "Perpetual is not settled yet");
        SafeERC20Upgradeable.safeTransfer(usdc, to, _amount);
        totalSynthCollateral -= _amount;
    }

    function deposit(uint256 amount, address collateral, Basis basis) external override onlyRole(PERPLEMMA_ROLE) {
        _deposit(amount, collateral, basis);
    }

    function withdraw(uint256 amount, address collateral, Basis basis) external override onlyRole(PERPLEMMA_ROLE) {
        _withdraw(amount, collateral, basis);
    }

    //// @notice when perpetual is in CLEARED state, withdraw the collateral
    function settle() external override {
        clearingHouse.quitMarket(address(this), usdlBaseTokenAddress);

        // NOTE: Settle pending funding rates
        clearingHouse.settleAllFunding(address(this));

        uint256 freeUSDCCollateral = perpVault.getFreeCollateral(address(this));
        _withdraw(freeUSDCCollateral, address(usdc), Basis.IsSettle);

        if (!isUsdlCollateralTailAsset) {
            // NOTE: This amount of free collateral is the one internally used to check for the V_NEFC error, so this is the max withdrawable
            uint256 freeCollateralUSDL = perpVault.getFreeCollateralByToken(address(this), address(usdlCollateral));
            _withdraw(freeCollateralUSDL, address(usdlCollateral), Basis.IsSettle);
        }

        // All the collateral is now back
        hasSettled = true;
    }

    function getCollateralBackAfterSettlement(
        uint256 amount, address to, bool isUsdl
    ) external override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        return settleCollateral(amount, to, isUsdl);
    }

    /// @notice Rebalances USDL or Synth emission swapping by Perp backed to Token backed
    /// @dev USDL can be backed by both: 1) Floating Collateral + Perp Short of the same Floating Collateral or 2) USDC
    /// @dev LemmaX (where X can be ETH, ...) can be backed by both: 1) USDC collateralized Perp Long or 2) X token itself
    /// @dev The idea is to use this mechanism for this purposes like Arbing between Mark and Spot Price or adjusting our tokens in our balance sheet for LemmaSwap supply
    /// @dev Details at https://www.notion.so/lemmafinance/Rebalance-Details-f72ad11a5d8248c195762a6ac6ce037e
    ///
    /// @param router The Router to execute the swap on
    /// @param routerType The Router Type: 0 --> UniV3, ... 
    /// @param amountBaseToRebalance The Amount of Base Token to buy or sell on Perp and consequently the amount of corresponding colletarl to sell or buy on Spot 
    /// @param isCheckProfit Check the profit to possibly revert the TX in case 
    /// @return Amount of USDC resulting from the operation. It can also be negative as we can use this mechanism for purposes other than Arb See https://www.notion.so/lemmafinance/Rebalance-Details-f72ad11a5d8248c195762a6ac6ce037e#ffad7b09a81a4b049348e3cd38e57466 here 
    function rebalance(address router, uint256 routerType, int256 amountBaseToRebalance, bool isCheckProfit) external override onlyRole(REBALANCER_ROLE) returns(uint256, uint256) {
        console.log("[rebalance()] Start");
        // uint256 usdlCollateralAmountPerp;
        // uint256 usdlCollateralAmountDex;
        uint256 amountUSDCPlus;
        uint256 amountUSDCMinus;

        require(amountBaseToRebalance != 0, "! No Rebalance with Zero Amount");

        bool isIncreaseBase = amountBaseToRebalance > 0;
        uint256 _amountBaseToRebalance = (isIncreaseBase)
            ? uint256(amountBaseToRebalance)
            : uint256(-amountBaseToRebalance);

        // NOTE: Changing the position on Perp requires checking we are properly collateralized all the time otherwise doing the trade risks to revert the TX
        // NOTE: Call to perps that can revert the TX: withdraw(), openPosition()
        // NOTE: Actually, probably also deposit() is not safe as some max threshold can be crossed but this is something different from the above
        if (isIncreaseBase) {
            console.log(
                "[rebalance()] isIncreaseBase: True --> Sell Collateral on Spot and Buy on Mark. Colleteral --> USDC --> vCollateral"
            );
            if (amountBase < 0) {
                console.log(
                    "[rebalance()] Net Short --> Decrease Negative Base --> Close Short, free floating collateral (if any) and swap it for USDC"
                );
                // NOTE: Net Short Position --> USDL Collateral is currently deposited locally if tail asset or in Perp otherwise
                // NOTE: In this case, we need to shrink our position before we can withdraw to swap so
                (, uint256 amountUSDCMinus_1e18) = closeShortWithExactBase(_amountBaseToRebalance, address(0), 0, Basis.IsRebalance);
                // (usdlCollateralAmount, ) = closeShortWithExactQuote(amount, address(0), 0);
                amountUSDCMinus = amountUSDCMinus_1e18 * (10 ** usdc.decimals()) / 1e18;

                // NOTE: Only withdraws from Perp if it is a non tail asset
                _withdraw(_amountBaseToRebalance, address(usdlCollateral), Basis.IsRebalance);

                console.log("_amountBaseToRebalance = ", _amountBaseToRebalance);
                console.log("usdlCollateral.balanceOf(address(this)) = ", usdlCollateral.balanceOf(address(this)));

                require(usdlCollateral.balanceOf(address(this)) > _amountBaseToRebalance, "T1");
                amountUSDCPlus = _CollateralToUSDC(router, routerType, true, _amountBaseToRebalance);
                // if(isCheckProfit) require(amountUSDCPlus >= amountUSDCMinus, "Unprofitable");
            } else {
                console.log(
                    "[rebalance()] Net Long amount is Base --> Increase Positive Base --> Sell floating collateral for USDC, use it to incrase long"
                );
                // NOTE: Net Long Position --> USDL Collateral is not deposited in Perp but floating in the local balance sheet so we do not have to do anything before the trade
                amountUSDCPlus = _CollateralToUSDC(router, routerType, true, _amountBaseToRebalance);
                _deposit(amountUSDCPlus, address(usdc), Basis.IsRebalance);
                (, uint256 amountUSDCMinus_1e18) = openLongWithExactBase(_amountBaseToRebalance, address(0), 0, Basis.IsRebalance);
                amountUSDCMinus = amountUSDCMinus_1e18 * (10 ** usdc.decimals()) / 1e18;
                // (usdlCollateralAmount, ) = openLongWithExactQuote(usdcAmount, address(0), 0);
                // if(isCheckProfit) require(amountUSDCPlus >= amountUSDCMinus, "Unprofitable");
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
            console.log("[rebalance()] isIncreaseBase: False --> Base should decrease. USDC --> Collateral --> vQuote");
            // TODO: Fix the following --> the commented part should be the right one
            if (amountBase <= 0) {
                // NOTE: We are net short
                console.log(
                    "[rebalance()] Net Short --> Increase Negative Base --> Sell USDC for floating collateral, use floating collateral to open a short on Perp"
                );
                // NOTE: Buy Exact Amount of UsdlCollateral
                amountUSDCMinus = _USDCToCollateral(router, routerType, false, _amountBaseToRebalance);
                _deposit(_amountBaseToRebalance, address(usdlCollateral), Basis.IsRebalance);
                (, uint256 amountUSDCPlus_1e18) = openShortWithExactBase(_amountBaseToRebalance, address(0), 0, Basis.IsRebalance);
                amountUSDCPlus = amountUSDCPlus_1e18 * (10 ** usdc.decimals()) / 1e18;
                // if(isCheckProfit) require(usdcAmountPerpGained >= usdcAmountDexSpent, "Unprofitable");
            } else {
                // NOTE: We are net long
                console.log(
                    "[rebalance()] Net Long --> Decrease Positive Base --> Sell floating collateral for USDC, use it to incrase long"
                );
                (, uint256 amountUSDCPlus_1e18) = closeLongWithExactBase(_amountBaseToRebalance, address(0), 0, Basis.IsRebalance);
                amountUSDCPlus = amountUSDCPlus_1e18 * (10 ** usdc.decimals()) / 1e18;
                _withdraw(amountUSDCPlus, address(usdc), Basis.IsRebalance);
                amountUSDCMinus = _USDCToCollateral(router, routerType, false, _amountBaseToRebalance);
                // if(isCheckProfit) require(usdcAmountPerpGained >= usdcAmountDexSpent, "Unprofitable");
            }
            // // 1.1 Reduce Long = Increase Short using closeLongWithExactBase() for `amount` and get the corresponding quote amount
            // (, usdcAmount) = closeLongWithExactBase(amount, address(0), 0);

            // // TODO: Reactivate
            // perpVault.withdraw(address(usdc), usdcAmount);

            // // 1.2 Take quote amount of USDC and swap it on Uniswap for ETH and deposit ETH as collateral
            // usdlCollateralAmount = _swapOnDEXSpot(router, routerType, false, usdcAmount);
        }
        // Compute Profit and return it
        // if(isCheckProfit) require(usdlCollateralAmount >= amount, "Unprofitable");

        if (isCheckProfit) require(amountUSDCPlus >= amountUSDCMinus, "Unprofitable");
        return (amountUSDCPlus, amountUSDCMinus);
    }

    //////////////////////
    /// PUBLIC METHODS ///
    //////////////////////

    function trade(
        uint256 amount,
        bool isShorting,
        bool isExactInput
    ) public override onlyRole(PERPLEMMA_ROLE) returns (uint256, uint256) {
        bool _isBaseToQuote = isShorting;
        bool _isExactInput = isExactInput;

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

        int256 positionSize = accountBalance.getTotalPositionSize(address(this), usdlBaseTokenAddress);
        require(positionSize.abs().toUint256() <= maxPosition, "max position reached");
        return (_amountBase, _amountQuote);
    }

    ////////////// TRADING - CONVENIENCE FUNCTIONS ////////////// 
    // openLongWithExactBase & closeShortWithExactBase: Quote --> Base, ExactInput: False
    // openLongWithExactQuote & closeShortWithExactQuote: Quote --> Base, ExactInput: True
    // closeLongWithExactBase & openShortWithExactBase: Base --> Quote, ExactInput: True
    // closeLongWithExactQuote & openShortWithExactQuote: Base --> Quote, ExactInput: False

    function openLongWithExactBase(uint256 amount, address collateralIn, uint256 amountIn, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralIn != address(0)) && (amountIn > 0)) _deposit(amountIn, collateralIn, basis);
        (uint256 base, uint256 quote) = trade(amount, false, false);
        console.log('openLongWithExactBase, base, quote: ', base, quote, amount);
        calculateMintingAsset(base, basis, false);
        return (base, quote);
    }

    function openLongWithExactQuote(uint256 amount, address collateralIn, uint256 amountIn, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralIn != address(0)) && (amountIn > 0)) _deposit(amountIn, collateralIn, basis);
        (uint256 base, uint256 quote) = trade(amount, false, true);
        console.log('openLongWithExactQuote, base, quote: ', base, quote, amount);
        calculateMintingAsset(base, basis, false);
        return (base, quote);
    }

    function closeLongWithExactBase(uint256 amount, address collateralOut, uint256 amountOut, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralOut != address(0)) && (amountOut > 0)) _withdraw(amountOut, collateralOut, basis);
        (uint256 base, uint256 quote) = trade(amount, true, true);
        console.log('closeLongWithExactBase, base, quote: ', base, quote, amount);
        calculateMintingAsset(base, basis, true);
        return (base, quote);
    }

    function closeLongWithExactQuote(uint256 amount, address collateralOut, uint256 amountOut, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralOut != address(0)) && (amountOut > 0)) _withdraw(amountOut, collateralOut, basis);
        (uint256 base, uint256 quote) = trade(amount, true, false);
        console.log('closeLongWithExactQuote, base, quote: ', base, quote, amount);
        calculateMintingAsset(getRoudDown(base), basis, true);
        return (base, quote);
    }

    function openShortWithExactBase(uint256 amount, address collateralIn, uint256 amountIn, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralIn != address(0)) && (amountIn > 0)) _deposit(amountIn, collateralIn, basis);
        (uint256 base, uint256 quote) = trade(amount, true, true);
        console.log('openShortWithExactBase, base, quote: ', base, quote);
        calculateMintingAsset(quote, basis, true);
        return (base, quote);
    }

    function openShortWithExactQuote(uint256 amount, address collateralIn, uint256 amountIn, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralIn != address(0)) && (amountIn > 0)) _deposit(amountIn, collateralIn, basis);
        (uint256 base, uint256 quote) = trade(amount, true, false);
        console.log('openShortWithExactQuote, base, quote: ', base, quote, amount);
        calculateMintingAsset(quote, basis, true);
        return (base, quote);
    }

    function closeShortWithExactBase(uint256 amount, address collateralOut, uint256 amountOut, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralOut != address(0)) && (amountOut > 0)) _withdraw(amountOut, collateralOut, basis);
        (uint256 base, uint256 quote) = trade(amount, false, false);
        console.log('closeShortWithExactBase, base, quote, amount: ', base, quote, amount);
        calculateMintingAsset(quote, basis, false);
        return (base, quote);
    }

    function closeShortWithExactQuote(uint256 amount, address collateralOut, uint256 amountOut, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralOut != address(0)) && (amountOut > 0)) _withdraw(amountOut, collateralOut, basis);
        (uint256 base, uint256 quote) = trade(amount, false, true);
        console.log('closeShortWithExactQuote, base, quote, amount: ', base, quote, amount);
        calculateMintingAsset(getRoudDown(quote), basis, false);
        return (base, quote);
    }

    function getAmountInCollateralDecimalsForPerp(
        uint256 amount, address collateral, bool roundUp
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
    
    function getRoudDown(uint256 amount) internal view returns (uint256) {
        return amount - 1;
    }

    function getAllBalance() internal view returns(uint256, uint256, uint256, uint256) {
        return (
            totalUsdlCollateral,
            usdlCollateral.balanceOf(address(this)),
            totalSynthCollateral,
            usdc.balanceOf(address(this))
        ); 
    }

    /// @notice to deposit collateral in vault for short or open position
    /// @notice If collateral is tail asset no need to deposit it in Perp, it has to stay in this contract balance sheet
    function _deposit(
        uint256 collateralAmount,
        address collateral,
        Basis basis
    ) internal {
        if (collateral == address(usdc)) {
            perpVault.deposit(address(usdc), collateralAmount);
        } else if ((collateral == address(usdlCollateral)) && (!isUsdlCollateralTailAsset)) {
            perpVault.deposit(collateral, collateralAmount);
            amountUsdlCollateralDeposited += collateralAmount;
        }
        if (Basis.IsRebalance != basis) {
            if (Basis.IsUsdl == basis) { 
                totalUsdlCollateral += collateralAmount;
            } else {
                totalSynthCollateral += collateralAmount;
            }
        }
    }

    /// @notice to withdraw collateral from vault after long or close position
    /// @notice If collateral is tail asset no need to withdraw it from Perp, it is already in this contract balance sheet
    function _withdraw(
        uint256 amountToWithdraw,
        address collateral,
        Basis basis
    ) internal {
        if (collateral == address(usdc)) {
            perpVault.withdraw(address(usdc), amountToWithdraw);
        } else if ((collateral == address(usdlCollateral)) && (!isUsdlCollateralTailAsset)) {
            // NOTE: This is problematic with ETH
            perpVault.withdraw(collateral, amountToWithdraw);
            amountUsdlCollateralDeposited -= amountToWithdraw;
        }

        if (Basis.IsUsdl == basis) { 
            totalUsdlCollateral -= amountToWithdraw;
            // totalUsdlCollateral =  (totalUsdlCollateral < amountToWithdraw) ? 0 : (totalUsdlCollateral - amountToWithdraw);
        } else if (Basis.IsSynth == basis) {
            totalSynthCollateral -= amountToWithdraw;
            // totalSynthCollateral =  (totalSynthCollateral < amountToWithdraw) ? 0 : (totalSynthCollateral - amountToWithdraw);
        }
    }

    function calculateMintingAsset(uint256 amount, Basis basis, bool isOpenShort) internal {
        if (isOpenShort) {
            // is openShort or closeLong
            if (Basis.IsUsdl == basis) {
                mintedPositionUsdlForThisWrapper += amount; // quote
            } else if (Basis.IsSynth == basis) {
                mintedPositionSynthForThisWrapper -= amount; // base
            }
        } else {
            // is openLong or closeShort
            if (Basis.IsUsdl == basis) {
                mintedPositionUsdlForThisWrapper -= amount; // quote
            } else if (Basis.IsSynth == basis) {
                mintedPositionSynthForThisWrapper += amount; // base
            }
        }
    }

    function settleCollateral(uint256 usdlOrSynthAmount, address to, bool isUsdl) internal returns(uint256 amountUsdlCollateral1e_18, uint256 amountUsdcCollateral1e_18) {
        uint256 positionAtSettlementInQuote = isUsdl ? mintedPositionUsdlForThisWrapper : mintedPositionSynthForThisWrapper;
        require(positionAtSettlementInQuote > 0, "Settled vUSD position amount should not ZERO");
        
        uint256 tailAmount;
        uint256 usdcAmount;

        // a = totalUsdlCollateral ===> Total usdlcollateral that is deposited in perpLemma.
        // b = usdlCollateral.balanceOf(address(this)) ===> Current Total usdlcollateral perpLemma has.
        // c = totalSynthCollateral ===> Total synthcollateral that is deposited in perpLemma.
        // d = usdc.balanceOf(address(this)) ===> Current Total synthcollateral perpLemma has.
        (uint256 a, uint256 b, uint256 c, uint256 d) = getAllBalance();
        console.log('\na, b: ', a, b);
        console.log('c, d: ', c, d);
        if (isUsdl) {
            tailAmount = a > b ? b : a;
            usdcAmount = c >= d ? 0 : d - c;
        } else {
            usdcAmount = c < d ? c : d;
            tailAmount = a >= b ? 0 : b - a;
        }
        console.log('isUsdl: ', isUsdl);
        console.log('tailAmount: ', tailAmount);
        console.log('usdcAmount: ', usdcAmount);

        if (tailAmount != 0) {
            uint256 collateralDecimals = IERC20Decimals(address(usdlCollateral)).decimals();
            tailAmount = tailAmount * 1e18 / (10**collateralDecimals);
            amountUsdlCollateral1e_18 = (usdlOrSynthAmount * tailAmount) / positionAtSettlementInQuote;
            uint256 amountUsdlCollateral = getAmountInCollateralDecimalsForPerp(amountUsdlCollateral1e_18, address(usdlCollateral), false);
            console.log('amountUsdlCollateral', amountUsdlCollateral);
            SafeERC20Upgradeable.safeTransfer(usdlCollateral, to, amountUsdlCollateral);
            if (isUsdl) totalUsdlCollateral -= amountUsdlCollateral;
        }
        if (usdcAmount != 0) {
            uint256 collateralDecimals = IERC20Decimals(address(usdc)).decimals();
            usdcAmount = usdcAmount * 1e18 / (10**collateralDecimals);
            amountUsdcCollateral1e_18 = (usdlOrSynthAmount * usdcAmount) / positionAtSettlementInQuote;
            uint256 amountUsdcCollateral = getAmountInCollateralDecimalsForPerp(amountUsdcCollateral1e_18, address(usdc), false);
            console.log('amountUsdcCollateral', amountUsdcCollateral);
            SafeERC20Upgradeable.safeTransfer(usdc, to, amountUsdcCollateral);
            if (!isUsdl) totalSynthCollateral -= amountUsdcCollateral;
        }
        if (isUsdl) {
            mintedPositionUsdlForThisWrapper -= usdlOrSynthAmount;
        } else {
            mintedPositionSynthForThisWrapper -= usdlOrSynthAmount;
        }
    }

    function _USDCToCollateral(address router, uint256 routerType, bool isExactInput, uint256 amountUSDC) internal returns(uint256) {
        return _swapOnDEXSpot(router, routerType, false, isExactInput, amountUSDC);
    }

    function _CollateralToUSDC(address router, uint256 routerType, bool isExactInput, uint256 amountCollateral) internal returns(uint256) {
        return _swapOnDEXSpot(router, routerType, true, isExactInput, amountCollateral);
    }

    function _swapOnDEXSpot(address router, uint256 routerType, bool isBuyUSDLCollateral, bool isExactInput, uint256 amountIn) internal returns(uint256) {
        if(routerType == 0) {
            // NOTE: UniV3 
            return _swapOnUniV3(router, isBuyUSDLCollateral, isExactInput, amountIn);
        }
        // NOTE: Unsupported Router --> Using UniV3 as default
        return _swapOnUniV3(router, isBuyUSDLCollateral, isExactInput, amountIn);
    }

    function _swapOnUniV3(address router, bool isUSDLCollateralToUSDC, bool isExactInput, uint256 amount) internal returns(uint256) {
        uint256 res;
        address tokenIn = (isUSDLCollateralToUSDC) ? address(usdlCollateral) : address(usdc);
        address tokenOut = (isUSDLCollateralToUSDC) ? address(usdc) : address(usdlCollateral);
        console.log("[_swapOnUniV3] usdlCollateral ", address(usdlCollateral));
        console.log("[_swapOnUniV3] usdc ", address(usdc));
        console.log("[_swapOnUniV3()] tokenIn = ", tokenIn);
        console.log("[_swapOnUniV3()] tokenOut = ", tokenOut);
        console.log("[_swapOnUniV3()] router = ", router);

        IERC20Decimals(tokenIn).approve(router, type(uint256).max);
        if(isExactInput) {
            ISwapRouter.ExactInputSingleParams memory temp = ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: 3000,
                recipient: address(this),
                deadline: type(uint256).max,
                amountIn: amount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });
            console.log("[_swapOnUniV3] ExactInput amount = ", amount);
            uint256 balanceBefore = IERC20Decimals(tokenOut).balanceOf(address(this));
            res = ISwapRouter(router).exactInputSingle(temp);
            console.log("[_swapOnUniV3] ExactInput amount------+++ = ", res);
            uint256 balanceAfter = IERC20Decimals(tokenOut).balanceOf(address(this));
            // require(balanceAfter > balanceBefore);
            res = uint256( int256(balanceAfter) - int256(balanceBefore) );
        }
        else {
            ISwapRouter.ExactOutputSingleParams memory temp = ISwapRouter.ExactOutputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: 3000,
                recipient: address(this),
                deadline: type(uint256).max,
                amountOut: amount,
                amountInMaximum: type(uint256).max,
                sqrtPriceLimitX96: 0
            });
            console.log("[_swapOnUniV3()] ExactOutput = ", amount);
            res = ISwapRouter(router).exactOutputSingle(temp);
        }
        IERC20Decimals(tokenIn).approve(router, 0);
        console.log("[_swapOnUniV3()] res = ", res);
        return res;
    }

    function _msgSender()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
    returns (address sender) {
        return super._msgSender();
    }

    function _msgData()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
    returns (bytes calldata) {
        return super._msgData();
    }
}
