// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "forge-std/Script.sol";
import "../contracts/USDLemma.sol";
import "../contracts/LemmaSynth.sol";
import "../contracts/SettlementTokenManager.sol";
import "../contracts/wrappers/PerpLemmaCommon.sol";

contract LemmaTestnetScriptsUsingProxies is Script {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ONLY_OWNER = keccak256("ONLY_OWNER");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");
    bytes32 public constant PERPLEMMA_ROLE = keccak256("PERPLEMMA_ROLE");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    address usdlCollateral = 0x4200000000000000000000000000000000000006; //WETH
    address usdc = 0x3e22e37Cb472c872B5dE121134cFD1B57Ef06560;
    address baseToken = 0x5802918dC503c465F969DA0847b71E3Fbe9B141c; // vETH
    address clearingHouse = 0xf10288Fd8d778F2880793C1CacCBF02206649802;
    address marketRegistery = 0x51705d391e0d01fA684366407704De0856E4dBaB;
    address stm_rebelancer = msg.sender; // settlementTokenManager rebalancer
    address pl_trustedForwarder = msg.sender; // perpLemma trustedForwarder
    address usdLemma_trustedForwarder = msg.sender; // usdLemma trustedForwarder
    address lemmaSynth_trustedForwarder = msg.sender; // lemmaSynth trustedForwarder
    address only_owner_role_address = msg.sender;
    uint256 maxPosition = type(uint256).max;
    string LemmaSynthTokenName = "LemmaSynth";
    string LemmaSynthTokenSymbol = "LSynth";

    USDLemma usdLemma;
    LemmaSynth lemmaSynth;
    SettlementTokenManager settlementTokenManager;
    PerpLemmaCommon perpLemma;

    function run() external {
        vm.startBroadcast(tx.origin);

        console.log("msg.sender: ", msg.sender, address(this));
        console.log("tx.origin: ", tx.origin);

        usdLemma = new USDLemma();
        lemmaSynth = new LemmaSynth();
        settlementTokenManager = new SettlementTokenManager();
        perpLemma = new PerpLemmaCommon();

        perpLemma.initialize(
            msg.sender,
            usdlCollateral,
            baseToken, // NOTE: At some point, we will need to remove these ones as they regard Synth but it is the same as USDL Collateral
            clearingHouse,
            marketRegistery,
            address(usdLemma),
            address(lemmaSynth),
            maxPosition
        );

        perpLemma.setIsUsdlCollateralTailAsset(true);
        perpLemma.resetApprovals();
        perpLemma.setMaxPosition(maxPosition);
        perpLemma.setReBalancer(msg.sender);
        perpLemma.grantRole(ONLY_OWNER, only_owner_role_address);
        perpLemma.setSettlementTokenManager(address(settlementTokenManager));

        settlementTokenManager.initialize(
            address(usdLemma), stm_rebelancer, usdc
        );
        settlementTokenManager.grantRole(ONLY_OWNER, only_owner_role_address);
        settlementTokenManager.setIsSettlementAllowed(true);

        usdLemma.initialize(
            usdLemma_trustedForwarder,
            usdlCollateral,
            address(perpLemma),
            address(settlementTokenManager),
            usdc
        );
        usdLemma.setLemmaTreasury(msg.sender);
        usdLemma.setFees(1000);
        usdLemma.grantRole(ONLY_OWNER, only_owner_role_address);

        lemmaSynth.initialize(
            lemmaSynth_trustedForwarder,
            address(perpLemma),
            usdc,
            usdlCollateral,
            LemmaSynthTokenName,
            LemmaSynthTokenSymbol
        );
        lemmaSynth.setFees(1000);
        lemmaSynth.grantRole(ONLY_OWNER, only_owner_role_address);

        console.log("USDLemma: ", address(usdLemma));
        console.log("LemmaSynth: ", address(lemmaSynth));
        console.log("SettlementTokenManager: ", address(settlementTokenManager));
        console.log("PerpLemmaCommon: ", address(perpLemma));
        vm.stopBroadcast();
    }
}
//   USDLemma: , 0x77d4d37338d52585499af540f1592361ba647ab2
//   LemmaSynth: , 0xf09ed654aebd1cd00e7ff6cd89eb78c062bdcfb1
//   SettlementTokenManager: , 0x839fb84c290511ef3a20b24e5654504831db4448
//   PerpLemmaCommon: , 0x70b03d7be49c836686e335f348593d91b98cd5dd
//   USDLemma: , 0x7ca28a621bdad9193f0fde69459081ebb0dd0cd2
//   LemmaSynth: , 0x2087a7b24bfc0a36bfe1ad5a8219b6c2388d77f7
//   SettlementTokenManager: , 0x9b5af92e2d63f63fd7331209f84b6c736d9d4dbe
//   PerpLemmaCommon: , 0xf3ffc6ff39eed7fa0c766025b27dc5a423dc3568
