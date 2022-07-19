// SPDX-License-Identifier: UNLICENSED
// pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "../src/Deploy.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../contracts/interfaces/IERC20Decimals.sol";

struct ExternalContracts {
    address uniV3Router;
    IUniswapV3Factory uniV3Factory;
    IERC20Decimals WETH;
    IERC20Decimals USDC;
}





contract MyScript is Script, Test {
    DeployAnvilOptimism public dao;
    ExternalContracts public ec;

    function test1() internal {
        string[] memory inputs = new string[](2);
        inputs[0] = "echo";
        // inputs[1] = "-n";
        // ABI encoded "gm", as a string
        inputs[1] = "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002676d000000000000000000000000000000000000000000000000000000000000";

        bytes memory res = vm.ffi(inputs);
        string memory output = abi.decode(res, (string));
        console.log(output);
        // assertEq(output, "gm");
    }

    function _getMoney(address token, uint256 amount) internal {
        deal(token, address(this), amount);
    }

    function _getConfig() internal {
        string[] memory temp = new string[](3);
        temp[0] = "node";
        temp[1] = "scripts/utils/read_config.js";

        temp[2] = "config['optimism']['WETH']";
        ec.WETH = IERC20Decimals(abi.decode(vm.ffi(temp), (address)));
        console.log(address(ec.WETH));

        temp[2] = "config['optimism']['USDC']";
        ec.USDC = IERC20Decimals(abi.decode(vm.ffi(temp), (address)));
        console.log(address(ec.USDC));

        temp[2] = "config['optimism']['UniswapV3']['router']";
        // bytes memory res = vm.ffi(temp);
        ec.uniV3Router = abi.decode(vm.ffi(temp), (address));
        console.log(ec.uniV3Router);

        temp[2] = "config['optimism']['UniswapV3']['factory']";
        ec.uniV3Factory = IUniswapV3Factory(abi.decode(vm.ffi(temp), (address)));
        console.log(address(ec.uniV3Factory));
    }

    function _testUniV3Factory() internal {
        address pool = ec.uniV3Factory.getPool(address(ec.WETH), address(ec.USDC), 3000);
        console.log("UniV3 WETH-USDC Pool = ", pool);
    }


    function _testUniV3Swap(address tokenIn, uint256 amountIn) internal returns(uint256 amountOut) {
        IERC20Decimals(tokenIn).approve(ec.uniV3Router, type(uint256).max);
        ISwapRouter.ExactInputSingleParams memory params =
            ISwapRouter.ExactInputSingleParams({
                tokenIn: address(ec.USDC),
                tokenOut: address(ec.WETH),
                fee: 3000,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });

        // The call to `exactInputSingle` executes the swap.
        amountOut = ISwapRouter(ec.uniV3Router).exactInputSingle(params);
        console.log("[_testUniV3Swap()] Swap Result = ", amountOut);
    }

    function _testUniV3Rebalance() internal {

    }

    function run() external {
        console.log("Starting Script");
        // test1();
        _getConfig();
        console.log("USDC Balance Before = ", ec.USDC.balanceOf(address(this)));
        console.log("WETH Balance Before = ", ec.WETH.balanceOf(address(this)));
        _getMoney(address(ec.USDC), 1e12);

        console.log("USDC Balance After = ", ec.USDC.balanceOf(address(this)));
        console.log("WETH Balance After = ", ec.WETH.balanceOf(address(this)));

        console.log("Test ISDC --> WETH Swap");

        _testUniV3Swap(address(ec.USDC), 1e6);

        console.log("USDC Balance Swap After = ", ec.USDC.balanceOf(address(this)));
        console.log("WETH Balance Swap After = ", ec.WETH.balanceOf(address(this)));

        _testUniV3Factory();
        // vm.startBroadcast();
        // dao = new DeployAnvilOptimism();
        // console.log("Trying to get config");
        // vm.stopBroadcast();
    }
}







