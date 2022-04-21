// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;

import { PerpLemma } from "../wrappers/PerpLemma.sol";

contract TestPerpLemma is PerpLemma {
    function setCollateralDecimals(uint256 _collateralDecimals) public {
        collateralDecimals = _collateralDecimals;
    }

    function setPositionAtSettlementInQuote(uint256 _positionAtSettlementInQuote) public {
        positionAtSettlementInQuote = _positionAtSettlementInQuote;
    }

    function setHasSettled(bool _hasSettled) public {
        hasSettled = _hasSettled;
    }
}
