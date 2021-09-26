module.exports = {
    providerOptions: { default_balance_ether: 10000, fork: "http://127.0.0.1:8535/" },
    // skipFiles: ['test/MCDEXAdresses.sol','test/Simple_Test.sol','test/USDLemma_Test.sol']
    skipFiles: ['test', 'mock']
}