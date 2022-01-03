pragma solidity =0.8.3;

struct Vault {
    // the address that can update the vault
    address operator;
    // uniswap position token id deposited into the vault as collateral
    // 2^32 is 4,294,967,296, which means the vault structure will work with up to 4 billion positions
    uint32 NftCollateralId;
    // amount of eth (wei) used in the vault as collateral
    // 2^96 / 1e18 = 79,228,162,514, which means a vault can store up to 79 billion eth
    // when we need to do calculations, we always cast this number to uint256 to avoid overflow
    uint96 collateralAmount;
    // amount of wPowerPerp minted from the vault
    uint128 shortAmount;
}

interface IController {
    function ethQuoteCurrencyPool() external view returns (address);

    function feeRate() external view returns (uint256);

    function getFee(
        uint256 _vaultId,
        uint256 _wPowerPerpAmount,
        uint256 _collateralAmount
    ) external view returns (uint256);

    function quoteCurrency() external view returns (address);

    function vaults(uint256 _vaultId) external view returns (Vault memory);

    function shortPowerPerp() external view returns (address);

    function wPowerPerp() external view returns (address);

    function getExpectedNormalizationFactor() external view returns (uint256);

    function mintPowerPerpAmount(
        uint256 _vaultId,
        uint256 _powerPerpAmount,
        uint256 _uniTokenId
    ) external payable returns (uint256 vaultId, uint256 wPowerPerpAmount);

    function mintWPowerPerpAmount(
        uint256 _vaultId,
        uint256 _wPowerPerpAmount,
        uint256 _uniTokenId
    ) external payable returns (uint256 vaultId);

    /**
     * Deposit collateral into a vault
     */
    function deposit(uint256 _vaultId) external payable;

    /**
     * Withdraw collateral from a vault.
     */
    function withdraw(uint256 _vaultId, uint256 _amount) external payable;

    function burnWPowerPerpAmount(
        uint256 _vaultId,
        uint256 _wPowerPerpAmount,
        uint256 _withdrawAmount
    ) external;

    function burnOnPowerPerpAmount(
        uint256 _vaultId,
        uint256 _powerPerpAmount,
        uint256 _withdrawAmount
    ) external returns (uint256 wPowerPerpAmount);

    function liquidate(uint256 _vaultId, uint256 _maxDebtAmount) external returns (uint256);

    function updateOperator(uint256 _vaultId, address _operator) external;

    /**
     * External function to update the normalized factor as a way to pay funding.
     */
    function applyFunding() external;

    function reduceDebtShutdown(uint256 _vaultId) external;
}
