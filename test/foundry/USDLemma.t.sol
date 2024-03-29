// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

import {IPerpetualMixDEXWrapper} from "../../contracts/interfaces/IPerpetualMixDEXWrapper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../../contracts/interfaces/IERC20Decimals.sol";
import "../../src/Deploy.sol";
// import "./mocks/MockChainlinkAggregator.sol";

import "./mocks/MockPriceFeed.sol";
import "forge-std/Test.sol";

struct Operation {
    bool isMintUSDL;
    address collateral;
    uint256 amount;
}

contract USDLemmaTest is Test {
    Deploy public d;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant LEMMA_SWAP = keccak256("LEMMA_SWAP");
    bytes32 public constant USDC_TREASURY = keccak256("USDC_TREASURY");
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    address public addrChainLinkPriceFeedForETH;

    int256[] public trace;
    uint256 nextOracleUpdate;

    // MockAggregatorProxy public mockOracleAggregatorProxy;
    MockPriceFeed public mockPriceFeed;

    Operation[] operations;

    constructor() {
        // NOTE: Loads default trace
        _loadTrace();

        // NOTE: Address used to call the setter methods
        address perpOwner = address(0x76Ff908b6d43C182DAEC59b35CebC1d7A17D8086);
        address baseTokenMarket = address(0x8C835DFaA34e2AE61775e80EE29E2c724c6AE2BB);
        mockPriceFeed = new MockPriceFeed();
        mockPriceFeed.setRealPriceFeed(IBaseTokenSetter(baseTokenMarket).getPriceFeed());
        vm.startPrank(IBaseTokenSetter(baseTokenMarket).owner());
        console.log("Trying to set Mock Oracle");
        IBaseTokenSetter(baseTokenMarket).setPriceFeed(address(mockPriceFeed));
        console.log("Trying to set Mock Oracle DONE");
        vm.stopPrank();
    }

    function _mineBlock() internal {
        console.log("_mineBlock()");
        if (nextOracleUpdate < trace.length) {
            uint256 dt = uint256(trace[nextOracleUpdate]);
            int256 dp = trace[nextOracleUpdate + 1];
            console.log("_mineBlock() dt = ", dt);
            print("_mineBlock() dp = ", dp);
            mockPriceFeed.advancePerc(dt, dp);
            nextOracleUpdate += 2;
        }
    }

    function print(string memory s, int256 x) internal view {
        console.log(s, (x < 0) ? "-" : "+", (x < 0) ? uint256(-x) : uint256(x));
    }

    // Source
    // https://ethereum.stackexchange.com/questions/884/how-to-convert-an-address-to-bytes-in-solidity
    function _fromAddrToBytes32(address addr) internal returns (bytes32) {
        return bytes32(uint256(uint160(addr)) << 96);
    }

    function _loadTrace() internal /*string memory n, string memory id*/ {
        string[] memory temp = new string[](2);
        temp[0] = "node";
        temp[1] = "test/foundry/utils/read_config.js";
        // temp[2] = n;
        // temp[3] = id;
        trace = abi.decode(vm.ffi(temp), (int256[]));
        // console.log(trace);
    }

    function setUp() public {
        // _loadTrace(/*"3", "0"*/);

        // NOTE: The aggregator address should be in slot 0 so
        // https://optimistic.etherscan.io/address/0x94740ca2c47e13b7b0d3f44fc552ecc880e1d824#code#F1#L14
        // addrChainLinkPriceFeedForETH = address(0x94740cA2c47E13b7b0d3F44FC552Ecc880e1d824);
        // mockOracleAggregatorProxy = new MockAggregatorProxy();
        // mockOracleAggregatorProxy.setRealAggregator(addrChainLinkPriceFeedForETH);
        // uint256 slotAggregatorAddress = uint256(0);
        // vm.store(addrChainLinkPriceFeedForETH, bytes32(slotAggregatorAddress), _fromAddrToBytes32(address(mockOracleAggregatorProxy)));
        delete operations;

        d = new Deploy(10);
        vm.startPrank(address(d));
        d.pl().grantRole(USDC_TREASURY, address(d.lemmaTreasury()));
        d.pl().grantRole(USDC_TREASURY, address(this));
        d.pl().setPercFundingPaymentsToUSDLHolders(0.5e6);
        d.pl().setXUsdl(address(d.xUsdl()));
        d.pl().setXSynth(address(d.xSynth()));
        d.usdl().grantRole(LEMMA_SWAP, address(this));
        d.usdl().addPerpetualDEXWrapper(1, d.getTokenAddress("USDC"), address(d.pl()));
        d.lemmaTreasury().grantRole(OWNER_ROLE, address(d.usdl()));
        vm.stopPrank();

        _getMoneyForTo(address(d.settlementTokenManager()), address(d.pl().usdc()), 1e18);
    }

    // Internal Functions
    function _deductFees(address collateral, uint256 collateralAmount, uint256 dexIndex)
        internal
        view
        returns (uint256 total)
    {
        uint256 _fees = (collateralAmount * d.usdl().getFees(dexIndex, collateral)) / 1e6;
        total = uint256(int256(collateralAmount) - int256(_fees));
    }

    function _getMoney(address token, uint256 amount) internal {
        d.bank().giveMoney(token, address(this), amount);
        assertTrue(IERC20Decimals(token).balanceOf(address(this)) >= amount);
    }

    function _getMoneyForTo(address to, address token, uint256 amount) internal {
        d.bank().giveMoney(token, to, amount);
        assertTrue(IERC20Decimals(token).balanceOf(to) >= amount);
    }

    // NOTE: Deposits settlementToken amount as percentage of the remaining availability so 100% is equivalent to max settlementToken
    function _depositSettlementTokenPerc(uint256 perc1e6) internal {
        _getMoney(address(d.pl().usdc()), 1e40);

        IERC20Decimals settlementToken = IERC20Decimals(d.pl().perpVault().getSettlementToken());
        uint256 perpVaultSettlementTokenBalanceBefore = settlementToken.balanceOf(address(d.pl().perpVault()));
        uint256 settlementTokenBalanceCap =
            IClearingHouseConfig(d.pl().clearingHouse().getClearingHouseConfig()).getSettlementTokenBalanceCap();
        uint256 maxUSDCToDeposit =
            uint256(int256(settlementTokenBalanceCap) - int256(perpVaultSettlementTokenBalanceBefore));
        uint256 usdcToDeposit = (maxUSDCToDeposit * perc1e6) / 1e6;
        console.log("[_depositSettlementTokenPerc()] maxUSDCToDeposit = ", maxUSDCToDeposit);
        console.log("[_depositSettlementTokenPerc()] usdcToDeposit = ", usdcToDeposit);
        console.log(
            "[_depositSettlementTokenPerc()] perpVaultSettlementTokenBalanceBefore = ",
            perpVaultSettlementTokenBalanceBefore
        );

        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get
        // V_GTSTBC: greater than settlement token balance cap

        d.pl().usdc().approve(address(d.pl()), usdcToDeposit);
        d.pl().depositSettlementToken(usdcToDeposit);

        uint256 perpVaultSettlementTokenBalanceAfter = settlementToken.balanceOf(address(d.pl().perpVault()));
        console.log(
            "[_depositSettlementTokenPerc()] perpVaultSettlementTokenBalanceAfter = ",
            perpVaultSettlementTokenBalanceAfter
        );
        uint256 delta = perpVaultSettlementTokenBalanceAfter - perpVaultSettlementTokenBalanceBefore;
        require(delta == usdcToDeposit, "Delta is different");

        // d.pl().usdc().approve(address(d.pl()), settlementTokenBalanceCap/10);
        // d.pl().depositSettlementToken(settlementTokenBalanceCap/10);
    }

    function _depositSettlementToken(uint256 amount) internal {
        _getMoney(address(d.pl().usdc()), 1e40);

        IERC20Decimals settlementToken = IERC20Decimals(d.pl().perpVault().getSettlementToken());
        uint256 perpVaultSettlementTokenBalanceBefore = settlementToken.balanceOf(address(d.pl().perpVault()));
        console.log(
            "[_depositSettlementTokenPerc()] perpVaultSettlementTokenBalanceBefore = ",
            perpVaultSettlementTokenBalanceBefore
        );

        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get
        // V_GTSTBC: greater than settlement token balance cap
        d.pl().usdc().approve(address(d.pl()), amount);
        d.pl().depositSettlementToken(amount);
        uint256 perpVaultSettlementTokenBalanceAfter = settlementToken.balanceOf(address(d.pl().perpVault()));
        uint256 delta = perpVaultSettlementTokenBalanceAfter - perpVaultSettlementTokenBalanceBefore;
        require(delta == amount, "Delta is different");
    }

    function _depositSettlementTokenMax() internal {
        _getMoney(address(d.pl().usdc()), 1e40);
        IERC20Decimals settlementToken = IERC20Decimals(d.pl().perpVault().getSettlementToken());
        uint256 perpVaultSettlementTokenBalanceBefore = settlementToken.balanceOf(address(d.pl().perpVault()));
        uint256 settlementTokenBalanceCap =
            IClearingHouseConfig(d.pl().clearingHouse().getClearingHouseConfig()).getSettlementTokenBalanceCap();
        uint256 usdcToDeposit =
            uint256(int256(settlementTokenBalanceCap) - int256(perpVaultSettlementTokenBalanceBefore));
        // uint256 settlementTokenBalanceCap = IClearingHouseConfig(d.getPerps().ch.getClearingHouseConfig()).getSettlementTokenBalanceCap();
        // NOTE: Unclear why I need to use 1/10 of the cap
        // NOTE: If I do not limit this amount I get
        // V_GTSTBC: greater than settlement token balance cap
        d.pl().usdc().approve(address(d.pl()), usdcToDeposit);
        d.pl().depositSettlementToken(usdcToDeposit);
    }

    // USDLemma Functions To test

    function depositIntoVault(uint256 amount, address to) internal {
        _getMoneyForTo(to, address(d.pl().usdc()), amount);
        d.pl().usdc().approve(address(d.getPerps().pv), type(uint256).max);
        d.getPerps().pv.deposit(address(d.pl().usdc()), amount);
    }

    function _mintUSDLWExactUSDL(address to, address collateral, uint256 amount, uint256 dexIndex) internal {
        address usdl = d.pl().usdLemma();
        _getMoneyForTo(to, collateral, amount);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(usdl, type(uint256).max);
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        // 4th param is maxCollateralAmountRequired which is need to be set using callStatic, currently set uint256 max
        // calsstatic is not possible in solidity so
        d.usdl().depositTo(to, amount, dexIndex, type(uint256).max, IERC20Upgradeable(collateral));
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        assertEq(afterTotalUsdl - beforeTotalUsdl, afterBalanceUSDL);
        assertEq(afterBalanceUSDL, beforeBalanceUSDL + amount);
        assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    }

    function _mintUSDLWExactCollateral(address to, address collateral, uint256 amount, uint256 dexIndex) internal {
        address usdl = d.pl().usdLemma();
        _getMoneyForTo(to, collateral, amount);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(usdl, type(uint256).max);
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        // 4th param is minUSDLToMint which is need to be set using callStatic, currently set 0 for not breaking revert
        // calsstatic is not possible in solidity so
        d.usdl().depositToWExactCollateral(to, amount, dexIndex, 0, IERC20Upgradeable(collateral));
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        assertEq(afterTotalUsdl - beforeTotalUsdl, afterBalanceUSDL);
        assertTrue(afterBalanceUSDL > beforeBalanceUSDL);
        assertEq(
            afterBalanceCollateral,
            beforeBalanceCollateral - d.pl().getAmountInCollateralDecimalsForPerp(amount, collateral, false)
        );
    }

    function _mintUSDLWExactCollateralNoChecks(address to, address collateral, uint256 amount) internal {
        console.log("[_mintUSDLWExactCollateralNoChecks()] Start");
        address usdl = d.pl().usdLemma();
        _getMoneyForTo(to, collateral, amount);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(usdl, type(uint256).max);
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        // 4th param is minUSDLToMint which is need to be set using callStatic, currently set 0 for not breaking revert
        // calsstatic is not possible in solidity so
        d.usdl().depositToWExactCollateral(to, amount, 0, 0, IERC20Upgradeable(collateral));
        console.log("[_mintUSDLWExactCollateralNoChecks()] End");
        // uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        // uint256 afterBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        // uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
    }

    function _redeemUSDLWExactUsdl(address to, address collateral, uint256 amount, uint256 dexIndex) internal {
        address usdl = d.pl().usdLemma();
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        assertTrue(beforeBalanceUSDL > 0, "!USDL");
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        d.usdl().withdrawTo(to, amount, dexIndex, 0, IERC20Upgradeable(collateral));
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 afterBalanceUSDL = d.usdl().balanceOf(to);
        assertEq(beforeTotalUsdl - afterTotalUsdl, amount);
        assertTrue(afterBalanceCollateral > beforeBalanceCollateral);
        assertEq(afterBalanceUSDL, beforeBalanceUSDL - amount);
    }

    function _redeemUSDLWExactCollateral(address to, address collateral, uint256 collateralAmount, uint256 dexIndex)
        internal
    {
        address usdl = d.pl().usdLemma();
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 beforeBalanceUSDL = IERC20Decimals(usdl).balanceOf(to);
        assertTrue(beforeBalanceUSDL > 0, "!USDL");
        uint256 beforeTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        d.usdl().withdrawToWExactCollateral(
            to, collateralAmount, dexIndex, type(uint256).max, IERC20Upgradeable(collateral)
        );
        uint256 afterTotalUsdl = d.pl().mintedPositionUsdlForThisWrapper();
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        uint256 afterBalanceUSDL = d.usdl().balanceOf(to);
        assertEq(beforeTotalUsdl - afterTotalUsdl, beforeBalanceUSDL - afterBalanceUSDL);
        assertEq(
            afterBalanceCollateral,
            beforeBalanceCollateral + d.pl().getAmountInCollateralDecimalsForPerp(collateralAmount, collateral, false)
        );
        assertTrue(afterBalanceUSDL < beforeBalanceUSDL);
    }

    function _mintSynthWExactCollateralNoChecks(address to, address collateral, uint256 amount, uint256 dexIndex)
        internal
    {
        address lemmaSynth = d.pl().lemmaSynth();
        _getMoneyForTo(to, collateral, amount);
        uint256 beforeBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        uint256 beforeBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        IERC20Decimals(collateral).approve(lemmaSynth, type(uint256).max);
        uint256 beforeTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 decimal = IERC20Decimals(collateral).decimals();
        amount = (amount * 1e18) / 10 ** decimal;
        // 4th param is minSynthToMint which is need to be set using callStatic, currently set 0 for not breaking revert
        // calsstatic is not possible in solidity so
        d.lSynth().depositToWExactCollateral(to, amount, dexIndex, 0, IERC20Upgradeable(collateral));
        uint256 afterTotalSynth = d.pl().mintedPositionSynthForThisWrapper();
        uint256 afterBalanceSynth = IERC20Decimals(lemmaSynth).balanceOf(to);
        uint256 afterBalanceCollateral = IERC20Decimals(collateral).balanceOf(to);
        // assertEq(afterTotalSynth-beforeTotalSynth, afterBalanceSynth);
        // assertTrue(afterBalanceSynth > beforeBalanceSynth);
        // assertTrue(afterBalanceCollateral < beforeBalanceCollateral);
    }

    // test depositTo
    function testDepositTo() public {
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = 1000e18; // USDL amount
        _depositSettlementTokenMax();
        _mintUSDLWExactUSDL(address(this), collateral, usdlAmount, 0);
    }

    function _depositWExactCollateral(uint256 collateralAmount) internal {
        _depositSettlementTokenMax();
        address collateral = d.getTokenAddress("WETH");
        _mintUSDLWExactCollateral(address(this), collateral, collateralAmount, 0);
    }

    // test depositToWExactCollateral
    function testDepositToWExactCollateral1() public {
        _depositWExactCollateral(1e18);
    }

    // test depositToWExactCollateral
    function testDepositToWExactCollateral3() public {
        _depositWExactCollateral(1e18);
        address collateral = d.getTokenAddress("WETH");
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, 3e18);
    }

    function testDepositToWExactCollateralNoNeedToRecap() public {
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        vm.stopPrank();

        // d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        _depositSettlementToken(1e12);

        uint256 freeCollateralBefore = d.pl().getFreeCollateral();

        // NOTE: Limit for recap needed
        // _depositSettlementToken(328392000);

        address collateral = d.getTokenAddress("WETH");
        uint256 amount = 3e18;
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);

        uint256 freeCollateralAfter = d.pl().getFreeCollateral();

        // NOTE: After minting, we get some extra collaterals that is less than the initial one but still positive
        assertTrue(freeCollateralAfter < freeCollateralBefore);
        assertTrue(freeCollateralAfter > 0);
    }

    function testFailDepositToWExactCollateralNeedRecap() public {
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        vm.stopPrank();

        // d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        _depositSettlementToken(1e5);

        // NOTE: Limit for recap needed
        // _depositSettlementToken(328392000);

        address collateral = d.getTokenAddress("WETH");
        uint256 amount = 3e18;
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);
    }

    function testDepositToWExactCollateralStartNeutralNeedToRecap() public {
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));

        // NOTE: Let's try to use 100% collateral ratio
        d.pl().setCollateralRatio(1e6);
        vm.stopPrank();

        d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        _depositSettlementToken(300000000);

        // _depositSettlementToken(328392000);
        address collateral = d.getTokenAddress("WETH");
        uint256 amount = 3e18;
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);

        // NOTE: In this case, Perp has been recapitalized during the minting and the recap set the Free Collateral exactly to zero so it is important
        // to add further logic to recapitalize further
        // assertTrue(d.pl().getFreeCollateral() == 0);
    }

    function testDepositToWExactCollateralStartShortNeedToRecap1() public {
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        // NOTE: Let's try to use 100% collateral ratio
        d.pl().setCollateralRatio(1e6);
        vm.stopPrank();

        d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        _depositSettlementToken(300000000);

        address collateral = d.getTokenAddress("WETH");
        // NOTE: Minting just a little bit of USDL to start with a net short position
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, 1e15);

        // _depositSettlementToken(328392000);
        uint256 amount = 3e18;
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);

        // NOTE: In this case, Perp has been recapitalized during the minting and the recap set the Free Collateral exactly to zero so it is important
        // to add further logic to recapitalize further
        // assertTrue(d.pl().getFreeCollateral() == 0);
    }

    // function _advancePerc(uint256 deltaT, int256 pricePerc) internal returns(uint256 nextPrice) {
    //     console.log("[_advancePerc()] Current Price = ", d.pl().getIndexPrice());
    //     nextPrice = uint256(int256(d.pl().getIndexPrice()) * (int256(1e6) + pricePerc) / 1e6);
    //     console.log("[_advancePerc()] nextPrice = ", nextPrice);
    //     // nextPrice = mockOracleAggregatorProxy.getLatestAnswer() * (1e6 + pricePerc) / 1e6;
    //     vm.warp(block.timestamp + deltaT);
    //     mockPriceFeed.setPriceFromPriceFeed(nextPrice);
    //     // mockOracleAggregatorProxy.advance(deltaT, nextPrice);
    // }

    function testDynamicDepositToWExactCollateralStartShortNeedToRecap1() public {
        console.log("T1 ", d.pl().usdlBaseTokenAddress());
        // console.log("8 hours = ", 8 hours);
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        // NOTE: Let's try to use 100% collateral ratio
        d.pl().setCollateralRatio(1e6);
        vm.stopPrank();

        d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        console.log("[testDepositToWExactCollateralNeedToRecap()] Start");
        _depositSettlementToken(300000000);

        address collateral = d.getTokenAddress("WETH");
        // NOTE: Minting just a little bit of USDL to start with a net short position
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, 1e15);

        console.log("Price Before = ", d.pl().getIndexPrice());
        // NOTE: Let's move forward of 1 day with a +0.1% price change
        _mineBlock();
        // mockPriceFeed.advancePerc(8 hours, 1e3);
        // _advancePerc(8 hours, 1e3);
        console.log("Price After 8h = ", d.pl().getIndexPrice());

        // _depositSettlementToken(328392000);
        uint256 amount = 3e18;
        console.log("[testDepositToWExactCollateralNeedToRecap()] amount = ", amount);
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);

        _mineBlock();
        // mockPriceFeed.advancePerc(8 hours, 1e3);
        // _advancePerc(8 hours, 3e4);
        console.log("Price After 16h = ", d.pl().getIndexPrice());

        console.log("[testDepositToWExactCollateralNeedToRecap()] amount = ", amount);
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);

        _mineBlock();
        // mockPriceFeed.advancePerc(8 hours, 5e4);
        // _advancePerc(8 hours, 5e4);
        console.log("Price After 24h = ", d.pl().getIndexPrice());

        console.log("[testDepositToWExactCollateralNeedToRecap()] amount = ", amount);
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);

        console.log("[testDepositToWExactCollateralNeedToRecap()] Minting Works");
    }

    function testDepositToWExactCollateralStartLongNeedToRecapSmallFlip() public {
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        // NOTE: Let's try to use 100% collateral ratio
        d.pl().setCollateralRatio(1e6);
        vm.stopPrank();

        d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        _depositSettlementToken(300000000);

        address collateral = d.getTokenAddress("USDC");
        // NOTE: Minting just a little bit of USDL to start with a net short position
        _mintSynthWExactCollateralNoChecks(address(this), collateral, 5e6, 0); // 5e18 is usdc(which should be convert in 6 decimal)

        _mineBlock();

        // _depositSettlementToken(328392000);
        collateral = d.getTokenAddress("WETH");
        uint256 amount = 3e18;
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, amount);

        // NOTE: In this case, Perp has been recapitalized during the minting and the recap set the Free Collateral exactly to zero so it is important
        // to add further logic to recapitalize further
        console.log(
            "[testDepositToWExactCollateralStartLongNeedToRecapLargeFlip2()] d.pl().getFreeCollateral() = ",
            d.pl().getFreeCollateral()
        );
        // assertTrue(d.pl().getFreeCollateral() == 0);
        console.log("[testDepositToWExactCollateralStartLongNeedToRecapLargeFlip2()] Minting Works");
    }

    function testFailDepositToWExactCollateralNoUSDC1() public {
        uint256 collateralAmount = 1e18;
        address collateral = d.getTokenAddress("WETH");
        _mintUSDLWExactCollateral(address(this), collateral, collateralAmount, 0);
    }

    // test depositTo and withdrawTo
    function testDepositToAndWithdrawTo11() public {
        testDepositTo();
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount, 0);
    }

    // test depositTo and withdrawTo
    function testDynamicDepositToAndWithdrawTo11() public {
        testDepositTo();
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = d.usdl().balanceOf(address(this));

        mockPriceFeed.advancePerc(8 hours, 20e4);
        // _advancePerc(8 hours, 20e4);
        console.log("Price After 8h = ", d.pl().getIndexPrice());
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount, 0);
    }

    // test depositToWExactCollateral and withdrawTo
    function testDepositToWExactCollateralAndwithdrawTo() public {
        uint256 collateralAmount = 1e12;
        _depositWExactCollateral(collateralAmount);
        _mineBlock();
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount, 0);
    }

    // test depositToWExactCollateral and withdrawToWExactCollateral
    function testDepositToWExactCollateralAndwithdrawToWExactCollateral() public {
        uint256 collateralAmount = 1e12;
        _depositWExactCollateral(collateralAmount);
        _mineBlock();
        address collateral = d.getTokenAddress("WETH");
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAmount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem, 0);
    }

    // test depositTo and withdrawToWExactCollateral
    function testDepositToAndWithdrawToWExactCollateral() public {
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = 2192283206913675032725; // 1eth ~= 1096.143 USDL at this block 12137998
        _depositSettlementTokenMax();
        _mineBlock();
        _mintUSDLWExactUSDL(address(this), collateral, usdlAmount, 0);
        uint256 collateralAMount = 1e18; // ~0.9998 eth
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAMount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem, 0);
    }

    // Should Fail tests
    // REVERT REASON: only lemmaswap is allowed
    function testFailDepositToAndWithdrawToWExactCollateral() public {
        vm.startPrank(address(d));
        d.usdl().revokeRole(LEMMA_SWAP, address(this));
        vm.stopPrank();
        address collateral = d.getTokenAddress("WETH");
        uint256 usdlAmount = 1096143206913675032725; // 1eth ~= 1096.143 USDL at this block 12137998
        _depositSettlementTokenMax();
        _mineBlock();
        _mintUSDLWExactUSDL(address(this), collateral, usdlAmount, 0);
        _mineBlock();
        uint256 collateralAMount = 1e18; // ~0.9998 eth
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAMount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem, 0);
    }

    function testFailDepositToWExactCollateralAndwithdrawToWExactCollateral() public {
        vm.startPrank(address(d));
        d.usdl().revokeRole(LEMMA_SWAP, address(this));
        vm.stopPrank();
        uint256 collateralAmount = 1e12;
        _depositWExactCollateral(collateralAmount);
        address collateral = d.getTokenAddress("WETH");
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("WETH"), collateralAmount, 0);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("WETH"), _collateralAfterMinting, 0);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem, 0);
    }

    function testChangeAdminOfUSDL() public {
        vm.startPrank(address(d));
        d.usdl().changeAdmin(vm.addr(1));
        vm.stopPrank();
        assertEq(d.usdl().hasRole(ADMIN_ROLE, vm.addr(1)), true);
        assertEq(d.usdl().hasRole(ADMIN_ROLE, address(d)), false);
    }

    // Should Fail tests
    // reason: DEX Wrapper should not ZERO address
    function testFailGetFees1() public view {
        d.usdl().getFees(0, address(0));
    }

    // reason: DEX Wrapper should not ZERO address
    function testFailGetFees2() public view {
        d.usdl().getFees(100, d.getTokenAddress("WETH"));
    }

    function testFailGetIndexPrice1() public view {
        d.usdl().getIndexPrice(100, d.getTokenAddress("WETH"));
    }

    function testFailGetIndexPrice2() public view {
        d.usdl().getIndexPrice(0, address(0));
    }

    function testFailGetTotalPosition1() public view {
        d.usdl().getTotalPosition(0, address(0));
    }

    function testFailGetTotalPosition2() public view {
        d.usdl().getTotalPosition(100, d.getTokenAddress("WETH"));
    }

    function testFailSetLemmaTreasury() public {
        d.usdl().setLemmaTreasury(address(0));
    }

    function testSetLemmaTreasury() public {
        vm.startPrank(address(d));
        d.usdl().setLemmaTreasury(vm.addr(1));
        address lemmaTreasury = d.usdl().lemmaTreasury();
        assertEq(lemmaTreasury, vm.addr(1));
        vm.stopPrank();
    }

    function testSetFees() public {
        vm.startPrank(address(d));
        d.usdl().setFees(1000);
        uint256 fees = d.usdl().fees();
        assertEq(fees, 1000);
        vm.stopPrank();
    }

    function testInitialization() public {
        assertEq(d.usdl().perpetualDEXWrappers(0, address(d.pl().usdlCollateral())), address(d.pl()));
    }

    function testAddWrapper() public {
        vm.startPrank(address(d));
        d.usdl().addPerpetualDEXWrapper(1, d.getTokenAddress("USDC"), vm.addr(1));
        address wrapper = d.usdl().perpetualDEXWrappers(1, d.getTokenAddress("USDC"));
        assertEq(wrapper, vm.addr(1));
        vm.stopPrank();
    }

    // reason: invalid DEX/collateral
    function testFailDepositTo1() public {
        d.usdl().depositTo(address(this), 1000, 0, 1, IERC20Decimals(address(0)));
    }

    // reason: collateral required execeeds maximum
    function testFailDepositTo2() public {
        _depositSettlementTokenMax();
        address collateral = d.getTokenAddress("WETH");
        _getMoneyForTo(address(this), collateral, 1000);
        IERC20Decimals(collateral).approve(address(d.usdl()), type(uint256).max);
        d.usdl().depositTo(address(this), 1000, 0, 0, IERC20Decimals(collateral));
    }

    // reason: invalid DEX/collateral
    function testFailDepositToWExactCollateral1() public {
        d.usdl().depositToWExactCollateral(address(this), 1000, 0, type(uint256).max, IERC20Decimals(address(0)));
    }

    // reason: USDL minted too low
    function testFailDepositToWExactCollateral2() public {
        _depositSettlementTokenMax();
        address collateral = d.getTokenAddress("WETH");
        _getMoneyForTo(address(this), collateral, 1000);
        IERC20Decimals(collateral).approve(address(d.usdl()), type(uint256).max);
        d.usdl().depositToWExactCollateral(address(this), 1000, 0, type(uint256).max, IERC20Decimals(collateral));
    }

    // reason: invalid DEX/collateral
    function testFailWithdrawTo1() public {
        d.usdl().withdrawTo(address(this), 1000, 0, 1, IERC20Decimals(address(0)));
    }

    // reason: ERC20: burn amount exceeds balance
    function testFailWithdrawTo2() public {
        address collateral = d.getTokenAddress("WETH");
        d.usdl().withdrawTo(address(this), 100e18, 0, type(uint256).max, IERC20Decimals(collateral));
    }

    // reason: Collateral to get back too low
    function testFailWithdrawTo3() public {
        testDepositTo();
        address collateral = d.getTokenAddress("WETH");
        d.usdl().withdrawTo(address(this), 100e18, 0, type(uint256).max, IERC20Decimals(collateral));
    }

    // reason: Settled vUSD position amount should not ZERO
    function testFailWithdrawToWithSettle1() public {
        address collateral = d.getTokenAddress("WETH");
        testDepositTo();
        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        d.pl().setMintedPositionUsdlForThisWrapper(0);
        d.usdl().withdrawTo(address(this), 100e18, 0, 0, IERC20Decimals(collateral));
    }

    function testWithdrawToWithSettle2() public {
        address collateral = d.getTokenAddress("WETH");
        testDepositTo();
        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        uint256 beforeBalance = IERC20Decimals(collateral).balanceOf(address(this));
        d.usdl().withdrawTo(address(this), 100e18, 0, 0, IERC20Decimals(collateral));
        uint256 afterBalance = IERC20Decimals(collateral).balanceOf(address(this));
        assertGe(afterBalance - beforeBalance, 0);
    }

    // reason: invalid DEX/collateral
    function testFailWithdrawToWExactCollateral1() public {
        d.usdl().withdrawToWExactCollateral(address(this), 1000, 0, 0, IERC20Decimals(address(0)));
    }

    // reason: Too much USDL to burn
    function testFailWithdrawToWExactCollateral2() public {
        testDepositTo();
        address collateral = d.getTokenAddress("WETH");
        d.usdl().withdrawToWExactCollateral(address(this), 1e17, 0, 0, IERC20Decimals(collateral));
    }

    // reason: hasSettled Error
    function testFailWithdrawToWExactCollateral3() public {
        address collateral = d.getTokenAddress("WETH");
        testDepositTo();
        address owner = d.getPerps().ib.owner();
        vm.startPrank(owner);
        d.getPerps().ib.pause(); // pause market
        vm.warp(block.timestamp + 6 days); // need to spend 5 days after pause as per perpv2
        d.getPerps().ib.close(); // Close market after 5 days
        vm.stopPrank();

        d.pl().settle(); // PerpLemma settle call
        d.usdl().withdrawToWExactCollateral(address(this), 1e17, 0, 0, IERC20Decimals(collateral));
    }

    // TEST with USDC collateral
    function testDepositToAndWithdrawToWithUSDC() public {
        address collateral = d.getTokenAddress("USDC");
        uint256 usdlAmount = 1000e18; // USDL amount
        // _depositSettlementTokenMax();
        _mintUSDLWExactUSDL(address(this), collateral, usdlAmount, 1);

        usdlAmount = d.usdl().balanceOf(address(this));
        _redeemUSDLWExactUsdl(address(this), collateral, usdlAmount, 1);
    }

    function testDepositToWExactCollateralAndwithdrawToWExactCollateralWithUSDC() public {
        vm.startPrank(address(d));
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        vm.stopPrank();
        _depositSettlementToken(1e12);

        uint256 collateralAmount = 1000e18; // USDCAmount
        // _depositSettlementTokenMax();
        address collateral = d.getTokenAddress("USDC");
        _mintUSDLWExactCollateral(address(this), collateral, collateralAmount, 1);
        uint256 _collateralAfterMinting = _deductFees(d.getTokenAddress("USDC"), collateralAmount, 1);
        uint256 _maxETHtoRedeem = _deductFees(d.getTokenAddress("USDC"), _collateralAfterMinting, 1);
        _redeemUSDLWExactCollateral(address(this), collateral, _maxETHtoRedeem, 1);
    }

    function testDistributeFR_ShowPendingFR1() public {
        console.log("T1 ", d.pl().usdlBaseTokenAddress());
        // console.log("8 hours = ", 8 hours);
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        // NOTE: Let's try to use 100% collateral ratio
        d.pl().setCollateralRatio(1e6);
        vm.stopPrank();

        d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        console.log("[testDistributeFR1()] Start");
        _depositSettlementToken(300000000);

        address collateral = d.getTokenAddress("WETH");
        // NOTE: Minting just a little bit of USDL to start with a net short position
        _mintUSDLWExactCollateralNoChecks(address(this), collateral, 1e15);

        console.log("[testDistributeFR1()] Price Before = ", d.pl().getIndexPrice());
        // NOTE: Let's move forward of 1 day with a +0.1% price change
        _mineBlock();
        // mockPriceFeed.advancePerc(8 hours, 1e3);
        // _advancePerc(8 hours, 1e3);
        print("[testDistributeFR1()] Pending Funding Payments = ", d.pl().getPendingFundingPayment());

        _mineBlock();
        // mockPriceFeed.advancePerc(8 hours, 1e3);
        // _advancePerc(8 hours, 1e3);
        print("[testDistributeFR1()] Pending Funding Payments = ", d.pl().getPendingFundingPayment());

        _mineBlock();
        // mockPriceFeed.advancePerc(8 hours, 1e3);
        // _advancePerc(8 hours, 1e3);
        print("[testDistributeFR1()] Pending Funding Payments = ", d.pl().getPendingFundingPayment());
    }

    function _printIndexMarkStatus() internal {
        console.log("[_getIndexMarkStatus()] T1 Index Price = ", d.pl().getIndexPrice());
        console.log("[_getIndexMarkStatus()] T1 Mark Price = ", d.pl().getMarkPrice());
        if (d.pl().getMarkPrice() < d.pl().getIndexPrice()) {
            console.log("[_getIndexMarkStatus()] T1 Shorts pay Longs = ");
        } else {
            console.log("[_getIndexMarkStatus()] T1 Longs pay Shorts = ");
        }
        print("[_getIndexMarkStatus()] T1 Pending Funding Payments = ", d.pl().getPendingFundingPayment());
    }

    function _init1() internal {
        console.log("[_init1()] Start");
        // console.log("T1 ", d.pl().usdlBaseTokenAddress());
        // console.log("8 hours = ", 8 hours);
        vm.startPrank(address(d));
        // d.pl().setMinMarginForRecap(3e18);
        // d.pl().setMinMarginSafeThreshold(5e18);
        d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        // NOTE: Let's try to use 100% collateral ratio
        d.pl().setCollateralRatio(1e6);
        vm.stopPrank();

        d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        console.log("[testDistributeFR_ShowPendingFRAndSettle()] Start");
        _depositSettlementToken(300000000);
    }

    function _test1(Operation memory operation) internal {
        // console.log("[_runOperation()] Start");
        // // console.log("T1 ", d.pl().usdlBaseTokenAddress());
        // // console.log("8 hours = ", 8 hours);
        // vm.startPrank(address(d));
        // // d.pl().setMinMarginForRecap(3e18);
        // // d.pl().setMinMarginSafeThreshold(5e18);
        // d.usdl().setLemmaTreasury(address(d.lemmaTreasury()));
        // // NOTE: Let's try to use 100% collateral ratio
        // d.pl().setCollateralRatio(1e6);
        // vm.stopPrank();

        // d.bank().giveMoney(d.pl().getSettlementToken(), address(d.lemmaTreasury()), 5e30);
        // console.log("[testDistributeFR_ShowPendingFRAndSettle()] Start");
        // _depositSettlementToken(300000000);

        // NOTE: Initially no net position on Perp --> Zero FPs
        assertTrue(d.pl().getPendingFundingPayment() == 0);

        _printIndexMarkStatus();

        // address collateral = d.getTokenAddress("WETH");

        _runOperation(operation);

        // NOTE: Minting just a little bit of USDL to start with a net short position
        // if(operation.isMintUSDL) {
        //     _mintUSDLWExactCollateralNoChecks(address(this), operation.collateral, operation.amount);
        // } else {
        //     _mintSynthWExactCollateralNoChecks(address(this), operation.collateral, operation.amount, 0);
        // }

        // console.log("[testDistributeFR_ShowPendingFRAndSettle()] Minted USDL --> Net Short");

        // console.log("[testDistributeFR_ShowPendingFRAndSettle()] Price Before = ", d.pl().getIndexPrice());
        // NOTE: Let's move forward of 1 day with a +0.1% price change

        _mineBlock();
        // mockPriceFeed.advancePerc(8 hours, 1e3);
        // _advancePerc(8 hours, 1e3);
        _printIndexMarkStatus();
        console.log("[testDistributeFR_ShowPendingFRAndSettle()] Distributing Funding Payments");
        d.pl().distributeFundingPayments();

        // NOTE: Checking Pending Funding Payment after distribution is zero
        assertTrue(d.pl().getPendingFundingPayment() == 0);
        print(
            "[testDistributeFR_ShowPendingFRAndSettle()] T3 Pending Funding Payments after distribution = ",
            d.pl().getPendingFundingPayment()
        );

        _mineBlock();
        // mockPriceFeed.advancePerc(8 hours, 1e3);
        // _advancePerc(8 hours, 1e3);
        // console.log("[testDistributeFR_ShowPendingFRAndSettle()] T3 Index Price = ", d.pl().getIndexPrice());
        // console.log("[testDistributeFR_ShowPendingFRAndSettle()] T3 Mark Price = ", d.pl().getMarkPrice());
        // print("[testDistributeFR_ShowPendingFRAndSettle()] T3 Pending Funding Payments = ", d.pl().getPendingFundingPayment());

        // _mineBlock();
        // mockPriceFeed.advancePerc(8 hours, 1e3);
        // _advancePerc(8 hours, 1e3);
        _printIndexMarkStatus();
        // console.log("[testDistributeFR_ShowPendingFRAndSettle()] T5 Index Price = ", d.pl().getIndexPrice());
        // console.log("[testDistributeFR_ShowPendingFRAndSettle()] T5 Mark Price = ", d.pl().getMarkPrice());
        // print("[testDistributeFR_ShowPendingFRAndSettle()] T5 Pending Funding Payments = ", d.pl().getPendingFundingPayment());
        d.pl().distributeFundingPayments();
        // NOTE: Checking Pending Funding Payment after distribution is zero
        assertTrue(d.pl().getPendingFundingPayment() == 0);
        print(
            "[testDistributeFR_ShowPendingFRAndSettle()] T5 Pending Funding Payments after distribution = ",
            d.pl().getPendingFundingPayment()
        );
    }

    function _runOperation(Operation memory operation) internal {
        if (operation.isMintUSDL) {
            _mintUSDLWExactCollateralNoChecks(address(this), operation.collateral, operation.amount);
        } else {
            _mintSynthWExactCollateralNoChecks(address(this), operation.collateral, operation.amount, 0);
        }
    }

    function _getAmountInDecimals(uint256 numerator, uint256 denominator, address token)
        internal
        view
        returns (uint256 res)
    {
        return (numerator * 10 ** (IERC20Decimals(token).decimals())) / denominator;
    }

    function _getOperation(uint256 num, uint256 den, address collateral, bool isMintUSDL)
        internal
        view
        returns (Operation memory)
    {
        return Operation({
            isMintUSDL: isMintUSDL,
            collateral: collateral,
            amount: _getAmountInDecimals(num, den, collateral)
        });
    }

    function testDistributeFR_mintUSDLAndShowPendingFRAndSettle_1tests1() public {
        operations.push(_getOperation(1, 1, d.getTokenAddress("WETH"), true));

        _init1();

        for (uint256 i = 0; i < operations.length; ++i) {
            _test1(operations[i]);
        }
    }

    function testDistributeFR_ShowPendingFRAndSettle_3tests1() public {
        operations.push(_getOperation(3, 1e3, d.getTokenAddress("WETH"), true));
        operations.push(_getOperation(1, 1, d.getTokenAddress("WETH"), true));
        operations.push(_getOperation(1, 1e3, d.getTokenAddress("WETH"), true));

        _init1();

        for (uint256 i = 0; i < operations.length; ++i) {
            console.log("\n\n\n");
            console.log("[testDistributeFR_ShowPendingFRAndSettle_3tests1] Operation Start i = ", i);
            _test1(operations[i]);
        }
    }

    function testDistributeFR_ShowPendingFRAndSettle_3tests3() public {
        operations.push(_getOperation(3, 1e3, d.getTokenAddress("WETH"), true));
        operations.push(_getOperation(100, 1, d.getTokenAddress("USDC"), false));
        operations.push(_getOperation(1, 1e3, d.getTokenAddress("WETH"), true));

        _init1();

        for (uint256 i = 0; i < operations.length; ++i) {
            _test1(operations[i]);
        }
    }

    function testDistributeFR_ShowPendingFRAndSettle_3tests5() public {
        operations.push(_getOperation(30, 1e2, d.getTokenAddress("WETH"), true));
        operations.push(_getOperation(5000, 1, d.getTokenAddress("USDC"), false));
        operations.push(_getOperation(100, 1e2, d.getTokenAddress("WETH"), true));

        _init1();

        for (uint256 i = 0; i < operations.length; ++i) {
            _test1(operations[i]);
        }
    }

    // NOTE: This fails with EX_OPLAS
    function testFailDistributeFR_mintUSDL_EX_OPLAS() public {
        operations.push(_getOperation(30, 1e2, d.getTokenAddress("WETH"), true));
        operations.push(_getOperation(5000, 1, d.getTokenAddress("WETH"), true));
        operations.push(_getOperation(100, 1e2, d.getTokenAddress("WETH"), true));

        _init1();

        for (uint256 i = 0; i < operations.length; ++i) {
            _test1(operations[i]);
        }
    }

    function testFailDistributeFR_mintSynth_EX_OPLAS() public {
        operations.push(_getOperation(500000, 1, d.getTokenAddress("USDC"), false));
        // operations.push(_getOperation(3000,1,d.getTokenAddress("USDC"), false));
        // operations.push(_getOperation(10000,1e2,d.getTokenAddress("USDC"), false));

        _init1();

        for (uint256 i = 0; i < operations.length; ++i) {
            _test1(operations[i]);
        }
    }
}
