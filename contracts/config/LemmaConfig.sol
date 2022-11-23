// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.14;
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract LemmaConfig is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    /// Max Leverage 
    uint256 public maxLeverage_6;
    uint256 public desiredLeverage_6;


    mapping(string => uint256) public genVarsUint256;
    mapping(string => int256) public genVarsInt256;

    constructor() {
        _setRoleAdmin(OWNER_ROLE, ADMIN_ROLE);
        _setupRole(ADMIN_ROLE, msg.sender);
        grantRole(OWNER_ROLE, msg.sender);
    }

    function setMaxLeverage(uint256 _x) external onlyRole(OWNER_ROLE) {
        maxLeverage_6 = _x;
    }

    function setDesiredLeverage(uint256 _x) external onlyRole(OWNER_ROLE) {
        desiredLeverage_6 = _x;
    }

    function setGenVarUint256(string memory s, uint256 x) external onlyRole(OWNER_ROLE) {
        genVarsUint256[s] = x;
    }

    function setGenVarInt256(string memory s, int256 x) external onlyRole(OWNER_ROLE) {
        genVarsInt256[s] = x;
    }
}
