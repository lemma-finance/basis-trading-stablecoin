# local setup
1. git submodule update --init
2. npm install
3. cd mai-protocol-v3/
4. npm install --force
5. cd ..
6. npx hardhat node
7. npx hardhat test --network local

# local deployment for graph
1. run a local graph node (https://thegraph.com/docs/developer/quick-start#2-run-a-local-graph-node)
2. npx hardhat node --hostname 0.0.0.0
3. npx hardhat run scripts/deploy_local.js --network localDocker