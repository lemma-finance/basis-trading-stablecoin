// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;
import { ERC20Upgradeable, IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { Utils } from "./libraries/Utils.sol";
import { SafeMathExt } from "./libraries/SafeMathExt.sol";
import { IPerpetualDEXWrapper } from "./interfaces/IPerpetualDEXWrapper.sol";

/// @author Lemma Finance
contract USDLemma is ERC20Upgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {
    using SafeCastUpgradeable for int256;
    using SafeMathExt for int256;
    using SafeMathExt for uint256;

    address public lemmaTreasury;
    address public stakingContractAddress;
    uint256 public fees;

    mapping(uint256 => mapping(address => address)) public perpetualDEXWrappers;

    mapping(address => uint256) public nonces;

    bytes32 public PERMIT_TYPEHASH;
    bytes32 private _DOMAIN_SEPARATOR;
    uint256 public deploymentChainId;

    function initialize(
        address trustedForwarder,
        address collateralAddress,
        address perpetualDEXWrapperAddress
    ) external initializer {
        __Ownable_init();
        __ERC20_init("USDLemma", "USDL");
        __ERC2771Context_init(trustedForwarder);
        addPerpetualDEXWrapper(0, collateralAddress, perpetualDEXWrapperAddress);
        PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        deploymentChainId = chainId;
        _DOMAIN_SEPARATOR = _calculateDomainSeparator(chainId);
    }

    /// @notice Set staking contract address, can only be called by owner
    /// @param _stakingContractAddress Address of staking contract
    function setStakingContractAddress(address _stakingContractAddress) public onlyOwner {
        stakingContractAddress = _stakingContractAddress;
    }

    /// @notice Set Lemma treasury, can only be called by owner
    /// @param _lemmaTreasury Address of Lemma Treasury
    function setLemmaTreasury(address _lemmaTreasury) public onlyOwner {
        lemmaTreasury = _lemmaTreasury;
    }

    /// @notice Set Fees, can only be called by owner
    /// @param _fees Fees taken by the protocol
    function setFees(uint256 _fees) public onlyOwner {
        fees = _fees;
    }

    /// @notice Add address for perpetual dex wrapper for perpetual index and collateral, can only be called by owner
    /// @param perpetualDEXIndex, index of perpetual dex
    /// @param collateralAddress, address of collateral to be used in the dex
    /// @param perpetualDEXWrapperAddress, address of perpetual dex wrapper
    function addPerpetualDEXWrapper(
        uint256 perpetualDEXIndex,
        address collateralAddress,
        address perpetualDEXWrapperAddress
    ) public onlyOwner {
        perpetualDEXWrappers[perpetualDEXIndex][collateralAddress] = perpetualDEXWrapperAddress;
    }

    /// @notice Deposit collateral like WETH, WBTC, etc. to mint USDL
    /// @param to Receipent of minted USDL
    /// @param amount Amount of USDL to mint
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be opened
    /// @param maxCollateralRequired Maximum amount of collateral to be used to mint given USDL
    /// @param collateral Collateral to be used to mint USDL
    function depositTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 maxCollateralRequired,
        IERC20Upgradeable collateral
    ) public {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        uint256 collateralRequired = perpDEXWrapper.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        require(collateralRequired <= maxCollateralRequired, "collateral required execeeds maximum");
        collateral.transferFrom(_msgSender(), address(perpDEXWrapper), collateralRequired);
        perpDEXWrapper.open(amount);
        _mint(to, amount);
    }

    /// @notice Redeem USDL and withdraw collateral like WETH, WBTC, etc
    /// @param to Receipent of withdrawn collateral
    /// @param amount Amount of USDL to redeem
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be closed
    /// @param minCollateralToGetBack Minimum amount of collateral to get back on redeeming given USDL
    /// @param collateral Collateral to be used to redeem USDL
    function withdrawTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 minCollateralToGetBack,
        IERC20Upgradeable collateral
    ) public {
        _burn(_msgSender(), amount);
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        uint256 collateralToGetBack = perpDEXWrapper.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
        require(collateralToGetBack >= minCollateralToGetBack, "collateral got back is too low");
        perpDEXWrapper.close(amount);
        collateral.transfer(to, collateralToGetBack);
    }

    /// @notice Deposit collateral like WETH, WBTC, etc. to mint USDL
    /// @param amount Amount of USDL to mint
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be opened
    /// @param maxCollateralRequired Maximum amount of collateral to be used to mint given USDL
    /// @param collateral Collateral to be used to mint USDL
    function deposit(
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 maxCollateralRequired,
        IERC20Upgradeable collateral
    ) public {
        depositTo(_msgSender(), amount, perpetualDEXIndex, maxCollateralRequired, collateral);
    }

    /// @notice Redeem USDL and withdraw collateral like WETH, WBTC, etc
    /// @param amount Amount of USDL to redeem
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be closed
    /// @param minCollateralToGetBack Minimum amount of collateral to get back on redeeming given USDL
    /// @param collateral Collateral to be used to redeem USDL
    function withdraw(
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 minCollateralToGetBack,
        IERC20Upgradeable collateral
    ) public {
        withdrawTo(_msgSender(), amount, perpetualDEXIndex, minCollateralToGetBack, collateral);
    }

    /// @notice Rebalance position on a dex to reinvest if funding rate positive and burn USDL if funding rate negative
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be rebalanced
    /// @param collateral Collateral to be used to rebalance position
    /// @param amount amount of USDL to burn or mint
    /// @param data data used to rebalance for perpetual data
    function reBalance(
        uint256 perpetualDEXIndex,
        IERC20Upgradeable collateral,
        int256 amount,
        bytes calldata data
    ) external {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(perpDEXWrapper.reBalance(msg.sender, amount, data), "rebalance not done");
        //burn or mint from the staker contract
        if (amount >= 0) {
            uint256 totalAmountToMint = amount.toUint256();
            uint256 amountToLemmaTreasury = (totalAmountToMint * fees) / 10**4;
            uint256 amountToStakingContract = totalAmountToMint - amountToLemmaTreasury;
            _mint(lemmaTreasury, amountToLemmaTreasury);
            _mint(stakingContractAddress, amountToStakingContract);
        } else {
            uint256 totalAmountToBurn = amount.neg().toUint256();
            uint256 balanceOfStakingContract = balanceOf(stakingContractAddress).min(
                allowance(stakingContractAddress, address(this))
            );
            uint256 balanceOfLemmaTreasury = balanceOf(lemmaTreasury).min(allowance(lemmaTreasury, address(this)));

            uint256 amountBurntFromStakingContract = balanceOfStakingContract.min(totalAmountToBurn);
            uint256 amountBurntFromLemmaTreasury = balanceOfLemmaTreasury.min(
                totalAmountToBurn - amountBurntFromStakingContract
            );

            if (amountBurntFromStakingContract > 0) {
                _burnFrom(stakingContractAddress, amountBurntFromStakingContract);
            }
            if (amountBurntFromLemmaTreasury > 0) {
                _burnFrom(lemmaTreasury, amountBurntFromLemmaTreasury);
            }
            // if ((amountBurntFromStakingContract + amountBurntFromLemmaTreasury) != totalAmountToBurn) {
            //     //in this case value of USDL will go down
            // }
        }
    }

    /**
     * @dev Destroys `amount` tokens from `account`, deducting from the caller's
     * allowance.
     *
     *
     * Requirements:
     *
     * - the caller must have allowance for ``accounts``'s tokens of at least
     * `amount`.
     */
    function _burnFrom(address account, uint256 amount) internal {
        uint256 currentAllowance = allowance(account, _msgSender());
        require(currentAllowance >= amount, "ERC20: burn amount exceeds allowance");
        unchecked {
            _approve(account, _msgSender(), currentAllowance - amount);
        }
        _burn(account, amount);
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

    /// @notice Setting the version as a function so that it can be overriden
    /// @return version
    function version() public pure virtual returns (string memory) {
        return "1";
    }

    /// @dev Calculate the DOMAIN_SEPARATOR.
    function _calculateDomainSeparator(uint256 chainId) private view returns (bytes32) {
        return
            keccak256(
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
        assembly {
            chainId := chainid()
        }
        return chainId == deploymentChainId ? _DOMAIN_SEPARATOR : _calculateDomainSeparator(chainId);
    }


    /// @notice Permit to allow an account to use its balance
    /// @param owner address
    /// @param spender address
    /// @param amount to approve
    /// @param deadline for permit function
    /// @param v part of sig
    /// @param r part of sig
    /// @param s part of sig
    function permit(
        address owner,
        address spender,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external virtual {
        require(deadline >= block.timestamp, "USDL: expired deadline");

        uint256 chainId;
        assembly {
            chainId := chainid()
        }

        bytes32 hashStruct = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, amount, nonces[owner]++, deadline));

        bytes32 hash = keccak256(
            abi.encodePacked(
                "\x19\x01",
                chainId == deploymentChainId ? _DOMAIN_SEPARATOR : _calculateDomainSeparator(chainId),
                hashStruct
            )
        );

        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0) && signer == owner, "USDL: invalid signature");

        _approve(owner, spender, amount);
    }

}
