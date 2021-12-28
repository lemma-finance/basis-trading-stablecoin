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
1). cd perp-lushan  
2). npm install  
3). open `Quoter.sol` file =>  node_modules/@uniswap/v3-periphery/contracts/lens/Quoter.sol  

    - open Quoter.sol file and replace code with below gist
        https://gist.github.com/sunnyRK/465f05c9a5f97d8b9c377968ce3296c4

4). npm run build
5). cd .. 
    

# Run

1). Go to root repo
    
    cd  basis-trading-stablecoin

2). open terminal-1 and run,
        
    npx hardhat node

1). open terminal-2 and run
    
    npx hardhat test --network local