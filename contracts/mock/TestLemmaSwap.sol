// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

interface IUSDLemma is IERC20Upgradeable {
    function depositTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 maxCollateralAmountRequired,
        IERC20Upgradeable collateral
    ) external;

    function depositToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 minUSDLToMint,
        IERC20Upgradeable collateral
    ) external;

    function withdrawTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 minCollateralAmountToGetBack,
        IERC20Upgradeable collateral
    ) external;

    function withdrawToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 maxUSDLToBurn,
        IERC20Upgradeable collateral
    ) external;
}

contract TestLemmaSwap {
    IUSDLemma public usdLemma;

    constructor(address _usdLemma) public {
        usdLemma = IUSDLemma(_usdLemma);
        usdLemma.approve(address(usdLemma), type(uint256).max);
    }

    function multicall(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 maxCollateralAmountRequired,
        uint256 minCollateralAmountToGetBack,
        IERC20Upgradeable collateral
    ) public {
        collateral.approve(address(usdLemma), type(uint256).max);
        collateral.transferFrom(msg.sender, address(this), maxCollateralAmountRequired);
        usdLemma.depositTo(address(this), amount, perpetualDEXIndex, maxCollateralAmountRequired, collateral);
        usdLemma.withdrawTo(to, amount, perpetualDEXIndex, minCollateralAmountToGetBack, collateral);
    }
}
