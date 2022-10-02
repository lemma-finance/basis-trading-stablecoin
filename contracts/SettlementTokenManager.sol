// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { IPerpetualMixDEXWrapper } from "./interfaces/IPerpetualMixDEXWrapper.sol";
import { ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/IERC20Decimals.sol";
import "./interfaces/ISettlementTokenManager.sol";

/// @author Lemma Finance
/// @notice This is used in case the system does not have enough USDC to keep the leverage non-risky
contract SettlementTokenManager is ERC2771ContextUpgradeable, AccessControlUpgradeable, ISettlementTokenManager {
    /// USDLemma contract address
    address public usdLemma;
    /// Rebalancer Address EOA or bot address
    address public reBalancer;
    /// if isSettlementAllowed true then only USDC transfer can be done between USDLemma and PerpLemma
    bool public isSettlementAllowed;
    /// USDC ERC20 contract
    IERC20Decimals public usdc;

    // Different Roles to perform restricted tx
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant USDLEMMA_ROLE = keccak256("USDLEMMA_ROLE");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    // Events
    event SettlementTokenRecieve(uint256 indexed settlementTokenAmount, address indexed perpDexWrapper);
    event SettlementTokenRequested(uint256 indexed settlementTokenAmount, address indexed perpDexWrapper);
    event SettlementTokenReBalance(
        uint256 indexed settlementTokenAmount,
        address indexed perpDexWrapperFrom,
        address indexed perpDexWrapperTo
    );
    event SetIsSettlementAllowed(bool indexed _isSettlementAllowed);
    event SetUSDLemma(address indexed _usdLemma);
    event SetRebalancer(address indexed _reBalancer);

    /// @notice Intialize method only called once while deploying contract
    /// It will setup different roles and give role access to specific addreeses
    /// @param _usdLemma USDLemma contract address
    /// @param _reBalancer Rebalancer Address EOA or bot address
    /// @param _usdc USDC erc20 token address
    function initialize(
        address _usdLemma,
        address _reBalancer,
        address _usdc
    ) external initializer {
        __ERC2771Context_init(_trustedForwarder);

        __AccessControl_init();
        _setRoleAdmin(USDLEMMA_ROLE, ADMIN_ROLE);
        _setRoleAdmin(OWNER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(REBALANCER_ROLE, ADMIN_ROLE);
        _setupRole(ADMIN_ROLE, msg.sender);
        grantRole(OWNER_ROLE, msg.sender);
        if (_usdLemma != address(0)) {
            grantRole(USDLEMMA_ROLE, _usdLemma);
            usdLemma = _usdLemma;
        }
        if (_reBalancer != address(0)) {
            grantRole(REBALANCER_ROLE, _reBalancer);
            reBalancer = _reBalancer;
        }
        usdc = IERC20Decimals(_usdc);
        isSettlementAllowed = true;
    }

    /// @notice getSettlementToken will return USDC contract address
    function getSettlementToken() external view override returns (address) {
        return address(usdc);
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

    /// @notice setIsSettlementAllowed is to enable or disable to allow mint USDL using USDC on USDLemma
    /// @param _isSettlementAllowed true or false
    function setIsSettlementAllowed(bool _isSettlementAllowed) external onlyRole(OWNER_ROLE) {
        isSettlementAllowed = _isSettlementAllowed;
        emit SetIsSettlementAllowed(_isSettlementAllowed);
    }

    /// @notice setUSDLemma is to set usdLemma contract address and give USDLemmaRole to usdLemma contract address
    /// @param _usdLemma usdLemma contract address
    function setUSDLemma(address _usdLemma) external onlyRole(ADMIN_ROLE) {
        require(_usdLemma != address(0), "USDLemma should not ZERO address");
        revokeRole(USDLEMMA_ROLE, usdLemma);
        usdLemma = _usdLemma;
        grantRole(USDLEMMA_ROLE, usdLemma);
        emit SetUSDLemma(usdLemma);
    }

    /// @notice setRebalancer set rebalnacer address by admin role only
    /// @param _reBalancer address
    function setRebalancer(address _reBalancer) external onlyRole(ADMIN_ROLE) {
        require(_reBalancer != address(0), "Rebalancer should not ZERO address");
        revokeRole(REBALANCER_ROLE, reBalancer);
        reBalancer = _reBalancer;
        grantRole(REBALANCER_ROLE, reBalancer);
        emit SetRebalancer(reBalancer);
    }

    /// @notice settlementTokenRecieve is called when mint USDL using USDC on USDLemma cntract
    /// USDLemma transfer USDC in this contract and then from here it will send to perpLemma contract
    /// depositTo method of USDLemma contract will use to mint USDL using USDC
    /// to deposit USDC from this contract to PerpLemma, this contract should have USDC_TREASURY on PerpLemma contract
    /// to call this method USDLemma contract should have USDLemma_Role
    /// @param settlementTokenAmount Amount of USDC need to transfer to perpLemma from USDLemma
    /// @param perpDexWrapper on this perpLemma contract the amount will be transfer
    function settlementTokenRecieve(uint256 settlementTokenAmount, address perpDexWrapper)
        external
        override
        onlyRole(USDLEMMA_ROLE)
    {
        require(isSettlementAllowed, "Settlement Token is not allowed");
        require(usdc.balanceOf(address(this)) >= settlementTokenAmount, "STM: Not enought balance");
        require(perpDexWrapper != address(0), "perpDexWrapper should not ZERO address");
        _approve(perpDexWrapper, settlementTokenAmount);
        _deposit(settlementTokenAmount, perpDexWrapper);
        emit SettlementTokenRecieve(settlementTokenAmount, perpDexWrapper);
    }

    /// @notice settlementTokenRequested is called when redeem USDL using USDC on USDLemma contract
    /// Specific perpLemma transfer USDC amount in this contract and from here it will transfer to USDLemma contract
    /// withdrawTo method of USDLemma contract will use to redeem USDL using USDC
    /// to withdraw USDC from perpLemma to this contract(SettlementManagerContract), this contract should have USDC_TREASURY role in PerpLemma contract
    /// and to call settlementTokenRequested function USDLemma contract should have USDLemma_Role
    /// @param settlementTokenAmount Amount of USDC need to transfer to USDLemma from PerpLemma
    /// @param perpDexWrapper amount will be withdraw from this perpLemma contract
    function settlementTokenRequested(uint256 settlementTokenAmount, address perpDexWrapper)
        external
        override
        onlyRole(USDLEMMA_ROLE)
    {
        require(isSettlementAllowed, "Settlement Token is not allowed");
        require(perpDexWrapper != address(0), "perpDexWrapper should not ZERO address");
        uint256 beforeBalance = usdc.balanceOf(address(this));
        _withdraw(settlementTokenAmount, perpDexWrapper);
        uint256 afterBalance = usdc.balanceOf(address(this));
        require(afterBalance - beforeBalance == settlementTokenAmount, "Not Valid Trade");
        SafeERC20Upgradeable.safeTransfer(usdc, usdLemma, settlementTokenAmount);
        emit SettlementTokenRequested(settlementTokenAmount, perpDexWrapper);
    }

    /// @notice settlemntTokenRebalance is use to rebalance USDC Quantity from one perpLemma to other perpLemma
    /// Only address can call who have REBALANCER_ROLE
    /// @param settlementTokenAmount the amount need to rebalance
    /// @param perpDexWrapperFrom withdraw amount from this perpLemma contract
    /// @param perpDexWrapperTo deposit amount in this perpLemma contract
    function settlemntTokenRebalance(
        uint256 settlementTokenAmount,
        address perpDexWrapperFrom,
        address perpDexWrapperTo
    ) external override onlyRole(REBALANCER_ROLE) {
        require(usdc.balanceOf(address(this)) >= settlementTokenAmount, "STM: Not enought balance");
        require(perpDexWrapperFrom != address(0), "perpDexWrapperFrom should not ZERO address");
        require(perpDexWrapperTo != address(0), "perpDexWrapperTo should not ZERO address");
        _withdraw(settlementTokenAmount, perpDexWrapperFrom);
        _deposit(settlementTokenAmount, perpDexWrapperTo);
        emit SettlementTokenReBalance(settlementTokenAmount, perpDexWrapperFrom, perpDexWrapperTo);
    }

    /// @notice Internal Methods

    /// @notice _deposit method which will deposit USDC into this given perpLemma contract
    /// @param amount Amount of USDC need to transfer to perpLemma from USDLemma
    /// @param perpDexWrapper on this perpLemma contract the amount will be transfer
    function _deposit(uint256 amount, address perpDexWrapper) internal {
        IPerpetualMixDEXWrapper(perpDexWrapper).depositSettlementToken(amount);
    }

    // @notice _withdraw method which will withdraw USDC from this given perpLemma contract
    /// @param amount Amount of USDC need to withdraw from this PerpLemma contract
    /// @param perpDexWrapper amount will be withdraw from this perpLemma contract
    function _withdraw(uint256 amount, address perpDexWrapper) internal {
        IPerpetualMixDEXWrapper(perpDexWrapper).withdrawSettlementToken(amount);
    }

    /// @notice give necessary approve for settlement token
    function _approve(address perpDexWrapper, uint256 amount) internal {
        SafeERC20Upgradeable.safeApprove(usdc, perpDexWrapper, 0);
        SafeERC20Upgradeable.safeApprove(usdc, perpDexWrapper, amount);
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
