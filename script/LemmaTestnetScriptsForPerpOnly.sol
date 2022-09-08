// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.0 <0.9.0;

import "forge-std/Script.sol";
import "../contracts/USDLemma.sol";
import "../contracts/LemmaSynth.sol";
import "../contracts/SettlementTokenManager.sol";
import "../contracts/wrappers/PerpLemmaCommon.sol";

contract LemmaTestnetScriptsForPerpOnly is Script {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ONLY_OWNER = keccak256("ONLY_OWNER");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");
    bytes32 public constant PERPLEMMA_ROLE = keccak256("PERPLEMMA_ROLE");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    address usdlCollateralWeth = 0x4200000000000000000000000000000000000006; //WETH
    address usdlCollateralWbtc = 0xf69460072321ed663Ad8E69Bc15771A57D18522d; //WETH
    address usdc = 0x3e22e37Cb472c872B5dE121134cFD1B57Ef06560;
    address vBtcBaseToken = 0x1f91666a0706EF6e8E1506E3889171940c94B51A; // vETH
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

    address public _usdLemmaAddress = 0xc34E7f18185b381d1d7aab8aeEC507e01f4276EE;
    address public settlementTokenManager =
        0x790f5ea61193Eb680F82dE61230863c12f8AC5cC;

    USDLemma usdLemma;
    LemmaSynth lemmaSynth;
    PerpLemmaCommon perpLemma;

    function run() external {
        vm.startBroadcast(tx.origin);
        usdLemma = USDLemma(_usdLemmaAddress);
        lemmaSynth = new LemmaSynth();
        perpLemma = new PerpLemmaCommon();

        perpLemma.initialize(
            msg.sender,
            usdlCollateralWbtc,
            vBtcBaseToken, // NOTE: At some point, we will need to remove these ones as they regard Synth but it is the same as USDL Collateral
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
        perpLemma.setSettlementTokenManager(settlementTokenManager);

        usdLemma.addPerpetualDEXWrapper(
            1, usdlCollateralWbtc, address(perpLemma)
        );

        lemmaSynth.initialize(
            lemmaSynth_trustedForwarder,
            address(perpLemma),
            usdc,
            usdlCollateralWbtc,
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
