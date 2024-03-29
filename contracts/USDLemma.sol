// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import { IPerpetualMixDEXWrapper } from "./interfaces/IPerpetualMixDEXWrapper.sol";
import { ISettlementTokenManager } from "./interfaces/ISettlementTokenManager.sol";
import "./interfaces/IERC20Decimals.sol";
import "./interfaces/IUSDLemma.sol";
import "./interfaces/ILemmaTreasury.sol";

/// @author Lemma Finance
/// @notice USDLemma contract is used to mint or burn USDL Stablecoin
/// USDL is a stablecoin backed by a long spot and short futures position.
/// The price fluctuations of the underlying spot assets are “canceled out” by short futures positions.
/// As a result, the overall portfolio’s value is stable in USD terms.
contract USDLemma is
    ReentrancyGuardUpgradeable,
    ERC20PermitUpgradeable,
    ERC2771ContextUpgradeable,
    AccessControlUpgradeable
{
    // Different Roles to perform restricted tx
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant LEMMA_SWAP = keccak256("LEMMA_SWAP");
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    /// Lemma Treasury address
    address public lemmaTreasury;
    /// Settlement Manager contract address
    address public xUsdl;

    address public settlementTokenManager;
    /// PerpV2 Settlement Token
    address public perpSettlementToken;
    /// Lemma Fees
    uint256 public fees;
    /// interactionBlock will restict multiple txs in same block
    bytes32 public interactionBlock;

    // Mapping for Index to perpetualDexs/PerpLemma
    mapping(uint256 => mapping(address => address)) public perpetualDEXWrappers;
    mapping(address => bool) public isSupportedPerpetualDEXWrapper;
    mapping(address => bool) public isSupportedStableForMinting;

    // Events
    event DepositTo(
        uint256 indexed dexIndex,
        address indexed collateral,
        address indexed to,
        uint256 amount,
        uint256 collateralRequired
    );
    event WithdrawTo(
        uint256 indexed dexIndex,
        address indexed collateral,
        address indexed to,
        uint256 amount,
        uint256 collateralGotBack
    );
    event LemmaTreasuryUpdated(address indexed current);
    event FeesUpdated(uint256 indexed newFees);
    event PerpetualDexWrapperAdded(uint256 indexed dexIndex, address indexed collateral, address indexed dexWrapper);
    event SetSettlementTokenManager(address indexed _settlementTokenManager);

    /// @notice onlyOneFunInSameTx will restrict to call multiple functions of USDLemma contract in same tx
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
    /// @param _collateralAddress which collateral address is use to mint USDL
    /// @param _perpetualDEXWrapperAddress initial first perpLemma dex, which will use _collateralAddress for collateral
    /// @param _settlementTokenManager contract address, which will use when user mint USDL using SettlementToken
    /// @param _perpSettlementToken erc20 address of USDC(which is settlement token of USDC)
    function initialize(
        address _trustedForwarder,
        address _collateralAddress,
        address _perpetualDEXWrapperAddress,
        address _settlementTokenManager,
        address _perpSettlementToken
    ) external initializer {
        __ReentrancyGuard_init();
        __ERC20_init("USDLemma", "USDL");
        __ERC20Permit_init("USDLemma");
        __ERC2771Context_init(_trustedForwarder);

        __AccessControl_init();
        _setRoleAdmin(LEMMA_SWAP, ADMIN_ROLE);
        _setRoleAdmin(OWNER_ROLE, ADMIN_ROLE);
        _setupRole(ADMIN_ROLE, msg.sender);
        grantRole(OWNER_ROLE, msg.sender);

        if (_settlementTokenManager != address(0)) {
            settlementTokenManager = _settlementTokenManager;
            isSupportedStableForMinting[ISettlementTokenManager(settlementTokenManager).getSettlementToken()] = true;
        }
        perpSettlementToken = _perpSettlementToken;
        addPerpetualDEXWrapper(0, _collateralAddress, _perpetualDEXWrapperAddress);
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

    /// @notice getAvailableSettlementToken will use to check the available settlement token in treasury
    function getAvailableSettlementToken(uint256 perpetualDEXIndex, address collateral)
        external
        view
        returns (uint256 res)
    {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        address[] memory tokens = perpDEXWrapper.getCollateralTokens();
        require(tokens.length > 0, "Empty Set of Collaterals");
        address settlementToken = tokens[0];
        res = IERC20Upgradeable(settlementToken).balanceOf(lemmaTreasury);
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

    /// @notice setXUsdl will set xusdl contract address by owner role address
    /// @param _xUsdl contract address
    function setXUsdl(address _xUsdl) external onlyRole(OWNER_ROLE) {
        xUsdl = _xUsdl;
    }

    /// @notice setSettlementTokenManager is to set the address of settlementTokenManager
    /// @param _settlementTokenManager contract address
    function setSettlementTokenManager(address _settlementTokenManager) external onlyRole(OWNER_ROLE) {
        settlementTokenManager = _settlementTokenManager;
        if (settlementTokenManager != address(0)) {
            isSupportedStableForMinting[ISettlementTokenManager(settlementTokenManager).getSettlementToken()] = true;
        }
        emit SetSettlementTokenManager(settlementTokenManager);
    }

    /// @notice Set Lemma treasury, can only be called by owner
    /// @param _lemmaTreasury Address of Lemma Treasury
    function setLemmaTreasury(address _lemmaTreasury) external onlyRole(OWNER_ROLE) {
        require(_lemmaTreasury != address(0), "LemmaTreasury should not ZERO address");
        lemmaTreasury = _lemmaTreasury;
        emit LemmaTreasuryUpdated(lemmaTreasury);
    }

    /// @notice Set Fees, can only be called by owner
    /// @param _fees Fees taken by the Lemma protocol
    function setFees(uint256 _fees) external onlyRole(OWNER_ROLE) {
        fees = _fees;
        emit FeesUpdated(fees);
    }

    /// @notice mintToStackingContract will be call by perpLemma while distributingFR
    /// If the FR will be in profit, so usdLemma mint new usdl and deposit to xusdl contract,
    /// To incentive all users
    function mintToStackingContract(uint256 amount) external onlyPerpDEXWrapper {
        _mint(xUsdl, amount);
    }

    /// @notice burnToStackingContract will be call by perpLemma while distributingFR
    /// If the FR will not be in profit, so usdLemma burn usdl from xusdl contract,
    function burnToStackingContract(uint256 amount) external onlyPerpDEXWrapper {
        _burn(xUsdl, amount);
    }

    /// @notice requestLossesRecap will be call by perpLemma while distributingFR
    /// If the FR will not be in profit, so usdLemma request settlementToken from STM contract
    function requestLossesRecap(uint256 usdcAmount) external onlyPerpDEXWrapper {
        ISettlementTokenManager(settlementTokenManager).settlementTokenRecieve(usdcAmount, _msgSender());
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
    ) external nonReentrant onlyOneFunInSameTx {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");

        uint256 _collateralRequired;
        if (address(collateral) == perpSettlementToken) {
            // USDC
            _collateralRequired = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
                amount,
                address(collateral),
                false
            );
            SafeERC20Upgradeable.safeTransferFrom(
                IERC20Upgradeable(collateral),
                _msgSender(),
                settlementTokenManager,
                _collateralRequired
            );
            ISettlementTokenManager(settlementTokenManager).settlementTokenRecieve(
                _collateralRequired,
                address(perpDEXWrapper)
            );
        } else {
            (uint256 _collateralRequired_1e18, ) = perpDEXWrapper.openShortWithExactQuote(amount);
            _collateralRequired = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
                _collateralRequired_1e18,
                address(collateral),
                false
            );
            require(_collateralRequired_1e18 <= maxCollateralAmountRequired, "collateral required execeeds maximum");
            _perpDeposit(perpDEXWrapper, address(collateral), _collateralRequired);
        }
        perpDEXWrapper.calculateMintingAsset(amount, IPerpetualMixDEXWrapper.Basis.IsUsdl, true);
        _mint(to, amount);
        emit DepositTo(perpetualDEXIndex, address(collateral), to, amount, _collateralRequired);
    }

    /// @notice Deposit collateral like WETH, WBTC, etc. to mint USDL specifying the exact amount of collateral
    /// @param to Receipent of minted USDL
    /// @param collateralAmount Amount of collateral to deposit in the 18 decimals
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be opened
    /// @param minUSDLToMint Minimum USDL to mint
    /// @param collateral Collateral to be used to mint USDL
    function depositToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 minUSDLToMint,
        IERC20Upgradeable collateral
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
        uint256 expectedRequiredUSDC = perpDEXWrapper.computeRequiredUSDCForTrade(collateralAmount, true);
        if (expectedRequiredUSDC > 0) {
            require(
                perpDEXWrapper.isAdditionalUSDCAcceptable(expectedRequiredUSDC),
                "The Vault can't accept the USDC we need to add"
            );
            ILemmaTreasury(lemmaTreasury).recapitalizeWrapper(address(perpDEXWrapper), expectedRequiredUSDC);
        }

        _perpDeposit(perpDEXWrapper, address(collateral), _collateralRequired);
        uint256 _usdlToMint;
        if (address(collateral) == perpSettlementToken) {
            // USDC
            _usdlToMint = collateralAmount; // if collateral is usdc then collateralAmount is usdcAmount
        } else {
            (, _usdlToMint) = perpDEXWrapper.openShortWithExactBase(collateralAmount);
            require(_usdlToMint >= minUSDLToMint, "USDL minted too low");
        }

        perpDEXWrapper.calculateMintingAsset(_usdlToMint, IPerpetualMixDEXWrapper.Basis.IsUsdl, true);
        _mint(to, _usdlToMint);
        emit DepositTo(perpetualDEXIndex, address(collateral), to, _usdlToMint, _collateralRequired);
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
    ) external nonReentrant onlyOneFunInSameTx {
        _burn(_msgSender(), amount);
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        bool hasSettled = perpDEXWrapper.hasSettled();
        uint256 _collateralAmountToWithdraw1e_18;
        if (hasSettled) {
            perpDEXWrapper.getCollateralBackAfterSettlement(amount, to, true);
            return;
        } else {
            uint256 _collateralAmountToWithdraw;
            if (address(collateral) == perpSettlementToken) {
                // USDC
                _collateralAmountToWithdraw = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
                    amount,
                    address(collateral),
                    false
                );
                ISettlementTokenManager(settlementTokenManager).settlementTokenRequested(
                    _collateralAmountToWithdraw,
                    address(perpDEXWrapper)
                );
                SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(collateral), to, _collateralAmountToWithdraw);
            } else {
                (_collateralAmountToWithdraw1e_18, ) = perpDEXWrapper.closeShortWithExactQuote(amount);
                _collateralAmountToWithdraw = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
                    _collateralAmountToWithdraw1e_18,
                    address(collateral),
                    false
                );
                require(
                    _collateralAmountToWithdraw1e_18 >= minCollateralAmountToGetBack,
                    "Collateral to get back too low"
                );
                _perpWithdraw(to, perpDEXWrapper, address(collateral), _collateralAmountToWithdraw);
            }
            perpDEXWrapper.calculateMintingAsset(amount, IPerpetualMixDEXWrapper.Basis.IsUsdl, false);
            emit WithdrawTo(perpetualDEXIndex, address(collateral), to, amount, _collateralAmountToWithdraw);
        }
    }

    /// @notice Redeem USDL and withdraw collateral like WETH, WBTC, etc specifying the exact amount of collateral
    /// @param to Receipent of withdrawn collateral
    /// @param collateralAmount Amount of collateral to withdraw in 18 decimls
    /// @param perpetualDEXIndex Index of perpetual dex, where position will be closed
    /// @param maxUSDLToBurn Max USDL to burn in the process
    /// @param collateral Collateral to be used to redeem USDL
    function withdrawToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 maxUSDLToBurn,
        IERC20Upgradeable collateral
    ) external nonReentrant onlyOneFunInSameTx {
        IPerpetualMixDEXWrapper perpDEXWrapper = IPerpetualMixDEXWrapper(
            perpetualDEXWrappers[perpetualDEXIndex][address(collateral)]
        );
        require(address(perpDEXWrapper) != address(0), "invalid DEX/collateral");
        bool hasSettled = perpDEXWrapper.hasSettled();
        /// NOTE:- hasSettled Error: PerpLemma is settled call withdrawTo method to settle your collateral using exact usdl
        require(!hasSettled, "hasSettled Error");

        uint256 _usdlToBurn;
        if (address(collateral) == perpSettlementToken) {
            // USDC
            _usdlToBurn = collateralAmount;
        } else {
            (, _usdlToBurn) = perpDEXWrapper.closeShortWithExactBase(collateralAmount);
            require(_usdlToBurn <= maxUSDLToBurn, "Too much USDL to burn");
        }
        uint256 _collateralAmountToWithdraw = perpDEXWrapper.getAmountInCollateralDecimalsForPerp(
            collateralAmount,
            address(collateral),
            false
        );
        _perpWithdraw(to, perpDEXWrapper, address(collateral), _collateralAmountToWithdraw);
        perpDEXWrapper.calculateMintingAsset(_usdlToBurn, IPerpetualMixDEXWrapper.Basis.IsUsdl, false);
        _burn(_msgSender(), _usdlToBurn);
        emit WithdrawTo(perpetualDEXIndex, address(collateral), to, _usdlToBurn, _collateralAmountToWithdraw);
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
