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
import { IEIP4626 } from "./interfaces/eip4626/IEIP4626.sol";
import "hardhat/console.sol";

/// @author Lemma Finance
contract LemmaETH is ReentrancyGuardUpgradeable, ERC20PermitUpgradeable, OwnableUpgradeable, ERC2771ContextUpgradeable {
    using SafeCastUpgradeable for int256;
    using SafeMathExt for int256;
    using SafeMathExt for uint256;

    address public lemmaTreasury;
    address public stakingContractAddress;
    uint256 public fees;

    mapping(uint256 => mapping(address => address)) public perpetualDEXWrappers;

    mapping(address => bool) private whiteListAddress;

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
        __ERC20_init("LemmaETH", "ETHL");
        __ERC20Permit_init("LemmaETH");
        __ERC2771Context_init(trustedForwarder);
        addPerpetualDEXWrapper(0, collateralAddress, perpetualDEXWrapperAddress);
    }

    /// @notice Returns the fees of the underlying Perp DEX Wrapper
    /// @param dexIndex The DEX Index to operate on
    /// @param collateral Collateral for the minting / redeeming operation
    function getFees(uint256 dexIndex, address collateral) external view returns (uint256) {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(perpetualDEXWrappers[dexIndex][collateral]);
        require(address(perpDEXWrapper) != address(0), "! DEX Wrapper");
        return perpDEXWrapper.getFees();
    }

    /// @notice Returns the total position in quote Token on a given DEX
    /// @param dexIndex The DEX Index to operate on
    /// @param collateral Collateral for the minting / redeeming operation
    function getTotalPosition(uint256 dexIndex, address collateral) external view returns (int256) {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(perpetualDEXWrappers[dexIndex][collateral]);

        require(address(perpDEXWrapper) != address(0), "! DEX Wrapper");
        return perpDEXWrapper.getTotalPosition();
    }

    /// @notice Set whitelist address, can only be called by owner, It will helps whitelist address to call multiple function of ETHL at a time
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
        _approve(address(this), stakingContractAddress, type(uint256).max);
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
        emit PerpetualDexWrapperAdded(perpetualDEXIndex, collateralAddress, perpetualDEXWrapperAddress);
    }

    /// @notice Mint ETHL and Deposit collateral like USDC by specifying the exact amount of ethAmount
    /// @param to Receipent of minted ETHL
    /// @param ethAmount Amount of ETH need ETHL to mint
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be opened
    /// @param maxUSDCCollateralAmountRequired Maximum amount of USDC collateral nned to deposit to mint given ETHL
    /// @param collateral Collateral(in our case USDC) to be used to mint ETHL
    function depositTo(
        address to,
        uint256 ethAmount,
        uint256 perpetualDEXIndex,
        uint256 maxUSDCCollateralAmountRequired,
        IERC20Upgradeable collateral
    ) public nonReentrant {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");

        uint256 usdcCollateralRequired1e_18 = perpDEXWrapper.getCollateralAmountGivenUnderlyingAssetAmount(
            ethAmount,
            true
        );
        require(usdcCollateralRequired1e_18 <= maxUSDCCollateralAmountRequired, "collateral required execeeds maximum");

        uint256 usdcCollateralRequired = perpDEXWrapper.getAmountInCollateralDecimals(
            usdcCollateralRequired1e_18,
            true
        );
        SafeERC20Upgradeable.safeTransferFrom(
            collateral,
            _msgSender(),
            address(perpDEXWrapper),
            usdcCollateralRequired
        );

        perpDEXWrapper.open(0, usdcCollateralRequired1e_18);

        _mint(address(this), ethAmount);
        IEIP4626(stakingContractAddress).deposit(ethAmount, to);

        emit DepositTo(perpetualDEXIndex, address(collateral), to, ethAmount, usdcCollateralRequired);
    }

    /// @notice Deposit collateral like USDC. to mint ETHL specifying the exact amount of USDC collateral
    /// @param to Receipent of minted ETHL
    /// @param collateralAmount Amount of collateral USDC to deposit
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be opened
    /// @param minETHLToMint Minimum ETHL to mint
    /// @param collateral Collateral to be used to mint ETHL
    function depositToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 minETHLToMint,
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

        uint256 ETHLToMint = perpDEXWrapper.openWExactCollateral(collateralAmount);
        require(ETHLToMint >= minETHLToMint, "ETHL minted too low");

        _mint(address(this), ETHLToMint);
        IEIP4626(stakingContractAddress).deposit(ETHLToMint, to);

        emit DepositTo(perpetualDEXIndex, address(collateral), to, ETHLToMint, collateralAmountToDeposit);
    }

    /// @notice Redeem ETHL and withdraw collateral like USDC. specifying the exact amount of ethAmount
    /// @param to Receipent of withdrawn collateral
    /// @param ethAmount Amount of ETHL to redeem
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be closed
    /// @param minUsdcCollateralAmountToGetBack Minimum amount of collateral to get back on redeeming given ETHL
    /// @param collateral Collateral to be used to redeem ETHL
    function withdrawTo(
        address to,
        uint256 ethAmount,
        uint256 perpetualDEXIndex,
        uint256 minUsdcCollateralAmountToGetBack,
        IERC20Upgradeable collateral
    ) public nonReentrant {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );

        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        uint256 collateralAmountToGetBack1e_18 = perpDEXWrapper.getCollateralAmountGivenUnderlyingAssetAmount(
            ethAmount,
            false
        );
        require(collateralAmountToGetBack1e_18 >= minUsdcCollateralAmountToGetBack, "collateral got back is too low");

        uint256 shares = IEIP4626(stakingContractAddress).previewWithdraw(ethAmount);
        SafeERC20Upgradeable.safeTransferFrom(
            IERC20Upgradeable(stakingContractAddress),
            _msgSender(),
            address(this),
            shares
        );

        IEIP4626(stakingContractAddress).withdraw(ethAmount, address(this), address(this));
        _burn(address(this), ethAmount);

        perpDEXWrapper.close(0, collateralAmountToGetBack1e_18);

        uint256 collateralAmountToGetBack = perpDEXWrapper.getAmountInCollateralDecimals(
            collateralAmountToGetBack1e_18,
            false
        );
        SafeERC20Upgradeable.safeTransfer(collateral, to, collateralAmountToGetBack);

        emit WithdrawTo(perpetualDEXIndex, address(collateral), to, ethAmount, collateralAmountToGetBack);
    }

    /// @notice Redeem ETHL and withdraw collateral like USDC. specifying the exact amount of USDC collateral
    /// @param to Receipent of withdrawn collateral
    /// @param collateralAmount Amount of collateral to withdraw
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be closed
    /// @param maxETHLToBurn Max ETHL to burn in the process
    /// @param collateral Collateral to be used to redeem ETHL
    function withdrawToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 maxETHLToBurn,
        IERC20Upgradeable collateral
    ) external nonReentrant {
        IPerpetualDEXWrapper perpDEXWrapper = IPerpetualDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );

        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");

        uint256 ETHLToBurn = perpDEXWrapper.closeWExactCollateral(collateralAmount);
        require(ETHLToBurn <= maxETHLToBurn, "ETHL burnt exceeds maximum");

        uint256 shares = IEIP4626(stakingContractAddress).previewWithdraw(ETHLToBurn);
        SafeERC20Upgradeable.safeTransferFrom(
            IERC20Upgradeable(stakingContractAddress),
            _msgSender(),
            address(this),
            shares
        );

        IEIP4626(stakingContractAddress).withdraw(ETHLToBurn, address(this), address(this));
        _burn(address(this), ETHLToBurn);

        collateralAmount = perpDEXWrapper.getAmountInCollateralDecimals(collateralAmount, false);
        SafeERC20Upgradeable.safeTransfer(collateral, to, collateralAmount);

        emit WithdrawTo(perpetualDEXIndex, address(collateral), to, ETHLToBurn, collateralAmount);
    }

    /// @notice Mint ETHL and Deposit collateral like USDC by specifying the exact amount of ethAmount
    /// @param ethAmount Amount of ETH need ETHL to mint
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be opened
    /// @param maxUSDCCollateralAmountRequired Maximum amount of USDC collateral nned to deposit to mint given ETHL
    /// @param collateral Collateral(in our case USDC) to be used to mint ETHL
    function deposit(
        uint256 ethAmount,
        uint256 perpetualDEXIndex,
        uint256 maxUSDCCollateralAmountRequired,
        IERC20Upgradeable collateral
    ) external {
        depositTo(_msgSender(), ethAmount, perpetualDEXIndex, maxUSDCCollateralAmountRequired, collateral);
    }

    /// @notice Redeem ETHL and withdraw collateral like USDC. specifying the exact amount of ethAmount
    /// @param ethAmount Amount of ETHL to redeem
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be closed
    /// @param minUsdcCollateralAmountToGetBack Minimum amount of collateral to get back on redeeming given ETHL
    /// @param collateral Collateral to be used to redeem ETHL
    function withdraw(
        uint256 ethAmount,
        uint256 perpetualDEXIndex,
        uint256 minUsdcCollateralAmountToGetBack,
        IERC20Upgradeable collateral
    ) external {
        withdrawTo(_msgSender(), ethAmount, perpetualDEXIndex, minUsdcCollateralAmountToGetBack, collateral);
    }

    /// @notice Rebalance position on a dex to reinvest if funding rate positive and burn ETHL if funding rate negative
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be rebalanced
    /// @param collateral Collateral to be used to rebalance position
    /// @param amount amount of ETHL to burn or mint
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
