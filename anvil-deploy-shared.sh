#!/bin/bash
# Run Anvil forking Optimism 
anvil --fork-url [PUT ALCHEMY KEY HERE] --fork-block-number 12137998

# Deploy PerpLemmaETH
# This is just one of the PKs provided by Anvil, it is OK to use it
# It should be deployed locally at `0xdb41ab644AbcA7f5ac579A5Cf2F41e606C2d6abc` address
forge create --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 PerpLemmaCommon
