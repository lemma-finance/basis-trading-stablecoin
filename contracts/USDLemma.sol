pragma solidity =0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { Utils } from "./libraries/Utils.sol";
import { SafeMathExt } from "./libraries/SafeMathExt.sol";
import { IPerpetualDEXWrapper } from "./interfaces/IPerpetualDEXWrapper.sol";

/// @author Lemma Finance
contract USDLemma is ReentrancyGuardUpgradeable, ERC20PermitUpgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {
    using SafeCastUpgradeable for int256;
    using SafeMathExt for int256;
    using SafeMathExt for uint256;

    address public lemmaTreasury;
    address public stakingContractAddress;
    uint256 public fees;

    mapping(uint256 => mapping(address => address)) public perpetualDEXWrappers;
    mapping(address => bool) private whiteListAddress; // It will used in future deployments

    // events
    event DepositTo(
        uint256 indexed dexIndex,
        address indexed collateral,
        address to,
        uint256 amount,
        uint256 collateralRequired
    );
    event WithdrawTo(
        uint256 indexed dexIndex,
        address indexed collateral,
        address to,
        uint256 amount,
        uint256 collateralGotBack
    );
    event Rebalance(uint256 indexed dexIndex, address indexed collateral, int256 amount);
    event StakingContractUpdated(address indexed current);
    event SetWhiteListAddress(address indexed account, bool indexed isWhiteList);
    event LemmaTreasuryUpdated(address indexed current);
    event FeesUpdated(uint256 newFees);
    event PerpetualDexWrapperAdded(uint256 indexed dexIndex, address indexed collateral, address dexWrapper);

    function initialize(
        address trustedForwarder,
        address collateralAddress,
        address perpetualDEXWrapperAddress
    ) external initializer {
        __ReentrancyGuard_init();
        __Ownable_init();
        __ERC20_init("USDLemma", "USDL");
        __ERC20Permit_init("USDLemma");
        __ERC2771Context_init(trustedForwarder);
        addPerpetualDEXWrapper(0, collateralAddress, perpetualDEXWrapperAddress);
    }

    /// @notice Returns the fees of the underlying Perp DEX Wrapper
    /// @param dexIndex The DEX Index to operate on
    /// @param collateral Collateral for the minting / redeeming operation
    function getFees(uint256 dexIndex, address collateral) external view returns (uint256) {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(perpetualDEXWrappers[dexIndex][collateral]);
        require(address(perpDEXWrapper) != address(0), "DEX Wrapper should not ZERO address");
        return perpDEXWrapper.getFees();
    }

    /// @notice Returns the total position in quote Token on a given DEX
    /// @param dexIndex The DEX Index to operate on
    /// @param collateral Collateral for the minting / redeeming operation
    function getTotalPosition(uint256 dexIndex, address collateral) external view returns (int256) {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(perpetualDEXWrappers[dexIndex][collateral]);

        require(address(perpDEXWrapper) != address(0), "DEX Wrapper should not ZERO address");
        return perpDEXWrapper.getTotalPosition();
    }

    /// @notice Set whitelist address, can only be called by owner, It will helps whitelist address to call multiple function of USDL at a time
    /// NOTE:  whiteListAddress is not used anywhere in contract but it will use in future updates.
    /// @param _account Address of whitelist EOA or contract address
    /// @param _isWhiteList add or remove of whitelist tag for any address
    function setWhiteListAddress(address _account, bool _isWhiteList) external onlyOwner {
        require(_account != address(0), "Account should not ZERO address");
        whiteListAddress[_account] = _isWhiteList;
        emit SetWhiteListAddress(_account, _isWhiteList);
    }

    /// @notice Set staking contract address, can only be called by owner
    /// @param _stakingContractAddress Address of staking contract
    function setStakingContractAddress(address _stakingContractAddress) external onlyOwner {
        require(_stakingContractAddress != address(0), "StakingContractAddress should not ZERO address");
        stakingContractAddress = _stakingContractAddress;
        emit StakingContractUpdated(stakingContractAddress);
    }

    /// @notice Set Lemma treasury, can only be called by owner
    /// @param _lemmaTreasury Address of Lemma Treasury
    function setLemmaTreasury(address _lemmaTreasury) external onlyOwner {
        require(_lemmaTreasury != address(0), "LemmaTreasury should not ZERO address");
        lemmaTreasury = _lemmaTreasury;
        emit LemmaTreasuryUpdated(lemmaTreasury);
    }

    /// @notice Set Fees, can only be called by owner
    /// @param _fees Fees taken by the protocol
    function setFees(uint256 _fees) external onlyOwner {
        fees = _fees;
        emit FeesUpdated(fees);
    }

    /// @notice Add address for perpetual dex wrapper for perpetual index and collateral - can only be called by owner
    /// @param perpetualDEXIndex, index of perpetual dex
    /// @param collateralAddress, address of collateral to be used in the dex
    /// @param perpetualDEXWrapperAddress, address of perpetual dex wrapper
    function addPerpetualDEXWrapper(
        uint256 perpetualDEXIndex,
        address collateralAddress,
        address perpetualDEXWrapperAddress
    ) public onlyOwner {
        perpetualDEXWrappers[perpetualDEXIndex][collateralAddress] = perpetualDEXWrapperAddress;
        emit PerpetualDexWrapperAdded(perpetualDEXIndex, collateralAddress, perpetualDEXWrapperAddress);
    }

    /// @notice Deposit collateral like WETH, WBTC, etc. to mint USDL specifying the exact amount of USDL
    /// @param to Receipent of minted USDL
    /// @param amount Amount of USDL to mint
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be opened
    /// @param maxCollateralAmountRequired Maximum amount of collateral to be used to mint given USDL
    /// @param collateral Collateral to be used to mint USDL
    function depositTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 maxCollateralAmountRequired,
        IERC20Upgradeable collateral
    ) public nonReentrant {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        uint256 collateralRequired = perpDEXWrapper.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        collateralRequired = perpDEXWrapper.getAmountInCollateralDecimals(collateralRequired, true);
        require(collateralRequired <= maxCollateralAmountRequired, "collateral required execeeds maximum");
        SafeERC20Upgradeable.safeTransferFrom(collateral, _msgSender(), address(perpDEXWrapper), collateralRequired);
        perpDEXWrapper.open(amount, collateralRequired);
        _mint(to, amount);
        emit DepositTo(perpetualDEXIndex, address(collateral), to, amount, collateralRequired);
    }

    /// @notice Deposit collateral like WETH, WBTC, etc. to mint USDL specifying the exact amount of collateral
    /// @param to Receipent of minted USDL
    /// @param collateralAmount Amount of collateral to deposit
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be opened
    /// @param minUSDLToMint Minimum USDL to mint
    /// @param collateral Collateral to be used to mint USDL
    function depositToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 minUSDLToMint,
        IERC20Upgradeable collateral
    ) external nonReentrant {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        uint256 collateralAmountToDeposit = perpDEXWrapper.getAmountInCollateralDecimals(collateralAmount, true);
        SafeERC20Upgradeable.safeTransferFrom(
            collateral,
            _msgSender(),
            address(perpDEXWrapper),
            collateralAmountToDeposit
        );
        uint256 USDLToMint = perpDEXWrapper.openWExactCollateral(collateralAmount);
        require(USDLToMint >= minUSDLToMint, "USDL minted too low");
        _mint(to, USDLToMint);
        emit DepositTo(perpetualDEXIndex, address(collateral), to, USDLToMint, collateralAmountToDeposit);
    }

    /// @notice Redeem USDL and withdraw collateral like WETH, WBTC, etc specifying the exact amount of USDL
    /// @param to Receipent of withdrawn collateral
    /// @param amount Amount of USDL to redeem
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be closed
    /// @param minCollateralAmountToGetBack Minimum amount of collateral to get back on redeeming given USDL
    /// @param collateral Collateral to be used to redeem USDL
    function withdrawTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 minCollateralAmountToGetBack,
        IERC20Upgradeable collateral
    ) public nonReentrant {
        _burn(_msgSender(), amount);
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        uint256 collateralAmountToGetBack = perpDEXWrapper.getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
        collateralAmountToGetBack = perpDEXWrapper.getAmountInCollateralDecimals(collateralAmountToGetBack, false);
        require(collateralAmountToGetBack >= minCollateralAmountToGetBack, "collateral got back is too low");
        perpDEXWrapper.close(amount, collateralAmountToGetBack);
        SafeERC20Upgradeable.safeTransfer(collateral, to, collateralAmountToGetBack);
        emit WithdrawTo(perpetualDEXIndex, address(collateral), to, amount, collateralAmountToGetBack);
    }

    /// @notice Redeem USDL and withdraw collateral like WETH, WBTC, etc specifying the exact amount of collateral
    /// @param to Receipent of withdrawn collateral
    /// @param collateralAmount Amount of collateral to withdraw
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be closed
    /// @param maxUSDLToBurn Max USDL to burn in the process
    /// @param collateral Collateral to be used to redeem USDL
    function withdrawToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 maxUSDLToBurn,
        IERC20Upgradeable collateral
    ) external nonReentrant {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        uint256 collateralBefore = collateral.balanceOf(address(this));
        uint256 USDLToBurn = perpDEXWrapper.closeWExactCollateral(collateralAmount);
        uint256 collateralAmountToGetBack = collateral.balanceOf(address(this)) - collateralBefore;
        require(USDLToBurn <= maxUSDLToBurn, "USDL burnt execeeds maximum");
        _burn(_msgSender(), USDLToBurn);
        SafeERC20Upgradeable.safeTransfer(collateral, to, collateralAmountToGetBack);
        emit WithdrawTo(perpetualDEXIndex, address(collateral), to, USDLToBurn, collateralAmountToGetBack);
    }

    /// @notice Deposit collateral like WETH, WBTC, etc. to mint USDL
    /// @param amount Amount of USDL to mint
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be opened
    /// @param maxCollateralAmountRequired Maximum amount of collateral to be used to mint given USDL
    /// @param collateral Collateral to be used to mint USDL
    function deposit(
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 maxCollateralAmountRequired,
        IERC20Upgradeable collateral
    ) external {
        depositTo(_msgSender(), amount, perpetualDEXIndex, maxCollateralAmountRequired, collateral);
    }

    /// @notice Redeem USDL and withdraw collateral like WETH, WBTC, etc
    /// @param amount Amount of USDL to redeem
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be closed
    /// @param minCollateralAmountToGetBack Minimum amount of collateral to get back on redeeming given USDL
    /// @param collateral Collateral to be used to redeem USDL
    function withdraw(
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 minCollateralAmountToGetBack,
        IERC20Upgradeable collateral
    ) external {
        withdrawTo(_msgSender(), amount, perpetualDEXIndex, minCollateralAmountToGetBack, collateral);
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
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        require(perpDEXWrapper.reBalance(_msgSender(), amount, data), "rebalance not done");
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
            //burnFrom staking contract first
            if (amountBurntFromStakingContract > 0) {
                _burnFrom(stakingContractAddress, amountBurntFromStakingContract);
            }
            //burn remaining from lemma treasury (if any)
            if (amountBurntFromLemmaTreasury > 0) {
                _burnFrom(lemmaTreasury, amountBurntFromLemmaTreasury);
            }
        }

        emit Rebalance(perpetualDEXIndex, address(collateral), amount);
    }

    /**
     * @dev This is a slightly different implementation of _burnFrom then usually seen.
     * Destroys `amount` tokens from `account`, deducting from this contract's
     * allowance.(instead of _msgSender()'s)
     *
     * Requirements:
     *
     * - this contract must have allowance for ``accounts``'s tokens of at least
     * `amount`.
     */
    function _burnFrom(address account, uint256 amount) internal {
        uint256 currentAllowance = allowance(account, address(this));
        require(currentAllowance >= amount, "ERC20: burn amount exceeds allowance");
        unchecked {
            _approve(account, address(this), currentAllowance - amount);
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
}
