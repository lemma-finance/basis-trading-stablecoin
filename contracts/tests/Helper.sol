// Adds Test library to the context
import { Test, Display } from "@giry/hardhat-test-solidity/test.sol";
import { USDLemma, IERC20Upgradeable, SafeMathExt, SafeCastUpgradeable } from "../USDLemma.sol";
import { MCDEXLemma, ILiquidityPool } from "../wrappers/MCDEXLemma.sol";
import { MCDEXAdresses } from "./MCDEXAdresses.sol";
import { AddressUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "hardhat/console.sol";

contract Helper {
    using SafeCastUpgradeable for int256;
    using SafeMathExt for int256;
    using SafeMathExt for uint256;

    function getCost(
        ILiquidityPool liquidityPool,
        uint256 perpetualIndex,
        int256 amount
    ) public view returns (uint256) {
        // liquidityPool.forceToSyncState();
        address referrar = address(0);
        (int256 tradePrice, int256 totalFee, ) = liquidityPool.queryTrade(
            perpetualIndex,
            address(this),
            amount,
            referrar,
            0
        );
        int256 deltaCash = amount.abs().wmul(tradePrice);
        uint256 collateralAmount = (deltaCash + totalFee).toUint256();
        return collateralAmount;
    }

    function getAmountGivenCollateral(
        ILiquidityPool liquidityPool,
        uint256 perpetualIndex,
        int256 deltaMargin
    ) public view returns (int256) {
        //assume deltaMargin is positive

        int256 indexPrice;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            indexPrice = nums[2];
        }
        logInt("indexPrice", indexPrice);
        logInt("deltaMatgin", deltaMargin);
        int256 guess = deltaMargin.wdiv(indexPrice);

        int256 minMaxEstimation = (guess * 1) / (100);
        int256 min = guess - minMaxEstimation;
        int256 max = guess + minMaxEstimation;

        logInt("min", min);
        logInt("max", max);

        int256 steps = 10**10;

        int256 amount = binarySearch(liquidityPool, perpetualIndex, min, max, deltaMargin);
        logInt("amount", amount);
        return amount;
    }

    function binarySearch(
        ILiquidityPool liquidityPool,
        uint256 perpetualIndex,
        int256 min,
        int256 max,
        int256 deltaMargin
    ) internal view returns (int256 amount) {
        int256 mid = min + (max - min) / 2;
        logInt("mid", mid);
        int256 cost = int256(getCost(liquidityPool, perpetualIndex, mid));
        logInt("cost", cost);
        if ((cost - deltaMargin).abs() < 10**6) {
            return mid;
        }
        if (cost > deltaMargin) return binarySearch(liquidityPool, perpetualIndex, min, mid - 1, deltaMargin);

        return binarySearch(liquidityPool, perpetualIndex, mid + 1, max, deltaMargin);
    }

    function logInt(string memory name, int256 num) internal view {
        if (num >= 0) {
            console.log(name, ":  ", num.toUint256());
        } else {
            console.log(name, ": -", num.abs().toUint256());
        }
    }
}
