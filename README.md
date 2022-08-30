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
SettlementTokenManager: , 0x790f5ea61193Eb680F82dE61230863c12f8AC5cC

xUSDL: , 0x317c72f8509b09D9F7632761e1393e045A040f7e
USDLemma: , 0xc34E7f18185b381d1d7aab8aeEC507e01f4276EE
xLemmaSynthEth: 0xF8A4d59bB0DAf3B777E85696c694E3B983164d6e
LemmaSynthEth: , 0xac7b51F1D5Da49c64fAe5ef7D5Dc2869389A46FC
PerpLemmaCommonETH: , 0xCa184D2B5557EA317e0A696De2e08e567F608E1f
LemmaSynthBtc: , 0x72D43D1A52599289eDBE0c98342c6ED22eB85bd3
PerpLemmaCommonBtc: , 0xCAA344264f1546931A37Ad09da63d3D2AceB1283
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

## Deployment Script command

1). Deploy command 
    
    Optimism:       npx hardhat run scripts/perpetual/deploy.ts --network optimism
    Optimism-Kovan: npx hardhat run scripts/perpetual/deploy.ts --network optimismKovan


2). Verify contract command
    
    npx hardhat verify --network optimismKovan <Deployment Address>

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









