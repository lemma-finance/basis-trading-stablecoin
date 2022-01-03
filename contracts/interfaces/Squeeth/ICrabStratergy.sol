pragma solidity =0.8.3;

interface ICrabStartergy {
    function flashDeposit(uint256 _ethToDeposit) external payable;

    function flashWithdraw(uint256 _crabAmount, uint256 _maxEthToPay) external;
}
