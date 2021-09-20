// Adds Test library to the context
import { Test, Display } from "@giry/hardhat-test-solidity/test.sol";
import { USDLemma, IERC20Upgradeable, SafeMathExt, SafeCastUpgradeable } from "../USDLemma.sol";
import { MCDEXLemma, ILiquidityPool } from "../wrappers/MCDEXLemma.sol";
import { MCDEXAdresses } from "./MCDEXAdresses.sol";
import { AddressUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "hardhat/console.sol";

contract USDLemma_Test {
    using SafeCastUpgradeable for int256;
    using SafeMathExt for int256;
    using SafeMathExt for uint256;

    USDLemma usdLemma;
    MCDEXLemma mcdexLemma;
    MCDEXAdresses mcdexAdresses = new MCDEXAdresses();
    ILiquidityPool liquidityPool;
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
        uint256 amount = 10 ether;
        uint256 collateralAmountRequired = deposit(amount);

        Test.eq(usdLemma.balanceOf(address(this)), amount, "not minted correctly");
        Test.eq(
            collateralBalanceBefore - collateral.balanceOf(address(this)),
            collateralAmountRequired,
            "collateral transferred incorrectly"
        );
    }

    function deposit(uint256 amount) public returns (uint256 collateralAmountRequiredInDecimals) {
        uint256 collateralAmountRequired = mcdexLemma.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        collateralAmountRequiredInDecimals = mcdexLemma.getAmountInCollateralDecimals(collateralAmountRequired, true);
        collateral.approve(address(usdLemma), collateralAmountRequiredInDecimals);
        usdLemma.deposit(amount, perpetualDEXIndex, collateralAmountRequiredInDecimals, collateral);
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
