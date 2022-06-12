// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;
import "src/Deploy.sol";

import "../contracts/interfaces/IERC20Decimals.sol";

import "forge-std/Test.sol";

contract ContractTest is Test {
    Deploy public d;
    function setUp() public {
        d = new Deploy(10);
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

    function _mintUSDLWExactCollateral(address collateral, uint256 amount) internal {
        _getMoney(collateral, 1e40);
        _getMoney(address(d.pl().usdc()), 1e40);

        // d.bank().giveMoney(d.getTokenAddress("WETH"), address(this), 1e40);
        // assertTrue(IERC20Decimals(d.getTokenAddress("WETH")).balanceOf(address(this)) == 1e40);

        // console.log("d.pl().usdc() = ", address(d.pl().usdc()));
        // d.bank().giveMoney(address(d.pl().usdc()), address(this), 1e40);
        // assertTrue(IERC20Decimals(address(d.pl().usdc())).balanceOf(address(this)) == 1e40);

        uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        console.log("settlementTokenBalanceCap = ", settlementTokenBalanceCap);

        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get 
        // V_GTSTBC: greater than settlement token balance cap
        d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        d.pl().depositSettlementToken(settlementTokenBalanceCap/10);

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
        _getMoney(address(d.pl().usdc()), 1e40);

        uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        console.log("settlementTokenBalanceCap = ", settlementTokenBalanceCap);

        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get 
        // V_GTSTBC: greater than settlement token balance cap
        d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        d.pl().depositSettlementToken(settlementTokenBalanceCap/10);

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

    function testExample() public {
        console.log("USDL Address = ", address(d.usdl()));
        assertTrue(true);
    }

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
        uint256 amount = 1e12;
        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);
    }

    function testRedeemWExactCollateral() public {
        uint256 amount = 1e12;
        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);

        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), amount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);

        _redeemUSDLWExactCollateral(d.getTokenAddress("WETH"), _maxETHtoRedeem);
    }

    function testRedeemWExactUsdl() public {
        uint256 amount = 1e12;
        _mintUSDLWExactCollateral(d.getTokenAddress("WETH"), amount);
        uint256 _usdlToRedeem = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(d.getTokenAddress("WETH"), _usdlToRedeem);
    }


}





