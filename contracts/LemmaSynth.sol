pragma solidity =0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import { ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
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
/// @notice LemmaSynth contract is use to mint or burn LemmaSynth Coin
/// When user deposits collateral to mint LemmaSynth. 
/// It will transfer to Derivative dex to open a long position with no-leverage and mint stablecoin called LemmaSynth.
contract LemmaSynth is ReentrancyGuardUpgradeable, ERC20PermitUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable {
    using SafeCastUpgradeable for int256;
    using SafeMathExt for int256;
    using SafeMathExt for uint256;

    /// Different Roles to perform restricted tx 
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant LEMMA_SWAP = keccak256("LEMMA_SWAP");
    bytes32 public constant ONLY_OWNER = keccak256("ONLY_OWNER");

    /// PerpLemma contract associated with this LemmaSynth
    address public perpLemma;
    /// Tail Collateral use to mint LemmaSynth
    /// Tail Collateral will not deposit into perp, It will stay in perpLemma BalanceSheet
    address public tailCollateral;
    /// Fees taken by the protocol
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
    event PerpetualDexWrapperUpdated(address indexed perpLemma);
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
        _setRoleAdmin(ONLY_OWNER, ADMIN_ROLE);
        _setupRole(ADMIN_ROLE, msg.sender);
        grantRole(ONLY_OWNER, msg.sender);

        tailCollateral = _tailCollateral;
        updatePerpetualDEXWrapper(_perpLemma);
    }

    /// @notice Add address for perpetual dex wrapper for perpetual index and collateral - can only be called by owner
    /// @param _perpLemma The new PerpLemma Address
    function updatePerpetualDEXWrapper(address _perpLemma) public onlyRole(ONLY_OWNER) {
        require(_perpLemma != address(0), "Address can not be zero");
        perpLemma = _perpLemma;
        emit PerpetualDexWrapperUpdated(_perpLemma);
    }

    /// @notice setTailCollateral set tail collateral, By only owner Role
    /// @param _tailCollateral which collateral address is use to mint LemmaSynth
    function setTailCollateral(address _tailCollateral) external onlyRole(ONLY_OWNER) {
        tailCollateral = _tailCollateral;
        emit SetTailCollateral(_tailCollateral);
    }

    /// @notice Returns the fees of the underlying Perp DEX Wrapper
    function getFees() external view returns (uint256) {
        // NOTE: Removed prev arg address baseTokenAddress
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpLemma);
        require(address(perpDEXWrapper) != address(0), "DEX Wrapper should not ZERO address");
        return perpDEXWrapper.getFees();
    }

    /// @notice Returns the Index Price 
    function getIndexPrice() external view returns (uint256) {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpLemma);
        require(address(perpDEXWrapper) != address(0), "DEX Wrapper should not ZERO address");
        return perpDEXWrapper.getIndexPrice();
    }

    /// @notice Returns the total position in quote Token on a given DEX
    function getTotalPosition() external view returns (int256) {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpLemma);
        require(address(perpDEXWrapper) != address(0), "DEX Wrapper should not ZERO address");
        return perpDEXWrapper.getTotalPosition();
    }
    
    /// @notice Set Fees, can only be called by owner
    /// @param _fees Fees taken by the protocol
    function setFees(uint256 _fees) external onlyRole(ONLY_OWNER) {
        // TODO: Add a max fee in the code to guarantee users they will never be above a certain limit
        fees = _fees;
        emit FeesUpdated(fees);
    }

    /// @notice Deposit collateral like USDC. to mint Synth specifying the exact amount of Synth
    /// @param to Receipent of minted Synth
    /// @param amount Amount of Synth to mint
    /// @param maxCollateralAmountRequired Maximum amount of collateral to be used to mint given Synth
    /// @param collateral Collateral to be used to mint Synth
    function depositTo(
        address to,
        uint256 amount,
        uint256 maxCollateralAmountRequired,
        IERC20Upgradeable collateral
    ) public nonReentrant onlyOneFunInSameTx {
        // first trade and then deposit
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpLemma);
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        (, uint256 _collateralRequired_1e18) = perpDEXWrapper.openLongWithExactBase(
            amount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsSynth
        ); 

        uint256 _collateralRequired = (address(collateral) == tailCollateral) ? amount : _collateralRequired_1e18;
        _collateralRequired = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(_collateralRequired, address(collateral), false);
        if (address(collateral) != tailCollateral) {
            require(_collateralRequired_1e18 <= maxCollateralAmountRequired, "collateral required execeeds maximum");
        }
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
        uint256 _collateralAmountToWithdraw = (address(collateral) == tailCollateral) ? amount : _collateralAmountToWithdraw1e_18;
        _collateralAmountToWithdraw = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
            _collateralAmountToWithdraw,
            address(collateral),
            false
        );
        if (address(collateral) != tailCollateral) {
            require(_collateralAmountToWithdraw1e_18 >= minCollateralAmountToGetBack, "Collateral to get back too low");
        }
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
        uint256 maxSynthToBurn,
        IERC20Upgradeable collateral
    ) external nonReentrant onlyOneFunInSameTx {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(perpLemma);
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        bool hasSettled = perpDEXWrapper.hasSettled();
        if (hasSettled) {
            perpDEXWrapper.getCollateralBackAfterSettlement(collateralAmount, to, false);
            return;
        } else {
            (uint256 _lemmaSynthToBurn,) = perpDEXWrapper.closeLongWithExactQuote(collateralAmount, address(0), 0, IPerpetualMixDEXWrapper.Basis.IsSynth); 
            require(_lemmaSynthToBurn <= maxSynthToBurn, "Too much Synth to burn");
            uint256 _collateralAmountToWithdraw = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(collateralAmount, address(collateral), false);
            _perpWithdraw(to, perpDEXWrapper, address(collateral), _collateralAmountToWithdraw);
            _burn(_msgSender(), _lemmaSynthToBurn);
            emit WithdrawTo(address(perpDEXWrapper), address(collateral), to, _lemmaSynthToBurn, _collateralAmountToWithdraw);
        }
    }

    /// @notice Internal Methods 

    /// @notice _perpDeposit to deposit collateral into perp Vault
    function _perpDeposit(IPerpetualMixDEXWrapper perpDEXWrapper, address collateral, uint256 amount) internal {
        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(collateral), _msgSender(), address(perpDEXWrapper), amount);
        perpDEXWrapper.deposit(
            amount, 
            collateral, 
            // ternary operator use below line
            collateral == tailCollateral ? IPerpetualMixDEXWrapper.Basis.IsUsdl : IPerpetualMixDEXWrapper.Basis.IsSynth
        );
    }

    /// @notice _perpWithdraw to withdraw collateral from perp Vault
    function _perpWithdraw(address to, IPerpetualMixDEXWrapper perpDEXWrapper, address collateral, uint256 amount) internal {
        perpDEXWrapper.withdraw(
            amount, 
            collateral, 
            // ternary operator use below line
            collateral == tailCollateral ? IPerpetualMixDEXWrapper.Basis.IsUsdl : IPerpetualMixDEXWrapper.Basis.IsSynth
        );
        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(collateral), address(perpDEXWrapper), to, amount);
    }

    function _msgSender()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender) {
        return msg.sender;
    }

    function _msgData()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata) {
        return msg.data;
    }
}
