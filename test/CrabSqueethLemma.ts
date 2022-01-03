import { toBigNumber, fromBigNumber, snapshot, revertToSnapshot, loadSqueethInfo } from "./shared/utils";
import { ethers } from "hardhat"
import { Contract, providers, BigNumber, ContractFactory } from "../squeeth-monorepo/packages/hardhat/node_modules/ethers";
import BigNumberJs from 'bignumber.js'

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { WETH9, MockErc20, Controller, Oracle, WPowerPerp, CrabStrategy, CrabStrategy__factory } from "../squeeth-monorepo/packages/hardhat/typechain";
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

        const squeethInfo = await loadSqueethInfo();
        console.log(squeethInfo)

        const accounts = await ethers.getSigners();
        const [_owner, _depositor, _feeRecipient] = accounts;
        owner = _owner;
        depositor = _depositor;
        feeRecipient = _feeRecipient
        provider = ethers.provider

        const { dai: daiToken, weth: wethToken } = await deployWETHAndDai()

        dai = daiToken
        weth = wethToken

        const uniDeployments = await deployUniswapV3(weth)
        positionManager = uniDeployments.positionManager
        uniswapFactory = uniDeployments.uniswapFactory

        // this will not deploy a new pool, only reuse old onces
        const squeethDeployments = await deploySqueethCoreContracts(
            weth,
            dai,
            positionManager,
            uniswapFactory,
            scaledStartingSqueethPrice,
            startingEthPrice
        )
        controller = squeethDeployments.controller
        wSqueeth = squeethDeployments.wsqueeth
        oracle = squeethDeployments.oracle
        // shortSqueeth = squeethDeployments.shortSqueeth
        wSqueethPool = squeethDeployments.wsqueethEthPool
        ethDaiPool = squeethDeployments.ethDaiPool

        await controller.connect(owner).setFeeRecipient(feeRecipient.address);
        await controller.connect(owner).setFeeRate(100)

        const CrabStrategyContract = await ethers.getContractFactory("CrabStrategy");
        crabStrategy = (await CrabStrategyContract.deploy(controller.address, oracle.address, weth.address, uniswapFactory.address, wSqueethPool.address, hedgeTimeThreshold, hedgePriceThreshold, auctionTime, minPriceMultiplier, maxPriceMultiplier)) as unknown as CrabStrategy;
    })

    beforeEach(async function () {
        snapshotId = await snapshot();
    });
    afterEach(async function () {
        await revertToSnapshot(snapshotId);
    });
    it("should initialize correctly", async function () {
    });
});
