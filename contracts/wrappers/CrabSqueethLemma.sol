pragma solidity =0.8.3;

import { SafeCastUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC2771ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { IPerpetualDEXWrapper } from "../interfaces/IPerpetualDEXWrapper.sol";
import { ICrabStrategy } from "../interfaces/Squeeth/ICrabStrategy.sol";
import { IController, Vault } from "../interfaces/Squeeth/IController.sol";
import { IWETH9 } from "../interfaces/Squeeth/IWETH9.sol";
import { IOracle } from "../interfaces/Squeeth/IOracle.sol";
import { SafeMathExt } from "../libraries/SafeMathExt.sol";

import "hardhat/console.sol";

/// @author Lemma Finance
contract CrabSqueethLemma is OwnableUpgradeable, ERC2771ContextUpgradeable, IPerpetualDEXWrapper {
    using SafeCastUpgradeable for uint256;
    using SafeCastUpgradeable for int256;
    using SafeMathExt for uint256;

    uint256 public constant MAX_UINT256 = type(uint256).max;
    int256 public constant MAX_INT256 = type(int256).max;
    uint32 public constant TWAP_PERIOD_ORACLE = 420 seconds;

    ICrabStrategy public crabStratergy;
    IController public powerTokenController;

    IERC20Upgradeable public collateral;
    uint256 public collateralDecimals;

    address public reBalancer;
    address public referrer;

    int256 public entryFunding;
    int256 public realizedFundingPNL;

    uint256 public positionAtSettlement;

    uint256 public maxPosition;

    address public wSqueeth;
    address public dai;
    address public ethDaiPool;
    address public wSqueethPool;
    address public oracle;

    //events
    event RebalancerUpdated(address rebalancerAddress);
    event MaxPositionUpdated(uint256 maxPos);

    function initialize(
        address _trustedForwarder,
        ICrabStrategy _crabStratergy,
        address _reBalancer,
        address _dai,
        address _ethDaiPool,
        address _wSqueethPool,
        address _oracle,
        uint256 _maxPosition
    ) external initializer {
        __Ownable_init();
        __ERC2771Context_init(_trustedForwarder);
        crabStratergy = _crabStratergy;
        wSqueeth = crabStratergy.wPowerPerp();
        wSqueethPool = _wSqueethPool;
        collateral = IERC20Upgradeable(_crabStratergy.weth());
        dai = _dai;
        ethDaiPool = _ethDaiPool;
        oracle = _oracle;
        powerTokenController = _crabStratergy.powerTokenController();
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

    function openWExactCollateralForSqueeth(uint256 _ethToDeposit, uint256 msgValue) external override returns (uint256 USDLToMint) {
        console.log('openWExactCollateral-ethBalance0: ', collateral.balanceOf(address(this)));
        IWETH9(address(collateral)).withdraw(msgValue);
        console.log('openWExactCollateral-ethBalance1: ', address(this).balance);
        //TODO: find out ethToDeposit given msgValue so that there is no dust eth left
        uint256 userCrabBalanceBefore = crabStratergy.balanceOf(address(this));
        crabStratergy.flashDeposit{ value: msgValue }(_ethToDeposit);
        uint256 userCrabBalanceAfter = crabStratergy.balanceOf(address(this));
        //TODO: how much USDLToMint?
        console.log('collateralAmount1: ', msgValue);
        msgValue = msgValue - address(this).balance;
        console.log('collateralAmount1: ', msgValue);
        uint256 wSqueethPrice = getPrice(wSqueethPool, wSqueeth, address(collateral));
        console.log('wSqueethPrice: ', wSqueethPrice);
        uint256 wSqueethMint = getWSqueethMint(userCrabBalanceAfter - userCrabBalanceBefore);
        console.log('openWExactCollateral-wSqueethMint: ', wSqueethMint);
        uint256 totalEth = wSqueethMint.wmul(wSqueethPrice);
        console.log('openWExactCollateral-totalEth: ', totalEth);

        uint256 squeethUsd = (totalEth * getPrice(ethDaiPool, address(collateral), dai)) / 1e18;
        USDLToMint = (_ethToDeposit * getPrice(ethDaiPool, address(collateral), dai)) / 1e18;
        console.log('openWExactCollateral-squeethUsd: ', squeethUsd, USDLToMint, USDLToMint - squeethUsd);
        USDLToMint = USDLToMint- squeethUsd;
        console.log('openWExactCollateral-USDLToMint: ', USDLToMint);
        console.log('openWExactCollateral-ethBalance2: ', address(this).balance);
    }

    //go long and withdraw collateral
    /// @notice Close short position on dex and withdraw collateral
    /// @param amount worth in USD short position which is to be closed
    /// @param collateralAmountToGetBack collateral amount freed up after closing the position
    function close(uint256 amount, uint256 collateralAmountToGetBack) external override {}
    function closeWExactCollateral(uint256 collateralAmount) external override returns (uint256 USDLToBurn) {}

    function closeWExactCollateralForSqueeth(uint256 _crabAmount, uint256 _maxEthToPay) external override returns (uint256 USDLToBurn) {
        crabStratergy.flashWithdraw(_crabAmount, _maxEthToPay);
        USDLToBurn = (_maxEthToPay * getPrice(ethDaiPool, address(collateral), dai)) / 1e18;
        console.log('closeWExactCollateral-USDLToBurn: ', USDLToBurn);
    }

    // function closeWExactCollateral(uint256 collateralAmount) external override returns (uint256 USDLToBurn) {
    //     // crabStratergy.flashWithdraw(_crabAmount, _maxEthToPay);
    //     // USDLToBurn = (collateralAmount * getPrice(ethDaiPool, address(collateral), dai)) / 1e18;
    // }

    function getPrice(address pool, address tokenIn, address tokenOut) public view returns(uint256 ethPriceInUSD) {
        ethPriceInUSD = IOracle(oracle).getTwap(
            pool,
            tokenIn,
            tokenOut,
            TWAP_PERIOD_ORACLE,
            true
        );
        console.log('ethPriceInUSD: ', ethPriceInUSD);
    }

    function getWSqueethMint(uint256 crabBalance) public view returns(uint256) {
        uint256 crabTotalSupply = crabStratergy.totalSupply();
        uint256 vaultId = crabStratergy.vaultId();
        Vault memory strategyVault = powerTokenController.vaults(vaultId);
        uint128 shortAmount = strategyVault.shortAmount;
        uint256 crabRatio = crabBalance.wdiv(crabTotalSupply);
        uint256 wSqueethMint = crabRatio.wmul(shortAmount);
        console.log('wSqueethMint:', wSqueethMint);
        return wSqueethMint;
    } 


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

    receive() external payable {
        // require(msg.sender == address(collateral), "only weth9 is allowed");
    }
}
