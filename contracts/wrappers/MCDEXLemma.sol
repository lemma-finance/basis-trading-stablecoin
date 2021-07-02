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

    uint256 public constant MAX_UINT256 = type(uint256).max;
    int256 public constant EXP_SCALE = 10**18;
    uint256 public constant UEXP_SCALE = 10**18;

    // address of Mai3 liquidity pool
    ILiquidityPool public liquidityPool;

    // pereptual index in the liquidity pool
    uint256 public perpetualIndex;

    IERC20Upgradeable public collateral;
    uint256 public collateralDecimals;

    bool public isSettled;

    address public usdLemma;
    address public reInvestor;

    function initialize(
        ILiquidityPool _liquidityPool,
        uint256 _perpetualIndex,
        address _usdLemma,
        address _reInvestor
    ) external initializer {
        liquidityPool = _liquidityPool;
        perpetualIndex = _perpetualIndex;
        (bool isRunning, , address[7] memory addresses, , uint256[4] memory uintNums) = liquidityPool
        .getLiquidityPoolInfo();
        require(isRunning, "pool is not running");
        console.log("isRunning", isRunning);
        collateral = IERC20Upgradeable(addresses[5]);
        collateralDecimals = uintNums[0];
        isSettled = false;

        reInvestor = _reInvestor;
        usdLemma = _usdLemma;

        //approve collateral to
        //TODO: use SafeERC20Upgreadeable
        collateral.approve(address(liquidityPool), MAX_UINT256);
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
        // logInt("targetLeverage", targetLeverage); //it's 10* 10^18
    }

    //temporariley removing the view modifier from below function as logInt is not a view function
    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        public
        returns (uint256 collateralAmountRequired)
    {
        int256 tradeAmount = isShorting ? -amount.toInt256() : amount.toInt256();
        (int256 deltaCash, ) = liquidityPool.queryTradeWithAMM(perpetualIndex, -tradeAmount);

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
        int256 fees = (deltaCash * totalFeeRate) / EXP_SCALE;
        logInt("Fees", fees);

        logInt("deltaCash", deltaCash);
        // liquidityPool.deposit(perpetualIndex, address(this), collateralNeeded.toInt256());
        collateralAmountRequired = isShorting ? uint256(-(deltaCash + fees)) : uint256((deltaCash - fees));
    }

    function logInt(string memory name, int256 number) internal {
        console.log(name);
        if (number < 0) {
            console.log(" -", uint256(-number));
        } else {
            console.log(" ", uint256(number));
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

    function rebalance() external returns (uint256) {
        //check the funding payments
        uint256 fundingPayment = 0;
        open(fundingPayment);
        uint256 usdlToMintAmount = 0;
        return usdlToMintAmount;
        //call open()
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
