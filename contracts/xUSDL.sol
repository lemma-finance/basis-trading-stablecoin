pragma solidity =0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IXUSDL } from "./interfaces/IXUSDL.sol";
import { IEIP4626 } from './interfaces/eip4626/IEIP4626.sol';

/// @author Lemma Finance
contract xUSDL is IEIP4626, ERC20PermitUpgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {
    uint256 public override MINIMUM_LOCK;

    mapping(address => uint256) public override userUnlockBlock;

    IERC20Upgradeable public override usdl;

    //events
    event UpdateMinimumLock(uint256 newLock);

    address public periphery;

    function initialize(
        address _trustedForwarder,
        address _usdl,
        address _periphery
    ) external initializer {
        __Ownable_init();
        __ERC20_init("xUSDLemma", "xUSDL");
        __ERC20Permit_init("xUSDLemma");
        __ERC2771Context_init(_trustedForwarder);
        usdl = IERC20Upgradeable(_usdl);
        SafeERC20Upgradeable.safeApprove(usdl, address(usdl), type(uint256).max);
        periphery = _periphery;
        //removed after the deployment
        //MINIMUM_LOCK = 100;
    }

    ///@notice update periphery contract address
    function updatePeriphery(address _periphery) external onlyOwner {
        periphery = _periphery;
    }

    /// @notice updated minimum number of blocks to be locked before xUSDL tokens are unlocked
    function updateLock(uint256 lock) external onlyOwner {
        MINIMUM_LOCK = lock;
        emit UpdateMinimumLock(lock);
    }

    /// @notice reset approvals for usdl contract to user usdl as needed
    function resetApprovals() external {
        SafeERC20Upgradeable.safeApprove(usdl, address(usdl), type(uint256).max);
    }

    /// @notice The address of the underlying token used for the Vault uses for accounting, depositing, and withdrawing.
    function asset() external view override returns(address) {
        return address(usdl);
    }

    /// @notice totalAssets Total amount of the underlying asset that is “managed” by Vault.
    /// @return totalManagedAssets Amount of USDL in xUsdl contract
    function totalAssets() public view override returns (uint256 totalManagedAssets) {
        totalManagedAssets = usdl.balanceOf(address(this));
    }

    /// @notice Mints shares Vault shares to receiver by depositing exactly amount of underlying tokens.
    /// @param assets of USDL to deposit
    /// @param receiver address of user to transfer xUSDL
    /// @return shares total xUsdl share minted
    function deposit(uint256 assets, address receiver) external override returns(uint256 shares){
        require((shares = previewDeposit(assets)) != 0, "ZERO_SHARES");
        SafeERC20Upgradeable.safeTransferFrom(usdl, _msgSender(), address(this), assets);
        if (periphery != _msgSender()) {
            userUnlockBlock[_msgSender()] = block.number + MINIMUM_LOCK;
        }
        _mint(receiver, shares);
        emit Deposit(_msgSender(), receiver, assets, shares);
    }

    /// @notice Mints exactly shares Vault shares to receiver by depositing amount of underlying tokens.
    /// @param shares of xUSDL should mint
    /// @param receiver address of user to transfer xUSDL
    /// @return assets total Usdl need to deposit
    function mint(uint256 shares, address receiver) public override returns (uint256 assets) {
        require((assets = previewMint(shares)) != 0, "ZERO_SHARES");
        SafeERC20Upgradeable.safeTransferFrom(usdl, _msgSender(), address(this), assets);
        if (periphery != _msgSender()) {
            userUnlockBlock[_msgSender()] = block.number + MINIMUM_LOCK;
        }
        _mint(receiver, shares);
        emit Deposit(_msgSender(), receiver, assets, shares);
    }

    /// @notice Redeems shares from owner and sends assets of underlying tokens to receiver.
    /// @param assets Amount of USDL withdrawn
    /// @param receiver address of user to transfer USDL
    /// @param owner of xUSDL to burn
    /// @return shares total xUsdl share burned
    function withdraw(uint256 assets, address receiver, address owner) external override returns (uint256 shares) {
        require(owner == _msgSender(), "xUSDL: Invalid Owner");
        require(block.number >= userUnlockBlock[_msgSender()], "xUSDL: Locked tokens");
        require((shares = previewWithdraw(assets)) != 0, "ZERO_SHARES");
        _burn(owner, shares);
        SafeERC20Upgradeable.safeTransfer(usdl, receiver, assets);
        emit Withdraw(owner, receiver, assets, shares);
    }

    /// @notice Redeems shares from owner and sends assets of underlying tokens to receiver.
    /// @param shares of xUSDL should redeem
    /// @param receiver address of user to transfer USDL
    /// @param owner of xUSDL to burn
    /// @return assets total Usdl need to withdraw
    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256 assets) {
        require(owner == _msgSender(), "xUSDL: Invalid Owner");
        require(block.number >= userUnlockBlock[_msgSender()], "xUSDL: Locked tokens");
        require((assets = previewRedeem(shares)) != 0, "ZERO_ASSETS");
        _burn(owner, shares);
        SafeERC20Upgradeable.safeTransfer(usdl, receiver, assets);
        emit Withdraw(owner, receiver, assets, shares);
    }

    /// @notice Total number of underlying assets that depositor’s shares represent.
    /// @param user balanceOf userAddress
    /// @return usdl balance of user
    function assetsOf(address user) public view override returns (uint256) {
        return previewRedeem(balanceOf(user));
    }

    /// @notice The current exchange rate of shares to assets(in terms of USDL)
    /// @return price Price of 1 xUSDL in terms of USDL    
    function assetsPerShare() public view override returns (uint256 price) {
        price = (totalAssets() * 1e18) / totalSupply();
    }

    /// @notice previewDeposit Allows an on-chain or off-chain user to simulate the effects of their deposit at the current block, given current on-chain conditions.
    /// @param assets of USDL to deposit
    /// @return shares total xUsdl share minted
    function previewDeposit(uint256 assets) public view override returns(uint256 shares) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.
        return supply == 0 ? assets : (assets * 1e18) / assetsPerShare();
    }

    /// @notice previewWithdraw Allows an on-chain or off-chain user to simulate the effects of their withdrawal at the current block, given current on-chain conditions.
    /// @param assets of USDL to withdraw
    /// @return shares total xUsdl share burned
    function previewWithdraw(uint256 assets) public view override returns(uint256 shares) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.
        return supply == 0 ? assets : (assets * 1e18) / assetsPerShare();
    }

    /// @notice previewMint Allows an on-chain or off-chain user to simulate the effects of their mint at the current block, given current on-chain conditions.
    /// @param shares of xUSDL to mint
    /// @return assets total Usdl need to deposit
    function previewMint(uint256 shares) public view override returns(uint256 assets) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.
        return supply == 0 ? shares : shares = (assetsPerShare() * shares) / 1e18;
    }

    /// @notice previewRedeem Allows an on-chain or off-chain user to simulate the effects of their redeemption at the current block, given current on-chain conditions.
    /// @param shares of xUSDL to burned
    /// @return assets total Usdl need to withdraw
    function previewRedeem(uint256 shares) public view override returns(uint256 assets) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.
        return supply == 0 ? shares : shares = (assetsPerShare() * shares) / 1e18;
    }

    /// @notice Total number of underlying assets that caller can be deposit.
    function maxDeposit() external pure override returns(uint256 maxAssets) {
        return type(uint256).max;
    }

    /// @notice Total number of underlying assets that caller can withdraw.
    function maxWithdraw() external pure override returns(uint256 maxShares) {
        return type(uint256).max;
    }

    /// @notice Total number of underlying shares that caller can be mint.
    function maxMint() external pure override returns(uint256 maxAssets) {
        return type(uint256).max;
    }

    /// @notice Total number of underlying shares that caller can redeem.
    function maxRedeem() external pure override returns(uint256 maxShares) {
        return type(uint256).max;
    }

    function _msgSender()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        //ERC2771ContextUpgradeable._msgSender();
        return super._msgSender();
    }

    function _msgData()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata)
    {
        //ERC2771ContextUpgradeable._msgData();
        return super._msgData();
    }

    function _beforeTokenTransfer(
        address from,
        address,
        uint256
    ) internal view override {
        require(block.number >= userUnlockBlock[from], "xUSDL: Locked tokens");
    }

    function _afterTokenTransfer(
        address from,
        address to,
        uint256
    ) internal override {
        if (from == periphery) {
            userUnlockBlock[to] = block.number + MINIMUM_LOCK;
        }
    }
}
