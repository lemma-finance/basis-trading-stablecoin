// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;

import "forge-std/Script.sol";
import "../contracts/USDLemma.sol";
import "../contracts/LemmaSynth.sol";
import "../contracts/SettlementTokenManager.sol";
import "../contracts/wrappers/PerpLemmaCommon.sol";

contract LemmaTestnetScripts is Script {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ONLY_OWNER = keccak256("ONLY_OWNER");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");
    bytes32 public constant PERPLEMMA_ROLE = keccak256("PERPLEMMA_ROLE");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    address usdlCollateralWeth = 0x4200000000000000000000000000000000000006; //WETH
    address usdlCollateralWbtc = 0xf69460072321ed663Ad8E69Bc15771A57D18522d; //WETH
    address usdc = 0x3e22e37Cb472c872B5dE121134cFD1B57Ef06560;
    address vEthBaseToken = 0x5802918dC503c465F969DA0847b71E3Fbe9B141c; // vETH
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
            usdlCollateralWeth,
            vEthBaseToken, // NOTE: At some point, we will need to remove these ones as they regard Synth but it is the same as USDL Collateral
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
            usdlCollateralWeth,
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
            usdlCollateralWeth,
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
