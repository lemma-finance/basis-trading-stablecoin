// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;

import "../SynthToken.sol";

contract SynthToken2 is SynthToken {

    int256 public value;

    function down() public {
        value--;
    }

    function up() public {
        value++;
    }

}