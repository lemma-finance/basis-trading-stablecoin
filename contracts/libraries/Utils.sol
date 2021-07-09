// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;

//recreating https://github.com/mcdexio/mai-protocol-v3/blob/master/contracts/libraries/Utils.sol
library Utils {
    /*
     * @dev Check if two numbers have the same sign. Zero has the same sign with any number
     */
    function hasTheSameSign(int256 x, int256 y) internal pure returns (bool) {
        if (x == 0 || y == 0) {
            return true;
        }
        return (x ^ y) >> 255 == 0;
    }

    /*
     * @dev Split the delta to two numbers.
     *      Use for splitting the trading amount to the amount to close position and the amount to open position.
     *      Examples: 2, 1 => 0, 1; 2, -1 => -1, 0; 2, -3 => -2, -1
     */
    function splitAmount(int256 amount, int256 delta) internal pure returns (int256, int256) {
        if (Utils.hasTheSameSign(amount, delta)) {
            return (0, delta);
        } else if (Utils.abs(amount) >= Utils.abs(delta)) {
            return (delta, 0);
        } else {
            return (neg(amount), amount + delta);
        }
    }

    function abs(int256 x) internal pure returns (int256) {
        return x >= 0 ? x : neg(x);
    }

    function neg(int256 x) internal pure returns (int256) {
        return 0 - x;
    }
}
