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

    function print(string memory s, int256 v) internal {
        if(v < 0) {
            console.log(s, " = -", uint256(-v));
        }
        else {
            console.log(s, " = ", uint256(v));
        }
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
}





