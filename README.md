# Test locally
1. git submodule update --init
2. git submodule update
3. npm install
4. cd mai-protocol-v3/
5. npm install
6. cd ..
7. npm run compile
7. npx hardhat node
8. npx hardhat test --network local

# Documentation
https://docs.lemma.finance/smart-contracts/core-contracts

## How to setup perp_lushan testcases

Open perp-lushan submodule repo  
1). cd perp-lushan  
2). npm install  
3). npm run build
4). cd .. 

### Optimism-KOVAN Testnet Contract addresses

```
USDLemma: , 0x2cb5df8853d194729e39b65365c7bdb6cd9e2870
LemmaSynth: , 0xe5ea26bedd24e568a3ce6456f83220ea250b312b
SettlementTokenManager: , 0x7d14373a3078e4eb7280f1d6bd6cd29d4da52f48
PerpLemmaCommon: , 0xb91ca316ffb00cb131e9f3f6472d0e94c70ba701
```

### Run Using Foundry

1. Install Foundry following the instructions here 

-   https://github.com/foundry-rs/foundry


2. Make the repo a Foundry Repo with 

    ```foundryup```


3. Install forge dependency
-   ```forge install  ```

4. Compile contract code
-   ```forge build ``` 

5. Run testcases  
-   ```forge test --fork-url https://opt-mainnet.g.alchemy.com/v2/j9pgL8KP33EnVCItge8fRMZPnikQaMBI --fork-block-number 12137998 ``` 

6. Run deployement scripts
- ```source .env```
-   ```forge script script/LemmaTestnetScripts.sol:LemmaTestnetScripts --rpc-url $OPTIMISM_KOVAN_RPC_URL  --private-key $PRIVATE_KEY --broadcast --verify --etherscan-api-key $ETHERSCAN_KEY -vvvv```


NOTE: In theory everything should be already set properly for the above to run but in case there are issues try to inizialize the repo as Foundry Repo 

```
forge init --force --no-commit
```

It should add all the necessary files like 

- the `foundry.toml`

- installing `lib` the `forge-std` Standard Library that is required for tests 

It could also be possible the `lib` dir is not added in the `foundry.toml` to the `libs` array that is used for the import lookups, as when Foundry detects Hardhat it could just add the `node_modules` dir so in that case remember to add it so that 

```
libs = ['lib', 'node_modules']
```


## Old Running methods using JS (DEPRECATED)

1). Go to root repo
    
    cd  basis-trading-stablecoin

2). open terminal-1 and run,
        
    npx hardhat node

3). open terminal-2 and run
    
    npx hardhat test --network local

4). test coverage (no need to start `npx hardhat node`)

    npx hardhat coverage --network local
    npx hardhat coverage --testfiles "test/perpetual/perpLemma.multiCollateral.ts"  --network local

5). ethlint check

    solium -d contracts/

6). slither check

    slither .









