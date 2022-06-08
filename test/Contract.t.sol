// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;
import "src/Deploy.sol";
import "forge-std/Test.sol";

contract ContractTest is Test {
    Deploy public d;
    function setUp() public {
        d = new Deploy(69);
    }

    function testExample() public {
        console.log("USDL Address = ", address(d.usdl()));
        assertTrue(true);
    }
}





