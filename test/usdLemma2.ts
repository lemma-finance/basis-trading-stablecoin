// import { expect } from "chai"
// import { BigNumber } from "ethers"
// import { parseEther, parseUnits } from "ethers/lib/utils"
// import { ethers, waffle } from "hardhat"
// import { MockProvider } from 'ethereum-waffle';
// const provider = new MockProvider();

// import { createUsdlFixture } from "./shared/fixtures"
// // import hre from "hardhat";
// describe("USDLemma2", async () => {
//     const [admin, maker, maker2, taker, carol] = provider.getWallets();
//     // const [admin, maker, maker2, taker, carol] = waffle.provider.getWallets()
//     const loadFixture: ReturnType<typeof waffle.createFixtureLoader> = waffle.createFixtureLoader([admin])
//     let liquidityPool, reader;
//     let mcdexLemma: any
//     let usdLemma: any
//     let collateral: any
//     beforeEach(async () => {
//         console.log('admin: ', admin.address)
//         const _usdlFixture = await loadFixture(createUsdlFixture())
//         mcdexLemma = _usdlFixture.mcdexLemma
//         usdLemma = _usdlFixture.usdLemma
//         collateral = _usdlFixture.collateral
//         liquidityPool = _usdlFixture.liquidityPool
//         reader = _usdlFixture.reader
//         console.log('mcdexLemma: ', mcdexLemma.address)

        
//     })

//     describe("opening long first then", () => {
//         beforeEach(async () => {

//         })
//         it("open position", async () => {
//             console.log("Hii")
//         })
//     })
// })