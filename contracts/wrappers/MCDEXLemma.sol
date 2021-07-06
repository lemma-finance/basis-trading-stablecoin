// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;

import { ILiquidityPool } from "../interfaces/MCDEX/ILiquidityPool.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "hardhat/console.sol";

contract MCDEXLemma is OwnableUpgradeable, ERC2771ContextUpgradeable {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;

    uint256 public constant MAX_UINT256 = type(uint256).max;
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

    function initialize(
        ILiquidityPool _liquidityPool,
        uint256 _perpetualIndex,
        address _usdLemma,
        address _reBalancer
    ) external initializer {
        liquidityPool = _liquidityPool;
        perpetualIndex = _perpetualIndex;
        (bool isRunning, , address[7] memory addresses, , uint256[4] memory uintNums) = liquidityPool
        .getLiquidityPoolInfo();
        require(isRunning, "pool is not running");
        console.log("isRunning", isRunning);
        collateral = IERC20Upgradeable(addresses[5]);
        collateralDecimals = uintNums[0];
        console.log("collateralDecimals", collateralDecimals);
        isSettled = false;

        reBalancer = _reBalancer;
        usdLemma = _usdLemma;

        //approve collateral to
        //TODO: use SafeERC20Upgreadeable
        collateral.approve(address(liquidityPool), MAX_UINT256);
        //target leverage = 1
        // liquidityPool.setTargetLeverage(perpetualIndex, address(this), EXP_SCALE);
    }

    //go short to open

    //   function trade(
    //         uint256 perpetualIndex,
    //         address trader,
    //         int256 amount,
    //         int256 limitPrice,
    //         uint256 deadline,
    //         address referrer,
    //         uint32 flags
    //     ) external returns (int256);
    function open(uint256 amount) public {
        //check if msg.sender == usdLemma
        liquidityPool.forceToSyncState();
        console.log("opening Position:  ");
        uint256 collateralRequiredAmount = getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        liquidityPool.deposit(perpetualIndex, address(this), collateralRequiredAmount.toInt256());

        {
            int256 markPrice;
            int256 indexPrice;
            int256 unitAccumulativeFunding;
            {
                (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
                markPrice = nums[1];
                indexPrice = nums[2];
                unitAccumulativeFunding = nums[4];
            }
            logInt("unitAccumulativeFunding", unitAccumulativeFunding);
            logInt("markPrice", markPrice);
            logInt("indexPrice", indexPrice);
        }
        int256 deltaPosition = liquidityPool.trade(
            perpetualIndex,
            address(this),
            -amount.toInt256(), //negative means you want to go short
            0,
            MAX_UINT256,
            address(0),
            0
        );
        (
            int256 cash,
            int256 position,
            ,
            int256 margin,
            ,
            bool isInitialMarginSafe,
            ,
            ,
            int256 targetLeverage
        ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

        {
            int256 markPrice;
            int256 indexPrice;
            {
                (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
                markPrice = nums[1];
                indexPrice = nums[2];
            }
            logInt("markPrice", markPrice);
            logInt("indexPrice", indexPrice);
        }
        logInt("deltaPosition", deltaPosition);
        logInt("margin", margin);
        logInt("position", position);
        logInt("cash", cash);
        logInt("targetLeverage", targetLeverage); //it's 10* 10^18 by default

        reBalance();
    }

    //temporariley removing the view modifier from below function as logInt is not a view function
    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        public
        view
        returns (uint256 collateralAmountRequired)
    {
        int256 tradeAmount = isShorting ? -amount.toInt256() : amount.toInt256();
        (int256 deltaCash, int256 deltaPosition) = liquidityPool.queryTradeWithAMM(perpetualIndex, -tradeAmount);

        (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
        int256 markPrice = nums[1];
        int256 operatorFeeRate = nums[7];
        int256 lpFeeRate = nums[8];
        //TODO: consider refferal rebate as well

        (, , address[7] memory addresses, int256[5] memory intNums, ) = liquidityPool.getLiquidityPoolInfo();
        address operator = addresses[1];
        int256 vaultFeeRate = intNums[0];
        logInt("operatorFeeRate", operatorFeeRate); //it's 0;
        //TODO: instead of doing this recreate the getFees function (https://github.com/mcdexio/mai-protocol-v3/blob/33e8397f6786a1220bbdc202bc00a95568250240/contracts/module/TradeModule.sol#L214)
        if (operator == address(0)) {
            operatorFeeRate = 0;
        }
        // console.log("operator", operator); //0xa2aad83466241232290bebcd43dcbff6a7f8d23a
        int256 totalFeeRate = operatorFeeRate + lpFeeRate + vaultFeeRate;

        logInt("totalFeeRate", totalFeeRate);
        //TODO: recreate the SafeMathExt and use it instead of vanilla multiplications
        int256 totalFee = (deltaCash * totalFeeRate) / EXP_SCALE;
        logInt("Fees", totalFee);

        logInt("deltaCash", deltaCash);
        collateralAmountRequired = isShorting
            ? (-(deltaCash + totalFee)).toUint256()
            : (deltaCash - totalFee).toUint256();

        // bool hasOpened = deltaPosition != 0;
        // (, , int256 availableMargin, , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

        // if (!hasOpened) {
        //     if (availableMargin <= 0) {
        //         totalFee = 0;
        //     } else if (totalFee > availableMargin) {
        //         // make sure the sum of fees < available margin
        //         int256 rate = (availableMargin / totalFee) ;
        //         operatorFee = (operatorFee * rate) Round.FLOOR);
        //         vaultFee = vaultFee.wmul(rate, Round.FLOOR);
        //         lpFee = availableMargin.sub(operatorFee).sub(vaultFee);
        //     }
        // }
        // if (referrer != address(0) && perpetual.referralRebateRate > 0 && lpFee.add(operatorFee) > 0) {
        //     int256 lpFeeRebate = lpFee.wmul(perpetual.referralRebateRate);
        //     int256 operatorFeeRabate = operatorFee.wmul(perpetual.referralRebateRate);
        //     referralRebate = lpFeeRebate.add(operatorFeeRabate);
        //     lpFee = lpFee.sub(lpFeeRebate);
        //     operatorFee = operatorFee.sub(operatorFeeRabate);
        // }
        // liquidityPool.deposit(perpetualIndex, address(this), collateralNeeded.toInt256());
    }

    function logInt(string memory name, int256 number) internal view {
        console.log(name);
        if (number < 0) {
            console.log(" -", (-number).toUint256());
        } else {
            console.log(" ", number.toUint256());
        }
    }

    //go long and withdraw collateral
    function close(uint256 amount) external {
        console.log("closing Position:  ");
        //check if msg.sender == usdLemma
        liquidityPool.forceToSyncState();

        uint256 collateralAmountRequired = getCollateralAmountGivenUnderlyingAssetAmount(amount, false);

        {
            int256 markPrice;
            int256 indexPrice;
            {
                (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
                markPrice = nums[1];
                indexPrice = nums[2];
            }
            logInt("markPrice", markPrice);
            logInt("indexPrice", indexPrice);
        }

        int256 deltaPosition = liquidityPool.trade(
            perpetualIndex,
            address(this),
            amount.toInt256(), //negative means you want to go short
            type(int256).max,
            MAX_UINT256,
            address(0),
            0
        );

        (
            int256 cash,
            int256 position,
            ,
            int256 margin,
            ,
            bool isInitialMarginSafe,
            ,
            ,
            int256 targetLeverage
        ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

        {
            int256 markPrice;
            int256 indexPrice;
            {
                (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
                markPrice = nums[1];
                indexPrice = nums[2];
            }
            logInt("markPrice", markPrice);
            logInt("indexPrice", indexPrice);
        }

        logInt("deltaPosition", deltaPosition);
        logInt("margin", margin);
        logInt("position", position);
        logInt("cash", cash);
        // logInt("targetLeverage", targetLeverage); //it's 10* 10^18

        liquidityPool.withdraw(perpetualIndex, address(this), collateralAmountRequired.toInt256());
        collateral.transfer(usdLemma, collateralAmountRequired);
    }

    // function reBalance() public returns (uint256) {
    //     // //check the funding payments
    //     // uint256 fundingPayment = 0;
    //     // open(fundingPayment);
    //     // uint256 usdlToMintAmount = 0;
    //     // return usdlToMintAmount;
    //     int256 unitAccumulativeFunding;
    //     {
    //         (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
    //         unitAccumulativeFunding = nums[4];
    //     }
    //     logInt("unitAccumulativeFunding", unitAccumulativeFunding);

    //     (
    //         int256 cash,
    //         int256 position,
    //         ,
    //         int256 margin,
    //         ,
    //         bool isInitialMarginSafe,
    //         ,
    //         ,
    //         int256 targetLeverage
    //     ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

    //     int256 fundingPayment = (position * unitAccumulativeFunding) / EXP_SCALE;
    //     logInt("fundingPayment", fundingPayment);
    //     if (fundingPayment > 0) {
    //         liquidityPool.withdraw(perpetualIndex, address(this), fundingPayment);
    //         collateral.transfer(reBalancer, fundingPayment.toUint256());
    //     }

    //     console.log("balanceOf reBalancer", collateral.balanceOf(reBalancer));

    //     //call open()
    // }

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
