import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { utils } from "ethers";
const { BigNumber, constants } = ethers;
const { AddressZero, MaxUint256, MaxInt256 } = constants;
import hre from "hardhat";
import {
  getLiquidityPool,
  getAccountStorage,
  computeAccount,
  _0,
  _1,
  computeAMMTradeAmountByMargin,
} from "@mcdex/mai3.js";
import { toBigNumber, fromBigNumber, snapshot, revertToSnapshot } from "./shared/utils";
import { createEthlFixture } from "./shared/mcdexFixtures";
const MASK_USE_TARGET_LEVERAGE = 0x08000000;

// const printTx = async (hash) => {
//     await tokenTransfers.print(hash, [], false);
// };

describe("USDLemma", async () => {
  let defaultSigner: any;
  let reBalancer: any;
  let hasWETH: any;
  let keeperGasReward: any;
  let stackingContract: any;
  let lemmaTreasury: any;
  let signer1: any;
  let signer2: any;

  // const [admin, maker, maker2, taker, carol] = provider.getWallets();
  // const [admin, maker, maker2, taker, carol] = waffle.provider.getWallets()
  let liquidityPool: any;
  let reader: any;
  let mcdexLemma: any;
  let usdLemma: any;
  let collateral: any;
  let oracleAdaptorAddress: string;

  const perpetualIndex = 0; //in Kovan the 0th perp for 0th liquidity pool = inverse ETH-USD
  const provider = ethers.provider;
  const ZERO = BigNumber.from("0");
  let snapshotId: any;
  before(async () => {
    [defaultSigner, reBalancer, hasWETH, stackingContract, lemmaTreasury, signer1, signer2] = await ethers.getSigners();
    const loadFixture: ReturnType<typeof waffle.createFixtureLoader> = waffle.createFixtureLoader([defaultSigner]);
    const _usdlFixture = await loadFixture(createEthlFixture());
    mcdexLemma = _usdlFixture.mcdexLemma;
    usdLemma = _usdlFixture.lemmaEth;
    collateral = _usdlFixture.collateral;
    liquidityPool = _usdlFixture.liquidityPool;
    reader = _usdlFixture.reader;
    oracleAdaptorAddress = _usdlFixture.oracleAdaptorAddress;

    const perpetualInfo = await liquidityPool.getPerpetualInfo(perpetualIndex);
    const nums = perpetualInfo.nums;
    keeperGasReward = nums[11];

    const amountOfCollateralToMint = utils.parseEther("100");

    //deposit ETH to WETH contract
    await defaultSigner.sendTransaction({ to: collateral.address, value: amountOfCollateralToMint });
    await hasWETH.sendTransaction({ to: collateral.address, value: amountOfCollateralToMint });

    //add liquidity to the liquidity Pool
    const liquidityToAdd = utils.parseEther("10");
    await collateral.approve(liquidityPool.address, MaxUint256);
    await liquidityPool.addLiquidity(liquidityToAdd);

    //deposit the keeper gas reward
    await collateral.approve(mcdexLemma.address, keeperGasReward);
    await mcdexLemma.depositKeeperGasReward();

    //set fees
    const fees = 3000; //30%
    await usdLemma.setFees(fees);
    //set stacking contract address
    await usdLemma.setStakingContractAddress(stackingContract.address);
    //set lemma treasury address
    await usdLemma.setLemmaTreasury(lemmaTreasury.address);
  });

  beforeEach(async function () {
    snapshotId = await snapshot();
  });
  afterEach(async function () {
    await revertToSnapshot(snapshotId);
  });
  it("should initialize correctly", async function () {
    expect(await mcdexLemma.usdLemma()).to.equal(usdLemma.address);
    expect(await usdLemma.perpetualDEXWrappers("0", collateral.address)).to.equal(mcdexLemma.address);
  });
  it("should deposit correctly", async function () {
    const collateralBalanceBefore = await collateral.balanceOf(defaultSigner.address);
    const amount = utils.parseEther("1000");
    const collateralNeeded = await mcdexLemma.getAmountInCollateralDecimals(
      await mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true),
      true,
    );
    await collateral.approve(usdLemma.address, collateralNeeded);
    let tx = await usdLemma.deposit(amount, 0, collateralNeeded, collateral.address);
    const collateralBalanceAfter = await collateral.balanceOf(defaultSigner.address);
    expect(collateralNeeded).to.equal(collateralBalanceBefore.sub(collateralBalanceAfter));
    expect(await usdLemma.balanceOf(defaultSigner.address)).to.equal(utils.parseEther("1000"));
    expect(tx)
      .to.emit(usdLemma, "DepositTo")
      .withArgs(0, collateral.address, defaultSigner.address, amount, collateralNeeded);
  });
  it("should depositTo correctly", async function () {
    const collateralBalanceBefore = await collateral.balanceOf(defaultSigner.address);
    const amount = utils.parseEther("1000");
    const collateralNeeded = await mcdexLemma.getAmountInCollateralDecimals(
      await mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true),
      true,
    );
    await collateral.approve(usdLemma.address, collateralNeeded);
    let tx = await usdLemma.depositTo(signer1.address, amount, 0, collateralNeeded, collateral.address);
    const collateralBalanceAfter = await collateral.balanceOf(defaultSigner.address);
    expect(collateralNeeded).to.equal(collateralBalanceBefore.sub(collateralBalanceAfter));
    expect(await usdLemma.balanceOf(signer1.address)).to.equal(utils.parseEther("1000"));
    expect(tx)
      .to.emit(usdLemma, "DepositTo")
      .withArgs(0, collateral.address, signer1.address, amount, collateralNeeded);
  });
  it("should withdraw correctly", async function () {
    const amount = utils.parseEther("1000");
    const collateralNeeded = await mcdexLemma.getAmountInCollateralDecimals(
      await mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true),
      true,
    );
    await collateral.approve(usdLemma.address, collateralNeeded);
    await usdLemma.deposit(amount, 0, collateralNeeded, collateral.address);

    const collateralBalanceBefore = await collateral.balanceOf(defaultSigner.address);
    const collateralToGetBack = await mcdexLemma.getAmountInCollateralDecimals(
      await mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, false),
      false,
    );
    let tx = await usdLemma.withdraw(amount, 0, 0, collateral.address);
    const collateralBalanceAfter = await collateral.balanceOf(defaultSigner.address);
    expect(collateralToGetBack).to.be.closeTo(
      collateralBalanceAfter.sub(collateralBalanceBefore),
      await mcdexLemma.getAmountInCollateralDecimals(1e7, false),
    );
    expect(await usdLemma.balanceOf(defaultSigner.address)).to.equal(ZERO);
    expect(tx)
      .to.emit(usdLemma, "WithdrawTo")
      .withArgs(0, collateral.address, defaultSigner.address, amount, collateralToGetBack);
  });

  it("should withdrawTo correctly", async function () {
    const amount = utils.parseEther("1000");
    const collateralNeeded = await mcdexLemma.getAmountInCollateralDecimals(
      await mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true),
      true,
    );
    await collateral.approve(usdLemma.address, collateralNeeded);
    await usdLemma.deposit(amount, 0, collateralNeeded, collateral.address);

    const collateralBalanceBefore = await collateral.balanceOf(signer1.address);
    const collateralToGetBack = await mcdexLemma.getAmountInCollateralDecimals(
      await mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, false),
      false,
    );
    let tx = await usdLemma.withdrawTo(signer1.address, amount, 0, 0, collateral.address);
    const collateralBalanceAfter = await collateral.balanceOf(signer1.address);
    expect(collateralToGetBack).to.be.closeTo(
      collateralBalanceAfter.sub(collateralBalanceBefore),
      await mcdexLemma.getAmountInCollateralDecimals(1e7, false),
    );
    expect(await usdLemma.balanceOf(defaultSigner.address)).to.equal(ZERO);
    expect(tx)
      .to.emit(usdLemma, "WithdrawTo")
      .withArgs(0, collateral.address, signer1.address, amount, collateralToGetBack);
  });
  describe("re balance", async function () {
    let lemmaTreasuryBalanceBefore: any;
    let stackingContractBalanceBefore: any;
    beforeEach(async function () {
      const amount = utils.parseEther("1000");

      const collateralNeeded = await mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
      await collateral.approve(usdLemma.address, collateralNeeded);
      await usdLemma.deposit(amount, 0, MaxUint256, collateral.address);

      //send some USDL to stackingContract and lemmaTreasury to see if they get burnt when funding Payment is negative
      stackingContractBalanceBefore = utils.parseEther("0.1");
      await usdLemma.transfer(stackingContract.address, stackingContractBalanceBefore); //not enough to be able to test

      lemmaTreasuryBalanceBefore = amount.div(2);
      await usdLemma.transfer(lemmaTreasury.address, lemmaTreasuryBalanceBefore); //enough to cover the rest of burn amount

      await usdLemma.connect(stackingContract).approve(usdLemma.address, MaxUint256);
      await usdLemma.connect(lemmaTreasury).approve(usdLemma.address, MaxUint256);
    });

    it("when fundingPNL is positive", async function () {
      await liquidityPool.trade(
        perpetualIndex,
        defaultSigner.address,
        "-" + utils.parseEther("10000").toString(),
        "0",
        MaxUint256,
        AddressZero,
        MASK_USE_TARGET_LEVERAGE,
      );
    });
    it("when fundingPNL is negative", async function () {});
    afterEach(async function () {
      //increase time
      //to make sure that funding payment has a meaning impact
      await hre.network.provider.request({
        method: "evm_increaseTime",
        params: [60 * 60 * 10],
      });
      await hre.network.provider.request({
        method: "evm_mine",
        params: [],
      });

      await liquidityPool.forceToSyncState();

      const fundingPNL = await mcdexLemma.getFundingPNL();
      const realizedFundingPNL = await mcdexLemma.realizedFundingPNL();
      let unrealizedFundingPNL = fundingPNL.sub(realizedFundingPNL);

      const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
      const perpetualInfo: any = liquidityPoolInfo.perpetuals.get(perpetualIndex);
      const marginChange = (await toBigNumber(unrealizedFundingPNL)).negated();
      const feeRate = perpetualInfo.lpFeeRate.plus(liquidityPoolInfo.vaultFeeRate).plus(perpetualInfo.operatorFeeRate);
      const marginChangeWithFeesConsidered = marginChange.times(
        (await toBigNumber(utils.parseEther("1"))).minus(feeRate),
      ); //0.07%
      const amountWithFeesConsidered = computeAMMTradeAmountByMargin(
        liquidityPoolInfo,
        perpetualIndex,
        marginChangeWithFeesConsidered,
      );

      const limitPrice = amountWithFeesConsidered.isNegative() ? 0 : MaxInt256;
      const deadline = MaxUint256;
      let tx = await usdLemma
        .connect(reBalancer)
        .reBalance(
          perpetualIndex,
          collateral.address,
          fromBigNumber(amountWithFeesConsidered),
          ethers.utils.defaultAbiCoder.encode(["int256", "uint256"], [limitPrice, deadline]),
        );
      {
        await liquidityPool.forceToSyncState();
        const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
        const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, mcdexLemma.address);
        const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
        // console.log("leverage", account.accountComputed.leverage.toString());
        //expect the leverage to be ~1
        expect(await fromBigNumber(account.accountComputed.leverage)).to.be.closeTo(utils.parseEther("1"), 1e14);
      }
      expect(tx).to.emit(usdLemma, "Rebalance");
      const totalUSDL = await fromBigNumber(amountWithFeesConsidered.absoluteValue());
      if (unrealizedFundingPNL.isNegative()) {
        //it should burn the right amounts
        expect(await usdLemma.balanceOf(stackingContract.address)).to.equal(ZERO);
        //change in lemmaTreasury balance = totalUSDLToBeBurnt - amount burnt from stacking contract
        expect(lemmaTreasuryBalanceBefore.sub(await usdLemma.balanceOf(lemmaTreasury.address))).to.equal(
          totalUSDL.sub(stackingContractBalanceBefore),
        );
      } else {
        //when funding payment is positive
        //mint 30% to lemmaTreasury
        const fees = await usdLemma.fees();
        const feeAmount = totalUSDL.mul(fees).div(BigNumber.from("10000"));
        expect((await usdLemma.balanceOf(lemmaTreasury.address)).sub(lemmaTreasuryBalanceBefore)).to.equal(feeAmount);
        //rest to stackingContract
        expect((await usdLemma.balanceOf(stackingContract.address)).sub(stackingContractBalanceBefore)).to.equal(
          totalUSDL.sub(feeAmount),
        );
      }
      // }
    });
  });

  // //a different way to test than the one in ./mcdexLemma.js
  // describe("should calculate fundingPNL correctly", async function () {
  //     beforeEach(async function () {
  //         const amount = utils.parseEther("1000");
  //         const collateralNeeded = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
  //         await this.collateral.approve(this.usdLemma.address, collateralNeeded);
  //         await this.usdLemma.deposit(amount, 0, MaxUint256, this.collateral.address);
  //     });
  //     it("when negative", async function () { });
  //     it("when positive", async function () {
  //         //short to get the PNL in positive
  //         await liquidityPool.trade(perpetualIndex, defaultSigner.address, "-" + (utils.parseEther("10000")).toString(), "0", MaxUint256, AddressZero, MASK_USE_TARGET_LEVERAGE);
  //     });
  //     afterEach(async function () {
  //         for (let i = 0; i < 10; i++) {
  //             await hre.network.provider.request({
  //                 method: "evm_increaseTime",
  //                 params: [60 * 60 * 10]
  //             }
  //             );
  //             await hre.network.provider.request({
  //                 method: "evm_mine",
  //                 params: []
  //             }
  //             );

  //             const amount = utils.parseEther("1000");
  //             const collateralNeeded = await this.mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true);
  //             await this.collateral.approve(this.usdLemma.address, collateralNeeded);
  //             await this.usdLemma.deposit(amount, 0, MaxUint256, this.collateral.address);

  //             await this.usdLemma.withdraw(amount.div(2), 0, 0, this.collateral.address);

  //             await liquidityPool.forceToSyncState();

  //             const fundingPNLFromContract = await this.mcdexLemma.getFundingPNL();

  //             {
  //                 let entryFunding = await this.mcdexLemma.entryFunding();
  //                 entryFunding = toBigNumber(entryFunding);

  //                 const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
  //                 let traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, this.mcdexLemma.address);
  //                 {
  //                     const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
  //                     console.log("leverage", account.accountComputed.leverage.toString());
  //                 }
  //                 displayNicely(traderInfo);
  //                 traderInfo.cashBalance = traderInfo.cashBalance.minus(toBigNumber(fundingPNLFromContract));
  //                 traderInfo.entryFunding = entryFunding;
  //                 displayNicely(traderInfo);
  //                 {
  //                     const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
  //                     expect(toBigNumber(fundingPNLFromContract).toString()).to.equal(account.accountComputed.fundingPNL.toString());
  //                     console.log("leverage", account.accountComputed.leverage.toString());
  //                     //expect the leverage to be =1
  //                     // expect(fromBigNumber(account.accountComputed.leverage)).to.equal(utils.parseEther("1"));
  //                 }
  //             }
  //         }
  //     });
  // });

  // it("should send MCB tokens to lemma treasury correctly", async function () {
  //     // this.collateral needs to be attached to MCB token address somehow
  //     // not possible to test without forking arbitrum state
  //     await expect(this.mcdexLemma.sendMCBToTreasury()).to.emit(this.collateral, "Transfer").withArgs(this.mcdexLemma.address, lemmaTreasury.address, ZERO);
  // });

  describe("should keep the leverage same regardless of the change in price", async function () {
    let leverage: any;
    let currentTimestamp: any;
    let oracleAdaptor: any;
    beforeEach(async function () {
      //mint
      const amount = utils.parseEther("1000");
      const collateralNeeded = await mcdexLemma.getAmountInCollateralDecimals(
        await mcdexLemma.callStatic.getCollateralAmountGivenUnderlyingAssetAmount(amount, true),
        true,
      );
      await collateral.approve(usdLemma.address, collateralNeeded);
      await usdLemma.deposit(amount, 0, collateralNeeded, collateral.address);

      await liquidityPool.forceToSyncState();
      const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
      const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, mcdexLemma.address);
      const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
      leverage = account.accountComputed.leverage;
      // console.log("leverage", account.accountComputed.leverage.toString());

      //get oracleAdaptor contract
      const latestBlock = await provider.getBlock("latest");
      currentTimestamp = latestBlock.timestamp;
      // const oracleAdaptorAddress = mcdexAddresses.OracleAdaptor.address;
      oracleAdaptor = new ethers.Contract(
        oracleAdaptorAddress,
        [
          "function setMarkPrice(int256 price, uint256 timestamp)",
          "function setIndexPrice(int256 price, uint256 timestamp)",
        ],
        defaultSigner,
      );
    });
    it("when price increases", async function () {
      //current price = 5*10^14 ETH per USD (2000 usd per ETH)
      //changes to = 10*10^14 ETH per USD (4000 usd per ETH)
      await oracleAdaptor.setMarkPrice(utils.parseUnits("10", "14"), currentTimestamp);
      await oracleAdaptor.setIndexPrice(utils.parseUnits("10", "14"), currentTimestamp);

      const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
      const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, mcdexLemma.address);
      const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
      // console.log("leverage", account.accountComputed.leverage.toString());
      //expect the leverage to be equal to leverage before change in price
      expect(await fromBigNumber(account.accountComputed.leverage)).to.be.closeTo(await fromBigNumber(leverage), 1e14);
    });
    it("when price decreases", async function () {
      //current price = 5*10^14 ETH per USD (2000 usd per ETH)
      //changes to = 2.5*10^14 ETH per USD (1000 usd per ETH)
      await oracleAdaptor.setMarkPrice(utils.parseUnits("2.5", "14"), currentTimestamp);
      await oracleAdaptor.setIndexPrice(utils.parseUnits("2.5", "14"), currentTimestamp);

      await liquidityPool.forceToSyncState();
      const liquidityPoolInfo = await getLiquidityPool(reader, liquidityPool.address);
      const traderInfo = await getAccountStorage(reader, liquidityPool.address, perpetualIndex, mcdexLemma.address);
      const account = computeAccount(liquidityPoolInfo, perpetualIndex, traderInfo);
      // console.log("leverage", account.accountComputed.leverage.toString());
      //expect the leverage to be equal to leverage before change in price
      expect(await fromBigNumber(account.accountComputed.leverage)).to.be.closeTo(await fromBigNumber(leverage), 1e14);
    });
  });

  it("should set staking contract correctly", async function () {
    let tx = await usdLemma.setStakingContractAddress(signer2.address);
    expect(tx).to.emit(usdLemma, "StakingContractUpdated").withArgs(signer2.address);
    await usdLemma.setStakingContractAddress(stackingContract.address);
  });

  it("should set lemma treasury correctly", async function () {
    let tx = await usdLemma.setLemmaTreasury(signer2.address);
    expect(tx).to.emit(usdLemma, "LemmaTreasuryUpdated").withArgs(signer2.address);
    await usdLemma.setLemmaTreasury(lemmaTreasury.address);
  });

  it("should set fees correctly", async function () {
    let tx = await usdLemma.setFees(utils.parseEther("1000"));
    expect(tx).to.emit(usdLemma, "FeesUpdated").withArgs(utils.parseEther("1000"));
    await usdLemma.setFees(utils.parseEther("0"));
  });

  it("should add per dex wrapper correctly", async function () {
    let tx = await usdLemma.addPerpetualDEXWrapper(1, signer1.address, signer2.address);
    expect(tx).to.emit(usdLemma, "PerpetualDexWrapperAdded").withArgs(1, signer1.address, signer2.address);
  });
});
