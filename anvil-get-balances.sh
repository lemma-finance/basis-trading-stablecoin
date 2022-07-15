#!/bin/bash

USDC=0x7F5c764cBc14f9669B88837ca1490cCa17c31607
WETH=0x4200000000000000000000000000000000000006
USDC_HOLDER=0xEBb8EA128BbdFf9a1780A4902A9380022371d466
WETH_HOLDER=0x6202a3b0be1d222971e93aab084c6e584c29db70
ME=0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
PERPLEMMA_ETH=0xB40D99B1Eb2446784Cf15972D43dd1538FD116A5
UNISWAPV3_ROUTER=0xE592427A0AEce92De3Edee1F18E0157C05861564
USDL=0xDa307F699cdA8bBAa8a2DFd38c8c5d890E306A81







echo "ME $ME USDC $(cast call $USDC "balanceOf(address)(uint256)" $ME)"
echo "ME $ME WETH $(cast call $WETH "balanceOf(address)(uint256)" $ME)"
echo "ME $ME USDL $(cast call $USDL "balanceOf(address)(uint256)" $ME)"

echo "PERPLEMMA_ETH $PERPLEMMA_ETH USDC $(cast call $USDC "balanceOf(address)(uint256)" $PERPLEMMA_ETH)"
echo "PERPLEMMA_ETH $PERPLEMMA_ETH WETH $(cast call $WETH "balanceOf(address)(uint256)" $PERPLEMMA_ETH)"
echo "PERPLEMMA_ETH $PERPLEMMA_ETH USDL $(cast call $USDL "balanceOf(address)(uint256)" $PERPLEMMA_ETH)"

# echo "Balance before"
# cast call $USDC "balanceOf(address)(uint256)" $ME
# cast rpc anvil_impersonateAccount $USDC_HOLDER
# cast rpc anvil_setBalance $USDC_HOLDER 0xFFFFFFFFFFFFFFFF
# cast send --from $USDC_HOLDER $USDC "transfer(address,uint256)(bool)" $ME 10000000000
# echo "Balance After"
# cast call $USDC "balanceOf(address)(uint256)" $ME
# cast rpc anvil_stopImpersonatingAccount $USDC_HOLDER


# echo "Getting WETH"
# echo "Balance before"
# cast call $WETH "balanceOf(address)(uint256)" $ME
# cast rpc anvil_impersonateAccount $WETH_HOLDER
# cast rpc anvil_setBalance $WETH_HOLDER 0xFFFFFFFFFFFFFFFF
# cast send --from $WETH_HOLDER $WETH "transfer(address,uint256)(bool)" $ME 10000000000
# echo "Balance After"
# cast call $WETH "balanceOf(address)(uint256)" $ME
# cast rpc anvil_stopImpersonatingAccount $WETH_HOLDER




