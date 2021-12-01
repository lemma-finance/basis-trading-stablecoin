pragma solidity =0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IXUSDL } from "./interfaces/IXUSDL.sol";

/// @author Lemma Finance
contract xUSDL is IXUSDL, ERC20PermitUpgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {
    uint256 public override MINIMUM_LOCK;

    mapping(address => uint256) public override userUnlockBlock;

    IERC20Upgradeable public override usdl;

    //events
    event UpdateMinimumLock(uint256 newLock);
    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);

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

    /// @notice Balance of USDL in xUSDL contract
    /// @return balanceAmount Amount of USDL
    function balance() public view override returns (uint256 balanceAmount) {
        balanceAmount = usdl.balanceOf(address(this));
    }

    /// @notice Deposit and mint xUSDL in exchange of USDL
    /// @param amount of USDL to deposit
    /// @return shares Amount of xUSDL minted
    function deposit(uint256 amount) external override returns (uint256 shares) {
        if (totalSupply() == 0) {
            shares = amount;
        } else {
            shares = (amount * 1e18) / pricePerShare();
        }
        SafeERC20Upgradeable.safeTransferFrom(usdl, _msgSender(), address(this), amount);
        if (periphery != _msgSender()) {
            userUnlockBlock[_msgSender()] = block.number + MINIMUM_LOCK;
        }
        _mint(_msgSender(), shares);
        emit Deposit(_msgSender(), amount);
    }

    /// @notice Withdraw USDL and burn xUSDL
    /// @param shares of xUSDL to burn
    /// @return amount Amount of USDL withdrawn
    function withdraw(uint256 shares) external override returns (uint256 amount) {
        return withdrawTo(_msgSender(), shares);
    }

    /// @notice Withdraw USDL and burn xUSDL
    /// @param to address of user to transfer USDL
    /// @param shares of xUSDL to burn
    /// @return amount Amount of USDL withdrawn
    function withdrawTo(address to, uint256 shares) public override returns (uint256 amount) {
        require(block.number >= userUnlockBlock[_msgSender()], "xUSDL: Locked tokens");
        amount = (pricePerShare() * shares) / 1e18;
        _burn(_msgSender(), shares);
        SafeERC20Upgradeable.safeTransfer(usdl, to, amount);
        emit Withdraw(_msgSender(), amount);
    }

    /// @notice Price per share in terms of USDL
    /// @return price Price of 1 xUSDL in terms of USDL
    function pricePerShare() public view override returns (uint256 price) {
        price = (balance() * 1e18) / totalSupply();
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

    function _msgSender()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        //ERC2771ContextUpgradeable._msgSender();
        return super._msgSender();
    }

    function _msgData()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata)
    {
        //ERC2771ContextUpgradeable._msgData();
        return super._msgData();
    }
}
