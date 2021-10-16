// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

interface IXUSDL {
    function usdl() external view returns (IERC20Upgradeable);

    /// @notice Balance of USDL in xUSDL contract
    /// @return Amount of USDL
    function balance() external view returns (uint256);

    /// @notice Minimum blocks user funds need to be locked in contract
    /// @return Minimum blocks for which USDL will be locked
    function MINIMUM_LOCK() external view returns (uint256);

    /// @notice Deposit and mint xUSDL in exchange of USDL
    /// @param amount of USDL to deposit
    /// @return Amount of xUSDL minted
    function deposit(uint256 amount) external returns (uint256);

    /// @notice Withdraw USDL and burn xUSDL
    /// @param shares of xUSDL to burn
    /// @return Amount of USDL withdrawn
    function withdraw(uint256 shares) external returns (uint256);

    /// @notice Withdraw USDL and burn xUSDL
    /// @param to address of user to transfer USDL
    /// @param shares of xUSDL to burn
    /// @return Amount of USDL withdrawn
    function withdrawTo(address to, uint256 shares) external returns (uint256);

    /// @notice Price per share in terms of USDL
    /// @return Price of 1 xUSDL in terms of USDL
    function pricePerShare() external view returns (uint256);

    /// @notice Block number after which user can withdraw USDL
    /// @return Block number after which user can withdraw USDL
    function userUnlockBlock(address usr) external view returns (uint256);
}
