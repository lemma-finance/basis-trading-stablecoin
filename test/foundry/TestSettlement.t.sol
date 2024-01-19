// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

import {Test, console2} from "forge-std/Test.sol";

import {PerpLemmaCommon, IERC20Decimals} from "../../contracts/wrappers/PerpLemmaCommon.sol";
import {IClearingHouse} from "../../contracts/interfaces/Perpetual/IClearingHouse.sol";
import {IAccountBalance} from "../../contracts/interfaces/Perpetual/IAccountBalance.sol";
import {IPerpVault} from "../../contracts/interfaces/Perpetual/IPerpVault.sol";

interface ITransperentUpgradeableProxy {
    function upgradeTo(address newImplementation) external;
    //to get admin read the value stored at slot 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103
    function admin() external returns (address);
}

contract TestSettlement is Test {
    PerpLemmaCommon perpLemmaETH = PerpLemmaCommon(address(0x29b159aE784Accfa7Fb9c7ba1De272bad75f5674));
    IClearingHouse clearingHouse;
    IAccountBalance accountBalance;
    IPerpVault perpVault;
    address baseToken;
    IERC20Decimals usdc;
    IERC20Decimals usdlCollateral;

    function setUp() public {
        clearingHouse = IClearingHouse(perpLemmaETH.clearingHouse());
        accountBalance = IAccountBalance(clearingHouse.getAccountBalance());
        perpVault = IPerpVault(perpLemmaETH.perpVault());
        baseToken = perpLemmaETH.usdlBaseTokenAddress();
        usdc = perpLemmaETH.usdc();
        usdlCollateral = perpLemmaETH.usdlCollateral();
    }

    function testV2Settlement() public {
        console2.log("clearingHouse: %s", address(clearingHouse));
        console2.log("accountBalance: %s", address(accountBalance));
        console2.log("baseToken: %s", baseToken);

        //print the current total position size
        int256 totalPositionSize = accountBalance.getTotalPositionSize(address(perpLemmaETH), baseToken);
        if (totalPositionSize > 0) {
            console2.log("totalPositionSize: %s", uint256(totalPositionSize));
        } else {
            console2.log("totalPositionSize: - %s ", uint256(-totalPositionSize));
        }

        vm.startPrank(address(perpLemmaETH));
        //close position

        IClearingHouse.ClosePositionParams memory closePositionParams = IClearingHouse.ClosePositionParams({
            baseToken: baseToken,
            sqrtPriceLimitX96: 0,
            oppositeAmountBound: totalPositionSize > 0 ? uint256(totalPositionSize) : uint256(-totalPositionSize),
            deadline: block.timestamp,
            referralCode: 0
        });
        clearingHouse.closePosition(closePositionParams);
        //print the current total position size
        totalPositionSize = accountBalance.getTotalPositionSize(address(perpLemmaETH), baseToken);
        if (totalPositionSize >= 0) {
            console2.log("totalPositionSize: %s", uint256(totalPositionSize));
        } else {
            console2.log("totalPositionSize: - %s ", uint256(-totalPositionSize));
        }

        clearingHouse.settleAllFunding(address(perpLemmaETH));

        {
            uint256 freeUSDLCollateral =
                perpVault.getFreeCollateralByToken(address(perpLemmaETH), address(usdlCollateral));
            perpVault.withdraw(address(usdlCollateral), freeUSDLCollateral);

            console2.log("freeUSDLCollateral: %s", freeUSDLCollateral);
            //usdc balnce
            freeUSDLCollateral = usdlCollateral.balanceOf(address(perpLemmaETH));
            console2.log("usdlCollateralBalance: %s", freeUSDLCollateral);

            freeUSDLCollateral = perpVault.getFreeCollateralByToken(address(perpLemmaETH), address(usdlCollateral));
            assertEq(freeUSDLCollateral, 0);
        }
        {
            uint256 freeUSDC = perpVault.getFreeCollateralByToken(address(perpLemmaETH), address(usdc));
            perpVault.withdraw(address(usdc), freeUSDC);

            console2.log("freeUSDLCollateral: %s", freeUSDC);
            //usdc balnce
            freeUSDC = usdc.balanceOf(address(perpLemmaETH));
            console2.log("usdc balance: %s", freeUSDC);

            freeUSDC = perpVault.getFreeCollateralByToken(address(perpLemmaETH), address(usdc));
            assertEq(freeUSDC, 0);
        }
    }

    function testUpgrade() public {
        address newImplementation = address(new PerpLemmaCommon());

        bytes32 admin =
            vm.load(address(perpLemmaETH), 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103);
        vm.startPrank(address(uint160(uint256(admin))));
        ITransperentUpgradeableProxy(address(perpLemmaETH)).upgradeTo(newImplementation);
        vm.stopPrank();

        address perpLemmaOwner = 0x63c072aBe9a00A6d761De08727dE079EEd9A7D6e;
        vm.startPrank(address(perpLemmaOwner));
        perpLemmaETH.forceSettle();
        vm.stopPrank();

        //getFreeCollateralByToken should be zero
        assertEq(perpVault.getFreeCollateralByToken(address(perpLemmaETH), address(usdc)), 0);
        assertEq(perpVault.getFreeCollateralByToken(address(perpLemmaETH), address(usdlCollateral)), 0);
        //totalPositionSize should be zero
        assertEq(accountBalance.getTotalPositionSize(address(perpLemmaETH), baseToken), 0);
    }
}
