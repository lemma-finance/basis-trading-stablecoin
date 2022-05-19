// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;

import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { IPerpetualMixDEXWrapper } from "../interfaces/IPerpetualMixDEXWrapper.sol";
import { Utils } from "../libraries/Utils.sol";
import { SafeMathExt } from "../libraries/SafeMathExt.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../libraries/TransferHelper.sol";
import "../interfaces/IERC20Decimals.sol";
import "../interfaces/Perpetual/IClearingHouse.sol";
import "../interfaces/Perpetual/IClearingHouseConfig.sol";
import "../interfaces/Perpetual/IAccountBalance.sol";
import "../interfaces/Perpetual/IMarketRegistry.sol";
import "../interfaces/Perpetual/IExchange.sol";
import "../interfaces/Perpetual/IPerpVault.sol";
import "../interfaces/Perpetual/IUSDLemma.sol";
import "hardhat/console.sol";

contract PerpLemmaCommon is OwnableUpgradeable, ERC2771ContextUpgradeable, IPerpetualMixDEXWrapper {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using Utils for int256;
    using SafeMathExt for int256;

    address public usdLemma;
    address public reBalancer;
    address public usdlBaseTokenAddress;
    address public synthBaseTokenAddress;
    bytes32 public referrerCode;

    IClearingHouse public clearingHouse;
    IClearingHouseConfig public clearingHouseConfig;
    IPerpVault public perpVault;
    IAccountBalance public accountBalance;
    IMarketRegistry public marketRegistry;
    IExchange public exchange;
    IERC20Decimals public usdlCollateral;
    IERC20Decimals public synthCollateral;
    IERC20Decimals public usdc;

    uint256 public constant MAX_UINT256 = type(uint256).max;
    uint256 public maxPosition;
    uint256 public usdlCollateralDecimals;
    uint256 public synthCollateralDecimals;

    // Gets set only when Settlement has already happened
    // NOTE: This should be equal to the amount of USDL minted depositing on that dexIndex
    uint256 public positionAtSettlementInQuoteForUSDL;
    uint256 public positionAtSettlementInQuoteForSynth;
    uint256 public positionAtSettlementInBaseForUSDL;
    uint256 public positionAtSettlementInBaseForSynth;

    int256 public totalFundingPNL;
    int256 public realizedFundingPNL;

    // Has the Market Settled
    bool public hasSettled;

    // events
    event USDLemmaUpdated(address usdlAddress);
    event ReferrerUpdated(bytes32 referrerCode);
    event RebalancerUpdated(address rebalancerAddress);
    event MaxPositionUpdated(uint256 maxPos);

    modifier onlyUSDLemma() {
        require(msg.sender == usdLemma, "only usdLemma is allowed");
        _;
    }

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
        require(_synthBaseToken != address(0), "_synthBaseToken should not ZERO address");
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

        synthBaseTokenAddress = _synthBaseToken;
        synthCollateral = IERC20Decimals(_synthCollateral);
        synthCollateralDecimals = synthCollateral.decimals(); // need to verify
        synthCollateral.approve(_clearingHouse, MAX_UINT256);
        
        // NOTE: Even though it is not necessary, it is for clarity
        hasSettled = false;

        SafeERC20Upgradeable.safeApprove(usdlCollateral, address(perpVault), MAX_UINT256);
        SafeERC20Upgradeable.safeApprove(synthCollateral, address(perpVault), MAX_UINT256);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), MAX_UINT256);
    }

    /// @notice getFees fees charge by perpV2 protocol for each trade
    function getFees(address baseTokenAddress) external view override returns (uint256) {
        IMarketRegistry.MarketInfo memory marketInfo = marketRegistry.getMarketInfo(baseTokenAddress);
        return marketInfo.exchangeFeeRatio;
    }

    /// @notice getTotalPosition in terms of quoteToken(in our case vUSD)
    function getTotalPosition(address baseTokenAddress) external view override returns (int256) {
        return accountBalance.getTotalPositionValue(address(this), baseTokenAddress);
    }

    ///@notice sets USDLemma address - only owner can set
    ///@param _usdLemma USDLemma address to set
    function setUSDLemma(address _usdLemma) external onlyOwner {
        require(_usdLemma != address(0), "UsdLemma should not ZERO address");
        usdLemma = _usdLemma;
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

        SafeERC20Upgradeable.safeApprove(synthCollateral, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(synthCollateral, address(perpVault), MAX_UINT256);

        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), MAX_UINT256);
    }

    /// @notice depositSettlementToken is used to deposit settlement token USDC into perp vault - only owner can deposit
    /// @param _amount USDC amount need to deposit into perp vault
    function depositSettlementToken(uint256 _amount) external onlyOwner {
        require(_amount > 0, "Amount should greater than zero");
        SafeERC20Upgradeable.safeTransferFrom(usdc, msg.sender, address(this), _amount);
        perpVault.deposit(address(usdc), _amount);
    }

    /// @notice withdrawSettlementToken is used to withdraw settlement token USDC from perp vault - only owner can withdraw
    /// @param _amount USDC amount need to withdraw from perp vault
    function withdrawSettlementToken(uint256 _amount) external onlyOwner {
        require(_amount > 0, "Amount should greater than zero");
        perpVault.withdraw(address(usdc), _amount);
        SafeERC20Upgradeable.safeTransfer(usdc, msg.sender, _amount);
    }

    /// METHODS WITH EXACT USDL or vUSD(quote or vUSD)
    /// 1). getCollateralAmountGivenUnderlyingAssetAmountForPerp and openShortWithExactQuoteForUSDL
    /// 2). getCollateralAmountGivenUnderlyingAssetAmountForPerp and closeLongWithExactQuoteForUSDL

    /// METHODS WITH EXACT ETH or vETH(base or vETH)
    /// 3). getCollateralAmountGivenUnderlyingAssetAmountForPerp and openLongWithExactBaseForSynth
    /// 4). getCollateralAmountGivenUnderlyingAssetAmountForPerp and closeShortWithExactBaseForSynth

    /// @notice getCollateralAmountGivenUnderlyingAssetAmountForPerp will create short or long position and give base or quote amount as collateral 
    /// @param amount is for exact amount of USDL will use to create a short or long position instead ethCollateral
    /// @param isShorting is bool for need to do short or long
    /// @param isUsdl if it is true then mint usdl otherwise synth
    function getCollateralAmountGivenUnderlyingAssetAmountForPerp(
        uint256 amount, bool isShorting, bool isUsdl
    )
        external
        override
        onlyUSDLemma
        returns (uint256 collateral)
    {
        bool _isBaseToQuote;
        bool _isExactInput;
        address baseTokenAddress;

        if (isUsdl) {
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
        } else {
            baseTokenAddress = synthBaseTokenAddress;
            if (isShorting) {
                // before closeShortWithExactBaseForSynth
                _isBaseToQuote = true;
                _isExactInput = true;
                if (hasSettled) return closeWExactCollateralAfterSettlementForSynth(amount);
            } else {
                // before openLongWithExactBaseForSynth
                _isBaseToQuote = false;
                _isExactInput = false;
            }
        }

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
        if (isUsdl) {
            collateral = base;
        } else {
            collateral = quote;
        }
    }

    /// @notice Open short position for eth(baseToken) on getCollateralAmountGivenUnderlyingAssetAmountForPerp first using exact amount of USDL(or vUSD you can say) and deposit collateral here
    /// @param collateralAmountRequired collateral amount required to open the position
    function openShortWithExactQuoteForUSDL(uint256, uint256 collateralAmountRequired) external override onlyUSDLemma {
        require(collateralAmountRequired > 0, "Amount should greater than zero");
        uint256 collateralAmountToDeposit = getAmountInCollateralDecimalsForPerp(collateralAmountRequired, address(usdlCollateral), false);
        require(collateralAmountToDeposit > 0, "Amount should greater than zero");
        require(usdlCollateral.balanceOf(address(this)) >= collateralAmountToDeposit, "Not enough collateral to Open");
        _deposit(collateralAmountToDeposit, address(usdlCollateral));
    }

    /// @notice Open long position for eth(baseToken) on getCollateralAmountGivenUnderlyingAssetAmountForPerp first using exact amount of USDL(or vUSD you can say) and withdraw collateral here
    /// @param collateralAmountToGetBack collateral amount to withdraw after close position
    function closeLongWithExactQuoteForUSDL(uint256, uint256 collateralAmountToGetBack) external override onlyUSDLemma {
        require(collateralAmountToGetBack > 0, "Amount should greater than zero");
        uint256 amountToWithdraw = getAmountInCollateralDecimalsForPerp(collateralAmountToGetBack, address(usdlCollateral), false);
        require(amountToWithdraw > 0, "Amount should greater than zero");
        _withdraw(amountToWithdraw, address(usdlCollateral));
        SafeERC20Upgradeable.safeTransfer(usdlCollateral, usdLemma, amountToWithdraw);
    }

    /// @notice Open short position for eth(quoteToken) on getCollateralAmountGivenUnderlyingAssetAmountForPerp first and deposit collateral here
    /// @param collateralAmountRequired collateral amount required to open the position
    function openLongWithExactBaseForSynth(uint256, uint256 collateralAmountRequired) external override onlyUSDLemma {
        require(collateralAmountRequired > 0, "Amount should greater than zero");
        uint256 collateralAmountToDeposit = getAmountInCollateralDecimalsForPerp(collateralAmountRequired, address(synthCollateral), false);
        require(collateralAmountToDeposit > 0, "Amount should greater than zero");
        require(synthCollateral.balanceOf(address(this)) >= collateralAmountToDeposit, "not enough collateral");
        _deposit(collateralAmountToDeposit, address(synthCollateral));
    }

    /// @notice Open long position for eth(quoteToken) on getCollateralAmountGivenUnderlyingAssetAmountForPerp first and withdraw collateral here
    /// @param collateralAmountToGetBack collateral amount to withdraw after close position
    function closeShortWithExactBaseForSynth(uint256, uint256 collateralAmountToGetBack) external override onlyUSDLemma {
        require(collateralAmountToGetBack > 0, "Amount should greater than zero");
        uint256 amountToWithdraw = getAmountInCollateralDecimalsForPerp(collateralAmountToGetBack, address(synthCollateral), false);
        require(amountToWithdraw > 0, "Amount should greater than zero");
        _withdraw(amountToWithdraw, address(synthCollateral));
        SafeERC20Upgradeable.safeTransfer(synthCollateral, usdLemma, amountToWithdraw);
    }

    /// METHODS WITH EXACT COLLATERAL FOR USDL Token(Base or Eth)
    /// 1). openShortWithExactCollateral
    /// 2). closeLongWithExactCollateral

    /// @notice Open short position for eth(baseToken) first and deposit collateral here
    /// @param collateralAmount collateral amount required to open the position
    function openShortWithExactCollateral(uint256 collateralAmount)
        external
        override
        onlyUSDLemma
        returns (uint256 USDLToMint)
    {
        require(!hasSettled, "Market Closed");
        uint256 collateralAmountToDeposit = getAmountInCollateralDecimalsForPerp(collateralAmount, address(usdlCollateral), false);
        require(collateralAmountToDeposit > 0, "Amount should greater than zero");
        require(
            usdlCollateral.balanceOf(address(this)) >= collateralAmountToDeposit,
            "Not enough collateral for openShortWithExactCollateral"
        );

        totalFundingPNL = getFundingPNL(usdlBaseTokenAddress);
        perpVault.deposit(address(usdlCollateral), collateralAmountToDeposit);

        // create long for usdc and short for eth position by giving isBaseToQuote=true
        // and amount in eth(baseToken) by giving isExactInput=true
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: usdlBaseTokenAddress,
            isBaseToQuote: true,
            isExactInput: true,
            amount: collateralAmount,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (, uint256 quote) = clearingHouse.openPosition(params);

        int256 positionSize = accountBalance.getTotalPositionSize(address(this), usdlBaseTokenAddress);
        require(positionSize.abs().toUint256() <= maxPosition, "max position reached");
        USDLToMint = quote;
    }

    // function openShortWithExactQuote(uint256 amount, uint256 collateralAmountRequired) external;
    // function closeLongWithExactQuote(uint256 amount, uint256 collateralAmountToGetBack) external;

    /// @notice Open long position for eth(baseToken) first and withdraw collateral here
    /// @param collateralAmount collateral amount require to close or long position
    function closeLongWithExactCollateral(uint256 collateralAmount)
        external
        override
        onlyUSDLemma
        returns (uint256 USDLToBurn)
    {
        if (hasSettled) return closeWExactCollateralAfterSettlementForUSDL(collateralAmount);

        totalFundingPNL = getFundingPNL(usdlBaseTokenAddress);

        //simillar to openWExactCollateral but for close
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: usdlBaseTokenAddress,
            isBaseToQuote: false,
            isExactInput: false,
            amount: collateralAmount,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (, uint256 quote) = clearingHouse.openPosition(params);
        USDLToBurn = quote;

        uint256 amountToWithdraw = getAmountInCollateralDecimalsForPerp(collateralAmount, address(usdlCollateral), false);
        require(amountToWithdraw > 0, "Amount should greater than zero");
        perpVault.withdraw(address(usdlCollateral), amountToWithdraw); // withdraw closed position fund
        SafeERC20Upgradeable.safeTransfer(usdlCollateral, usdLemma, amountToWithdraw);
    }

    /// METHODS WITH EXACT COLLATERAL FOR SyntheticToken(Base or Eth)
    /// 1). openLongWithExactCollateral
    /// 2). closeShortWithExactCollateral

    /// @notice Open short position for eth(quoteToken) first and deposit collateral here
    /// @param collateralAmount collateral amount required to open the position. amount is in vUSD(quoteToken)
    function openLongWithExactCollateral(uint256 collateralAmount)
        external
        override
        onlyUSDLemma
        returns (uint256 ETHLToMint)
    {
        require(!hasSettled, "Market Closed");
        uint256 collateralAmountToDeposit = getAmountInCollateralDecimalsForPerp(collateralAmount, address(synthCollateral), false);
        require(collateralAmountToDeposit > 0, "Amount should greater than zero");
        require(
            synthCollateral.balanceOf(address(this)) >= collateralAmountToDeposit,
            "Not enough collateral for openLongWithExactCollateral"
        );

        totalFundingPNL = getFundingPNL(synthBaseTokenAddress);
        perpVault.deposit(address(synthCollateral), collateralAmountToDeposit);

        // create long for usdc and short for eth position by giving isBaseToQuote=false
        // and amount in usdc(quoteToken) by giving isExactInput=true
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: synthBaseTokenAddress,
            isBaseToQuote: false,
            isExactInput: true,
            amount: collateralAmount,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (uint256 base, ) = clearingHouse.openPosition(params);

        int256 positionSize = accountBalance.getTotalPositionSize(address(this), synthBaseTokenAddress);
        require(positionSize.abs().toUint256() <= maxPosition, "max position reached");
        ETHLToMint = base;
    }

    /// @notice Open long position for eth(quoteToken) first and withdraw collateral here
    /// @param collateralAmount collateral amount require to close or long position. amount is in vUSD(quoteToken)
    function closeShortWithExactCollateral(uint256 collateralAmount)
        external
        override
        onlyUSDLemma
        returns (uint256 ETHLToBurn)
    {
        console.log('Hii', collateralAmount);
        if (hasSettled) return closeWExactETHLAfterSettlementForSynth(collateralAmount);

        totalFundingPNL = getFundingPNL(synthBaseTokenAddress);

        // simillar to openWExactCollateral but for close
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: synthBaseTokenAddress,
            isBaseToQuote: true,
            isExactInput: false,
            amount: collateralAmount,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (uint256 base, ) = clearingHouse.openPosition(params);
        ETHLToBurn = base;

        console.log('collateralAmount: ', collateralAmount);

        uint256 amountToWithdraw = getAmountInCollateralDecimalsForPerp(collateralAmount, address(synthCollateral), false);
        require(amountToWithdraw > 0, "Amount should greater than zero");
        console.log('amountToWithdraw: ', amountToWithdraw);
        perpVault.withdraw(address(synthCollateral), amountToWithdraw); // withdraw closed position fund
        SafeERC20Upgradeable.safeTransfer(synthCollateral, usdLemma, amountToWithdraw);
    }

    //// @notice when perpetual is in CLEARED state, withdraw the collateral
    function settle() public override {
        positionAtSettlementInQuoteForUSDL = accountBalance.getQuote(address(this), usdlBaseTokenAddress).abs().toUint256();
        // positionAtSettlementInQuoteForSynth = accountBalance.getQuote(address(this), synthBaseTokenAddress).abs().toUint256();

        // console.log('positionAtSettlementInQuoteForUSDL: ', positionAtSettlementInQuoteForUSDL);
        // console.log('positionAtSettlementInQuoteForSynth: ', positionAtSettlementInQuoteForSynth);

        // NOTE: This checks the market is in CLOSED state, otherwise reverts
        // NOTE: For some reason, the amountQuoteClosed < freeCollateral and freeCollateral is the max withdrawable for us so this is the one we want to use to withdraw
        
        if (usdlBaseTokenAddress != synthBaseTokenAddress) {
            clearingHouse.quitMarket(address(this), usdlBaseTokenAddress);
            clearingHouse.quitMarket(address(this), synthBaseTokenAddress);
        } else {
            clearingHouse.quitMarket(address(this), usdlBaseTokenAddress);
        }

        // NOTE: Settle pending funding rates
        settleAllFunding();

        // NOTE: This amount of free collateral is the one internally used to check for the V_NEFC error, so this is the max withdrawable
        uint256 freeCollateralUSDL = perpVault.getFreeCollateralByToken(address(this), address(usdlCollateral));
        positionAtSettlementInBaseForUSDL = freeCollateralUSDL;

        uint256 freeCollateralForSynth = perpVault.getFreeCollateralByToken(address(this), address(synthCollateral));
        positionAtSettlementInQuoteForSynth = freeCollateralForSynth;

        console.log('positionAtSettlementInBaseForUSDL: ', positionAtSettlementInBaseForUSDL);
        console.log('positionAtSettlementInQuoteForUSDL: ', positionAtSettlementInQuoteForUSDL);
        console.log('positionAtSettlementInQuoteForSynth: ', positionAtSettlementInQuoteForSynth);

        perpVault.withdraw(address(usdlCollateral), positionAtSettlementInBaseForUSDL);
        perpVault.withdraw(address(synthCollateral), positionAtSettlementInQuoteForSynth);

        // All the collateral is now back
        hasSettled = true;
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

        (uint160 _sqrtPriceLimitX96, uint256 _deadline, bool isUsdl) = abi.decode(data, (uint160, uint256, bool));

        bool _isBaseToQuote;
        bool _isExactInput;
        address baseTokenAddress;

        int256 fundingPNL = totalFundingPNL;
        if (isUsdl) {
            // only if USDL rebalance
            // If USDL rebalace happens then realizedFundingPNL will set before trade
            realizedFundingPNL += amount;

            baseTokenAddress = usdlBaseTokenAddress;
            if (amount < 0) {
                // open long position for eth and amount in vUSD
                _isBaseToQuote = false;
                _isExactInput = true;
            } else {
                // open short position for eth and amount in vUSD
                _isBaseToQuote = true;
                _isExactInput = false;
            }
        } else {
            // only if Synth rebalance
            baseTokenAddress = synthBaseTokenAddress;
            if (amount < 0) {
                // open short position for eth and amount in vETH
                _isBaseToQuote = true;
                _isExactInput = true;
            } else {
                // open long position for eth and amount in vETH
                _isBaseToQuote = false;
                _isExactInput = false;
            }
        }

        totalFundingPNL = getFundingPNL(baseTokenAddress);

        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: _isBaseToQuote,
            isExactInput: _isExactInput,
            amount: uint256(amount.abs()),
            oppositeAmountBound: 0,
            deadline: _deadline,
            sqrtPriceLimitX96: _sqrtPriceLimitX96,
            referralCode: referrerCode
        });
        (, uint256 quote) = clearingHouse.openPosition(params);

        if (!isUsdl) {
            // If Synth rebalace happens then realizedFundingPNL will set after trade
            if (amount < 0) {
                realizedFundingPNL -= int256(quote);
            } else {
                realizedFundingPNL += int256(quote);
            }
        }

        int256 difference = fundingPNL - realizedFundingPNL;
        // //error +-10**12 is allowed in calculation
        require(difference.abs() <= 10**12, "not allowed");
        return true;
    }
        
    /// @notice settleAllFunding will getPendingFundingPayment of perpLemma wrapper and then settle funding
    function settleAllFunding() public {
        totalFundingPNL = getFundingPNL(usdlBaseTokenAddress);
        totalFundingPNL = getFundingPNL(synthBaseTokenAddress);
        clearingHouse.settleAllFunding(address(this));
    }

    /// @notice Get funding PnL for this address till now
    /// @return fundingPNL Funding PnL accumulated till now
    function getFundingPNL(address baseTokenAddress) public view returns (int256 fundingPNL) {
        return totalFundingPNL + exchange.getPendingFundingPayment(address(this), baseTokenAddress);
    }

    /// @notice Get Amount in collateral decimals, provided amount is in 18 decimals
    /// @param amount Amount in 18 decimals
    /// @param roundUp If needs to round up
    /// @return decimal adjusted value
    function getAmountInCollateralDecimalsForPerp(uint256 amount, address collateral, bool roundUp) public view override returns (uint256) {
        uint256 collateralDecimals = IERC20Decimals(collateral).decimals();
        if (roundUp && (amount % (uint256(10**(18 - collateralDecimals))) != 0)) {
            return amount / uint256(10**(18 - collateralDecimals)) + 1; // need to verify
        }
        return amount / uint256(10**(18 - collateralDecimals));
    }

    /// INTERNAL METHODS

    /// @notice to deposit collateral in vault for short or open position
    function _deposit(uint256 collateralAmount, address collateral) internal {
        perpVault.deposit(collateral, collateralAmount);
    }

    /// @notice to withdrae collateral from vault after long or close position
    function _withdraw(uint256 amountToWithdraw, address collateral) internal {
        perpVault.withdraw(collateral, amountToWithdraw); // withdraw closed position fund
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
        uint256 amountCollateralToTransfer = getAmountInCollateralDecimalsForPerp(amountCollateralToTransfer1e_18, address(usdlCollateral), false);
        require(amountCollateralToTransfer > 0, "Amount should greater than zero");
        SafeERC20Upgradeable.safeTransfer(usdlCollateral, usdLemma, amountCollateralToTransfer);
        positionAtSettlementInQuoteForUSDL -= usdlAmount;
    }

    /// @notice closeWExactCollateralAfterSettlementForUSDL is use to distribute collateral using on pro rata based user's share(USDL).
    /// @param collateralAmount this method distribute collateral by exact collateral
    function closeWExactCollateralAfterSettlementForUSDL(uint256 collateralAmount) internal returns (uint256 USDLToBurn) {
        //No Position at settlement --> no more USDL to Burn
        require(positionAtSettlementInQuoteForUSDL > 0, "Settled vUSD position amount should not ZERO");
        //No collateral --> no more collateralt to give out
        require(usdlCollateral.balanceOf(address(this)) > 0, "Settled collateral amount should not ZERO");
        uint256 amountCollateralToTransfer = getAmountInCollateralDecimalsForPerp(collateralAmount, address(usdlCollateral), false);
        require(amountCollateralToTransfer > 0, "Amount should greater than zero");
        USDLToBurn = (amountCollateralToTransfer * positionAtSettlementInQuoteForUSDL) / usdlCollateral.balanceOf(address(this));
        SafeERC20Upgradeable.safeTransfer(usdlCollateral, usdLemma, amountCollateralToTransfer);
        positionAtSettlementInQuoteForUSDL -= USDLToBurn;
    }

    // Synth 
    /// @notice closeWExactETHLAfterSettlementForSynth is use to distribute collateral using on pro rata based user's share(ETHL).
    /// @param ethlAmount this method distribute collateral by exact ethlAmount
    function closeWExactETHLAfterSettlementForSynth(uint256 ethlAmount) internal returns (uint256 ETHLToBurn) {
        console.log('hi1');
        // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more ETHL to Burn
        require(positionAtSettlementInQuoteForSynth > 0, "WPL_NP");
        // WPL_NC : Wrapper PerpLemma, No Collateral
        require(synthCollateral.balanceOf(address(this)) > 0, "WPL_NC");
        ethlAmount = getAmountInCollateralDecimalsForPerp(ethlAmount, address(synthCollateral), false);
        uint256 amountCollateralToTransfer = (ethlAmount * synthCollateral.balanceOf(address(this))) /
            positionAtSettlementInQuoteForSynth;
        console.log('amountCollateralToTransfer', amountCollateralToTransfer);
        console.log('ethlAmount', ethlAmount, synthCollateral.balanceOf(address(this)), positionAtSettlementInQuoteForSynth);
        SafeERC20Upgradeable.safeTransfer(synthCollateral, usdLemma, amountCollateralToTransfer);
        positionAtSettlementInQuoteForSynth -= ethlAmount;
        ETHLToBurn = ethlAmount;
    }

    /// @notice closeWExactCollateralAfterSettlementForSynth is use to distribute collateral using on pro rata based user's share(ETHL).
    /// @param collateralAmount this method distribute collateral by exact collateral
    function closeWExactCollateralAfterSettlementForSynth(uint256 collateralAmount) internal returns (uint256 ETHLToBurn) {
        // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more ETHL to Burn
        require(positionAtSettlementInQuoteForSynth > 0, "WPL_NP");
        // WPL_NC : Wrapper PerpLemma, No Collateral
        require(synthCollateral.balanceOf(address(this)) > 0, "WPL_NC");
        uint256 amountCollateralToTransfer = getAmountInCollateralDecimalsForPerp(collateralAmount, address(synthCollateral), false);
        ETHLToBurn = (amountCollateralToTransfer * positionAtSettlementInQuoteForSynth) / synthCollateral.balanceOf(address(this));
        SafeERC20Upgradeable.safeTransfer(synthCollateral, usdLemma, amountCollateralToTransfer);
        positionAtSettlementInQuoteForSynth -= ETHLToBurn;
    }

    /// @notice convert provided amount is in 18 decimals
    /// @param amount need to convert in 18 decimals
    function convert1e_18(uint256 amount, address collateral) internal view returns (uint256) {
        uint256 collateralDecimals = IERC20Decimals(collateral).decimals();
        return amount = (amount * (10**18)) / (10**collateralDecimals);
    }

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

    // NOT IMPLEMENTED

    function getCollateralAmountGivenUnderlyingAssetAmount(uint256, bool)
        public
        override
        returns (uint256) {
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

    function getAmountInCollateralDecimals(uint256, bool) public override pure returns (uint256) {
        revert("not supported");
    }
}
