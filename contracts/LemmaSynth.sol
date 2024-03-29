// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

import { IERC20Decimals, IERC20Upgradeable } from "./interfaces/IERC20Decimals.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import { IPerpetualMixDEXWrapper } from "./interfaces/IPerpetualMixDEXWrapper.sol";

/// @author Lemma Finance
/// @notice Lemma synthetic tokens are ERC20s backed by spot assets and/or long perpetual positions with no leverage.
/// For example, a synthetic ETH (ETH*) could be backed by a long ETH/USD perpetual futures position and/or spot ETH.
contract LemmaSynth is
    ReentrancyGuardUpgradeable,
    ERC20PermitUpgradeable,
    ERC2771ContextUpgradeable,
    AccessControlUpgradeable
{
    /// Different Roles to perform restricted tx
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant LEMMA_SWAP = keccak256("LEMMA_SWAP");
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    /// PerpLemma contract associated with this LemmaSynth
    address public perpLemma;
    mapping(uint256 => mapping(address => address)) public perpetualDEXWrappers;
    mapping(address => bool) public isSupportedPerpetualDEXWrapper;

    address public xSynth;

    /// Tail Collateral use to mint LemmaSynth
    /// Tail Collateral will not deposit into perp, It will stay in perpLemma BalanceSheet
    address public tailCollateral;
    /// SettlementToken PerpCollateral to open long position
    address public usdc;
    /// Lemma Fees
    uint256 public fees;
    /// interactionBlock will restict multiple txs in same block
    bytes32 public interactionBlock;

    // Events
    event DepositTo(
        address indexed perpLemma,
        address indexed collateral,
        address indexed to,
        uint256 amount,
        uint256 collateralRequired
    );
    event WithdrawTo(
        address indexed perpLemma,
        address indexed collateral,
        address indexed to,
        uint256 amount,
        uint256 collateralGotBack
    );
    event FeesUpdated(uint256 indexed newFees);
    event PerpetualDexWrapperAdded(uint256 indexed dexIndex, address indexed collateral, address indexed dexWrapper);
    event SetTailCollateral(address indexed tailCollateral);

    /// @notice onlyOneFunInSameTx will restrict to call multiple functions of LemmaSynth contract in same tx
    /// Only role with LEMMA_SWAP can call the multiple functions in same tx
    modifier onlyOneFunInSameTx() {
        if (!hasRole(LEMMA_SWAP, msg.sender)) {
            bytes32 _interactionBlock = keccak256(abi.encodePacked(tx.origin, block.number));
            require(_interactionBlock != interactionBlock, "only lemmaswap is allowed");
            interactionBlock = _interactionBlock;
        }
        _;
    }

    /// @notice onlyPerpDEXWrapper checks that perpLemmaDex is supported to this contract,
    /// Otherwise it will revert
    modifier onlyPerpDEXWrapper() {
        require(isSupportedPerpetualDEXWrapper[_msgSender()], "Only a PerpDEXWrapper can call this");
        _;
    }

    /// @notice Intialize method only called once while deploying contract
    /// It will setup different roles and give role access to specific addreeses
    /// @param _trustedForwarder address
    /// @param _tailCollateral which collateral address is use to mint LemmaSynth
    /// @param _perpLemma PerpLemma contract associated with this LemmaSynth
    /// @param _name LemmaSynth Token name
    /// @param _symbol erc20 LemmaSynth Token symbol
    function initialize(
        address _trustedForwarder,
        address _perpLemma,
        address _usdc,
        address _tailCollateral,
        string memory _name,
        string memory _symbol
    ) external initializer {
        __ReentrancyGuard_init();
        __ERC20_init(_name, _symbol);
        __ERC20Permit_init(_name);
        __ERC2771Context_init(_trustedForwarder);

        __AccessControl_init();
        _setRoleAdmin(LEMMA_SWAP, ADMIN_ROLE);
        _setRoleAdmin(OWNER_ROLE, ADMIN_ROLE);
        _setupRole(ADMIN_ROLE, msg.sender);
        grantRole(OWNER_ROLE, msg.sender);

        usdc = _usdc;
        tailCollateral = _tailCollateral;
        addPerpetualDEXWrapper(0, _usdc, _perpLemma);
    }

    /// @notice Add address for perpetual dex wrapper for perpetual index and collateral - can only be called by owner
    /// @param perpetualDEXIndex, index of perpetual dex
    /// @param collateralAddress, address of collateral to be used in the dex
    /// @param perpetualDEXWrapperAddress, address of perpetual dex wrapper
    function addPerpetualDEXWrapper(
        uint256 perpetualDEXIndex,
        address collateralAddress,
        address perpetualDEXWrapperAddress
    ) public onlyRole(OWNER_ROLE) {
        perpetualDEXWrappers[perpetualDEXIndex][collateralAddress] = perpetualDEXWrapperAddress;
        isSupportedPerpetualDEXWrapper[perpetualDEXWrapperAddress] = true;
        emit PerpetualDexWrapperAdded(perpetualDEXIndex, collateralAddress, perpetualDEXWrapperAddress);
    }

    /// @notice Returns the fees of the underlying Perp DEX Wrapper
    /// @param dexIndex The DEX Index to operate on
    /// @param collateral Collateral for the minting / redeeming operation
    function getFees(uint256 dexIndex, address collateral) external view returns (uint256) {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpetualDEXWrappers[dexIndex][collateral]);
        require(address(perpDEXWrapper) != address(0), "DEX Wrapper should not ZERO address");
        return perpDEXWrapper.getFees();
    }

    /// @notice Returns the Index Price
    function getIndexPrice(uint256 dexIndex, address collateral) external view returns (uint256) {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpetualDEXWrappers[dexIndex][collateral]);
        require(address(perpDEXWrapper) != address(0), "DEX Wrapper should not ZERO address");
        return perpDEXWrapper.getIndexPrice();
    }

    /// @notice Returns the total position in quote Token on a given DEX
    /// @param dexIndex The DEX Index to operate on
    /// @param collateral Collateral for the minting / redeeming operation
    function getTotalPosition(uint256 dexIndex, address collateral) external view returns (int256) {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpetualDEXWrappers[dexIndex][collateral]);
        require(address(perpDEXWrapper) != address(0), "DEX Wrapper should not ZERO address");
        return perpDEXWrapper.getTotalPosition();
    }

    /// @notice changeAdmin is to change address of admin role
    /// Only current admin can change admin and after new admin current admin address will be no more admin
    /// @param newAdmin new admin address
    function changeAdmin(address newAdmin) external onlyRole(ADMIN_ROLE) {
        require(newAdmin != address(0), "NewAdmin should not ZERO address");
        require(newAdmin != msg.sender, "Admin Addresses should not be same");
        _setupRole(ADMIN_ROLE, newAdmin);
        renounceRole(ADMIN_ROLE, msg.sender);
    }

    /// @notice setXSynth will set xLemmSynth contract address by owner role address
    /// for e.g. if LemmaSynthWETH => XLemmaSynthWETH, LemmaSynthWBTC => XLemmaSynthWBTC
    /// @param _xSynth contract address
    function setXSynth(address _xSynth) external onlyRole(OWNER_ROLE) {
        xSynth = _xSynth;
    }

    /// @notice setTailCollateral set tail collateral, By only owner Role
    /// @param _tailCollateral which collateral address is use to mint LemmaSynth
    function setTailCollateral(address _tailCollateral) external onlyRole(OWNER_ROLE) {
        tailCollateral = _tailCollateral;
        emit SetTailCollateral(_tailCollateral);
    }

    /// @notice Set Fees, can only be called by owner
    /// @param _fees Fees taken by the Lemma protocol
    function setFees(uint256 _fees) external onlyRole(OWNER_ROLE) {
        fees = _fees;
        emit FeesUpdated(fees);
    }

    /// @notice mintToStackingContract will be call by perpLemma while distributingFR
    /// If the FR will be in profit, so lemmaSynth mint new synth and deposit to xSynth contract,
    /// To incentive all users
    function mintToStackingContract(uint256 amount) external onlyPerpDEXWrapper {
        _mint(xSynth, amount);
    }

    /// @notice burnToStackingContract will be call by perpLemma while distributingFR
    /// If the FR will not be in profit, so lemmaSynth burn synth from xSynth contract,
    function burnToStackingContract(uint256 amount) external onlyPerpDEXWrapper {
        _burn(xSynth, amount);
    }

    /// @notice Deposit collateral like USDC. to mint Synth specifying the exact amount of Synth
    /// @param to Receipent of minted Synth
    /// @param amount Amount of Synth to mint
    /// @param maxCollateralAmountRequired Maximum amount of collateral to be used to mint given Synth
    /// @param collateral Collateral to be used to mint Synth
    function depositTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 maxCollateralAmountRequired,
        IERC20Upgradeable collateral
    ) external nonReentrant onlyOneFunInSameTx {
        // first trade and then deposit
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        uint256 _collateralRequired;
        if (address(collateral) == usdc) {
            (, uint256 _collateralRequired_1e18) = perpDEXWrapper.openLongWithExactBase(amount);
            _collateralRequired = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
                _collateralRequired_1e18,
                address(collateral),
                false
            );
            require(_collateralRequired_1e18 <= maxCollateralAmountRequired, "collateral required execeeds maximum");
        } else {
            _collateralRequired = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
                amount,
                address(collateral),
                false
            );
        }
        perpDEXWrapper.calculateMintingAsset(amount, IPerpetualMixDEXWrapper.Basis.IsSynth, false);
        _perpDeposit(perpDEXWrapper, address(collateral), _collateralRequired);
        _mint(to, amount);
        emit DepositTo(address(perpDEXWrapper), address(collateral), to, amount, _collateralRequired);
    }

    /// @notice Deposit collateral like USDC to mint Synth specifying the exact amount of collateral
    /// @param to Receipent of minted Synth
    /// @param collateralAmount Amount of collateral to deposit in the collateral decimal format
    /// @param minSynthToMint Minimum Synth to mint
    /// @param collateral Collateral to be used to mint Synth
    /// @dev The minted amount depends on the Real Perp Mark Price
    /// @dev In the specific case of PerpV2, since it is implemented as an UniV3 Pool and opening a position means running a swap on it, slippage has also to be taken into account
    function depositToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 minSynthToMint,
        IERC20Upgradeable collateral // if eth/btc instead usdc then what collateralAmount
    ) external nonReentrant onlyOneFunInSameTx {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        uint256 _collateralRequired = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
            collateralAmount,
            address(collateral),
            false
        );
        _perpDeposit(perpDEXWrapper, address(collateral), _collateralRequired);
        uint256 _lemmaSynthToMint;
        if (address(collateral) == usdc) {
            (_lemmaSynthToMint, ) = perpDEXWrapper.openLongWithExactQuote(collateralAmount);
            require(_lemmaSynthToMint >= minSynthToMint, "Synth minted too low");
        } else {
            _lemmaSynthToMint = collateralAmount;
        }
        perpDEXWrapper.calculateMintingAsset(_lemmaSynthToMint, IPerpetualMixDEXWrapper.Basis.IsSynth, false);
        _mint(to, _lemmaSynthToMint);
        emit DepositTo(address(perpDEXWrapper), address(collateral), to, _lemmaSynthToMint, _collateralRequired);
    }

    /// @notice Redeem Synth and withdraw collateral USDC specifying the exact amount of Synth
    /// @param to Receipent of withdrawn collateral
    /// @param amount Amount of Synth to redeem
    /// @param minCollateralAmountToGetBack Minimum amount of collateral to get back on redeeming given Synth
    /// @param collateral Collateral to be used to redeem Synth
    function withdrawTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 minCollateralAmountToGetBack,
        IERC20Upgradeable collateral
    ) external nonReentrant onlyOneFunInSameTx {
        _burn(_msgSender(), amount);
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");

        bool hasSettled = perpDEXWrapper.hasSettled();
        /// NOTE:- hasSettled Error: PerpLemma is settled. so call withdrawToWExactCollateral method to settle your collateral using exact synth
        require(!hasSettled, "hasSettled Error");
        uint256 _collateralAmountToWithdraw;
        if (address(collateral) == usdc) {
            (, uint256 _collateralAmountToWithdraw1e_18) = perpDEXWrapper.closeLongWithExactBase(amount);
            _collateralAmountToWithdraw = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
                _collateralAmountToWithdraw1e_18,
                address(collateral),
                false
            );
            require(_collateralAmountToWithdraw1e_18 >= minCollateralAmountToGetBack, "Collateral to get back too low");
        } else {
            _collateralAmountToWithdraw = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
                amount,
                address(collateral),
                false
            );
        }
        perpDEXWrapper.calculateMintingAsset(amount, IPerpetualMixDEXWrapper.Basis.IsSynth, true);
        _perpWithdraw(to, perpDEXWrapper, address(collateral), _collateralAmountToWithdraw);
        emit WithdrawTo(address(perpDEXWrapper), address(collateral), to, amount, _collateralAmountToWithdraw);
    }

    /// @notice Redeem Synth and withdraw collateral like USDC specifying the exact amount of usdccollateral
    /// @param to Receipent of withdrawn collateral
    /// @param collateralAmount Amount of collateral to withdraw
    /// @param maxSynthToBurn Max Synth to burn in the process
    /// @param collateral Collateral to be used to redeem Synth
    function withdrawToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 maxSynthToBurn,
        IERC20Upgradeable collateral
    ) external nonReentrant onlyOneFunInSameTx {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        bool hasSettled = perpDEXWrapper.hasSettled();
        if (hasSettled) {
            perpDEXWrapper.getCollateralBackAfterSettlement(collateralAmount, to, false);
            return;
        } else {
            uint256 _lemmaSynthToBurn;
            if (address(collateral) == usdc) {
                (_lemmaSynthToBurn, ) = perpDEXWrapper.closeLongWithExactQuote(collateralAmount);
                require(_lemmaSynthToBurn <= maxSynthToBurn, "Too much Synth to burn");
            } else {
                _lemmaSynthToBurn = collateralAmount;
            }
            uint256 _collateralAmountToWithdraw = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
                collateralAmount,
                address(collateral),
                false
            );
            _perpWithdraw(to, perpDEXWrapper, address(collateral), _collateralAmountToWithdraw);
            perpDEXWrapper.calculateMintingAsset(_lemmaSynthToBurn, IPerpetualMixDEXWrapper.Basis.IsSynth, true);
            _burn(_msgSender(), _lemmaSynthToBurn);
            emit WithdrawTo(
                address(perpDEXWrapper),
                address(collateral),
                to,
                _lemmaSynthToBurn,
                _collateralAmountToWithdraw
            );
        }
    }

    ////////////////////////
    /// INTERNAL METHODS ///
    ////////////////////////

    /// @notice _perpDeposit to deposit collateral into perp Vault
    function _perpDeposit(
        IPerpetualMixDEXWrapper perpDEXWrapper,
        address collateral,
        uint256 amount
    ) internal {
        SafeERC20Upgradeable.safeTransferFrom(
            IERC20Upgradeable(collateral),
            _msgSender(),
            address(perpDEXWrapper),
            amount
        );
        perpDEXWrapper.deposit(amount, collateral);
    }

    /// @notice _perpWithdraw to withdraw collateral from perp Vault
    function _perpWithdraw(
        address to,
        IPerpetualMixDEXWrapper perpDEXWrapper,
        address collateral,
        uint256 amount
    ) internal {
        perpDEXWrapper.withdraw(amount, collateral);
        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(collateral), address(perpDEXWrapper), to, amount);
    }

    /// @notice Below we are not taking advantage of ERC2771ContextUpgradeable even though we should be able to
    function _msgSender()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        return msg.sender;
    }

    /// @notice Below we are not taking advantage of ERC2771ContextUpgradeable even though we should be able to
    function _msgData()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata)
    {
        return msg.data;
    }
}
