// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;

import { IPerpetualMixDEXWrapper } from "../../contracts/interfaces/IPerpetualMixDEXWrapper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../../contracts/interfaces/IERC20Decimals.sol";
import "../../src/Deploy.sol";
import "forge-std/Test.sol";

contract LemmaSynthTest is Test {
    Deploy public d;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant LEMMA_SWAP = keccak256("LEMMA_SWAP");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");

    function setUp() public {
        d = new Deploy(10);
        vm.startPrank(address(d));
        d.pl().setUSDLemma(address(d.usdl()));
        d.pl().grantRole(USDC_TREASURY, address(this));
        d.lSynth().grantRole(LEMMA_SWAP, address(this));
        d.lSynth().grantRole(LEMMA_SWAP, address(d));
        vm.stopPrank();
    }

    // Internal Functions
    
    function _deductFees(address collateral, uint256 collateralAmount, uint256 dexIndex) internal view returns(uint256 total) {
        // TODO: Need to fix 100 extra fees, remove 100 extra fees and used callstatic instead like in js we used
        uint256 fees = collateralAmount * (d.lSynth().getFees(dexIndex, collateral)+100) / 1e6;
        total = uint256(int256(collateralAmount) - int256(fees));
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

    // LemmaSynth Functions To test

    function depositIntoVault(uint256 amount, address to) internal {
        _getMoneyForTo(to, address(d.pl().usdc()), amount);
        d.pl().usdc().approve(address(d.getPerps().pv), type(uint256).max);
        d.getPerps().pv.deposit(address(d.pl().usdc()), amount);
    }

    function _mintSynthWExactSynth(address to, address collateral, uint256 synthAmount, uint256 usdcAmount ) internal {
        address lemmaSynth = d.pl().lemmaSynth();
        _getMoneyForTo(to, collateral, usdcAmount);
        uint256 beforeBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(lemmaSynth, type(uint256).max);
        uint256 beforeTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        // 4th param is maxCollateralAmountRequired which is need to be set using callStatic, currently set uint256 max
        // calsstatic is not possible in solidity so
        d.lSynth().depositTo(to, synthAmount, 0, type(uint256).max, IERC20Upgradeable(collateral));
        uint256 afterTotalSynth = d.pl().mintedPositionSynthForThisWrapper();        
        uint256 afterBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        assertEq(afterTotalSynth-beforeTotalSynth, afterBalanceSynth);
        assertTrue(afterBalanceSynth > beforeBalanceSynth);
        assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    }

    function _mintSynthWExactCollateral(address to, address collateral, uint256 usdcAmount) internal {
        address lemmaSynth = d.pl().lemmaSynth();
        _getMoneyForTo(to, collateral, usdcAmount);
        uint256 beforeBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(lemmaSynth, type(uint256).max);
        uint256 beforeTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 decimal = IERC20Decimals(collateral).decimals();
        usdcAmount = (usdcAmount*1e18) / 10**decimal;
        // 4th param is minSynthToMint which is need to be set using callStatic, currently set 0 for not breaking revert
        // calsstatic is not possible in solidity so
        d.lSynth().depositToWExactCollateral(to, usdcAmount, 0, 0, IERC20Upgradeable(collateral)); 
        uint256 afterTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 afterBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        assertEq(afterTotalSynth-beforeTotalSynth, afterBalanceSynth);
        assertTrue(afterBalanceSynth > beforeBalanceSynth);
        assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    }
    
    function _redeemSynthWExactSynth(address to, address collateral, uint256 synthAmount) internal {
        address lemmaSynth = d.pl().lemmaSynth();
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 beforeBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        assertTrue(beforeBalanceSynth > 0, "!Synth");
        uint256 beforeTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        d.lSynth().withdrawTo(to, synthAmount, 0, 0, IERC20Upgradeable(collateral));
        uint256 afterTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 afterBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        assertEq(beforeTotalSynth-synthAmount, afterTotalSynth);
        assertTrue(afterBalanceCollateral > beforeBalanceCollateral);
        assertTrue(afterBalanceSynth < beforeBalanceSynth);
    }

    function _redeemSynthWExactCollateral(address to, address collateral, uint256 usdcAmount) internal {
        address lemmaSynth = d.pl().lemmaSynth();
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 beforeBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        assertTrue(beforeBalanceSynth > 0, "!Synth");
        uint256 beforeTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        d.lSynth().withdrawToWExactCollateral(to, usdcAmount, 0, type(uint256).max, IERC20Upgradeable(collateral));
        uint256 afterTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 afterBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        // console.log('beforeBalanceSynth: ', beforeBalanceSynth);
        // console.log('afterBalanceSynth: ', afterBalanceSynth);
        // console.log('beforeTotalSynth: ', beforeTotalSynth);
        // console.log('afterTotalSynth: ', afterTotalSynth);
        // console.log('beforeBalanceCollateral: ', beforeBalanceCollateral);
        // console.log('afterBalanceCollateral: ', afterBalanceCollateral);
        // console.log('beforeTotalSynth-afterTotalSynth: ', beforeTotalSynth-afterTotalSynth);
        // console.log('beforeBalanceSynth-afterBalanceSynth: ', beforeBalanceSynth-afterBalanceSynth);
        assertEq(beforeTotalSynth-afterTotalSynth, beforeBalanceSynth-afterBalanceSynth);
        assertTrue(afterBalanceCollateral > beforeBalanceCollateral);
        assertTrue(afterBalanceSynth < beforeBalanceSynth);
    }

    // test depositTo
    function testDepositToForSynth() public {
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 9e17; // USDL amount
        uint256 usdcAmount = 1100e6; // USDL amount
        _depositSettlementTokenMax();
        _mintSynthWExactSynth(address(this), collateral, synthAmount, usdcAmount);
    }

    // test depositToWExactCollateral
    function testDepositToWExactCollateralForSynth() public {
        address collateral = d.getTokenAddress("USDC");
        uint256 usdcAmount = 1100e6; // USDL amount
        _depositSettlementTokenMax();
        _mintSynthWExactCollateral(address(this), collateral, usdcAmount);
    }

    // test depositTo and withdrawTo
    function testDepositToAndWithdrawToForSynth() public {
        testDepositToForSynth();
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = d.lSynth().balanceOf(address(this));
        _redeemSynthWExactSynth(address(this), collateral, synthAmount);
    }

    // test depositToWExactCollateral and withdrawTo
    function testDepositToWExactCollateralAndwithdrawTo() public {
        testDepositToWExactCollateralForSynth();
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = d.lSynth().balanceOf(address(this));
        _redeemSynthWExactSynth(address(this), collateral, synthAmount);
    }

    // test depositToWExactCollateral and withdrawToWExactCollateral
    function testDepositToWExactCollateralAndwithdrawToWExactCollateralForSynth() public {
        testDepositToWExactCollateralForSynth();
        address collateral = d.getTokenAddress("USDC");
        uint256 collateralAmount = 1100e18; // USDC 
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("USDC"), collateralAmount, 0);
        uint256 _maxUSDCtoRedeem = _deductFees(d.getTokenAddress("USDC"), _collateralAfterMinting, 0);
        _redeemSynthWExactCollateral(address(this), collateral, _maxUSDCtoRedeem);
    }

    // test depositTo and withdrawToWExactCollateral
    function testDepositToAndWithdrawToWExactCollateralForSynth() public {
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 9e17; // USDL amount
        uint256 usdcAmount = 1100e6; // USDL amount
        _depositSettlementTokenMax();
        _mintSynthWExactSynth(address(this), collateral, synthAmount, usdcAmount);

        uint256 collateralAmount = 988635431772441083946; // ~0.9998 eth
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("USDC"), collateralAmount, 0);
        uint256 _maxUSDCtoRedeem = _deductFees(d.getTokenAddress("USDC"), _collateralAfterMinting, 0);
        _redeemSynthWExactCollateral(address(this), collateral, _maxUSDCtoRedeem);
    }

    // Should Fail tests
    // REVERT REASON: only lemmaswap is allowed
    function testFailWithExpectRevertDepositToAndWithdrawToWExactCollateralForSynth() public {
        vm.startPrank(address(d));
        d.lSynth().revokeRole(LEMMA_SWAP, address(this));
        vm.stopPrank();

        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 9e17; // USDL amount
        uint256 usdcAmount = 1100e6; // USDL amount
        _depositSettlementTokenMax();
        _mintSynthWExactSynth(address(this), collateral, synthAmount, usdcAmount);

        uint256 collateralAmount = 988635431772441083946; // ~0.9998 eth
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("USDC"), collateralAmount, 0);
        uint256 _maxUSDCtoRedeem = _deductFees(d.getTokenAddress("USDC"), _collateralAfterMinting, 0);
        // vm.expectRevert(bytes("only lemmaswap is allowed"));
        d.lSynth().withdrawToWExactCollateral(address(this), _maxUSDCtoRedeem, 0, type(uint256).max, IERC20Upgradeable(collateral));
    }

    function testFailDepositToWExactCollateralAndwithdrawToWExactCollateralForSynth() public {
        vm.startPrank(address(d));
        d.lSynth().revokeRole(LEMMA_SWAP, address(this));
        vm.stopPrank();
        testDepositToWExactCollateralForSynth();
        address collateral = d.getTokenAddress("USDC");
        uint256 collateralAmount = 1100e18; // USDC 
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("USDC"), collateralAmount, 0);
        uint256 _maxUSDCtoRedeem = _deductFees(d.getTokenAddress("USDC"), _collateralAfterMinting, 0);
        _redeemSynthWExactCollateral(address(this), collateral, _maxUSDCtoRedeem);
    }

    // Should Fail tests

    function testFailGetIndexPriceSynth1() public {
        vm.startPrank(address(d));
        d.lSynth().getIndexPrice(11, address(0));
        vm.stopPrank();
    }

    function testFailGetTotalPositionSynth1() public {
        vm.startPrank(address(d));
        d.lSynth().getTotalPosition(11, address(0));
        vm.stopPrank();
    }

    function testSetFeesSynth() public {
        vm.startPrank(address(d));
        d.lSynth().setFees(1000);
        uint256 fees = d.lSynth().fees();
        assertEq(fees, 1000);
        vm.stopPrank();
    }

    // reason: invalid DEX/collateral
    function testFailDepositTo1() public {
        vm.startPrank(address(d));
        d.lSynth().depositTo(address(this), 1000, 1110, 1, IERC20Decimals(address(0)));
        vm.stopPrank();
    }

    // reason: collateral required execeeds maximum
    function testFailDepositTo2() public {
        _depositSettlementTokenMax();
        address collateral = d.getTokenAddress("USDC");
        _getMoneyForTo(address(this), collateral, 1000);
        IERC20Decimals(collateral).approve(address(d.lSynth()), type(uint256).max);
        d.lSynth().depositTo(address(this), 1000, 0, 0, IERC20Decimals(collateral));
    }

    // reason: invalid DEX/collateral
    function testFailDepositToWExactCollateral1() public {
        vm.startPrank(address(d));
        d.lSynth().depositToWExactCollateral(address(this), 1000, 11111, type(uint256).max, IERC20Decimals(address(0)));
        vm.stopPrank();
    }

    // reason: Synth minted too low
    function testFailDepositToWExactCollateral2() public {
        address collateral = d.getTokenAddress("USDC");
        _getMoneyForTo(address(this), collateral, 1000e6);
        IERC20Decimals(collateral).approve(address(d.lSynth()), type(uint256).max);
        d.lSynth().depositToWExactCollateral(address(this), 100e18, 0, type(uint256).max, IERC20Decimals(collateral));
    }

    // reason: invalid DEX/collateral
    function testFailWithdrawTo1() public {
        testDepositToForSynth();
        vm.startPrank(address(d));
        vm.stopPrank();
        d.lSynth().withdrawTo(address(this), 1000, 1111, 1, IERC20Decimals(address(0)));
    }

    // reason: ERC20: burn amount exceeds balance
    function testFailWithdrawTo2() public {
        address collateral = d.getTokenAddress("USDC");
        d.lSynth().withdrawTo(address(this), 1e17, 0, type(uint256).max, IERC20Decimals(collateral));
    }

    // reason: Collateral to get back too low
    function testFailWithdrawTo3() public {
        testDepositToForSynth();
        address collateral = d.getTokenAddress("USDC");
        d.lSynth().withdrawTo(address(this), 1e17, 0, type(uint256).max, IERC20Decimals(collateral));
    }

    // reason: hasSettled Error
    function testFailWithdrawToWithSettle1() public {
        address collateral = d.getTokenAddress("WETH");
        testDepositToForSynth();
        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        d.lSynth().withdrawTo(address(this), 1e17, 0, 0, IERC20Decimals(collateral));
    }

    // reason: invalid DEX/collateral
    function testFailWithdrawToWExactCollateral1() public {
        vm.startPrank(address(d));
        d.lSynth().withdrawToWExactCollateral(address(this), 1000, 111110, 0, IERC20Decimals(address(0)));
        vm.stopPrank();
    }

    // reason: Too much Synth to burn
    function testFailWithdrawToWExactCollateral2() public {
        testDepositToForSynth();
        address collateral = d.getTokenAddress("USDC");
        d.lSynth().withdrawToWExactCollateral(address(this), 100e6, 0, 0, IERC20Decimals(collateral));
    }

    function testWithdrawToWExactCollateralWithSettle() public {
        address collateral = d.getTokenAddress("USDC");
        testDepositToForSynth();
        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        uint256 beforeBalance = IERC20Decimals(collateral).balanceOf(address(this));
        d.lSynth().withdrawToWExactCollateral(address(this), 100e6, 0, type(uint256).max, IERC20Decimals(collateral));
        uint256 afterBalance = IERC20Decimals(collateral).balanceOf(address(this));
        assertGe(afterBalance-beforeBalance, 0);
    }

    // reason: Settled vUSD position amount should not ZERO
    function testFailWithdrawToWExactCollateralWithSettle() public {
        address collateral = d.getTokenAddress("USDC");
        testDepositToForSynth();
        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        d.pl().setMintedPositionSynthForThisWrapper(0);
        d.lSynth().withdrawToWExactCollateral(address(this), 100e18, 0, 0, IERC20Decimals(collateral));
    }

    // Tests for mint and burn lemmaSynth with TailCollateral/EthCollateral instead USDC_TREASURY
    function testDepositToUsingTailAssetForSynth() public {
        address collateral = d.getTokenAddress("WETH");
        uint256 synthAmount = 9e17; // USDL amount
        // uint256 usdcAmount = 1100e6; // USDL amount
        _depositSettlementTokenMax();

        address to = address(this);
        address lemmaSynth = d.pl().lemmaSynth();
        _getMoneyForTo(to, collateral, synthAmount);
        uint256 beforeBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(lemmaSynth, type(uint256).max);
        uint256 beforeTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        // 4th param is maxCollateralAmountRequired which is need to be set using callStatic, currently set uint256 max
        // calsstatic is not possible in solidity so
        d.lSynth().depositTo(to, synthAmount, 1, type(uint256).max, IERC20Upgradeable(collateral));
        uint256 afterTotalSynth = d.pl().mintedPositionSynthForThisWrapper();        
        uint256 afterBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        assertEq(afterTotalSynth-beforeTotalSynth, afterBalanceSynth);
        assertTrue(afterBalanceSynth > beforeBalanceSynth);
        assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    }

    function testDepositToAndWithdrawToUsingTailAssetForSynth() public {
        testDepositToUsingTailAssetForSynth();
        address collateral = d.getTokenAddress("WETH");
        uint256 synthAmount = d.lSynth().balanceOf(address(this));

        address to = address(this);
        address lemmaSynth = d.pl().lemmaSynth();
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 beforeBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        // assertTrue(beforeBalanceSynth > 0, "!Synth");
        uint256 beforeTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        d.lSynth().withdrawTo(to, synthAmount, 1, 0, IERC20Upgradeable(collateral));
        uint256 afterTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 afterBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        assertEq(beforeTotalSynth-synthAmount, afterTotalSynth);
        assertTrue(afterBalanceCollateral > beforeBalanceCollateral);
        assertTrue(afterBalanceSynth < beforeBalanceSynth);
    }

    function testDepositToWithExactCollateralUsingTailAssetForSynth() public {
        address collateral = d.getTokenAddress("WETH");
        uint256 synthAmount = 9e17; // USDL amount
        // uint256 usdcAmount = 1100e6; // USDL amount
        _depositSettlementTokenMax();

        address to = address(this);
        address lemmaSynth = d.pl().lemmaSynth();
        _getMoneyForTo(to, collateral, synthAmount);
        uint256 beforeBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(lemmaSynth, type(uint256).max);
        uint256 beforeTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        // 4th param is maxCollateralAmountRequired which is need to be set using callStatic, currently set uint256 max
        // calsstatic is not possible in solidity so
        d.lSynth().depositToWExactCollateral(to, synthAmount, 1, type(uint256).max, IERC20Upgradeable(collateral));
        uint256 afterTotalSynth = d.pl().mintedPositionSynthForThisWrapper();        
        uint256 afterBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        assertEq(afterTotalSynth-beforeTotalSynth, afterBalanceSynth);
        assertTrue(afterBalanceSynth > beforeBalanceSynth);
        assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    }

    function testDepositToAndWithdrawToWithExactCollateralUsingTailAssetForSynth() public {
        testDepositToWithExactCollateralUsingTailAssetForSynth();
        address collateral = d.getTokenAddress("WETH");
        uint256 synthAmount = d.lSynth().balanceOf(address(this));

        address to = address(this);
        address lemmaSynth = d.pl().lemmaSynth();
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 beforeBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        // assertTrue(beforeBalanceSynth > 0, "!Synth");
        uint256 beforeTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        d.lSynth().withdrawToWExactCollateral(to, synthAmount, 1, 0, IERC20Upgradeable(collateral));
        uint256 afterTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 afterBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        assertEq(beforeTotalSynth-synthAmount, afterTotalSynth);
        assertTrue(afterBalanceCollateral > beforeBalanceCollateral);
        assertTrue(afterBalanceSynth < beforeBalanceSynth);
    }
}
