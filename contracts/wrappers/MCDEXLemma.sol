// SPDX-License-Identifier: MIT
pragma solidity =0.8.3;

import { ILiquidityPool } from "../interfaces/MCDEX/ILiquidityPool.sol";
import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { Utils } from "../libraries/Utils.sol";

contract MCDEXLemma is OwnableUpgradeable, ERC2771ContextUpgradeable {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;

    uint256 public constant MAX_UINT256 = type(uint256).max;
    int256 public constant EXP_SCALE = 10**18;
    uint256 public constant UEXP_SCALE = 10**18;
    uint32 internal constant MASK_USE_TARGET_LEVERAGE = 0x08000000;

    // address of Mai3 liquidity pool
    ILiquidityPool public liquidityPool;

    // pereptual index in the liquidity pool
    uint256 public perpetualIndex;

    IERC20Upgradeable public collateral;
    uint256 public collateralDecimals;

    bool public isSettled;

    address public usdLemma;
    address public reBalancer;

    int256 entryFunding;

    function initialize(
        address _trustedForwarder,
        ILiquidityPool _liquidityPool,
        uint256 _perpetualIndex,
        address _usdlemma,
        address _reBalancer
    ) external initializer {
        __Ownable_init();
        __ERC2771Context_init(_trustedForwarder);
        liquidityPool = _liquidityPool;
        perpetualIndex = _perpetualIndex;
        (bool isRunning, , address[7] memory addresses, , uint256[4] memory uintNums) = liquidityPool
        .getLiquidityPoolInfo();
        require(isRunning, "pool is not running");
        collateral = IERC20Upgradeable(addresses[5]);
        collateralDecimals = uintNums[0];
        isSettled = false;

        reBalancer = _reBalancer;
        setUSDLemma(_usdlemma);

        //approve collateral to
        //TODO: use SafeERC20Upgreadeable
        collateral.approve(address(liquidityPool), MAX_UINT256);
        //target leverage = 1
        liquidityPool.setTargetLeverage(perpetualIndex, address(this), EXP_SCALE);
    }

    function setUSDLemma(address _usdlemma) public onlyOwner {
        usdLemma = _usdlemma;
    }

    //go short to open
    function open(uint256 amount) public {
        //check if msg.sender == usdLemma
        liquidityPool.forceToSyncState();
        uint256 collateralRequiredAmount = getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
        liquidityPool.deposit(perpetualIndex, address(this), collateralRequiredAmount.toInt256());

        (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

        int256 deltaPosition = liquidityPool.trade(
            perpetualIndex,
            address(this),
            -amount.toInt256(), //negative means you want to go short
            0,
            MAX_UINT256,
            address(0),
            0
        );
        updateEntryFunding(position, -amount.toInt256());
    }

    function getCollateralAmountGivenUnderlyingAssetAmount(uint256 amount, bool isShorting)
        public
        view
        returns (uint256 collateralAmountRequired)
    {
        int256 tradeAmount = isShorting ? -amount.toInt256() : amount.toInt256();
        //TODO: use the new interface and consider to total fees in the cost as well
        (int256 deltaCash, int256 deltaPosition) = liquidityPool.queryTradeWithAMM(perpetualIndex, -tradeAmount);
        collateralAmountRequired = isShorting ? (-deltaCash).toUint256() : deltaCash.toUint256();
    }

    //go long and withdraw collateral
    function close(uint256 amount) external {
        //check if msg.sender == usdLemma
        liquidityPool.forceToSyncState();

        uint256 collateralAmountRequired = getCollateralAmountGivenUnderlyingAssetAmount(amount, false);
        (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

        int256 deltaPosition = liquidityPool.trade(
            perpetualIndex,
            address(this),
            amount.toInt256(),
            type(int256).max,
            MAX_UINT256,
            address(0),
            0
        );
        liquidityPool.withdraw(perpetualIndex, address(this), collateralAmountRequired.toInt256());
        collateral.transfer(usdLemma, collateralAmountRequired);

        updateEntryFunding(position, amount.toInt256());
    }

    //TODO:implement the reBalancing mechanism
    function reBalance() public {
        require(_msgSender() == reBalancer);
        //find out the fundingPayment mcdexLemma got
        //if fundingPayment == 0
        //else if fundingPayment < 0, open(fundingPayment)
        //else close(fundingPayment)
        int256 unitAccumulativeFunding;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            unitAccumulativeFunding = nums[4];
        }
        (, int256 position, , , , , , , ) = liquidityPool.getMarginAccount(perpetualIndex, address(this));

        int256 fundingPNL = entryFunding - position * unitAccumulativeFunding;
    }

    function updateEntryFunding(int256 position, int256 tradeAmount) internal {
        (int256 close, int256 open) = Utils.splitAmount(position, tradeAmount);
        int256 unitAccumulativeFunding;
        {
            (, , int256[39] memory nums) = liquidityPool.getPerpetualInfo(perpetualIndex);
            unitAccumulativeFunding = nums[4];
        }
        if (close != 0) {
            int256 oldPosition = position;
            int256 newPosition = position + close;
            entryFunding = (entryFunding * newPosition) / oldPosition;
        }
        if (open != 0) {
            entryFunding = entryFunding + unitAccumulativeFunding * open;
        }
    }

    function getAmountInCollateralDecimals(int256 amount) internal view returns (int256) {
        return amount / int256(10**(18 - collateralDecimals));
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
