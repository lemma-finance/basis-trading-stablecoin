pragma solidity =0.8.3;

//import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

interface IConsulting {

    /**
      * Given minting / redeem, collateral and amount returns the fees in 1e6 format 
     */
    function getLemmaFeesPerc(uint8 action, uint256 dexIndex, address collateral, uint256 amount_pn) external view returns(uint256);

    function getDEXFeesPerc(uint8 action, uint256 dexIndex, address collateral, uint256 amount_pn) external view returns(uint256);

    function getTotalFeesPerc(uint8 action, uint256 dexIndex, address collateral, uint256 amount_pn) external view returns(uint256);





}


