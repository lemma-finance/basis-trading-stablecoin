// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.3;
pragma abicoder v2;

import { IGenericExchangeReader } from "../interfaces/IGenericExchangeWrapper.sol";

contract GenericExchangeWrapper is IGenericExchangeReader {
    // TODO: Implement

    function getMaxMakerAmount(
        address makerToken,
        address takerToken,
        bytes calldata orderData
    )
    external
    view
    returns (uint256) {
        require(0 == 1, 'Unimplemented');
    }


    function getExchangeCost(
        address makerToken,
        address takerToken,
        uint256 desiredMakerToken,
        bytes calldata orderData
    )
    external
    view
    returns (uint256) {
        require(0 == 1, 'Unimplemented');
    }

    
    function exchange(
        address tradeOriginator,
        address receiver,
        address makerToken,
        address takerToken,
        uint256 requestedFillAmount,
        bytes calldata orderData
    )
    external
    returns (uint256) {
        require(0 == 1, 'Unimplemented');
    }




}
