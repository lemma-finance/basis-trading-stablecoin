# Test locally
1. git submodule update --init
2. npm install
3. cd mai-protocol-v3/
4. npm install
5. cd ..
6. npx hardhat node
7. npx hardhat test --network local

# Documentation
https://docs.lemma.finance/smart-contracts/core-contracts

## How to setup perp_lushan testcases

Open perp-lushan submodule repo
1). Open hardhat.config.ts of perp-lushan repo and add below in `networks`

    local: {
            url: "http://localhost:8545",
            allowUnlimitedContractSize: true
        },

2). Open contracts folder in perp-lushan and create `mock` folder and add below fine name called `MockTestAggregatorV3.sol`

    https://gist.github.com/sunnyRK/a491d6fb24544d9b8f1858058975b54f

3). open deployments folder in perp-lushan and create file called `local.deployment.js`

4). open `scripts` folder in perp-lushan repo a and create file like `deploy_local.ts` and add below gist code in it. 

    https://gist.github.com/sunnyRK/2f6bbf010b4dc43eb6d9647e8127ab83

5). open test folder in perp-lushan repo and create folder called `localDeployFixture`  

-> and create 3 files like below,  
- fixtures.ts  
- sharedFixtures.ts  
- utilities.ts  

and add below gist code in these three files. you will get 3 files in below gist and add respectively.

    https://gist.github.com/sunnyRK/83211224d1eda6ac274bafbe6286a57c

# Run

1). Go to root repo
    
    cd  basis-trading-stablecoin

2). open terminal-1 and run,
        
    npx hardhat node

1). open terminal-2 and run
    
    npx hardhat test --network local