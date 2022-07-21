// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;

import { IPerpetualMixDEXWrapper } from "../contracts/interfaces/IPerpetualMixDEXWrapper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../contracts/interfaces/IERC20Decimals.sol";
// import "../contracts/interfaces/Perpetual/IClearingHouse.sol";
import "src/Deploy.sol";
import "forge-std/Test.sol";
import "forge-std/console.sol";

contract PerpLemmaTest is Test {
    Deploy public d;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ONLY_OWNER = keccak256("ONLY_OWNER");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");
    bytes32 public constant PERPLEMMA_ROLE = keccak256("PERPLEMMA_ROLE");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    function setUp() public {
        d = new Deploy(10);
        vm.startPrank(address(d));
        d.pl().setUSDLemma(address(d.usdl()));
        d.pl().transferOwnership(address(this));
        d.pl().grantRole(USDC_TREASURY, address(this));
        vm.stopPrank();
    }

    // Internal

    function _deductFees(address collateral, uint256 collateralAmount, uint256 dexIndex) internal view returns(uint256 total) {
        uint256 _fees = collateralAmount * d.usdl().getFees(dexIndex, collateral) / 1e6;
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

    function _depositSettlementTokenMax() internal {
        _getMoney(address(d.pl().usdc()), 1e40);
        uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get 
        // V_GTSTBC: greater than settlement token balance cap
        d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        d.pl().depositSettlementToken(settlementTokenBalanceCap/10);
    }

    // USDLemma Functions To test

    function depositIntoVault(uint256 amount, address to) internal {
        _getMoneyForTo(to, address(d.pl().usdc()), amount);
        d.pl().usdc().approve(address(d.getPerps().pv), type(uint256).max);
        d.getPerps().pv.deposit(address(d.pl().usdc()), amount);
    }

    function _mintUSDLWExactUSDL(address to, address collateral, uint256 amount) internal {
        address usdl = d.pl().usdLemma();
        _getMoneyForTo(to, collateral, amount);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(usdl, type(uint256).max);
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        // 4th param is maxCollateralAmountRequired which is need to be set using callStatic, currently set uint256 max
        // calsstatic is not possible in solidity so
        d.usdl().depositTo(to, amount, 0, type(uint256).max, IERC20Upgradeable(collateral));
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();        
        uint256 afterBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        assertEq(afterTotalUsdl-beforeTotalUsdl, afterBalanceUSDL);
        assertTrue(afterBalanceUSDL > beforeBalanceUSDL);
        assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    }

    function _mintUSDLWExactCollateral(address to, address collateral, uint256 amount) internal {
        address usdl = d.pl().usdLemma();
        _getMoneyForTo(to, collateral, amount);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(usdl, type(uint256).max);
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        // 4th param is minUSDLToMint which is need to be set using callStatic, currently set 0 for not breaking revert
        // calsstatic is not possible in solidity so
        d.usdl().depositToWExactCollateral(to, amount, 0, 0, IERC20Upgradeable(collateral)); 
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        assertEq(afterTotalUsdl-beforeTotalUsdl, afterBalanceUSDL);
        assertTrue(afterBalanceUSDL > beforeBalanceUSDL);
        assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    }
    
    function _redeemUSDLWExactUsdl(address to, address collateral, uint256 amount) internal {
        address usdl = d.pl().usdLemma();
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        assertTrue(beforeBalanceUSDL > 0, "!USDL");
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        d.usdl().withdrawTo(to, amount, 0, 0, IERC20Upgradeable(collateral));
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 afterBalanceUSDL = d.usdl().balanceOf(to);
        assertEq(beforeTotalUsdl-amount, afterTotalUsdl);
        assertTrue(afterBalanceCollateral > beforeBalanceCollateral);
        assertTrue(afterBalanceUSDL < beforeBalanceUSDL);
    }

    function _redeemUSDLWExactCollateral(address to, address collateral, uint256 collateralAmount) internal {
        address usdl = d.pl().usdLemma();
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        assertTrue(beforeBalanceUSDL > 0, "!USDL");
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        d.usdl().withdrawToWExactCollateral(to, collateralAmount, 0, type(uint256).max, IERC20Upgradeable(collateral));
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 afterBalanceUSDL = d.usdl().balanceOf(to);
        assertEq(beforeTotalUsdl-afterTotalUsdl, beforeBalanceUSDL-afterBalanceUSDL);
        assertTrue(afterBalanceCollateral > beforeBalanceCollateral);
        assertTrue(afterBalanceUSDL < beforeBalanceUSDL);
    }

    // test depositTo
    function testDepositTo() public {
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = 1000e18; // USDL amount
        _depositSettlementTokenMax();
        _mintUSDLWExactUSDL(address(this), collateral, usdlAmount);
    }

    // test depositToWExactCollateral
    function testDepositToWExactCollateral() public {
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;
        _depositSettlementTokenMax();
        _mintUSDLWExactCollateral(address(this), collateral, collateralAmount);
    }

    // test depositTo and withdrawTo
    function testDepositToAndWithdrawTo() public {
        testDepositTo();
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount);
    }

    // test depositToWExactCollateral and withdrawTo
    function testDepositToWExactCollateralAndwithdrawTo() public {
        testDepositToWExactCollateral();
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount);
    }

    // test depositToWExactCollateral and withdrawToWExactCollateral
    function testDepositToWExactCollateralAndwithdrawToWExactCollateral() public {
        testDepositToWExactCollateral();
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAMount = 1e18;
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAMount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem);
    }

    // test depositTo and withdrawToWExactCollateral
    function testDepositToAndWithdrawToWExactCollateral() public {
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = 1096143206913675032725; // 1eth ~= 1096.143 USDL at this block 12137998
        _depositSettlementTokenMax();
        _mintUSDLWExactUSDL(address(this), collateral, usdlAmount);
        uint256 collateralAMount = 1e18; // ~0.9998 eth
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAMount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem);
    }
}