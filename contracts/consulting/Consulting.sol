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
    IUSDLemma public usdl;

    constructor(address _usdl) {
        owner = msg.sender;
        usdl = IUSDLemma(_usdl);
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
        usdl = IUSDLemma(_usdl);
    }

    /**
      * Given minting / redeem, collateral and amount returns the fees in 1e6 format 
     */
    function getFees(uint8 action, address collateral, uint256 amount) validAction(action) validCollateral(collateral) external view returns(uint256) {
        return 1000;
    }

}




