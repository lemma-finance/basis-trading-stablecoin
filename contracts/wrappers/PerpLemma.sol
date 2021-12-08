// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.3;
// pragma abicoder v2;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../libraries/TransferHelper.sol";
import "../interfaces/Perpetual/IClearingHouse.sol";
import "hardhat/console.sol";

interface IPerpVault {
    function deposit(address token, uint256 amount) external;
    function withdraw(address token, uint256 amountX10_D) external;
    function _getBalance(address trader, address token) external view returns (int256);
}

contract PerpLemma is OwnableUpgradeable {

    bytes32 public HashZero;
    uint256 public constant MAX_UINT256 = type(uint256).max;
    int256 public constant MAX_INT256 = type(int256).max;

    IERC20Upgradeable public collateral; // ETH
    IClearingHouse public iClearingHouse;
    IPerpVault public iPerpVault;

    struct RemoveLiquidityParams {
        address baseToken;
        int24 lowerTick;
        int24 upperTick;
        uint128 liquidity;
        uint256 minBase;
        uint256 minQuote;
        uint256 deadline;
    }

    receive() external payable{

    }

    constructor() public {

    }

    function initialize(
        address _collateral, 
        address _iClearingHouse, 
        address _iPerpVault
    ) public initializer {
        collateral = IERC20Upgradeable(_collateral);
        iClearingHouse = IClearingHouse(_iClearingHouse);
        iPerpVault = IPerpVault(_iPerpVault);
        // collateral.approve(_iClearingHouse, MAX_UINT256);
    }

    function depositIntoVault(address token, uint256 amount) public  {
        SafeERC20Upgradeable.safeApprove(IERC20Upgradeable(collateral), address(iPerpVault), amount);
        TransferHelper.safeTransferFrom(token, msg.sender, address(this), amount);
        iPerpVault.deposit(token, amount);
        int256 i = iPerpVault._getBalance(address(this), token);
        // if(i == 0) {
        //     console.log(1);
        // } else if (i > 0) {
        //     console.log(2);           
        // } else {
        //     console.log(3);           
        // }
    }

    function withdraw(address token, uint256 amount) public {
        iPerpVault.withdraw(token, amount);
        int256 i = iPerpVault._getBalance(address(this), token);
        // if(i == 0) {
        //     console.log(1);
        // } else if (i > 0) {
        //     console.log(2);           
        // } else {
        //     console.log(3);           
        // }
    }

    function openPosition(IClearingHouse.OpenPositionParams memory params) public {
        iClearingHouse.openPosition(params);
    }

    function closePosition(IClearingHouse.ClosePositionParams memory params) public {
        iClearingHouse.closePosition(params);
    }

    function addLiquidity(IClearingHouse.AddLiquidityParams memory params) public {
        iClearingHouse.addLiquidity(params);
    }

    function removeLiquidity(IClearingHouse.RemoveLiquidityParams memory params) public {
        iClearingHouse.removeLiquidity(params);
    }
}
