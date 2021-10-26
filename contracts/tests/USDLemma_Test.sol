// Adds Test library to the context
import { Test, Display } from "@giry/hardhat-test-solidity/test.sol";
import { USDLemma, IERC20Upgradeable, SafeMathExt, SafeCastUpgradeable } from "../USDLemma.sol";
import { MCDEXLemma, ILiquidityPool } from "../wrappers/MCDEXLemma.sol";
import { MCDEXAdresses } from "./MCDEXAdresses.sol";
import { Helper } from "./Helper.sol";
import { AddressUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "hardhat/console.sol";

contract USDLemma_Test {
    using SafeCastUpgradeable for int256;
    using SafeMathExt for int256;
    using SafeMathExt for uint256;

    USDLemma usdLemma;
    MCDEXLemma mcdexLemma;
    MCDEXAdresses mcdexAdresses = new MCDEXAdresses();
    Helper helper = new Helper();
    ILiquidityPool public liquidityPool = ILiquidityPool(mcdexAdresses.liquidityPool());
    address constant trustedForwarder = address(0);
    uint256 constant perpetualIndex = 0;
    uint256 constant perpetualDEXIndex = 0;
    IERC20Upgradeable collateral;

    function _beforeAll() public {
        usdLemma = new USDLemma();
        mcdexLemma = new MCDEXLemma();
    }

    function deposit_test() public {
        prepare();
        uint256 collateralBalanceBefore = collateral.balanceOf(address(this));
        uint256 amount = 100 ether;
        uint256 collateralAmountRequired = deposit(amount);
        int256 leverage = calculateLeverge();
        Test.eq(usdLemma.balanceOf(address(this)), amount, "not minted correctly");
        Test.eq(
            collateralBalanceBefore - collateral.balanceOf(address(this)),
            collateralAmountRequired,
            "collateral transferred incorrectly"
        );
        Test.eq(leverage.toUint256(), 1 ether, "leverge !=1");
    }

    function withdraw_test() public {
        prepare();
        uint256 amount = 100 ether;
        deposit(amount);
        uint256 collateralBalanceBefore = collateral.balanceOf(address(this));
        uint256 collateralAmountToGetBack = withdraw(amount);

        Test.eq(usdLemma.balanceOf(address(this)), uint256(0), "not minted correctly");
        Test.eq(
            collateral.balanceOf(address(this)) - collateralBalanceBefore,
            collateralAmountToGetBack,
            "collateral transferred incorrectly"
        );
    }

    function reBalance_test() public {
        prepare();
        uint256 ethInput = helper.getCost(liquidityPool, perpetualIndex, 1 ether);
        int256 deltaMargin = int256(ethInput);
        helper.getAmountGivenCollateral(liquidityPool, perpetualIndex, deltaMargin);
    }

    function deposit(uint256 amount) public returns (uint256 collateralAmountRequiredInDecimals) {
        uint256 collateralAmountRequired = mcdexLemma.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        collateralAmountRequiredInDecimals = mcdexLemma.getAmountInCollateralDecimals(collateralAmountRequired, true);
        collateral.approve(address(usdLemma), collateralAmountRequiredInDecimals);
        usdLemma.deposit(amount, perpetualDEXIndex, collateralAmountRequiredInDecimals, collateral);
    }

    function withdraw(uint256 amount) public returns (uint256 collateralAmountRequiredInDecimals) {
        uint256 collateralAmountRequired = mcdexLemma.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
        collateralAmountRequiredInDecimals = mcdexLemma.getAmountInCollateralDecimals(collateralAmountRequired, false);
        usdLemma.withdraw(amount, perpetualDEXIndex, collateralAmountRequiredInDecimals, collateral);
    }

    function calculateLeverge() internal returns (int256 leverage) {
        int256 markPrice;
        int256 keeperGasReward;
        int256 unitAccumulativeFunding;
        int256 initialMarginRate;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            markPrice = nums[1];
            keeperGasReward = nums[11];
            unitAccumulativeFunding = nums[4];
            initialMarginRate = nums[5];
        }
        {
            int256 reservedCash = keeperGasReward;
            logInt("reservedCash", reservedCash);
            (
                int256 cash,
                int256 position,
                int256 availableMarginFromMCDEX,
                int256 marginBalanceFromMCDEX,
                ,
                ,
                ,
                ,

            ) = liquidityPool.getMarginAccount(perpetualIndex, address(mcdexLemma));
            // logInt("position", position);
            // logInt("cash", cash);
            int256 positionValue = markPrice.wmul(position.abs());
            logInt("positionValue", positionValue);
            int256 positionMargin = positionValue.wmul(initialMarginRate);

            int256 availableCashBalance = cash - (position.wmul(unitAccumulativeFunding));
            //marginBalanceFromMCDEX(margin) ==  marginBalance
            int256 marginBalance = availableCashBalance + (markPrice.wmul(position));
            logInt("marginBalanceFromMCDEX", marginBalanceFromMCDEX);
            logInt("marginBalance", marginBalance);
            int256 availableMargin = marginBalance - positionMargin - reservedCash;
            // logInt("availableMarginFromMCDEX", availableMarginFromMCDEX);
            // logInt("availableMargin", availableMargin);

            int256 marginWithoutReserved = marginBalance - reservedCash;

            leverage = positionValue.wdiv(marginWithoutReserved);
        }

        console.log("leverage", leverage.toUint256());
    }

    function logInt(string memory name, int256 num) internal view {
        if (num >= 0) {
            console.log(name, ":  ", num.toUint256());
        } else {
            console.log(name, ": -", num.abs().toUint256());
        }
    }

    function prepare() public {
        address reBalancer = address(0);
        uint256 maxPosition = type(uint256).max - 1;

        liquidityPool = ILiquidityPool(mcdexAdresses.liquidityPool());
        // Test.eq(AddressUpgradeable.isContract(address(liquidityPool)), true, "see contracts/tests/MCDEXAdresses.sol");
        // console.log("isContract", AddressUpgradeable.isContract(address(liquidityPool)));

        mcdexLemma.initialize(
            trustedForwarder,
            liquidityPool,
            perpetualIndex,
            address(usdLemma),
            reBalancer,
            maxPosition
        );
        collateral = mcdexLemma.collateral();
        usdLemma.initialize(trustedForwarder, address(collateral), address(mcdexLemma));

        //send some eth to WETH (collateral address)
        address(collateral).call{ value: 100 ether }("");

        //add liquidity
        int256 liquidityToAdd = 10 ether;
        collateral.approve(address(liquidityPool), liquidityToAdd.toUint256());
        address(liquidityPool).call(abi.encodeWithSignature("addLiquidity(int256)", liquidityToAdd));

        int256 keeperGasReward;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            keeperGasReward = nums[11];
        }

        collateral.approve(
            address(mcdexLemma),
            mcdexLemma.getAmountInCollateralDecimals(keeperGasReward.toUint256(), true)
        );
        mcdexLemma.depositKeeperGasReward();
    }

    receive() external payable {}
}
