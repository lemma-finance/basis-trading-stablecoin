import { printTx, toBigNumber, fromBigNumber, snapshot, revertToSnapshot, loadSqueethInfo } from "./shared/utils";
import { ethers, upgrades } from "hardhat"
import { Contract, providers, BigNumber, ContractFactory } from "../squeeth-monorepo/packages/hardhat/node_modules/ethers";
import BigNumberJs from 'bignumber.js'

// import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { WETH9, MockErc20, Controller, Oracle__factory, Oracle, WPowerPerp, CrabStrategy, Controller__factory, WPowerPerp__factory, CrabStrategy__factory, MockErc20__factory, INonfungiblePositionManager__factory, WETH9__factory, IUniswapV3Factory, IUniswapV3Factory__factory } from "../squeeth-monorepo/packages/hardhat/typechain";
import { deployUniswapV3, deploySqueethCoreContracts, deployWETHAndDai, addWethDaiLiquidity, addSqueethLiquidity } from '../squeeth-monorepo/packages/hardhat/test/setup'
import { isSimilar, wmul, wdiv, one, oracleScaleFactor } from "../squeeth-monorepo/packages/hardhat/test/utils";
import { computeAMMTradeAmountByMargin } from "@mcdex/mai3.js";
import { Signer } from "ethers";
// import { IUniswapV3Factory }  from "../types/IUniswapV3Factory";

// const ethersContract = ethers.Contract;
describe("CrabSqueethLemma", async function () {
    let _owner, _depositor, _feeRecipient, _trustedForwarder, _reBalancer
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
    let owner: Signer;
    let depositor: Signer;
    let feeRecipient: Signer;
    let trustedForwarder: Signer;
    let reBalancer: Signer;
    let dai: MockErc20
    let weth: WETH9
    let positionManager: Contract
    let uniswapFactory: Contract
    let oracle: Oracle
    let controller: Controller
    let wSqueethPool: string
    let wSqueeth: WPowerPerp
    let crabStrategy: CrabStrategy
    let ethDaiPool: Contract
    let daiWSqueethPool:  Contract

    let crabSqueethLemma: Contract
    let collateral: MockErc20 // = weth9
    const maxPosition: BigNumber = ethers.constants.MaxUint256

    let snapshotId: any;
    before(async function () {

        const startingEthPrice = 3000
        const startingEthPrice1e18 = BigNumber.from(startingEthPrice).mul(one) // 3000 * 1e18
        const scaledStartingSqueethPrice1e18 = startingEthPrice1e18.div(oracleScaleFactor) // 0.3 * 1e18
        const scaledStartingSqueethPrice = startingEthPrice / oracleScaleFactor.toNumber() // 0.3

        const accounts = await ethers.getSigners();
        [_owner, _depositor, _feeRecipient, _trustedForwarder, _reBalancer] = accounts;
        owner = await ethers.getSigner(_owner.address);
        depositor = await ethers.getSigner(_depositor.address);
        feeRecipient = await ethers.getSigner(_feeRecipient.address)
        trustedForwarder = await ethers.getSigner(_trustedForwarder.address)
        reBalancer = await ethers.getSigner(_reBalancer.address)
        provider = ethers.provider

        console.log('depositor: ', await depositor.getAddress())

        const squeethInfo = await loadSqueethInfo();
        // console.log(WPowerPerp__factory.abi)
        // console.log(squeethInfo)

        controller = (new ethers.Contract(squeethInfo.Controller, Controller__factory.abi, owner) as unknown) as Controller
        wSqueeth = (new ethers.Contract(squeethInfo.WPowerPerp, WPowerPerp__factory.abi, owner) as unknown) as WPowerPerp
        crabStrategy = (new ethers.Contract(squeethInfo.CrabStrategyDeployment, CrabStrategy__factory.abi, owner) as unknown) as CrabStrategy
        dai = (new ethers.Contract(squeethInfo.MockErc20, MockErc20__factory.abi, owner) as unknown) as MockErc20
        weth = (new ethers.Contract(squeethInfo.WETH9, WETH9__factory.abi, owner) as unknown) as WETH9
        positionManager = (new ethers.Contract(squeethInfo.NonfungiblePositionManager, INonfungiblePositionManager__factory.abi, owner) as unknown) as Contract
        uniswapFactory = (new ethers.Contract(squeethInfo.UniswapV3Factory, IUniswapV3Factory__factory.abi, owner) as unknown) as Contract
        oracle = (new ethers.Contract(squeethInfo.Oracle, Oracle__factory.abi, owner) as unknown) as Oracle

        ethDaiPool = await uniswapFactory.getPool(dai.address, weth.address, 3000)
        wSqueethPool = await uniswapFactory.getPool(wSqueeth.address, weth.address, 3000)
        daiWSqueethPool = await uniswapFactory.getPool(dai.address, wSqueeth.address, 3000)

        console.log(ethDaiPool, wSqueethPool, daiWSqueethPool)
        console.log('hi')

        await controller.connect(owner).setFeeRecipient(_feeRecipient.address);
        await controller.connect(owner).setFeeRate(100)

        await addWethDaiLiquidity(
            scaledStartingSqueethPrice,
            ethers.utils.parseUnits('100'), // eth amount
            await owner.getAddress(),
            dai,
            weth,
            positionManager
        )

        await provider.send("evm_increaseTime", [600])
        await provider.send("evm_mine", [])

        await addSqueethLiquidity(
            scaledStartingSqueethPrice,
            '1000000',
            '2000000',
            _owner.address,
            wSqueeth,
            weth,
            positionManager,
            controller
        )

        await provider.send("evm_increaseTime", [600])
        await provider.send("evm_mine", [])

        //increase the cap in crab strategy contract 
        const strategyCap = ethers.utils.parseUnits("1000")
        await crabStrategy.connect(owner).setStrategyCap(strategyCap)

        console.log("controller", await crabStrategy.powerTokenController());
        console.log("weth", await crabStrategy.weth());

        //deploy the wrapper contract
        const CrabSqueethLemma = await ethers.getContractFactory("CrabSqueethLemma");
        crabSqueethLemma = (await upgrades.deployProxy(CrabSqueethLemma, 
            [_trustedForwarder.address, 
                crabStrategy.address, 
                _reBalancer.address, 
                dai.address,
                ethDaiPool,
                wSqueethPool,
                squeethInfo.Oracle,
                maxPosition
            ], { initializer: 'initialize' }) as unknown) as Contract;
        const collateralAddress = await crabSqueethLemma.collateral();
        collateral = (new ethers.Contract(collateralAddress, MockErc20__factory.abi, owner) as unknown) as MockErc20;

        const amountOfCollateralToMint = ethers.utils.parseEther("100");

        let getPrice = await crabSqueethLemma.getPrice(ethDaiPool, weth.address, dai.address);
        console.log('getPrice: ', getPrice.toString())

        getPrice = await crabSqueethLemma.getPrice(wSqueethPool, wSqueeth.address, weth.address);
        console.log('getPrice: ', getPrice.toString())

        //deposit ETH to WETH contract
        await weth.connect(owner).deposit({ value: amountOfCollateralToMint });
        await weth.connect(depositor).deposit({ value: amountOfCollateralToMint })
    })

    beforeEach(async function () {
        snapshotId = await snapshot();
    });
    afterEach(async function () {
        await revertToSnapshot(snapshotId);
    });
    // it("should initialize correctly", async function () {
    //     const ethToDeposit = ethers.utils.parseUnits('20')
    //     const msgvalue = ethers.utils.parseUnits('10.1')
    //     const depositorSqueethBalanceBefore = await wSqueeth.balanceOf(depositor.address)

    //     //increase strategy cap
    //     let strategyCapInContract: BigNumber = await crabStrategy.strategyCap()
    //     console.log(`strategyCapInContract: ${strategyCapInContract.toString()}`)
    //     const strategyCap = ethers.utils.parseUnits("1000")

    //     await crabStrategy.connect(owner).setStrategyCap(strategyCap)

    //     strategyCapInContract = await crabStrategy.strategyCap()
    //     console.log(`strategyCapInContract: ${strategyCapInContract.toString()}`)

    //     let tx = await crabStrategy.connect(depositor).flashDeposit(ethToDeposit, { value: msgvalue })
    //     await printTx(tx.hash)

    //     tx = await crabStrategy.connect(depositor).deposit({ value: msgvalue });
    //     await printTx(tx.hash)

    //     const wSqueethToBurn = ethers.utils.parseUnits('10')
    //     const crabToBurn = ethers.utils.parseUnits('5')
    //     await wSqueeth.connect(depositor).approve(crabStrategy.address, wSqueethToBurn)
    //     tx = await crabStrategy.connect(depositor).withdraw(crabToBurn);
    //     await printTx(tx.hash)

    //     tx = await crabStrategy.connect(depositor).flashWithdraw(crabToBurn, ethers.utils.parseUnits('1000'))
    //     await printTx(tx.hash)
    // });

    it("should initialize correctly", async function () {

        const ethToDeposit = ethers.utils.parseUnits('20')
        const msgvalue = ethers.utils.parseUnits('10.2')

        let depositorBal = await depositor.getBalance()
        console.log('depositorBal1: ', depositorBal.toString())

        // console.log(crabSqueethLemma)

        // await crabStrategy.connect(depositor).deposit({value: ethToDeposit})

        let tx = await collateral.connect(depositor).transfer(crabSqueethLemma.address, msgvalue);
        tx = await crabSqueethLemma.connect(depositor).openWExactCollateralForSqueeth(ethToDeposit, msgvalue);

        depositorBal = await depositor.getBalance()
        console.log('depositorBal2: ', depositorBal.toString())

        const wSqueethPrice = await oracle.getTwap(wSqueethPool, wSqueeth.address, weth.address, 1, false)
        console.log('wSqueethPrice: ', wSqueethPrice.toString())

        const userCrabBalanceBefore = await crabStrategy.balanceOf(crabSqueethLemma.address);
        console.log('userCrabBalanceBefore: ', userCrabBalanceBefore.toString())

        const crabTotalSupply = await crabStrategy.totalSupply()
        console.log('crabTotalSupply: ', crabTotalSupply.toString())

        const strategyVault = await controller.vaults(await crabStrategy.vaultId());
        console.log('strategyVault: ', strategyVault.toString())

        const strategyDebtAmountBefore = strategyVault.shortAmount
        console.log('strategyDebtAmountBefore: ', strategyDebtAmountBefore.toString())

        const strategyCollateralAmountBefore = strategyVault.collateralAmount
        console.log('strategyCollateralAmountBefore: ', strategyCollateralAmountBefore.toString())

        const userEthBalanceBefore = await provider.getBalance(crabSqueethLemma.address)
        console.log('userEthBalanceBefore: ', userEthBalanceBefore.toString())

        const crabRatio = wdiv(userCrabBalanceBefore, crabTotalSupply);
        console.log('crabRatio: ', crabRatio.toString())

        const debtToRepay = wmul(crabRatio, strategyDebtAmountBefore);
        console.log('debtToRepay: ', debtToRepay.toString())

        const ethCostOfDebtToRepay = wmul(debtToRepay, wSqueethPrice)
        console.log('ethCostOfDebtToRepay: ', ethCostOfDebtToRepay.toString())

        const userCollateral = wmul(crabRatio, strategyCollateralAmountBefore)
        console.log('userCollateral: ', userCollateral.toString())

        const ethToWithdraw = userCollateral.sub(ethCostOfDebtToRepay);
        console.log('ethToWithdraw: ', ethToWithdraw.toString())

        const maxEthToPay = ethCostOfDebtToRepay.mul(101).div(100)
        console.log('maxEthToPay: ', maxEthToPay.toString())

        tx = await crabSqueethLemma.connect(depositor).closeWExactCollateralForSqueeth(userCrabBalanceBefore, maxEthToPay);

    })
});
