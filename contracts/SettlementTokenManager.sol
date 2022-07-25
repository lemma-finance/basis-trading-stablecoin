pragma solidity =0.8.3;

import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { IPerpetualMixDEXWrapper } from "./interfaces/IPerpetualMixDEXWrapper.sol";
import { ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/IERC20Decimals.sol";
import "forge-std/Test.sol";

contract SettlementTokenManager is ERC2771ContextUpgradeable, AccessControlUpgradeable {

    address public usdLemma;
    address public reBalancer;
    bool public isSettlementAllowed;
    IERC20Decimals public usdc;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ONLY_OWNER = keccak256("ONLY_OWNER");
    bytes32 public constant USDLEMMA_ROLE = keccak256("USDLEMMA_ROLE");
    bytes32 public constant REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    event SettlementTokenRecieve(uint256 indexed settlementTokenAmount, address indexed perpDexWrapper);
    event SettlementTokenRequested(uint256 indexed settlementTokenAmount, address indexed perpDexWrapper);
    event SettlementTokenReBalance(uint256 indexed settlementTokenAmount, address indexed perpDexWrapperFrom, address indexed perpDexWrapperTo);
    event SetIsSettlementAllowed(bool indexed _isSettlementAllowed);
    event SetUSDLemma(address indexed _usdLemma);
    event SetRebalancer(address indexed _reBalancer);

    function initialize(
        address _usdLemma,
        address _reBalancer,
        address _usdc
    ) external initializer {
        __ERC2771Context_init(_trustedForwarder);

        __AccessControl_init();
        _setRoleAdmin(USDLEMMA_ROLE, ADMIN_ROLE);
        _setRoleAdmin(ONLY_OWNER, ADMIN_ROLE);
        _setRoleAdmin(REBALANCER_ROLE, ADMIN_ROLE);
        _setupRole(ADMIN_ROLE, msg.sender);
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

    function changeAdmin(address newAdmin) external onlyRole(ADMIN_ROLE) {
        require(newAdmin != address(0), "NewAdmin should not ZERO address");
        require(newAdmin != msg.sender, "Admin Addresses should not be same");
        _setupRole(ADMIN_ROLE, newAdmin);
        renounceRole(ADMIN_ROLE, msg.sender);
    }

    function setIsSettlementAllowed(bool _isSettlementAllowed) external onlyRole(ONLY_OWNER) {
        isSettlementAllowed = _isSettlementAllowed;
        emit SetUSDLemma(usdLemma);
    }

    function setUSDLemma(address _usdLemma) external onlyRole(ADMIN_ROLE) {
        require(_usdLemma != address(0), "USDLemma should not ZERO address");
        usdLemma = _usdLemma;
        grantRole(USDLEMMA_ROLE, usdLemma);
        emit SetUSDLemma(usdLemma);
    }

    function setRebalancer(address _reBalancer) external onlyRole(ADMIN_ROLE) {
        require(_reBalancer != address(0), "Rebalancer should not ZERO address");
        reBalancer = _reBalancer;
        grantRole(REBALANCER_ROLE, reBalancer);
        emit SetRebalancer(reBalancer);
    }

    function settlementTokenRecieve(uint256 settlementTokenAmount, address perpDexWrapper) external onlyRole(USDLEMMA_ROLE) {
        require(isSettlementAllowed, "Settlement Token is not allowed");
        require(usdc.balanceOf(address(this)) >= settlementTokenAmount, "STM: Not enought balance");
        require(perpDexWrapper != address(0), "perpDexWrapper should not ZERO address");
        SafeERC20Upgradeable.safeApprove(usdc, perpDexWrapper, settlementTokenAmount);
        _deposit(settlementTokenAmount, perpDexWrapper);
        emit SettlementTokenRecieve(settlementTokenAmount, perpDexWrapper);
    }

    function settlementTokenRequested(uint256 settlementTokenAmount, address perpDexWrapper) external onlyRole(USDLEMMA_ROLE) {
        require(isSettlementAllowed, "Settlement Token is not allowed");
        require(perpDexWrapper != address(0), "perpDexWrapper should not ZERO address");
        uint256 beforeBalance = usdc.balanceOf(address(this));
        _withdraw(settlementTokenAmount, perpDexWrapper);
        uint256 afterBalance = usdc.balanceOf(address(this));
        require(afterBalance-beforeBalance == settlementTokenAmount, "Not Valid Trade");
        SafeERC20Upgradeable.safeTransfer(usdc, usdLemma, settlementTokenAmount);
        emit SettlementTokenRequested(settlementTokenAmount, perpDexWrapper);
    }

    function settlemntTokenRebalance(uint256 settlementTokenAmount, address perpDexWrapperFrom, address perpDexWrapperTo) external onlyRole(REBALANCER_ROLE) {
        require(usdc.balanceOf(address(this)) >= settlementTokenAmount, "STM: Not enought balance");
        require(perpDexWrapperFrom != address(0), "perpDexWrapperFrom should not ZERO address");
        require(perpDexWrapperTo != address(0), "perpDexWrapperTo should not ZERO address");
        _withdraw(settlementTokenAmount, perpDexWrapperFrom);
        _deposit(settlementTokenAmount, perpDexWrapperTo);
        emit SettlementTokenReBalance(settlementTokenAmount, perpDexWrapperFrom, perpDexWrapperTo);
    }

    function _deposit(uint256 amount, address perpDexWrapper) internal {
        IPerpetualMixDEXWrapper(perpDexWrapper).depositSettlementToken(amount);
    }

    function _withdraw(uint256 amount, address perpDexWrapper) internal {
        IPerpetualMixDEXWrapper(perpDexWrapper).withdrawSettlementToken(amount);
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
