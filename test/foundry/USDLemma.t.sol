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
        d.pl().grantRole(USDC_TREASURY, address(d.lemmaTreasury()));
        d.pl().grantRole(USDC_TREASURY, address(this));
        d.usdl().grantRole(LEMMA_SWAP, address(this));
        d.usdl().addPerpetualDEXWrapper(1, d.getTokenAddress("USDC"), address(d.pl()));
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

    // NOTE: Deposits settlementToken amount as percentage of the remaining availability so 100% is equivalent to max settlementToken 
    function _depositSettlementTokenPerc(uint256 perc1e6) internal {
        _getMoney(address(d.pl().usdc()), 1e40);

        IERC20Decimals settlementToken = IERC20Decimals(d.pl().perpVault().getSettlementToken());
        uint256 perpVaultSettlementTokenBalanceBefore = settlementToken.balanceOf(address(d.pl().perpVault()));
        uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.pl().clearingHouse().getClearingHouseConfig()).getSettlementTokenBalanceCap();
        uint256 maxUSDCToDeposit = uint256(int256(settlementTokenBalanceCap) - int256(perpVaultSettlementTokenBalanceBefore));
        uint256 usdcToDeposit = maxUSDCToDeposit * perc1e6 / 1e6;
        console.log("[_depositSettlementTokenPerc()] maxUSDCToDeposit = ", maxUSDCToDeposit);
        console.log("[_depositSettlementTokenPerc()] usdcToDeposit = ", usdcToDeposit);
        console.log("[_depositSettlementTokenPerc()] perpVaultSettlementTokenBalanceBefore = ", perpVaultSettlementTokenBalanceBefore);

        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get 
        // V_GTSTBC: greater than settlement token balance cap

        d.pl().usdc().approve(address(d.pl()), usdcToDeposit);
        d.pl().depositSettlementToken(usdcToDeposit);


        uint256 perpVaultSettlementTokenBalanceAfter = settlementToken.balanceOf(address(d.pl().perpVault()));
        console.log("[_depositSettlementTokenPerc()] perpVaultSettlementTokenBalanceAfter = ", perpVaultSettlementTokenBalanceAfter);
        uint256 delta = perpVaultSettlementTokenBalanceAfter - perpVaultSettlementTokenBalanceBefore;
        require(delta == usdcToDeposit, "Delta is different");

        // d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        // d.pl().depositSettlementToken(settlementTokenBalanceCap/10);
    }


    function _depositSettlementToken(uint256 amount) internal {
        _getMoney(address(d.pl().usdc()), 1e40);

        IERC20Decimals settlementToken = IERC20Decimals(d.pl().perpVault().getSettlementToken());
        uint256 perpVaultSettlementTokenBalanceBefore = settlementToken.balanceOf(address(d.pl().perpVault()));
        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.pl().clearingHouse().getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // uint256 maxUSDCToDeposit = uint256(int256(settlementTokenBalanceCap) - int256(perpVaultSettlementTokenBalanceBefore));
        // uint256 usdcToDeposit = maxUSDCToDeposit * perc1e6 / 1e6;
        // console.log("[_depositSettlementTokenPerc()] maxUSDCToDeposit = ", maxUSDCToDeposit);
        // console.log("[_depositSettlementTokenPerc()] usdcToDeposit = ", usdcToDeposit);
        console.log("[_depositSettlementTokenPerc()] perpVaultSettlementTokenBalanceBefore = ", perpVaultSettlementTokenBalanceBefore);

        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get 
        // V_GTSTBC: greater than settlement token balance cap

        d.pl().usdc().approve(address(d.pl()), amount);
        d.pl().depositSettlementToken(amount);


        uint256 perpVaultSettlementTokenBalanceAfter = settlementToken.balanceOf(address(d.pl().perpVault()));
        console.log("[_depositSettlementTokenPerc()] perpVaultSettlementTokenBalanceAfter = ", perpVaultSettlementTokenBalanceAfter);
        uint256 delta = perpVaultSettlementTokenBalanceAfter - perpVaultSettlementTokenBalanceBefore;
        require(delta == amount, "Delta is different");

        // d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        // d.pl().depositSettlementToken(settlementTokenBalanceCap/10);
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

        console.log("[_depositSettlementTokenMax()] DONE");

        // d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        // d.pl().depositSettlementToken(settlementTokenBalanceCap/10);
    }

    // USDLemma Functions To test

    function depositIntoVault(uint256 amount, address to) internal {
        _getMoneyForTo(to, address(d.pl().usdc()), amount);
        d.pl().usdc().approve(address(d.getPerps().pv), type(uint256).max);
        d.getPerps().pv.deposit(address(d.pl().usdc()), amount);
    }

    function _mintUSDLWExactUSDL(address to, address collateral, uint256 amount, uint256 dexIndex) internal {
        address usdl = d.pl().usdLemma();
        _getMoneyForTo(to, collateral, amount);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(usdl, type(uint256).max);
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        // 4th param is maxCollateralAmountRequired which is need to be set using callStatic, currently set uint256 max
        // calsstatic is not possible in solidity so
        d.usdl().depositTo(to, amount, dexIndex, type(uint256).max, IERC20Upgradeable(collateral));
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();        
        uint256 afterBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        assertEq(afterTotalUsdl-beforeTotalUsdl, afterBalanceUSDL);
        assertTrue(afterBalanceUSDL > beforeBalanceUSDL);
        assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    }

    function _mintUSDLWExactCollateral(address to, address collateral, uint256 amount, uint256 dexIndex) internal {
        address usdl = d.pl().usdLemma();
        _getMoneyForTo(to, collateral, amount);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(usdl, type(uint256).max);
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        // 4th param is minUSDLToMint which is need to be set using callStatic, currently set 0 for not breaking revert
        // calsstatic is not possible in solidity so
        d.usdl().depositToWExactCollateral(to, amount, dexIndex, 0, IERC20Upgradeable(collateral)); 
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        assertEq(afterTotalUsdl-beforeTotalUsdl, afterBalanceUSDL);
        assertTrue(afterBalanceUSDL > beforeBalanceUSDL);
        assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    }

    function _mintUSDLWExactCollateralNoChecks(address to, address collateral, uint256 amount) internal {
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
    }

    function _redeemUSDLWExactUsdl(address to, address collateral, uint256 amount, uint256 dexIndex) internal {
        address usdl = d.pl().usdLemma();
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        assertTrue(beforeBalanceUSDL > 0, "!USDL");
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        d.usdl().withdrawTo(to, amount, dexIndex, 0, IERC20Upgradeable(collateral));
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 afterBalanceUSDL = d.usdl().balanceOf(to);
        assertEq(beforeTotalUsdl-afterTotalUsdl, amount);
        assertTrue(afterBalanceCollateral > beforeBalanceCollateral);
        assertTrue(afterBalanceUSDL < beforeBalanceUSDL);
    }

    function _redeemUSDLWExactCollateral(address to, address collateral, uint256 collateralAmount, uint256 dexIndex) internal {
        address usdl = d.pl().usdLemma();
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        assertTrue(beforeBalanceUSDL > 0, "!USDL");
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        d.usdl().withdrawToWExactCollateral(to, collateralAmount, dexIndex, type(uint256).max, IERC20Upgradeable(collateral));
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 afterBalanceUSDL = d.usdl().balanceOf(to);
        assertEq(beforeTotalUsdl-afterTotalUsdl, beforeBalanceUSDL-afterBalanceUSDL);
        assertTrue(afterBalanceCollateral > beforeBalanceCollateral);
        assertTrue(afterBalanceUSDL < beforeBalanceUSDL);
    }

    function _mintSynthWExactCollateralNoChecks(address to, address collateral, uint256 amount, uint256 dexIndex) internal {
        address lemmaSynth = d.pl().lemmaSynth();
        _getMoneyForTo(to, collateral, amount);
        uint256 beforeBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(lemmaSynth, type(uint256).max);
        uint256 beforeTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 decimal = IERC20Decimals(collateral).decimals();
        amount = (amount*1e18) / 10**decimal;
        // 4th param is minSynthToMint which is need to be set using callStatic, currently set 0 for not breaking revert
        // calsstatic is not possible in solidity so
        d.lSynth().depositToWExactCollateral(to, amount, dexIndex, 0, IERC20Upgradeable(collateral)); 
        uint256 afterTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 afterBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        // assertEq(afterTotalSynth-beforeTotalSynth, afterBalanceSynth);
        // assertTrue(afterBalanceSynth > beforeBalanceSynth);
        // assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    }

    // test depositTo
    function testDepositTo() public {
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = 1000e18; // USDL amount
        _depositSettlementTokenMax();
        _mintUSDLWExactUSDL(address(this), collateral, usdlAmount, 0);
    }

    function _depositWExactCollateral(uint256 collateralAmount) internal {
        _depositSettlementTokenMax();
        address collateral = d.getTokenAddress("WETH");
        _mintUSDLWExactCollateral(address(this), collateral, collateralAmount, 0);
    }

    // test depositToWExactCollateral
    function testDepositToWExactCollateral1() public {
        _depositWExactCollateral(1e18);
    }

    // test depositToWExactCollateral
    function testDepositToWExactCollateral3() public {
        console.log("[testDepositToWExactCollateral3()] Start");
        _depositWExactCollateral(1e18);
        console.log("[testDepositToWExactCollateral3()] First Minting Works");
        address collateral = d.getTokenAddress("WETH");
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, 3e18);
        console.log("[testDepositToWExactCollateral3()] Second Minting Works");
    }

    function testDepositToWExactCollateralNoNeedToRecap() public {
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        vm.stopPrank();

        // d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        console.log("[testDepositToWExactCollateralNoNeedToRecap()] Start");
        _depositSettlementToken(1e12);

        uint256 freeCollateralBefore = d.pl().getFreeCollateral();

        // NOTE: Limit for recap needed
        // _depositSettlementToken(328392000);

        address collateral = d.getTokenAddress("WETH");
        uint256 amount = 3e18;
        console.log("[testDepositToWExactCollateralNoNeedToRecap()] amount = ", amount);
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);

        uint256 freeCollateralAfter = d.pl().getFreeCollateral();

        // NOTE: After minting, we get some extra collaterals that is less than the initial one but still positive 
        assertTrue(freeCollateralAfter < freeCollateralBefore);
        assertTrue(freeCollateralAfter > 0);
        console.log("[testDepositToWExactCollateralNoNeedToRecap()] Minting Works");
    }


    function testFailDepositToWExactCollateralNeedRecap() public {
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        vm.stopPrank();

        // d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        console.log("[testFailDepositToWExactCollateralNeedRecap()] Start");
        _depositSettlementToken(1e5);

        // NOTE: Limit for recap needed
        // _depositSettlementToken(328392000);

        address collateral = d.getTokenAddress("WETH");
        uint256 amount = 3e18;
        console.log("[testFailDepositToWExactCollateralNeedRecap()] amount = ", amount);
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);
        console.log("[testFailDepositToWExactCollateralNeedRecap()] Minting Works");
    }


    function testDepositToWExactCollateralStartNeutralNeedToRecap() public {
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        
        // NOTE: Let's try to use 100% collateral ratio
        d.pl().setCollateralRatio(1e6);
        vm.stopPrank();

        d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        console.log("[testDepositToWExactCollateralNeedToRecap()] Start");
        _depositSettlementToken(300000000);

        // _depositSettlementToken(328392000);
        address collateral = d.getTokenAddress("WETH");
        uint256 amount = 3e18;
        console.log("[testDepositToWExactCollateralNeedToRecap()] amount = ", amount);
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);

        // NOTE: In this case, Perp has been recapitalized during the minting and the recap set the Free Collateral exactly to zero so it is important 
        // to add further logic to recapitalize further 
        // assertTrue(d.pl().getFreeCollateral() == 0);
        console.log("[testDepositToWExactCollateralNeedToRecap()] Minting Works");
    }



    function testDepositToWExactCollateralStartShortNeedToRecap() public {
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        // NOTE: Let's try to use 100% collateral ratio
        d.pl().setCollateralRatio(1e6);
        vm.stopPrank();

        d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        console.log("[testDepositToWExactCollateralNeedToRecap()] Start");
        _depositSettlementToken(300000000);

        address collateral = d.getTokenAddress("WETH");
        // NOTE: Minting just a little bit of USDL to start with a net short position 
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, 1e15);

        // _depositSettlementToken(328392000);
        uint256 amount = 3e18;
        console.log("[testDepositToWExactCollateralNeedToRecap()] amount = ", amount);
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);

        // NOTE: In this case, Perp has been recapitalized during the minting and the recap set the Free Collateral exactly to zero so it is important 
        // to add further logic to recapitalize further 
        // assertTrue(d.pl().getFreeCollateral() == 0);
        console.log("[testDepositToWExactCollateralNeedToRecap()] Minting Works");
    }


    function testDepositToWExactCollateralStartLongNeedToRecap() public {
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        // NOTE: Let's try to use 100% collateral ratio
        d.pl().setCollateralRatio(1e6);
        vm.stopPrank();

        d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        console.log("[testDepositToWExactCollateralNeedToRecap()] Start");
        _depositSettlementToken(300000000);

        address collateral = d.getTokenAddress("WETH");
        // NOTE: Minting just a little bit of USDL to start with a net short position 
        _mintSynthWExactCollateralNoChecks(address(this), collateral, 3e15, 1);

        // _depositSettlementToken(328392000);
        uint256 amount = 3e18;
        console.log("[testDepositToWExactCollateralNeedToRecap()] amount = ", amount);
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);


        // NOTE: In this case, Perp has been recapitalized during the minting and the recap set the Free Collateral exactly to zero so it is important 
        // to add further logic to recapitalize further 
        console.log("[testDepositToWExactCollateralStartLongNeedToRecap()] d.pl().getFreeCollateral() = ", d.pl().getFreeCollateral());
        // assertTrue(d.pl().getFreeCollateral() == 0);
        console.log("[testDepositToWExactCollateralNeedToRecap()] Minting Works");
    }


    function testFailDepositToWExactCollateralNoUSDC1() public {
        uint256 collateralAmount = 1e18;
        address collateral = d.getTokenAddress("WETH");
        _mintUSDLWExactCollateral(address(this), collateral, collateralAmount, 0);
    }


    // test depositTo and withdrawTo
    function testDepositToAndWithdrawTo11() public {
        testDepositTo();
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount, 0);
    }

    // test depositToWExactCollateral and withdrawTo
    function testDepositToWExactCollateralAndwithdrawTo() public {
        uint256 collateralAmount = 1e12;
        _depositWExactCollateral(collateralAmount);
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount, 0);
    }
    
    // test depositToWExactCollateral and withdrawToWExactCollateral
    function testDepositToWExactCollateralAndwithdrawToWExactCollateral() public {
        uint256 collateralAmount = 1e12;
        _depositWExactCollateral(collateralAmount);
        address collateral = d.getTokenAddress("WETH");
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAmount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem, 0);
    }

    // test depositTo and withdrawToWExactCollateral
    function testDepositToAndWithdrawToWExactCollateral() public {
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = 2192283206913675032725; // 1eth ~= 1096.143 USDL at this block 12137998
        _depositSettlementTokenMax();
        _mintUSDLWExactUSDL(address(this), collateral, usdlAmount, 0);
        uint256 collateralAMount = 1e18; // ~0.9998 eth
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAMount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem, 0);
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
        _mintUSDLWExactUSDL(address(this), collateral, usdlAmount, 0);
        uint256 collateralAMount = 1e18; // ~0.9998 eth
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAMount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem, 0);
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
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem, 0);
    }

    function testChangeAdminOfUSDL() public {
        vm.startPrank(address(d));
        d.usdl().changeAdmin(vm.addr(1));
        vm.stopPrank();
        assertEq(d.usdl().hasRole(ADMIN_ROLE, vm.addr(1)), true);
        assertEq(d.usdl().hasRole(ADMIN_ROLE, address(d)), false);
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

    // TEST with USDC collateral
    function testDepositToAndWithdrawToWithUSDC() public {
        address collateral = d.getTokenAddress("USDC");
        uint256 usdlAmount = 1000e18; // USDL amount
        // _depositSettlementTokenMax();
        _mintUSDLWExactUSDL(address(this), collateral, usdlAmount, 1);
        
        usdlAmount = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount, 1);
    }

    function testDepositToWExactCollateralAndwithdrawToWExactCollateralWithUSDC() public {
        vm.startPrank(address(d));
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        vm.stopPrank();
        _depositSettlementToken(1e12);

        uint256 collateralAmount = 1000e18; // USDCAmount
        // _depositSettlementTokenMax();
        address collateral = d.getTokenAddress("USDC");
        _mintUSDLWExactCollateral(address(this), collateral, collateralAmount, 1);
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("USDC"), collateralAmount, 1);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("USDC"), _collateralAfterMinting, 1);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem, 1);
    }
}