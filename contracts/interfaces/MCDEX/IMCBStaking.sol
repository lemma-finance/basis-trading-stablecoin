pragma solidity =0.8.3;

interface IMCBStaking {
    function stake(uint256 amount) external;

    function restake() external;

    function redeem() external;
}
