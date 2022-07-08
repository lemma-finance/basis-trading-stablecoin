#!/bin/bash

USDC=0x7F5c764cBc14f9669B88837ca1490cCa17c31607
WETH=0x4200000000000000000000000000000000000006
USDC_HOLDER=0xEBb8EA128BbdFf9a1780A4902A9380022371d466
WETH_HOLDER=0x6202a3b0be1d222971e93aab084c6e584c29db70
ME=0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266


USDL=0xDa307F699cdA8bBAa8a2DFd38c8c5d890E306A81


echo "Trying to mint USDL"
echo "USDL Balance Before"
cast call $USDL "balanceOf(address)(uint256)" $ME
cast rpc anvil_impersonateAccount $ME
cast send --from $ME $WETH "approve(address,uint256)" $USDL 5000000000
cast send --from $ME $USDL "depositToWExactCollateral(address,uint256,uint256,uint256,address)" $ME 5000000000 0 0 $WETH
echo "USDL Balance After"
cast call $USDL "balanceOf(address)(uint256)" $ME
cast rpc anvil_stopImpersonatingAccount $ME

