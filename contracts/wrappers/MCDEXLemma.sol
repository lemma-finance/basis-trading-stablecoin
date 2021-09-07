// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;

import { ILiquidityPool, PerpetualState } from "../interfaces/MCDEX/ILiquidityPool.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { Utils } from "../libraries/Utils.sol";
import { SafeMathExt } from "../libraries/SafeMathExt.sol";

/// @author Lemma Finance
contract MCDEXLemma is OwnableUpgradeable, ERC2771ContextUpgradeable {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using Utils for int256;
    using SafeMathExt for int256;

    uint256 public constant MAX_UINT256 = type(uint256).max;
    int256 public constant MAX_INT256 = type(int256).max;

    // address of Mai3 liquidity pool
    ILiquidityPool public liquidityPool;

    // pereptual index in the liquidity pool
    uint256 public perpetualIndex;

    IERC20Upgradeable public collateral;
    uint256 public collateralDecimals;

    bool public isSettled;

    address public usdLemma;
    address public reBalancer;
    address public referrer;

    int256 public entryFunding;
    int256 public realizedFundingPNL;
    int256 public fundingPNLAtLastReBalance;

    uint256 positionAtSettlement;

    function initialize(
        address _trustedForwarder,
        ILiquidityPool _liquidityPool,
        uint256 _perpetualIndex,
        address _usdlemma,
        address _reBalancer
    ) external initializer {
        __Ownable_init();
        __ERC2771Context_init(_trustedForwarder);
        liquidityPool = _liquidityPool;
        perpetualIndex = _perpetualIndex;
        {
            (bool isRunning, , address[7] memory addresses, , uint256[4] memory uintNums) = liquidityPool
                .getLiquidityPoolInfo();
            require(isRunning, "pool is not running");
            collateral = IERC20Upgradeable(addresses[5]);
            collateralDecimals = uintNums[0];
        }
        isSettled = false;

        setReBalancer(_reBalancer);
        setUSDLemma(_usdlemma);

        //approve collateral to
        collateral.approve(address(liquidityPool), MAX_UINT256);
        //target leverage = 1
        liquidityPool.setTargetLeverage(perpetualIndex, address(this), 1 ether); //1
    }

    ///@notice sets USDLemma address - only owner can set
    ///@param _usdlemma USDLemma address to set
    function setUSDLemma(address _usdlemma) public onlyOwner {
        usdLemma = _usdlemma;
    }

    ///@notice sets refferer address - only owner can set
    ///@param _referrer refferer address to set
    function setReferrer(address _referrer) public onlyOwner {
        referrer = _referrer;
    }

    ///@notice sets reBalncer address - only owner can set
    ///@param _reBalancer reBalancer address to set
    function setReBalancer(address _reBalancer) public onlyOwner {
        reBalancer = _reBalancer;
    }

    //this needs to be done before the first withdrawal happens
    //Keeper gas reward needs to be handled seperately which owner can get back when perpetual has settled
    /// @notice Deposit Keeper gas reward for the perpetual - only owner can call
    function depositKeeperGasReward() external onlyOwner {
        int256 keeperGasReward;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            keeperGasReward = nums[11];
        }
        collateral.transferFrom(_msgSender(), address(this), keeperGasReward.toUint256());
        liquidityPool.deposit(perpetualIndex, address(this), keeperGasReward);
    }

    //go short to open
    /// @notice Open short position on dex and deposit collateral
    /// @param amount worth in USD short position which is to be opened
    function open(uint256 amount) external {
        require(_msgSender() == usdLemma, "only usdLemma is allowed");
        uint256 collateralRequiredAmount = getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        require(collateral.balanceOf(address(this)) >= collateralRequiredAmount, "not enough collateral");
        liquidityPool.deposit(perpetualIndex, address(this), collateralRequiredAmount.toInt256());

        (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

        liquidityPool.trade(perpetualIndex, address(this), amount.toInt256(), MAX_INT256, MAX_UINT256, referrer, 0);
        updateEntryFunding(position, amount.toInt256());
    }

    //go long and withdraw collateral
    /// @notice Close short position on dex and withdraw collateral
    /// @param amount worth in USD short position which is to be closed
    function close(uint256 amount) external {
        require(_msgSender() == usdLemma, "only usdLemma is allowed");

        uint256 collateralAmountRequired = getCollateralAmountGivenUnderlyingAssetAmount(amount, false);

        (PerpetualState perpetualState, , ) = liquidityPool.getPerpetualInfo(perpetualIndex);

        if (perpetualState != PerpetualState.CLEARED) {
            //means perpetual settled
            (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));
            liquidityPool.trade(
                perpetualIndex,
                address(this),
                -amount.toInt256(), //negative means you want to go short (on USD, that in turn means long on ETH)
                0,
                MAX_UINT256,
                referrer,
                0
            );
            liquidityPool.withdraw(perpetualIndex, address(this), collateralAmountRequired.toInt256());
            updateEntryFunding(position, -amount.toInt256());
        }
        collateral.transfer(usdLemma, collateralAmountRequired);
    }

    //// @notice when perpetual is in CLEARED state, withdraw the collateral
    function settle() public {
        (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));
        positionAtSettlement = position.abs().toUint256();
        liquidityPool.settle(perpetualIndex, address(this));
    }

    /// @notice Collateral amount required for amount in USD to open or close position on dex
    /// @param amount worth in USD short position which is to be closed or opened
    /// @param isShorting true if opening short position, false if closing short position
    /// @return collateralAmountRequired equivalent collateral amount
    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        public
        returns (uint256 collateralAmountRequired)
    {
        liquidityPool.forceToSyncState();
        int256 tradeAmount = isShorting ? amount.toInt256() : -amount.toInt256();

        //handle the case when perpetual has settled
        (PerpetualState perpetualState, , ) = liquidityPool.getPerpetualInfo(perpetualIndex);

        if (perpetualState == PerpetualState.CLEARED) {
            require(isShorting == false, "cannot open when perpetual has settled");
            (
                ,
                ,
                ,
                ,
                int256 settleableMargin, // bankrupt
                ,
                ,
                ,

            ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

            if (settleableMargin != 0) {
                settle();
            }
            collateralAmountRequired = (collateral.balanceOf(address(this)) * amount) / positionAtSettlement;
        } else {
            (int256 tradePrice, int256 totalFee, ) = liquidityPool.queryTrade(
                perpetualIndex,
                address(this),
                tradeAmount,
                referrer,
                0
            );

            int256 deltaCash = amount.toInt256().wmul(tradePrice);

            collateralAmountRequired = isShorting
                ? (deltaCash + totalFee).toUint256()
                : (deltaCash - totalFee).toUint256();
        }
    }

    /// @notice Rebalance position of dex based on accumulated funding, since last rebalancing
    /// @param _reBalancer Address of rebalancer who called function on USDL contract
    /// @param amount Amount of accumulated funding fees used to rebalance by opening or closing a short position
    /// @param data Abi encoded data to call respective mcdex function, contains limitPrice and deadline
    /// @return True if successful, False if unsuccessful
    function reBalance(
        address _reBalancer,
        int256 amount,
        bytes calldata data
    ) external returns (bool) {
        require(_msgSender() == usdLemma, "only usdLemma is allowed");
        require(_reBalancer == reBalancer, "only rebalancer is allowed");

        (int256 limitPrice, uint256 deadline) = abi.decode(data, (int256, uint256));
        int256 fundingPNL = getFundingPNL();

        (int256 tradePrice, int256 totalFee, ) = liquidityPool.queryTrade(
            perpetualIndex,
            address(this),
            amount,
            referrer,
            0
        );
        int256 deltaCash = amount.abs().wmul(tradePrice);
        uint256 collateralAmount = (deltaCash + totalFee).toUint256();
        if (amount < 0) {
            realizedFundingPNL -= collateralAmount.toInt256();
        } else {
            realizedFundingPNL += collateralAmount.toInt256();
        }

        int256 difference = fundingPNL - realizedFundingPNL;
        //error +-10**12 is allowed in calculation
        require(difference.abs() <= 10**12, "not allowed");

        liquidityPool.trade(perpetualIndex, address(this), amount, limitPrice, deadline, referrer, 0);

        return true;
    }

    /// @notice Update cumulative funding fees earned or paid for position on dex
    /// @param position Current position on Dex
    /// @param tradeAmount Change in current position on dex
    function updateEntryFunding(int256 position, int256 tradeAmount) internal {
        (int256 closeAmount, int256 openAmount) = Utils.splitAmount(position, tradeAmount);
        int256 unitAccumulativeFunding;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            unitAccumulativeFunding = nums[4];
        }
        if (closeAmount != 0) {
            int256 oldPosition = position;
            int256 newPosition = position + closeAmount;
            entryFunding = entryFunding.wmul(newPosition).wdiv(oldPosition);
        }
        if (openAmount != 0) {
            entryFunding = entryFunding + unitAccumulativeFunding.wmul(openAmount);
        }
    }

    /// @notice Get current PnL based on funding fees
    /// @return fundingPNL Funding PnL accumulated till now
    function getFundingPNL() public view returns (int256 fundingPNL) {
        int256 unitAccumulativeFunding;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            unitAccumulativeFunding = nums[4];
        }
        (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));
        fundingPNL = entryFunding - position.wmul(unitAccumulativeFunding);
    }

    /// @notice Get Amount in collateral decimals, provided amount is in 18 decimals
    /// @param amount Amount in 18 decimals
    /// @return decimal adjusted value
    function getAmountInCollateralDecimals(int256 amount) internal view returns (int256) {
        return amount / int256(10**(18 - collateralDecimals));
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
