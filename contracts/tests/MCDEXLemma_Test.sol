// // Adds Test library to the context
// import { Test, Display } from "@giry/hardhat-test-solidity/test.sol";
// import { USDLemma, IERC20Upgradeable, SafeMathExt, SafeCastUpgradeable } from "../USDLemma.sol";
// import { MCDEXLemma, ILiquidityPool } from "../wrappers/MCDEXLemma.sol";
// import { MCDEXAdresses } from "./MCDEXAdresses.sol";
// import { AddressUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
// import "hardhat/console.sol";

// contract MCDEXLemma_Test {
//     using SafeCastUpgradeable for int256;
//     using SafeMathExt for int256;
//     using SafeMathExt for uint256;

//     MCDEXLemma mcdexLemma;
//     MCDEXAdresses mcdexAdresses = new MCDEXAdresses();
//     ILiquidityPool liquidityPool;
//     address constant trustedForwarder = address(0);
//     uint256 constant perpetualIndex = 0;
//     uint256 constant perpetualDEXIndex = 0;
//     IERC20Upgradeable collateral;

//     function _beforeAll() public {
//         mcdexLemma = new MCDEXLemma();
//     }

//     function deposit_test() public {
//         Test.eq(1 ether, 1 ether, "leverge !=1");
//     }

//     function prepare() public {
//         address reBalancer = address(0);
//         uint256 maxPosition = type(uint256).max - 1;

//         liquidityPool = ILiquidityPool(mcdexAdresses.liquidityPool());
//         // Test.eq(AddressUpgradeable.isContract(address(liquidityPool)), true, "see contracts/tests/MCDEXAdresses.sol");
//         // console.log("isContract", AddressUpgradeable.isContract(address(liquidityPool)));

//         mcdexLemma.initialize(
//             trustedForwarder,
//             liquidityPool,
//             perpetualIndex,
//             address(this),
//             reBalancer,
//             maxPosition
//         );
//         collateral = mcdexLemma.collateral();

//         //send some eth to WETH (collateral address)
//         address(collateral).call{ value: 100 ether }("");

//         //add liquidity
//         int256 liquidityToAdd = 10 ether;
//         collateral.approve(address(liquidityPool), liquidityToAdd.toUint256());
//         address(liquidityPool).call(abi.encodeWithSignature("addLiquidity(int256)", liquidityToAdd));

//         int256 keeperGasReward;
//         {
//             (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
//             keeperGasReward = nums[11];
//         }

//         collateral.approve(
//             address(mcdexLemma),
//             mcdexLemma.getAmountInCollateralDecimals(keeperGasReward.toUint256(), true)
//         );
//         mcdexLemma.depositKeeperGasReward();
//     }

//     receive() external payable {}

// }
