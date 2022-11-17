## Documentation
https://docs.lemma.finance/concepts-overview/usdl
## Test using Foundry
1. Install forge dependency
    - ```forge install  ```
2. Compile contract code
    - ```forge build ``` 
3. Run testcases  
    - ```forge test --fork-url https://opt-mainnet.g.alchemy.com/v2/API_KEY --ffi ``` 
4. Run deployment scripts (not used)
    - ```source .env```
    - ```forge script script/LemmaTestnetScripts.sol:LemmaTestnetScripts --rpc-url $OPTIMISM_KOVAN_RPC_URL  --private-key $PRIVATE_KEY --broadcast --verify --etherscan-api-key $ETHERSCAN_KEY -vvvv```
- NOTE: In theory everything should be already set properly for the above to run but in case there are issues try to initialize the repo as Foundry Repo 
   - ```forge init --force --no-commit```
   - It should add all the necessary files like the `foundry.toml`,installing `lib` the `forge-std` Standard Library that is required for tests 
   - It could also be possible the `lib` dir is not added in the `foundry.toml` to the `libs` array that is used for the import lookups, as when Foundry detects Hardhat it could just add the `node_modules` dir so in that case remember to add it so that ```libs = ['lib', 'node_modules']```

## Deploy on Optimism using Hardhat
1. Deploy command 
    - Optimism:       ```npx hardhat run scripts/perpetual/deploy.ts --network optimism```
    - Optimism-Kovan: ```npx hardhat run scripts/perpetual/deploy.ts --network optimismKovan```
2. Verify contract command
    - ```npx hardhat verify --network optimismKovan <Deployment Address>```

## Bug Bounty
https://immunefi.com/bounty/lemma/

### Test JS tests for Perpetual Integration (DEPRECATED)
1. Go to root repo\
    - cd  basis-trading-stablecoin\
2. open terminal-1 and run,  
    - npx hardhat node
3. open terminal-2 and run 
    - npx hardhat test --network local
4. test coverage (no need to start `npx hardhat node`)\
    - npx hardhat coverage --network local\
    - npx hardhat coverage --testfiles "test/perpetual/perpLemma.multiCollateral.ts"  --network local
5. ethlint check
    - solium -d contracts/
6. slither check
    - slither .

### Test MCDEX V3 integration locally (DEPRECATED)
1. git submodule update --init
2. git submodule update
3. npm install
4. cd mai-protocol-v3/
5. npm install
6. cd ..
7. npm run compile
7. npx hardhat node
8. npx hardhat test --network local









