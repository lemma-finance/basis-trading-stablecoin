// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;

import { ILiquidityPool } from "../interfaces/MCDEX/ILiquidityPool.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { Utils } from "../libraries/Utils.sol";
import { SafeMathExt } from "../libraries/SafeMathExt.sol";

import "hardhat/console.sol";

contract MCDEXLemma is OwnableUpgradeable, ERC2771ContextUpgradeable {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using Utils for int256;
    using SafeMathExt for int256;

    uint256 public constant MAX_UINT256 = type(uint256).max;
    int256 public constant MAX_INT256 = type(int256).max;
    int256 public constant EXP_SCALE = 10**18;
    uint256 public constant UEXP_SCALE = 10**18;
    uint32 internal constant MASK_USE_TARGET_LEVERAGE = 0x08000000;

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

        reBalancer = _reBalancer;
        setUSDLemma(_usdlemma);

        //approve collateral to
        //TODO: use SafeERC20Upgreadeable
        collateral.approve(address(liquidityPool), MAX_UINT256);
        //target leverage = 1
        liquidityPool.setTargetLeverage(perpetualIndex, address(this), EXP_SCALE);
    }

    function setUSDLemma(address _usdlemma) public onlyOwner {
        usdLemma = _usdlemma;
    }

    function setReferrer(address _referrer) public onlyOwner {
        referrer = _referrer;
    }

    //this needs to be done before the first withdrwal happens
    //Keeper gas reward needs to be handled seperately which owner can get back when perpetual has settled
    //TODO: handle what happens when perpetual is in settlement state
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
    function open(uint256 amount) public {
        //check if msg.sender == usdLemma
        // liquidityPool.forceToSyncState();
        uint256 collateralRequiredAmount = getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        require(collateral.balanceOf(address(this)) >= collateralRequiredAmount, "not enough collateral");
        liquidityPool.deposit(perpetualIndex, address(this), collateralRequiredAmount.toInt256());

        (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

        int256 deltaPosition = liquidityPool.trade(
            perpetualIndex,
            address(this),
            amount.toInt256(),
            MAX_INT256,
            MAX_UINT256,
            referrer,
            0
        );
        updateEntryFunding(position, amount.toInt256());
    }

    //go long and withdraw collateral
    function close(uint256 amount) external {
        //check if msg.sender == usdLemma
        // liquidityPool.forceToSyncState();

        uint256 collateralAmountRequired = getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
        (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

        int256 deltaPosition = liquidityPool.trade(
            perpetualIndex,
            address(this),
            -amount.toInt256(), //negative means you want to go short (on USD, that in turn means long on ETH)
            0,
            MAX_UINT256,
            referrer,
            0
        );
        liquidityPool.withdraw(perpetualIndex, address(this), collateralAmountRequired.toInt256());
        collateral.transfer(usdLemma, collateralAmountRequired);

        updateEntryFunding(position, -amount.toInt256());
    }

    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        public
        returns (uint256 collateralAmountRequired)
    {
        // liquidityPool.forceToSyncState();
        int256 tradeAmount = isShorting ? amount.toInt256() : -amount.toInt256();
        (int256 tradePrice, int256 totalFee, int256 cost) = liquidityPool.queryTrade(
            perpetualIndex,
            address(this),
            tradeAmount,
            referrer,
            0
            // MASK_USE_TARGET_LEVERAGE
        );

        int256 deltaCash = amount.toInt256().wmul(tradePrice);
        collateralAmountRequired = isShorting ? (deltaCash + totalFee).toUint256() : (deltaCash - totalFee).toUint256();

        // collateralAmountRequired = cost.abs().toUint256();
    }

    //TODO:implement the reBalancing mechanism //add equation to calculate relaized funding
    function reBalance(
        address _reBalancer,
        int256 amount,
        bytes calldata data
    ) external returns (bool) {
        require(_msgSender() == usdLemma, "only usdLemma is allowed");
        require(_reBalancer == reBalancer, "only rebalancer is allowed");

        (int256 limitPrice, uint256 deadline) = abi.decode(data, (int256, uint256));
        console.log("deadline", deadline);
        console.log("limitPrice", limitPrice.abs().toUint256());
        int256 fundingPNL = getFundingPNL();

        (int256 tradePrice, int256 totalFee, int256 cost) = liquidityPool.queryTrade(
            perpetualIndex,
            address(this),
            amount,
            referrer,
            0
            // MASK_USE_TARGET_LEVERAGE
        );
        int256 deltaCash = amount.abs().wmul(tradePrice);
        uint256 collateralAmount = (deltaCash + totalFee).toUint256();

        console.log("amount", amount.abs().toUint256());
        console.log(
            "fundingPNL + realizedFundingPNL).abs().toUint256()",
            (fundingPNL + realizedFundingPNL).abs().toUint256()
        );
        console.log("collateralAmount", collateralAmount);
        require((fundingPNL + realizedFundingPNL).abs().toUint256() >= collateralAmount, "not allowed");

        liquidityPool.trade(perpetualIndex, address(this), amount, limitPrice, deadline, referrer, 0);
        if (fundingPNL < 0) {
            require(amount < 0, "need to long ETH when fundingPNL is < 0");
            realizedFundingPNL += collateralAmount.toInt256();
        } else {
            require(amount > 0, "need to short ETH when fundingPNL is >0");
            realizedFundingPNL -= collateralAmount.toInt256();
        }
        return true;
    }

    function updateEntryFunding(int256 position, int256 tradeAmount) internal {
        (int256 close, int256 open) = Utils.splitAmount(position, tradeAmount);
        int256 unitAccumulativeFunding;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            unitAccumulativeFunding = nums[4];
        }
        if (close != 0) {
            int256 oldPosition = position;
            int256 newPosition = position + close;
            entryFunding = entryFunding.wmul(newPosition).wdiv(oldPosition);
        }
        if (open != 0) {
            entryFunding = entryFunding + unitAccumulativeFunding.wmul(open);
        }

        console.log("unitAccumulativeFunding", unitAccumulativeFunding.abs().toUint256());
        console.log("entryFunding", entryFunding.abs().toUint256());
    }

    //TODO:make this method internal?
    function getFundingPNL() public view returns (int256 fundingPNL) {
        int256 unitAccumulativeFunding;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            unitAccumulativeFunding = nums[4];
        }
        (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));
        fundingPNL = entryFunding - position.wmul(unitAccumulativeFunding);
    }

    //TODO: use safeMathExt
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
