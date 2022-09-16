// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;

import "forge-std/Script.sol";
import "../contracts/USDLemma.sol";
import "../contracts/LemmaSynth.sol";
import "../contracts/SettlementTokenManager.sol";
import "../contracts/wrappers/PerpLemmaCommon.sol";

contract LemmaSynthScript is Script {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ONLY_OWNER = keccak256("ONLY_OWNER");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");
    bytes32 public constant PERPLEMMA_ROLE = keccak256("PERPLEMMA_ROLE");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    address usdlCollateral = 0x4200000000000000000000000000000000000006;
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
    uint256 perpIndex = 1;
    string LemmaSynthTokenName = "LemmaSynth";
    string LemmaSynthTokenSymbol = "LSynth";

    address usdLemmaAddress = 0x77D4D37338d52585499Af540F1592361Ba647aB2;
    address settlementTokenManagerAddress = 0x839fB84c290511ef3a20B24E5654504831dB4448;

    USDLemma usdLemma;
    LemmaSynth lemmaSynth;
    SettlementTokenManager settlementTokenManager;
    PerpLemmaCommon perpLemma;

    function run() external {
        vm.startBroadcast(tx.origin);

        console.log("msg.sender: ", msg.sender, address(this));
        console.log("tx.origin: ", tx.origin);

        usdLemma = USDLemma(usdLemmaAddress);
        settlementTokenManager = SettlementTokenManager(settlementTokenManagerAddress);
        lemmaSynth = new LemmaSynth();
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

        usdLemma.addPerpetualDEXWrapper(perpIndex, usdlCollateral, address(perpLemma));

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

        console.log("OldUSDLemma: ", address(usdLemma));
        console.log("NewLemmaSynth: ", address(lemmaSynth));
        console.log("SettlementTokenManager: ", address(settlementTokenManager));
        console.log("PerpLemmaCommon: ", address(perpLemma));
        vm.stopBroadcast();
    }
}
