// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;

import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "contracts/USDLemma.sol";
import "contracts/LemmaSynth.sol";
import "contracts/wrappers/PerpLemmaCommon.sol";
import "contracts/mock/TestPerpLemma.sol";
import "../contracts/interfaces/IERC20Decimals.sol";
import "../contracts/interfaces/Perpetual/IClearingHouse.sol";
import "../contracts/interfaces/Perpetual/IClearingHouseConfig.sol";
import "../contracts/interfaces/Perpetual/IIndexPrice.sol";
import "../contracts/interfaces/Perpetual/IAccountBalance.sol";
import "../contracts/interfaces/Perpetual/IMarketRegistry.sol";
import "../contracts/interfaces/Perpetual/IExchange.sol";
import "../contracts/interfaces/Perpetual/IPerpVault.sol";
import "../contracts/interfaces/Perpetual/IUSDLemma.sol";
import "../contracts/interfaces/Perpetual/IBaseToken.sol";
import "forge-std/Test.sol";

struct Generic_Contracts {
    IERC20Decimals usdc;

    // TODO: Fix this, we need a WETH otherwise we can't deposit / withdraw ETH to change ETH balance
    IERC20Decimals weth;
}

struct Perp_Contracts {
    IClearingHouse ch;
    IMarketRegistry mr;
    IAccountBalance ab;
    IPerpVault pv;
    IBaseToken ib;
}

struct Deploy_PerpLemma {
    // NOTE: What is this? 
    // NOTE: In our local deployment it is address(0) here
    address trustedForwarder;

    // NOTE: In out local deployment it is Uint256Max however it is possible in the on-chain version it is a lower value
    uint256 maxPosition;

    // ChainID --> Address
    address usdlCollateral;
    address baseToken;
}

contract Bank is Test {
    function giveMoney(address token, address to, uint256 amount) external {
        deal(token, to, amount);
    }
}

contract MockUniV3Router {
    ISwapRouter public router;
    uint256 public nextAmount;
    Bank bank;

    constructor(Bank _bank, address _router) {
        bank = _bank;
        router = ISwapRouter(_router);
    }

    function setRouter(address _router) external {
        router = ISwapRouter(_router);
    }

    function setNextSwapAmount(uint256 _amount) external {
        nextAmount = _amount;
    }

    function exactInputSingle(ISwapRouter.ExactInputSingleParams memory params) external returns(uint256) {
        if(address(router) != address(0)) {
            console.log("[MockUniV3Router - exactInputSingle()] Using real router");
            if(IERC20Decimals(params.tokenIn).allowance(address(this), address(router)) != type(uint256).max) {
                IERC20Decimals(params.tokenIn).approve(address(router), type(uint256).max);
            }
            // uint256 balanceBefore = IERC20Decimals(params.tokenOut).balanceOf(address(this));
            IERC20Decimals(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
            uint256 result = router.exactInputSingle(params);
            // uint256 balanceAfter = IERC20Decimals(params.tokenOut).balanceOf(address(this));
            // uint256 result = uint256(int256(balanceAfter) - int256(balanceBefore));
            console.log("[MockUniV3 Router - exactInputSingle()] Result = ", result);

            // NOTE: This is not needed as the params.recipient field already identifies the right recipient appunto  
            // IERC20Decimals(params.tokenOut).transfer(msg.sender, result);
            return result;
        } else {
            console.log("[MockUniV3Router - exactInputSingle()] Using mock router");
            IERC20Decimals(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
            bank.giveMoney(params.tokenOut, address(params.recipient), nextAmount);
            return nextAmount;
        }
    }

    function exactOutputSingle(ISwapRouter.ExactOutputSingleParams memory params) external returns(uint256) {
        if(address(router) != address(0)) {
            console.log("[MockUniV3Router - exactOutputSingle()] Using real router");
            if(IERC20Decimals(params.tokenIn).allowance(address(this), address(router)) != type(uint256).max) {
                IERC20Decimals(params.tokenIn).approve(address(router), type(uint256).max);
            }
            bank.giveMoney(params.tokenIn, address(this), 1e40);
            uint256 balanceBefore = IERC20Decimals(params.tokenIn).balanceOf(address(this));
            uint256 result = router.exactOutputSingle(params);
            uint256 balanceAfter = IERC20Decimals(params.tokenIn).balanceOf(address(this));
            require(balanceBefore > balanceAfter, "exactOutputSingle T1");
            uint256 deltaBalance = uint256( int256(balanceBefore) - int256(balanceAfter) );
            require(deltaBalance <= params.amountInMaximum);
            // uint256 balanceBefore = IERC20Decimals(params.tokenOut).balanceOf(address(this));
            IERC20Decimals(params.tokenIn).transferFrom(msg.sender, address(this), deltaBalance);

            // uint256 balanceAfter = IERC20Decimals(params.tokenOut).balanceOf(address(this));
            // uint256 result = uint256(int256(balanceAfter) - int256(balanceBefore));
            console.log("[MockUniV3 Router - exactOutputSingle()] Result = ", result);

            // NOTE: This is not needed as the params.recipient field already identifies the right recipient appunto  
            // IERC20Decimals(params.tokenOut).transfer(msg.sender, result);
            return result;
        } else {
            console.log("[MockUniV3Router - exactOutputSingle()] Using mock router");
            IERC20Decimals(params.tokenIn).transferFrom(msg.sender, address(this), nextAmount);
            bank.giveMoney(params.tokenOut, address(params.recipient), params.amountOut);
            return nextAmount;
        }
    }

}

contract Deploy {
    USDLemma public usdl;
    LemmaSynth public lSynth;
    TestPerpLemma public pl;
    
    Bank public bank = new Bank();

    Generic_Contracts public gc;
    Perp_Contracts public pc;

    uint256 public chain_id;

    // Deploy_PerpLemma public d_pl;

    ISwapRouter public routerUniV3;
    MockUniV3Router public mockUniV3Router;

    // NOTE: Contract Name, Chain ID --> Contract Address
    // ChainID=10 --> Optimism
    // ChainID=69 --> Optimism Kovan
    mapping(string => mapping(uint256 => address)) public generic_chain_addresses;

    mapping(string => mapping(uint256 => address)) public perp_chain_addresses;

    // NOTE: Chain ID --> Minimum Block for the Deployment 
    mapping(uint256 => uint256) public perp_min_block;


    constructor(uint256 _chain_id) {
        generic_chain_addresses["WETH"][10] = address(0x4200000000000000000000000000000000000006);
        generic_chain_addresses["WBTC"][10] = address(0x68f180fcCe6836688e9084f035309E29Bf0A2095);
        generic_chain_addresses["USDC"][10] = address(0x7F5c764cBc14f9669B88837ca1490cCa17c31607);
        generic_chain_addresses["UniV3Router"][10] = address(0xE592427A0AEce92De3Edee1F18E0157C05861564);
        generic_chain_addresses["UniV3Router02"][10] = address(0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45);

        perp_min_block[10] = 513473;
        perp_chain_addresses["ClearingHouse"][10] = address(0x82ac2CE43e33683c58BE4cDc40975E73aA50f459);
        perp_chain_addresses["MarketRegistry"][10] = address(0xd5820eE0F55205f6cdE8BB0647072143b3060067);
        perp_chain_addresses["vETH"][10] = address(0x8C835DFaA34e2AE61775e80EE29E2c724c6AE2BB);




        generic_chain_addresses["WETH"][69] = address(0x4200000000000000000000000000000000000006);
        generic_chain_addresses["WBTC"][69] = address(0x68f180fcCe6836688e9084f035309E29Bf0A2095);
        generic_chain_addresses["USDC"][69] = address(0x7F5c764cBc14f9669B88837ca1490cCa17c31607);
        generic_chain_addresses["UniV3Router"][69] = address(0xE592427A0AEce92De3Edee1F18E0157C05861564);
        generic_chain_addresses["UniV3Router02"][69] = address(0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45);

        perp_min_block[69] = 513473;
        perp_chain_addresses["ClearingHouse"][69] = address(0xf10288Fd8d778F2880793C1CacCBF02206649802);
        perp_chain_addresses["ClearingHouseConfig"][69] = address(0x22DdF6f4B1cd825324C6f96897c4040de9A1e1F4);
        perp_chain_addresses["MarketRegistry"][69] = address(0x51705d391e0d01fA684366407704De0856E4dBaB);
        perp_chain_addresses["vETH"][69] = address(0x5802918dC503c465F969DA0847b71E3Fbe9B141c);
        perp_chain_addresses["Vault"][69] = address(0xB0ff090d04c268ABb26450ba749f0497EFA9Bb7C);
        perp_chain_addresses["AccountBalance"][69] = address(0x594ADf28b465612DB033C1aEF4bd19972343934D);


        chain_id = _chain_id;


        routerUniV3 = ISwapRouter(generic_chain_addresses["UniV3Router"][chain_id]);
        mockUniV3Router = new MockUniV3Router(bank, address(routerUniV3));

        // console.log("[Deploy] mockUniV3Router = ", mockUniV3Router);


        gc.usdc = IERC20Decimals(generic_chain_addresses["USDC"][chain_id]);
        gc.weth = IERC20Decimals(generic_chain_addresses["WETH"][chain_id]);

        pc.ch = IClearingHouse(perp_chain_addresses["ClearingHouse"][chain_id]);
        pc.ib = IBaseToken(perp_chain_addresses["vETH"][chain_id]);
        // pc.mr = IMarketRegistry(perp_chain_addresses["MarketRegistry"][chain_id]);

        // console.log("Account Balance = ", pc.ch.getAccountBalance());
        pc.ab = IAccountBalance(pc.ch.getAccountBalance());

        // console.log("Vault = ", pc.ch.getVault());
        pc.pv = IPerpVault(pc.ch.getVault());

        usdl = new USDLemma();
        lSynth = new LemmaSynth();

        pl = _deployPerpLemma(
                Deploy_PerpLemma({
                    trustedForwarder: address(0),
                    maxPosition: type(uint256).max,
                    usdlCollateral: generic_chain_addresses["WETH"][chain_id],
                    baseToken: perp_chain_addresses["vETH"][chain_id]
                }),
                perp_chain_addresses["ClearingHouse"][chain_id],
                perp_chain_addresses["MarketRegistry"][chain_id],
                address(usdl),
                address(lSynth)
            );
        
        // NOTE: Required to avoid a weird error when depositing and withdrawing ETH in Perp
        // pl.transferOwnership(address(this));
        pl.setIsUsdlCollateralTailAsset(true);
        // console.log("PL = ", address(pl));

        usdl.initialize(
            address(0),
            generic_chain_addresses["WETH"][chain_id],
            address(pl)
        );

        lSynth.initialize(
            address(0),
            address(pl),
            "LemmaSynth",
            "LSynth"
        );

    }

    function getPerps() external view returns(Perp_Contracts memory) {
        return pc;
    }

    function getTokenAddress(string memory s) external view returns(address) {
        return generic_chain_addresses[s][chain_id];
    }

    function setRebalancer(address rebalancer) external {
        pl.setReBalancer(rebalancer);
    }

    function _deployPerpLemma(Deploy_PerpLemma memory d_pl, address perp_ch, address perp_mr, address _usdl, address _lemmaSynth) internal returns(TestPerpLemma) {
        TestPerpLemma _pl = new TestPerpLemma();
        _pl.initialize(
            d_pl.trustedForwarder,
            d_pl.usdlCollateral,
            d_pl.baseToken,          // NOTE: At some point, we will need to remove these ones as they regard Synth but it is the same as USDL Collateral
            perp_ch,
            perp_mr,
            _usdl,
            _lemmaSynth,
            d_pl.maxPosition
        );

        return _pl;
    }

}





