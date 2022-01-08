// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.3;
// pragma abicoder v2;

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
import "../interfaces/Perpetual/IExchange.sol";
import "../interfaces/Perpetual/IBaseToken.sol";
import "../interfaces/UniswapV3/IQuoter.sol";
import "hardhat/console.sol";

interface IPerpVault {
    function deposit(address token, uint256 amount) external;
    function withdraw(address token, uint256 amountX10_D) external;
    function getBalance(address trader) external view returns (int256);
    function decimals() external view returns (uint8);
}

interface IUSDLemma {
    function lemmaTreasury() external view returns (address);
}

contract PerpLemma is OwnableUpgradeable, ERC2771ContextUpgradeable, IPerpetualDEXWrapper {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using Utils for int256;
    using SafeMathExt for int256;

    bytes32 public HashZero;
    uint256 public constant MAX_UINT256 = type(uint256).max;
    int256 public constant MAX_INT256 = type(int256).max;
    int256 public ONE_ETHER;
    int256 public ONE_USDC;

    address public usdLemma;
    address public reBalancer;
    address public baseTokenAddress;
    address public quoteTokenAddress;
    bytes32 public referrerCode;

    IERC20Upgradeable public usd; // ETH
    IERC20Upgradeable public collateral; // ETH
    uint256 public collateralDecimals;

    IClearingHouse public iClearingHouse;
    IClearingHouseConfig public iClearingHouseConfig;
    IPerpVault public iPerpVault;
    IAccountBalance public iAccountBalance;
    IBaseToken public iBaseToken;
    IExchange public iExchange;

    IQuoter public iUniV3Router;

    uint256 public maxPosition;

    //events
    event USDLemmaUpdated(address usdlAddress);
    event ReferrerUpdated(bytes32 referrerCode);
    event RebalancerUpdated(address rebalancerAddress);
    event MaxPositionUpdated(uint256 maxPos);

    function initialize(
        address _collateral, 
        address _usd,
        address _baseToken,
        address _quoteToken,
        address _iClearingHouse, 
        address _iPerpVault,
        address _iAccountBalance,
        address _iUniV3Router,
        address _usdLemma,
        uint256 _maxPosition
    ) public initializer {
        __Ownable_init();
        ONE_ETHER = 1e18;
        ONE_USDC = 1e6;
        usdLemma = _usdLemma;
        maxPosition = _maxPosition;
        baseTokenAddress = _baseToken;
        quoteTokenAddress = _quoteToken;
        collateral = IERC20Upgradeable(_collateral);
        usd = IERC20Upgradeable(_usd);
        iClearingHouse = IClearingHouse(_iClearingHouse);
        iClearingHouseConfig = IClearingHouseConfig(iClearingHouse.getClearingHouseConfig());
        iExchange = IExchange(iClearingHouse.getExchange());
        iBaseToken = IBaseToken(baseTokenAddress);
        iPerpVault = IPerpVault(_iPerpVault);
        iUniV3Router = IQuoter(_iUniV3Router);
        iAccountBalance = IAccountBalance(_iAccountBalance);
        collateralDecimals = iPerpVault.decimals(); // need to verify
        collateral.approve(_iClearingHouse, MAX_UINT256);
    }

    ///@notice sets USDLemma address - only owner can set
    ///@param _usdlemma USDLemma address to set
    function setUSDLemma(address _usdlemma) public onlyOwner {
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
    function setReBalancer(address _reBalancer) public onlyOwner {
        reBalancer = _reBalancer;
        emit RebalancerUpdated(reBalancer);
    }

    ///@param _maxPosition reBalancer address to set
    function setMaxPosition(uint256 _maxPosition) public onlyOwner {
        maxPosition = _maxPosition;
        emit MaxPositionUpdated(maxPosition);
    }

    /// @notice reset approvals
    function resetApprovals() public {
        SafeERC20Upgradeable.safeApprove(collateral, address(iPerpVault), 0);
        SafeERC20Upgradeable.safeApprove(collateral, address(iPerpVault), MAX_UINT256);
    }

    //this needs to be done before the first withdrawal happens
    //Keeper gas reward needs to be handled seperately which owner can get back when perpetual has settled
    /// @notice Deposit Keeper gas reward for the perpetual - only owner can call
    function depositKeeperGasReward() external onlyOwner {
        iPerpVault.deposit(address(collateral), collateral.balanceOf(address(this)));
    }

    //go short to open
    /// @notice Open short position on dex and deposit collateral
    /// @param amount worth in USD short position which is to be opened
    /// @param collateralAmountRequired collateral amount required to open the position
    function open(uint256 amount, uint256 collateralAmountRequired) external override {
        require(_msgSender() == usdLemma, "only usdLemma is allowed");
        require(
            collateral.balanceOf(address(this)) >= getAmountInCollateralDecimals(collateralAmountRequired, true),
            "not enough collateral"
        );

        iPerpVault.deposit(address(collateral), collateralAmountRequired);

        int256 positionSize = iAccountBalance.getTotalPositionValue(address(this), baseTokenAddress);
        require(positionSize.abs().toUint256() + amount <= maxPosition, "max position reached");

        // create short position by giving isBaseToQuote=true
        // and amount in eth(baseToken) by giving isExactInput=true
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: true,
            isExactInput: true,
            amount: amount,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: bytes32(0)
        });
        (uint256 base, uint256 quote) = iClearingHouse.openPosition(params);
        console.log('base: ', base);
        console.log('quote: ', quote);

        quote = (quote * 1e6) / 1e18;
        console.log('quote in 1e6: ', quote);
        // require(quote == collateralAmountRequired, "Not correct");


        // needs to updateEntryFunding() call  (need to implement)
    }

    function close(uint256 amount, uint256 collateralAmountToGetBack) external override {
        require(_msgSender() == usdLemma, "only usdLemma is allowed");
        // int256 positionSize = IAccountBalance(address(iAccountBalance)).getPositionSize(address(this), baseTokenAddress);
        // require (positionSize != 0);

        // create long position by giving isBaseToQuote=false
        // and amount in eth(baseToken) by giving isExactInput=false
        IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
            baseToken: baseTokenAddress,
            isBaseToQuote: false,
            isExactInput: false,
            amount: amount,
            oppositeAmountBound: 0,
            deadline: MAX_UINT256,
            sqrtPriceLimitX96: 0,
            referralCode: bytes32(0)
        });
        (uint256 base, uint256 quote) = iClearingHouse.openPosition(params);
        console.log('base-close: ', base);
        console.log('quote-close: ', quote);
        
        (int256 owedRealizedPnl,int256 unrealizedPnl,uint256 pendingFee) = iAccountBalance.getPnlAndPendingFee(address(this)); // get current position value
        console.log('owedRealizedPnl-close: ', uint256(owedRealizedPnl));
        console.log('unrealizedPnl-close: ', uint256(unrealizedPnl));
        console.log('pendingFee-close: ', uint256(pendingFee));

        console.log('collateralAmountToGetBack-close-before: ', collateralAmountToGetBack);
        if (owedRealizedPnl > 0) {
            owedRealizedPnl = ( owedRealizedPnl * 1e6 ) / 1e18;
            collateralAmountToGetBack = collateralAmountToGetBack + uint256(owedRealizedPnl);
        } else {
            owedRealizedPnl = owedRealizedPnl.abs();
            owedRealizedPnl = ( owedRealizedPnl * 1e6 ) / 1e18;
            console.log('owedRealizedPnl-abs', uint256(owedRealizedPnl));
            collateralAmountToGetBack = collateralAmountToGetBack - uint256(owedRealizedPnl);
        }
        console.log('collateralAmountToGetBack-close-after: ', collateralAmountToGetBack);

        iPerpVault.withdraw(address(collateral), collateralAmountToGetBack); // withdraw closed position fund 
        SafeERC20Upgradeable.safeTransfer(
            collateral,
            usdLemma,
            collateralAmountToGetBack
        );

        // // *** needs to updateEntryFunding() call  (need to implement)
    }

    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        public
        override
        returns (uint256 collateralAmountRequired)
    {
        // TODO: K-Aizen Implement
        if (isShorting) {
            // iPerpVault.deposit(address(collateral), 100e6);
            IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
                baseToken: baseTokenAddress,
                isBaseToQuote: true,
                isExactInput: true,
                amount: amount,
                oppositeAmountBound: 0,
                deadline: MAX_UINT256,
                sqrtPriceLimitX96: 0,
                referralCode: bytes32(0)
            });
            (uint256 base, uint256 quote) = iClearingHouse.openPosition(params);
            console.log('base-: ', base);
            console.log('quote-: ', quote);

            collateralAmountRequired = quote;
        } else {

            IClearingHouse.OpenPositionParams memory params = IClearingHouse.OpenPositionParams({
                baseToken: baseTokenAddress,
                isBaseToQuote: true,
                isExactInput: true,
                amount: amount,
                oppositeAmountBound: 0,
                deadline: MAX_UINT256,
                sqrtPriceLimitX96: 0,
                referralCode: bytes32(0)
            });
            (uint256 base, uint256 quote) = iClearingHouse.openPosition(params);
        }
    }

    function calculateLeverage(int256 depositedCollateral) public view returns(int256 leverage) {
        depositedCollateral = depositedCollateral * ONE_ETHER;
        console.log('c-depositedCollateral: ', uint256(depositedCollateral));
        int256 positionSize = iAccountBalance.getTotalPositionSize(address(this), baseTokenAddress) * (-1);
        console.log('c-positionSize: ', uint256(positionSize));
        int256 divisor = (positionSize * int256(iBaseToken.getIndexPrice(iClearingHouseConfig.getTwapInterval()))) / ONE_ETHER;
        console.log('c-divisor: ', uint256(divisor));
        console.log('c-getIndexPrice: ', uint256(int256(iBaseToken.getIndexPrice(iClearingHouseConfig.getTwapInterval()))));
        leverage = (depositedCollateral / divisor);
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
        int256 depositedCollateral = iPerpVault.getBalance(address(this));

        int256 perpLeverage = calculateLeverage(depositedCollateral);
        console.log('perpLeverage before: ', uint256(depositedCollateral), uint256(perpLeverage));

        int256 fundingPayment = iExchange.getAllPendingFundingPayment(address(this)).abs();
        console.log('fundingPayment before: ', uint256(fundingPayment));

        bool _isBaseToQuote;
        bool _isExactInput;
        if (amount > 0) {
            console.log('long');
            // open long position and amount in usd
            _isBaseToQuote = false;
            _isExactInput = true; // usd
            // _isExactInput = false; // eth
        } else {
            console.log('short');
            // open short position and amount in usd
            _isBaseToQuote = true;
            _isExactInput = false; // usd
            // _isExactInput = true; // eth
        }

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
        iClearingHouse.openPosition(params);

        depositedCollateral = iPerpVault.getBalance(address(this));
        perpLeverage = calculateLeverage(depositedCollateral);
        console.log('perpLeverage after: ', uint256(depositedCollateral), uint256(perpLeverage));

        fundingPayment = iExchange.getAllPendingFundingPayment(address(this)).abs();
        console.log('fundingPayment after: ', uint256(fundingPayment));

        return true;
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
