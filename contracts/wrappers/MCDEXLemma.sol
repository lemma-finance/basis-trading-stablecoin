pragma solidity =0.8.3;

import { ILiquidityPool, PerpetualState } from "../interfaces/MCDEX/ILiquidityPool.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { Utils } from "../libraries/Utils.sol";
import { SafeMathExt } from "../libraries/SafeMathExt.sol";
import { IPerpetualDEXWrapper } from "../interfaces/IPerpetualDEXWrapper.sol";

interface IUSDLemma {
    function lemmaTreasury() external view returns (address);
}

/// @author Lemma Finance
contract MCDEXLemma is OwnableUpgradeable, ERC2771ContextUpgradeable, IPerpetualDEXWrapper {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using Utils for int256;
    using SafeMathExt for int256;

    uint256 public constant MAX_UINT256 = type(uint256).max;
    int256 public constant MAX_INT256 = type(int256).max;

    // address of Mai3 liquidity pool
    ILiquidityPool public liquidityPool;

    // pereptual index in the liquidity pool
    uint256 public perpetualIndex;

    IERC20Upgradeable public collateral;
    uint256 public collateralDecimals;

    address public usdLemma;
    address public reBalancer;
    address public referrer;

    int256 public entryFunding;
    int256 public realizedFundingPNL;

    uint256 public positionAtSettlement;

    uint256 public maxPosition;

    //events
    event USDLemmaUpdated(address usdlAddress);
    event ReferrerUpdated(address referrerAddress);
    event RebalancerUpdated(address rebalancerAddress);
    event MaxPositionUpdated(uint256 maxPos);

    function openWExactCollateral(uint256 collateralAmount) external override returns (uint256 USDLToMint) {}

    function closeWExactCollateral(uint256 collateralAmount) external override returns (uint256 USDLToBurn) {}  

    function initialize(
        address _trustedForwarder,
        ILiquidityPool _liquidityPool,
        uint256 _perpetualIndex,
        address _usdlemma,
        address _reBalancer,
        uint256 _maxPosition
    ) external initializer {
        __Ownable_init();
        __ERC2771Context_init(_trustedForwarder);
        liquidityPool = _liquidityPool;
        perpetualIndex = _perpetualIndex;
        {
            (bool isRunning, , address[7] memory addresses, , uint256[4] memory uintNums) = liquidityPool
                .getLiquidityPoolInfo();
            require(isRunning, "pool is not running");
            collateral = IERC20Upgradeable(addresses[5]);
            collateralDecimals = uintNums[0];
        }
        setReBalancer(_reBalancer);
        setUSDLemma(_usdlemma);
        setMaxPosition(_maxPosition);

        //approve collateral to
        SafeERC20Upgradeable.safeApprove(collateral, address(liquidityPool), MAX_UINT256);
        //target leverage = 1
        liquidityPool.setTargetLeverage(perpetualIndex, address(this), 1 ether); //1
    }

    ///@notice sets USDLemma address - only owner can set
    ///@param _usdlemma USDLemma address to set
    function setUSDLemma(address _usdlemma) public onlyOwner {
        usdLemma = _usdlemma;
        emit USDLemmaUpdated(usdLemma);
    }

    ///@notice sets refferer address - only owner can set
    ///@param _referrer refferer address to set
    function setReferrer(address _referrer) external onlyOwner {
        referrer = _referrer;
        emit ReferrerUpdated(referrer);
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
    function resetApprovals() external {
        SafeERC20Upgradeable.safeApprove(collateral, address(liquidityPool), 0);
        SafeERC20Upgradeable.safeApprove(collateral, address(liquidityPool), MAX_UINT256);
    }

    //this needs to be done before the first withdrawal happens
    //Keeper gas reward needs to be handled seperately which owner can get back when perpetual has settled
    /// @notice Deposit Keeper gas reward for the perpetual - only owner can call
    function depositKeeperGasReward() external onlyOwner {
        int256 keeperGasReward;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            keeperGasReward = nums[11];
        }
        SafeERC20Upgradeable.safeTransferFrom(
            collateral,
            _msgSender(),
            address(this),
            getAmountInCollateralDecimals(keeperGasReward.toUint256(), true)
        );
        liquidityPool.deposit(perpetualIndex, address(this), keeperGasReward);
    }

    //go short to open
    /// @notice Open short position on dex and deposit collateral
    /// @param amount worth in USD short position which is to be opened
    /// @param collateralAmountRequired collateral amount required to open the position
    function open(uint256 amount, uint256 collateralAmountRequired) external override {
        require(_msgSender() == usdLemma, "only usdLemma is allowed");
        require(
            collateral.balanceOf(address(this)) >= getAmountInCollateralDecimals(collateralAmountRequired, true),
            "not enough collateral"
        );
        liquidityPool.deposit(perpetualIndex, address(this), collateralAmountRequired.toInt256());

        (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

        require(position.abs().toUint256() + amount <= maxPosition, "max position reached");
        liquidityPool.trade(perpetualIndex, address(this), amount.toInt256(), MAX_INT256, MAX_UINT256, referrer, 0);
        updateEntryFunding(position, amount.toInt256());
    }

    //go long and withdraw collateral
    /// @notice Close short position on dex and withdraw collateral
    /// @param amount worth in USD short position which is to be closed
    /// @param collateralAmountToGetBack collateral amount freed up after closing the position
    function close(uint256 amount, uint256 collateralAmountToGetBack) external override {
        require(_msgSender() == usdLemma, "only usdLemma is allowed");

        (PerpetualState perpetualState, , ) = liquidityPool.getPerpetualInfo(perpetualIndex);

        if (perpetualState != PerpetualState.CLEARED) {
            //means perpetual settled
            (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));
            liquidityPool.trade(
                perpetualIndex,
                address(this),
                -amount.toInt256(), //negative means you want to go short (on USD, that in turn means long on ETH)
                0,
                MAX_UINT256,
                referrer,
                0
            );
            liquidityPool.withdraw(perpetualIndex, address(this), collateralAmountToGetBack.toInt256());
            updateEntryFunding(position, -amount.toInt256());
        }
        SafeERC20Upgradeable.safeTransfer(
            collateral,
            usdLemma,
            getAmountInCollateralDecimals(collateralAmountToGetBack, false)
        );
    }

    //// @notice when perpetual is in CLEARED state, withdraw the collateral
    function settle() public {
        (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));
        positionAtSettlement = position.abs().toUint256();
        liquidityPool.settle(perpetualIndex, address(this));
    }

    /// @notice Collateral amount required/to get back for amount in USD to open/close position on dex
    /// @param amount worth in USD short position which is to be closed or opened
    /// @param isShorting true if opening short position, false if closing short position
    /// @return collateralAmountRequired equivalent collateral amount
    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        external
        override
        returns (uint256 collateralAmountRequired)
    {
        liquidityPool.forceToSyncState();
        int256 tradeAmount = isShorting ? amount.toInt256() : -amount.toInt256();

        //handle the case when perpetual has settled
        (PerpetualState perpetualState, , ) = liquidityPool.getPerpetualInfo(perpetualIndex);

        if (perpetualState == PerpetualState.CLEARED) {
            require(!isShorting, "cannot open when perpetual has settled");
            (
                ,
                ,
                ,
                ,
                int256 settleableMargin, // bankrupt
                ,
                ,
                ,

            ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

            if (settleableMargin != 0) {
                settle();
            }
            collateralAmountRequired = (collateral.balanceOf(address(this)) * amount) / positionAtSettlement;
        } else {
            (int256 tradePrice, int256 totalFee, ) = liquidityPool.queryTrade(
                perpetualIndex,
                address(this),
                tradeAmount,
                referrer,
                0
            );

            int256 deltaCash = amount.toInt256().wmul(tradePrice);

            collateralAmountRequired = isShorting
                ? (deltaCash + totalFee).toUint256()
                : (deltaCash - totalFee).toUint256();
        }
    }

    /// @notice Rebalance position of dex based on accumulated funding, since last rebalancing
    /// @param _reBalancer Address of rebalancer who called function on USDL contract
    /// @param amount Amount of accumulated funding fees used to rebalance by opening or closing a short position
    /// @param data Abi encoded data to call respective mcdex function, contains limitPrice and deadline
    /// @return True if successful, False if unsuccessful
    function reBalance(
        address _reBalancer,
        int256 amount,
        bytes calldata data
    ) external override returns (bool) {
        liquidityPool.forceToSyncState();
        require(_msgSender() == usdLemma, "only usdLemma is allowed");
        require(_reBalancer == reBalancer, "only rebalancer is allowed");

        (int256 limitPrice, uint256 deadline) = abi.decode(data, (int256, uint256));
        int256 fundingPNL = getFundingPNL();

        (int256 tradePrice, int256 totalFee, ) = liquidityPool.queryTrade(
            perpetualIndex,
            address(this),
            amount,
            referrer,
            0
        );
        int256 deltaCash = amount.abs().wmul(tradePrice);
        uint256 collateralAmount = (deltaCash + totalFee).toUint256();
        if (amount < 0) {
            realizedFundingPNL -= collateralAmount.toInt256();
        } else {
            realizedFundingPNL += collateralAmount.toInt256();
        }

        int256 difference = fundingPNL - realizedFundingPNL;
        //error +-10**12 is allowed in calculation
        require(difference.abs() <= 10**12, "not allowed");

        liquidityPool.trade(perpetualIndex, address(this), amount, limitPrice, deadline, referrer, 0);

        return true;
    }

    /// @notice calculate entryFunding to be able to calculate the fundingPNL easily
    /// @param position Current position on MCDEX
    /// @param tradeAmount Change in current position on MCDEX
    function updateEntryFunding(int256 position, int256 tradeAmount) internal {
        (int256 closeAmount, int256 openAmount) = Utils.splitAmount(position, tradeAmount);
        int256 unitAccumulativeFunding;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            unitAccumulativeFunding = nums[4];
        }
        if (closeAmount != 0) {
            int256 oldPosition = position;
            int256 newPosition = position + closeAmount;
            entryFunding = entryFunding.wmul(newPosition).wdiv(oldPosition);
        }
        if (openAmount != 0) {
            entryFunding = entryFunding + unitAccumulativeFunding.wmul(openAmount);
        }
    }

    /// @notice Get funding PnL for this address till now
    /// @return fundingPNL Funding PnL accumulated till now
    function getFundingPNL() public view returns (int256 fundingPNL) {
        int256 unitAccumulativeFunding;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            unitAccumulativeFunding = nums[4];
        }
        (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));
        fundingPNL = entryFunding - position.wmul(unitAccumulativeFunding);
    }

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

    ///@notice send MCB tokens that we may get to lemmaTreasury
    function sendMCBToTreasury() external {
        IERC20Upgradeable mcbToken = IERC20Upgradeable(0x4e352cF164E64ADCBad318C3a1e222E9EBa4Ce42);
        address lemmaTreasury = IUSDLemma(usdLemma).lemmaTreasury();
        SafeERC20Upgradeable.safeTransfer(mcbToken, lemmaTreasury, mcbToken.balanceOf(address(this)));
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
