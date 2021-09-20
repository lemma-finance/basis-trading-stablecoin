// Adds Test library to the context
import { Test } from "@giry/hardhat-test-solidity/test.sol";
import "hardhat/console.sol";

// `_Test` suffix means it is a test contract
contract MyContract_Test {
    function _beforeAll() public {
        console.log("before all");
    }

    // `_test` suffix means it is a test function
    function addition_test() public {
        prepare();
        // Logging will be interpreted by hardhat-test-solidity
        Test.eq(4, 2 + 2, "oh no");
    }

    // `_test` suffix means it is a test function
    function sub_test() public {
        prepare();
        // Logging will be interpreted by hardhat-test-solidity
        Test.eq(uint256(0), 2 - 2, "oh no");
    }

    // Will not be interpreted as a test function
    function prepare() public {}

    receive() external payable {}
}
