// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;
import "./SafeMathExt.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SignedSafeMathUpgradeable.sol";

//recreating https://github.com/mcdexio/mai-protocol-v3/blob/master/contracts/libraries/Utils.sol
library Utils {
    using SafeMathExt for int256;
    using SignedSafeMathUpgradeable for int256;

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
        } else if (amount.abs() >= delta.abs()) {
            return (delta, 0);
        } else {
            return (amount.neg(), amount.add(delta));
        }
    }
}
