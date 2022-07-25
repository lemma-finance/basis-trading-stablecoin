// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.3;

interface ISettlementTokenManager {
    function settlementTokenRecieve(uint256 settlementTokenAmount, address perpDexWrapper) external;
    function settlementTokenRequested(uint256 settlementTokenAmount, address perpDexWrapper) external;
    function settlemntTokenRebalance(uint256 settlementTokenAmount, address perpDexWrapperFrom, address perpDexWrapperTo) external;
}