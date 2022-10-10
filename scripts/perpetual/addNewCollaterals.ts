import hre from "hardhat";
const { ethers, upgrades } = hre;
const { constants } = ethers;
const { AddressZero } = constants;
import { fetchFromURL, delay } from "../../test/hardhat/shared/utils";
import config from "./config/config_addNewCollaterals.json";
import fs from "fs";
import ClearingHouseAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/ClearingHouse.sol/ClearingHouse.json";
import OrderBookAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/OrderBook.sol/OrderBook.json";
import ClearingHouseConfigAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/ClearingHouseConfig.sol/ClearingHouseConfig.json";
import VaultAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/Vault.sol/Vault.json";
import ExchangeAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/Exchange.sol/Exchange.json";
import MarketRegistryAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/MarketRegistry.sol/MarketRegistry.json";
import TestERC20Abi from "@perp/curie-deployments/optimism/core/artifacts/contracts/interface/IERC20Metadata.sol/IERC20Metadata.json";
import BaseTokenAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/BaseToken.sol/BaseToken.json";
import QuoteTokenAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/QuoteToken.sol/QuoteToken.json";
import AccountBalanceAbi from "@perp/curie-deployments/optimism/core/artifacts/contracts/AccountBalance.sol/AccountBalance.json";
import UniswapV3PoolAbi from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";
import UniswapV3FactoryAbi from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import bn from "bignumber.js";
import { SettlementTokenManager__factory, USDLemma__factory } from "../../types";
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });
const SAVE_PREFIX = "./deployments/";
const SAVE_POSTFIX = ".deployment.perp.json";
const mainnetAddressesURL = "https://metadata.perp.exchange/v2/optimism.json";
const testnetAddressesURL = "https://metadata.perp.exchange/v2/optimism-kovan.json";
let deployedContracts = {};

const save = async network => {
    await fs.writeFileSync(SAVE_PREFIX + network + SAVE_POSTFIX, JSON.stringify(deployedContracts, null, 2));
};
const readFile = async network => {
    return await fs.readFileSync(SAVE_PREFIX + network + SAVE_POSTFIX, "utf8")
}

async function main() {


    let { chainId } = await ethers.provider.getNetwork();
    console.log("chainId: ", chainId);
    let perpV2Config;

    if (chainId == 10) {
        perpV2Config = await fetchFromURL(mainnetAddressesURL);
    } else if (chainId == 69) {
        perpV2Config = await fetchFromURL(testnetAddressesURL);
    }
    const network = perpV2Config.network;
    const contracts = perpV2Config.contracts;

    deployedContracts = JSON.parse(await readFile(network));

    console.log(deployedContracts);

    const perpCollaterals = perpV2Config.collaterals;
    const externalContracts = perpV2Config.externalContracts;
    const peripheryAddress = AddressZero;

    const trustedForwarder = config[chainId].trustedForwarder;

    const USDLemmaAddress = config[chainId].USDLemmaAddress;
    const reBalancer = config[chainId].reBalancer;
    const SettlementTokenManagerAddress = config[chainId].SettlementTokenManagerAddress;
    const xUSDL = config[chainId].xUSDL;
    const perpIndex = config[chainId].perpIndex;
    const percFundingPaymentsToUSDLHolder = config[chainId].percFundingPaymentsToUSDLHolder;

    const minFreeCollateral = config[chainId].minFreeCollateral;
    const minMarginSafeThreshold = config[chainId].minMarginSafeThreshold;
    const collateralRatio = config[chainId].collateralRatio;
    const lemmaSynthSetFees = config[chainId].lemmaSynthSetFees;



    let [defaultSigner]: any = await ethers.getSigners();
    let clearingHouse = new ethers.Contract(contracts.ClearingHouse.address, ClearingHouseAbi.abi, defaultSigner);
    let orderBook = new ethers.Contract(contracts.OrderBook.address, OrderBookAbi.abi, defaultSigner);
    let clearingHouseConfig = new ethers.Contract(
        contracts.ClearingHouseConfig.address,
        ClearingHouseConfigAbi.abi,
        defaultSigner,
    );
    let vault = new ethers.Contract(contracts.Vault.address, VaultAbi.abi, defaultSigner);
    let exchange = new ethers.Contract(contracts.Exchange.address, ExchangeAbi.abi, defaultSigner);
    let marketRegistry = new ethers.Contract(contracts.MarketRegistry.address, MarketRegistryAbi.abi, defaultSigner);

    let quoteToken = new ethers.Contract(contracts.QuoteToken.address, QuoteTokenAbi.abi, defaultSigner);
    let accountBalance = new ethers.Contract(contracts.AccountBalance.address, AccountBalanceAbi.abi, defaultSigner);
    let usdLemma = new ethers.Contract(USDLemmaAddress, USDLemma__factory.abi, defaultSigner);
    let settlementTokenManager = new ethers.Contract(
        SettlementTokenManagerAddress,
        SettlementTokenManager__factory.abi,
        defaultSigner,
    );
    let uniswapV3Factory = new ethers.Contract(
        externalContracts.UniswapV3Factory,
        UniswapV3FactoryAbi.abi,
        defaultSigner,
    );

    const stmRebalancer = defaultSigner.address;
    const settlementToken = await vault.getSettlementToken(); // usdc

    const collaterals = config[chainId].collaterals;

    for (let i = 0; i < collaterals.length; i++) {

        const collateralAddress = config[chainId].collaterals[i];
        const maxPosition = config[chainId].collateralParameters[collateralAddress].maxPosition;
        const collateralSymbol = config[chainId].collateralParameters[collateralAddress].symbol;
        const collateralName = config[chainId].collateralParameters[collateralAddress].name;
        const baseTokenAddress = contracts["v" + collateralSymbol].address;//vLINK

        let collateral = new ethers.Contract(collateralAddress, TestERC20Abi.abi, defaultSigner);
        let baseToken = new ethers.Contract(baseTokenAddress, BaseTokenAbi.abi, defaultSigner);

        console.log("baseTokenAddress", baseTokenAddress)


        console.log("deploying perpLemma");
        const perpLemmaFactory = await ethers.getContractFactory("PerpLemmaCommon");
        let perpLemma = await upgrades.deployProxy(
            perpLemmaFactory,
            [
                trustedForwarder,
                collateralAddress,
                baseToken.address,
                clearingHouse.address,
                marketRegistry.address,
                usdLemma.address,
                AddressZero,
                maxPosition,
            ],
            { initializer: "initialize" },
        );
        console.log("perpLemma.address: ", perpLemma.address);
        await delay(10000);


        // Deploy lemmaSynth
        const LemmaSynth = await ethers.getContractFactory("LemmaSynth");

        const lemmaSynthName = "Lemma" + collateralSymbol; //LemmaETH
        const lemmaSynthSymbol = "l" + collateralSymbol; //lETH
        const lemmaSynth = await upgrades.deployProxy(
            LemmaSynth,
            [trustedForwarder, perpLemma.address, settlementToken, collateralAddress, lemmaSynthName, lemmaSynthSymbol],
            {
                initializer: "initialize",
            },
        );
        console.log("lemmaSynth.address: ", lemmaSynth.address);
        await delay(10000);

        // Deploy xLemmaSynth
        console.log("deploying xLemmaSynth");

        const xLemmaSynthName = "x" + lemmaSynthName; //xLemmaETH
        const xLemmaSynthSymbol = "x" + lemmaSynthSymbol; //xlETH

        const XLemmaSynth = await ethers.getContractFactory("xLemmaSynth");
        const xLemmaSynth = await upgrades.deployProxy(
            XLemmaSynth,
            [trustedForwarder, lemmaSynth.address, peripheryAddress, xLemmaSynthName, xLemmaSynthSymbol],
            {
                initializer: "initialize",
            },
        );
        console.log("xLemmaSynth.address: ", xLemmaSynth.address);
        await delay(10000);

        console.log("configuring parameters");

        await perpLemma.connect(defaultSigner).setSettlementTokenManager(SettlementTokenManagerAddress);
        await delay(10000);

        await perpLemma.connect(defaultSigner).setReBalancer(reBalancer);
        await delay(10000);

        await perpLemma.setLemmaSynth(lemmaSynth.address);
        await delay(10000);

        await perpLemma.setXUsdl(xUSDL);
        await delay(10000);

        await perpLemma.setXSynth(xLemmaSynth.address);
        await delay(10000);

        await perpLemma.setPercFundingPaymentsToUSDLHolders(percFundingPaymentsToUSDLHolder);
        await delay(10000);

        // await perpLemma.setMinFreeCollateral(minFreeCollateral);
        // await delay(10000);

        // await perpLemma.setMinMarginSafeThreshold(minMarginSafeThreshold);
        // await delay(10000);

        await perpLemma.setCollateralRatio(collateralRatio);
        await delay(10000);

        await usdLemma.addPerpetualDEXWrapper(perpIndex, collateralAddress, perpLemma.address);
        await delay(10000);

        await lemmaSynth.setXSynth(xLemmaSynth.address);
        await delay(10000);

        await lemmaSynth.setFees(lemmaSynthSetFees);
        await delay(10000);

        await xLemmaSynth.setMinimumLock("100");
        await delay(10000);

        await perpLemma.setIsUsdlCollateralTailAsset(true);
        await delay(1000);


        console.log(await lemmaSynth.name());
        console.log(await lemmaSynth.symbol());
        console.log(await xLemmaSynth.name());
        console.log(await xLemmaSynth.symbol());
        const perpLemmaName = "PerpLemma" + collateralSymbol;// PerpLemmaETH



        deployedContracts[perpLemmaName] = {
            name: perpLemmaName,
            address: perpLemma.address,
        };

        deployedContracts[lemmaSynthSymbol] = {
            name: lemmaSynthSymbol,
            address: lemmaSynth.address,
        };

        deployedContracts[xLemmaSynthSymbol] = {
            name: xLemmaSynthSymbol,
            address: xLemmaSynth.address,
        };
    }
    await save(network);
}
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
