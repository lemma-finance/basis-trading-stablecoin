pragma solidity =0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import { OwnableUpgradeable, ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { Utils } from "./libraries/Utils.sol";
import { SafeMathExt } from "./libraries/SafeMathExt.sol";
import { IPerpetualMixDEXWrapper } from "./interfaces/IPerpetualMixDEXWrapper.sol";
import "forge-std/Test.sol";

/// @author Lemma Finance
contract LemmaSynth is 
    ReentrancyGuardUpgradeable, 
    ERC20PermitUpgradeable, 
    OwnableUpgradeable, 
    ERC2771ContextUpgradeable,
    AccessControlUpgradeable {
    using SafeCastUpgradeable for int256;
    using SafeMathExt for int256;
    using SafeMathExt for uint256;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant LEMMA_SWAP = keccak256("LEMMA_SWAP");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");

    address public perpLemma;
    uint256 public fees;
    bytes32 public interactionBlock;

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
    event FeesUpdated(uint256 newFees);
    event PerpetualDexWrapperUpdated(address indexed perpLemma);

    modifier onlyOneFunInSameTx() {
        if (!hasRole(LEMMA_SWAP, msg.sender)) {
            bytes32 _interactionBlock = keccak256(abi.encodePacked(tx.origin, block.number));
            require(_interactionBlock != interactionBlock, "only lemmaswap is allowed");
            interactionBlock = _interactionBlock;
        }
        _;
    }

    function initialize(
        address trustedForwarder,
        address _perpLemma,
        string memory _name,
        string memory _symbol
    ) external initializer {
        __ReentrancyGuard_init();
        __Ownable_init();
        __ERC20_init(_name, _symbol);
        __ERC20Permit_init(_name);
        __ERC2771Context_init(trustedForwarder);

        __AccessControl_init();
        _setRoleAdmin(LEMMA_SWAP, ADMIN_ROLE);
        _setRoleAdmin(USDC_TREASURY, ADMIN_ROLE);
        _setupRole(ADMIN_ROLE, msg.sender);

        updatePerpetualDEXWrapper(_perpLemma);
    }

    /// @notice Returns the fees of the underlying Perp DEX Wrapper
    function getFees() external view returns (uint256) {
        // NOTE: Removed prev arg address baseTokenAddress
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpLemma);
        require(address(perpDEXWrapper) != address(0), "DEX Wrapper should not ZERO address");
        return perpDEXWrapper.getFees();
    }

    function getIndexPrice() external view returns (uint256) {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpLemma);
        require(address(perpDEXWrapper) != address(0), "DEX Wrapper should not ZERO address");
        return perpDEXWrapper.getIndexPrice();
    }

    /// @notice Returns the total position in quote Token on a given DEX
    /// @param dexIndex The DEX Index to operate on
    /// @param collateral Collateral for the minting / redeeming operation
    function getTotalPosition(
        uint256 dexIndex,
        address collateral
    ) external view returns (int256) {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpLemma);
        require(address(perpDEXWrapper) != address(0), "DEX Wrapper should not ZERO address");
        return perpDEXWrapper.getTotalPosition();
    }
    
    /// @notice Set Fees, can only be called by owner
    /// @param _fees Fees taken by the protocol
    function setFees(uint256 _fees) external onlyOwner {
        fees = _fees;
        emit FeesUpdated(fees);
    }

    /// @notice Add address for perpetual dex wrapper for perpetual index and collateral - can only be called by owner
    function updatePerpetualDEXWrapper(
        address _perpLemma
    ) public onlyOwner {
        perpLemma = _perpLemma;
        emit PerpetualDexWrapperUpdated(_perpLemma);
    }

    function _perpDeposit(IPerpetualMixDEXWrapper perpDEXWrapper, address collateral, uint256 amount) internal {
        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(collateral), _msgSender(), address(perpDEXWrapper), amount);
        perpDEXWrapper.deposit(amount, collateral, IPerpetualMixDEXWrapper.Basis.IsSynth);
    }

    function _perpWithdraw(address to, IPerpetualMixDEXWrapper perpDEXWrapper, address collateral, uint256 amount) internal {
        perpDEXWrapper.withdraw(amount, collateral, IPerpetualMixDEXWrapper.Basis.IsSynth);
        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(collateral), address(perpDEXWrapper), to, amount);
    }

    /// @notice Deposit collateral like USDC. to mint Synth specifying the exact amount of Synth
    /// @param to Receipent of minted Synth
    /// @param amount Amount of Synth to mint
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be opened
    /// @param maxCollateralAmountRequired Maximum amount of collateral to be used to mint given Synth
    /// @param collateral Collateral to be used to mint Synth
    function depositTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 maxCollateralAmountRequired,
        IERC20Upgradeable collateral
    ) public nonReentrant onlyOneFunInSameTx {
        // first trade and then deposit
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpLemma);
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        (, uint256 _collateralRequired_1e18) = perpDEXWrapper.openLongWithExactBase(
            amount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsSynth
        ); 
        uint256 _collateralRequired = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(_collateralRequired_1e18, address(collateral), false);
        require(_collateralRequired_1e18 <= maxCollateralAmountRequired, "collateral required execeeds maximum");
        _perpDeposit(perpDEXWrapper, address(collateral), _collateralRequired);
        _mint(to, amount);
        emit DepositTo(perpetualDEXIndex, address(collateral), to, amount, _collateralRequired);
    }

    /// @notice Deposit collateral like USDC. to mint Synth specifying the exact amount of collateral
    /// @param to Receipent of minted Synth
    /// @param collateralAmount Amount of collateral to deposit in the collateral decimal format
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be opened
    /// @param minSynthToMint Minimum Synth to mint
    /// @param collateral Collateral to be used to mint Synth
    function depositToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 minSynthToMint,
        IERC20Upgradeable collateral
    ) external nonReentrant onlyOneFunInSameTx {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpLemma);
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        uint256 _collateralRequired = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(collateralAmount, address(collateral), false);
        _perpDeposit(perpDEXWrapper, address(collateral), _collateralRequired);
        (uint256 _lemmaSynthToMint, ) = perpDEXWrapper.openLongWithExactQuote(collateralAmount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsSynth);
        require(_lemmaSynthToMint >= minSynthToMint, "Synth minted too low");
        _mint(to, _lemmaSynthToMint);
        emit DepositTo(perpetualDEXIndex, address(collateral), to, _lemmaSynthToMint, _collateralRequired);        
    }

    /// @notice Redeem Synth and withdraw collateral USDC specifying the exact amount of Synth
    /// @param to Receipent of withdrawn collateral
    /// @param amount Amount of Synth to redeem
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be closed
    /// @param minCollateralAmountToGetBack Minimum amount of collateral to get back on redeeming given Synth
    /// @param collateral Collateral to be used to redeem Synth
    function withdrawTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 minCollateralAmountToGetBack,
        IERC20Upgradeable collateral
    ) public nonReentrant onlyOneFunInSameTx {
        _burn(_msgSender(), amount);
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpLemma);
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        
        bool hasSettled = perpDEXWrapper.hasSettled();
        /// NOTE:- hasSettled Error: PerpLemma is settled. so call withdrawToWExactCollateral method to settle your collateral using exact synth
        require(!hasSettled, "hasSettled Error");

        (, uint256 _collateralAmountToWithdraw1e_18) = perpDEXWrapper.closeLongWithExactBase(amount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsSynth); 
        uint256 _collateralAmountToWithdraw = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
            _collateralAmountToWithdraw1e_18,
            address(collateral),
            false
        );
        require(_collateralAmountToWithdraw1e_18 >= minCollateralAmountToGetBack, "Collateral to get back too low");
        _perpWithdraw(to, perpDEXWrapper, address(collateral), _collateralAmountToWithdraw);
        emit WithdrawTo(perpetualDEXIndex, address(collateral), to, amount, _collateralAmountToWithdraw);
    }

    /// @notice Redeem Synth and withdraw collateral like USDC specifying the exact amount of usdccollateral 
    /// @param to Receipent of withdrawn collateral
    /// @param collateralAmount Amount of collateral to withdraw
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be closed
    /// @param maxSynthToBurn Max Synth to burn in the process
    /// @param collateral Collateral to be used to redeem Synth
    function withdrawToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 maxSynthToBurn,
        IERC20Upgradeable collateral
    ) external nonReentrant onlyOneFunInSameTx {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpLemma);
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        bool hasSettled = perpDEXWrapper.hasSettled();
        uint256 _lemmaSynthToBurn;
        if (hasSettled) {
            perpDEXWrapper.getCollateralBackAfterSettlement(collateralAmount, to, false);
            return;
        } else {
            (uint256 _lemmaSynthToBurn,) = perpDEXWrapper.closeLongWithExactQuote(collateralAmount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsSynth); 
            require(_lemmaSynthToBurn <= maxSynthToBurn, "Too much Synth to burn");
            uint256 _collateralAmountToWithdraw = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(collateralAmount, address(collateral), false);
            _perpWithdraw(to, perpDEXWrapper, address(collateral), _collateralAmountToWithdraw);
            _burn(_msgSender(), _lemmaSynthToBurn);
            emit WithdrawTo(perpetualDEXIndex, address(collateral), to, _lemmaSynthToBurn, _collateralAmountToWithdraw);
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
