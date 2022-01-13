pragma solidity =0.8.3;

import { IController } from "./IController.sol";

interface ICrabStrategy {
    function flashDeposit(uint256 _ethToDeposit) external payable;

    function flashWithdraw(uint256 _crabAmount, uint256 _maxEthToPay) external;

    function powerTokenController() external view returns (IController);

    function weth() external view returns (address);
}
