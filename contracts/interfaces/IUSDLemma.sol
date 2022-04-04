pragma solidity =0.8.3;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

interface IUSDLemma is IERC20Upgradeable {
    function depositTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 maxCollateralRequired,
        IERC20Upgradeable collateral
    ) external;

    function withdrawTo(
        address to,
        uint256 amount,
        uint256 perpetualDEXIndex,
        uint256 minCollateralToGetBack,
        IERC20Upgradeable collateral
    ) external;

    function depositToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 minUSDLToMint,
        IERC20Upgradeable collateral
    ) external;

    function withdrawToWExactCollateral(
        address to,
        uint256 collateralAmount,
        uint256 perpetualDEXIndex,
        uint256 maxUSDLToBurn,
        IERC20Upgradeable collateral
    ) external;

    function perpetualDEXWrappers(uint256 perpetualDEXIndex, address collateral)
        external
        view
        returns (address);

    function addPerpetualDEXWrapper(
        uint256 perpetualDEXIndex,
        address collateralAddress,
        address perpetualDEXWrapperAddress
    ) external;


    function getFeesPerc(uint256 dexIndex, address collateral, bool isMinting) external view returns (uint256);

    function setWhiteListAddress(address _account, bool _isWhiteList) external;
    function setConsultingContract(address _consultingContract) external;

    function nonces(address owner) external view returns (uint256);
    function name() external view returns (string memory);
    function permit(address owner, address spender, uint value, uint deadline, uint8 v, bytes32 r, bytes32 s) external;
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    
    function closePosition(uint256 collateralAmount, uint256 perpetualDEXIndex, IERC20Upgradeable collateral) external returns (uint256, uint256);
    function burnAndTransfer(uint256 USDLToBurn, uint256 collateralAmountToGetBack, address to, IERC20Upgradeable collateral) external;

    event PerpetualDexWrapperAdded(uint256 indexed dexIndex, address indexed collateral, address dexWrapper);
}
