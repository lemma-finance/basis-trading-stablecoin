# local setup
1. git submodule update --init
2. npm install
3. cd mai-protocol-v3/
4. npm install --force
5. cd ..
6. npx hardhat node
7. npx hardhat test --network local

# local deployment for graph
1. npx hardhat node --hostname 0.0.0.0
2. npx hardhat run scripts/deploy_local.js --network localDocker