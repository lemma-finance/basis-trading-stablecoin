// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IEIP4626 } from "./interfaces/eip4626/IEIP4626.sol";

/// @author Lemma Finance
contract xLemmaSynth is IEIP4626, ERC20PermitUpgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {
    uint256 public minimumLock;

    mapping(address => uint256) public userUnlockBlock;

    IERC20Upgradeable public lSynth;

    //events
    event MinimumLockUpdated(uint256 newLock);
    event PeripheryUpdated(address newPeriphery);

    address public periphery;

    function initialize(
        address _trustedForwarder,
        address _lSynth,
        address _periphery,
        string memory _name,
        string memory _symbol
    ) external initializer {
        __Ownable_init();
        __ERC20_init(_name, _symbol);
        __ERC20Permit_init(_name);
        __ERC2771Context_init(_trustedForwarder);
        lSynth = IERC20Upgradeable(_lSynth);
        SafeERC20Upgradeable.safeApprove(lSynth, address(lSynth), type(uint256).max);
        setPeriphery(_periphery);
    }

    ///@notice update periphery contract address
    function setPeriphery(address _periphery) public onlyOwner {
        periphery = _periphery;
        emit PeripheryUpdated(_periphery);
    }

    /// @notice updated minimum number of blocks to be locked before xLemmaSynth tokens are unlocked
    function setMinimumLock(uint256 _minimumLock) external onlyOwner {
        minimumLock = _minimumLock;
        emit MinimumLockUpdated(_minimumLock);
    }

    /// @notice reset approvals for lSynth contract to user lSynth as needed
    function resetApprovals() external {
        SafeERC20Upgradeable.safeApprove(lSynth, address(lSynth), type(uint256).max);
    }

    /// @notice The address of the underlying token used for the Vault uses for accounting, depositing, and withdrawing.
    function asset() external view override returns (address) {
        return address(lSynth);
    }

    /// @notice totalAssets Total amount of the underlying asset that is “managed” by Vault.
    /// @return totalManagedAssets Amount of lSynth in xLemmaSynth contract
    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        totalManagedAssets = lSynth.balanceOf(address(this));
    }

    /// @notice Mints shares Vault shares to receiver by depositing exactly amount of underlying tokens.
    /// @param assets of lSynth to deposit
    /// @param receiver address of user to transfer xLemmaSynth
    /// @return shares total xLemmaSynth share minted
    function deposit(uint256 assets, address receiver) external override returns (uint256 shares) {
        require((shares = previewDeposit(assets)) != 0, "ZERO_SHARES");
        SafeERC20Upgradeable.safeTransferFrom(lSynth, _msgSender(), address(this), assets);
        checkPreviousState(receiver);
        if (periphery != _msgSender()) {
            userUnlockBlock[receiver] = block.number + minimumLock;
        }
        _mint(receiver, shares);
        emit Deposit(_msgSender(), receiver, assets, shares);
    }

    /// @notice Mints exactly shares Vault shares to receiver by depositing amount of underlying tokens.
    /// @param shares of xLemmaSynth should mint
    /// @param receiver address of user to transfer xLemmaSynth
    /// @return assets total lSynth need to deposit
    function mint(uint256 shares, address receiver) external override returns (uint256 assets) {
        require((assets = previewMint(shares)) != 0, "ZERO_SHARES");
        SafeERC20Upgradeable.safeTransferFrom(lSynth, _msgSender(), address(this), assets);
        checkPreviousState(receiver);
        if (periphery != _msgSender()) {
            userUnlockBlock[receiver] = block.number + minimumLock;
        }
        _mint(receiver, shares);
        emit Deposit(_msgSender(), receiver, assets, shares);
    }

    /// @notice Redeems shares from owner and sends assets of underlying tokens to receiver.
    /// @param assets Amount of lSynth withdrawn
    /// @param receiver address of user to transfer lSynth
    /// @param _owner of xLemmaSynth to burn
    /// @return shares total xLemmaSynth share burned
    function withdraw(
        uint256 assets,
        address receiver,
        address _owner
    ) external override returns (uint256 shares) {
        require(_owner == _msgSender(), "xLemmaSynth: Invalid Owner");
        require(block.number >= userUnlockBlock[_msgSender()], "xLemmaSynth: Locked tokens");
        require((shares = previewWithdraw(assets)) != 0, "ZERO_SHARES");
        _burn(_owner, shares);
        SafeERC20Upgradeable.safeTransfer(lSynth, receiver, assets);
        emit Withdraw(_owner, receiver, assets, shares);
    }

    /// @notice Redeems shares from owner and sends assets of underlying tokens to receiver.
    /// @param shares of xLemmaSynth should redeem
    /// @param receiver address of user to transfer lSynth
    /// @param _owner of xLemmaSynth to burn
    /// @return assets total lSynth need to withdraw
    function redeem(
        uint256 shares,
        address receiver,
        address _owner
    ) external override returns (uint256 assets) {
        require(_owner == _msgSender(), "xLemmaSynth: Invalid Owner");
        require(block.number >= userUnlockBlock[_msgSender()], "xLemmaSynth: Locked tokens");
        require((assets = previewRedeem(shares)) != 0, "ZERO_ASSETS");
        _burn(_owner, shares);
        SafeERC20Upgradeable.safeTransfer(lSynth, receiver, assets);
        emit Withdraw(_owner, receiver, assets, shares);
    }

    /// @notice Total number of underlying assets that depositor’s shares represent.
    /// @param user balanceOf userAddress
    /// @return lSynth balance of user
    function assetsOf(address user) external view override returns (uint256) {
        return previewRedeem(balanceOf(user));
    }

    /// @notice The current exchange rate of shares to assets(in terms of lSynth)
    /// @return price Price of 1 xLemmaSynth in terms of lSynth
    function assetsPerShare() public view override returns (uint256 price) {
        price = (totalAssets() * 1e18) / totalSupply();
    }

    /// @notice previewDeposit Allows an on-chain or off-chain user to simulate the effects of their deposit at the current block, given current on-chain conditions.
    /// @param assets of lSynth to deposit
    /// @return shares total xLemmaSynth share minted
    function previewDeposit(uint256 assets) public view override returns (uint256 shares) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.
        return supply == 0 ? assets : (assets * 1e18) / assetsPerShare();
    }

    /// @notice previewWithdraw Allows an on-chain or off-chain user to simulate the effects of their withdrawal at the current block, given current on-chain conditions.
    /// @param assets of lSynth to withdraw
    /// @return shares total xLemmaSynth share burned
    function previewWithdraw(uint256 assets) public view override returns (uint256 shares) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.
        return supply == 0 ? assets : (assets * 1e18) / assetsPerShare();
    }

    /// @notice previewMint Allows an on-chain or off-chain user to simulate the effects of their mint at the current block, given current on-chain conditions.
    /// @param shares of xLemmaSynth to mint
    /// @return assets total lSynth need to deposit
    function previewMint(uint256 shares) public view override returns (uint256 assets) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.
        return supply == 0 ? shares : shares = (assetsPerShare() * shares) / 1e18;
    }

    /// @notice previewRedeem Allows an on-chain or off-chain user to simulate the effects of their redeemption at the current block, given current on-chain conditions.
    /// @param shares of xLemmaSynth to burned
    /// @return assets total lSynth need to withdraw
    function previewRedeem(uint256 shares) public view override returns (uint256 assets) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.
        return supply == 0 ? shares : shares = (assetsPerShare() * shares) / 1e18;
    }

    /// @notice Total number of underlying assets that caller can be deposit.
    function maxDeposit() external pure override returns (uint256 maxAssets) {
        return type(uint256).max;
    }

    /// @notice Total number of underlying assets that caller can withdraw.
    function maxWithdraw() external pure override returns (uint256 maxShares) {
        return type(uint256).max;
    }

    /// @notice Total number of underlying shares that caller can be mint.
    function maxMint() external pure override returns (uint256 maxAssets) {
        return type(uint256).max;
    }

    /// @notice Total number of underlying shares that caller can redeem.
    function maxRedeem() external pure override returns (uint256 maxShares) {
        return type(uint256).max;
    }

    /// @notice checkPreviousState will check if reciever has already xTokenBalance
    /// then msg.sender and receiver/to address should be same for xToken
    /// it restricts user to not to get lock again and again by attacker
    function checkPreviousState(address receiver) internal  view {
        uint256 previousBalance = balanceOf(receiver);
        if (previousBalance > 0) {
            require(_msgSender() == receiver, "Invalid Address: Receiver should be msg.sender");
        }
    } 

    function _msgSender()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        return msg.sender;
    }

    function _msgData() internal pure override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return msg.data;
    }

    function _beforeTokenTransfer(
        address from,
        address,
        uint256
    ) internal view override {
        require(block.number >= userUnlockBlock[from], "xLemmaSynth: Locked tokens");
    }

    function _afterTokenTransfer(
        address from,
        address to,
        uint256
    ) internal override {
        if (from == periphery) {
            userUnlockBlock[to] = block.number + minimumLock;
        }
    }
}
