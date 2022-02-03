pragma solidity =0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IXUSDL } from "./interfaces/IXUSDL.sol";
import { IEIP4626 } from './interfaces/eip4626/IEIP4626.sol';

/// @author Lemma Finance
contract EIP4626xUSDL is IEIP4626, ERC20PermitUpgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {
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

    function asset() external view override returns(address) {
        return address(usdl);
    }

    function totalAssets() public view override returns (uint256 totalAssets) {
        totalAssets = usdl.balanceOf(address(this));
    }

    function deposit(uint256 assets, address receiver) external override returns(uint256 shares){
        require((shares = previewDeposit(assets)) != 0, "ZERO_SHARES");
        SafeERC20Upgradeable.safeTransferFrom(usdl, _msgSender(), address(this), assets);
        if (periphery != _msgSender()) {
            userUnlockBlock[_msgSender()] = block.number + MINIMUM_LOCK;
        }
        _mint(receiver, shares);
        emit Deposit(_msgSender(), receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) public override returns (uint256 assets) {
        require((assets = previewMint(shares)) != 0, "ZERO_SHARES");
        SafeERC20Upgradeable.safeTransferFrom(usdl, _msgSender(), address(this), assets);
        if (periphery != _msgSender()) {
            userUnlockBlock[_msgSender()] = block.number + MINIMUM_LOCK;
        }
        _mint(receiver, shares);
        emit Deposit(_msgSender(), receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) external override returns (uint256 shares) {
        require(owner == _msgSender(), "xUSDL: Invalid Owner");
        require(block.number >= userUnlockBlock[_msgSender()], "xUSDL: Locked tokens");
        require((shares = previewWithdraw(assets)) != 0, "ZERO_SHARES");
        _burn(owner, shares);
        SafeERC20Upgradeable.safeTransfer(usdl, receiver, assets);
        emit Withdraw(owner, receiver, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256 assets) {
        require(owner == _msgSender(), "xUSDL: Invalid Owner");
        require(block.number >= userUnlockBlock[_msgSender()], "xUSDL: Locked tokens");
        require((assets = previewRedeem(shares)) != 0, "ZERO_ASSETS");
        _burn(owner, shares);
        SafeERC20Upgradeable.safeTransfer(usdl, receiver, assets);
        emit Withdraw(owner, receiver, assets, shares);
    }

    function assetsOf(address user) public view override returns (uint256) {
        return previewRedeem(balanceOf(user));
    }

    function assetsPerShare() public view override returns (uint256 price) {
        price = (totalAssets() * 1e18) / totalSupply();
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

    function previewDeposit(uint256 assets) public view override returns(uint256 shares) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.
        return supply == 0 ? assets : (assets * 1e18) / assetsPerShare();
    }

    function previewWithdraw(uint256 assets) public view override returns(uint256 shares) {
        uint256 supply = totalSupply(); // Saves an extra SLOAD if totalSupply is non-zero.
        return supply == 0 ? assets : (assets * 1e18) / assetsPerShare();
    }

    function previewMint(uint256 shares) public view override returns(uint256 assets) {
        assets = (assetsPerShare() * shares) / 1e18;
    }

    function previewRedeem(uint256 shares) public view override returns(uint256 assets) {
        assets = (assetsPerShare() * shares) / 1e18;
    }

    function maxDeposit() external view override returns(uint256 maxAssets) {
        return type(uint256).max;
    }

    function maxWithdraw() external view override returns(uint256 maxShares) {
        return type(uint256).max;
    }

    function maxMint() external view override returns(uint256 maxAssets) {
        return type(uint256).max;
    }

    function maxRedeem() external view override returns(uint256 maxShares) {
        return type(uint256).max;
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
