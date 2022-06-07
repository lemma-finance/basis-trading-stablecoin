// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;
import "contracts/USDLemma.sol";


contract Deploy {
    USDLemma public usdl;

    constructor() {
        usdl = new USDLemma();
    }
}
