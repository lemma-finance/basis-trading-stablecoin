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

interface IUSDLemma {
    function lemmaTreasury() external view returns (address);
}

contract PerpLemma is OwnableUpgradeable, ERC2771ContextUpgradeable, IPerpetualDEXWrapper {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using Utils for int256;
    using SafeMathExt for int256;

    uint256 public constant MAX_UINT256 = type(uint256).max;
    uint256 public constant HUNDREAD_PERCENT = 1e6; // 100%

    address public usdLemma;
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
    // NOTE: This should be equal to the amount of USDL minted depositing on that dexIndex
    uint256 public positionAtSettlementInQuote;
    uint256 public positionAtSettlementInBase;

    uint256 public maxPosition;
    int256 public totalFundingPNL;
    int256 public realizedFundingPNL;

    // Has the Market Settled
    bool public hasSettled;

    //events
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
        address _collateral,
        address _baseToken,
        address _clearingHouse,
        address _marketRegistry,
        address _usdLemma,
        uint256 _maxPosition
    ) external initializer {
        __Ownable_init();
        __ERC2771Context_init(_trustedForwarder);

        require(_baseToken != address(0), "!baseToken");
        require(_clearingHouse != address(0), "!clearingHouse");
        require(_marketRegistry != address(0), "marketRegistry");

        usdLemma = _usdLemma;
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

    function getFees(bool isMinting) external view override returns (uint256) {
        IMarketRegistry.MarketInfo memory marketInfo = marketRegistry.getMarketInfo(baseTokenAddress);
        return marketInfo.exchangeFeeRatio;
    }

    ///@notice sets USDLemma address - only owner can set
    ///@param _usdLemma USDLemma address to set
    function setUSDLemma(address _usdLemma) external onlyOwner {
        require(_usdLemma != address(0), "!usdLemma");
        usdLemma = _usdLemma;
        emit USDLemmaUpdated(usdLemma);
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

    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 usdlToMintOrBurn, bool isLong)
        external
        override
        onlyUSDLemma
        returns (uint256 base)
    {
        bool _isBaseToQuote;
        bool _isExactInput;
        if (isLong) {
            _isBaseToQuote = false;
            _isExactInput = false;
        } else {
            _isBaseToQuote = true;
            _isExactInput = true;
            if (hasSettled) return closeWExactUSDLAfterSettlement(usdlToMintOrBurn);
        }
        totalFundingPNL = getFundingPNL();
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: _isBaseToQuote,
            isExactInput: _isExactInput,
            amount: usdlToMintOrBurn,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (base, ) = clearingHouse.openPosition(params);
    }

    /// @notice Open short position for eth(quoteToken) on getCollateralAmountGivenUnderlyingAssetAmount first and deposit collateral here
    /// @param collateralAmountRequired collateral amount required to open the position
    function open(uint256, uint256 collateralAmountRequired) external override onlyUSDLemma {
        require(collateralAmountRequired > 0, "Amount should greater than zero");
        uint256 collateralAmountToDeposit = getAmountInCollateralDecimals(collateralAmountRequired, true);
        require(collateral.balanceOf(address(this)) >= collateralAmountToDeposit, "not enough collateral");
        _deposit(collateralAmountToDeposit);
    }

    /// @notice Open short position for eth(quoteToken) first and deposit collateral here
    /// @param collateralAmount collateral amount required to open the position
    function openWExactCollateral(uint256 collateralAmount)
        external
        override
        onlyUSDLemma
        returns (uint256 USDLToMint)
    {
        require(!hasSettled, "Market Closed");
        uint256 collateralAmountToDeposit = getAmountInCollateralDecimals(collateralAmount, true);
        require(collateral.balanceOf(address(this)) >= collateralAmountToDeposit, "not enough collateral");

        totalFundingPNL = getFundingPNL();
        perpVault.deposit(address(collateral), collateralAmountToDeposit);
        collateralAmountToDeposit = convert1e_18(collateralAmountToDeposit); // because vToken alsways in 18 decimals

        // create long for usdc and short for eth position by giving isBaseToQuote=false
        // and amount in eth(quoteToken) by giving isExactInput=true
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: false,
            isExactInput: true,
            amount: collateralAmountToDeposit,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (uint256 base, uint256 quote) = clearingHouse.openPosition(params);

        int256 positionSize = accountBalance.getTotalPositionSize(address(this), baseTokenAddress);
        require(positionSize.abs().toUint256() <= maxPosition, "max position reached");
        USDLToMint = quote;
    }

    /// @notice Open long position for eth(quoteToken) on getCollateralAmountGivenUnderlyingAssetAmount first and withdraw collateral here
    /// @param collateralAmountToGetBack collateral amount to withdraw after close position
    function close(uint256, uint256 collateralAmountToGetBack) external override onlyUSDLemma {
        require(collateralAmountToGetBack > 0, "Amount should greater than zero");
        uint256 amountToWithdraw = getAmountInCollateralDecimals(collateralAmountToGetBack, false);
        _withdraw(amountToWithdraw);
        SafeERC20Upgradeable.safeTransfer(collateral, usdLemma, amountToWithdraw);
    }

    /// @notice Open long position for eth(quoteToken) first and withdraw collateral here
    /// @param collateralAmount collateral amount require to close or long position
    function closeWExactCollateral(uint256 collateralAmount)
        external
        override
        onlyUSDLemma
        returns (uint256 USDLToBurn)
    {
        if (hasSettled) return closeWExactCollateralAfterSettlement(collateralAmount);

        totalFundingPNL = getFundingPNL();
        uint256 collateralAmountToClose = convert1e_18(collateralAmount); // because vToken alsways in 18 decimals

        //simillar to openWExactCollateral but for close
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: true,
            isExactInput: false,
            amount: collateralAmountToClose,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (uint256 base, uint256 quote) = clearingHouse.openPosition(params);
        USDLToBurn = quote;

        uint256 amountToWithdraw = getAmountInCollateralDecimals(collateralAmount, false);
        perpVault.withdraw(address(collateral), amountToWithdraw); // withdraw closed position fund
        SafeERC20Upgradeable.safeTransfer(collateral, usdLemma, amountToWithdraw);
    }

    /// @notice closeWExactUSDLAfterSettlement is use to distribute collateral using on pro rata based user's share(USDL).
    /// @param usdlAmount this method distribute collateral by exact usdlAmount
    function closeWExactUSDLAfterSettlement(uint256 usdlAmount) internal returns (uint256 USDLToBurn) {
        // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more USDL to Burn
        require(positionAtSettlementInQuote > 0, "WPL_NP");
        // WPL_NC : Wrapper PerpLemma, No Collateral
        require(collateral.balanceOf(address(this)) > 0, "WPL_NC");
        uint256 amountCollateralToTransfer = (usdlAmount * collateral.balanceOf(address(this))) /
            positionAtSettlementInQuote;
        amountCollateralToTransfer = getAmountInCollateralDecimals(amountCollateralToTransfer, true);
        SafeERC20Upgradeable.safeTransfer(collateral, usdLemma, amountCollateralToTransfer);
        positionAtSettlementInQuote -= usdlAmount;
        USDLToBurn = usdlAmount;
    }

    /// @notice closeWExactCollateralAfterSettlement is use to distribute collateral using on pro rata based user's share(USDL).
    /// @param collateralAmount this method distribute collateral by exact collateral
    function closeWExactCollateralAfterSettlement(uint256 collateralAmount) internal returns (uint256 USDLToBurn) {
        // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more USDL to Burn
        require(positionAtSettlementInQuote > 0, "WPL_NP");
        // WPL_NC : Wrapper PerpLemma, No Collateral
        require(collateral.balanceOf(address(this)) > 0, "WPL_NC");
        uint256 amountCollateralToTransfer = getAmountInCollateralDecimals(collateralAmount, true);
        USDLToBurn = (amountCollateralToTransfer * positionAtSettlementInQuote) / collateral.balanceOf(address(this));
        SafeERC20Upgradeable.safeTransfer(collateral, usdLemma, amountCollateralToTransfer);
        positionAtSettlementInQuote -= USDLToBurn;
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

        (uint160 _sqrtPriceLimitX96, uint256 _deadline) = abi.decode(data, (uint160, uint256));

        bool _isBaseToQuote;
        bool _isExactInput;

        realizedFundingPNL += amount;
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
        //error +-10**12 is allowed in calculation
        require(difference.abs() <= 10**12, "not allowed");

        return true;
    }

    /// @notice settleAllFunding will getPendingFundingPayment of perpLemma wrapper and then settle funding
    function settleAllFunding() public {
        totalFundingPNL = getFundingPNL();
        clearingHouse.settleAllFunding(address(this));
    }

    /// @notice Get Amount in collateral decimals, provided amount is in 18 decimals
    /// @param amount Amount in 18 decimals
    /// @param roundUp If needs to round up
    /// @return decimal adjusted value
    function getAmountInCollateralDecimals(uint256 amount, bool roundUp) public view override returns (uint256) {
        amount = convert1e_18(amount); // convert first into 18 decimals before any OPs
        if (roundUp && (amount % (uint256(10**(18 - collateralDecimals))) != 0)) {
            return amount / uint256(10**(18 - collateralDecimals)) + 1; // need to verify
        }
        return amount / uint256(10**(18 - collateralDecimals));
    }

    /// @notice convert provided amount is in 18 decimals
    /// @param amount need to convert in 18 decimals
    function convert1e_18(uint256 amount) public view returns (uint256) {
        return amount = (amount * (10**18)) / (10**collateralDecimals);
    }

    /// @notice getTotalPosition in terms of quoteToken(in our case eth)
    function getTotalPosition() external view override returns (int256) {
        return accountBalance.getTotalPositionValue(address(this), baseTokenAddress);
    }

    /// @notice Get funding PnL for this address till now
    /// @return fundingPNL Funding PnL accumulated till now
    function getFundingPNL() public view returns (int256 fundingPNL) {
        return totalFundingPNL + exchange.getPendingFundingPayment(address(this), baseTokenAddress);
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

    /// @notice to deposit collateral in vault for short or open position
    function _deposit(uint256 collateralAmount) internal {
        perpVault.deposit(address(collateral), collateralAmount);
    }

    /// @notice to withdrae collateral from vault after long or close position
    function _withdraw(uint256 amountToWithdraw) internal {
        perpVault.withdraw(address(collateral), amountToWithdraw); // withdraw closed position fund
    }
}
