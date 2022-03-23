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


contract Consulting {
    address public owner;

    constructor() {
        owner = msg.sender;
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



    /**
      * Given minting / redeem, collateral and amount returns the fees in 1e6 format 
     */
    function getFees(uint8 action, address collateral, uint256 amount) validAction(action) validCollateral(collateral) external returns(uint256) {
        return 1000;
    }

}




