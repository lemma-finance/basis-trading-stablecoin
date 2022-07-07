#!/bin/bash

USDC=0x7F5c764cBc14f9669B88837ca1490cCa17c31607
USDC_HOLDER=0xEBb8EA128BbdFf9a1780A4902A9380022371d466
ME=0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266

echo "Balance before"
cast call $USDC "balanceOf(address)(uint256)" $ME
cast rpc anvil_impersonateAccount $USDC_HOLDER
cast send --from $USDC_HOLDER $USDC "transfer(address,uint256)(bool)" $ME 10000000000



echo "Balance After"
cast call $USDC "balanceOf(address)(uint256)" $ME


#cast rpc anvil_stopImpersonatingAccount $USDC_HOLDER



