import { expect } from 'chai';
import { ethers, upgrades, waffle } from "hardhat";
import { 
    SynthToken1__factory,
    SynthToken2__factory,
    SynthBeacon__factory,
 } from '../../types';

describe("SynthFactory", () => {
    let contractsOwner, address1, address2: any;
    before(async() => {
        [contractsOwner, address1, address2] = await ethers.getSigners();
    })

    describe("SynthToken", async() => {
        let proxyCreatedEvent: any
        let hardhatSynthFactoryContract: any
        let hardhatSynthToken1FactoryContract: any
        let hardhatSynthToken2FactoryContract: any
        before('1', async() => {

            const SynthToken1FactoryContract = await ethers.getContractFactory('SynthToken1');
            hardhatSynthToken1FactoryContract = await SynthToken1FactoryContract.deploy();

            const SynthToken2FactoryContract = await ethers.getContractFactory('SynthToken2');
            hardhatSynthToken2FactoryContract = await SynthToken2FactoryContract.deploy();

            const SynthFactoryContract = await ethers.getContractFactory('MockSynthFactory');
            hardhatSynthFactoryContract = await SynthFactoryContract.deploy(hardhatSynthToken1FactoryContract.address);

            await hardhatSynthFactoryContract.create(
                ethers.constants.AddressZero, 
                address1.address,
                ethers.constants.AddressZero,
                "LemmaETH", 
                "iLETH"
            );
            await hardhatSynthFactoryContract.create(
                ethers.constants.AddressZero, 
                address2.address, 
                ethers.constants.AddressZero,
                "LemmaBTC", 
                "iLBTC"
            );
        })

        it("Check down, change implementation, Check down, up", async() => {

            const synthTokenData1 = await hardhatSynthFactoryContract.getSynthData(address1.address)
            const SynthToken1 = new ethers.Contract(
                synthTokenData1[0], SynthToken1__factory.abi, contractsOwner
            )
            await SynthToken1.down()

            const synthTokenData2 = await hardhatSynthFactoryContract.getSynthData(address2.address)
            const SynthToken2 = new ethers.Contract(
                synthTokenData2[0], SynthToken1__factory.abi, contractsOwner
            )
            await SynthToken2.down()

            // update new Implementation
            const getbeacon = await hardhatSynthFactoryContract.getBeacon()
            const BeaconContract = new ethers.Contract(
                getbeacon, SynthBeacon__factory.abi, contractsOwner
            )
            await BeaconContract.update(hardhatSynthToken2FactoryContract.address)
                        
            // after new Implementation
            const SynthToken1_2 = new ethers.Contract(
                synthTokenData1[0], SynthToken2__factory.abi, contractsOwner
            )
            await SynthToken1_2.up()
            await SynthToken1_2.up()
            await SynthToken1_2.down()
            const SynthToken2_2 = new ethers.Contract(
                synthTokenData2[0], SynthToken2__factory.abi, contractsOwner
            )
            await SynthToken2_2.up()
            await SynthToken2_2.up()
            await SynthToken2_2.down()

        })
    })
})
