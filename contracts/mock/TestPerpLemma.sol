// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;

import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { PerpLemmaCommon } from "../wrappers/PerpLemmaCommon.sol";
import "../interfaces/IERC20Decimals.sol";
import "forge-std/Test.sol";

contract TestPerpLemma is PerpLemmaCommon {
    // function setUsdlCollateralDecimals(uint256 _collateralDecimals) public {
    //     usdlCollateralDecimals = _collateralDecimals;
    // }
    // function setSynthCollateralDecimals(uint256 _collateralDecimals) public {
    //     synthCollateralDecimals = _collateralDecimals;
    // }
    // function setPositionAtSettlementInQuoteForUSDL(uint256 _positionAtSettlementInQuoteForUSDL) public {
    //     positionAtSettlementInQuoteForUSDL = _positionAtSettlementInQuoteForUSDL;
    // }
    // function setPositionAtSettlementInQuoteForSynth(uint256 _positionAtSettlementInQuoteForSynth) public {
    //     positionAtSettlementInQuoteForSynth = _positionAtSettlementInQuoteForSynth;
    // }
    // function setHasSettled(bool _hasSettled) public {
    //     hasSettled = _hasSettled;
    // }
    function depositAnyAsset(uint256 amount, address collateral) public {
        SafeERC20Upgradeable.safeTransferFrom(IERC20Decimals(collateral), msg.sender, address(this), amount);
    }

    function withdrawAnyAsset(uint256 amount, address collateral, address to) public {
        SafeERC20Upgradeable.safeTransfer(IERC20Decimals(collateral), to, amount);
    }
}
