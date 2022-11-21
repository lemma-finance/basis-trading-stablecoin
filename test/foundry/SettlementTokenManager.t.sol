// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

import {IPerpetualMixDEXWrapper} from "../../contracts/interfaces/IPerpetualMixDEXWrapper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../../contracts/interfaces/IERC20Decimals.sol";
import "../../src/Deploy.sol";
import "forge-std/Test.sol";

contract SettlementTokenManagerTest is Test {
    Deploy public d;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant LEMMA_SWAP = keccak256("LEMMA_SWAP");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");

    function setUp() public {
        d = new Deploy(10);
        vm.startPrank(address(d));
        d.pl().grantRole(USDC_TREASURY, address(this));
        d.usdl().grantRole(LEMMA_SWAP, address(this));
        d.usdl().addPerpetualDEXWrapper(1, d.getTokenAddress("USDC"), address(d.pl()));
        vm.stopPrank();
    }

    // Internal Functions
    function _deductFees(address collateral, uint256 collateralAmount, uint256 dexIndex)
        internal
        view
        returns (uint256 total)
    {
        uint256 _fees = (collateralAmount * d.usdl().getFees(dexIndex, collateral)) / 1e6;
        total = uint256(int256(collateralAmount) - int256(_fees));
    }

    function _getMoney(address token, uint256 amount) internal {
        d.bank().giveMoney(token, address(this), amount);
        assertTrue(IERC20Decimals(token).balanceOf(address(this)) >= amount);
    }

    function _getMoneyForTo(address to, address token, uint256 amount) internal {
        d.bank().giveMoney(token, to, amount);
        assertTrue(IERC20Decimals(token).balanceOf(to) >= amount);
    }

    function getRoudDown(uint256 amount) internal pure returns (uint256) {
        return amount - 1;
    }

    function _depositSettlementTokenMax() internal {
        IERC20Decimals settlementToken = IERC20Decimals(d.pl().perpVault().getSettlementToken());
        uint256 perpVaultSettlementTokenBalanceBefore = settlementToken.balanceOf(address(d.pl().perpVault()));
        uint256 settlementTokenBalanceCap =
            IClearingHouseConfig(d.pl().clearingHouse().getClearingHouseConfig()).getSettlementTokenBalanceCap();
        uint256 usdcToDeposit =
            uint256(int256(settlementTokenBalanceCap) - int256(perpVaultSettlementTokenBalanceBefore));
        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get
        // V_GTSTBC: greater than settlement token balance cap
        _getMoney(address(d.pl().usdc()), usdcToDeposit / 2);
        d.pl().usdc().approve(address(d.pl()), usdcToDeposit);
        d.pl().depositSettlementToken(usdcToDeposit / 2);
    }

    function _mintUSDLWExactUSDL(address to, address collateral, uint256 amount) internal {
        address usdl = d.pl().usdLemma();
        _getMoneyForTo(to, collateral, 1000e6);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(usdl, type(uint256).max);
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        d.usdl().depositTo(to, amount, 1, type(uint256).max, IERC20Upgradeable(collateral));
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        assertEq(afterTotalUsdl - beforeTotalUsdl, afterBalanceUSDL);
        assertTrue(afterBalanceUSDL > beforeBalanceUSDL);
        assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    }

    function _redeemUSDLWExactUsdl(address to, address collateral, uint256 amount) internal {
        address usdl = d.pl().usdLemma();
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        assertTrue(beforeBalanceUSDL > 0, "!USDL");
        // uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        d.usdl().withdrawTo(to, amount, 1, 0, IERC20Upgradeable(collateral));
        // uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 afterBalanceUSDL = d.usdl().balanceOf(to);
        assertTrue(afterBalanceCollateral > beforeBalanceCollateral);
        assertTrue(afterBalanceUSDL < beforeBalanceUSDL);
    }

    // test depositTo
    function testDepositToForUSDCTreasury() public {
        address collateral = d.getTokenAddress("USDC");
        uint256 usdlAmount = 1000e18; // USDL amount
        _depositSettlementTokenMax();
        _mintUSDLWExactUSDL(address(this), collateral, usdlAmount);
    }

    // test depositTo and withdrawTo
    function testDepositToAndWithdrawToForUSDCTreasury() public {
        testDepositToForUSDCTreasury();
        address collateral = d.getTokenAddress("USDC");
        uint256 usdlAmount = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount);
    }

    //test minUSDCinWETHPerpDEXWrapper check
    function testFailMinUSDCInWETHPerpDEXWrapperCheck() public {
        address collateral = d.getTokenAddress("USDC");
        testDepositToForUSDCTreasury();
        uint256 usdcInWETHPerpDexWrapper = d.pl().perpVault().getFreeCollateralByToken(address(d.pl()), collateral);

        vm.startPrank(address(d));
        d.settlementTokenManager().setMinUSDCInWETHPerpDEXWrapper(usdcInWETHPerpDexWrapper);
        vm.stopPrank();

        uint256 usdlAmount = 1 ether;
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount);
    }

    function testSetUSDLemma1() public {
        vm.startPrank(address(d));
        d.settlementTokenManager().setUSDLemma(vm.addr(1));
        address newUsdLemma = d.settlementTokenManager().usdLemma();
        assertEq(newUsdLemma, vm.addr(1));
        vm.stopPrank();
    }

    function testSetRebalancer1() public {
        vm.startPrank(address(d));
        d.settlementTokenManager().setRebalancer(vm.addr(1));
        address newRebalancer = d.settlementTokenManager().reBalancer();
        assertEq(newRebalancer, vm.addr(1));
        vm.stopPrank();
    }
}
