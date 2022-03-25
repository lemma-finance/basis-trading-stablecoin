pragma solidity =0.8.3;
pragma abicoder v2;

// import {Multicall} from  '@uniswap/v3-periphery/contracts/base/Multicall.sol';
// import {IWETH9} from '@uniswap/v3-periphery/contracts/interfaces/external/IWETH9.sol';
import {IUSDLemma} from '../interfaces/IUSDLemma.sol';
// import {IXUSDL} from '../interfaces/IXUSDL.sol';
// import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
// import {TransferHelper} from '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';
// import {IPerpetualDEXWrapper} from '../interfaces/IPerpetualDEXWrapper.sol';
// import {IUniswapV2Router} from '../interfaces/IUniswapV2Router.sol';
// import {IGenericExchangeWrapper} from '../exchange-wrappers/interfaces/IGenericExchangeWrapper.sol';
// import {IArbCodeExchangeWrapper} from '../exchange-wrappers/interfaces/IArbCodeExchangeWrapper.sol';
// import "../interfaces/IPermit.sol";
// import "../ILemmaRouter.sol";
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




contract Consulting {
    address public owner;
    IUSDL public usdl;
    int256 public minMintingFee;
    int256 public minRedeemingFee;
    int256 public maxMintingFee;
    int256 public maxRedeemingFee;

    constructor(address _usdl) {
        owner = msg.sender;
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

    modifier onlyOwner() {
        require(msg.sender == owner, "!owner");
        _;
    }

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
        int256 res = 0;
        int256 V = usdl.computeV();

        // Gap with max
        int256 pos = usdl.getTotalPosition(dexIndex, collateral);

        if( action == 0 ) {
            // Minting 
            res = minMintingFee + ((pos * maxMintingFee) / V);
        } else {
            // Redeem 
            res = maxRedeemingFee - ((pos * maxRedeemingFee) / V) + minRedeemingFee;
        }

        return uint256(res);
    }

}




