import { printTx, toBigNumber, fromBigNumber, snapshot, revertToSnapshot, loadSqueethInfo } from "./shared/utils";
import { ethers } from "hardhat"
import { Contract, providers, BigNumber, ContractFactory } from "../squeeth-monorepo/packages/hardhat/node_modules/ethers";
import BigNumberJs from 'bignumber.js'

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { WETH9, MockErc20, Controller, Oracle, WPowerPerp, CrabStrategy, Controller__factory, WPowerPerp__factory, CrabStrategy__factory, MockErc20__factory, INonfungiblePositionManager__factory, WETH9__factory } from "../squeeth-monorepo/packages/hardhat/typechain";
import { deployUniswapV3, deploySqueethCoreContracts, deployWETHAndDai, addWethDaiLiquidity, addSqueethLiquidity } from '../squeeth-monorepo/packages/hardhat/test/setup'
import { isSimilar, wmul, wdiv, one, oracleScaleFactor } from "../squeeth-monorepo/packages/hardhat/test/utils";

// const ethersContract = ethers.Contract;
describe("CrabSqueethLemma", async function () {
    const startingEthPrice = 3000
    const startingEthPrice1e18 = BigNumber.from(startingEthPrice).mul(one) // 3000 * 1e18
    const scaledStartingSqueethPrice1e18 = startingEthPrice1e18.div(oracleScaleFactor) // 0.3 * 1e18
    const scaledStartingSqueethPrice = startingEthPrice / oracleScaleFactor.toNumber() // 0.3


    const hedgeTimeThreshold = 86400  // 24h
    const hedgePriceThreshold = ethers.utils.parseUnits('0.01')
    const auctionTime = 3600
    const minPriceMultiplier = ethers.utils.parseUnits('0.95')
    const maxPriceMultiplier = ethers.utils.parseUnits('1.05')

    let provider: providers.JsonRpcProvider;
    let owner: SignerWithAddress;
    let depositor: SignerWithAddress;
    let feeRecipient: SignerWithAddress;
    let dai: MockErc20
    let weth: WETH9
    let positionManager: Contract
    let uniswapFactory: Contract
    let oracle: Oracle
    let controller: Controller
    let wSqueethPool: Contract
    let wSqueeth: WPowerPerp
    let crabStrategy: CrabStrategy
    let ethDaiPool: Contract

    let snapshotId: any;
    before(async function () {

        const startingEthPrice = 3000
        const startingEthPrice1e18 = BigNumber.from(startingEthPrice).mul(one) // 3000 * 1e18
        const scaledStartingSqueethPrice1e18 = startingEthPrice1e18.div(oracleScaleFactor) // 0.3 * 1e18
        const scaledStartingSqueethPrice = startingEthPrice / oracleScaleFactor.toNumber() // 0.3

        const accounts = await ethers.getSigners();
        const [_owner, _depositor, _feeRecipient] = accounts;
        owner = _owner;
        depositor = _depositor;
        feeRecipient = _feeRecipient
        provider = ethers.provider

        const squeethInfo = await loadSqueethInfo();
        console.log(squeethInfo)


        controller = (new ethers.Contract(squeethInfo.Controller, Controller__factory.abi, owner)) as Controller
        wSqueeth = (new ethers.Contract(squeethInfo.WPowerPerp, WPowerPerp__factory.abi, owner)) as WPowerPerp
        crabStrategy = (new ethers.Contract(squeethInfo.CrabStrategyDeployment, CrabStrategy__factory.abi, owner)) as CrabStrategy

        dai = (new ethers.Contract(squeethInfo.MockErc20, MockErc20__factory.abi, owner)) as MockErc20
        weth = (new ethers.Contract(squeethInfo.WETH9, WETH9__factory.abi, owner)) as WETH9

        positionManager = new ethers.Contract(squeethInfo.NonfungiblePositionManager, INonfungiblePositionManager__factory.abi, owner)

        await addWethDaiLiquidity(
            scaledStartingSqueethPrice,
            ethers.utils.parseUnits('100'), // eth amount
            owner.address,
            dai,
            weth,
            positionManager
        )

        await provider.send("evm_increaseTime", [300])
        await provider.send("evm_mine", [])


        await addSqueethLiquidity(
            scaledStartingSqueethPrice,
            '1000000',
            '2000000',
            owner.address,
            wSqueeth,
            weth,
            positionManager,
            controller
        )

    })

    beforeEach(async function () {
        snapshotId = await snapshot();
    });
    afterEach(async function () {
        await revertToSnapshot(snapshotId);
    });
    it("should initialize correctly", async function () {
        const ethToDeposit = ethers.utils.parseUnits('20')
        const msgvalue = ethers.utils.parseUnits('10.1')
        const depositorSqueethBalanceBefore = await wSqueeth.balanceOf(depositor.address)

        //increase strategy cap
        let strategyCapInContract: BigNumber = await crabStrategy.strategyCap()
        console.log(`strategyCapInContract: ${strategyCapInContract.toString()}`)
        const strategyCap = ethers.utils.parseUnits("1000")

        await crabStrategy.connect(owner).setStrategyCap(strategyCap)

        strategyCapInContract = await crabStrategy.strategyCap()
        console.log(`strategyCapInContract: ${strategyCapInContract.toString()}`)

        let tx = await crabStrategy.connect(depositor).flashDeposit(ethToDeposit, { value: msgvalue })
        await printTx(tx.hash)

        tx = await crabStrategy.connect(depositor).deposit({ value: msgvalue });
        await printTx(tx.hash)

        const wSqueethToBurn = ethers.utils.parseUnits('10')
        const crabToBurn = ethers.utils.parseUnits('5')
        await wSqueeth.connect(depositor).approve(crabStrategy.address, wSqueethToBurn)
        tx = await crabStrategy.connect(depositor).withdraw(crabToBurn);
        await printTx(tx.hash)

        tx = await crabStrategy.connect(depositor).flashWithdraw(crabToBurn, ethers.utils.parseUnits('1000'))
        await printTx(tx.hash)


    });
});
