// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;
import "src/Deploy.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../contracts/interfaces/IERC20Decimals.sol";

import "forge-std/Test.sol";

contract ContractTest is Test {
    Deploy public d;
    function setUp() public {
        d = new Deploy(10);
        // d.setRebalancer(address(this));
    }

    function print(string memory s, int256 v) internal view {
        if(v < 0) {
            console.log(s, " = -", uint256(-v));
        }
        else {
            console.log(s, " = ", uint256(v));
        }
    }

    function _deductFees(address collateral, uint256 collateralAmount, uint256 dexIndex) internal view returns(uint256) {
        uint256 _fees = collateralAmount * d.usdl().getFees(dexIndex, collateral) / 1e6;
        console.log("[_deductFees)()] collateralAmount = ", collateralAmount);
        console.log("[_deductFees)()] _fees = ", _fees);
        uint256 total = uint256(int256(collateralAmount) - int256(_fees));

        console.log("[_deductFees()] Total = ", total);
        return total; 
    }

    function _getMoney(address token, uint256 amount) internal {
        d.bank().giveMoney(token, address(this), amount);
        assertTrue(IERC20Decimals(token).balanceOf(address(this)) >= amount);
    }

    /// @dev This is recommended to be used to have a properly collateralized position for any trade 
    /// @dev Currently, we are decoupling our position collateralization in Perp from the delta neutrality as we are assuming we have enough USDC in Perp to allow us to trade freely on it while the rest of the collateral is treated as tail asset and remains in this contract appunto 
    function _depositSettlementTokenMax() internal {
        _getMoney(address(d.pl().usdc()), 1e40);
        uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        console.log("settlementTokenBalanceCap = ", settlementTokenBalanceCap);

        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get 
        // V_GTSTBC: greater than settlement token balance cap
        d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        d.pl().depositSettlementToken(settlementTokenBalanceCap/10);
    }

    function _mintUSDLWExactCollateral(address collateral, uint256 amount) internal {
        _getMoney(collateral, 1e40);

        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // console.log("settlementTokenBalanceCap = ", settlementTokenBalanceCap);

        // // NOTE: Unclear why I need to use 1/10 of the cap
        // // NOTE: If I do not limit this amount I get 
        // // V_GTSTBC: greater than settlement token balance cap
        // d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        // d.pl().depositSettlementToken(settlementTokenBalanceCap/10);

        IERC20Decimals(d.getTokenAddress("WETH")).approve(address(d.usdl()), type(uint256).max);

        // NOTE: Currently getting 
        // V_GTDC: greater than deposit cap
        d.usdl().depositToWExactCollateral(
            address(this),
            amount,
            0,
            0,
            IERC20Upgradeable(collateral)
        );

        assertTrue(d.usdl().balanceOf(address(this)) > 0);
    }


    function _mintUSDLWExactUSDL(address collateral, uint256 amount) internal {
        _getMoney(collateral, 1e40);

        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // console.log("settlementTokenBalanceCap = ", settlementTokenBalanceCap);

        // // NOTE: Unclear why I need to use 1/10 of the cap
        // // NOTE: If I do not limit this amount I get 
        // // V_GTSTBC: greater than settlement token balance cap
        // d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        // d.pl().depositSettlementToken(settlementTokenBalanceCap/10);

        IERC20Decimals(d.getTokenAddress("WETH")).approve(address(d.usdl()), type(uint256).max);

        // NOTE: Currently getting 
        // V_GTDC: greater than deposit cap
        d.usdl().depositTo(
            address(this),
            amount,
            0,
            type(uint256).max,
            IERC20Upgradeable(collateral)
        );

        assertTrue(d.usdl().balanceOf(address(this)) > 0);
    }



    function _redeemUSDLWExactCollateral(address collateral, uint256 amount) internal {
        uint256 _usdlBefore = d.usdl().balanceOf(address(this));
        assertTrue(_usdlBefore > 0, "! USDL");

        console.log("[_redeemUSDLWExactCollateral()] Start");

        d.usdl().withdrawToWExactCollateral(
            address(this),
            amount,
            0,
            type(uint256).max,
            IERC20Upgradeable(collateral)
        );

        uint256 _usdlAfter = d.usdl().balanceOf(address(this));
        assertTrue(_usdlAfter < _usdlBefore);
    }

    function _redeemUSDLWExactUsdl(address collateral, uint256 amount) internal {
        uint256 _collateralBefore = IERC20Decimals(collateral).balanceOf(address(this));
        uint256 _usdlBefore = d.usdl().balanceOf(address(this));
        assertTrue(_usdlBefore > 0, "! USDL");

        console.log("[_redeemUSDLWExactUsdl()] Start");

        d.usdl().withdrawTo(
            address(this),
            amount,
            0,
            0,
            IERC20Upgradeable(collateral)
        );

        uint256 _collateralAfter = IERC20Decimals(collateral).balanceOf(address(this));
        uint256 _usdlAfter = d.usdl().balanceOf(address(this));

        assertTrue(_collateralAfter > _collateralBefore);
        assertTrue(_usdlAfter < _usdlBefore);
    }

    // function testExample() public {
    //     console.log("USDL Address = ", address(d.usdl()));
    //     assertTrue(true);
    // }

    function testGetMoney() public {
        d.bank().giveMoney(d.getTokenAddress("WETH"), address(this), 1e40);
        assertTrue(IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(this)) == 1e40);

        d.bank().giveMoney(d.getTokenAddress("USDC"), address(this), 1e40);
        assertTrue(IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(this)) == 1e40);
    }


    function testPerpLemmaAccess() public {
        uint256 _indexPrice = d.pl().getIndexPrice();
        console.log("[testPerpLemmaAccess()] IndexPrice = ", _indexPrice);
        assertTrue(_indexPrice > 0);

        uint256 _fees = d.pl().getFees();
        console.log("[testPerpLemmaAccess()] Fees = ", _fees);
        assertTrue(_fees > 0);

        int256 _deltaExposure = d.pl().getDeltaExposure();
        print("[testPerpLemmaAccess()] Delta Exposure = ", _deltaExposure);
        assertTrue(_deltaExposure == 0);
    }

    function testMintingWExactCollateral() public {
        _depositSettlementTokenMax();
        uint256 amount = 1e12;
        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);
    }

    function testRedeemWExactCollateral() public {
        _depositSettlementTokenMax();
        uint256 amount = 1e12;
        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), amount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);

        _redeemUSDLWExactCollateral(d.getTokenAddress("WETH"), _maxETHtoRedeem);
    }

    function testRedeemWExactUsdl() public {
        _depositSettlementTokenMax();
        uint256 amount = 1e12;
        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);
        uint256 _usdlToRedeem = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(d.getTokenAddress("WETH"), _usdlToRedeem);
    }

    function testUniswapBasicSwapReal() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        // _getMoney(address(d.pl().usdc()), 1e40);


        IERC20Decimals(d.getTokenAddress("WETH")).approve(address(d.mockUniV3Router()), type(uint256).max);
        // IERC20Decimals(d.getTokenAddress("WETH")).approve(address(d.routerUniV3()), type(uint256).max);

        uint256 amountIn = 1e18;
        ISwapRouter.ExactInputSingleParams memory params =
            ISwapRouter.ExactInputSingleParams({
                tokenIn: d.getTokenAddress("WETH"),
                tokenOut: d.getTokenAddress("WBTC"),
                fee: 3000,
                recipient: address(this),
                deadline: type(uint256).max,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });

        uint256 balanceTokenInBefore = IERC20Decimals(params.tokenIn).balanceOf(address(this));
        uint256 balanceTokenOutBefore = IERC20Decimals(params.tokenOut).balanceOf(address(this));

        uint256 amountOut = d.mockUniV3Router().exactInputSingle(params);

        uint256 balanceTokenInAfter = IERC20Decimals(params.tokenIn).balanceOf(address(this));
        uint256 balanceTokenOutAfter = IERC20Decimals(params.tokenOut).balanceOf(address(this));

        // uint256 amountOut = d.routerUniV3().exactInputSingle(params);
        console.log("[testUniswapBasicSwap()] amountOut = ", amountOut);
        assertTrue(amountOut > 0);
        assertTrue(balanceTokenInBefore > balanceTokenInAfter);
        assertTrue(balanceTokenOutBefore < balanceTokenOutAfter);
    }

    function testUniswapBasicSwapMock() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        // _getMoney(address(d.pl().usdc()), 1e40);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e40);

        IERC20Decimals(d.getTokenAddress("WETH")).approve(address(d.mockUniV3Router()), type(uint256).max);
        // IERC20Decimals(d.getTokenAddress("WETH")).approve(address(d.routerUniV3()), type(uint256).max);

        uint256 amountIn = 1e18;
        ISwapRouter.ExactInputSingleParams memory params =
            ISwapRouter.ExactInputSingleParams({
                tokenIn: d.getTokenAddress("WETH"),
                tokenOut: d.getTokenAddress("WBTC"),
                fee: 3000,
                recipient: address(this),
                deadline: type(uint256).max,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });

        uint256 balanceTokenInBefore = IERC20Decimals(params.tokenIn).balanceOf(address(this));
        uint256 balanceTokenOutBefore = IERC20Decimals(params.tokenOut).balanceOf(address(this));

        uint256 amountOut = d.mockUniV3Router().exactInputSingle(params);

        uint256 balanceTokenInAfter = IERC20Decimals(params.tokenIn).balanceOf(address(this));
        uint256 balanceTokenOutAfter = IERC20Decimals(params.tokenOut).balanceOf(address(this));

        // uint256 amountOut = d.routerUniV3().exactInputSingle(params);
        console.log("[testUniswapBasicSwap()] amountOut = ", amountOut);
        assertTrue(amountOut > 0);
        assertTrue(balanceTokenInBefore > balanceTokenInAfter);
        assertTrue(balanceTokenOutBefore < balanceTokenOutAfter);
    }



    function testRebalanceIncLong() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        int256 baseAmountBefore = d.pl().amountBase();
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        (uint256 usdlCollateralAmount, uint256 usdcAmount) = d.pl().rebalance(
            address(d.mockUniV3Router()),
            0,
            true,
            1e18
        );

        console.log("usdlCollateralAmount = ", usdlCollateralAmount);
        console.log("usdcAmount = ", usdcAmount);
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter > baseAmountBefore);
    }

    function testRebalanceIncLongIsProfitFalse() public {
        console.log("[testRebalanceIncLongIsProfitFalse()] Block.number = ", block.number);
        console.log("[testRebalanceIncLongIsProfitFalse()] Block.timestamp = ", block.timestamp);
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e10);

        int256 baseAmountBefore = d.pl().amountBase();
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        uint256 usdlCollateralAmountToRebalance = 1e18;
        (uint256 usdlCollateralAmountGotBack, uint256 usdcAmount) = d.pl().rebalance(
            address(d.mockUniV3Router()),
            0,
            true,
            usdlCollateralAmountToRebalance
        );

        console.log("[testRebalanceIncLongIsProfitFalse()] usdlCollateralAmountToRebalance = ", usdlCollateralAmountToRebalance);
        console.log("[testRebalanceIncLongIsProfitFalse()] usdlCollateralAmountGotBack = ", usdlCollateralAmountGotBack);
        console.log("[testRebalanceIncLongIsProfitFalse()] usdcAmount = ", usdcAmount);
        vm.expectRevert(bytes("Unprofitable"));
        require(usdlCollateralAmountGotBack > usdlCollateralAmountToRebalance, "Unprofitable");
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter > baseAmountBefore);
    }


    function testRebalanceIncLongIsProfitTrue() public {
        console.log("[testRebalanceIncLongIsProfitTrue()] Block.number = ", block.number);
        console.log("[testRebalanceIncLongIsProfitTrue()] Block.timestamp = ", block.timestamp);
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e22);

        int256 baseAmountBefore = d.pl().amountBase();
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        uint256 usdlCollateralAmountToRebalance = 1e18;
        (uint256 usdlCollateralAmountGotBack, uint256 usdcAmount) = d.pl().rebalance(
            address(d.mockUniV3Router()),
            0,
            true,
            usdlCollateralAmountToRebalance
        );

        console.log("[testRebalanceIncLongIsProfitTrue()] usdlCollateralAmountToRebalance = ", usdlCollateralAmountToRebalance);
        console.log("[testRebalanceIncLongIsProfitTrue()] usdlCollateralAmountGotBack = ", usdlCollateralAmountGotBack);
        console.log("[testRebalanceIncLongIsProfitTrue()] usdcAmount = ", usdcAmount);

        require(usdlCollateralAmountGotBack > usdlCollateralAmountToRebalance, "Unprofitable");
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter > baseAmountBefore);
    }


    function testRebalanceDecLongIsProfitTrue() public {
        console.log("[testRebalanceDecLongIsProfitTrue()] Block.number = ", block.number);
        console.log("[testRebalanceDecLongIsProfitTrue()] Block.timestamp = ", block.timestamp);
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        // NOTE: For this rebalance we need to assume we have a lot of USDC available
        // _getMoney(d.getTokenAddress("USDDC"), 1e40);
        // IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e40);

        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e12);

        int256 baseAmountBefore = d.pl().amountBase();
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        uint256 usdlCollateralAmountToRebalance = 1e8;
        (uint256 usdlCollateralAmountGotBack, uint256 usdcAmount) = d.pl().rebalance(
            address(d.mockUniV3Router()),
            0,
            false,
            usdlCollateralAmountToRebalance
        );

        console.log("[testRebalanceDecLongIsProfitTrue()] usdlCollateralAmountToRebalance = ", usdlCollateralAmountToRebalance);
        console.log("[testRebalanceDecLongIsProfitTrue()] usdlCollateralAmountGotBack = ", usdlCollateralAmountGotBack);
        console.log("[testRebalanceDecLongIsProfitTrue()] usdcAmount = ", usdcAmount);

        require(usdlCollateralAmountGotBack > usdlCollateralAmountToRebalance, "Unprofitable");
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter < baseAmountBefore);
    }


    function testRebalanceDecLongIsProfitFalse() public {
        console.log("[testRebalanceDecLongIsProfitTrue()] Block.number = ", block.number);
        console.log("[testRebalanceDecLongIsProfitTrue()] Block.timestamp = ", block.timestamp);
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        // NOTE: For this rebalance we need to assume we have a lot of USDC available
        // _getMoney(d.getTokenAddress("USDDC"), 1e40);
        // IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e40);

        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e7);

        int256 baseAmountBefore = d.pl().amountBase();
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        uint256 usdlCollateralAmountToRebalance = 1e8;
        (uint256 usdlCollateralAmountGotBack, uint256 usdcAmount) = d.pl().rebalance(
            address(d.mockUniV3Router()),
            0,
            false,
            usdlCollateralAmountToRebalance
        );

        console.log("[testRebalanceDecLongIsProfitTrue()] usdlCollateralAmountToRebalance = ", usdlCollateralAmountToRebalance);
        console.log("[testRebalanceDecLongIsProfitTrue()] usdlCollateralAmountGotBack = ", usdlCollateralAmountGotBack);
        console.log("[testRebalanceDecLongIsProfitTrue()] usdcAmount = ", usdcAmount);

        vm.expectRevert(bytes("Unprofitable"));
        require(usdlCollateralAmountGotBack > usdlCollateralAmountToRebalance, "Unprofitable");
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter < baseAmountBefore);
    }





}





