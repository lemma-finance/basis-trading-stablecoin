// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;

import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { IPerpetualDEXWrapper } from "../interfaces/IPerpetualDEXWrapper.sol";
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

// NOTE
// The goal is to change the perpLemma.sol implementation to adapt it to the tail asset case 
// The only things that changes is the tail asset can't be deposited in Perp as collateral for the short, so we proceed as follows 
// - the tail assets is stored in this contract Balance Sheet 
// - we assume there is enough USDC deposited in Perp to bback our increase short trades 
// - when short is increased, we just keep the posted tail asset in this contract balance sheet and do the usual Perp trade 
// - when short is deceased, we return the tail asset from this contract balance sheet and do the usual Perp trade
// 
// 
// Implementation details 
// - baseToken remains the same since it is used to identify the market = pool where the trade happens  

contract PerpLemmaTail is OwnableUpgradeable, ERC2771ContextUpgradeable, IPerpetualDEXWrapper {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using Utils for int256;
    using SafeMathExt for int256;

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

    // NOTE: In perpLemma.sol we have collateral = non-tail asset, while here we have collateral != tail asset
    IERC20Decimals public collateral;               // NOTE: When instantiated, this has to be USDC ! 
    IERC20Decimals public tailAsset;                // NOTE: When instantiated, this is the Tail Asset !  
    IERC20Decimals public usdc;

    uint256 public constant MAX_UINT256 = type(uint256).max;
    uint256 public maxPosition;
    uint256 public collateralDecimals;

    // Gets set only when Settlement has already happened
    // NOTE: This should be equal to the amount of USDL minted depositing on that dexIndex
    uint256 public positionAtSettlementInQuote;
    uint256 public positionAtSettlementInBase;

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
        address _collateral,
        address _tailAsset,
        address _baseToken,
        address _clearingHouse,
        address _marketRegistry,
        address _usdLemma,
        uint256 _maxPosition
    ) external initializer {
        __Ownable_init();
        __ERC2771Context_init(_trustedForwarder);

        require(_baseToken != address(0), "BaseToken should not ZERO address");
        require(_clearingHouse != address(0), "ClearingHouse should not ZERO address");
        require(_marketRegistry != address(0), "MarketRegistry should not ZERO address");

        usdLemma = _usdLemma;
        maxPosition = _maxPosition;
        baseTokenAddress = _baseToken;

        clearingHouse = IClearingHouse(_clearingHouse);
        clearingHouseConfig = IClearingHouseConfig(clearingHouse.getClearingHouseConfig());
        perpVault = IPerpVault(clearingHouse.getVault());
        exchange = IExchange(clearingHouse.getExchange());
        accountBalance = IAccountBalance(clearingHouse.getAccountBalance());

        marketRegistry = IMarketRegistry(_marketRegistry);

        usdc = IERC20Decimals(perpVault.getSettlementToken());
        collateral = IERC20Decimals(_collateral);
        collateralDecimals = collateral.decimals(); // need to verify
        collateral.approve(_clearingHouse, MAX_UINT256);

        tailAsset = IERC20Decimals(_tailAsset);

        // NOTE: Even though it is not necessary, it is for clarity
        hasSettled = false;

        SafeERC20Upgradeable.safeApprove(collateral, address(perpVault), MAX_UINT256);
        SafeERC20Upgradeable.safeApprove(usdc, address(perpVault), MAX_UINT256);
    }

    /// @notice getFees fees charge by perpV2 protocol for each trade
    function getFees() external view override returns (uint256) {
        IMarketRegistry.MarketInfo memory marketInfo = marketRegistry.getMarketInfo(baseTokenAddress);
        return marketInfo.exchangeFeeRatio;
    }

    /// @notice getTotalPosition in terms of quoteToken(in our case vUSD)
    function getTotalPosition() external view override returns (int256) {
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
        // NOTE: No need for the tail asset to approve the perpVault since it can't be deposited
        // SafeERC20Upgradeable.safeApprove(collateral, address(perpVault), 0);
        // SafeERC20Upgradeable.safeApprove(collateral, address(perpVault), MAX_UINT256);
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
    /// 1). getCollateralAmountGivenUnderlyingAssetAmount and open
    /// 2). getCollateralAmountGivenUnderlyingAssetAmount and close

    /// @notice getCollateralAmountGivenUnderlyingAssetAmount will create short or long position and give base(ethCollateral need to eposit or withdraw into clearingHpuse)
    /// @notice after this function it will call open() or close() position in same transacction by USDLemma contract
    /// @param usdlToMintOrBurn is for exact amount of USDL will use to create a short or long position instead ethCollateral
    /// @param isShorting is bool for need to do short or long
    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 usdlToMintOrBurn, bool isShorting)
        external
        override
        onlyUSDLemma
        returns (uint256 base)
    {
        bool _isBaseToQuote;
        bool _isExactInput;
        if (isShorting) {
            // open short position for eth and amount in vUSD
            _isBaseToQuote = true;
            _isExactInput = false;
        } else {
            // open long position for eth and amount in vUSD
            _isBaseToQuote = false;
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

    /// @notice Open short position for eth(baseToken) on getCollateralAmountGivenUnderlyingAssetAmount first using exact amount of USDL(or vUSD you can say) and deposit collateral here
    /// @param collateralAmountRequired collateral amount required to open the position
    function open(uint256, uint256 collateralAmountRequired) external override onlyUSDLemma {
        require(collateralAmountRequired > 0, "Amount should greater than zero");
        uint256 collateralAmountToDeposit = getAmountInCollateralDecimals(collateralAmountRequired, false);
        require(collateralAmountToDeposit > 0, "Amount should greater than zero");
        require(collateral.balanceOf(address(this)) >= collateralAmountToDeposit, "Not enough collateral to Open");
        _deposit(collateralAmountToDeposit);
    }

    /// @notice Open long position for eth(baseToken) on getCollateralAmountGivenUnderlyingAssetAmount first using exact amount of USDL(or vUSD you can say) and withdraw collateral here
    /// @param collateralAmountToGetBack collateral amount to withdraw after close position
    function close(uint256, uint256 collateralAmountToGetBack) external override onlyUSDLemma {
        require(collateralAmountToGetBack > 0, "Amount should greater than zero");
        uint256 amountToWithdraw = getAmountInCollateralDecimals(collateralAmountToGetBack, false);
        require(amountToWithdraw > 0, "Amount should greater than zero");
        _withdraw(amountToWithdraw);
        SafeERC20Upgradeable.safeTransfer(collateral, usdLemma, amountToWithdraw);
    }

    /// METHODS WITH EXACT COLLATERAL(Base or Eth)
    /// 1). openWExactCollateral
    /// 2). closeWExactCollateral

    /// @notice Open short position for eth(baseToken) first and deposit collateral here
    /// @notice Assumptions 
    /// 1) The tail asset has already been sent on this contract by USDLemma.sol, we just need to skip the deposit() step
    /// 2) There is already enough USDC deposited in Perp to back the increase short trade
    /// @notice A better name would have been openWExactBase() but can't change the name to avoid breaking the interface
    /// For the non-tail asset, we have base = collateral (e.g. vETH and ETH) but for the tail asset we have base != collateral (e.g. vTAIL and USDC)
    /// @param tailAmount Amount of base we want to short
    function openWExactCollateral(uint256 tailAmount)
        external
        override
        onlyUSDLemma
        returns (uint256 USDLToMint)
    {
        require(!hasSettled, "Market Closed");

        totalFundingPNL = getFundingPNL();

        // create long for usdc and short for eth position by giving isBaseToQuote=true
        // and amount in eth(baseToken) by giving isExactInput=true
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: true,
            isExactInput: true,
            amount: tailAmount,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (, uint256 quote) = clearingHouse.openPosition(params);

        // NOTE: Given the Assumption 2 we are not required to deposit any collateral = USDC as we assume it is already there, but if we would this is the code 
        // uint256 collateralAmount = quote;
        // uint256 collateralAmountToDeposit = getAmountInCollateralDecimals(collateralAmount, false);
        // require(collateralAmountToDeposit > 0, "Amount should greater than zero");
        // require(
        //     collateral.balanceOf(address(this)) >= collateralAmountToDeposit,
        //     "Not enough collateral for openWExactCollateral"
        // );
        // perpVault.deposit(address(collateral), collateralAmountToDeposit);

        int256 positionSize = accountBalance.getTotalPositionSize(address(this), baseTokenAddress);
        require(positionSize.abs().toUint256() <= maxPosition, "max position reached");
        USDLToMint = quote;
    }

    /// @notice Open long position for eth(baseToken) first and withdraw collateral here
    /// @notice Assumptions 
    /// 1) The tail asset is already deposited in this contract 
    /// 2) We do not need to withdraw any collateral as we would like to leave it there
    /// @notice A better name would have been closeWExactBase() but can't change it to avoid breaking the interface
    /// @param tailAmount collateral amount require to close or long position
    function closeWExactCollateral(uint256 tailAmount)
        external
        override
        onlyUSDLemma
        returns (uint256 USDLToBurn)
    {
        if (hasSettled) return closeWExactCollateralAfterSettlement(tailAmount);

        totalFundingPNL = getFundingPNL();

        //simillar to openWExactCollateral but for close
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: false,
            isExactInput: false,
            amount: tailAmount,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (, uint256 quote) = clearingHouse.openPosition(params);
        USDLToBurn = quote;

        SafeERC20Upgradeable.safeTransfer(tailAsset, usdLemma, tailAmount);
        
        // NOTE: Given the Assumption 2, skip withdrawaing collateral 
        // uint256 amountToWithdraw = getAmountInCollateralDecimals(collateralAmount, false);
        // require(amountToWithdraw > 0, "Amount should greater than zero");
        // perpVault.withdraw(address(collateral), amountToWithdraw); // withdraw closed position fund
        // SafeERC20Upgradeable.safeTransfer(collateral, usdLemma, amountToWithdraw);
    }

    //// @notice when perpetual is in CLEARED state, withdraw the collateral
    function settle() public override {
        positionAtSettlementInQuote = accountBalance.getQuote(address(this), baseTokenAddress).abs().toUint256();

        // NOTE: This checks the market is in CLOSED state, otherwise reverts
        // NOTE: For some reason, the amountQuoteClosed < freeCollateral and freeCollateral is the max withdrawable for us so this is the one we want to use to withdraw
        clearingHouse.quitMarket(address(this), baseTokenAddress);
        // NOTE: Settle pending funding rates
        settleAllFunding();

        // NOTE: This amount of free collateral is the one internally used to check for the V_NEFC error, so this is the max withdrawable
        uint256 freeCollateral = perpVault.getFreeCollateralByToken(address(this), address(collateral));
        positionAtSettlementInBase = freeCollateral;
        perpVault.withdraw(address(collateral), positionAtSettlementInBase);
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
            // open long position for eth and amount in vUSD
            _isBaseToQuote = false;
            _isExactInput = true;
        } else {
            // open short position for eth and amount in vUSD
            _isBaseToQuote = true;
            _isExactInput = false;
        }

        int256 difference = totalFundingPNL - realizedFundingPNL;
        //error +-10**12 is allowed in calculation
        require(difference.abs() <= 10**12, "not allowed");

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
        clearingHouse.openPosition(params);
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
    /// NOTE: Since it moves collateral from this contract to Perp, it is unnecessary with tail assets 
    function _deposit(uint256 collateralAmount) internal {
        return;
        // perpVault.deposit(address(collateral), collateralAmount);
    }

    /// @notice to withdrae collateral from vault after long or close position
    /// NOTE: Since it moves collateral from Perp to this contract, it is unnecessary with tail assets
    function _withdraw(uint256 amountToWithdraw) internal {
        return;
        // perpVault.withdraw(address(collateral), amountToWithdraw); // withdraw closed position fund
    }

    /// @notice closeWExactUSDLAfterSettlement is used to distribute collateral using on pro rata based user's share(USDL).
    /// @param usdlAmount this method distribute collateral by exact usdlAmount
    function closeWExactUSDLAfterSettlement(uint256 usdlAmount)
        internal
        returns (uint256 amountCollateralToTransfer1e_18)
    {
        // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more USDL to Burn
        require(positionAtSettlementInQuote > 0, "Settled vUSD position amount should not ZERO");
        // WPL_NC : Wrapper PerpLemma, No Collateral
        require(collateral.balanceOf(address(this)) > 0, "Settled collateral amount should not ZERO");
        amountCollateralToTransfer1e_18 =
            (usdlAmount * collateral.balanceOf(address(this))) /
            positionAtSettlementInQuote;
        uint256 amountCollateralToTransfer = getAmountInCollateralDecimals(amountCollateralToTransfer1e_18, false);
        require(amountCollateralToTransfer > 0, "Amount should greater than zero");
        SafeERC20Upgradeable.safeTransfer(collateral, usdLemma, amountCollateralToTransfer);
        positionAtSettlementInQuote -= usdlAmount;
    }

    /// @notice closeWExactCollateralAfterSettlement is use to distribute collateral using on pro rata based user's share(USDL).
    /// @notice Better name would have been closeWExactBaseAfterSettlement() because in this case collateral != base
    /// @param tailAmount this method distribute collateral by exact collateral
    function closeWExactCollateralAfterSettlement(uint256 tailAmount) internal returns (uint256 USDLToBurn) {
        //No Position at settlement --> no more USDL to Burn
        require(positionAtSettlementInQuote > 0, "Settled vUSD position amount should not ZERO");
        //No collateral --> no more collateralt to give out
        require(tailAsset.balanceOf(address(this)) > 0, "Settled collateral amount should not ZERO");

        require(tailAmount > 0, "Tail Amount can not be zero");

        // NOTE: No need to change the decimals representation since there is no interaction with Perp
        // uint256 amountCollateralToTransfer = getAmountInCollateralDecimals(collateralAmount, false);
        // require(amountCollateralToTransfer > 0, "Amount should greater than zero");

        USDLToBurn = (tailAmount * positionAtSettlementInQuote) / tailAsset.balanceOf(address(this));
        // USDLToBurn = (amountCollateralToTransfer * positionAtSettlementInQuote) / collateral.balanceOf(address(this));

        SafeERC20Upgradeable.safeTransfer(tailAsset, usdLemma, tailAmount);
        // SafeERC20Upgradeable.safeTransfer(collateral, usdLemma, amountCollateralToTransfer);
        positionAtSettlementInQuote -= USDLToBurn;
    }

    /// @notice convert provided amount is in 18 decimals
    /// @param amount need to convert in 18 decimals
    function convert1e_18(uint256 amount) internal view returns (uint256) {
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
}
