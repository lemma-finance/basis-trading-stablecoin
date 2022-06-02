// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.3;

interface IGenericProxyFactory {
  function create(address _instance, bytes calldata _data) external returns (address instanceCreated, bytes memory result);
}
