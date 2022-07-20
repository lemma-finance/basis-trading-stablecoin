// SPDX-License-Identifier: UNLICENSED
// pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "../src/Deploy.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "../contracts/interfaces/IERC20Decimals.sol";

struct ExternalContracts {
    address uniV3Router;
    IUniswapV3Factory uniV3Factory;
    IERC20Decimals WETH;
    IERC20Decimals USDC;
}


struct Deployment {
    bool isLocal;
    uint256 chainId;
}





contract MyScript is Script, Test {
    Deploy public d;
    ExternalContracts public ec;
    Deployment configDeployment;

    function _strEq(string memory a, string memory b) internal pure returns(bool) {
        if(bytes(a).length != bytes(b).length) return false;
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

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

    function _getMoney(address token, address to, uint256 amount) internal {
        deal(token, to, amount);
    }

    function _getConfig() internal {
        string[] memory temp = new string[](4);
        temp[0] = "node";
        temp[1] = "scripts/utils/read_config.js";

        temp[2] = "address";
        temp[3] = "config['optimism']['WETH']";
        ec.WETH = IERC20Decimals(abi.decode(vm.ffi(temp), (address)));
        console.log(address(ec.WETH));

        temp[2] = "address";
        temp[3] = "config['optimism']['USDC']";
        ec.USDC = IERC20Decimals(abi.decode(vm.ffi(temp), (address)));
        console.log(address(ec.USDC));

        temp[2] = "address";
        temp[3] = "config['optimism']['UniswapV3']['router']";
        // bytes memory res = vm.ffi(temp);
        ec.uniV3Router = abi.decode(vm.ffi(temp), (address));
        console.log(ec.uniV3Router);

        temp[2] = "address";
        temp[3] = "config['optimism']['UniswapV3']['factory']";
        ec.uniV3Factory = IUniswapV3Factory(abi.decode(vm.ffi(temp), (address)));
        console.log(address(ec.uniV3Factory));

        temp[2] = "uint256";
        temp[3] = "config['deployment']['chainId']";
        configDeployment.chainId = abi.decode(vm.ffi(temp), (uint256));
        console.log("configDeployment.chainId = ", configDeployment.chainId);

        {
            temp[2] = "string";
            temp[3] = "config['deployment']['type']";
            string memory res = abi.decode(vm.ffi(temp), (string));
            console.log(res);

            if(_strEq(res, "local")) {
                configDeployment.isLocal = true;
            } else {
                configDeployment.isLocal = false;
            }

            console.log("configDeployment.isLocal = ", configDeployment.isLocal);
        }
        
    }

    function _deploy() internal {
        if(configDeployment.isLocal) {
            d = new Deploy(configDeployment.chainId);
        }
    }

    function _testUniV3Factory() internal {
        address pool = ec.uniV3Factory.getPool(address(ec.WETH), address(ec.USDC), 3000);
        console.log("UniV3 WETH-USDC Pool = ", pool);
    }

    function _testPrices() internal {
        uint256 spotPrice = _computeSpotPrice(address(ec.WETH), address(ec.USDC), 3000);
        uint256 markPrice = _computeMarkPrice(d.pl().getPerpUniV3Pool(), ec.USDC.decimals());
        console.log("[_testPrices()] spotPrice = ", spotPrice);
        console.log("[_testPrices()] markPrice = ", markPrice);
    }


    function _testUniV3Swap(address tokenIn, address tokenOut, uint256 amountIn) internal returns(uint256 amountOut) {
        IERC20Decimals(tokenIn).approve(ec.uniV3Router, type(uint256).max);
        ISwapRouter.ExactInputSingleParams memory params =
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
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

    function _init() internal {
        // NOTE: Setting Approval
        _getMoney(address(ec.WETH), address(this), 1e22);
        _getMoney(address(ec.USDC), address(this), 1e20);
        _getMoney(address(ec.USDC), address(d.pl()), 1e20);

        ec.WETH.approve(address(d.usdl()), type(uint256).max); 
        ec.USDC.approve(address(d.usdl()), type(uint256).max); 
        ec.USDC.approve(address(d.pl()), type(uint256).max); 
        
        uint256 perpVaultUSDCBefore = ec.USDC.balanceOf(address(d.pl().perpVault()));
        console.log("[_init()] perpVaultUSDCBefore = ", perpVaultUSDCBefore);
        uint256 maxSettlementTokenInPerpVault = d.pl().clearingHouseConfig().getSettlementTokenBalanceCap();
        console.log("[_init()] maxSettlementTokenInPerpVault = ", maxSettlementTokenInPerpVault);
        uint256 maxSettlementTokenToDeposit = maxSettlementTokenInPerpVault - perpVaultUSDCBefore;
        console.log("[_init()] Adding maxSettlementTokenToDeposit = ", maxSettlementTokenToDeposit);

        d.pl().depositSettlementToken(maxSettlementTokenToDeposit);

        d.usdl().depositToWExactCollateral(address(this), 6e18, 0, 0, ec.WETH);
    }

    function _testUniV3Rebalance() internal {
        int256 amount = _getArb(0);
        if(amount == 0) {
            console.log("[_testUniV3Rebalance()] No Arb");
            return;
        }
        console.log("[_testUniV3Rebalance()] Arb Found");
        (uint256 amountUSDCPlus, uint256 amountUSDCMinus) = d.pl().rebalance(address(ec.uniV3Router), 0, amount, false);
        console.log("[_testUniV3Rebalance()] amountUSDCPlus = ", amountUSDCPlus);
        console.log("[_testUniV3Rebalance()] amountUSDCMinus = ", amountUSDCMinus);
        console.log("[_testUniV3Rebalance()] isProfitable = ", (amountUSDCPlus > amountUSDCMinus) ? "true" : "false");
    }



    function _getArb(uint256 th_1e6) internal returns(int256 amount) {
        uint256 spotPrice = _computeSpotPrice(address(ec.WETH), address(ec.USDC), 3000);
        uint256 markPrice = _computeMarkPrice(d.pl().getPerpUniV3Pool(), ec.USDC.decimals());

        uint256 deltaPrice = (spotPrice * th_1e6 / 1e6);

        console.log("[_getArb()] d.pl().amountUsdlCollateralDeposited() = ", d.pl().amountUsdlCollateralDeposited());

        if((spotPrice > markPrice) && ( uint256(int256(spotPrice) - int256(markPrice)) > deltaPrice )) {
            console.log("[_getArb()] Arb Found --> Sell Collateral on Spot so Increase Base to compensate");

            // NOTE: Compute Amount
            amount = int256(d.pl().amountUsdlCollateralDeposited()) / 2;
        }

        if((spotPrice < markPrice) && ( uint256(int256(markPrice) - int256(spotPrice)) > deltaPrice )) {
            console.log("[_getArb()] Arb Found --> Buy Collateral on Spot so Decrease Base to compensate");

            amount = -1 * int256(d.pl().amountUsdlCollateralDeposited()) / 2;
        }
    }

    function _computeSpotPrice(address token0, address token1, uint256 fees) internal returns(uint256) {
        address pool = ec.uniV3Factory.getPool(address(ec.WETH), address(ec.USDC), 3000);
        return _computeSpotPrice(pool);
    }

    function _computeSpotPrice(address pool) internal returns(uint256 res) {
        (uint160 _sqrtRatioX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        uint256 token0Decimals = IERC20Decimals(IUniswapV3Pool(pool).token0()).decimals();
        uint256 token1Decimals = IERC20Decimals(IUniswapV3Pool(pool).token1()).decimals();
        console.log("[_computeSpotPrice()] Token0 = ", IUniswapV3Pool(pool).token0());
        console.log("[_computeSpotPrice()] Token1 = ", IUniswapV3Pool(pool).token1());
        console.log("[_computeSpotPrice()] _sqrtRatioX96 = ", uint256(_sqrtRatioX96));
        res = (uint256(_sqrtRatioX96) ** 2) * (10 ** token0Decimals) / (2 ** 192);
        console.log("[_computeSpotPrice()] Price = ", res, " in Decimals = ", token1Decimals);
    }

    function _computeMarkPrice(address pool, uint256 token0Decimals) internal returns(uint256 res) {
        (uint160 _sqrtRatioX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        // uint256 token0Decimals = IERC20Decimals(IUniswapV3Pool(pool).token0()).decimals();
        // uint256 token1Decimals = IERC20Decimals(IUniswapV3Pool(pool).token1()).decimals();
        // console.log("[_computeMarkPrice()] Token0 = ", IUniswapV3Pool(pool).token0());
        // console.log("[_computeMarkPrice()] Token1 = ", IUniswapV3Pool(pool).token1());
        console.log("[_computeMarkPrice()] _sqrtRatioX96 = ", uint256(_sqrtRatioX96));
        res = ((uint256(_sqrtRatioX96) ** 2) / (2 ** 192)) * (10 ** token0Decimals);
        console.log("[_computeMarkPrice()] Price = ", res, " in Decimals = ", token0Decimals);
    }

    function run() external {
        console.log("Starting Script");
        // test1();
        _getConfig();
        _deploy();
        _init();
        console.log("USDC Balance Before = ", ec.USDC.balanceOf(address(this)));
        console.log("WETH Balance Before = ", ec.WETH.balanceOf(address(this)));
        _getMoney(address(ec.USDC), address(this), 1e12);

        console.log("USDC Balance After = ", ec.USDC.balanceOf(address(this)));
        console.log("WETH Balance After = ", ec.WETH.balanceOf(address(this)));

        console.log("Test ISDC --> WETH Swap");

        _testUniV3Swap(address(ec.WETH), address(ec.USDC), 1e18);

        console.log("USDC Balance Swap After = ", ec.USDC.balanceOf(address(this)));
        console.log("WETH Balance Swap After = ", ec.WETH.balanceOf(address(this)));

        _testPrices();


        // _testUniV3Factory();
        _testUniV3Rebalance();

        // vm.startBroadcast();
        // dao = new DeployAnvilOptimism();
        // console.log("Trying to get config");
        // vm.stopBroadcast();
    }
}







