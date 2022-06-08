// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;
import "contracts/USDLemma.sol";
import "contracts/wrappers/PerpLemmaCommon.sol";


contract Deploy {
    USDLemma public usdl;
    PerpLemmaCommon public pl;

    constructor() {
        usdl = new USDLemma();
        pl = new PerpLemmaCommon();
    }
}
