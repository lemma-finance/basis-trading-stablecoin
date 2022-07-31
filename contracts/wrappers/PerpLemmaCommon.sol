// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;

import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { IPerpetualMixDEXWrapper } from "../interfaces/IPerpetualMixDEXWrapper.sol";
import { Utils } from "../libraries/Utils.sol";
import { SafeMathExt } from "../libraries/SafeMathExt.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
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

/// @author Lemma Finance
/// @notice PerpLemmaCommon contract will use to open short and long position with no-leverage
/// USDLemma and LemmaSynth will consime the methods to open short or long on derivative dex
/// Every UsdlCollateral has different PerpLemma deployed, and after deployed it will be add in USDLemma contract perpDexWrapper Mapping
contract PerpLemmaCommon is ERC2771ContextUpgradeable, IPerpetualMixDEXWrapper, AccessControlUpgradeable {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using Utils for int256;
    using SafeMathExt for int256;

    // Different Roles to perform restricted tx
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ONLY_OWNER = keccak256("ONLY_OWNER");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");
    bytes32 public constant PERPLEMMA_ROLE = keccak256("PERPLEMMA_ROLE");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    /// USDLemma contract address
    address public usdLemma;
    /// LemmaSynth contract address
    address public lemmaSynth;
    /// Rebalancer Address to rebalance position between short or long
    address public reBalancer;
    /// BaseToken address from perpV2
    address public usdlBaseTokenAddress;
    /// Settlement token manager contract address
    address public settlementTokenManager;
    /// Referrer Code use while openPosition
    bytes32 public referrerCode;

    /// PerpV2 contract addresses
    IClearingHouse public clearingHouse;
    IClearingHouseConfig public clearingHouseConfig;
    IPerpVault public perpVault;
    IAccountBalance public accountBalance;
    IMarketRegistry public marketRegistry;
    IExchange public exchange;

    /// Is USDL collateral is tail then it will not deposit into perpV2, It will stay in PerpLemma BalanceSheet
    bool public isUsdlCollateralTailAsset;
    /// USDL collateral address which is use to mint usdl
    IERC20Decimals public usdlCollateral;
    /// USDC ERC20 contract
    IERC20Decimals public usdc;

    /// MAX Uint256
    uint256 public constant MAX_UINT256 = type(uint256).max;
    /// MaxPosition till perpLemma can openPosition
    uint256 public maxPosition;
    /// USDL's collateral decimal (for e.g. if  eth then 18 decimals)
    uint256 public usdlCollateralDecimals;

    int256 public amountBase;
    int256 public amountQuote;
    /// Amount of usdl's collateral that is deposited in perpLemma nd then deposited into perpV2
    uint256 public amountUsdlCollateralDeposited;

    /// Amount of USDL collateral deposited in Perplemma
    uint256 public totalUsdlCollateral; // Tail Asset
    /// Amount of LemmaSynth collateral deposited in Perplemma
    uint256 public totalSynthCollateral; // USDC

    // Gets set only when Settlement has already happened
    // NOTE: This should be equal to the amount of USDL minted depositing on that dexIndex
    /// Amount of USDL minted through this perpLemma, it is tracking because usdl can be mint by multiple perpLemma
    uint256 public mintedPositionUsdlForThisWrapper;
    /// Amount of LemmaSynth minted
    uint256 public mintedPositionSynthForThisWrapper;

    // Has the Market Settled, If settled we can't mint new USDL or Synth
    bool public override hasSettled;

    // Events
    event USDLemmaUpdated(address indexed usdlAddress);
    event ReferrerUpdated(bytes32 indexed referrerCode);
    event RebalancerUpdated(address indexed rebalancerAddress);
    event MaxPositionUpdated(uint256 indexed maxPos);
    event SetSettlementTokenManager(address indexed _settlementTokenManager);

    //////////////////////////////////
    /// Initialize External METHOD ///
    //////////////////////////////////

    /// @notice Intialize method only called once while deploying contract
    /// It will setup different roles and give role access to specific addreeses
    /// Also set up the perpV2 contract instances and give allownace task
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

    /////////////////////////////
    /// EXTERNAL VIEW METHODS ///
    /////////////////////////////

    /// @dev This one probably not needed as we can call usdlCollateral.decimals() when we need it
    function getUsdlCollateralDecimals() external view override returns (uint256) {
        return usdlCollateralDecimals;
    }

    /// @notice getFees fees charge by perpV2 protocol for each trade
    function getFees() external view override returns (uint256) {
        // NOTE: Removed prev arg address baseTokenAddress
        IMarketRegistry.MarketInfo memory marketInfo = marketRegistry.getMarketInfo(usdlBaseTokenAddress);
        return marketInfo.exchangeFeeRatio;
    }

    /// @notice It returns the collateral accepted in the Perp Protocol to back positions
    /// @dev By default, the first element is the settlement token
    function getCollateralTokens() external view override returns (address[] memory res) {
        res = new address[](1);
        res[0] = perpVault.getSettlementToken();
    }

    /// @notice It returns the amount of USDC that are possibly needed to properly collateralize the new position on Perp
    /// @dev When the position is reduced in absolute terms, then there is no need for additional collateral while when it increases in absolute terms then we need to add more
    /// @param amount The amount of the new position
    /// @param isShort If we are minting USDL or a Synth by changing our Position on Perp
    function getRequiredUSDCToBackMinting(uint256 amount, bool isShort)
        external
        view
        override
        returns (bool isAcceptable, uint256 extraUSDC)
    {
        int256 currentTotalPositionValue = getTotalPosition();
        uint256 currentPrice = getIndexPrice();
        uint256 oracleDecimals = 18;
        int256 deltaPosition = int256(
            (currentPrice * amount) / (10**(oracleDecimals + usdlCollateral.decimals() - usdc.decimals()))
        );
        int256 futureTotalPositionValue = currentTotalPositionValue *
            ((isShort) ? int256(-1) : int256(1)) *
            deltaPosition;
        int256 currentAccountValue = clearingHouse.getAccountValue(address(this));
        int256 futureAccountValue = futureTotalPositionValue + currentAccountValue;
        uint256 extraUSDC_1e18 = (futureAccountValue >= 0) ? 0 : uint256(-futureAccountValue);
        extraUSDC = getAmountInCollateralDecimalsForPerp(extraUSDC_1e18, address(usdc), false);
        uint256 maxSettlementTokenAcceptableFromPerpVault = getMaxSettlementTokenAcceptableByVault();
        if (extraUSDC > maxSettlementTokenAcceptableFromPerpVault) {
            isAcceptable = false;
        } else {
            isAcceptable = true;
        }
    }

    // Returns the margin
    // NOTE: Returns totalCollateralValue + unrealizedPnL
    /// Functions
    /// clearingHouse.getAccountValue()
    /// https://github.com/perpetual-protocol/perp-curie-contract/blob/main/contracts/ClearingHouse.sol#L684
    /// https://github.com/perpetual-protocol/perp-curie-contract/blob/main/contracts/ClearingHouse.sol#L684
    /// https://github.com/yashnaman/perp-lushan/blob/main/contracts/interface/IClearingHouse.sol#L254
    function getSettlementTokenAmountInVault() external view override returns (int256) {
        return perpVault.getBalance(address(this));
    }

    /// @notice Returns the relative margin in 1e18 format
    /// TODO: Take into account tail assets
    function getRelativeMargin() external view override returns (uint256) {
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
        return (
            (_accountValue_1e18 <= int256(0) || (_margin < 0))
                ? type(uint256).max // No Collateral Deposited --> Max Leverage Possible
                : (_margin.abs().toUint256() * 1e18) / _accountValue
        );
    }

    /// @notice Computes the delta exposure
    /// @dev It does not take into account if the deposited collateral gets silently converted in USDC so that we lose positive delta exposure
    function getDeltaExposure() external view override returns (int256) {
        (
            uint256 _usdlCollateralAmount,
            uint256 _usdlCollateralDepositedAmount,
            int256 _longOrShort,
            ,

        ) = getExposureDetails();
        uint256 _longOnly = (_usdlCollateralAmount + _usdlCollateralDepositedAmount) *
            10**(18 - usdlCollateralDecimals); // Both usdlCollateralDecimals format

        int256 _deltaLongShort = int256(_longOnly) + _longOrShort;
        uint256 _absTot = _longOnly + _longOrShort.abs().toUint256();
        int256 _delta = (_absTot == 0) ? int256(0) : (_deltaLongShort * 1e6) / int256(_absTot);
        return _delta;
    }

    /// @notice Returns the margin
    function getMargin() external view override returns (int256) {
        int256 _margin = accountBalance.getMarginRequirementForLiquidation(address(this));
        return _margin;
    }

    ////////////////////////
    /// EXTERNAL METHODS ///
    ////////////////////////

    /// @notice Defines the USDL Collateral as a tail asset by only owner role
    function setIsUsdlCollateralTailAsset(bool _x) external onlyRole(ONLY_OWNER) {
        isUsdlCollateralTailAsset = _x;
    }

    /// @notice sets USDLemma address - only owner can set
    /// @param _usdLemma USDLemma address to set
    function setUSDLemma(address _usdLemma) external onlyRole(ONLY_OWNER) {
        require(_usdLemma != address(0), "UsdLemma should not ZERO address");
        usdLemma = _usdLemma;
        SafeERC20Upgradeable.safeApprove(usdc, usdLemma, 0);
        SafeERC20Upgradeable.safeApprove(usdc, usdLemma, MAX_UINT256);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, 0);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, MAX_UINT256);
        emit USDLemmaUpdated(usdLemma);
    }

    /// @notice sets refferer code - only owner can set
    /// @param _referrerCode referrerCode of address to set
    function setReferrerCode(bytes32 _referrerCode) external onlyRole(ONLY_OWNER) {
        referrerCode = _referrerCode;
        emit ReferrerUpdated(referrerCode);
    }

    /// @notice sets maximum position the wrapper can take (in terms of base) - only owner can set
    /// @param _maxPosition reBalancer address to set
    function setMaxPosition(uint256 _maxPosition) external onlyRole(ONLY_OWNER) {
        maxPosition = _maxPosition;
        emit MaxPositionUpdated(maxPosition);
    }

    /// @notice setSettlementTokenmanager is to set the address of settlementTokenManager by admin role only
    /// @param _settlementTokenManager address
    function setSettlementTokenManager(address _settlementTokenManager) external onlyRole(ADMIN_ROLE) {
        revokeRole(USDC_TREASURY, settlementTokenManager);
        settlementTokenManager = _settlementTokenManager;
        grantRole(USDC_TREASURY, settlementTokenManager);
        emit SetSettlementTokenManager(settlementTokenManager);
    }

    /// @notice changeAdmin is to change address of admin role
    /// Only current admin can change admin and after new admin current admin address will be no more admin
    /// @param newAdmin new admin address
    function changeAdmin(address newAdmin) external onlyRole(ADMIN_ROLE) {
        require(newAdmin != address(0), "NewAdmin should not ZERO address");
        require(newAdmin != msg.sender, "Admin Addresses should not be same");
        _setupRole(ADMIN_ROLE, newAdmin);
        renounceRole(ADMIN_ROLE, msg.sender);
    }

    ///@notice sets reBalncer address - only owner can set
    ///@param _reBalancer reBalancer address to set
    function setReBalancer(address _reBalancer) external onlyRole(ADMIN_ROLE) {
        require(_reBalancer != address(0), "ReBalancer should not ZERO address");
        grantRole(REBALANCER_ROLE, _reBalancer);
        reBalancer = _reBalancer;
        emit RebalancerUpdated(_reBalancer);
    }

    /// @notice reset approvals
    function resetApprovals() external {
        SafeERC20Upgradeable.safeApprove(usdlCollateral, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, address(perpVault), MAX_UINT256);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), MAX_UINT256);
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

    /// @notice withdrawSettlementTokenTo is used to withdraw settlement token USDC from perp vault - only owner can withdraw
    /// @param _amount USDC amount need to withdraw from perp vault
    /// @param _to address where to transfer fund
    function withdrawSettlementTokenTo(uint256 _amount, address _to) external onlyRole(ONLY_OWNER) {
        require(_amount > 0, "Amount should greater than zero");
        require(hasSettled, "Perpetual is not settled yet");
        SafeERC20Upgradeable.safeTransfer(usdc, _to, _amount);
        totalSynthCollateral -= _amount;
    }

    /// @notice deposit method is to call from USDLemma or LemmaSynth while mint USDL or Synth
    /// @param amount of assets to deposit
    /// @param collateral needs to deposit
    /// @param basis is enum that defines the deposit call from Usdl or lemmaSynth contract
    function deposit(
        uint256 amount,
        address collateral,
        Basis basis
    ) external override onlyRole(PERPLEMMA_ROLE) {
        _deposit(amount, collateral, basis);
    }

    /// @notice withdraw method is to call from USDLemma or LemmaSynth while redeem USDL or Synth
    /// @param amount of assets to withdraw
    /// @param collateral needs to withdraw
    /// @param basis is enum that defines the withdraw call from Usdl or lemmaSynth contract
    function withdraw(
        uint256 amount,
        address collateral,
        Basis basis
    ) external override onlyRole(PERPLEMMA_ROLE) {
        _withdraw(amount, collateral, basis);
    }

    /// @notice when perpetual is in CLEARED state, withdraw the collateral
    /// @dev Anybody can call it so that it happens as quickly as possible
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

    /// @notice getCollateralBackAfterSettlement is called when market is settled so USDL and Synth withdraw method call this method instead close position
    function getCollateralBackAfterSettlement(
        uint256 amount,
        address to,
        bool isUsdl
    ) external override onlyRole(PERPLEMMA_ROLE) returns (uint256, uint256) {
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
    function rebalance(
        address router,
        uint256 routerType,
        int256 amountBaseToRebalance,
        bool isCheckProfit
    ) external override onlyRole(REBALANCER_ROLE) returns (uint256, uint256) {
        // uint256 usdlCollateralAmountPerp;
        // uint256 usdlCollateralAmountDex;
        uint256 amountUSDCPlus;
        uint256 amountUSDCMinus;

        require(amountBaseToRebalance != 0, "! No Rebalance with Zero Amount");

        bool isIncreaseBase = amountBaseToRebalance > 0;
        uint256 _amountBaseToRebalance = (isIncreaseBase)
            ? uint256(amountBaseToRebalance)
            : uint256(-amountBaseToRebalance);

        if (isIncreaseBase) {
            if (amountBase < 0) {
                (, uint256 amountUSDCMinus_1e18) = closeShortWithExactBase(_amountBaseToRebalance, Basis.IsRebalance);
                amountUSDCMinus = (amountUSDCMinus_1e18 * (10**usdc.decimals())) / 1e18;
                _withdraw(_amountBaseToRebalance, address(usdlCollateral), Basis.IsRebalance);
                require(usdlCollateral.balanceOf(address(this)) > _amountBaseToRebalance, "T1");
                amountUSDCPlus = _CollateralToUSDC(router, routerType, true, _amountBaseToRebalance);
            } else {
                amountUSDCPlus = _CollateralToUSDC(router, routerType, true, _amountBaseToRebalance);
                _deposit(amountUSDCPlus, address(usdc), Basis.IsRebalance);
                (, uint256 amountUSDCMinus_1e18) = openLongWithExactBase(_amountBaseToRebalance, Basis.IsRebalance);
                amountUSDCMinus = (amountUSDCMinus_1e18 * (10**usdc.decimals())) / 1e18;
            }
        } else {
            if (amountBase <= 0) {
                amountUSDCMinus = _USDCToCollateral(router, routerType, false, _amountBaseToRebalance);
                _deposit(_amountBaseToRebalance, address(usdlCollateral), Basis.IsRebalance);
                (, uint256 amountUSDCPlus_1e18) = openShortWithExactBase(_amountBaseToRebalance, Basis.IsRebalance);
                amountUSDCPlus = (amountUSDCPlus_1e18 * (10**usdc.decimals())) / 1e18;
            } else {
                (, uint256 amountUSDCPlus_1e18) = closeLongWithExactBase(_amountBaseToRebalance, Basis.IsRebalance);
                amountUSDCPlus = (amountUSDCPlus_1e18 * (10**usdc.decimals())) / 1e18;
                _withdraw(amountUSDCPlus, address(usdc), Basis.IsRebalance);
                amountUSDCMinus = _USDCToCollateral(router, routerType, false, _amountBaseToRebalance);
            }
        }
        if (isCheckProfit) require(amountUSDCPlus >= amountUSDCMinus, "Unprofitable");
        return (amountUSDCPlus, amountUSDCMinus);
    }

    //////////////////////
    /// PUBLIC METHODS ///
    //////////////////////

    /// @notice trade method is to open short or long position
    /// if isShorting true then base -> quote otherwise quote -> base
    /// if isShorting == true then input will be base
    /// if isShorting == false then input will be quote
    /// @param amount of position short/long, amount is base or quote and input or notInput is decide by below params
    /// @param isShorting is short or long
    /// @param isExactInput is ExactInput or not
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

    /// LemmaSynth will use below four methods
    /// 1). openLongWithExactBase => depositTo
    /// 2). openLongWithExactQuote => depositToWExactCollateral
    /// 3). closeLongWithExactBase => withdrawTo
    /// 4). closeLongWithExactQuote => withdrawToWExactCollateral
    function openLongWithExactBase(uint256 amount, Basis basis)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        // if((collateralIn != address(0)) && (amountIn > 0)) _deposit(amountIn, collateralIn, basis);
        (uint256 base, uint256 quote) = trade(amount, false, false);
        calculateMintingAsset(base, basis, false);
        return (base, quote);
    }

    function openLongWithExactQuote(uint256 amount, Basis basis)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, false, true);
        calculateMintingAsset(base, basis, false);
        return (base, quote);
    }

    function closeLongWithExactBase(uint256 amount, Basis basis)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, true, true);
        calculateMintingAsset(base, basis, true);
        return (base, quote);
    }

    function closeLongWithExactQuote(uint256 amount, Basis basis)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, true, false);
        base = getRoudDown(base, address(usdlCollateral)); // RoundDown
        calculateMintingAsset(base, basis, true);
        return (base, quote);
    }

    /// USDLemma will use below four methods
    /// 1). openShortWithExactBase => depositToWExactCollateral
    /// 2). openShortWithExactQuote => depositTo
    /// 3). closeShortWithExactBase => withdrawToWExactCollateral
    /// 4). closeShortWithExactQuote => withdrawTo
    function openShortWithExactBase(uint256 amount, Basis basis)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, true, true);
        calculateMintingAsset(quote, basis, true);
        return (base, quote);
    }

    function openShortWithExactQuote(uint256 amount, Basis basis)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, true, false);
        calculateMintingAsset(quote, basis, true);
        return (base, quote);
    }

    function closeShortWithExactBase(uint256 amount, Basis basis)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, false, false);
        calculateMintingAsset(quote, basis, false);
        return (base, quote);
    }

    function closeShortWithExactQuote(uint256 amount, Basis basis)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, false, true);
        quote = getRoudDown(quote, address(usdc)); // RoundDown
        calculateMintingAsset(quote, basis, false);
        return (base, quote);
    }

    ///////////////////////////
    /// PUBLIC VIEW METHODS ///
    ///////////////////////////

    /// @notice getAmountInCollateralDecimalsForPerp is use to convert amount in collateral decimals
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

    /// @notice Returning the max amount of USDC Tokens that is possible to put in Vault to collateralize positions
    /// @dev The underlying Perp Protocol (so far we only have PerpV2) can have a limit on the total amount of Settlement Token the Vault can accept
    function getMaxSettlementTokenAcceptableByVault() public view override returns (uint256) {
        uint256 perpVaultSettlementTokenBalanceBefore = usdc.balanceOf(address(perpVault));
        uint256 settlementTokenBalanceCap = IClearingHouseConfig(clearingHouse.getClearingHouseConfig())
            .getSettlementTokenBalanceCap();
        require(
            settlementTokenBalanceCap >= perpVaultSettlementTokenBalanceBefore,
            "[getVaultSettlementTokenLimit] Unexpected"
        );
        return uint256(int256(settlementTokenBalanceCap) - int256(perpVaultSettlementTokenBalanceBefore));
    }

    function getIndexPrice() public view override returns (uint256) {
        uint256 _twapInterval = IClearingHouseConfig(clearingHouseConfig).getTwapInterval();
        uint256 _price = IIndexPrice(usdlBaseTokenAddress).getIndexPrice(_twapInterval);
        return _price;
    }

    /// @notice getTotalPosition in terms of quoteToken(in our case vUSD)
    /// https://github.com/perpetual-protocol/perp-curie-contract/blob/main/contracts/AccountBalance.sol#L339
    /// https://github.com/perpetual-protocol/perp-curie-contract/blob/main/contracts/interface/IAccountBalance.sol#L218
    /// https://github.com/yashnaman/perp-lushan/blob/main/contracts/interface/IAccountBalance.sol#L224
    /// https://github.com/yashnaman/perp-lushan/blob/main/contracts/AccountBalance.sol#L320
    function getTotalPosition() public view override returns (int256) {
        return accountBalance.getTotalPositionValue(address(this), usdlBaseTokenAddress);
    }

    /// @notice Returns all the exposure related details
    function getExposureDetails()
        public
        view
        override
        returns (
            uint256,
            uint256,
            int256,
            int256,
            uint256
        )
    {
        return (
            usdlCollateral.balanceOf(address(this)),
            amountUsdlCollateralDeposited,
            amountBase, // All the other terms are in 1e6
            perpVault.getBalance(address(this)), // This number could change when PnL gets realized so it is better to read it from the Vault directly
            usdc.balanceOf(address(this))
        );
    }

    ////////////////////////
    /// INTERNAL METHODS ///
    ////////////////////////

    /// @notice getRoudDown is use to roundDown by amount = amount-1
    /// because perpV2 gives 1 wei increase in vaule for base and quote so we have to roundDown that 1 wei
    /// Otherwise it can give arithmetic error in calculateMintingAsset() function
    /// if the amount is less than collateral decimals value(like 1e18, 1e6) then it will compulsary roundDown 1 wei
    /// closeShortWithExactQuote, closeLongWithExactQuote are using getRoudDown method
    /// @param amount needs to roundDown
    /// @param collateral address, if the amount is base then it will be usdlCollateral otherwise synthCollateral
    function getRoudDown(uint256 amount, address collateral) internal view returns (uint256 roundDownAmount) {
        uint256 collateralDecimals = IERC20Decimals(collateral).decimals();
        roundDownAmount = (amount % (uint256(10**(collateralDecimals))) != 0) ? amount - 1 : amount;
    }

    /// @notice getAllBalance is simple view method to give deposited balance and currentBalance of USDL and Synth
    function getAllBalance()
        internal
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        return (
            totalUsdlCollateral,
            usdlCollateral.balanceOf(address(this)),
            totalSynthCollateral,
            usdc.balanceOf(address(this))
        );
    }

    /// @notice to deposit collateral in vault for short or open position
    /// @dev If collateral is tail asset no need to deposit it in Perp, it has to stay in this contract balance sheet
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
    /// @dev If collateral is tail asset no need to withdraw it from Perp, it is already in this contract balance sheet
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
        } else if (Basis.IsSynth == basis) {
            totalSynthCollateral -= amountToWithdraw;
        }
    }

    /// @notice calculateMintingAsset is method to track the minted usdl and synth by this perpLemma
    /// @param amount needs to add or sub
    /// @param isOpenShort that position is short or long
    /// @param basis is enum that defines the calculateMintingAsset call from Usdl or lemmaSynth contract
    function calculateMintingAsset(
        uint256 amount,
        Basis basis,
        bool isOpenShort
    ) internal {
        if (isOpenShort) {
            // if openShort or closeLong
            if (Basis.IsUsdl == basis) {
                mintedPositionUsdlForThisWrapper += amount; // quote
            } else if (Basis.IsSynth == basis) {
                mintedPositionSynthForThisWrapper -= amount; // base
            }
        } else {
            // if openLong or closeShort
            if (Basis.IsUsdl == basis) {
                mintedPositionUsdlForThisWrapper -= amount; // quote
            } else if (Basis.IsSynth == basis) {
                mintedPositionSynthForThisWrapper += amount; // base
            }
        }
    }

    /// @notice settleCollateral is called when market is settled and it will pro-rata distribute the funds
    /// Before market settled, rebalance function called and collateral is not same in perpLemma when it is deposited
    /// So we will use track variables totalUsdlCollateral, totalSynthCollateral and current balances of usdl and synth to distribute the pro-rata base collateral
    function settleCollateral(
        uint256 usdlOrSynthAmount,
        address to,
        bool isUsdl
    ) internal returns (uint256 amountUsdlCollateral1e_18, uint256 amountUsdcCollateral1e_18) {
        uint256 positionAtSettlementInQuote = isUsdl
            ? mintedPositionUsdlForThisWrapper
            : mintedPositionSynthForThisWrapper;
        require(positionAtSettlementInQuote > 0, "Settled vUSD position amount should not ZERO");

        uint256 tailAmount;
        uint256 usdcAmount;

        // a = totalUsdlCollateral ===> Total usdlcollateral that is deposited in perpLemma.
        // b = usdlCollateral.balanceOf(address(this)) ===> Current Total usdlcollateral perpLemma has.
        // c = totalSynthCollateral ===> Total synthcollateral that is deposited in perpLemma.
        // d = usdc.balanceOf(address(this)) ===> Current Total synthcollateral perpLemma has.
        (uint256 a, uint256 b, uint256 c, uint256 d) = getAllBalance();
        if (isUsdl) {
            tailAmount = a > b ? b : a;
            usdcAmount = c >= d ? 0 : d - c;
        } else {
            usdcAmount = c < d ? c : d;
            tailAmount = a >= b ? 0 : b - a;
        }

        if (tailAmount != 0) {
            uint256 collateralDecimals = IERC20Decimals(address(usdlCollateral)).decimals();
            tailAmount = (tailAmount * 1e18) / (10**collateralDecimals);
            amountUsdlCollateral1e_18 = (usdlOrSynthAmount * tailAmount) / positionAtSettlementInQuote;
            uint256 amountUsdlCollateral = getAmountInCollateralDecimalsForPerp(
                amountUsdlCollateral1e_18,
                address(usdlCollateral),
                false
            );
            SafeERC20Upgradeable.safeTransfer(usdlCollateral, to, amountUsdlCollateral);
            if (isUsdl) totalUsdlCollateral -= amountUsdlCollateral;
        }
        if (usdcAmount != 0) {
            uint256 collateralDecimals = IERC20Decimals(address(usdc)).decimals();
            usdcAmount = (usdcAmount * 1e18) / (10**collateralDecimals);
            amountUsdcCollateral1e_18 = (usdlOrSynthAmount * usdcAmount) / positionAtSettlementInQuote;
            uint256 amountUsdcCollateral = getAmountInCollateralDecimalsForPerp(
                amountUsdcCollateral1e_18,
                address(usdc),
                false
            );
            SafeERC20Upgradeable.safeTransfer(usdc, to, amountUsdcCollateral);
            if (!isUsdl) totalSynthCollateral -= amountUsdcCollateral;
        }
        if (isUsdl) {
            mintedPositionUsdlForThisWrapper -= usdlOrSynthAmount;
        } else {
            mintedPositionSynthForThisWrapper -= usdlOrSynthAmount;
        }
    }

    /// @notice swap USDC -> USDLCollateral
    function _USDCToCollateral(
        address router,
        uint256 routerType,
        bool isExactInput,
        uint256 amountUSDC
    ) internal returns (uint256) {
        return _swapOnDEXSpot(router, routerType, false, isExactInput, amountUSDC);
    }

    /// @notice swap USDLCollateral -> USDC
    function _CollateralToUSDC(
        address router,
        uint256 routerType,
        bool isExactInput,
        uint256 amountCollateral
    ) internal returns (uint256) {
        return _swapOnDEXSpot(router, routerType, true, isExactInput, amountCollateral);
    }

    function _swapOnDEXSpot(
        address router,
        uint256 routerType,
        bool isBuyUSDLCollateral,
        bool isExactInput,
        uint256 amountIn
    ) internal returns (uint256) {
        if (routerType == 0) {
            // NOTE: UniV3
            return _swapOnUniV3(router, isBuyUSDLCollateral, isExactInput, amountIn);
        }
        // NOTE: Unsupported Router --> Using UniV3 as default
        return _swapOnUniV3(router, isBuyUSDLCollateral, isExactInput, amountIn);
    }

    /// @dev Helper function to swap on UniV3
    function _swapOnUniV3(
        address router,
        bool isUSDLCollateralToUSDC,
        bool isExactInput,
        uint256 amount
    ) internal returns (uint256) {
        uint256 res;
        address tokenIn = (isUSDLCollateralToUSDC) ? address(usdlCollateral) : address(usdc);
        address tokenOut = (isUSDLCollateralToUSDC) ? address(usdc) : address(usdlCollateral);

        IERC20Decimals(tokenIn).approve(router, type(uint256).max);
        if (isExactInput) {
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
            uint256 balanceBefore = IERC20Decimals(tokenOut).balanceOf(address(this));
            res = ISwapRouter(router).exactInputSingle(temp);
            uint256 balanceAfter = IERC20Decimals(tokenOut).balanceOf(address(this));
            res = uint256(int256(balanceAfter) - int256(balanceBefore));
        } else {
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
            res = ISwapRouter(router).exactOutputSingle(temp);
        }
        IERC20Decimals(tokenIn).approve(router, 0);
        return res;
    }

    function _msgSender()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        return msg.sender;
    }

    function _msgData()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata)
    {
        return msg.data;
    }
}
