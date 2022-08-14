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

// NOTE: There is an incompatibility between Foundry and Hardhat `console.log()`
import "forge-std/Test.sol";

// import "hardhat/console.sol";

contract PerpLemmaCommon is ERC2771ContextUpgradeable, IPerpetualMixDEXWrapper, AccessControlUpgradeable {
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

    // NOTE: Below this free collateral amount, recapitalization in USDC is needed to push back the margin in a safe zone
    uint256 public minFreeCollateral;

    // NOTE: This is the min margin for safety
    uint256 public minMarginSafeThreshold;

    // NOTE: This is very important to define the margin we want to keep when minting
    uint24 public collateralRatio;

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

    function print(string memory s, int256 v) internal view {
        uint256 val = (v < 0) ? uint256(-v) : uint256(v);
        console.log(s, " = ", (v < 0) ? " - " : " + ", val);
    }

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

        collateralRatio = clearingHouseConfig.getImRatio();

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

    function setMinFreeCollateral(uint256 _minFreeCollateral) external override onlyRole(ADMIN_ROLE) {
        // TODO: Emit Event
        minFreeCollateral = _minFreeCollateral;
    }

    function setMinMarginSafeThreshold(uint256 _margin) external override onlyRole(ADMIN_ROLE) {
        // TODO: Add Emit Event
        require(_margin > minFreeCollateral, "Needs to be > minFreeCollateral");
        minMarginSafeThreshold = _margin;
    }

    function setCollateralRatio(uint24 _collateralRatio) external override onlyRole(ADMIN_ROLE) {
        // TODO: Add Emit Event
        // NOTE: This one should always be >= imRatio or >= mmRatio but not sure if a require is needed
        collateralRatio = _collateralRatio;
    }


    /// @notice Returning the max amount of USDC Tokens that is possible to put in Vault to collateralize positions
    /// @dev The underlying Perp Protocol (so far we only have PerpV2) can have a limit on the total amount of Settlement Token the Vault can accept 
    function getMaxSettlementTokenAcceptableByVault() override public view returns(uint256) {
        IERC20Decimals settlementToken = IERC20Decimals(perpVault.getSettlementToken());
        uint256 perpVaultSettlementTokenBalanceBefore = settlementToken.balanceOf(address(perpVault));
        uint256 settlementTokenBalanceCap = IClearingHouseConfig(clearingHouse.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        require(settlementTokenBalanceCap >= perpVaultSettlementTokenBalanceBefore, "[getVaultSettlementTokenLimit] Unexpected");
        return uint256( int256(settlementTokenBalanceCap) - int256(perpVaultSettlementTokenBalanceBefore) );
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

    /// @dev This one probably not needed as we can call usdlCollateral.decimals() when we need it
    function getUsdlCollateralDecimals() external view override returns(uint256) {
        return usdlCollateralDecimals;
    }


    function getFreeCollateral() public view override returns(uint256) {
        return perpVault.getFreeCollateral(address(this));
    }

    function getCollateralRatios() public view override returns(uint24 imRatio, uint24 mmRatio) {
        imRatio = clearingHouseConfig.getImRatio();
        mmRatio = clearingHouseConfig.getMmRatio();
    }

    // NOTE: Abstraction Layer
    function getSettlementToken() external view override returns(address) {
        return perpVault.getSettlementToken();
    }


    function getMinFreeCollateral() external view override returns(uint256) {
        return minFreeCollateral;
    }

    function getMinMarginSafeThreshold() external view override returns(uint256) {
        return minMarginSafeThreshold;
    }

    function getIndexPrice() override public view returns(uint256) {
        uint256 _twapInterval = IClearingHouseConfig(clearingHouseConfig).getTwapInterval();
        uint256 _price = IIndexPrice(usdlBaseTokenAddress).getIndexPrice(_twapInterval);
        return _price;
    }

    /// @notice getFees fees charge by perpV2 protocol for each trade
    function getFees() external view override returns (uint256) {
        // NOTE: Removed prev arg address baseTokenAddress
        IMarketRegistry.MarketInfo memory marketInfo = marketRegistry.getMarketInfo(usdlBaseTokenAddress);
        return marketInfo.exchangeFeeRatio;
    }

    /// @notice getTotalPosition in terms of quoteToken(in our case vUSD)
    /// 
    /// https://github.com/perpetual-protocol/perp-curie-contract/blob/main/contracts/AccountBalance.sol#L339
    /// https://github.com/perpetual-protocol/perp-curie-contract/blob/main/contracts/interface/IAccountBalance.sol#L218
    /// 
    /// https://github.com/yashnaman/perp-lushan/blob/main/contracts/interface/IAccountBalance.sol#L224
    /// https://github.com/yashnaman/perp-lushan/blob/main/contracts/AccountBalance.sol#L320
    function getTotalPosition() override public view returns (int256) {
        return accountBalance.getTotalPositionValue(address(this), usdlBaseTokenAddress);
    }


    /// @notice It returns the collateral accepted in the Perp Protocol to back positions 
    /// @dev By default, the first element is the settlement token
    function getCollateralTokens() override external view returns (address[] memory res) {
        res = new address[](1);
        res[0] = perpVault.getSettlementToken();
    }

    /// @notice It returns the amount of USDC that are possibly needed to properly collateralize the new position on Perp 
    /// @dev When the position is reduced in absolute terms, then there is no need for additional collateral while when it increases in absolute terms then we need to add more 
    /// @param amount The amount of the new position 
    /// @param isShort If we are minting USDL or a Synth by changing our Position on Perp  
    function getRequiredUSDCToBackMinting(uint256 amount, bool isShort) override external view returns(bool isAcceptable, uint256 extraUSDC) {
        // NOTE: According to Perp, this is defined as accountValue = totalCollateralValue + totalUnrealizedPnl, in 18 decimals   
        int256 currentAccountValue = getAccountValue(); 
        uint256 currentPrice = getIndexPrice();
        uint256 oracleDecimals = 18;

        // NOTE: Computing the absolute delta in terms of quote token for the new position 
        // NOTE: Need an amount in 1e18 to be compared with account value which I think is in 1e18
        int256 deltaPosition = int256(currentPrice * amount / (10 ** (usdlCollateral.decimals())));

        // NOTE: Computing the next position 
        int256 futureTotalPositionValue = currentAccountValue + ((isShort) ? int256(-1) : int256(1)) * deltaPosition;
        // int256 futureTotalPositionValue = currentTotalPositionValue + ((isShort) ? int256(-1) : int256(1)) * deltaPosition;
        print("[getRequiredUSDCToBackMinting()] futureTotalPositionValue = ", futureTotalPositionValue);
        // int256 futureAccountValue = futureTotalPositionValue + currentAccountValue;
        // print("[getRequiredUSDCToBackMinting()] futureAccountValue = ", futureAccountValue);

        uint256 extraUSDC_1e18 = (futureTotalPositionValue >= 0) ? 0 : uint256(-futureTotalPositionValue);
        // uint256 extraUSDC_1e18 = (futureAccountValue >= 0) ? 0 : uint256(-futureAccountValue);
        console.log("[getRequiredUSDCToBackMinting()] extraUSDC_1e18 = ", extraUSDC_1e18);
        extraUSDC = getAmountInCollateralDecimalsForPerp(extraUSDC_1e18, address(usdc), false); 
        console.log("[_getExtraUSDCToBackMinting()] extraUSDC = ", extraUSDC);

        uint256 maxSettlementTokenAcceptableFromPerpVault = getMaxSettlementTokenAcceptableByVault(); 
        console.log("[_getExtraUSDCToBackMinting()] maxSettlementTokenAcceptableFromPerpVault = ", maxSettlementTokenAcceptableFromPerpVault);

        if(extraUSDC > maxSettlementTokenAcceptableFromPerpVault) {
            isAcceptable = false;
            console.log("[_getExtraUSDCToBackMinting()] extraUSDC > maxSettlementTokenAcceptableFromPerpVault so can't deposit the required amount to fully collateralize the new short");            
        }
        else {
            isAcceptable = true;
            console.log("[_getExtraUSDCToBackMinting()] extraUSDC <= maxSettlementTokenAcceptableFromPerpVault so can deposit the required amount");
        }
    }





    /// @notice Returns the current amount of collateral value (in USDC) after the PnL in 1e18 format
    /// TODO: Take into account tail assets
    function getAccountValue() override public view returns(int256 value_1e18) {
        // NOTE: Get account value of a trader 
        /// @dev accountValue = totalCollateralValue + totalUnrealizedPnl, in 18 decimals
        // https://github.com/perpetual-protocol/perp-curie-contract/blob/main/contracts/interface/IClearingHouse.sol#L290
        value_1e18 = clearingHouse.getAccountValue(address(this)); 
    }

    // Returns the margin
    // NOTE: Returns totalCollateralValue + unrealizedPnL
    /// Functions 
    /// clearingHouse.getAccountValue()
    /// https://github.com/perpetual-protocol/perp-curie-contract/blob/main/contracts/ClearingHouse.sol#L684
    /// https://github.com/perpetual-protocol/perp-curie-contract/blob/main/contracts/ClearingHouse.sol#L684
    /// 
    /// https://github.com/yashnaman/perp-lushan/blob/main/contracts/interface/IClearingHouse.sol#L254
    function getSettlementTokenAmountInVault() external view override returns(int256) {
        return perpVault.getBalance(address(this));
    }



    /// @notice Returns the relative margin in 1e18 format
    /// TODO: Take into account tail assets
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
        return (
            (_accountValue_1e18 <= int256(0) || (_margin < 0))
                ? type(uint256).max // No Collateral Deposited --> Max Leverage Possible
                : (_margin.abs().toUint256() * 1e18) / _accountValue
        );
    }

    /// @notice Computes the delta exposure
    /// @dev It does not take into account if the deposited collateral gets silently converted in USDC so that we lose positive delta exposure
    function getDeltaExposure() external view override returns(int256) {
        (uint256 _usdlCollateralAmount, uint256 _usdlCollateralDepositedAmount, int256 _longOrShort,,) = getExposureDetails();
        uint256 _longOnly = (_usdlCollateralAmount + _usdlCollateralDepositedAmount) * 10**(18 - usdlCollateralDecimals);         // Both usdlCollateralDecimals format

        int256 _deltaLongShort = int256(_longOnly) + _longOrShort;
        uint256 _absTot = _longOnly + _longOrShort.abs().toUint256();
        int256 _delta = (_absTot == 0) ? int256(0) : (_deltaLongShort * 1e6) / int256(_absTot);
        return _delta;
    }

    /// @notice Returns all the exposure related details
    function getExposureDetails() public view override returns(uint256, uint256, int256, int256, uint256) {
        return (
            usdlCollateral.balanceOf(address(this)),
            amountUsdlCollateralDeposited,
            amountBase, // All the other terms are in 1e6
            perpVault.getBalance(address(this)), // This number could change when PnL gets realized so it is better to read it from the Vault directly
            usdc.balanceOf(address(this))
        );
    }

    /// @notice Returns the margin
    function getMargin() external view override returns(int256) {
        int256 _margin = accountBalance.getMarginRequirementForLiquidation(address(this));
        print("[PerpLemmaCommon getMargin()] _margin = ", _margin);
        return _margin;
    }



    /// @notice Defines the USDL Collateral as a tail asset
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

    function getCollateralBackAfterSettlement(
        uint256 amount, address to, bool isUsdl
    ) external override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        return settleCollateral(amount, to, isUsdl);
    }



    function _min(uint256 a, uint256 b) internal pure returns(uint256) {
        return (a <= b) ? a : b;
    }

    function _max(int256 a, int256 b) internal pure returns(int256) {
        return (a >= b) ? a : b;
    }

    function _max(uint256 a, uint256 b) internal pure returns(uint256) {
        return (a >= b) ? a : b;
    }

    function _abs(int256 a) internal pure returns(uint256) {
        return (a >= 0) ? uint256(a) : uint256(-1 * a);
    }

    function computeRequiredUSDCForTrade(uint256 amount, bool isShort) external view override returns(uint256 requiredUSDC) {
        // NOTE: Estimating USDC needed 
        console.log("[computeRequiredUSDCForTrade()] USDC Decimals = ", usdc.decimals());

        console.log("[computeRequiredUSDCForTrade()] amount = ", amount);
        print("[computeRequiredUSDCForTrade()] amountBase = ", amountBase);
        console.log("[computeRequiredUSDCForTrade()] collateralRatio = ", collateralRatio);

        uint256 freeCollateralBefore = getFreeCollateral();
        console.log("[computeRequiredUSDCForTrade()] freeCollateralBefore = ", freeCollateralBefore);
        uint256 indexPrice = getIndexPrice();
        console.log("[computeRequiredUSDCForTrade()] IndexPrice = ", indexPrice);
        (uint24 imRatio, uint24 mmRatio) = getCollateralRatios();
        console.log("[computeRequiredUSDCForTrade()] imRatio = ", imRatio);
        console.log("[computeRequiredUSDCForTrade()] mmRatio = ", mmRatio);

        console.log("[computeRequiredUSDCForTrade()] collateralRatio = ", collateralRatio);

        uint256 deltaAmount = amount;

        if( 
            ((isShort) && (amountBase > 0)) ||  // NOTE Decrease Long 
            ((!isShort) && (amountBase < 0))    // NOTE Decrease Short
            ) {
                if(amount <= _abs(amountBase)) {
                    console.log("[computeRequiredUSDCForTrade()] Position Decreases but does not flip, so it just frees up collateral");
                    return 0;
                }

                if( amount <= 2*_abs(amountBase) ) {
                    console.log("[computeRequiredUSDCForTrade()] Position has flipped but the final position is <= the original one so it just frees up collateral");
                    return 0;
                }

                deltaAmount = amount - 2 * _abs(amountBase);
            } 

        uint256 expectedDeltaQuote = deltaAmount * indexPrice / 10 ** (18 + 18 - usdc.decimals());
        console.log("[computeRequiredUSDCForTrade()] expectedDeltaQuote = ", expectedDeltaQuote);

        uint256 expectedUSDCDeductedFromFreeCollateral = expectedDeltaQuote * uint256(collateralRatio) / 1e6;
        console.log("[computeRequiredUSDCForTrade()] expectedUSDCDeductedFromFreeCollateral = ", expectedUSDCDeductedFromFreeCollateral);

        if(expectedUSDCDeductedFromFreeCollateral > freeCollateralBefore) {
            requiredUSDC = expectedUSDCDeductedFromFreeCollateral - freeCollateralBefore;
        }

        console.log("[computeRequiredUSDCForTrade()] requiredUSDC = ", requiredUSDC);

        // uint256 expectedFinalFreeCollateral = freeCollateralBefore - expectedUSDCDeductedFromFreeCollateral;
        // console.log("[computeRequiredUSDCForTrade()] expectedFinalFreeCollateral = ", expectedFinalFreeCollateral);
        // uint256 requiredUSDCCollateral = uint256(_max(int256(0), int256(expectedFinalFreeCollateral) - int256(freeCollateralBefore)));
        // console.log("[computeRequiredUSDCForTrade()] requiredUSDCCollateral = ", requiredUSDCCollateral);
        // return requiredUSDCCollateral;
    }



    
    function isAdditionalUSDCAcceptable(uint256 amount) external view override returns(bool) {
        uint256 vaultSettlementTokenBalance = usdc.balanceOf(address(perpVault));
        uint256 vaultSettlementTokenBalanceCap = clearingHouseConfig.getSettlementTokenBalanceCap();
        require(vaultSettlementTokenBalanceCap >= vaultSettlementTokenBalance, "isAdditionalUSDCAcceptable Cap needs to be >= Current");
        uint256 maxAcceptableToken = uint256( int256(vaultSettlementTokenBalanceCap) - int256(vaultSettlementTokenBalance) );
        return amount <= maxAcceptableToken;
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
        // uint256 usdlCollateralAmountPerp;
        // uint256 usdlCollateralAmountDex;
        uint256 amountUSDCPlus;
        uint256 amountUSDCMinus;

        require(amountBaseToRebalance != 0, "! No Rebalance with Zero Amount");

        bool isIncreaseBase = amountBaseToRebalance > 0;
        uint256 _amountBaseToRebalance = (isIncreaseBase)
            ? uint256(amountBaseToRebalance)
            : uint256(-amountBaseToRebalance);

        if(isIncreaseBase) {
            if(amountBase < 0) {
                (, uint256 amountUSDCMinus_1e18) = closeShortWithExactBase(_amountBaseToRebalance, address(0), 0, Basis.IsRebalance);
                amountUSDCMinus = amountUSDCMinus_1e18 * (10 ** usdc.decimals()) / 1e18;
                _withdraw(_amountBaseToRebalance, address(usdlCollateral), Basis.IsRebalance);
                require(usdlCollateral.balanceOf(address(this)) > _amountBaseToRebalance, "T1");
                amountUSDCPlus = _CollateralToUSDC(router, routerType, true, _amountBaseToRebalance);
            } else {
                amountUSDCPlus = _CollateralToUSDC(router, routerType, true, _amountBaseToRebalance);
                _deposit(amountUSDCPlus, address(usdc), Basis.IsRebalance);
                (, uint256 amountUSDCMinus_1e18) = openLongWithExactBase(_amountBaseToRebalance, address(0), 0, Basis.IsRebalance);
                amountUSDCMinus = amountUSDCMinus_1e18 * (10 ** usdc.decimals()) / 1e18;
            }
        } else {
            if (amountBase <= 0) {
                amountUSDCMinus = _USDCToCollateral(router, routerType, false, _amountBaseToRebalance);
                _deposit(_amountBaseToRebalance, address(usdlCollateral), Basis.IsRebalance);
                (, uint256 amountUSDCPlus_1e18) = openShortWithExactBase(_amountBaseToRebalance, address(0), 0, Basis.IsRebalance); 
                amountUSDCPlus = amountUSDCPlus_1e18 * (10 ** usdc.decimals()) / 1e18;
            } else {
                (, uint256 amountUSDCPlus_1e18) = closeLongWithExactBase(_amountBaseToRebalance, address(0), 0, Basis.IsRebalance);
                amountUSDCPlus = amountUSDCPlus_1e18 * (10 ** usdc.decimals()) / 1e18;
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
        calculateMintingAsset(base, basis, false);
        return (base, quote);
    }

    function openLongWithExactQuote(uint256 amount, address collateralIn, uint256 amountIn, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralIn != address(0)) && (amountIn > 0)) _deposit(amountIn, collateralIn, basis);
        (uint256 base, uint256 quote) = trade(amount, false, true);
        calculateMintingAsset(base, basis, false);
        return (base, quote);
    }

    function closeLongWithExactBase(uint256 amount, address collateralOut, uint256 amountOut, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralOut != address(0)) && (amountOut > 0)) _withdraw(amountOut, collateralOut, basis);
        (uint256 base, uint256 quote) = trade(amount, true, true);
        calculateMintingAsset(base, basis, true);
        return (base, quote);
    }

    function closeLongWithExactQuote(uint256 amount, address collateralOut, uint256 amountOut, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralOut != address(0)) && (amountOut > 0)) _withdraw(amountOut, collateralOut, basis);
        (uint256 base, uint256 quote) = trade(amount, true, false);
        calculateMintingAsset(getRoudDown(base), basis, true);
        return (base, quote);
    }

    function openShortWithExactBase(uint256 amount, address collateralIn, uint256 amountIn, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralIn != address(0)) && (amountIn > 0)) _deposit(amountIn, collateralIn, basis);
        (uint256 base, uint256 quote) = trade(amount, true, true);
        calculateMintingAsset(quote, basis, true);
        return (base, quote);
    }

    function openShortWithExactQuote(uint256 amount, address collateralIn, uint256 amountIn, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralIn != address(0)) && (amountIn > 0)) _deposit(amountIn, collateralIn, basis);
        (uint256 base, uint256 quote) = trade(amount, true, false);
        calculateMintingAsset(quote, basis, true);
        return (base, quote);
    }

    function closeShortWithExactBase(uint256 amount, address collateralOut, uint256 amountOut, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralOut != address(0)) && (amountOut > 0)) _withdraw(amountOut, collateralOut, basis);
        (uint256 base, uint256 quote) = trade(amount, false, false);
        calculateMintingAsset(quote, basis, false);
        return (base, quote);
    }

    function closeShortWithExactQuote(uint256 amount, address collateralOut, uint256 amountOut, Basis basis) public override onlyRole(PERPLEMMA_ROLE) returns(uint256, uint256) {
        if((collateralOut != address(0)) && (amountOut > 0)) _withdraw(amountOut, collateralOut, basis);
        (uint256 base, uint256 quote) = trade(amount, false, true);
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
    
    function getRoudDown(uint256 amount) internal pure returns (uint256) {
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
        if (isUsdl) {
            tailAmount = a > b ? b : a;
            usdcAmount = c >= d ? 0 : d - c;
        } else {
            usdcAmount = c < d ? c : d;
            tailAmount = a >= b ? 0 : b - a;
        }

        if (tailAmount != 0) {
            uint256 collateralDecimals = IERC20Decimals(address(usdlCollateral)).decimals();
            tailAmount = tailAmount * 1e18 / (10**collateralDecimals);
            amountUsdlCollateral1e_18 = (usdlOrSynthAmount * tailAmount) / positionAtSettlementInQuote;
            uint256 amountUsdlCollateral = getAmountInCollateralDecimalsForPerp(amountUsdlCollateral1e_18, address(usdlCollateral), false);
            SafeERC20Upgradeable.safeTransfer(usdlCollateral, to, amountUsdlCollateral);
            if (isUsdl) totalUsdlCollateral -= amountUsdlCollateral;
        }
        if (usdcAmount != 0) {
            uint256 collateralDecimals = IERC20Decimals(address(usdc)).decimals();
            usdcAmount = usdcAmount * 1e18 / (10**collateralDecimals);
            amountUsdcCollateral1e_18 = (usdlOrSynthAmount * usdcAmount) / positionAtSettlementInQuote;
            uint256 amountUsdcCollateral = getAmountInCollateralDecimalsForPerp(amountUsdcCollateral1e_18, address(usdc), false);
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

    /// @dev Helper function to swap on UniV3 
    function _swapOnUniV3(address router, bool isUSDLCollateralToUSDC, bool isExactInput, uint256 amount) internal returns(uint256) {
        uint256 res;
        address tokenIn = (isUSDLCollateralToUSDC) ? address(usdlCollateral) : address(usdc);
        address tokenOut = (isUSDLCollateralToUSDC) ? address(usdc) : address(usdlCollateral);

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
            uint256 balanceBefore = IERC20Decimals(tokenOut).balanceOf(address(this));
            res = ISwapRouter(router).exactInputSingle(temp);
            uint256 balanceAfter = IERC20Decimals(tokenOut).balanceOf(address(this));
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
