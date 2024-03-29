// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

import { Round, SafeMathExt } from "../libraries/SafeMathExt.sol";

contract TestLibSafeMathExt {
    function uwmul(uint256 x, uint256 y) external pure returns (uint256) {
        return SafeMathExt.wmul(x, y);
    }

    function uwdiv(uint256 x, uint256 y) external pure returns (uint256) {
        return SafeMathExt.wdiv(x, y);
    }

    function uwfrac(
        uint256 x,
        uint256 y,
        uint256 z
    ) external pure returns (uint256) {
        return SafeMathExt.wfrac(x, y, z);
    }

    function wmul(int256 x, int256 y) external pure returns (int256) {
        return SafeMathExt.wmul(x, y);
    }

    function wdiv(int256 x, int256 y) external pure returns (int256) {
        return SafeMathExt.wdiv(x, y);
    }

    function wfrac(
        int256 x,
        int256 y,
        int256 z
    ) external pure returns (int256) {
        return SafeMathExt.wfrac(x, y, z);
    }

    function wmul(
        int256 x,
        int256 y,
        Round round
    ) external pure returns (int256) {
        return SafeMathExt.wmul(x, y, round);
    }

    function wdiv(
        int256 x,
        int256 y,
        Round round
    ) external pure returns (int256) {
        return SafeMathExt.wdiv(x, y, round);
    }

    function wfrac(
        int256 x,
        int256 y,
        int256 z,
        Round round
    ) external pure returns (int256) {
        return SafeMathExt.wfrac(x, y, z, round);
    }

    function abs(int256 x) external pure returns (int256) {
        return SafeMathExt.abs(x);
    }

    function neg(int256 x) external pure returns (int256) {
        return SafeMathExt.neg(x);
    }

    function div(
        int256 x,
        int256 y,
        Round round
    ) external pure returns (int256) {
        return SafeMathExt.div(x, y, round);
    }

    function max(int256 x, int256 y) external pure returns (int256) {
        return SafeMathExt.max(x, y);
    }

    function min(int256 x, int256 y) external pure returns (int256) {
        return SafeMathExt.min(x, y);
    }

    function umax(uint256 x, uint256 y) external pure returns (uint256) {
        return SafeMathExt.max(x, y);
    }

    function umin(uint256 x, uint256 y) external pure returns (uint256) {
        return SafeMathExt.min(x, y);
    }
}
