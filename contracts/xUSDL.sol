// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;

import { ERC20Upgradeable, IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { IXUSDL } from "./interfaces/IXUSDL.sol";

contract xUSDL is IXUSDL, ERC20Upgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {
    uint256 public override MINIMUM_LOCK;

    mapping(address => uint256) public override userUnlockBlock;

    IERC20Upgradeable public override usdl;

    mapping (address => uint256) public override nonces;

    bytes32 public PERMIT_TYPEHASH;
    bytes32 private _DOMAIN_SEPARATOR;
    uint256 public deploymentChainId;

    function initialize(address _trustedForwarder, address _usdl) external initializer {
        __Ownable_init();
        __ERC20_init("xUSDLemma", "xUSDL");
        __ERC2771Context_init(_trustedForwarder);
        usdl = IERC20Upgradeable(_usdl);
        usdl.approve(address(usdl), type(uint256).max);
        MINIMUM_LOCK = 100;
        PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        uint256 chainId;
        assembly {chainId := chainid()}
        deploymentChainId = chainId;
        _DOMAIN_SEPARATOR = _calculateDomainSeparator(chainId);

    }

    function updateLock(uint256 lock) external onlyOwner {
        MINIMUM_LOCK = lock;
    }

    function resetApprovals() external {
        usdl.approve(address(usdl), type(uint256).max);
    }

    function balance() public view override returns (uint256 balance) {
        balance = usdl.balanceOf(address(this));
    }

    function deposit(uint256 amount) external override returns (uint256 shares) {
        if (totalSupply() == 0) {
            shares = amount;
        } else {
            shares = (amount * 1e18) / pricePerShare();
        }

        usdl.transferFrom(_msgSender(), address(this), amount);
        userUnlockBlock[_msgSender()] = block.number + MINIMUM_LOCK;
        _mint(_msgSender(), shares);
    }

    function withdraw(uint256 shares) external override returns (uint256 amount) {
        require(block.number >= userUnlockBlock[_msgSender()], "xUSDL: Locked tokens");
        amount = (pricePerShare() * shares) / 1e18;
        usdl.transfer(_msgSender(), amount);
        _burn(_msgSender(), shares);
    }

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

    /// @dev Setting the version as a function so that it can be overriden
    function version() public pure virtual returns(string memory) { return "1"; }

    /// @dev Calculate the DOMAIN_SEPARATOR.
    function _calculateDomainSeparator(uint256 chainId) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name())),
                keccak256(bytes(version())),
                chainId,
                address(this)
            )
        );
    }

    /// @dev Return the DOMAIN_SEPARATOR.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        uint256 chainId;
        assembly {chainId := chainid()}
        return chainId == deploymentChainId ? _DOMAIN_SEPARATOR : _calculateDomainSeparator(chainId);
    }


    function permit(address owner, address spender, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external virtual override {
        require(deadline >= block.timestamp, "xUSDL: expired deadline");

        uint256 chainId;
        assembly {chainId := chainid()}

        bytes32 hashStruct = keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                owner,
                spender,
                amount,
                nonces[owner]++,
                deadline
            )
        );

        bytes32 hash = keccak256(
            abi.encodePacked(
                "\x19\x01",
                chainId == deploymentChainId ? _DOMAIN_SEPARATOR : _calculateDomainSeparator(chainId),
                hashStruct
            )
        );

        address signer = ecrecover(hash, v, r, s);
        require(
            signer != address(0) && signer == owner,
            "xUSDL: invalid signature"
        );

        _approve(owner, spender, amount);
    }    

}
