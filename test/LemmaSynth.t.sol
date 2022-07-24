// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;

import { IPerpetualMixDEXWrapper } from "../contracts/interfaces/IPerpetualMixDEXWrapper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../contracts/interfaces/IERC20Decimals.sol";
// import "../contracts/interfaces/Perpetual/IClearingHouse.sol";
import "src/Deploy.sol";
import "forge-std/Test.sol";
import "forge-std/console.sol";

contract LemmaSynthTest is Test {
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
        // TODO: Need to fix 100 extra fees, remove 100 extra fees and used callstatic instead like in js we used
        uint256 fees = collateralAmount * (d.lSynth().getFees()+100) / 1e6;
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
        // assertEq(beforeTotalSynth-afterTotalSynth, beforeBalanceSynth-afterBalanceSynth);
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
        uint256 synthAmount = 1e18; // USDL amount
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

        uint256 collateralAMount = 988635431772441083946; // ~0.9998 eth
        uint256 _collateralAfterMinting = _deductFees(collateral, collateralAMount, 0);
        uint256 _maxUSDCtoRedeem = _deductFees(collateral, _collateralAfterMinting, 0);
        _redeemSynthWExactCollateral(address(this), collateral, _maxUSDCtoRedeem);
    }
}