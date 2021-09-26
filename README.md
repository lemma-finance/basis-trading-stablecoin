# local setup
1. git submodule update --init
2. npm install
3. cd mai-protocol-v3/
4. npm install --force
5. cd ..
6. npx hardhat node
7. npx hardhat test --network local

# solidity-tests
1. npx hardhat node
2. cd mai-protocol-v3 && npx hardhat run scripts/deploy.ts --network local (copy the liquidityPool address to contracts/tests/MCDEXAdresses.sol)
3. cd .. && npx hardhat test-solidity --network local
