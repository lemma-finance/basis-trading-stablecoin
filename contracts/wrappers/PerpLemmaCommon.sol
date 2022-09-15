// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;

import { ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { IPerpetualMixDEXWrapper } from "../interfaces/IPerpetualMixDEXWrapper.sol";
import { SafeMathExt } from "../libraries/SafeMathExt.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "../interfaces/IERC20Decimals.sol";
import "../interfaces/IUSDLemma.sol";
import "../interfaces/Perpetual/IClearingHouse.sol";
import "../interfaces/Perpetual/IClearingHouseConfig.sol";
import "../interfaces/Perpetual/IIndexPrice.sol";
import "../interfaces/Perpetual/IAccountBalance.sol";
import "../interfaces/Perpetual/IMarketRegistry.sol";
import "../interfaces/Perpetual/IPerpVault.sol";
import "../interfaces/Perpetual/IBaseToken.sol";
import "../interfaces/Perpetual/IExchange.sol";

/// @author Lemma Finance
/// @notice PerpLemmaCommon contract will use to open short and long position with no-leverage
/// USDLemma and LemmaSynth will consime the methods to open short or long on derivative dex
/// Every UsdlCollateral has different PerpLemma deployed, and after deployed it will be add in USDLemma contract perpDexWrapper Mapping
contract PerpLemmaCommon is ERC2771ContextUpgradeable, IPerpetualMixDEXWrapper, AccessControlUpgradeable {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using SafeMathExt for int256;

    // Different Roles to perform restricted tx
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
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

    address public xUsdl;
    address public xSynth;

    /// PerpV2 contract addresses
    IClearingHouse public clearingHouse;
    IClearingHouseConfig public clearingHouseConfig;
    IPerpVault public perpVault;
    IAccountBalance public accountBalance;
    IMarketRegistry public marketRegistry;

    /// Is USDL collateral is tail then it will not deposit into perpV2, It will stay in PerpLemma BalanceSheet
    bool public isUsdlCollateralTailAsset;
    /// USDL collateral address which is use to mint usdl
    IERC20Decimals public usdlCollateral;
    /// USDC ERC20 contract
    IERC20Decimals public override usdc;

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

    // NOTE: Below this free collateral amount, recapitalization in USDC is needed to push back the margin in a safe zone
    uint256 public minFreeCollateral;

    // NOTE: This is the min margin for safety
    uint256 public minMarginSafeThreshold;

    // NOTE: This is very important to define the margin we want to keep when minting
    uint24 public collateralRatio;

    // Gets set only when Settlement has already happened
    // NOTE: This should be equal to the amount of USDL minted depositing on that dexIndex
    /// Amount of USDL minted through this perpLemma, it is tracking because usdl can be mint by multiple perpLemma
    uint256 public mintedPositionUsdlForThisWrapper;
    /// Amount of LemmaSynth minted
    uint256 public mintedPositionSynthForThisWrapper;
    /// Settlement time price
    uint256 public closedPrice;

    // Has the Market Settled, If settled we can't mint new USDL or Synth
    bool public override hasSettled;

    int256 public fundingPaymentsToDistribute;
    uint256 public percFundingPaymentsToUSDLHolders;

    uint256 public accruedFPLossesFromXUSDLInUSDC;
    uint256 public accruedFPLossesFromXSynthInUSDC;

    // Events
    event USDLemmaUpdated(address indexed usdlAddress);
    event SetLemmaSynth(address indexed lemmaSynthAddress);
    event ReferrerUpdated(bytes32 indexed referrerCode);
    event RebalancerUpdated(address indexed rebalancerAddress);
    event MaxPositionUpdated(uint256 indexed maxPos);
    event SetSettlementTokenManager(address indexed _settlementTokenManager);
    event SetMinFreeCollateral(uint256 indexed _minFreeCollateral);
    event SetCollateralRatio(uint256 indexed _collateralRatio);
    event SetMinMarginSafeThreshold(uint256 indexed _minMarginSafeThreshold);

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
        _setRoleAdmin(OWNER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(USDC_TREASURY, ADMIN_ROLE);
        _setRoleAdmin(REBALANCER_ROLE, ADMIN_ROLE);
        _setupRole(ADMIN_ROLE, msg.sender);
        grantRole(OWNER_ROLE, msg.sender);

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
        accountBalance = IAccountBalance(clearingHouse.getAccountBalance());
        marketRegistry = IMarketRegistry(_marketRegistry);
        usdc = IERC20Decimals(perpVault.getSettlementToken());

        collateralRatio = clearingHouseConfig.getImRatio();

        usdlCollateral = IERC20Decimals(_usdlCollateral);
        usdlCollateralDecimals = usdlCollateral.decimals(); // need to verify
        SafeERC20Upgradeable.safeApprove(usdlCollateral, _clearingHouse, MAX_UINT256);

        SafeERC20Upgradeable.safeApprove(usdlCollateral, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, address(perpVault), MAX_UINT256);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), MAX_UINT256);

        if (usdLemma != address(0)) {
            grantRole(PERPLEMMA_ROLE, _usdLemma);
            SafeERC20Upgradeable.safeApprove(usdc, usdLemma, 0);
            SafeERC20Upgradeable.safeApprove(usdc, usdLemma, MAX_UINT256);
            SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, 0);
            SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, MAX_UINT256);
        }

        if (lemmaSynth != address(0)) {
            grantRole(PERPLEMMA_ROLE, _lemmaSynth);
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

    // NOTE: Abstraction Layer
    function getSettlementToken() external view override returns (address) {
        return perpVault.getSettlementToken();
    }

    function getMinFreeCollateral() external view override returns (uint256) {
        return minFreeCollateral;
    }

    function getMinMarginSafeThreshold() external view override returns (uint256) {
        return minMarginSafeThreshold;
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

    function settlePendingFundingPayments() public override {
        fundingPaymentsToDistribute += getPendingFundingPayment();
        clearingHouse.settleAllFunding(address(this));
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
        // NOTE: According to Perp, this is defined as accountValue = totalCollateralValue + totalUnrealizedPnl, in 18 decimals
        int256 currentAccountValue = getAccountValue();
        uint256 currentPrice = getIndexPrice();

        // NOTE: Computing the absolute delta in terms of quote token for the new position
        // NOTE: Need an amount in 1e18 to be compared with account value which I think is in 1e18
        int256 deltaPosition = int256((currentPrice * amount) / (10**(usdlCollateral.decimals())));

        // NOTE: Computing the next position
        int256 futureTotalPositionValue = currentAccountValue + ((isShort) ? int256(-1) : int256(1)) * deltaPosition;
        // int256 futureTotalPositionValue = currentTotalPositionValue + ((isShort) ? int256(-1) : int256(1)) * deltaPosition;
        // int256 futureAccountValue = futureTotalPositionValue + currentAccountValue;
        // print("[getRequiredUSDCToBackMinting()] futureAccountValue = ", futureAccountValue);

        uint256 extraUSDC_1e18 = (futureTotalPositionValue >= 0) ? 0 : uint256(-futureTotalPositionValue);
        // uint256 extraUSDC_1e18 = (futureAccountValue >= 0) ? 0 : uint256(-futureAccountValue);
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
                ? MAX_UINT256 // No Collateral Deposited --> Max Leverage Possible
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

    function isAdditionalUSDCAcceptable(uint256 amount) external view override returns (bool) {
        uint256 vaultSettlementTokenBalance = usdc.balanceOf(address(perpVault));
        uint256 vaultSettlementTokenBalanceCap = clearingHouseConfig.getSettlementTokenBalanceCap();
        require(
            vaultSettlementTokenBalanceCap >= vaultSettlementTokenBalance,
            "isAdditionalUSDCAcceptable Cap needs to be >= Current"
        );
        uint256 maxAcceptableToken = uint256(
            int256(vaultSettlementTokenBalanceCap) - int256(vaultSettlementTokenBalance)
        );
        return amount <= maxAcceptableToken;
    }

    function computeRequiredUSDCForTrade(uint256 amount, bool isShort)
        external
        view
        override
        returns (uint256 requiredUSDC)
    {
        // NOTE: Estimating USDC needed
        uint256 freeCollateralBefore = getFreeCollateral();
        uint256 indexPrice = getIndexPrice();
        uint256 deltaAmount = amount;

        if (
            ((isShort) && (amountBase > 0)) || ((!isShort) && (amountBase < 0)) // NOTE Decrease Long // NOTE Decrease Short
        ) {
            // NOTE: amountBase is in vToken amount so 1e18
            uint256 amountBaseInCollateralDecimals = (_abs(amountBase) * 10**(usdlCollateral.decimals())) / 1e18;

            if (amount <= amountBaseInCollateralDecimals) {
                return 0;
            }

            if (amount <= 2 * amountBaseInCollateralDecimals) {
                return 0;
            }
            deltaAmount = amount - 2 * amountBaseInCollateralDecimals;
        }

        uint256 expectedDeltaQuote = (deltaAmount * indexPrice) / 10**(18 + 18 - usdc.decimals());

        uint256 expectedUSDCDeductedFromFreeCollateral = (expectedDeltaQuote * uint256(collateralRatio)) / 1e6;

        if (expectedUSDCDeductedFromFreeCollateral > freeCollateralBefore) {
            requiredUSDC = expectedUSDCDeductedFromFreeCollateral - freeCollateralBefore;
        }
    }

    ////////////////////////
    /// EXTERNAL METHODS ///
    ////////////////////////

    function setPercFundingPaymentsToUSDLHolders(uint256 _percFundingPaymentsToUSDLHolder)
        external
        override
        onlyRole(OWNER_ROLE)
    {
        percFundingPaymentsToUSDLHolders = _percFundingPaymentsToUSDLHolder;
    }

    function setXUsdl(address _xUsdl) external override onlyRole(OWNER_ROLE) {
        require(_xUsdl != address(0), "Address can't be zero");
        xUsdl = _xUsdl;
    }

    function setXSynth(address _xSynth) external override onlyRole(OWNER_ROLE) {
        require(_xSynth != address(0), "Address can't be zero");
        xSynth = _xSynth;
    }

    function setMinFreeCollateral(uint256 _minFreeCollateral) external override onlyRole(OWNER_ROLE) {
        minFreeCollateral = _minFreeCollateral;
        emit SetMinFreeCollateral(minFreeCollateral);
    }

    function setMinMarginSafeThreshold(uint256 _margin) external override onlyRole(OWNER_ROLE) {
        require(_margin > minFreeCollateral, "Needs to be > minFreeCollateral");
        minMarginSafeThreshold = _margin;
        emit SetMinMarginSafeThreshold(minMarginSafeThreshold);
    }

    function setCollateralRatio(uint24 _collateralRatio) external override onlyRole(OWNER_ROLE) {
        // NOTE: This one should always be >= imRatio or >= mmRatio but not sure if a require is needed
        collateralRatio = _collateralRatio;
        emit SetCollateralRatio(collateralRatio);
    }

    /// @notice Defines the USDL Collateral as a tail asset by only owner role
    function setIsUsdlCollateralTailAsset(bool _x) external onlyRole(OWNER_ROLE) {
        isUsdlCollateralTailAsset = _x;
    }

    /// @notice sets USDLemma address - only owner can set
    /// @param _usdLemma USDLemma address to set
    function setUSDLemma(address _usdLemma) external onlyRole(ADMIN_ROLE) {
        require(_usdLemma != address(0), "UsdLemma should not ZERO address");
        usdLemma = _usdLemma;
        grantRole(PERPLEMMA_ROLE, usdLemma);
        SafeERC20Upgradeable.safeApprove(usdc, usdLemma, 0);
        SafeERC20Upgradeable.safeApprove(usdc, usdLemma, MAX_UINT256);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, 0);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, usdLemma, MAX_UINT256);
        emit USDLemmaUpdated(usdLemma);
    }

    /// @notice sets LemmaSynth address - only owner can set
    /// @param _lemmaSynth LemmaSynth address to set
    function setLemmaSynth(address _lemmaSynth) external onlyRole(ADMIN_ROLE) {
        require(_lemmaSynth != address(0), "LemmaSynth should not ZERO address");
        lemmaSynth = _lemmaSynth;
        grantRole(PERPLEMMA_ROLE, lemmaSynth);
        SafeERC20Upgradeable.safeApprove(usdc, lemmaSynth, 0);
        SafeERC20Upgradeable.safeApprove(usdc, lemmaSynth, MAX_UINT256);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, lemmaSynth, 0);
        SafeERC20Upgradeable.safeApprove(usdlCollateral, lemmaSynth, MAX_UINT256);
        emit SetLemmaSynth(lemmaSynth);
    }

    /// @notice sets refferer code - only owner can set
    /// @param _referrerCode referrerCode of address to set
    function setReferrerCode(bytes32 _referrerCode) external onlyRole(OWNER_ROLE) {
        referrerCode = _referrerCode;
        emit ReferrerUpdated(referrerCode);
    }

    /// @notice sets maximum position the wrapper can take (in terms of base) - only owner can set
    /// @param _maxPosition reBalancer address to set
    function setMaxPosition(uint256 _maxPosition) external onlyRole(OWNER_ROLE) {
        maxPosition = _maxPosition;
        emit MaxPositionUpdated(maxPosition);
    }

    /// @notice setSettlementTokenManager is to set the address of settlementTokenManager by admin role only
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
    }

    /// @notice withdrawSettlementToken is used to withdraw settlement token USDC from perp vault - only owner can withdraw
    /// @param _amount USDC amount need to withdraw from perp vault
    function withdrawSettlementToken(uint256 _amount) external override onlyRole(USDC_TREASURY) {
        require(_amount > 0, "Amount should greater than zero");
        perpVault.withdraw(address(usdc), _amount);
        SafeERC20Upgradeable.safeTransfer(usdc, msg.sender, _amount);
    }

    /// @notice withdrawSettlementTokenTo is used to withdraw settlement token USDC from perp vault - only owner can withdraw
    /// @param _amount USDC amount need to withdraw from perp vault
    /// @param _to address where to transfer fund
    function withdrawSettlementTokenTo(uint256 _amount, address _to) external onlyRole(OWNER_ROLE) {
        require(_amount > 0, "Amount should greater than zero");
        require(hasSettled, "Perpetual is not settled yet");
        SafeERC20Upgradeable.safeTransfer(usdc, _to, _amount);
    }

    /// @notice deposit method is to call from USDLemma or LemmaSynth while mint USDL or Synth
    /// @param amount of assets to deposit
    /// @param collateral needs to deposit
    function deposit(uint256 amount, address collateral) external override onlyRole(PERPLEMMA_ROLE) {
        _deposit(amount, collateral);
    }

    /// @notice withdraw method is to call from USDLemma or LemmaSynth while redeem USDL or Synth
    /// @param amount of assets to withdraw
    /// @param collateral needs to withdraw
    function withdraw(uint256 amount, address collateral) external override onlyRole(PERPLEMMA_ROLE) {
        _withdraw(amount, collateral);
    }

    /// @notice when perpetual is in CLEARED state, withdraw the collateral
    /// @dev Anybody can call it so that it happens as quickly as possible
    function settle() external override {
        clearingHouse.quitMarket(address(this), usdlBaseTokenAddress);
        closedPrice = IBaseToken(usdlBaseTokenAddress).getClosedPrice();

        // NOTE: Settle pending funding rates
        clearingHouse.settleAllFunding(address(this));

        uint256 freeUSDCCollateral = perpVault.getFreeCollateral(address(this));
        _withdraw(freeUSDCCollateral, address(usdc));

        if (!isUsdlCollateralTailAsset) {
            // NOTE: This amount of free collateral is the one internally used to check for the V_NEFC error, so this is the max withdrawable
            uint256 freeCollateralUSDL = perpVault.getFreeCollateralByToken(address(this), address(usdlCollateral));
            _withdraw(freeCollateralUSDL, address(usdlCollateral));
        }

        // All the collateral is now back
        hasSettled = true;
    }

    /// @notice getCollateralBackAfterSettlement is called when market is settled so USDL and Synth withdraw method call this method instead close position
    function getCollateralBackAfterSettlement(
        uint256 amount,
        address to,
        bool isUsdl
    ) external override onlyRole(PERPLEMMA_ROLE) {
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
                (, uint256 amountUSDCMinus_1e18) = closeShortWithExactBase(_amountBaseToRebalance);
                amountUSDCMinus = (amountUSDCMinus_1e18 * (10**usdc.decimals())) / 1e18;
                _withdraw(_amountBaseToRebalance, address(usdlCollateral));
                require(usdlCollateral.balanceOf(address(this)) > _amountBaseToRebalance, "T1");
                amountUSDCPlus = _CollateralToUSDC(router, routerType, true, _amountBaseToRebalance);
            } else {
                amountUSDCPlus = _CollateralToUSDC(router, routerType, true, _amountBaseToRebalance);
                _deposit(amountUSDCPlus, address(usdc));
                (, uint256 amountUSDCMinus_1e18) = openLongWithExactBase(_amountBaseToRebalance);
                amountUSDCMinus = (amountUSDCMinus_1e18 * (10**usdc.decimals())) / 1e18;
            }
        } else {
            if (amountBase <= 0) {
                amountUSDCMinus = _USDCToCollateral(router, routerType, false, _amountBaseToRebalance);
                _deposit(_amountBaseToRebalance, address(usdlCollateral));
                (, uint256 amountUSDCPlus_1e18) = openShortWithExactBase(_amountBaseToRebalance);
                amountUSDCPlus = (amountUSDCPlus_1e18 * (10**usdc.decimals())) / 1e18;
            } else {
                (, uint256 amountUSDCPlus_1e18) = closeLongWithExactBase(_amountBaseToRebalance);
                amountUSDCPlus = (amountUSDCPlus_1e18 * (10**usdc.decimals())) / 1e18;
                _withdraw(amountUSDCPlus, address(usdc));
                amountUSDCMinus = _USDCToCollateral(router, routerType, false, _amountBaseToRebalance);
            }
        }
        if (isCheckProfit) require(amountUSDCPlus >= amountUSDCMinus, "Unprofitable");
        return (amountUSDCPlus, amountUSDCMinus);
    }

    /// @notice calculateMintingAsset is method to track the minted usdl and synth by this perpLemma
    /// @param amount needs to add or sub
    /// @param isOpenShort that position is short or long
    /// @param basis is enum that defines the calculateMintingAsset call from Usdl or lemmaSynth contract
    function calculateMintingAsset(
        uint256 amount,
        Basis basis,
        bool isOpenShort
    ) external override onlyRole(PERPLEMMA_ROLE) {
        _calculateMintingAsset(amount, basis, isOpenShort);
    }

    function distributeFundingPayments()
        external
        override
        returns (
            bool isProfit,
            uint256 amountUSDCToXUSDL,
            uint256 amountUSDCToXSynth
        )
    {
        settlePendingFundingPayments();
        if (fundingPaymentsToDistribute != 0) {
            isProfit = fundingPaymentsToDistribute < 0;
            if (isProfit) {
                // NOTE: Distribute profit
                uint256 amount = _convDecimals(uint256(-fundingPaymentsToDistribute), 18, usdc.decimals());
                // uint256 amount = uint256(-fundingPaymentsToDistribute) * 10**(usdc.decimals()) / 1e18;
                amountUSDCToXUSDL = (amount * percFundingPaymentsToUSDLHolders) / 1e6;
                amountUSDCToXSynth = amount - amountUSDCToXUSDL;
                // perpVault.withdraw(address(usdc), amount);
                // NOTE: They both require an amount in USDC Decimals
                IUSDLemma(usdLemma).mintToStackingContract(
                    _convDecimals(amountUSDCToXUSDL, usdc.decimals(), IUSDLemma(usdLemma).decimals())
                );
                IUSDLemma(lemmaSynth).mintToStackingContract(_convUSDCToSynthAtIndexPrice(amountUSDCToXSynth));
            } else {
                amountUSDCToXUSDL = (uint256(fundingPaymentsToDistribute) * percFundingPaymentsToUSDLHolders) / 1e6;
                amountUSDCToXSynth = uint256(fundingPaymentsToDistribute) - amountUSDCToXUSDL;

                amountUSDCToXUSDL = _convDecimals(amountUSDCToXUSDL, 18, usdc.decimals());
                amountUSDCToXSynth = _convDecimals(amountUSDCToXSynth, 18, usdc.decimals());
                uint256 amountFromXUSDLToProtocolInUSDC;
                uint256 amountFromXSynthToProtocolInUSDC;
                uint256 amountUSDLInUSDC = _convDecimals(
                    IUSDLemma(usdLemma).balanceOf(address(xUsdl)),
                    IUSDLemma(usdLemma).decimals(),
                    usdc.decimals()
                );
                uint256 amountSynthInUSDC = _convSynthToUSDCAtIndexPrice(
                    IUSDLemma(lemmaSynth).balanceOf(address(xSynth))
                );
                //we consider the past payment that was not paid as well
                uint256 USDCToPayFromXUSDL = accruedFPLossesFromXUSDLInUSDC + amountUSDCToXUSDL;
                uint256 USDLToBurn = USDCToPayFromXUSDL;
                if (USDCToPayFromXUSDL > amountUSDLInUSDC) {
                    USDLToBurn = amountUSDLInUSDC;
                    //the rest we try to take from the settlmentTokenManager
                    uint256 settlmentTokenManagerBalance = usdc.balanceOf(settlementTokenManager);
                    uint256 amountFromSettlmentTokenManager = USDCToPayFromXUSDL - amountUSDLInUSDC;
                    if (amountFromSettlmentTokenManager > settlmentTokenManagerBalance) {
                        amountFromSettlmentTokenManager = settlmentTokenManagerBalance;
                        //this is the amount that couldn't be paid from neither xUSDL nor settlmentTokenManager
                        accruedFPLossesFromXUSDLInUSDC = amountFromSettlmentTokenManager - settlmentTokenManagerBalance;
                    }
                    IUSDLemma(usdLemma).requestLossesRecap(amountFromSettlmentTokenManager);
                }
                IUSDLemma(usdLemma).burnToStackingContract(
                    _convDecimals(USDLToBurn, usdc.decimals(), IUSDLemma(usdLemma).decimals())
                );

                uint256 USDCToPayFromXLemmaSynth = accruedFPLossesFromXSynthInUSDC + amountUSDCToXSynth;
                uint256 lemmaSynthToBurn = USDCToPayFromXLemmaSynth;
                if (USDCToPayFromXLemmaSynth > amountSynthInUSDC) {
                    lemmaSynthToBurn = amountSynthInUSDC;
                    //the rest we try to take from the settlmentTokenManager
                    uint256 settlmentTokenManagerBalance = usdc.balanceOf(settlementTokenManager);
                    uint256 amountFromSettlmentTokenManager = USDCToPayFromXLemmaSynth - amountSynthInUSDC;
                    if (amountFromSettlmentTokenManager > settlmentTokenManagerBalance) {
                        amountFromSettlmentTokenManager = settlmentTokenManagerBalance;
                        //this is the amount that couldn't be paid from neither xLemmaSynth nor settlmentTokenManager
                        accruedFPLossesFromXSynthInUSDC =
                            amountFromSettlmentTokenManager -
                            settlmentTokenManagerBalance;
                    }
                    IUSDLemma(usdLemma).requestLossesRecap(amountFromSettlmentTokenManager);
                }
                IUSDLemma(lemmaSynth).burnToStackingContract(_convUSDCToSynthAtIndexPrice(lemmaSynthToBurn));
            }
        }
        // NOTE: Reset the funding payment to distribute
        fundingPaymentsToDistribute = 0;
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

        // NOTE: Funding Payments get settled anyway when the trade is executed, so we need to account them before settling them ourselves
        settlePendingFundingPayments();

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
    function openLongWithExactBase(uint256 amount) public override onlyRole(PERPLEMMA_ROLE) returns (uint256, uint256) {
        (uint256 base, uint256 quote) = trade(amount, false, false);
        return (base, quote);
    }

    function openLongWithExactQuote(uint256 amount)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, false, true);
        return (base, quote);
    }

    function closeLongWithExactBase(uint256 amount)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, true, true);
        return (base, quote);
    }

    function closeLongWithExactQuote(uint256 amount)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, true, false);
        base = getRoudDown(base, address(usdlCollateral)); // RoundDown
        return (base, quote);
    }

    /// USDLemma will use below four methods
    /// 1). openShortWithExactBase => depositToWExactCollateral
    /// 2). openShortWithExactQuote => depositTo
    /// 3). closeShortWithExactBase => withdrawToWExactCollateral
    /// 4). closeShortWithExactQuote => withdrawTo
    function openShortWithExactBase(uint256 amount)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, true, true);
        return (base, quote);
    }

    function openShortWithExactQuote(uint256 amount)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, true, false);
        return (base, quote);
    }

    function closeShortWithExactBase(uint256 amount)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, false, false);
        return (base, quote);
    }

    function closeShortWithExactQuote(uint256 amount)
        public
        override
        onlyRole(PERPLEMMA_ROLE)
        returns (uint256, uint256)
    {
        (uint256 base, uint256 quote) = trade(amount, false, true);
        return (base, quote);
    }

    ///////////////////////////
    /// PUBLIC VIEW METHODS ///
    ///////////////////////////

    function getFreeCollateral() public view override returns (uint256) {
        return perpVault.getFreeCollateral(address(this));
    }

    function getCollateralRatios() public view override returns (uint24 imRatio, uint24 mmRatio) {
        imRatio = clearingHouseConfig.getImRatio();
        mmRatio = clearingHouseConfig.getMmRatio();
    }

    /// @notice Returns the current amount of collateral value (in USDC) after the PnL in 1e18 format
    /// TODO: Take into account tail assets
    function getAccountValue() public view override returns (int256 value_1e18) {
        value_1e18 = clearingHouse.getAccountValue(address(this));
    }

    function getIndexPrice() public view override returns (uint256 price) {
        uint256 _twapInterval = IClearingHouseConfig(clearingHouseConfig).getTwapInterval();
        price = IIndexPrice(usdlBaseTokenAddress).getIndexPrice(_twapInterval);
    }

    function getMarkPrice() public view override returns (uint256 token0Price) {
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(marketRegistry.getPool(usdlBaseTokenAddress)).slot0();
        token0Price = ((uint256(sqrtPriceX96)**2) / (2**192)) * 1e18;
    }

    function getPendingFundingPayment() public view override returns (int256 pendingFundingPayments) {
        // See
        // Interface
        // https://github.com/perpetual-protocol/perp-curie-contract/blob/main/contracts/interface/IExchange.sol#L101
        // Implementation
        // https://github.com/perpetual-protocol/perp-curie-contract/blob/main/contracts/Exchange.sol#L361
        //
        // Notation
        // Earning or Paying Funding
        // - If you see a positive payment, this means you paid this amount of funding.
        // - If you see a negative payment, this means you earned this amount of funding.
        // Source
        // https://support.perp.com/hc/en-us/articles/5257580412569-Funding-Payments
        pendingFundingPayments = IExchange(clearingHouse.getExchange()).getPendingFundingPayment(
            address(this),
            usdlBaseTokenAddress
        );
    }

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

    /// @notice to deposit collateral in vault for short or open position
    /// @dev If collateral is tail asset no need to deposit it in Perp, it has to stay in this contract balance sheet
    function _deposit(uint256 collateralAmount, address collateral) internal {
        if (collateral == address(usdc)) {
            perpVault.deposit(address(usdc), collateralAmount);
        } else if ((collateral == address(usdlCollateral)) && (!isUsdlCollateralTailAsset)) {
            perpVault.deposit(collateral, collateralAmount);
            amountUsdlCollateralDeposited += collateralAmount;
        }
    }

    /// @notice to withdraw collateral from vault after long or close position
    /// @dev If collateral is tail asset no need to withdraw it from Perp, it is already in this contract balance sheet
    function _withdraw(uint256 amountToWithdraw, address collateral) internal {
        // NOTE: Funding Payments are settled anyway when withdraw happens so we need to account them before executing
        settlePendingFundingPayments();
        if (collateral == address(usdc)) {
            perpVault.withdraw(address(usdc), amountToWithdraw);
        } else if ((collateral == address(usdlCollateral)) && (!isUsdlCollateralTailAsset)) {
            // NOTE: This is problematic with ETH
            perpVault.withdraw(collateral, amountToWithdraw);
            amountUsdlCollateralDeposited -= amountToWithdraw;
        }
    }

    /// @notice calculateMintingAsset is method to track the minted usdl and synth by this perpLemma
    /// @param amount needs to add or sub
    /// @param isOpenShort that position is short or long
    /// @param basis is enum that defines the calculateMintingAsset call from Usdl or lemmaSynth contract
    function _calculateMintingAsset(
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
    /// So we will use ClosePerpMarket price and current balances of usdl and synth to distribute the pro-rata base collateral
    function settleCollateral(
        uint256 usdlOrSynthAmount,
        address to,
        bool isUsdl
    ) internal {
        // NOTE: Funding Payments are settled anyway when settlement happens so we need to account them before executing
        settlePendingFundingPayments();
        uint256 tailCollateralBal = (usdlCollateral.balanceOf(address(this)) * 1e18) / (10**usdlCollateral.decimals());
        uint256 synthCollateralBal = (usdc.balanceOf(address(this)) * 1e18) / (10**usdc.decimals());
        require(tailCollateralBal > 0 || synthCollateralBal > 0, "Not Enough collateral for settle");

        if (isUsdl) {
            uint256 tailCollateralTransfer = (usdlOrSynthAmount * 1e18) / closedPrice;
            if (tailCollateralTransfer <= tailCollateralBal) {
                SafeERC20Upgradeable.safeTransfer(
                    usdlCollateral,
                    to,
                    getAmountInCollateralDecimalsForPerp(tailCollateralTransfer, address(usdlCollateral), false)
                );
            } else {
                if (tailCollateralBal > 0) {
                    SafeERC20Upgradeable.safeTransfer(
                        usdlCollateral,
                        to,
                        getAmountInCollateralDecimalsForPerp(tailCollateralBal, address(usdlCollateral), false)
                    );
                }
                if (synthCollateralBal > getSynthInDollar()) {
                    // do we have extra synth for usdlUser
                    uint256 checkDiffInDollar = ((tailCollateralTransfer - tailCollateralBal) * closedPrice) / 1e18; // calculate the needed extra synth to transfer
                    uint256 checkUSDCForUSdl = synthCollateralBal - getSynthInDollar(); // check how much extra synth we have for usdlUser
                    if (checkUSDCForUSdl > checkDiffInDollar) {
                        SafeERC20Upgradeable.safeTransfer(
                            usdc,
                            to,
                            getAmountInCollateralDecimalsForPerp(checkDiffInDollar, address(usdc), false)
                        );
                    } else {
                        SafeERC20Upgradeable.safeTransfer(
                            usdc,
                            to,
                            getAmountInCollateralDecimalsForPerp(checkUSDCForUSdl, address(usdc), false)
                        );
                    }
                }
            }
            /// ERROR MESSAGE: => NEUM: Not enough USDL minted by this PerpLemmaContract
            require(mintedPositionUsdlForThisWrapper >= usdlOrSynthAmount, "NEUM");
            mintedPositionUsdlForThisWrapper -= usdlOrSynthAmount;
        } else {
            uint256 usdcCollateralTransfer = (usdlOrSynthAmount * closedPrice) / 1e18;
            if (usdcCollateralTransfer <= synthCollateralBal) {
                SafeERC20Upgradeable.safeTransfer(
                    usdc,
                    to,
                    getAmountInCollateralDecimalsForPerp(usdcCollateralTransfer, address(usdc), false)
                );
            } else {
                if (synthCollateralBal > 0) {
                    SafeERC20Upgradeable.safeTransfer(
                        usdc,
                        to,
                        getAmountInCollateralDecimalsForPerp(synthCollateralBal, address(usdc), false)
                    );
                }
                if (tailCollateralBal > getUSDLInTail()) {
                    // do we have extra tail for synthUser
                    uint256 checkDiffInTail = ((usdcCollateralTransfer - synthCollateralBal) * 1e18) / closedPrice; // calculate the needed extra tail to transfer
                    uint256 checkTailForSynth = tailCollateralBal - getUSDLInTail(); // check how much extra tail we have for synthUser
                    if (checkTailForSynth > checkDiffInTail) {
                        SafeERC20Upgradeable.safeTransfer(
                            usdlCollateral,
                            to,
                            getAmountInCollateralDecimalsForPerp(checkDiffInTail, address(usdlCollateral), false)
                        );
                    } else {
                        SafeERC20Upgradeable.safeTransfer(
                            usdlCollateral,
                            to,
                            getAmountInCollateralDecimalsForPerp(checkTailForSynth, address(usdlCollateral), false)
                        );
                    }
                }
            }
            /// ERROR MESSAGE: => NEUM: Not enough USDL minted by this PerpLemmaContract
            require(mintedPositionSynthForThisWrapper >= usdlOrSynthAmount, "NEUM");
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

        SafeERC20Upgradeable.safeApprove(IERC20Upgradeable(tokenIn), router, MAX_UINT256);
        if (isExactInput) {
            ISwapRouter.ExactInputSingleParams memory temp = ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: 3000,
                recipient: address(this),
                deadline: MAX_UINT256,
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
                deadline: MAX_UINT256,
                amountOut: amount,
                amountInMaximum: MAX_UINT256,
                sqrtPriceLimitX96: 0
            });
            res = ISwapRouter(router).exactOutputSingle(temp);
        }
        SafeERC20Upgradeable.safeApprove(IERC20Upgradeable(tokenIn), router, 0);
        return res;
    }

    /// @notice getSynthInDollar will give lemmaSynth in dollar price, for e.g 1 LemmaSynthETH => 1000 USDC
    function getSynthInDollar() internal view returns (uint256) {
        return (mintedPositionSynthForThisWrapper * closedPrice) / 1e18;
    }

    /// @notice getUSDLInTail will give USDL in eth/tail collateral price, for e.g 1000 USDL => 1 ETH
    function getUSDLInTail() internal view returns (uint256) {
        return (mintedPositionUsdlForThisWrapper * 1e18) / closedPrice;
    }

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

    function _convDecimals(
        uint256 amount,
        uint256 srcDecimals,
        uint256 dstDecimals
    ) internal pure returns (uint256 res) {
        res = (amount * 10**(dstDecimals)) / 10**(srcDecimals);
    }

    function _convUSDCToSynthAtIndexPrice(uint256 amountUSDC) internal view returns (uint256) {
        return _convDecimals(amountUSDC, usdc.decimals(), 18 + IUSDLemma(lemmaSynth).decimals()) / getIndexPrice();
    }

    function _convSynthToUSDCAtIndexPrice(uint256 amountSynth) internal view returns (uint256) {
        return _convDecimals(amountSynth * getIndexPrice(), IUSDLemma(lemmaSynth).decimals() + 18, usdc.decimals());
    }

    function _convUSDCToUSDLIndexPrice(uint256 amountUSDC) internal view returns (uint256) {
        return _convDecimals(amountUSDC, usdc.decimals(), IUSDLemma(usdLemma).decimals());
    }

    function _convUSDLToUSDCAtIndexPrice(uint256 amountUSDL) internal view returns (uint256) {
        return _convDecimals(amountUSDL, IUSDLemma(usdLemma).decimals(), usdc.decimals());
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a <= b) ? a : b;
    }

    function _max(int256 a, int256 b) internal pure returns (int256) {
        return (a >= b) ? a : b;
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a >= b) ? a : b;
    }

    function _abs(int256 a) internal pure returns (uint256) {
        return (a >= 0) ? uint256(a) : uint256(-1 * a);
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
