// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

interface IXUSDL {

    function usdl() external view returns (IERC20Upgradeable); 

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

    /// @notice Price per share in terms of USDL
    /// @return Price of 1 xUSDL in terms of USDL
    function pricePerShare() external view returns (uint256);

    /// @notice Block number after which user can withdraw USDL
    /// @return Block number after which user can withdraw USDL 
    function userUnlockBlock(address usr) external view returns (uint256);

    /// @notice Permit to allow an account to use its balance
    /// @param owner address
    /// @param spender address
    /// @param amount to approve
    /// @param deadline for permit function
    /// @param v part of sig
    /// @param r part of sig
    /// @param s part of sig
    function permit(address owner, address spender, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;

    /**
     * @notice Returns the current ERC2612 nonce for `owner`. This value must be
     * included whenever a signature is generated for {permit}.
     *
     * Every successful call to {permit} increases ``owner``'s nonce by one. This
     * prevents a signature from being used multiple times.
     * @param owner address
     * @return Nonce
     */
    function nonces(address owner) external view returns (uint256);

}