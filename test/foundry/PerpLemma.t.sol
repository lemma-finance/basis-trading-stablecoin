// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;

import { IPerpetualMixDEXWrapper } from "../../contracts/interfaces/IPerpetualMixDEXWrapper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../../contracts/interfaces/IERC20Decimals.sol";
import "../../src/Deploy.sol";
import "forge-std/Test.sol";
import "forge-std/console.sol";

contract PerpLemmaCommonTest is Test {
    Deploy public d;
    address alice = vm.addr(1);
    address bob = vm.addr(2);

    bytes32 public constant PERPLEMMA_ROLE = keccak256("PERPLEMMA_ROLE");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");
    function setUp() public {
        d = new Deploy(10);
        vm.startPrank(address(d));
        d.pl().setUSDLemma(address(d.usdl()));
        d.pl().grantRole(USDC_TREASURY, address(this));
        d.pl().grantRole(PERPLEMMA_ROLE, address(this));
        d.pl().grantRole(REBALANCER_ROLE, address(this));
        d.pl().grantRole(PERPLEMMA_ROLE, alice);
        d.pl().grantRole(PERPLEMMA_ROLE, bob);
        d.pl().grantRole(USDC_TREASURY, alice);
        d.pl().grantRole(USDC_TREASURY, bob);
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

    function getRoundDown(uint256 amount) internal pure returns (uint256) {
        return amount - 1;
    }

    function checkBalance(address to, address collateral) internal view returns(uint256) {
        return IERC20Decimals(collateral).balanceOf(to);
    }

    function _depositSettlementTokenMax() internal returns(uint256) {
        _getMoney(address(d.pl().usdc()), 1e40);
        uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get 
        // V_GTSTBC: greater than settlement token balance cap
        d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        uint256 beforeUserBalance = checkBalance(address(this), d.getTokenAddress("USDC"));
        uint256 beforeTotalSynthCollateral = d.pl().totalSynthCollateral();
        d.pl().depositSettlementToken(settlementTokenBalanceCap/10);
        uint256 afterTotalSynthCollateral = d.pl().totalSynthCollateral();
        uint256 afterUserBalance = checkBalance(address(this), d.getTokenAddress("USDC"));
        assertEq(afterTotalSynthCollateral-beforeTotalSynthCollateral, settlementTokenBalanceCap/10);
        assertEq(beforeUserBalance-afterUserBalance, settlementTokenBalanceCap/10);
        return settlementTokenBalanceCap/10;
    }

    function _depositSettlementToken(uint256 usdcAmount) internal {
        _getMoney(address(d.pl().usdc()), 1e40);
        uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get 
        // V_GTSTBC: greater than settlement token balance cap
        d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        uint256 beforeUserBalance = checkBalance(address(this), d.getTokenAddress("USDC"));
        uint256 beforeTotalSynthCollateral = d.pl().totalSynthCollateral();
        d.pl().depositSettlementToken(usdcAmount);
        uint256 afterTotalSynthCollateral = d.pl().totalSynthCollateral();
        uint256 afterUserBalance = checkBalance(address(this), d.getTokenAddress("USDC"));
        assertEq(afterTotalSynthCollateral-beforeTotalSynthCollateral, usdcAmount);
        assertEq(beforeUserBalance-afterUserBalance, usdcAmount);
    }

    function _withdrawSettlementToken(uint256 amount) internal {
        uint256 beforeUserBalance = checkBalance(address(this), d.getTokenAddress("USDC"));
        uint256 beforeTotalSynthCollateral = d.pl().totalSynthCollateral();
        amount = (amount * 1e6) / 1e18;
        d.pl().withdrawSettlementToken(amount);
        uint256 afterTotalSynthCollateral = d.pl().totalSynthCollateral();
        uint256 afterUserBalance = checkBalance(address(this), d.getTokenAddress("USDC"));
        assertEq(beforeTotalSynthCollateral-afterTotalSynthCollateral, amount);
        assertEq(afterUserBalance-beforeUserBalance, amount);
    }

    // It only works if hasSettlled true in perpLemmaCommon
    function _withdrawSettlementTokenTo(uint256 amount, address to) internal {
        uint256 beforeUserBalance = checkBalance(to, d.getTokenAddress("USDC"));
        uint256 beforeTotalSynthCollateral = d.pl().totalSynthCollateral();
        amount = (amount * 1e6) / 1e18;
        d.pl().withdrawSettlementTokenTo(amount, to);
        uint256 afterTotalSynthCollateral = d.pl().totalSynthCollateral();
        uint256 afterUserBalance = checkBalance(to, d.getTokenAddress("USDC"));
        assertEq(beforeTotalSynthCollateral-afterTotalSynthCollateral, amount);
        assertEq(afterUserBalance-beforeUserBalance, amount);
    }

    function _depositUsdlCollateral(uint256 amount, address collateral, address to) internal {
        _getMoneyForTo(to, collateral, amount);
        uint256 beforeUserBalance = checkBalance(to, collateral);
        IERC20Decimals(collateral).approve(address(d.pl()), amount);
        IERC20Decimals(collateral).transferFrom(to, address(d.pl()), amount);
        uint256 beforeTotalUsdlCollateral = d.pl().totalUsdlCollateral();
        d.pl().deposit(amount, collateral, IPerpetualMixDEXWrapper.Basis.IsUsdl);
        uint256 afterTotalUsdlCollateral = d.pl().totalUsdlCollateral();
        uint256 afterUserBalance = checkBalance(to, collateral);
        assertEq(afterTotalUsdlCollateral-beforeTotalUsdlCollateral, amount);
        assertEq(beforeUserBalance-afterUserBalance, amount);
    }

    function _withdrawUsdlCollateral(uint256 amount, address collateral, address to) internal {
        uint256 beforeTotalUsdlCollateral = d.pl().totalUsdlCollateral();
        uint256 beforeWethBalance = checkBalance(to, collateral);
        d.pl().withdraw(amount, collateral, IPerpetualMixDEXWrapper.Basis.IsUsdl);
        vm.startPrank(d.pl().usdLemma());
        IERC20Decimals(collateral).transferFrom(address(d.pl()), to, amount);
        vm.stopPrank();
        uint256 afterTotalUsdlCollateral = d.pl().totalUsdlCollateral();
        uint256 afterWethBalance = checkBalance(to, collateral);
        assertEq(beforeTotalUsdlCollateral-afterTotalUsdlCollateral, amount);
        assertEq(afterWethBalance-beforeWethBalance, amount);
    }

    function openShortWithExactBase(uint256 collateralAmount, address collateral, address to) internal {
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().openShortWithExactBase(collateralAmount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsUsdl);
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        assertEq(afterMintedPositionUsdlForThisWrapper-beforeMintedPositionUsdlForThisWrapper, quote);
        assertEq(collateralAmount, base);
    }

    function openShortWithExactQuote(uint256 collateralAmount, uint256 exactUSDLAmount, address collateral, address to) internal {
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().openShortWithExactQuote(exactUSDLAmount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsUsdl);
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        assertEq(afterMintedPositionUsdlForThisWrapper-beforeMintedPositionUsdlForThisWrapper, quote);
        assertEq(collateralAmount, base);
    }

    function closeShortWithExactBase(uint256 collateralAmount, address collateral, address to) internal {
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().closeShortWithExactBase(collateralAmount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsUsdl);
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        assertEq(beforeMintedPositionUsdlForThisWrapper-afterMintedPositionUsdlForThisWrapper, quote);
        assertEq(collateralAmount, base);
    }

    function closeShortWithExactQuote(uint256 collateralAmount, uint256 exactUSDLAmount, address collateral, address to) internal returns(uint256 collateralToGetBack){
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().closeShortWithExactQuote(exactUSDLAmount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsUsdl);
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        assertEq(beforeMintedPositionUsdlForThisWrapper-afterMintedPositionUsdlForThisWrapper, getRoundDown(quote));
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAmount, 0);
        uint256 _minETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        assertLt(_minETHtoRedeem, base);
        collateralToGetBack = base;
    }

    function openLongWithExactBase(uint256 synthAmount, uint256 usdcAmount, address collateral, address to) internal {
        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().openLongWithExactBase(synthAmount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsSynth);
        uint256 afterMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        assertEq(afterMintedPositionSynthForThisWrapper-beforeMintedPositionSynthForThisWrapper, base);
        uint256 decimal = IERC20Decimals(collateral).decimals();
        usdcAmount = (usdcAmount*1e18) / 10**decimal;
    }

    function openLongWithExactQuote(uint256 synthAmount, uint256 usdcAmount, address collateral, address to) internal {
        uint256 decimal = IERC20Decimals(collateral).decimals();
        usdcAmount = (usdcAmount*1e18) / 10**decimal;
        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().openLongWithExactQuote(usdcAmount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsSynth);
        uint256 afterMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        assertEq(afterMintedPositionSynthForThisWrapper-beforeMintedPositionSynthForThisWrapper, base);
        assertGe(quote, usdcAmount);
    }

    function closeLongWithExactBase(uint256 synthAmount, uint256 usdcAmount, address collateral, address to) internal returns(uint256 usdcAmountToWithdraw) {
        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().closeLongWithExactBase(synthAmount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsSynth);
        console.log('base, quote: ', base, quote);
        uint256 afterMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        assertEq(beforeMintedPositionSynthForThisWrapper-afterMintedPositionSynthForThisWrapper, base);
        uint256 decimal = IERC20Decimals(collateral).decimals();
        usdcAmount = (usdcAmount*1e18) / 10**decimal;
        console.log('usdcAmount: ', usdcAmount);
        // uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), usdcAmount, 0);
        // uint256 _minUSDCtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        // console.log('_minUSDCtoRedeem: ', _minUSDCtoRedeem, _collateralAfterMinting);
        // assertLt(_minUSDCtoRedeem, quote);
        usdcAmountToWithdraw = quote;
    }

    function closeLongWithExactQuote(uint256 synthAmount, uint256 usdcAmount, address collateral, address to) internal returns(uint256 usdcAmountToWithdraw) {
        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().closeLongWithExactQuote(usdcAmount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsSynth);
        uint256 afterMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        uint256 afterSynthMinting = _deductFees(d.getTokenAddress("WETH"), synthAmount, 0);
        uint256 _maxSynthToRedeem = _deductFees(d.getTokenAddress("WETH"), afterSynthMinting, 0);
        assertLe(_maxSynthToRedeem, beforeMintedPositionSynthForThisWrapper-afterMintedPositionSynthForThisWrapper);
        assertEq(beforeMintedPositionSynthForThisWrapper-afterMintedPositionSynthForThisWrapper, getRoundDown(base)); // sometimes need to use getRoundDown(base) instead base
        usdcAmountToWithdraw = quote;
    }

    function testOpenShortWithExactBase() public {
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;
        uint256 usdcAmount = 1098e6; // USDL amount
        _depositSettlementToken(usdcAmount);
        _depositUsdlCollateral(collateralAmount, collateral, address(this));
        openShortWithExactBase(collateralAmount, collateral, address(this));
        int256 getTotalPosition = d.pl().getTotalPosition();
        if (getTotalPosition < 0) {
            console.log('getTotalPosition negative -', uint256(getTotalPosition*(-1)));
        } else {
            console.log('getTotalPosition positive +: ', uint256(getTotalPosition));
        }
    }

    function testOpenShortWithExactQuote() public {
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;
        uint256 exactUSDLAmount = 1096143206913675032725;
        _depositSettlementToken((exactUSDLAmount*1e6)/1e18);
        _depositUsdlCollateral(collateralAmount, collateral, address(this));
        openShortWithExactQuote(collateralAmount, exactUSDLAmount, collateral, address(this));
    }

    function testCloseShortWithExactBase1() public {
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        testOpenShortWithExactBase();
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAmount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        closeShortWithExactBase(_maxETHtoRedeem, collateral, address(this));
        _withdrawUsdlCollateral(_maxETHtoRedeem, collateral, address(this));
    }

    function testCloseShortWithExactBase2() public {
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        testOpenShortWithExactQuote();
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAmount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        closeShortWithExactBase(_maxETHtoRedeem, collateral, address(this));
        _withdrawUsdlCollateral(_maxETHtoRedeem, collateral, address(this));
    }

    // need to verify
    function testCloseShortWithExactQuote1() public {
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        testOpenShortWithExactBase();
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;
        uint256 exactUSDLAmount = afterMintedPositionUsdlForThisWrapper-beforeMintedPositionUsdlForThisWrapper;
        uint256 _exactUSDLAmountAfterMinting = _deductFees(d.getTokenAddress("WETH"), exactUSDLAmount, 0);
        uint256 _maxUSDLtoRedeem = _deductFees(d.getTokenAddress("WETH"), _exactUSDLAmountAfterMinting, 0);
        uint256 collateralToGetBack =  closeShortWithExactQuote(collateralAmount, exactUSDLAmount, collateral, address(this));
        int256 getTotalPosition = d.pl().getTotalPosition();
        _withdrawUsdlCollateral(collateralToGetBack, collateral, address(this));
    }

    // need to verify
    function testCloseShortWithExactQuote2() public {
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        testOpenShortWithExactQuote();
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;
        uint256 exactUSDLAmount = afterMintedPositionUsdlForThisWrapper-beforeMintedPositionUsdlForThisWrapper;
        uint256 _exactUSDLAmountAfterMinting = _deductFees(d.getTokenAddress("WETH"), exactUSDLAmount, 0);
        uint256 _maxUSDLtoRedeem = _deductFees(d.getTokenAddress("WETH"), _exactUSDLAmountAfterMinting, 0);
        uint256 collateralToGetBack =  closeShortWithExactQuote(collateralAmount, exactUSDLAmount, collateral, address(this));
        _withdrawUsdlCollateral(collateralToGetBack, collateral, address(this));
    }

    function testOpenLongWithExactBase() public {
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 1e18; // USDL amount
        uint256 usdcAmount = 1098e6; // USDL amount
        _depositSettlementTokenMax();
        openLongWithExactBase(synthAmount, usdcAmount, collateral, address(this));
    }

    function testOpenLongWithExactQuote() public {
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 1e18; // USDL amount
        uint256 usdcAmount = 1098e6; // USDL amount
        _depositSettlementToken(usdcAmount);
        openLongWithExactQuote(synthAmount, usdcAmount, collateral, address(this));
    }

    function testCloseLongWithExactBase1() public {
        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        testOpenLongWithExactBase(); // 1000000000000000000, 1098491447137910143682
        uint256 aftermMntedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 1e18;
        uint256 usdcAmount = 1098e6;
        uint256 usdcAmountToWithdraw = closeLongWithExactBase(synthAmount, usdcAmount, collateral, address(this));
        _withdrawSettlementToken(usdcAmountToWithdraw);
    }

    function testCloseLongWithExactBase2() public {
        _depositSettlementToken(1100e6);
        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        testOpenLongWithExactQuote(); // 999552647402874360, 1098000000000000000000
        uint256 aftermMntedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 1e18;
        uint256 usdcAmount = 1098e6;

        uint256 afterSynthMinting = _deductFees(d.getTokenAddress("WETH"), synthAmount, 0);
        uint256 _synthAmountAfterFees = _deductFees(d.getTokenAddress("WETH"), afterSynthMinting, 0);
        uint256 usdcAmountToWithdraw = closeLongWithExactBase(_synthAmountAfterFees, usdcAmount, collateral, address(this));
        _withdrawSettlementToken(usdcAmountToWithdraw);
    }

    function testCloseLongWithExactQuote1() public {
        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        testOpenLongWithExactBase();
        uint256 aftermMntedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 1e18;
        uint256 usdcAmount = 1098e18; // USDC(actual 1e6)
        uint256 afterSynthMinting = _deductFees(d.getTokenAddress("WETH"), usdcAmount, 0);
        uint256 _maxUSDCToRedeem = _deductFees(d.getTokenAddress("WETH"), afterSynthMinting, 0);
        uint256 usdcAmountToWithdraw = closeLongWithExactQuote(synthAmount, _maxUSDCToRedeem, collateral, address(this));
        _withdrawSettlementToken(usdcAmountToWithdraw);
    }

    // need to verify
    function testCloseLongWithExactQuote2() public {
        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        testOpenLongWithExactQuote();
        uint256 aftermMntedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 1e18;
        uint256 usdcAmount = 1098e18; // USDC(actual 1e6)
        uint256 afterSynthMinting = _deductFees(d.getTokenAddress("WETH"), usdcAmount, 0);
        uint256 _maxUSDCToRedeem = _deductFees(d.getTokenAddress("WETH"), afterSynthMinting, 0);
        uint256 usdcAmountToWithdraw = closeLongWithExactQuote(synthAmount, _maxUSDCToRedeem, collateral, address(this));
        _withdrawSettlementToken(usdcAmountToWithdraw);
    }

    // Settlement testcases

    // Internal Settlement Functions
    function usdlMintForTwoUsers() internal returns (uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) {
        uint256 ethCollateral = 1e18;
        // USDL Mint
        vm.startPrank(alice);
        uint256 beforeAliceUSDL = d.pl().mintedPositionUsdlForThisWrapper();
        _depositUsdlCollateral(ethCollateral, d.getTokenAddress("WETH"), alice);
        openShortWithExactBase(ethCollateral, d.getTokenAddress("WETH"), alice);
        uint256 afterAliceUSDL = d.pl().mintedPositionUsdlForThisWrapper();
        aliceUsdlToRedeem = afterAliceUSDL - beforeAliceUSDL;
        vm.stopPrank();

        vm.startPrank(bob);
        _depositUsdlCollateral(ethCollateral, d.getTokenAddress("WETH"), bob);
        openShortWithExactBase(ethCollateral, d.getTokenAddress("WETH"), bob);
        uint256 afterBobUSDL = d.pl().mintedPositionUsdlForThisWrapper();
        bobUsdlToRedeem = afterBobUSDL - afterAliceUSDL;
        vm.stopPrank();
    }

    function synthMintForTwoUsers() internal returns(uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) {
        uint256 ethCollateral = 1e18;
        uint256 usdcAmount = 2197e6; // USDL amount
        // Synth Mint
        _depositSettlementToken(usdcAmount);
        vm.startPrank(alice);
        uint256 beforeAliceSynth = d.pl().mintedPositionSynthForThisWrapper();
        openLongWithExactBase(ethCollateral*2, usdcAmount, d.getTokenAddress("USDC"), alice);
        uint256 afterAliceSynth = d.pl().mintedPositionSynthForThisWrapper();
        aliceSynthToRedeem = afterAliceSynth - beforeAliceSynth;
        vm.stopPrank();

        _depositSettlementToken(usdcAmount);
        vm.startPrank(bob);
        openLongWithExactBase(ethCollateral*2, usdcAmount, d.getTokenAddress("USDC"), bob);
        uint256 afterBobSynth = d.pl().mintedPositionSynthForThisWrapper();
        bobSynthToRedeem = afterBobSynth - afterAliceSynth;
        vm.stopPrank();
    }

    function usdlSettlementFortwoUser(uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) internal {
        vm.startPrank(alice);
        uint256 aliceBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        d.pl().getCollateralBackAfterSettlement(aliceUsdlToRedeem, alice, true); // get back user collateral after settlement
        uint256 aliceAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        console.log(aliceAfterBal-aliceBeforeBal);
        assertGt(aliceAfterBal-aliceBeforeBal, 0);
        vm.stopPrank();

        vm.startPrank(bob);
        uint256 bobBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        d.pl().getCollateralBackAfterSettlement(bobUsdlToRedeem, bob, true); // get back user collateral after settlement
        uint256 bobAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        console.log(bobAfterBal-bobBeforeBal);
        assertGt(bobAfterBal-bobBeforeBal, 0);
        vm.stopPrank();
    }

    function synthSettlementFortwoUser(uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) internal {
        vm.startPrank(alice);
        uint256 aliceBeforeBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        d.pl().getCollateralBackAfterSettlement(aliceSynthToRedeem, alice, false); // get back user collateral after settlement
        uint256 aliceAfterBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        assertGt(aliceAfterBal-aliceBeforeBal, 0);
        console.log(aliceAfterBal-aliceBeforeBal);
        vm.stopPrank();

        vm.startPrank(bob);
        uint256 bobBeforeBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(bob);
        d.pl().getCollateralBackAfterSettlement(bobSynthToRedeem, bob, false); // get back user collateral after settlement
        uint256 bobAfterBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(bob);
        assertGt(bobAfterBal-bobBeforeBal, 0);
        console.log(bobAfterBal-bobBeforeBal);
        vm.stopPrank();
    }

    // Settlment for Single Usdl user
    function testSettlement1() public {
        _depositSettlementTokenMax();
        uint256 amount = 1e18;

        testOpenShortWithExactBase();
        
        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 beforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(this));
        uint256 perpLemmaBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        
        // Users come to settle his/her collateral
        d.pl().getCollateralBackAfterSettlement(beforeMintedPositionUsdlForThisWrapper, address(this), true); // get back user collateral after settlement
        
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(this));
        uint256 perpLemmaAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        
        assertEq(afterBal-beforeBal, amount);
        assertEq(afterMintedPositionUsdlForThisWrapper, 0);
        assertEq(perpLemmaBeforeBal, amount);
        assertEq(perpLemmaAfterBal, 0);

        // console.log(afterBal, beforeBal);
        // console.log(afterMintedPositionUsdlForThisWrapper, beforeMintedPositionUsdlForThisWrapper);
    } 

    // Settlment for Multiple Usdl user
    function testSettlement2() public {
        _depositSettlementTokenMax();
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;
        uint256 usdcAmount = 1098e6; // USDL amount
        
        vm.startPrank(alice);
        uint256 beforeAliceUSDL = d.pl().mintedPositionUsdlForThisWrapper();
        _depositUsdlCollateral(collateralAmount, collateral, alice);
        openShortWithExactBase(collateralAmount, collateral, alice);
        uint256 afterAliceUSDL = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 aliceUsdlToRedeem = afterAliceUSDL - beforeAliceUSDL;
        vm.stopPrank();

        vm.startPrank(bob);
        _depositUsdlCollateral(collateralAmount, collateral, bob);
        openShortWithExactBase(collateralAmount, collateral, bob);
        uint256 afterBobUSDL = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 bobUsdlToRedeem = afterBobUSDL - afterAliceUSDL;
        vm.stopPrank();

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();
        d.pl().settle(); // PerpLemma settle call

        uint256 perpLemmaBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 aliceBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        uint256 bobBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        uint256 totalMintedUSDL = d.pl().mintedPositionUsdlForThisWrapper();

        vm.startPrank(alice);
        d.pl().getCollateralBackAfterSettlement(aliceUsdlToRedeem, alice, true); // get back user collateral after settlement
        uint256 aliceAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        assertGt(aliceAfterBal-aliceBeforeBal, 1e18);
        vm.stopPrank();

        vm.startPrank(bob);
        d.pl().getCollateralBackAfterSettlement(bobUsdlToRedeem, bob, true); // get back user collateral after settlement
        uint256 bobAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        assertGt(bobAfterBal-bobBeforeBal, 9e17);
        vm.stopPrank();

        uint256 perpLemmaAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        assertEq(perpLemmaBeforeBal, 2e18);
        assertEq(perpLemmaAfterBal, 0);
    }

    // Settlment for Single Synth user
    function testSettlement3() public {
        uint256 amount = 1e18;

        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 1e18; // USDL amount
        uint256 usdcAmount = 1098e6; // USDL amount
        _depositSettlementToken(usdcAmount);
        openLongWithExactBase(synthAmount, usdcAmount, collateral, address(this));
        
        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call

        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        uint256 beforeBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(this));
        uint256 perpLemmaBeforeBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));
        
        // Users come to settle his/her collateral
        d.pl().getCollateralBackAfterSettlement(beforeMintedPositionSynthForThisWrapper, address(this), false); // get back user collateral after settlement
        
        uint256 afterMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        uint256 afterBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(this));
        uint256 perpLemmaAfterBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));
        
        assertEq(afterBal-beforeBal, perpLemmaBeforeBal);
        assertEq(afterMintedPositionSynthForThisWrapper, 0);
        assertEq(perpLemmaAfterBal, 0);

        // console.log(perpLemmaBeforeBal, perpLemmaAfterBal);
        // console.log(beforeBal, afterBal, afterBal-beforeBal);
        // console.log(beforeMintedPositionSynthForThisWrapper, afterMintedPositionSynthForThisWrapper);
    } 

    // Settlment for Multiple Synth user
    function testSettlement4() public {
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 1e18; // USDL amount
        uint256 usdcAmount = 1098e6; // USDL amount
        
        _depositSettlementToken(usdcAmount);
        vm.startPrank(alice);
        uint256 beforeAliceSynth = d.pl().mintedPositionSynthForThisWrapper();
        openLongWithExactBase(synthAmount, usdcAmount, collateral, alice);
        uint256 afterAliceSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 aliceSynthToRedeem = afterAliceSynth - beforeAliceSynth;
        vm.stopPrank();

        _depositSettlementToken(usdcAmount);
        vm.startPrank(bob);
        openLongWithExactBase(synthAmount, usdcAmount, collateral, bob);
        uint256 afterBobSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 bobSynthToRedeem = afterBobSynth - afterAliceSynth;
        vm.stopPrank();

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();
        d.pl().settle(); // PerpLemma settle call

        uint256 perpLemmaBeforeBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));
        uint256 aliceBeforeBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        uint256 bobBeforeBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(bob);
        uint256 totalMintedUSDL = d.pl().mintedPositionSynthForThisWrapper();

        vm.startPrank(alice);
        d.pl().getCollateralBackAfterSettlement(aliceSynthToRedeem, alice, false); // get back user collateral after settlement
        uint256 aliceAfterBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        assertGt(aliceAfterBal-aliceBeforeBal, 0);
        vm.stopPrank();

        vm.startPrank(bob);
        d.pl().getCollateralBackAfterSettlement(bobSynthToRedeem, bob, false); // get back user collateral after settlement
        uint256 bobAfterBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(bob);
        assertGt(bobAfterBal-bobBeforeBal, 0);
        vm.stopPrank();

        uint256 perpLemmaAfterBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));
        assertGt(perpLemmaBeforeBal, 0);
        assertEq(perpLemmaAfterBal, 0);
    }

    // Settlement for Multiple mix users of USDL and Synths
    function testSettlement5() public {
        uint256 depositedAmount = _depositSettlementTokenMax();
        uint256 ethCollateral = 1e18;
        uint256 usdcAmount = 2197e6; // USDL amount

        // USDl And Synth Mint
        (uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) = usdlMintForTwoUsers();
        (uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) = synthMintForTwoUsers();

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call

        _withdrawSettlementTokenTo((depositedAmount*1e18)/1e6, address(this));
        // uint256 perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        // uint256 perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        // USDL And Synth Settlement
        usdlSettlementFortwoUser(aliceUsdlToRedeem, bobUsdlToRedeem);
        synthSettlementFortwoUser(aliceSynthToRedeem, bobSynthToRedeem);

        uint256 perpLemmaAfterWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaAfterUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        assertEq(perpLemmaAfterWETHBal, 0);
        assertEq(perpLemmaAfterUSDCBal, 0);
    }

    function testSettlement6() public {
        uint256 depositedAmount = _depositSettlementTokenMax();

        // USDl And Synth Mint
        (uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) = usdlMintForTwoUsers();
        (uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) = synthMintForTwoUsers();

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call

        _withdrawSettlementTokenTo((depositedAmount*1e18)/1e6, address(this));
        uint256 perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        console.log('perpLemmaBeforeWETHBal ', perpLemmaBeforeWETHBal);
        console.log('perpLemmaBeforeUSDCBal ', perpLemmaBeforeUSDCBal);

        _getMoneyForTo(address(this), d.getTokenAddress("WETH"), perpLemmaBeforeWETHBal/2);
        IERC20Decimals(d.getTokenAddress("WETH")).approve(address(d.pl()), type(uint256).max);
        d.pl().depositAnyAsset(perpLemmaBeforeWETHBal/2, d.getTokenAddress("WETH"));
        d.pl().withdrawAnyAsset(perpLemmaBeforeUSDCBal/2, d.getTokenAddress("USDC"), address(this));

        perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        console.log('perpLemmaBeforeWETHBal11 ', perpLemmaBeforeWETHBal);
        console.log('perpLemmaBeforeUSDCBal11 ', perpLemmaBeforeUSDCBal);

        // USDL And Synth Settlement
        usdlSettlementFortwoUser(aliceUsdlToRedeem, bobUsdlToRedeem);
        synthSettlementFortwoUser(aliceSynthToRedeem, bobSynthToRedeem);

        uint256 perpLemmaAfterWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaAfterUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        console.log('perpLemmaAfterWETHBal ', perpLemmaAfterWETHBal);
        console.log('perpLemmaAfterUSDCBal ', perpLemmaAfterUSDCBal);

        assertEq(perpLemmaAfterWETHBal, 0);
        assertEq(perpLemmaAfterUSDCBal, 0);
    }

    function testSettlement7() public {
        uint256 depositedAmount = _depositSettlementTokenMax();

        // USDl And Synth Mint
        (uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) = usdlMintForTwoUsers();
        (uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) = synthMintForTwoUsers();

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call

        _withdrawSettlementTokenTo((depositedAmount*1e18)/1e6, address(this));
        uint256 perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        console.log('perpLemmaBeforeWETHBal ', perpLemmaBeforeWETHBal);
        console.log('perpLemmaBeforeUSDCBal ', perpLemmaBeforeUSDCBal);

        _getMoneyForTo(address(this), d.getTokenAddress("USDC"), perpLemmaBeforeUSDCBal/2);
        IERC20Decimals(d.getTokenAddress("USDC")).approve(address(d.pl()), type(uint256).max);
        d.pl().depositAnyAsset(perpLemmaBeforeUSDCBal/2, d.getTokenAddress("USDC"));
        d.pl().withdrawAnyAsset(perpLemmaBeforeWETHBal/2, d.getTokenAddress("WETH"), address(this));

        perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        console.log('perpLemmaBeforeWETHBal11 ', perpLemmaBeforeWETHBal);
        console.log('perpLemmaBeforeUSDCBal11 ', perpLemmaBeforeUSDCBal);

        // USDL And Synth Settlement
        usdlSettlementFortwoUser(aliceUsdlToRedeem, bobUsdlToRedeem);
        synthSettlementFortwoUser(aliceSynthToRedeem, bobSynthToRedeem);

        uint256 perpLemmaAfterWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaAfterUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        console.log('perpLemmaAfterWETHBal ', perpLemmaAfterWETHBal);
        console.log('perpLemmaAfterUSDCBal ', perpLemmaAfterUSDCBal);

        assertEq(perpLemmaAfterWETHBal, 0);
        assertEq(perpLemmaAfterUSDCBal, 0);
    }

    function testSettlement8() public {
        uint256 depositedAmount = _depositSettlementTokenMax();

        // USDl And Synth Mint
        (uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) = usdlMintForTwoUsers();
        (uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) = synthMintForTwoUsers();

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call

        _withdrawSettlementTokenTo((depositedAmount*1e18)/1e6, address(this));
        uint256 perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        console.log('perpLemmaBeforeWETHBal ', perpLemmaBeforeWETHBal);
        console.log('perpLemmaBeforeUSDCBal ', perpLemmaBeforeUSDCBal);

        // _getMoneyForTo(address(this), d.getTokenAddress("WETH"), perpLemmaBeforeWETHBal/2);
        // IERC20Decimals(d.getTokenAddress("WETH")).approve(address(d.pl()), type(uint256).max);
        // d.pl().depositAnyAsset(perpLemmaBeforeWETHBal/2, d.getTokenAddress("WETH"));
        d.pl().withdrawAnyAsset(perpLemmaBeforeUSDCBal/2, d.getTokenAddress("USDC"), address(this));

        perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        console.log('perpLemmaBeforeWETHBal11 ', perpLemmaBeforeWETHBal);
        console.log('perpLemmaBeforeUSDCBal11 ', perpLemmaBeforeUSDCBal);

        // USDL And Synth Settlement
        usdlSettlementFortwoUser(aliceUsdlToRedeem, bobUsdlToRedeem);
        synthSettlementFortwoUser(aliceSynthToRedeem, bobSynthToRedeem);

        uint256 perpLemmaAfterWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaAfterUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        console.log('perpLemmaAfterWETHBal ', perpLemmaAfterWETHBal);
        console.log('perpLemmaAfterUSDCBal ', perpLemmaAfterUSDCBal);

        assertEq(perpLemmaAfterWETHBal, 0);
        assertEq(perpLemmaAfterUSDCBal, 0);
    }

    function testSettlement9() public {
        uint256 depositedAmount = _depositSettlementTokenMax();

        // USDl And Synth Mint
        (uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) = usdlMintForTwoUsers();
        (uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) = synthMintForTwoUsers();

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2 
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call

        _withdrawSettlementTokenTo((depositedAmount*1e18)/1e6, address(this));
        uint256 perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        console.log('perpLemmaBeforeWETHBal ', perpLemmaBeforeWETHBal);
        console.log('perpLemmaBeforeUSDCBal ', perpLemmaBeforeUSDCBal);

        // _getMoneyForTo(address(this), d.getTokenAddress("USDC"), perpLemmaBeforeUSDCBal/2);
        // IERC20Decimals(d.getTokenAddress("USDC")).approve(address(d.pl()), type(uint256).max);
        // d.pl().depositAnyAsset(perpLemmaBeforeUSDCBal/2, d.getTokenAddress("USDC"));
        d.pl().withdrawAnyAsset(perpLemmaBeforeWETHBal/2, d.getTokenAddress("WETH"), address(this));

        perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        console.log('perpLemmaBeforeWETHBal11 ', perpLemmaBeforeWETHBal);
        console.log('perpLemmaBeforeUSDCBal11 ', perpLemmaBeforeUSDCBal);

        // USDL And Synth Settlement
        usdlSettlementFortwoUser(aliceUsdlToRedeem, bobUsdlToRedeem);
        synthSettlementFortwoUser(aliceSynthToRedeem, bobSynthToRedeem);

        uint256 perpLemmaAfterWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaAfterUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        console.log('perpLemmaAfterWETHBal ', perpLemmaAfterWETHBal);
        console.log('perpLemmaAfterUSDCBal ', perpLemmaAfterUSDCBal);

        assertEq(perpLemmaAfterWETHBal, 0);
        assertEq(perpLemmaAfterUSDCBal, 0);
    }

    // Test Extra Function
    function testGetTotalPosition() public {
        
    }
}
