// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

import {IPerpetualMixDEXWrapper} from "../../contracts/interfaces/IPerpetualMixDEXWrapper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../../contracts/interfaces/IERC20Decimals.sol";
import "../../src/Deploy.sol";
import "forge-std/Test.sol";

contract ContractTest is Test {
    Deploy public d;
    address alice = vm.addr(1);
    address bob = vm.addr(2);
    bytes32 public constant PERPLEMMA_ROLE = keccak256("PERPLEMMA_ROLE");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");
    bytes32 public constant LEMMA_SWAP = keccak256("LEMMA_SWAP");

    function setUp() public {
        d = new Deploy(10);
        vm.startPrank(address(d));
        d.pl().setUSDLemma(address(d.usdl()));
        d.pl().grantRole(USDC_TREASURY, address(this));
        d.pl().grantRole(PERPLEMMA_ROLE, address(this));
        d.pl().grantRole(REBALANCER_ROLE, address(this));
        d.usdl().grantRole(LEMMA_SWAP, address(this));
        d.usdl().grantRole(LEMMA_SWAP, alice);
        d.usdl().grantRole(LEMMA_SWAP, bob);
        d.lSynth().grantRole(LEMMA_SWAP, address(this));
        d.lSynth().grantRole(LEMMA_SWAP, alice);
        d.lSynth().grantRole(LEMMA_SWAP, bob);
        vm.stopPrank();
    }

    function _deductFees(address collateral, uint256 collateralAmount, uint256 dexIndex)
        internal
        view
        returns (uint256)
    {
        uint256 _fees = collateralAmount * d.usdl().getFees(dexIndex, collateral) / 1e6;
        uint256 total = uint256(int256(collateralAmount) - int256(_fees));
        return total;
    }

    function _getMoney(address token, uint256 amount) internal {
        d.bank().giveMoney(token, address(this), amount);
        assertTrue(IERC20Decimals(token).balanceOf(address(this)) >= amount);
    }

    function _getMoneyForTo(address to, address token, uint256 amount) internal {
        d.bank().giveMoney(token, to, amount);
        assertTrue(IERC20Decimals(token).balanceOf(to) >= amount);
    }

    /// @dev This is recommended to be used to have a properly collateralized position for any trade
    /// @dev Currently, we are decoupling our position collateralization in Perp from the delta neutrality as we are assuming we have enough USDC in Perp to allow us to trade freely on it while the rest of the collateral is treated as tail asset and remains in this contract appunto
    function _depositSettlementTokenMax() internal {
        _getMoney(address(d.pl().usdc()), 1e40);
        uint256 settlementTokenBalanceCap =
            IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();

        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get
        // V_GTSTBC: greater than settlement token balance cap
        d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap / 10);
        d.pl().depositSettlementToken(settlementTokenBalanceCap / 10);
    }

    // function _mintUSDLWExactCollateral(address to, address collateral, uint256 amount) internal {
    //     address usdl = d.pl().usdLemma();
    //     _getMoneyForTo(to, collateral, amount);
    //     uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
    //     uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
    //     IERC20Decimals(collateral).approve(usdl, type(uint256).max);
    //     uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
    //     // 4th param is minUSDLToMint which is need to be set using callStatic, currently set 0 for not breaking revert
    //     // calsstatic is not possible in solidity so
    //     d.usdl().depositToWExactCollateral(to, amount, 0, 0, IERC20Upgradeable(collateral));
    //     uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
    //     uint256 afterBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
    //     uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
    //     assertEq(afterTotalUsdl-beforeTotalUsdl, afterBalanceUSDL);
    //     assertTrue(afterBalanceUSDL > beforeBalanceUSDL);
    //     assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    // }

    function _mintUSDLWExactCollateral(address collateral, uint256 amount) internal {
        _getMoney(collateral, 1e40);

        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();

        // // NOTE: Unclear why I need to use 1/10 of the cap
        // // NOTE: If I do not limit this amount I get
        // // V_GTSTBC: greater than settlement token balance cap
        // d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        // d.pl().depositSettlementToken(settlementTokenBalanceCap/10);

        IERC20Decimals(collateral).approve(address(d.usdl()), type(uint256).max);

        // NOTE: Currently getting
        // V_GTDC: greater than deposit cap
        d.usdl().depositToWExactCollateral(address(this), amount, 0, 0, IERC20Upgradeable(collateral));

        assertTrue(d.usdl().balanceOf(address(this)) > 0);
    }

    function _mintUSDLWExactCollateralForTo(address to, address collateral, uint256 amount) internal {
        _getMoneyForTo(to, collateral, 1e40);

        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();

        // // NOTE: Unclear why I need to use 1/10 of the cap
        // // NOTE: If I do not limit this amount I get
        // // V_GTSTBC: greater than settlement token balance cap
        // d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        // d.pl().depositSettlementToken(settlementTokenBalanceCap/10);

        IERC20Decimals(collateral).approve(address(d.usdl()), type(uint256).max);

        // NOTE: Currently getting
        // V_GTDC: greater than deposit cap
        d.usdl().depositToWExactCollateral(to, amount, 0, 0, IERC20Upgradeable(collateral));

        assertTrue(d.usdl().balanceOf(to) > 0);
    }

    // NOTE: In this branch I do not have the ETHSynt.sol so I'll skip the actual token minting and will just care on backing its emission (that does not happen) interacting with PerpLemma directly
    // NOTE: Now I am supporting synth minting only with the related collateral, so not with USDC yet
    function _mintSynthWExactCollateral(address collateral, uint256 amount) internal {
        _getMoney(collateral, 1e40);
        uint256 balanceBefore = IERC20Decimals(collateral).balanceOf(address(d.pl()));
        IERC20Decimals(collateral).transfer(address(d.pl()), amount);
        d.pl().deposit(amount, collateral);
        uint256 balanceAfter = IERC20Decimals(collateral).balanceOf(address(d.pl()));
        uint256 deltaBalance = uint256(int256(balanceAfter) - int256(balanceBefore));
        // NOTE: This is a tail asset so need to remain the PerpLemmaCommon.sol balance sheet appunto
        assertTrue(deltaBalance == amount);
    }

    function _mintUSDLWExactUSDL(address collateral, uint256 amount) internal {
        _getMoney(collateral, 1e40);

        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();

        // // NOTE: Unclear why I need to use 1/10 of the cap
        // // NOTE: If I do not limit this amount I get
        // // V_GTSTBC: greater than settlement token balance cap
        // d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        // d.pl().depositSettlementToken(settlementTokenBalanceCap/10);

        IERC20Decimals(d.getTokenAddress("WETH")).approve(address(d.usdl()), type(uint256).max);

        // NOTE: Currently getting
        // V_GTDC: greater than deposit cap
        d.usdl().depositTo(address(this), amount, 0, type(uint256).max, IERC20Upgradeable(collateral));

        assertTrue(d.usdl().balanceOf(address(this)) > 0);
    }

    function _redeemUSDLWExactCollateral(address collateral, uint256 amount) internal {
        uint256 _usdlBefore = d.usdl().balanceOf(address(this));
        assertTrue(_usdlBefore > 0, "! USDL");

        d.usdl().withdrawToWExactCollateral(address(this), amount, 0, type(uint256).max, IERC20Upgradeable(collateral));

        uint256 _usdlAfter = d.usdl().balanceOf(address(this));
        assertTrue(_usdlAfter < _usdlBefore);
    }

    function _redeemUSDLWExactUsdl(address collateral, uint256 amount) internal {
        uint256 _collateralBefore = IERC20Decimals(collateral).balanceOf(address(this));
        uint256 _usdlBefore = d.usdl().balanceOf(address(this));
        assertTrue(_usdlBefore > 0, "! USDL");

        d.usdl().withdrawTo(address(this), amount, 0, 0, IERC20Upgradeable(collateral));

        uint256 _collateralAfter = IERC20Decimals(collateral).balanceOf(address(this));
        uint256 _usdlAfter = d.usdl().balanceOf(address(this));

        assertTrue(_collateralAfter > _collateralBefore);
        assertTrue(_usdlAfter < _usdlBefore);
    }

    function _redeemUSDLWExactUsdlForTo(address to, address collateral, uint256 amount) internal {
        uint256 _collateralBefore = IERC20Decimals(collateral).balanceOf(to);
        uint256 _usdlBefore = d.usdl().balanceOf(to);
        assertTrue(_usdlBefore > 0, "! USDL");

        d.usdl().withdrawTo(to, amount, 0, 0, IERC20Upgradeable(collateral));

        uint256 _collateralAfter = IERC20Decimals(collateral).balanceOf(to);
        uint256 _usdlAfter = d.usdl().balanceOf(to);

        assertTrue(_collateralAfter > _collateralBefore);
        assertTrue(_usdlAfter < _usdlBefore);
    }

    function _checkNetShort() internal view returns (bool res) {
        res = d.pl().amountBase() < 0;
    }

    function testGetMoney() public {
        d.bank().giveMoney(d.getTokenAddress("WETH"), address(this), 1e40);
        assertTrue(IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(this)) == 1e40);

        d.bank().giveMoney(d.getTokenAddress("USDC"), address(this), 1e40);
        assertTrue(IERC20Decimals(d.getTokenAddress("USDC")).balanceOf(address(this)) == 1e40);
    }

    function testPerpLemmaAccess() public {
        uint256 _indexPrice = d.pl().getIndexPrice();
        assertTrue(_indexPrice > 0);

        uint256 _fees = d.pl().getFees();
        assertTrue(_fees > 0);

        int256 _deltaExposure = d.pl().getDeltaExposure();
        assertTrue(_deltaExposure == 0);
    }

    function testMintingUSDLWExactCollateral() public {
        _depositSettlementTokenMax();
        uint256 amount = 1e18;
        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);
    }

    function testMintingSynthWExactCollateral() public {
        _depositSettlementTokenMax();
        uint256 amount = 1e12;
        _mintSynthWExactCollateral(d.getTokenAddress("WETH"), amount);
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
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
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
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
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
        assertTrue(amountOut > 0);
        assertTrue(balanceTokenInBefore > balanceTokenInAfter);
        assertTrue(balanceTokenOutBefore < balanceTokenOutAfter);
    }

    function testRebalanceIncLongWithUSDL01() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e12);

        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), 1e10);
        int256 baseAmountBefore = d.pl().amountBase();
        d.pl().rebalance(address(d.mockUniV3Router()), 0, 1e8, false);
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter > baseAmountBefore);
    }

    function testRebalanceIncLongWithSynth01() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e10);

        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        _mintSynthWExactCollateral(d.getTokenAddress("WETH"), 1e12);
        int256 baseAmountBefore = d.pl().amountBase();
        d.pl().rebalance(address(d.mockUniV3Router()), 0, 1e8, false);
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter > baseAmountBefore);
    }

    function testRebalanceIncLongWhenNetShortFlip01() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        _depositSettlementTokenMax();

        d.mockUniV3Router().setRouter(address(0));
        // NOTE: Amount of USDC to get back
        d.mockUniV3Router().setNextSwapAmount(1e12);

        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), 1e6);
        require(_checkNetShort(), "Need to be net short");
        int256 baseAmountBefore = d.pl().amountBase();
        d.pl().rebalance(address(d.mockUniV3Router()), 0, 1e8, false);

        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter > 0);
        assertTrue(baseAmountAfter > baseAmountBefore);
    }

    function testRebalanceIncLongWhenNetLongFlip01() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        _depositSettlementTokenMax();

        d.mockUniV3Router().setRouter(address(0));
        // NOTE: Amount of USDC to get back
        d.mockUniV3Router().setNextSwapAmount(1e12);

        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        _mintSynthWExactCollateral(d.getTokenAddress("WETH"), 1e6);
        require(!_checkNetShort(), "Need to be net long");
        // NOTE: Checking net long position due to Synth minting
        assertTrue(d.pl().amountBase() >= 0);
        int256 baseAmountBefore = d.pl().amountBase();
        d.pl().rebalance(address(d.mockUniV3Router()), 0, 1e8, false);
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter > 0);
        assertTrue(baseAmountAfter > baseAmountBefore);
    }

    function testRebalanceIncLongWhenNetShortIsProfitFalse() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), 1e10);
        require(_checkNetShort(), "Need to be net short");

        assertTrue(d.pl().amountBase() < 0);
        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e5);

        int256 baseAmountBefore = d.pl().amountBase();
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        int256 usdlCollateralAmountToRebalance = 1e18;

        (uint256 amountUSDCPlus, uint256 amountUSDCMinus) =
            d.pl().rebalance(address(d.mockUniV3Router()), 0, usdlCollateralAmountToRebalance, false);

        vm.expectRevert(bytes("Unprofitable"));
        require(amountUSDCPlus > amountUSDCMinus, "Unprofitable");

        // require(usdlCollateralAmountGotBack > usdlCollateralAmountToRebalance, "Unprofitable");
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter > baseAmountBefore);
    }

    function testRebalanceIncLongWhenNetLongIsProfitFalse() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        _mintSynthWExactCollateral(d.getTokenAddress("WETH"), 1e10);
        require(!_checkNetShort(), "Need to be net long");

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e5);

        int256 baseAmountBefore = d.pl().amountBase();
        assertTrue(baseAmountBefore >= 0);
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        int256 usdlCollateralAmountToRebalance = 1e18;

        (uint256 amountUSDCPlus, uint256 amountUSDCMinus) =
            d.pl().rebalance(address(d.mockUniV3Router()), 0, usdlCollateralAmountToRebalance, false);
        vm.expectRevert(bytes("Unprofitable"));
        require(amountUSDCPlus > amountUSDCMinus, "Unprofitable");
        // require(usdlCollateralAmountGotBack > usdlCollateralAmountToRebalance, "Unprofitable");
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter > baseAmountBefore);
    }

    function testRebalanceIncLongWhenNetShortIsProfitTrue() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), 1e10);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e10);

        int256 baseAmountBefore = d.pl().amountBase();
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        int256 usdlCollateralAmountToRebalance = 1e12;
        d.pl().rebalance(address(d.mockUniV3Router()), 0, usdlCollateralAmountToRebalance, true);

        // require(usdlCollateralAmountGotBack > usdlCollateralAmountToRebalance, "Unprofitable");
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter > baseAmountBefore);
    }

    function testRebalanceIncLongWhenNetLongIsProfitTrue() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);
        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        _mintSynthWExactCollateral(d.getTokenAddress("WETH"), 1e10);
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), 1e10);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e10);

        int256 baseAmountBefore = d.pl().amountBase();
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        int256 usdlCollateralAmountToRebalance = 1e12;
        d.pl().rebalance(address(d.mockUniV3Router()), 0, usdlCollateralAmountToRebalance, true);
        // require(usdlCollateralAmountGotBack > usdlCollateralAmountToRebalance, "Unprofitable");
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter > baseAmountBefore);
    }

    function testRebalanceDecLongWhenNetShortIsProfitTrue() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        // NOTE: We need plenty of USDC for this kind of tests
        _getMoney(d.getTokenAddress("USDC"), 1e40);
        IERC20Decimals(d.getTokenAddress("USDC")).transfer(address(d.pl()), 1e20);

        // NOTE: For this rebalance we need to assume we have a lot of USDC available
        // _getMoney(d.getTokenAddress("USDDC"), 1e40);
        // IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e40);

        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), 1e10);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e3);

        int256 baseAmountBefore = d.pl().amountBase();
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        int256 usdlCollateralAmountToRebalance = -1e8;
        (uint256 amountUSDCPlus, uint256 amountUSDCMinus) =
            d.pl().rebalance(address(d.mockUniV3Router()), 0, usdlCollateralAmountToRebalance, false);
        // require(usdlCollateralAmountGotBack > usdlCollateralAmountToRebalance, "Unprofitable");
        int256 baseAmountAfter = d.pl().amountBase();

        // assertTrue(baseAmountAfter < 0);
        assertTrue(amountUSDCMinus > amountUSDCPlus);
        assertTrue(baseAmountAfter < baseAmountBefore);
    }

    function testRebalanceDecLongWhenNetLongIsProfitTrue() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        // NOTE: We need plenty of USDC for this kind of tests
        _getMoney(d.getTokenAddress("USDC"), 1e40);
        IERC20Decimals(d.getTokenAddress("USDC")).transfer(address(d.pl()), 1e20);

        // NOTE: For this rebalance we need to assume we have a lot of USDC available
        // _getMoney(d.getTokenAddress("USDDC"), 1e40);
        // IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e40);

        _depositSettlementTokenMax();

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        _mintSynthWExactCollateral(d.getTokenAddress("WETH"), 1e10);
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), 1e10);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e3);

        int256 baseAmountBefore = d.pl().amountBase();
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        int256 usdlCollateralAmountToRebalance = -1e8;
        (uint256 amountUSDCPlus, uint256 amountUSDCMinus) =
            d.pl().rebalance(address(d.mockUniV3Router()), 0, usdlCollateralAmountToRebalance, false);
        // require(usdlCollateralAmountGotBack > usdlCollateralAmountToRebalance, "Unprofitable");
        int256 baseAmountAfter = d.pl().amountBase();

        // assertTrue(baseAmountAfter < 0);
        assertTrue(amountUSDCMinus > amountUSDCPlus);
        assertTrue(baseAmountAfter < baseAmountBefore);
    }

    function testRebalanceDecLongWhenNetShortIsProfitFalse() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        // NOTE: We need plenty of USDC for this kind of tests
        _getMoney(d.getTokenAddress("USDC"), 1e40);
        IERC20Decimals(d.getTokenAddress("USDC")).transfer(address(d.pl()), 1e20);

        // NOTE: For this rebalance we need to assume we have a lot of USDC available
        // _getMoney(d.getTokenAddress("USDDC"), 1e40);
        // IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e40);

        _depositSettlementTokenMax();

        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), 1e10);

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e20);

        int256 baseAmountBefore = d.pl().amountBase();
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        int256 usdlCollateralAmountToRebalance = -1e8;
        (uint256 amountUSDCPlus, uint256 amountUSDCMinus) =
            d.pl().rebalance(address(d.mockUniV3Router()), 0, usdlCollateralAmountToRebalance, false);
        vm.expectRevert(bytes("Unprofitable"));
        require(amountUSDCPlus > amountUSDCMinus, "Unprofitable");

        // require(usdlCollateralAmountGotBack > usdlCollateralAmountToRebalance, "Unprofitable");
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter < baseAmountBefore);
    }

    function testRebalanceDecLongWhenNetLongIsProfitFalse() public {
        _getMoney(d.getTokenAddress("WETH"), 1e40);
        IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e20);

        // NOTE: We need plenty of USDC for this kind of tests
        _getMoney(d.getTokenAddress("USDC"), 1e40);
        IERC20Decimals(d.getTokenAddress("USDC")).transfer(address(d.pl()), 1e20);

        // NOTE: For this rebalance we need to assume we have a lot of USDC available
        // _getMoney(d.getTokenAddress("USDDC"), 1e40);
        // IERC20Decimals(d.getTokenAddress("WETH")).transfer(address(d.pl()), 1e40);

        _depositSettlementTokenMax();

        _mintSynthWExactCollateral(d.getTokenAddress("WETH"), 1e10);
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), 1e10);

        // uint256 amount = 1e12;
        // // NOTE: This already gives some USDC to PerpLemma
        // _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        d.mockUniV3Router().setRouter(address(0));
        d.mockUniV3Router().setNextSwapAmount(1e20);

        int256 baseAmountBefore = d.pl().amountBase();
        // NOTE: Rebalancing by replacing WETH with USDC and opening long for the equivalent amount
        int256 usdlCollateralAmountToRebalance = -1e8;
        (uint256 amountUSDCPlus, uint256 amountUSDCMinus) =
            d.pl().rebalance(address(d.mockUniV3Router()), 0, usdlCollateralAmountToRebalance, false);
        vm.expectRevert(bytes("Unprofitable"));
        require(amountUSDCPlus > amountUSDCMinus, "Unprofitable");

        // require(usdlCollateralAmountGotBack > usdlCollateralAmountToRebalance, "Unprofitable");
        int256 baseAmountAfter = d.pl().amountBase();
        assertTrue(baseAmountAfter < baseAmountBefore);
    }

    function testSettleForSingleUserUSDL() public {
        _depositSettlementTokenMax();
        uint256 amount = 1e18;

        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        uint256 beforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(this));
        uint256 _usdlToRedeem = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(d.getTokenAddress("WETH"), _usdlToRedeem); // get back user collateral after settlement
        uint256 afterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(this));
        assertGt(afterBal - beforeBal, 99e16); //approx
        uint256 perpLemmaAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        assertLt(perpLemmaAfterBal, 1e16);
    }

    function testSettleForMultipleUserUSDL() public {
        _depositSettlementTokenMax();
        uint256 amount = 1e18;

        vm.startPrank(alice);
        _mintUSDLWExactCollateralForTo(alice, d.getTokenAddress("WETH"), amount);
        vm.stopPrank();

        vm.startPrank(bob);
        _mintUSDLWExactCollateralForTo(bob, d.getTokenAddress("WETH"), amount);
        vm.stopPrank();

        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();
        d.pl().settle(); // PerpLemma settle call

        uint256 aliceBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        uint256 bobBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        uint256 perpLemmaBeforeBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));

        uint256 aliceUsdlToRedeem = d.usdl().balanceOf(alice);
        uint256 bobUsdlToRedeem = d.usdl().balanceOf(bob);

        vm.startPrank(alice);
        _redeemUSDLWExactUsdlForTo(alice, d.getTokenAddress("WETH"), aliceUsdlToRedeem); // get back user collateral after settlement
        uint256 aliceAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(alice);
        assertGt(aliceAfterBal - aliceBeforeBal, 9e17);
        vm.stopPrank();

        vm.startPrank(bob);
        _redeemUSDLWExactUsdlForTo(bob, d.getTokenAddress("WETH"), bobUsdlToRedeem); // get back user collateral after settlement
        uint256 bobAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(bob);
        assertGt(bobAfterBal - bobBeforeBal, 9e17);
        vm.stopPrank();

        uint256 perpLemmaAfterBal = IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(d.pl()));
        assertLt(perpLemmaAfterBal, 2e16);
    }
}
