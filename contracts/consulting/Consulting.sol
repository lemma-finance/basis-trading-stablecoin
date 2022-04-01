pragma solidity =0.8.3;
pragma abicoder v2;

import {IUSDLemma} from '../interfaces/IUSDLemma.sol';

// import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
// import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
// import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
// import { IConsulting } from "../interfaces/IConsulting.sol";

import "hardhat/console.sol";

// interface IERC20Decimal is IERC20Upgradeable {
//     function decimals() external view returns (uint256);
// }

interface IUSDL is IUSDLemma {
    function lemmaTreasury() external view returns (address);
    function getFees(uint256 dexIndex, address collateral, bool isMinting) external view returns (uint256);
    function getTotalPosition(uint256 dexIndex, address collateral) external view returns (int256);
    function computeV() external view returns(int256);
}




contract Consulting is OwnableUpgradeable {
    // address public owner;
    IUSDL public usdl;
    int256 public minMintingFee;
    int256 public minRedeemingFee;
    int256 public maxMintingFee;
    int256 public maxRedeemingFee;

    function initialize(
        address _usdl
    ) external initializer {
        __Ownable_init();
        // __ERC20_init("xUSDLemma", "xUSDL");
        // __ERC20Permit_init("xUSDLemma");
        // __ERC2771Context_init(_trustedForwarder);
        usdl = IUSDL(_usdl);

        // minMintingFee = 0.1%
        minMintingFee = 1e3;

        // minRedeemingFee = 0.1%
        minRedeemingFee = 1e3;

        // maxMintingFee = 1%
        maxMintingFee = 1e4;

        // maxRedeemingFee = 1%
        maxRedeemingFee = 1e4;
    }


    // constructor(address _usdl) {
    //     owner = msg.sender;
    //     usdl = IUSDL(_usdl);

    //     // minMintingFee = 0.1%
    //     minMintingFee = 1e3;

    //     // minRedeemingFee = 0.1%
    //     minRedeemingFee = 1e3;

    //     // maxMintingFee = 1%
    //     maxMintingFee = 1e4;

    //     // maxRedeemingFee = 1%
    //     maxRedeemingFee = 1e4;
    // }

    // modifier onlyOwner() {
    //     require(msg.sender == owner, "!owner");
    //     _;
    // }

    modifier validAction(uint8 action) {
        require(
            (action == 0) ||    // minting 
            (action == 1),       // redeem 
            "!Action");
        _;
    }

    modifier validCollateral(address collateral) {
        require(collateral != address(0), "!Collateral");
        _;
    }

    function setUSDL(address _usdl) external onlyOwner {
        require(_usdl != address(0), "!address");
        usdl = IUSDL(_usdl);
    }

    /**
      * Given minting / redeem, collateral and amount returns the fees in 1e6 format 
     */
    function getFees(uint8 action, uint256 dexIndex, address collateral, uint256 amount) validAction(action) validCollateral(collateral) external view returns(uint256) {
        int256 res = (action == 0) ? minMintingFee : minRedeemingFee;
        console.log("[Consulting Contract] Trying to compute V");
        int256 V = usdl.computeV();

        // NOTE: This would be unexpected 
        require(V >= 0, "!V");

        console.log("[Consulting Contract] V = %s %d", ( V < 0 ? '-':'+' ), ( V < 0 ? uint256(-V) : uint256(V) ) );

        // Gap with max
        int256 pos = usdl.getTotalPosition(dexIndex, collateral);

        if( action == 0 ) {
            // Minting 
            res += (V > 0) ? ((pos * maxMintingFee) / V) : int256(0);
        } else {
            // Redeem 
            res += (V > 0) ? maxRedeemingFee - ((pos * maxRedeemingFee) / V) : int256(0);
        }

        return uint256(res);
    }

}




