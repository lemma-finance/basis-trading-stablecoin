// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;
import "contracts/USDLemma.sol";
import "contracts/wrappers/PerpLemmaCommon.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../contracts/interfaces/IERC20Decimals.sol";
import "../contracts/interfaces/Perpetual/IClearingHouse.sol";
import "../contracts/interfaces/Perpetual/IClearingHouseConfig.sol";
import "../contracts/interfaces/Perpetual/IIndexPrice.sol";
import "../contracts/interfaces/Perpetual/IAccountBalance.sol";
import "../contracts/interfaces/Perpetual/IMarketRegistry.sol";
import "../contracts/interfaces/Perpetual/IExchange.sol";
import "../contracts/interfaces/Perpetual/IPerpVault.sol";
import "../contracts/interfaces/Perpetual/IUSDLemma.sol";


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

contract Deploy {
    USDLemma public usdl;
    PerpLemmaCommon public pl;

    Generic_Contracts public gc;
    Perp_Contracts public pc;

    uint256 public chain_id;

    Deploy_PerpLemma d_pl;

    // NOTE: Contract Name, Chain ID --> Contract Address
    // ChainID=10 --> Optimism
    // ChainID=69 --> Optimism Kovan
    mapping(string => mapping(uint256 => address)) public generic_chain_addresses;

    mapping(string => mapping(uint256 => address)) public perp_chain_addresses;

    // NOTE: Chain ID --> Minimum Block for the Deployment 
    mapping(uint256 => uint256) public perp_min_block;


    constructor(uint256 _chain_id) {
        generic_chain_addresses["WETH"][10] = address(0x4200000000000000000000000000000000000006);
        generic_chain_addresses["USDC"][10] = address(0x7F5c764cBc14f9669B88837ca1490cCa17c31607);

        perp_min_block[10] = 513473; 
        perp_chain_addresses["ClearingHouse"][10] = address(0x82ac2CE43e33683c58BE4cDc40975E73aA50f459);
        perp_chain_addresses["MarketRegistry"][10] = address(0xd5820eE0F55205f6cdE8BB0647072143b3060067);
        perp_chain_addresses["vETH"][10] = address(0x8C835DFaA34e2AE61775e80EE29E2c724c6AE2BB);

        // perp_chain_addresses["Vault"][69] = address(0xAD7b4C162707E0B2b5f6fdDbD3f8538A5fbA0d60);
        // perp_chain_addresses["AccountBalance"][69] = address(0xA7f3FC32043757039d5e13d790EE43edBcBa8b7c);
        // perp_chain_addresses["ClearingHouseConfig"][69] = address(0xA4c817a425D3443BAf610CA614c8B11688a288Fb);

        chain_id = _chain_id;

        gc.usdc = IERC20Decimals(generic_chain_addresses["USDC"][chain_id]);
        gc.weth = IERC20Decimals(generic_chain_addresses["WETH"][chain_id]);

        pc.ch = IClearingHouse(perp_chain_addresses["ClearingHouse"][chain_id]);
        // pc.mr = IMarketRegistry(perp_chain_addresses["MarketRegistry"][chain_id]);

        console.log("Account Balance = ", pc.ch.getAccountBalance());
        pc.ab = IAccountBalance(pc.ch.getAccountBalance());

        console.log("Vault = ", pc.ch.getVault());
        pc.pv = IPerpVault(pc.ch.getVault());

        usdl = new USDLemma();

        pl = _deployPerpLemma(
                Deploy_PerpLemma({
                    trustedForwarder: address(0),
                    maxPosition: type(uint256).max,
                    usdlCollateral: generic_chain_addresses["WETH"][chain_id],
                    baseToken: perp_chain_addresses["vETH"][chain_id]
                }),
                perp_chain_addresses["ClearingHouse"][chain_id],
                perp_chain_addresses["MarketRegistry"][chain_id],
                address(usdl)
            );
        console.log("PL = ", address(pl));
    }







    function _deployPerpLemma(Deploy_PerpLemma memory d_pl, address perp_ch, address perp_mr, address usdl) internal returns(PerpLemmaCommon) {
        PerpLemmaCommon pl = new PerpLemmaCommon();
        pl.initialize(
            d_pl.trustedForwarder,
            d_pl.usdlCollateral,
            d_pl.baseToken,
            d_pl.usdlCollateral,            // NOTE: At some point, we will need to remove these ones as they regard Synth but it is the same as USDL Collateral
            d_pl.baseToken,                 // NOTE: At some point, we will need to remove these ones as they regard Synth but it is the same as USDL Collateral
            perp_ch,
            perp_mr,
            address(usdl),
            d_pl.maxPosition
        );

        return pl;
    }

}





