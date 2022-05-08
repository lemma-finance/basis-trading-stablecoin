// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { IPerpetualDEXWrapper } from "../interfaces/IPerpetualDEXWrapper.sol";
import { Utils } from "../libraries/Utils.sol";
import { SafeMathExt } from "../libraries/SafeMathExt.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../libraries/TransferHelper.sol";
import "../interfaces/Perpetual/IClearingHouse.sol";
import "../interfaces/Perpetual/IClearingHouseConfig.sol";
import "../interfaces/Perpetual/IAccountBalance.sol";
import "../interfaces/Perpetual/IMarketRegistry.sol";
import "../interfaces/Perpetual/IExchange.sol";
import "hardhat/console.sol";

interface IERC20Decimals is IERC20Upgradeable {
    function decimals() external view returns (uint8);
}

interface IPerpVault {
    function deposit(address token, uint256 amount) external;

    function withdraw(address token, uint256 amountX10_D) external;

    function getBalance(address trader) external view returns (int256);

    function decimals() external view returns (uint8);

    function getSettlementToken() external view returns (address settlementToken);

    function getFreeCollateral(address trader) external view returns (uint256);

    function getFreeCollateralByRatio(address trader, uint24 ratio)
        external
        view
        returns (int256 freeCollateralByRatio);

    function getFreeCollateralByToken(address trader, address token) external view returns (uint256);
}

interface ILemmaETH {
    function lemmaTreasury() external view returns (address);
}

contract PerpLemma is OwnableUpgradeable, ERC2771ContextUpgradeable, IPerpetualDEXWrapper {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using Utils for int256;
    using SafeMathExt for int256;

    uint256 public constant MAX_UINT256 = type(uint256).max;
    uint256 public constant HUNDREAD_PERCENT = 1e6; // 100%

    address public lemmaEth;
    address public reBalancer;
    address public baseTokenAddress;
    bytes32 public referrerCode;

    IClearingHouse public clearingHouse;
    IClearingHouseConfig public clearingHouseConfig;
    IPerpVault public perpVault;
    IAccountBalance public accountBalance;
    IMarketRegistry public marketRegistry;
    IExchange public exchange;
    IERC20Decimals public collateral;

    uint256 public collateralDecimals;

    // Gets set only when Settlement has already happened
    // NOTE: This should be equal to the amount of ETHL minted depositing on that dexIndex
    uint256 public positionAtSettlementInQuote;
    uint256 public positionAtSettlementInBase;

    uint256 public maxPosition;
    int256 public totalFundingPNL;
    int256 public realizedFundingPNL;

    // Has the Market Settled
    bool public hasSettled;

    //events
    event LemmaETHUpdated(address lemmaEthAddress);
    event ReferrerUpdated(bytes32 referrerCode);
    event RebalancerUpdated(address rebalancerAddress);
    event MaxPositionUpdated(uint256 maxPos);

    modifier onlyLemmaEth() {
        require(msg.sender == lemmaEth, "only lemmaEth is allowed");
        _;
    }

    function initialize(
        address _trustedForwarder,
        address _baseToken,
        address _clearingHouse,
        address _marketRegistry,
        address _lemmaEth,
        uint256 _maxPosition
    ) external initializer {
        __Ownable_init();
        __ERC2771Context_init(_trustedForwarder);

        require(_baseToken != address(0), "!baseToken");
        require(_clearingHouse != address(0), "!clearingHouse");
        require(_marketRegistry != address(0), "marketRegistry");

        lemmaEth = _lemmaEth;
        maxPosition = _maxPosition;
        baseTokenAddress = _baseToken;

        clearingHouse = IClearingHouse(_clearingHouse);
        clearingHouseConfig = IClearingHouseConfig(clearingHouse.getClearingHouseConfig());
        perpVault = IPerpVault(clearingHouse.getVault());
        exchange = IExchange(clearingHouse.getExchange());
        accountBalance = IAccountBalance(clearingHouse.getAccountBalance());

        marketRegistry = IMarketRegistry(_marketRegistry);

        collateral = IERC20Decimals(perpVault.getSettlementToken());
        collateralDecimals = collateral.decimals(); // need to verify
        collateral.approve(_clearingHouse, MAX_UINT256);

        // NOTE: Even though it is not necessary, it is for clarity
        hasSettled = false;

        SafeERC20Upgradeable.safeApprove(collateral, address(perpVault), MAX_UINT256);
    }

    /// @notice getFees fees charge by perpV2 protocol for each trade
    function getFees() external view override returns (uint256) {
        IMarketRegistry.MarketInfo memory marketInfo = marketRegistry.getMarketInfo(baseTokenAddress);
        return marketInfo.exchangeFeeRatio;
    }

    /// @notice getTotalPosition in terms of quoteToken(in our case eth)
    function getTotalPosition() external view override returns (int256) {
        return accountBalance.getTotalPositionValue(address(this), baseTokenAddress);
    }

    ///@notice sets LemmaETH address - only owner can set
    ///@param _lemmaEth LemmaETH address to set
    function setLemmaEth(address _lemmaEth) external onlyOwner {
        require(_lemmaEth != address(0), "!lemmaEth");
        lemmaEth = _lemmaEth;
        emit LemmaETHUpdated(lemmaEth);
    }

    ///@notice sets refferer address - only owner can set
    ///@param _referrerCode referrerCode of address to set
    function setReferrerCode(bytes32 _referrerCode) external onlyOwner {
        referrerCode = _referrerCode;
        emit ReferrerUpdated(referrerCode);
    }

    ///@notice sets reBalncer address - only owner can set
    ///@param _reBalancer reBalancer address to set
    function setReBalancer(address _reBalancer) external onlyOwner {
        require(_reBalancer != address(0), "!reBalancer");
        reBalancer = _reBalancer;
        emit RebalancerUpdated(reBalancer);
    }

    ///@param _maxPosition reBalancer address to set
    function setMaxPosition(uint256 _maxPosition) external onlyOwner {
        maxPosition = _maxPosition;
        emit MaxPositionUpdated(maxPosition);
    }

    /// @notice reset approvals
    function resetApprovals() external {
        SafeERC20Upgradeable.safeApprove(collateral, address(perpVault), 0);
        SafeERC20Upgradeable.safeApprove(collateral, address(perpVault), MAX_UINT256);
    }

    /// METHODS WITH EXACT ETH or vETH(base or vETH)
    /// 1). getCollateralAmountGivenUnderlyingAssetAmount and open
    /// 2). getCollateralAmountGivenUnderlyingAssetAmount and close

    /// @notice getCollateralAmountGivenUnderlyingAssetAmount will create long or short position and give quote(usdcCollateral need to deposit or withdraw into clearingHpuse)
    /// @notice after this function it will call open() or close() position in same transacction by LemmaETH contract
    /// @param ethCollateral is for exact amount of ETHL will use to create a short or long position instead ethCollateral
    /// @param isLong is bool for need to do short or long
    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 ethCollateral, bool isLong)
        external
        override
        onlyLemmaEth
        returns (uint256 quote)
    {
        bool _isBaseToQuote;
        bool _isExactInput;
        if (isLong) {
            _isBaseToQuote = false;
            _isExactInput = false;
        } else {
            _isBaseToQuote = true;
            _isExactInput = true;
            if (hasSettled) return closeWExactCollateralAfterSettlement(ethCollateral);
        }
        totalFundingPNL = getFundingPNL();
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: _isBaseToQuote,
            isExactInput: _isExactInput,
            amount: ethCollateral,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (, quote) = clearingHouse.openPosition(params);
    }

    /// @notice Open short position for eth(quoteToken) on getCollateralAmountGivenUnderlyingAssetAmount first and deposit collateral here
    /// @param collateralAmountRequired collateral amount required to open the position
    function open(uint256, uint256 collateralAmountRequired) external override onlyLemmaEth {
        require(collateralAmountRequired > 0, "Amount should greater than zero");
        uint256 collateralAmountToDeposit = getAmountInCollateralDecimals(collateralAmountRequired, false);
        require(collateralAmountToDeposit > 0, "Amount should greater than zero");
        require(collateral.balanceOf(address(this)) >= collateralAmountToDeposit, "not enough collateral");
        _deposit(collateralAmountToDeposit);
    }

    /// @notice Open long position for eth(quoteToken) on getCollateralAmountGivenUnderlyingAssetAmount first and withdraw collateral here
    /// @param collateralAmountToGetBack collateral amount to withdraw after close position
    function close(uint256, uint256 collateralAmountToGetBack) external override onlyLemmaEth {
        require(collateralAmountToGetBack > 0, "Amount should greater than zero");
        uint256 amountToWithdraw = getAmountInCollateralDecimals(collateralAmountToGetBack, false);
        require(amountToWithdraw > 0, "Amount should greater than zero");
        _withdraw(amountToWithdraw);
        SafeERC20Upgradeable.safeTransfer(collateral, lemmaEth, amountToWithdraw);
    }

    /// @notice Open short position for eth(quoteToken) first and deposit collateral here
    /// @param collateralAmount collateral amount required to open the position. amount is in vUSD(quoteToken)
    function openWExactCollateral(uint256 collateralAmount)
        external
        override
        onlyLemmaEth
        returns (uint256 ETHLToMint)
    {
        require(!hasSettled, "Market Closed");
        uint256 collateralAmountToDeposit = getAmountInCollateralDecimals(collateralAmount, false);
        require(collateralAmountToDeposit > 0, "Amount should greater than zero");
        require(
            collateral.balanceOf(address(this)) >= collateralAmountToDeposit,
            "Not enough collateral for openWExactCollateral"
        );

        totalFundingPNL = getFundingPNL();
        perpVault.deposit(address(collateral), collateralAmountToDeposit);

        // create long for usdc and short for eth position by giving isBaseToQuote=false
        // and amount in usdc(quoteToken) by giving isExactInput=true
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: false,
            isExactInput: true,
            amount: collateralAmount,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (uint256 base, ) = clearingHouse.openPosition(params);

        int256 positionSize = accountBalance.getTotalPositionSize(address(this), baseTokenAddress);
        require(positionSize.abs().toUint256() <= maxPosition, "max position reached");
        ETHLToMint = base;
    }

    /// @notice Open long position for eth(quoteToken) first and withdraw collateral here
    /// @param collateralAmount collateral amount require to close or long position. amount is in vUSD(quoteToken)
    function closeWExactCollateral(uint256 collateralAmount)
        external
        override
        onlyLemmaEth
        returns (uint256 ETHLToBurn)
    {
        if (hasSettled) return closeWExactETHLAfterSettlement(collateralAmount);

        totalFundingPNL = getFundingPNL();

        // simillar to openWExactCollateral but for close
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
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

        uint256 amountToWithdraw = getAmountInCollateralDecimals(collateralAmount, false);
        require(amountToWithdraw > 0, "Amount should greater than zero");
        perpVault.withdraw(address(collateral), amountToWithdraw); // withdraw closed position fund
        SafeERC20Upgradeable.safeTransfer(collateral, lemmaEth, amountToWithdraw);
    }

    //// @notice when perpetual is in CLEARED state, withdraw the collateral
    function settle() public override {
        // NOTE: This checks the market is in CLOSED state, otherwise revenrts
        // NOTE: For some reason, the amountQuoteClosed < freeCollateral and freeCollateral is the max withdrawable for us so this is the one we want to use to withdraw
        (uint256 amountBaseClosed, uint256 amountQuoteClosed) = clearingHouse.quitMarket(
            address(this),
            baseTokenAddress
        );
        // NOTE: Settle pending funding rates
        settleAllFunding();

        // NOTE: This amount of free collateral is the one internally used to check for the V_NEFC error, so this is the max withdrawable
        positionAtSettlementInQuote = perpVault.getFreeCollateralByToken(address(this), address(collateral));
        perpVault.withdraw(address(collateral), positionAtSettlementInQuote);
        // All the collateral is now back
        hasSettled = true;
    }

    /// @notice Rebalance position of dex based on accumulated funding, since last rebalancing
    /// @param _reBalancer Address of rebalancer who called function on ETHL contract
    /// @param amount Amount of accumulated funding fees used to rebalance by opening or closing a short position
    /// NOTE: amount will be in vETH or as baseToken
    /// @param data Abi encoded data to call respective perpetual function, contains limitPrice, deadline and fundingPNL(while calling rebalance)
    /// @return True if successful, False if unsuccessful
    function reBalance(
        address _reBalancer,
        int256 amount,
        bytes calldata data
    ) external override onlyLemmaEth returns (bool) {
        require(_reBalancer == reBalancer, "only rebalancer is allowed");

        (uint160 _sqrtPriceLimitX96, uint256 _deadline) = abi.decode(data, (uint160, uint256));

        bool _isBaseToQuote;
        bool _isExactInput;

        if (amount < 0) {
            // open short position for eth and amount in vETH
            _isBaseToQuote = true;
            _isExactInput = true;
        } else {
            // open long position for eth and amount in vETH
            _isBaseToQuote = false;
            _isExactInput = false;
        }
        int256 fundingPNL = totalFundingPNL;
        totalFundingPNL = getFundingPNL();

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

        if (amount < 0) {
            realizedFundingPNL -= int256(quote);
        } else {
            realizedFundingPNL += int256(quote);
        }

        int256 difference = fundingPNL - realizedFundingPNL;
        // //error +-10**12 is allowed in calculation
        require(difference.abs() <= 10**12, "not allowed");
        return true;
    }

    /// @notice settleAllFunding will getPendingFundingPayment of perpLemma wrapper and then settle funding
    function settleAllFunding() public {
        totalFundingPNL = getFundingPNL();
        clearingHouse.settleAllFunding(address(this));
    }

    /// @notice Get funding PnL for this address till now
    /// @return fundingPNL Funding PnL accumulated till now
    function getFundingPNL() public view returns (int256 fundingPNL) {
        return totalFundingPNL + exchange.getPendingFundingPayment(address(this), baseTokenAddress);
    }

    /// @notice Get Amount in collateral decimals, provided amount is in 18 decimals
    /// @param amount Amount in 18 decimals
    /// @param roundUp If needs to round up
    /// @return decimal adjusted value
    function getAmountInCollateralDecimals(uint256 amount, bool roundUp) public view override returns (uint256) {
        if (roundUp && (amount % (uint256(10**(18 - collateralDecimals))) != 0)) {
            return amount / uint256(10**(18 - collateralDecimals)) + 1; // need to verify
        }
        return amount / uint256(10**(18 - collateralDecimals));
    }

    /// INTERNAL METHODS

    /// @notice to deposit collateral in vault for short or open position
    function _deposit(uint256 collateralAmount) internal {
        perpVault.deposit(address(collateral), collateralAmount);
    }

    /// @notice to withdrae collateral from vault after long or close position
    function _withdraw(uint256 amountToWithdraw) internal {
        perpVault.withdraw(address(collateral), amountToWithdraw); // withdraw closed position fund
    }

    /// @notice closeWExactETHLAfterSettlement is use to distribute collateral using on pro rata based user's share(ETHL).
    /// @param ethlAmount this method distribute collateral by exact ethlAmount
    function closeWExactETHLAfterSettlement(uint256 ethlAmount) internal returns (uint256 ETHLToBurn) {
        // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more ETHL to Burn
        require(positionAtSettlementInQuote > 0, "WPL_NP");
        // WPL_NC : Wrapper PerpLemma, No Collateral
        require(collateral.balanceOf(address(this)) > 0, "WPL_NC");
        ethlAmount = getAmountInCollateralDecimals(ethlAmount, false);
        uint256 amountCollateralToTransfer = (ethlAmount * collateral.balanceOf(address(this))) /
            positionAtSettlementInQuote;
        SafeERC20Upgradeable.safeTransfer(collateral, lemmaEth, amountCollateralToTransfer);
        positionAtSettlementInQuote -= ethlAmount;
        ETHLToBurn = ethlAmount;
    }

    /// @notice closeWExactCollateralAfterSettlement is use to distribute collateral using on pro rata based user's share(ETHL).
    /// @param collateralAmount this method distribute collateral by exact collateral
    function closeWExactCollateralAfterSettlement(uint256 collateralAmount) internal returns (uint256 ETHLToBurn) {
        // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more ETHL to Burn
        require(positionAtSettlementInQuote > 0, "WPL_NP");
        // WPL_NC : Wrapper PerpLemma, No Collateral
        require(collateral.balanceOf(address(this)) > 0, "WPL_NC");
        uint256 amountCollateralToTransfer = getAmountInCollateralDecimals(collateralAmount, false);
        ETHLToBurn = (amountCollateralToTransfer * positionAtSettlementInQuote) / collateral.balanceOf(address(this));
        SafeERC20Upgradeable.safeTransfer(collateral, lemmaEth, amountCollateralToTransfer);
        positionAtSettlementInQuote -= ETHLToBurn;
    }

    function _msgSender()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        //ERC2771ContextUpgradeable._msgSender();
        return super._msgSender();
    }

    function _msgData()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata)
    {
        //ERC2771ContextUpgradeable._msgData();
        return super._msgData();
    }
}
