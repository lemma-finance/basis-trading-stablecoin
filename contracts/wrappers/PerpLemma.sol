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

interface IPerpVault {
    function deposit(address token, uint256 amount) external;

    function withdraw(address token, uint256 amountX10_D) external;

    function getBalance(address trader) external view returns (int256);

    function decimals() external view returns (uint8);

    function getSettlementToken() external view returns (address settlementToken);

    function getFreeCollateralByRatio(address trader, uint24 ratio)
        external
        view
        returns (int256 freeCollateralByRatio);
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
    address public quoteTokenAddress;
    bytes32 public referrerCode;

    IERC20Upgradeable public collateral;
    uint256 public collateralDecimals;

    IClearingHouse public iClearingHouse;
    IClearingHouseConfig public iClearingHouseConfig;
    IPerpVault public iPerpVault;
    IAccountBalance public iAccountBalance;
    IMarketRegistry public iMarketRegistry;
    IExchange public iExchange;

    // Has the Market Settled
    bool public hasSettled;
    // Gets set only when Settlement has already happened
    uint256 public positionAtSettlement;

    uint256 public maxPosition;
    int256 public totalFundingPNL;
    int256 public realizedFundingPNL;

    //events
    event USDLemmaUpdated(address usdlAddress);
    event ReferrerUpdated(bytes32 referrerCode);
    event RebalancerUpdated(address rebalancerAddress);
    event MaxPositionUpdated(uint256 maxPos);

    modifier onlyUSDLemma() {
        require(msg.sender == usdLemma, "only usdLemma is allowed");
        _;
    }

    //@sunnyRK do not take redudunt arguments. e.g. _collateral is not required because _iPerpVault.getSettlementToken() will return collateral address. We can remove _collateral from the arguments.
    function initialize(
        address _baseToken,
        address _quoteToken,
        address _iClearingHouse,
        address _iMarketRegistry,
        address _usdLemma,
        uint256 _maxPosition
    ) external initializer {
        __Ownable_init();

        usdLemma = _usdLemma;
        maxPosition = _maxPosition;
        baseTokenAddress = _baseToken;
        quoteTokenAddress = _quoteToken;

        iClearingHouse = IClearingHouse(_iClearingHouse);
        iClearingHouseConfig = IClearingHouseConfig(iClearingHouse.getClearingHouseConfig());
        iPerpVault = IPerpVault(iClearingHouse.getVault());
        iExchange = IExchange(iClearingHouse.getExchange());
        iAccountBalance = IAccountBalance(iClearingHouse.getAccountBalance());

        iMarketRegistry = IMarketRegistry(_iMarketRegistry);

        collateral = IERC20Upgradeable(iPerpVault.getSettlementToken());
        collateralDecimals = iPerpVault.decimals(); // need to verify
        collateral.approve(_iClearingHouse, MAX_UINT256);

        // NOTE: Even though it is not necessary, it is for clarity
        hasSettled = false;
    }

    function getFees(bool isMinting) external view override returns (uint256) {
        IMarketRegistry.MarketInfo memory marketInfo = iMarketRegistry.getMarketInfo(baseTokenAddress);
        return marketInfo.exchangeFeeRatio;
    }

    ///@notice sets USDLemma address - only owner can set
    ///@param _usdlemma USDLemma address to set
    function setUSDLemma(address _usdlemma) external onlyOwner {
        usdLemma = _usdlemma;
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
        SafeERC20Upgradeable.safeApprove(collateral, address(iPerpVault), 0);
        SafeERC20Upgradeable.safeApprove(collateral, address(iPerpVault), MAX_UINT256);
    }

    //go short to open
    /// @notice Open short position on dex and deposit collateral
    /// @param amount worth in USD short position which is to be opened
    /// @param collateralAmountRequired collateral amount required to open the position
    function open(uint256 amount, uint256 collateralAmountRequired) external override onlyUSDLemma {
        revert("not supported");
    }

    function close(uint256 amount, uint256 collateralAmountToGetBack) external override onlyUSDLemma {
        revert("not supported");
    }

    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        external
        override
        returns (uint256 collateralAmountRequired)
    {
        revert("not supported");
    }

    function openWExactCollateral(uint256 collateralAmount)
        external
        override
        onlyUSDLemma
        returns (uint256 USDLToMint)
    {
        require(_msgSender() == usdLemma, "only usdLemma is allowed");
        require(!hasSettled, "Market Closed");
        uint256 collateralAmountToDeposit = getAmountInCollateralDecimals(collateralAmount, true);
        require(collateral.balanceOf(address(this)) >= collateralAmountToDeposit, "not enough collateral");

        totalFundingPNL += iExchange.getPendingFundingPayment(address(this), baseTokenAddress);

        iPerpVault.deposit(address(collateral), collateralAmountToDeposit);
        uint256 collateralAmountForOpen = getCollateralAmountAfterFees(collateralAmount);

        // create long for usdc and short for eth position by giving isBaseToQuote=false
        // and amount in eth(quoteToken) by giving isExactInput=true
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: false,
            isExactInput: true,
            amount: collateralAmountForOpen,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (uint256 base, ) = iClearingHouse.openPosition(params);

        int256 positionSize = iAccountBalance.getTotalPositionSize(address(this), baseTokenAddress);
        require(positionSize.abs().toUint256() <= maxPosition, "max position reached");
        USDLToMint = base;
    }

    function closeWExactCollateral(uint256 collateralAmount) external override returns (uint256 USDLToBurn) {
        require(_msgSender() == usdLemma, "only usdLemma is allowed");

        if (hasSettled) return closeWExactCollateralAfterSettlement(collateralAmount);

        totalFundingPNL += iExchange.getPendingFundingPayment(address(this), baseTokenAddress);
        uint256 collateralAmountForClose = getCollateralAmountAfterFees(collateralAmount);

        //simillar to openWExactCollateral but for close
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: true,
            isExactInput: false,
            amount: collateralAmountForClose,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: referrerCode
        });
        (uint256 base, uint256 quote) = iClearingHouse.openPosition(params);
        USDLToBurn = base;

        uint256 amountToWithdraw = getAmountInCollateralDecimals(quote, true);
        iPerpVault.withdraw(address(collateral), amountToWithdraw); // withdraw closed position fund
        SafeERC20Upgradeable.safeTransfer(collateral, usdLemma, amountToWithdraw);
    }

    function closeWExactCollateralAfterSettlement(uint256 collateralAmount) internal returns (uint256 USDLToBurn) {
        // WPL_NP : Wrapper PerpLemma, No Position at settlement --> no more USDL to Burn
        require(positionAtSettlement > 0, "WPL_NP");
        // WPL_NC : Wrapper PerpLemma, No Collateral
        require(collateral.balanceOf(address(this)) > 0, "WPL_NC");
        uint256 amountCollateralToTransfer = getAmountInCollateralDecimals(collateralAmount, true);
        USDLToBurn = (amountCollateralToTransfer * positionAtSettlement) / collateral.balanceOf(address(this));
        SafeERC20Upgradeable.safeTransfer(collateral, usdLemma, amountCollateralToTransfer);
        positionAtSettlement -= USDLToBurn;
    }

    //// @notice when perpetual is in CLEARED state, withdraw the collateral
    function settle() public override {
        // uint256 initialCollateral = collateral.balanceOf(address(this));
        positionAtSettlement = iAccountBalance.getBase(address(this), baseTokenAddress).abs().toUint256();

        iClearingHouse.quitMarket(address(this), baseTokenAddress);

        uint24 imRatio = iClearingHouseConfig.getImRatio();
        int256 freeCollateralByImRatioX10_D = iPerpVault.getFreeCollateralByRatio(address(this), imRatio);
        uint256 collateralAmountToWithdraw = freeCollateralByImRatioX10_D.abs().toUint256();
        iPerpVault.withdraw(address(collateral), collateralAmountToWithdraw);

        // uint256 currentCollateral = collateral.balanceOf(address(this));
        // require(currentCollateral - initialCollateral == collateralAmountToWithdraw, "Withdraw failed");

        // All the collateral is now back
        hasSettled = true;
    }

    /// @notice Rebalance position of dex based on accumulated funding, since last rebalancing
    /// @param _reBalancer Address of rebalancer who called function on USDL contract
    /// @param amount Amount of accumulated funding fees used to rebalance by opening or closing a short position
    /// @param data Abi encoded data to call respective perpetual function, contains limitPrice and deadline
    /// @return True if successful, False if unsuccessful
    function reBalance(
        address _reBalancer,
        int256 amount,
        bytes calldata data
    ) external override returns (bool) {
        require(_msgSender() == usdLemma, "only usdLemma is allowed");
        require(_reBalancer == reBalancer, "only rebalancer is allowed");

        (uint160 _sqrtPriceLimitX96, uint256 _deadline) = abi.decode(data, (uint160, uint256));
        int256 fundingPNL = getFundingPNL();

        bool _isBaseToQuote;
        bool _isExactInput;
        //calculate the fees
        IMarketRegistry.MarketInfo memory marketInfo = iMarketRegistry.getMarketInfo(baseTokenAddress);
        uint256 fees = (amount.abs().toUint256() * marketInfo.exchangeFeeRatio) / HUNDREAD_PERCENT;

        if (amount < 0) {
            realizedFundingPNL -= amount - fees.toInt256();
            // open short position for eth and amount in eth
            _isBaseToQuote = false;
            _isExactInput = true;
        } else {
            realizedFundingPNL += amount + fees.toInt256();
            // open long position for eth and amount in eth
            _isBaseToQuote = true;
            _isExactInput = false;
        }
        int256 difference = fundingPNL - realizedFundingPNL;
        //error +-10**12 is allowed in calculation
        require(difference.abs() <= 10**16, "not allowed");

        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: _isBaseToQuote,
            isExactInput: _isExactInput,
            amount: uint256(difference.abs()),
            oppositeAmountBound: 0,
            deadline: _deadline,
            sqrtPriceLimitX96: _sqrtPriceLimitX96,
            referralCode: referrerCode
        });
        iClearingHouse.openPosition(params);
        return true;
    }

    /// @notice Get Amount in collateral decimals, provided amount is in 18 decimals
    /// @param amount Amount in 18 decimals
    /// @param roundUp If needs to round up
    /// @return decimal adjusted value
    function getAmountInCollateralDecimals(uint256 amount, bool roundUp) public view override returns (uint256) {
        console.log("getAmountInCollateralDecimals[] amount before = ", amount);
        amount = (amount * (10**18)) / (10**collateralDecimals);
        console.log("getAmountInCollateralDecimals[] amount after = ", amount);
        if (roundUp && (amount % (uint256(10**(18 - collateralDecimals))) != 0)) {
            return amount / uint256(10**(18 - collateralDecimals)) + 1; // need to verify
        }

        return amount / uint256(10**(18 - collateralDecimals));
    }

    function getTotalPosition() external view override returns (int256) {
        return iAccountBalance.getTotalPositionValue(address(this), baseTokenAddress);
    }

    function getFundingPNL() public view returns (int256 fundingPNL) {
        return totalFundingPNL + iExchange.getPendingFundingPayment(address(this), baseTokenAddress);
    }

    function getCollateralAmountAfterFees(uint256 _collateralAmount) internal returns (uint256 collateralAmount) {
        IMarketRegistry.MarketInfo memory marketInfo = iMarketRegistry.getMarketInfo(baseTokenAddress);
        // fees cut from user's collateral by lemma for open or close position
        collateralAmount = _collateralAmount - ((_collateralAmount * marketInfo.exchangeFeeRatio) / HUNDREAD_PERCENT);
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
