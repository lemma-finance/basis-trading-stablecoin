// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

import {IPerpetualMixDEXWrapper} from "../../contracts/interfaces/IPerpetualMixDEXWrapper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../../contracts/interfaces/IERC20Decimals.sol";
import "../../src/Deploy.sol";
import "forge-std/Test.sol";

// error resTestLeverageCheck(bool temp);

contract PerpLemmaCommonTest is Test {
    Deploy public d;
    address alice = vm.addr(1);
    address bob = vm.addr(2);

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PERPLEMMA_ROLE = keccak256("PERPLEMMA_ROLE");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    function setUp() public {
        d = new Deploy(10);
        vm.startPrank(address(d));
        d.pl().setUSDLemma(address(d.usdl()));
        d.pl().grantRole(USDC_TREASURY, address(this));
        d.pl().grantRole(PERPLEMMA_ROLE, address(this));
        d.pl().grantRole(REBALANCER_ROLE, address(this));
        d.pl().grantRole(OWNER_ROLE, address(this));
        d.pl().grantRole(PERPLEMMA_ROLE, alice);
        d.pl().grantRole(PERPLEMMA_ROLE, bob);
        d.pl().grantRole(USDC_TREASURY, alice);
        d.pl().grantRole(USDC_TREASURY, bob);
        vm.stopPrank();

        vm.startPrank(address(d));
        d.pl().setCollateralRatio(0.5e6);
        vm.stopPrank();

        // address baseTokenOwner = d.getPerps().ib.owner();
        // vm.startPrank(baseTokenOwner);
        // d.getPerps().ib.setPriceFeed(address(d.testSetPriceFeed()));
        // vm.stopPrank();
        // uint256 price = d.getPerps().ib.getIndexPrice(15 minutes);
        // uint256 getClosedPrice = d.getPerps().ib.getClosedPrice();
        // console.log('price: ', price);
        // console.log('baseTokenOwner: ', baseTokenOwner);
        // console.log('getClosedPrice: ', getClosedPrice);
    }

    // Internal

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

    function checkBalance(address to, address collateral) internal view returns (uint256) {
        return IERC20Decimals(collateral).balanceOf(to);
    }

    function _depositSettlementTokenMax() internal returns (uint256) {
        _getMoney(address(d.pl().usdc()), 1e40);
        uint256 settlementTokenBalanceCap =
            IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get
        // V_GTSTBC: greater than settlement token balance cap
        d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap / 10);
        uint256 beforeUserBalance = checkBalance(address(this), d.getTokenAddress("USDC"));
        d.pl().depositSettlementToken(settlementTokenBalanceCap / 10);
        uint256 afterUserBalance = checkBalance(address(this), d.getTokenAddress("USDC"));
        assertEq(beforeUserBalance - afterUserBalance, settlementTokenBalanceCap / 10);
        return settlementTokenBalanceCap / 10;
    }

    function _depositSettlementToken(uint256 usdcAmount) internal {
        _getMoney(address(d.pl().usdc()), 1e40);
        uint256 settlementTokenBalanceCap =
            IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get
        // V_GTSTBC: greater than settlement token balance cap
        d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap / 10);
        uint256 beforeUserBalance = checkBalance(address(this), d.getTokenAddress("USDC"));
        d.pl().depositSettlementToken(usdcAmount);
        uint256 afterUserBalance = checkBalance(address(this), d.getTokenAddress("USDC"));
        assertEq(beforeUserBalance - afterUserBalance, usdcAmount);
    }

    function _withdrawSettlementToken(uint256 amount) internal {
        uint256 beforeUserBalance = checkBalance(address(this), d.getTokenAddress("USDC"));
        amount = (amount * 1e6) / 1e18;
        console.log("[_withdrawSettlementToken] Trying to withdraw USDC = ", amount);
        d.pl().withdrawSettlementToken(amount);
        uint256 afterUserBalance = checkBalance(address(this), d.getTokenAddress("USDC"));
        assertEq(afterUserBalance - beforeUserBalance, amount);
    }

    // It only works if hasSettlled true in perpLemmaCommon
    function _withdrawSettlementTokenTo(uint256 amount, address to) internal {
        uint256 beforeUserBalance = checkBalance(to, d.getTokenAddress("USDC"));
        amount = (amount * 1e6) / 1e18;
        d.pl().withdrawSettlementTokenTo(amount, to);
        uint256 afterUserBalance = checkBalance(to, d.getTokenAddress("USDC"));
        assertEq(afterUserBalance - beforeUserBalance, amount);
    }

    function _depositUsdlCollateral(uint256 amount, address collateral, address to) internal {
        _getMoneyForTo(to, collateral, amount);
        uint256 beforeUserBalance = checkBalance(to, collateral);
        IERC20Decimals(collateral).approve(address(d.pl()), amount);
        IERC20Decimals(collateral).transferFrom(to, address(d.pl()), amount);
        uint256 _leverageBefore = d.pl().getLeverage(true, 0);
        d.pl().deposit(amount, collateral);
        uint256 _leverageAfter = d.pl().getLeverage(true, 0);
        assertTrue(_leverageBefore == _leverageAfter, "Leverage Changed");
        uint256 afterUserBalance = checkBalance(to, collateral);
        assertEq(beforeUserBalance - afterUserBalance, amount);
    }

    function _withdrawUsdlCollateral(uint256 amount, address collateral, address to) internal {
        uint256 beforeWethBalance = checkBalance(to, collateral);
        d.pl().withdraw(amount, collateral);
        vm.startPrank(d.pl().usdLemma());
        IERC20Decimals(collateral).transferFrom(address(d.pl()), to, amount);
        vm.stopPrank();
        uint256 afterWethBalance = checkBalance(to, collateral);
        assertEq(afterWethBalance - beforeWethBalance, amount);
    }

    function openShortWithExactBase(uint256 collateralAmount) internal {
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().openShortWithExactBase(collateralAmount);
        d.pl().calculateMintingAsset(quote, IPerpetualMixDEXWrapper.Basis.IsUsdl, true);
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        assertEq(afterMintedPositionUsdlForThisWrapper - beforeMintedPositionUsdlForThisWrapper, quote);
        assertEq(collateralAmount, base);
    }

    function openShortWithExactQuote(uint256 collateralAmount, uint256 exactUSDLAmount)
        internal
        returns (uint256 base, uint256 quote)
    {
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        (base, quote) = d.pl().openShortWithExactQuote(exactUSDLAmount);
        d.pl().calculateMintingAsset(quote, IPerpetualMixDEXWrapper.Basis.IsUsdl, true);
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        assertEq(afterMintedPositionUsdlForThisWrapper - beforeMintedPositionUsdlForThisWrapper, quote);
        // assertEq(collateralAmount, base);
    }

    function closeShortWithExactBase(uint256 collateralAmount) internal {
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().closeShortWithExactBase(collateralAmount);
        d.pl().calculateMintingAsset(quote, IPerpetualMixDEXWrapper.Basis.IsUsdl, false);
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        assertEq(beforeMintedPositionUsdlForThisWrapper - afterMintedPositionUsdlForThisWrapper, quote);
        assertEq(collateralAmount, base);
    }

    function closeShortWithExactQuote(uint256 collateralAmount, uint256 exactUSDLAmount)
        internal
        returns (uint256 collateralToGetBack)
    {
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().closeShortWithExactQuote(exactUSDLAmount);
        d.pl().calculateMintingAsset(quote - 1, IPerpetualMixDEXWrapper.Basis.IsUsdl, false); // need to round dow 1 wei here for quote
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        assertEq(beforeMintedPositionUsdlForThisWrapper - afterMintedPositionUsdlForThisWrapper, quote - 1); // need to round dow 1 wei here for quote
        // uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAmount, 0);
        // uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        // console.log('_maxETHtoRedeem', _maxETHtoRedeem, base);
        // assertGt(_maxETHtoRedeem, base);
        collateralToGetBack = base;
    }

    function openLongWithExactBase(uint256 synthAmount, uint256 usdcAmount, address collateral)
        internal
        returns (uint256 base, uint256 quote)
    {
        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        (base, quote) = d.pl().openLongWithExactBase(synthAmount);
        d.pl().calculateMintingAsset(base, IPerpetualMixDEXWrapper.Basis.IsSynth, false);
        uint256 afterMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        assertEq(afterMintedPositionSynthForThisWrapper - beforeMintedPositionSynthForThisWrapper, base);
        uint256 decimal = IERC20Decimals(collateral).decimals();
        usdcAmount = (usdcAmount * 1e18) / 10 ** decimal;
    }

    function openLongWithExactQuote(uint256 usdcAmount, address collateral)
        internal
        returns (uint256 base, uint256 quote)
    {
        uint256 decimal = IERC20Decimals(collateral).decimals();
        usdcAmount = (usdcAmount * 1e18) / 10 ** decimal;
        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        (base, quote) = d.pl().openLongWithExactQuote(usdcAmount);
        d.pl().calculateMintingAsset(base, IPerpetualMixDEXWrapper.Basis.IsSynth, false);
        uint256 afterMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        assertEq(afterMintedPositionSynthForThisWrapper - beforeMintedPositionSynthForThisWrapper, base);
        assertGe(quote, usdcAmount);
    }

    function closeLongWithExactBase(uint256 synthAmount, uint256 usdcAmount, address collateral)
        internal
        returns (uint256 usdcAmountToWithdraw)
    {
        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().closeLongWithExactBase(synthAmount);
        d.pl().calculateMintingAsset(base, IPerpetualMixDEXWrapper.Basis.IsSynth, true);
        uint256 afterMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        assertEq(beforeMintedPositionSynthForThisWrapper - afterMintedPositionSynthForThisWrapper, base);
        uint256 decimal = IERC20Decimals(collateral).decimals();
        usdcAmount = (usdcAmount * 1e18) / 10 ** decimal;
        usdcAmountToWithdraw = quote;
        // uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), usdcAmount, 0);
        // uint256 _minUSDCtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        // assertLt(_minUSDCtoRedeem, quote);
    }

    function closeLongWithExactQuote(uint256 synthAmount, uint256 usdcAmount)
        internal
        returns (uint256 usdcAmountToWithdraw)
    {
        uint256 beforeMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        (uint256 base, uint256 quote) = d.pl().closeLongWithExactQuote(usdcAmount);
        d.pl().calculateMintingAsset(base, IPerpetualMixDEXWrapper.Basis.IsSynth, true);
        uint256 afterMintedPositionSynthForThisWrapper = d.pl().mintedPositionSynthForThisWrapper();
        assertEq(beforeMintedPositionSynthForThisWrapper - afterMintedPositionSynthForThisWrapper, base);
        usdcAmountToWithdraw = quote;
    }

    function getEthPriceInUSD(uint256 _ethAmount) internal view returns (uint256) {
        return (_ethAmount * d.getPerps().ib.getIndexPrice(15 minutes)) / 1e18;
    }

    function getUSDPriceInEth(uint256 _usdAmount) internal view returns (uint256) {
        return (_usdAmount * 1e18) / d.getPerps().ib.getIndexPrice(15 minutes);
    }

    // NOTE: It only works if usdlCollateral isTailAsset otherwise the actual leverage depends also on the amount of nonSettlementToken deposited, its price which changes over time and teh discount factor set in Perp Protocol
    function _testOpenShortWithExactBase(uint256 collateralAmount_18, uint256 leverage_6) internal returns(uint256 usdcAmount_6) {
        assertTrue(d.pl().isUsdlCollateralTailAsset(), "This only works if Usdl Collateral is tail asset otherwise the leverage is not correct");
        address collateral = d.getTokenAddress("WETH");
        uint256 usdcAmount_18 = getEthPriceInUSD(collateralAmount_18); // 1098e6; // USDL amount

        // NOTE: Amount of USDC to deposit to reach the desired leverage
        usdcAmount_6 = (usdcAmount_18 * 1e6 * 1e6) / (leverage_6 * 1e18);
        console.log("[_testOpenShortWithExactBase()] collateralAmount_18 = ", collateralAmount_18);
        console.log("[_testOpenShortWithExactBase()] usdcAmount_18 = ", usdcAmount_18);
        console.log("[_testOpenShortWithExactBase()] usdcAmount_6 = ", usdcAmount_6);
        _depositSettlementToken(usdcAmount_6);
        _depositUsdlCollateral(collateralAmount_18, collateral, address(this));
        openShortWithExactBase(collateralAmount_18);
    }

    function testOpenShortWithExactBase() public {
        _testOpenShortWithExactBase(1e18, 1e6);
        // address collateral = d.getTokenAddress("WETH");
        // uint256 collateralAmount = 1e18;
        // uint256 usdcAmount = getEthPriceInUSD(1e18); // 1098e6; // USDL amount
        // _depositSettlementToken((usdcAmount * 1e6) / 1e18);
        // _depositUsdlCollateral(collateralAmount, collateral, address(this));
        // openShortWithExactBase(collateralAmount);
    }

    function testOpenShortWithExactQuote() public returns (uint256 base, uint256 quote) {
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 2e18; // approx amount added
        // uint256 exactUSDLAmount = 1096143206913675032725;
        uint256 exactUSDLAmount = getEthPriceInUSD(collateralAmount); // USDL amount
        _depositSettlementToken((exactUSDLAmount * 1e6) / 1e18);
        _depositUsdlCollateral(collateralAmount, collateral, address(this));
        (base, quote) = openShortWithExactQuote(collateralAmount, exactUSDLAmount);
    }

    function testCloseShortWithExactBase1() public {
        testOpenShortWithExactBase();
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAmount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        closeShortWithExactBase(_maxETHtoRedeem);
        _withdrawUsdlCollateral(_maxETHtoRedeem, collateral, address(this));
    }

    function testCloseShortWithExactBase2() public {
        (uint256 base, uint256 quote) = testOpenShortWithExactQuote();
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = base;
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAmount / 2, 0); // close ha;f position
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        closeShortWithExactBase(_maxETHtoRedeem);
        _withdrawUsdlCollateral(_maxETHtoRedeem, collateral, address(this));
    }

    function testCloseShortWithExactQuote1() public {
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        testOpenShortWithExactBase();
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;
        uint256 exactUSDLAmount = afterMintedPositionUsdlForThisWrapper - beforeMintedPositionUsdlForThisWrapper;
        uint256 collateralToGetBack = closeShortWithExactQuote(collateralAmount, exactUSDLAmount);
        _withdrawUsdlCollateral(collateralToGetBack, collateral, address(this));
    }

    function testCloseShortWithExactQuote2() public {
        console.log("[testCloseShortWithExactQuote2()] T1");
        uint256 beforeMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        console.log("[testCloseShortWithExactQuote2()] T2");
        testOpenShortWithExactQuote();
        console.log("[testCloseShortWithExactQuote2()] T3");
        uint256 afterMintedPositionUsdlForThisWrapper = d.pl().mintedPositionUsdlForThisWrapper();
        console.log("[testCloseShortWithExactQuote2()] T5");
        address collateral = d.getTokenAddress("WETH");
        uint256 exactUSDLAmount2 = afterMintedPositionUsdlForThisWrapper - beforeMintedPositionUsdlForThisWrapper;
        // uint256 collateralAmount = 5e17;
        uint256 collateralAmount = getUSDPriceInEth(exactUSDLAmount2);
        uint256 collateralToGetBack = closeShortWithExactQuote(collateralAmount / 2, exactUSDLAmount2 / 2); // half position closed
        _withdrawUsdlCollateral(collateralToGetBack, collateral, address(this));
        console.log("[testCloseShortWithExactQuote2()] T11");
    }

    function testOpenLongWithExactBase() public returns (uint256 base, uint256 quote) {
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 1e18; // USDL amount
        uint256 usdcAmount = getEthPriceInUSD(synthAmount); // USDL amount
        _depositSettlementTokenMax();
        (base, quote) = openLongWithExactBase(synthAmount, usdcAmount, collateral);
    }

    function testOpenLongWithExactQuote() public returns (uint256 base, uint256 quote) {
        address collateral = d.getTokenAddress("USDC");
        uint256 usdcAmount = 1098e6; // USDL amount
        _depositSettlementToken(usdcAmount);
        (base, quote) = openLongWithExactQuote(usdcAmount, collateral);
    }

    function testCloseLongWithExactBase1() public {
        (uint256 base, uint256 quote) = testOpenLongWithExactBase();
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = base;
        uint256 usdcAmount = quote;
        uint256 usdcAmountToWithdraw = closeLongWithExactBase(synthAmount, usdcAmount, collateral);
        _withdrawSettlementToken(usdcAmountToWithdraw);
    }

    function testCloseLongWithExactBase2() public {
        _depositSettlementToken(1100e6);

        (uint256 base, uint256 quote) = testOpenLongWithExactQuote();
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = base;
        uint256 usdcAmount = quote;

        uint256 afterSynthMinting = _deductFees(d.getTokenAddress("WETH"), synthAmount, 0);
        uint256 _synthAmountAfterFees = _deductFees(d.getTokenAddress("WETH"), afterSynthMinting, 0);
        uint256 usdcAmountToWithdraw = closeLongWithExactBase(_synthAmountAfterFees, usdcAmount, collateral);
        _withdrawSettlementToken(usdcAmountToWithdraw);
    }

    function testCloseLongWithExactQuote1() public {
        // using 1098 usdc
        (uint256 base, uint256 quote) = testOpenLongWithExactBase();

        uint256 synthAmount = base;

        // we are giving less 1 usdc here to protect from Arithmetic error
        // in frontend we will check callstatic usign js
        // if callstatic using exactSynth/exactBase => and return usdcAmount we will pass to protect from Arithmetic error
        uint256 usdcAmount = quote; // USDC(actual 1e6)
        uint256 afterSynthMinting = _deductFees(d.getTokenAddress("WETH"), usdcAmount, 0);
        uint256 _maxUSDCToRedeem = _deductFees(d.getTokenAddress("WETH"), afterSynthMinting, 0);
        uint256 usdcAmountToWithdraw = closeLongWithExactQuote(synthAmount, _maxUSDCToRedeem);
        _withdrawSettlementToken(usdcAmountToWithdraw);
    }

    function testCloseLongWithExactQuote2() public {
        (uint256 base, uint256 quote) = testOpenLongWithExactQuote();

        uint256 synthAmount = base;
        // we are giving less 1 usdc(1098-1 = 1097 usdc) here to protect from Arithmetic error
        // in frontend we will check callstatic usign js
        // if callstatic using exactSynth/exactBase => and return usdcAmount we will pass to protect from Arithmetic error
        uint256 usdcAmount = quote; // USDC(actual 1e6)
        uint256 afterSynthMinting = _deductFees(d.getTokenAddress("WETH"), usdcAmount, 0);
        uint256 _maxUSDCToRedeem = _deductFees(d.getTokenAddress("WETH"), afterSynthMinting, 0);
        uint256 usdcAmountToWithdraw = closeLongWithExactQuote(synthAmount, _maxUSDCToRedeem / 2);
        _withdrawSettlementToken(usdcAmountToWithdraw);
    }

    // Settlement testcases

    // Internal Settlement Functions
    function usdlMintForTwoUsers() internal returns (uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) {
        uint256 ethCollateral = 1e18;
        uint256 usdcAmount = (getEthPriceInUSD(ethCollateral) * 1e6) / 1e18; // USDL amount
        // USDL Mint
        vm.startPrank(alice);
        uint256 beforeAliceUSDL = d.pl().mintedPositionUsdlForThisWrapper();
        _depositUsdlCollateral(ethCollateral, d.getTokenAddress("WETH"), alice);
        openShortWithExactBase(ethCollateral);
        uint256 afterAliceUSDL = d.pl().mintedPositionUsdlForThisWrapper();
        aliceUsdlToRedeem = afterAliceUSDL - beforeAliceUSDL;
        vm.stopPrank();

        usdcAmount = (getEthPriceInUSD(ethCollateral) * 1e6) / 1e18; // USDL amount
        vm.startPrank(bob);
        _depositUsdlCollateral(ethCollateral, d.getTokenAddress("WETH"), bob);
        openShortWithExactBase(ethCollateral);
        uint256 afterBobUSDL = d.pl().mintedPositionUsdlForThisWrapper();
        bobUsdlToRedeem = afterBobUSDL - afterAliceUSDL;
        vm.stopPrank();
    }

    function synthMintForTwoUsers() internal returns (uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) {
        uint256 ethCollateral = 2e18;
        uint256 usdcAmount = (getEthPriceInUSD(ethCollateral) * 1e6) / 1e18; // USDL amount
        // Synth Mint
        _depositSettlementToken(usdcAmount);
        vm.startPrank(alice);
        uint256 beforeAliceSynth = d.pl().mintedPositionSynthForThisWrapper();
        openLongWithExactBase(ethCollateral, usdcAmount, d.getTokenAddress("USDC"));
        uint256 afterAliceSynth = d.pl().mintedPositionSynthForThisWrapper();
        aliceSynthToRedeem = afterAliceSynth - beforeAliceSynth;
        vm.stopPrank();

        usdcAmount = (getEthPriceInUSD(ethCollateral) * 1e6) / 1e18; // USDL amount
        _depositSettlementToken(usdcAmount);
        // Synth Mint
        vm.startPrank(bob);
        openLongWithExactBase(ethCollateral, usdcAmount, d.getTokenAddress("USDC"));
        uint256 afterBobSynth = d.pl().mintedPositionSynthForThisWrapper();
        bobSynthToRedeem = afterBobSynth - afterAliceSynth;
        vm.stopPrank();
    }

    function usdlSettlementFortwoUser(uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) internal {
        vm.startPrank(alice);
        uint256 aliceBeforeBalWeth = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        uint256 aliceBeforeBalUSDC = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        d.pl().getCollateralBackAfterSettlement(aliceUsdlToRedeem, alice, true); // get back user collateral after settlement
        uint256 aliceAfterBalWeth = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        uint256 aliceAfterBalUSDC = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        if (aliceAfterBalWeth - aliceBeforeBalWeth > 0 || aliceAfterBalUSDC - aliceBeforeBalUSDC > 0) {
            assertTrue(true);
        } else {
            assertTrue(false);
        }
        vm.stopPrank();

        vm.startPrank(bob);
        uint256 bobBeforeBalWeth = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        uint256 bobBeforeBalUSDC = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(bob);
        d.pl().getCollateralBackAfterSettlement(bobUsdlToRedeem, bob, true); // get back user collateral after settlement
        uint256 bobAfterBalWeth = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        uint256 bobAfterBalUSDC = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(bob);
        if (bobAfterBalWeth - bobBeforeBalWeth > 0 || bobAfterBalUSDC - bobBeforeBalUSDC > 0) {
            assertTrue(true);
        } else {
            assertTrue(false);
        }
        vm.stopPrank();
    }

    function synthSettlementFortwoUser(uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) internal {
        vm.startPrank(alice);
        uint256 aliceBeforeBalWeth = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        uint256 aliceBeforeBalUSDC = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        d.pl().getCollateralBackAfterSettlement(aliceSynthToRedeem, alice, false); // get back user collateral after settlement
        uint256 aliceAfterBalWeth = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        uint256 aliceAfterBalUSDC = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        if (aliceAfterBalWeth - aliceBeforeBalWeth > 0 || aliceAfterBalUSDC - aliceBeforeBalUSDC > 0) {
            assertTrue(true);
        } else {
            assertTrue(false);
        }
        vm.stopPrank();

        vm.startPrank(bob);
        uint256 bobBeforeBalWeth = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        uint256 bobBeforeBalUSDC = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(bob);
        d.pl().getCollateralBackAfterSettlement(bobSynthToRedeem, bob, false); // get back user collateral after settlement
        uint256 bobAfterBalWeth = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        uint256 bobAfterBalUSDC = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(bob);
        if (bobAfterBalWeth - bobBeforeBalWeth > 0 || bobAfterBalUSDC - bobBeforeBalUSDC > 0) {
            assertTrue(true);
        } else {
            assertTrue(false);
        }
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

        assertEq(afterMintedPositionUsdlForThisWrapper, 0);
        assertEq(perpLemmaBeforeBal, amount);
        assertLt(perpLemmaAfterBal, 1e16); // approx
        assertGt(afterBal - beforeBal, 99e16); // approx (>0.99 eth)
    }

    // Settlment for Multiple Usdl user
    function testSettlement2() public {
        _depositSettlementTokenMax();
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;

        vm.startPrank(alice);
        uint256 beforeAliceUSDL = d.pl().mintedPositionUsdlForThisWrapper();
        _depositUsdlCollateral(collateralAmount, collateral, alice);
        openShortWithExactBase(collateralAmount);
        uint256 afterAliceUSDL = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 aliceUsdlToRedeem = afterAliceUSDL - beforeAliceUSDL;
        vm.stopPrank();

        vm.startPrank(bob);
        _depositUsdlCollateral(collateralAmount, collateral, bob);
        openShortWithExactBase(collateralAmount);
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

        vm.startPrank(alice);
        d.pl().getCollateralBackAfterSettlement(aliceUsdlToRedeem, alice, true); // get back user collateral after settlement
        uint256 aliceAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        assertGt(aliceAfterBal - aliceBeforeBal, 99e16); // approx (>0.99 eth)
        vm.stopPrank();

        vm.startPrank(bob);
        d.pl().getCollateralBackAfterSettlement(bobUsdlToRedeem, bob, true); // get back user collateral after settlement
        uint256 bobAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        assertGt(bobAfterBal - bobBeforeBal, 9e17); // approx
        vm.stopPrank();

        uint256 perpLemmaAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        assertEq(perpLemmaBeforeBal, 2e18);
        assertLt(perpLemmaAfterBal, 2e16); // approx
    }

    // Settlment for Single Synth user
    function testSettlement3() public {
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 1e18; // USDL amount
        uint256 usdcAmount = (getEthPriceInUSD(synthAmount) * 1e6) / 1e18; // USDL amount
        _depositSettlementToken(usdcAmount);
        openLongWithExactBase(synthAmount, usdcAmount, collateral);

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
        assertEq(afterMintedPositionSynthForThisWrapper, 0);
    }

    // Settlment for Multiple Synth user
    function testSettlement4() public {
        address collateral = d.getTokenAddress("USDC");
        uint256 synthAmount = 1e18; // USDL amount
        uint256 usdcAmount = (getEthPriceInUSD(synthAmount) * 1e6) / 1e18; // USDL amount

        _depositSettlementToken(usdcAmount);
        vm.startPrank(alice);
        uint256 beforeAliceSynth = d.pl().mintedPositionSynthForThisWrapper();
        openLongWithExactBase(synthAmount, usdcAmount, collateral);
        uint256 afterAliceSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 aliceSynthToRedeem = afterAliceSynth - beforeAliceSynth;
        vm.stopPrank();

        _depositSettlementToken(usdcAmount);
        vm.startPrank(bob);
        openLongWithExactBase(synthAmount, usdcAmount, collateral);
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

        vm.startPrank(alice);
        d.pl().getCollateralBackAfterSettlement(aliceSynthToRedeem, alice, false); // get back user collateral after settlement
        uint256 aliceAfterBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        assertGt(aliceAfterBal - aliceBeforeBal, 0);
        vm.stopPrank();

        vm.startPrank(bob);
        d.pl().getCollateralBackAfterSettlement(bobSynthToRedeem, bob, false); // get back user collateral after settlement
        uint256 bobAfterBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(bob);
        assertGt(bobAfterBal - bobBeforeBal, 0);
        vm.stopPrank();
    }

    // Settlement for Multiple mix users of USDL and Synths
    function testSettlement5() public {
        // USDL And Synth Mint
        (uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) = synthMintForTwoUsers();
        (uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) = usdlMintForTwoUsers();

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call

        // USDL And Synth Settlement
        usdlSettlementFortwoUser(aliceUsdlToRedeem, bobUsdlToRedeem);
        synthSettlementFortwoUser(aliceSynthToRedeem, bobSynthToRedeem);

        uint256 perpLemmaAfterWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaAfterUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        assertLt(perpLemmaAfterWETHBal, 1e16); // approx
        assertLt(perpLemmaAfterUSDCBal, 1e6); // approx
    }

    function testSettlement6() public {
        // uint256 depositedAmount = _depositSettlementTokenMax();
        uint256 usdcAmount = (getEthPriceInUSD(2e18) * 1e6) / 1e18; // USDL amount
        _depositSettlementToken(usdcAmount);

        // USDL And Synth Mint
        (uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) = usdlMintForTwoUsers();
        (uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) = synthMintForTwoUsers();

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        uint256 perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        _getMoneyForTo(address(this), d.getTokenAddress("WETH"), perpLemmaBeforeWETHBal * 2);
        IERC20Decimals(d.getTokenAddress("WETH")).approve(address(d.pl()), type(uint256).max);
        d.pl().depositAnyAsset(perpLemmaBeforeWETHBal * 2, d.getTokenAddress("WETH"));
        d.pl().withdrawAnyAsset(perpLemmaBeforeUSDCBal / 2, d.getTokenAddress("USDC"), address(this));

        perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        // USDL And Synth Settlement
        vm.startPrank(alice);
        uint256 aliceBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        d.pl().getCollateralBackAfterSettlement(aliceUsdlToRedeem, alice, true); // get back user collateral after settlement
        uint256 aliceAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        assertGt(aliceAfterBal - aliceBeforeBal, 0);
        vm.stopPrank();

        vm.startPrank(bob);
        uint256 bobBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        d.pl().getCollateralBackAfterSettlement(bobUsdlToRedeem, bob, true); // get back user collateral after settlement
        uint256 bobAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        assertGt(bobAfterBal - bobBeforeBal, 0);
        vm.stopPrank();

        vm.startPrank(alice);
        aliceBeforeBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        d.pl().getCollateralBackAfterSettlement(aliceSynthToRedeem, alice, false); // get back user collateral after settlement
        aliceAfterBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        assertGt(aliceAfterBal - aliceBeforeBal, 0);
        vm.stopPrank();

        vm.startPrank(bob);
        bobBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        d.pl().getCollateralBackAfterSettlement(bobSynthToRedeem, bob, false); // get back user collateral after settlement
        bobAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        assertGt(bobAfterBal - bobBeforeBal, 0);
        vm.stopPrank();
    }

    function testSettlement7() public {
        // uint256 depositedAmount = _depositSettlementTokenMax();
        uint256 usdcAmount = (getEthPriceInUSD(2e18) * 1e6) / 1e18; // USDL amount
        _depositSettlementToken(usdcAmount);

        // USDl And Synth Mint
        (uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) = synthMintForTwoUsers();
        (uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) = usdlMintForTwoUsers();

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        uint256 perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        uint256 depositUSDC = ((perpLemmaBeforeWETHBal / 2) * d.pl().closedPrice()) / 1e18;
        _getMoneyForTo(address(this), d.getTokenAddress("USDC"), depositUSDC);
        IERC20Decimals(d.getTokenAddress("USDC")).approve(address(d.pl()), type(uint256).max);
        d.pl().depositAnyAsset((depositUSDC * 1e6) / 1e18, d.getTokenAddress("USDC"));
        d.pl().withdrawAnyAsset(perpLemmaBeforeWETHBal / 2, d.getTokenAddress("WETH"), address(this));

        // USDL And Synth Settlement
        usdlSettlementFortwoUser(aliceUsdlToRedeem, bobUsdlToRedeem);
        synthSettlementFortwoUser(aliceSynthToRedeem, bobSynthToRedeem);

        uint256 perpLemmaAfterWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaAfterUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        assertEq(perpLemmaAfterWETHBal, 0);
        assertLt(perpLemmaAfterUSDCBal, perpLemmaBeforeUSDCBal / 2); // why perpLemmaBeforeUSDCBal/2, because for test we are adding extra perpLemmaBeforeUSDCBal/2 usdc in this testcase above
    }

    function testSettlement8() public {
        // uint256 depositedAmount = _depositSettlementTokenMax();
        uint256 usdcAmount = (getEthPriceInUSD(2e18) * 1e6) / 1e18; // USDL amount
        _depositSettlementToken(usdcAmount);

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
        uint256 perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        _getMoneyForTo(address(this), d.getTokenAddress("WETH"), perpLemmaBeforeWETHBal * 2);
        IERC20Decimals(d.getTokenAddress("WETH")).approve(address(d.pl()), type(uint256).max);
        d.pl().depositAnyAsset(perpLemmaBeforeWETHBal * 2, d.getTokenAddress("WETH"));
        d.pl().withdrawAnyAsset(perpLemmaBeforeUSDCBal / 2, d.getTokenAddress("USDC"), address(this));

        perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        // USDL And Synth Settlement
        vm.startPrank(alice);
        uint256 aliceBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        d.pl().getCollateralBackAfterSettlement(aliceUsdlToRedeem, alice, true); // get back user collateral after settlement
        uint256 aliceAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        assertGt(aliceAfterBal - aliceBeforeBal, 0);
        vm.stopPrank();

        vm.startPrank(alice);
        aliceBeforeBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        d.pl().getCollateralBackAfterSettlement(aliceSynthToRedeem, alice, false); // get back user collateral after settlement
        aliceAfterBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(alice);
        assertGt(aliceAfterBal - aliceBeforeBal, 0);
        vm.stopPrank();

        vm.startPrank(bob);
        uint256 bobBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        d.pl().getCollateralBackAfterSettlement(bobUsdlToRedeem, bob, true); // get back user collateral after settlement
        uint256 bobAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        assertGt(bobAfterBal - bobBeforeBal, 0);
        vm.stopPrank();

        vm.startPrank(bob);
        bobBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        d.pl().getCollateralBackAfterSettlement(bobSynthToRedeem, bob, false); // get back user collateral after settlement
        bobAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        assertGt(bobAfterBal - bobBeforeBal, 0);
        vm.stopPrank();
    }

    function testSettlement9() public {
        // uint256 depositedAmount = _depositSettlementTokenMax();

        // USDl And Synth Mint
        (uint256 aliceSynthToRedeem, uint256 bobSynthToRedeem) = synthMintForTwoUsers();
        (uint256 aliceUsdlToRedeem, uint256 bobUsdlToRedeem) = usdlMintForTwoUsers();

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        uint256 perpLemmaBeforeWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaBeforeUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));

        // _getMoneyForTo(address(this), d.getTokenAddress("USDC"), perpLemmaBeforeUSDCBal/2);
        // IERC20Decimals(d.getTokenAddress("USDC")).approve(address(d.pl()), type(uint256).max);
        uint256 depositUSDC = ((perpLemmaBeforeWETHBal / 2) * d.pl().closedPrice()) / 1e18;
        d.pl().depositAnyAsset((depositUSDC * 1e6) / 1e18, d.getTokenAddress("USDC"));
        d.pl().withdrawAnyAsset(perpLemmaBeforeWETHBal / 2, d.getTokenAddress("WETH"), address(this));

        // USDL And Synth Settlement
        usdlSettlementFortwoUser(aliceUsdlToRedeem, bobUsdlToRedeem);
        synthSettlementFortwoUser(aliceSynthToRedeem, bobSynthToRedeem);

        uint256 perpLemmaAfterWETHBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        uint256 perpLemmaAfterUSDCBal = IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(d.pl()));
        assertEq(perpLemmaAfterWETHBal, 0);
        assertLt(perpLemmaAfterUSDCBal, depositUSDC); // why perpLemmaBeforeUSDCBal/2, because for test we are adding extra perpLemmaBeforeUSDCBal/2 usdc in this testcase above
    }

    // Test Extra Function
    function testChangeAdmin() public {
        vm.startPrank(address(d));
        d.pl().changeAdmin(vm.addr(1));
        vm.stopPrank();
        assertEq(d.pl().hasRole(ADMIN_ROLE, vm.addr(1)), true);
        assertEq(d.pl().hasRole(ADMIN_ROLE, address(d)), false);
    }

    function testInitialization() public {
        assertEq(d.pl().usdcDecimals(), 6); //only mainnet
        assertEq(address(d.pl().usdc()), address(d.pl().perpVault().getSettlementToken()));
        assertEq(d.pl().usdlCollateral().decimals(), d.pl().usdlCollateralDecimals());
        assertTrue(d.pl().hasRole(PERPLEMMA_ROLE, address(d.usdl())));
        assertTrue(d.pl().hasRole(PERPLEMMA_ROLE, address(d.lSynth())));
        assertTrue(d.pl().hasRole(OWNER_ROLE, address(d)));
    }

    // Admin Addresses should not be same
    function testFailChangeAdmin1() public {
        vm.startPrank(address(d));
        d.pl().changeAdmin(address(0));
        vm.stopPrank();
    }

    // Admin Addresses should not be same
    function testFailChangeAdmin2() public {
        vm.startPrank(address(d));
        d.pl().changeAdmin(address(d));
        vm.stopPrank();
    }

    function testSetRebalancer() public {
        vm.startPrank(address(d));
        d.pl().setReBalancer(vm.addr(1));
        vm.stopPrank();
        assertEq(d.pl().reBalancer(), vm.addr(1));
    }

    function testFailSetRebalancer() public {
        vm.startPrank(address(d));
        d.pl().setReBalancer(address(0));
        vm.stopPrank();
    }

    function testResetApprovals() public {
        d.pl().resetApprovals();
        assertEq(
            IERC20Decimals(d.getTokenAddress("WETH")).allowance(address(d.pl()), address(d.getPerps().pv)),
            type(uint256).max
        );
        assertEq(
            IERC20Decimals(d.getTokenAddress("USDC")).allowance(address(d.pl()), address(d.getPerps().pv)),
            type(uint256).max
        );
    }

    function testGetUsdlCollateralDecimals() public {
        uint256 decimal = d.pl().getUsdlCollateralDecimals();
        assertEq(decimal, 18);
    }

    function testGetIndexPrice() public {
        uint256 price = d.pl().getIndexPrice();
        assertGe(price, 0);
    }

    function testGetFees() public {
        uint256 fees = d.pl().getFees();
        assertEq(fees, 1000);
    }

    function testOpenShortWithExactBaseWithPosition() public {
        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;
        uint256 usdcAmount = 1098e6; // USDL amount
        _depositSettlementToken(usdcAmount);
        _depositUsdlCollateral(collateralAmount, collateral, address(this));
        (, uint256 quote) = d.pl().openShortWithExactBase(collateralAmount);
        int256 getTotalPosition = d.pl().getTotalPosition();
        assertGe(uint256(getTotalPosition * (-1)), 0);
    }

    function testGetCollateralTokens() public {
        address[] memory res = d.pl().getCollateralTokens();
        assertEq(res[0], d.getTokenAddress("USDC"));
    }

    function testSetIsUsdlCollateralTailAsset() public {
        vm.startPrank(address(d));
        d.pl().grantRole(OWNER_ROLE, vm.addr(1));
        vm.stopPrank();
        vm.startPrank(vm.addr(1));
        d.pl().setIsUsdlCollateralTailAsset(true);
        assertEq(d.pl().isUsdlCollateralTailAsset(), true);
        d.pl().setIsUsdlCollateralTailAsset(false);
        assertEq(d.pl().isUsdlCollateralTailAsset(), false);
        vm.stopPrank();
    }

    function testSetUSDLemma() public {
        vm.startPrank(address(d));
        d.pl().setUSDLemma(vm.addr(1));
        vm.stopPrank();

        assertEq(d.pl().usdLemma(), vm.addr(1));

        assertEq(IERC20Decimals(d.getTokenAddress("WETH")).allowance(address(d.pl()), vm.addr(1)), type(uint256).max);
        assertEq(IERC20Decimals(d.getTokenAddress("USDC")).allowance(address(d.pl()), vm.addr(1)), type(uint256).max);
    }

    // REASON: UsdLemma should not ZERO address
    function testFailSetUSDLemma() public {
        vm.startPrank(vm.addr(1)); // without ADMIN_ROLE address
        d.pl().setUSDLemma(address(0));
        vm.stopPrank();
    }

    function testSetReferrerCode() public {
        vm.startPrank(address(d));
        d.pl().grantRole(OWNER_ROLE, vm.addr(1));
        vm.stopPrank();

        bytes32 referrerCode = keccak256("Test");
        vm.startPrank(vm.addr(1));
        d.pl().setReferrerCode(referrerCode);
        vm.stopPrank();

        assertEq(d.pl().referrerCode(), referrerCode);
    }

    function testSetMaxPosition() public {
        vm.startPrank(address(d));
        d.pl().grantRole(OWNER_ROLE, vm.addr(1));
        vm.stopPrank();

        uint256 _maxPosition = 1000000e18;
        vm.startPrank(vm.addr(1));
        d.pl().setMaxPosition(_maxPosition);
        assertEq(d.pl().maxPosition(), _maxPosition);
        vm.stopPrank();
    }

    function _deltaAbs(uint256 a, uint256 b) internal returns(uint256) {
        int256 _delta = int256(a) - int256(b);
        return (_delta >= 0) ? uint256(_delta) : uint256(-_delta);
    }

    function _isAlmostEqual(uint256 a, uint256 b, uint256 precision) internal returns(bool) {
        // console.log("[_isAlmostEqual()] a/precision = ", a/precision);
        // console.log("[_isAlmostEqual()] b/precision = ", b/precision);
        return _deltaAbs(a,b) <= precision;
    }

    function _testLeverageCheck(uint256 i) internal returns(uint256 usdcAmount_6) {
            uint256 baseAmount_18 = 1e18;
            console.log("[testLeverageCheck()] Short Base Amount = ", baseAmount_18);
            usdcAmount_6 = _testOpenShortWithExactBase(baseAmount_18, i * 1e6);
            uint256 leverage = d.pl().getLeverage(true, 0);
            console.log("[testLeverageCheck()] getLeverage = ", leverage);
            assertTrue(_isAlmostEqual(leverage, i * 1e6, 1e5));
            // revert resTestLeverageCheck(_isAlmostEqual(leverage, i * 1e6, 1e5));
    }

    function testLeverageCheck1() public {
        d.pl().setIsUsdlCollateralTailAsset(true);
        _testLeverageCheck(1);
    }

    function testLeverageCheck2() public {
        d.pl().setIsUsdlCollateralTailAsset(true);
        _testLeverageCheck(2);
    }

    function _testWithdraw1(uint256 initialLeverage_6, uint256 finalLeverage_6) internal {
        d.pl().setIsUsdlCollateralTailAsset(true);
        uint256 usdcAmount_6 = _testLeverageCheck(1);
        uint256 usdcAmountWithdraw_6 = usdcAmount_6 - (usdcAmount_6 * initialLeverage_6 / finalLeverage_6);
        uint256 estimatedLeverage_6 = d.pl().getLeverage(true, -1 * int256(usdcAmountWithdraw_6));
        // console.log("[_testWithdraw1()] estimatedLeverage_6 = ", estimatedLeverage_6);
        assertTrue(_isAlmostEqual(estimatedLeverage_6, finalLeverage_6, 1e5));
        // vm.startPrank(address(d));
        d.pl().withdrawSettlementToken(usdcAmountWithdraw_6);
        // vm.stopPrank();
        uint256 leverage_6 = d.pl().getLeverage(true, 0);
        assertTrue(_isAlmostEqual(leverage_6, finalLeverage_6, 1e5));
    }

    function testWithdraw1() public {
        _testWithdraw1(1e6, 2e6);
    }

    // function testLeverageCheck() public {
    //     // NOTE: ETH is set as tail asset here so deposited USDC determines 
    //     d.pl().setIsUsdlCollateralTailAsset(true);
    //     bool isSuccess = true;
    //     for(uint256 i=1; i<5; ++i) {
    //         try _testLeverageCheck(i) {

    //         } catch (bytes memory reason) {
    //         assembly {
    //             reason := add(reason, 0x04)
    //         }
    //             (bool _isSuccess) = abi.decode(reason, (bool));
    //             isSuccess = isSuccess && _isSuccess;
    //         }
    //         // uint256 baseAmount_18 = 1e18;
    //         // console.log("[testLeverageCheck()] Short Base Amount = ", baseAmount_18);
    //         // _testOpenShortWithExactBase(baseAmount_18, i * 1e6);
    //         // uint256 leverage = d.pl().getLeverage(true, 0);
    //         // console.log("[testLeverageCheck()] getLeverage = ", leverage);
    //         // assertTrue(_isAlmostEqual(leverage, i * 1e6, 1e5));
    //     }
    //     assertTrue(isSuccess);
    // }

    // FAIL. Reason: max position reached
    function testFailMaxPosition() public {
        vm.startPrank(address(d));
        d.pl().grantRole(OWNER_ROLE, vm.addr(1));
        vm.stopPrank();

        uint256 _maxPosition = 1e17;
        vm.startPrank(vm.addr(1));
        d.pl().setMaxPosition(_maxPosition);
        assertEq(d.pl().maxPosition(), _maxPosition);
        vm.stopPrank();

        address collateral = d.getTokenAddress("WETH");
        uint256 collateralAmount = 1e18;
        uint256 usdcAmount = 1098e6; // USDL amount
        _depositSettlementToken(usdcAmount);
        _depositUsdlCollateral(collateralAmount, collateral, address(this));
        d.pl().openShortWithExactBase(collateralAmount);
    }

    // ! No Rebalance with Zero Amount
    // function testFailRebalance() public {
    //     vm.startPrank(address(d));
    //     d.pl().grantRole(REBALANCER_ROLE, address(d));
    //     d.pl().rebalance(address(0), 0, 0, true);
    //     vm.stopPrank();
    // }
}
