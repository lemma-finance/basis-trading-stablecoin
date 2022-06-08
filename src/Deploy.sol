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
    IAccountBalance ab;
    IPerpVault pv;
}

contract Deploy {
    USDLemma public usdl;
    PerpLemmaCommon public pl;

    Generic_Contracts public gc;
    Perp_Contracts public pc;

    uint256 public chain_id;


    // NOTE: Contract Name, Chain ID --> Contract Address
    // ChainID=69 --> Optimism Kovan
    mapping(string => mapping(uint256 => address)) public generic_chain_addresses;

    mapping(string => mapping(uint256 => address)) public perp_chain_addresses;

    // NOTE: Chain ID --> Minimum Block for the Deployment 
    mapping(uint256 => uint256) public perp_min_block;


    constructor(uint256 _chain_id) {
        generic_chain_addresses["WETH"][69] = address(0x4200000000000000000000000000000000000006);
        generic_chain_addresses["USDC"][69] = address(0x7F5c764cBc14f9669B88837ca1490cCa17c31607);

        perp_min_block[69] = 513473; 
        perp_chain_addresses["ClearingHouse"][69] = address(0x82ac2CE43e33683c58BE4cDc40975E73aA50f459);
        perp_chain_addresses["Vault"][69] = address(0xAD7b4C162707E0B2b5f6fdDbD3f8538A5fbA0d60);
        perp_chain_addresses["AccountBalance"][69] = address(0xA7f3FC32043757039d5e13d790EE43edBcBa8b7c);
        perp_chain_addresses["ClearingHouseConfig"][69] = address(0xA4c817a425D3443BAf610CA614c8B11688a288Fb);

        chain_id = _chain_id;

        gc.usdc = IERC20Decimals(generic_chain_addresses["USDC"][chain_id]);
        gc.weth = IERC20Decimals(generic_chain_addresses["WETH"][chain_id]);

        pc.ch = IClearingHouse(perp_chain_addresses["ClearingHouse"][chain_id]);
        pc.ab = IAccountBalance(perp_chain_addresses["AccountBalance"][chain_id]);
        pc.pv = IPerpVault(perp_chain_addresses["Vault"][chain_id]);

        usdl = new USDLemma();
        pl = new PerpLemmaCommon();
    }
}





