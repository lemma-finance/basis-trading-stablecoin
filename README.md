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


# Run

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


# Foundry 

1. Install Foundry following the instructions here 

https://github.com/foundry-rs/foundry



2. Make the repo a Foundry Repo with 

```
foundryup
```



3. Compile with 

```
forge build
```



5. Tests 

Foundry does not run Hardhat Tests as it requires its own tests written in Solidity in the `/test` dir so for example 





