// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;

import { ERC20Upgradeable, IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { IXUSDL } from './interfaces/IXUSDL.sol';

contract xUSDL is IXUSDL, ERC20Upgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {


    uint256 public override MINIMUM_LOCK = 100;

    mapping(address => uint256) public override userUnlockBlock;

    IERC20Upgradeable public override usdl;

    function initialize(
        address _trustedForwarder,
        address _usdl
    ) external initializer {
        __Ownable_init();
        __ERC20_init("xUSDLemma", "xUSDL");
        __ERC2771Context_init(_trustedForwarder);
        usdl = IERC20Upgradeable(_usdl);
        usdl.approve(address(usdl), type(uint256).max);
    }

    function resetApprovals() external {
        usdl.approve(address(usdl), type(uint256).max);
    }

    function balance() public override view returns (uint256 balance) {
        balance = usdl.balanceOf(address(this));
    }

    function deposit(uint256 amount) external override returns (uint256 shares) {
        usdl.transferFrom(_msgSender(), address(this), amount);
        shares = (amount * 1e18) / pricePerShare();
        userUnlockBlock[_msgSender()] = block.number + MINIMUM_LOCK;
        _mint(_msgSender(), shares);
    }


    function withdraw(uint256 shares) external override returns (uint256 amount) {
        require(block.number >= userUnlockBlock[_msgSender()], "xUSDL: Locked tokens");
        amount = (pricePerShare() * shares)/1e18;
        usdl.transfer(_msgSender(), amount);
        _burn(_msgSender(), shares);
    }


    function pricePerShare() public view override returns (uint256 price) {
        price = (balance() * 1e18)/ totalSupply();
    }

    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal override {
        require(block.number > userUnlockBlock[sender], "ERC20: tokens not yet unlocked");
        super._transfer(sender, recipient, amount);
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