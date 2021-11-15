// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;


contract MockUSDL {

    address public lemmaTreasury;

    constructor(address _lemmaTreasury) {
        lemmaTreasury = _lemmaTreasury;
    }

}