pragma solidity =0.8.3;

import { ILiquidityPool, PerpetualState } from "../interfaces/MCDEX/ILiquidityPool.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IPerpetualDEXWrapper } from "../interfaces/IPerpetualDEXWrapper.sol";

/// @author Lemma Finance
contract CrabSqueethLemma is OwnableUpgradeable, ERC2771ContextUpgradeable, IPerpetualDEXWrapper {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;

    uint256 public constant MAX_UINT256 = type(uint256).max;
    int256 public constant MAX_INT256 = type(int256).max;

    // address of Mai3 liquidity pool
    ILiquidityPool public liquidityPool;

    // pereptual index in the liquidity pool
    uint256 public perpetualIndex;

    IERC20Upgradeable public collateral;
    uint256 public collateralDecimals;

    address public reBalancer;
    address public referrer;

    int256 public entryFunding;
    int256 public realizedFundingPNL;

    uint256 public positionAtSettlement;

    uint256 public maxPosition;

    //events
    event RebalancerUpdated(address rebalancerAddress);
    event MaxPositionUpdated(uint256 maxPos);

    function initialize(
        address _trustedForwarder,
        address _reBalancer,
        uint256 _maxPosition
    ) external initializer {
        __Ownable_init();
        __ERC2771Context_init(_trustedForwarder);
        setReBalancer(_reBalancer);
        setMaxPosition(_maxPosition);
    }

    ///@notice sets reBalncer address - only owner can set
    ///@param _reBalancer reBalancer address to set
    function setReBalancer(address _reBalancer) public onlyOwner {
        reBalancer = _reBalancer;
        emit RebalancerUpdated(reBalancer);
    }

    ///@notice sets Max Positions - only owner can set
    ///@param _maxPosition reBalancer address to set
    function setMaxPosition(uint256 _maxPosition) public onlyOwner {
        maxPosition = _maxPosition;
        emit MaxPositionUpdated(maxPosition);
    }

    /// @notice reset approvals
    function resetApprovals() external {}

    //this needs to be done before the first withdrawal happens
    //Keeper gas reward needs to be handled seperately which owner can get back when perpetual has settled
    /// @notice Deposit Keeper gas reward for the perpetual - only owner can call
    function depositKeeperGasReward() external onlyOwner {}

    //go short to open
    /// @notice Open short position on dex and deposit collateral
    /// @param amount worth in USD short position which is to be opened
    /// @param collateralAmountRequired collateral amount required to open the position
    function open(uint256 amount, uint256 collateralAmountRequired) external override {}

    function openWExactCollateral(uint256 collateralAmount) external override returns (uint256 USDLToMint) {}

    //go long and withdraw collateral
    /// @notice Close short position on dex and withdraw collateral
    /// @param amount worth in USD short position which is to be closed
    /// @param collateralAmountToGetBack collateral amount freed up after closing the position
    function close(uint256 amount, uint256 collateralAmountToGetBack) external override {}

    function closeWExactCollateral(uint256 collateralAmount) external override returns (uint256 USDLToBurn) {}

    //// @notice when perpetual is in CLEARED state, withdraw the collateral
    function settle() public {}

    /// @notice Collateral amount required/to get back for amount in USD to open/close position on dex
    /// @param amount worth in USD short position which is to be closed or opened
    /// @param isShorting true if opening short position, false if closing short position
    /// @return collateralAmountRequired equivalent collateral amount
    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        external
        override
        returns (uint256 collateralAmountRequired)
    {}

    /// @notice Rebalance position of dex based on accumulated funding, since last rebalancing
    /// @param _reBalancer Address of rebalancer who called function on USDL contract
    /// @param amount Amount of accumulated funding fees used to rebalance by opening or closing a short position
    /// @param data Abi encoded data to call respective mcdex function, contains limitPrice and deadline
    /// @return True if successful, False if unsuccessful
    function reBalance(
        address _reBalancer,
        int256 amount,
        bytes calldata data
    ) external override returns (bool) {}

    /// @notice calculate entryFunding to be able to calculate the fundingPNL easily
    /// @param position Current position on MCDEX
    /// @param tradeAmount Change in current position on MCDEX
    function updateEntryFunding(int256 position, int256 tradeAmount) internal {}

    /// @notice Get funding PnL for this address till now
    /// @return fundingPNL Funding PnL accumulated till now
    function getFundingPNL() public view returns (int256 fundingPNL) {}

    /// @notice Get Amount in collateral decimals, provided amount is in 18 decimals
    /// @param amount Amount in 18 decimals
    /// @param roundUp If needs to round up
    /// @return decimal adjusted value
    function getAmountInCollateralDecimals(uint256 amount, bool roundUp) public view override returns (uint256) {
        if (roundUp && (amount % (uint256(10**(18 - collateralDecimals))) != 0)) {
            return amount / uint256(10**(18 - collateralDecimals)) + 1;
        }

        return amount / uint256(10**(18 - collateralDecimals));
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
