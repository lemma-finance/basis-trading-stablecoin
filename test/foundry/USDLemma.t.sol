// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;

import { IPerpetualMixDEXWrapper } from "../../contracts/interfaces/IPerpetualMixDEXWrapper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../../contracts/interfaces/IERC20Decimals.sol";
import "../../src/Deploy.sol";
import "forge-std/Test.sol";

contract USDLemmaTest is Test {
    Deploy public d;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant LEMMA_SWAP = keccak256("LEMMA_SWAP");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");

    function setUp() public {
        d = new Deploy(10);
        vm.startPrank(address(d));
        d.pl().grantRole(USDC_TREASURY, address(this));
        d.usdl().grantRole(LEMMA_SWAP, address(this));
        vm.stopPrank();
    }

    // Internal Functions
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
        IERC20Decimals settlementToken = IERC20Decimals(d.pl().perpVault().getSettlementToken());
        uint256 perpVaultSettlementTokenBalanceBefore = settlementToken.balanceOf(address(d.pl().perpVault()));
        uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.pl().clearingHouse().getClearingHouseConfig()).getSettlementTokenBalanceCap();
        uint256 usdcToDeposit = uint256(int256(settlementTokenBalanceCap) - int256(perpVaultSettlementTokenBalanceBefore));
        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get 
        // V_GTSTBC: greater than settlement token balance cap
        d.pl().usdc().approve(address(d.pl()), usdcToDeposit);
        d.pl().depositSettlementToken(usdcToDeposit);
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
        assertEq(beforeTotalUsdl-afterTotalUsdl, amount);
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

    function _depositWExactCollateral(uint256 collateralAmount) internal {
        _depositSettlementTokenMax();
        address collateral = d.getTokenAddress("WETH");
        _mintUSDLWExactCollateral(address(this), collateral, collateralAmount);
    }

    // test depositToWExactCollateral
    function testDepositToWExactCollateral1() public {
        _depositWExactCollateral(1e18);
    }

    function testDepositToWExactCollateral1_demo() public {
        // _depositWExactCollateral(18*1e18);
        // _depositWExactCollateral(100*1e18);
    }

    // test depositTo and withdrawTo
    function testDepositToAndWithdrawTo11() public {
        testDepositTo();
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount);
    }

    // test depositToWExactCollateral and withdrawTo
    function testDepositToWExactCollateralAndwithdrawTo() public {
        uint256 collateralAmount = 1e12;
        _depositWExactCollateral(collateralAmount);
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount);
    }
    
    // test depositToWExactCollateral and withdrawToWExactCollateral
    function testDepositToWExactCollateralAndwithdrawToWExactCollateral() public {
        uint256 collateralAmount = 1e12;
        _depositWExactCollateral(collateralAmount);
        address collateral = d.getTokenAddress("WETH");
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAmount, 0);
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

    // Should Fail tests
    // REVERT REASON: only lemmaswap is allowed
    function testFailDepositToAndWithdrawToWExactCollateral() public {
        vm.startPrank(address(d));
        d.usdl().revokeRole(LEMMA_SWAP, address(this));
        vm.stopPrank();

        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = 1096143206913675032725; // 1eth ~= 1096.143 USDL at this block 12137998
        _depositSettlementTokenMax();
        _mintUSDLWExactUSDL(address(this), collateral, usdlAmount);
        uint256 collateralAMount = 1e18; // ~0.9998 eth
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAMount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem);
    }

    function testFailDepositToWExactCollateralAndwithdrawToWExactCollateral() public {
        vm.startPrank(address(d));
        d.usdl().revokeRole(LEMMA_SWAP, address(this));
        vm.stopPrank();

        uint256 collateralAmount = 1e12;
        _depositWExactCollateral(collateralAmount);
        address collateral = d.getTokenAddress("WETH");
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAmount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem);
    }

    // Should Fail tests
    // reason: DEX Wrapper should not ZERO address
    function testFailGetFees1() public view {
        d.usdl().getFees(0, address(0));
    }

    // reason: DEX Wrapper should not ZERO address
    function testFailGetFees2() public view {
        d.usdl().getFees(100, d.getTokenAddress("WETH"));
    }

    function testFailGetIndexPrice1() public view {
        d.usdl().getIndexPrice(100, d.getTokenAddress("WETH"));
    }

    function testFailGetIndexPrice2() public view {
        d.usdl().getIndexPrice(0, address(0));
    }

    function testFailGetTotalPosition1() public view {
        d.usdl().getTotalPosition(0, address(0));
    }

    function testFailGetTotalPosition2() public view {
        d.usdl().getTotalPosition(100, d.getTokenAddress("WETH"));
    }

    function testFailSetLemmaTreasury() public {
        d.usdl().setLemmaTreasury(address(0));
    }

    function testSetLemmaTreasury() public {
        vm.startPrank(address(d));
        d.usdl().setLemmaTreasury(vm.addr(1));
        address lemmaTreasury = d.usdl().lemmaTreasury();
        assertEq(lemmaTreasury, vm.addr(1));
        vm.stopPrank();
    }

    function testSetFees() public {
        vm.startPrank(address(d));
        d.usdl().setFees(1000);
        uint256 fees = d.usdl().fees();
        assertEq(fees, 1000);
        vm.stopPrank();
    }

    function testAddWrapper() public {
        vm.startPrank(address(d));
        d.usdl().addPerpetualDEXWrapper(1, d.getTokenAddress("USDC"), vm.addr(1));
        address wrapper = d.usdl().perpetualDEXWrappers(1, d.getTokenAddress("USDC"));
        assertEq(wrapper, vm.addr(1));
        vm.stopPrank();
    }

    // reason: invalid DEX/collateral
    function testFailDepositTo1() public {
        d.usdl().depositTo(address(this), 1000, 0, 1, IERC20Decimals(address(0)));
    }

    // reason: collateral required execeeds maximum
    function testFailDepositTo2() public {
        _depositSettlementTokenMax();
        address collateral = d.getTokenAddress("WETH");
        _getMoneyForTo(address(this), collateral, 1000);
        IERC20Decimals(collateral).approve(address(d.usdl()), type(uint256).max);
        d.usdl().depositTo(address(this), 1000, 0, 0, IERC20Decimals(collateral));
    }

    // reason: invalid DEX/collateral
    function testFailDepositToWExactCollateral1() public {
        d.usdl().depositToWExactCollateral(address(this), 1000, 0, type(uint256).max, IERC20Decimals(address(0)));
    }

    // reason: USDL minted too low
    function testFailDepositToWExactCollateral2() public {
        _depositSettlementTokenMax();
        address collateral = d.getTokenAddress("WETH");
        _getMoneyForTo(address(this), collateral, 1000);
        IERC20Decimals(collateral).approve(address(d.usdl()), type(uint256).max);
        d.usdl().depositToWExactCollateral(address(this), 1000, 0, type(uint256).max, IERC20Decimals(collateral));
    }

    // reason: invalid DEX/collateral
    function testFailWithdrawTo1() public {
        d.usdl().withdrawTo(address(this), 1000, 0, 1, IERC20Decimals(address(0)));
    }

    // reason: ERC20: burn amount exceeds balance
    function testFailWithdrawTo2() public {
        address collateral = d.getTokenAddress("WETH");
        d.usdl().withdrawTo(address(this), 100e18, 0, type(uint256).max, IERC20Decimals(collateral));
    }

    // reason: Collateral to get back too low
    function testFailWithdrawTo3() public {
        testDepositTo();
        address collateral = d.getTokenAddress("WETH");
        d.usdl().withdrawTo(address(this), 100e18, 0, type(uint256).max, IERC20Decimals(collateral));
    }

    // reason: Settled vUSD position amount should not ZERO
    function testFailWithdrawToWithSettle1() public {
        address collateral = d.getTokenAddress("WETH");
        testDepositTo();
        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        d.pl().setMintedPositionUsdlForThisWrapper(0);
        d.usdl().withdrawTo(address(this), 100e18, 0, 0, IERC20Decimals(collateral));
    }

    function testWithdrawToWithSettle2() public {
        address collateral = d.getTokenAddress("WETH");
        testDepositTo();
        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        uint256 beforeBalance = IERC20Decimals(collateral).balanceOf(address(this));
        d.usdl().withdrawTo(address(this), 100e18, 0, 0, IERC20Decimals(collateral));
        uint256 afterBalance = IERC20Decimals(collateral).balanceOf(address(this));
        assertGe(afterBalance-beforeBalance, 0);
    }

    // reason: invalid DEX/collateral
    function testFailWithdrawToWExactCollateral1() public {
        d.usdl().withdrawToWExactCollateral(address(this), 1000, 0, 0, IERC20Decimals(address(0)));
    }

    // reason: Too much USDL to burn
    function testFailWithdrawToWExactCollateral2() public {
        testDepositTo();
        address collateral = d.getTokenAddress("WETH");
        d.usdl().withdrawToWExactCollateral(address(this), 1e17, 0, 0, IERC20Decimals(collateral));
    }

    // reason: hasSettled Error
    function testFailWithdrawToWExactCollateral3() public {
        address collateral = d.getTokenAddress("WETH");
        testDepositTo();
        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        d.usdl().withdrawToWExactCollateral(address(this), 1e17, 0, 0, IERC20Decimals(collateral));
    }
}