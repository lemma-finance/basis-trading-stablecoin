import {
	expect
} from 'chai';
import { ethers, upgrades, waffle } from "hardhat";
import {
	BigNumber
} from '@ethersproject/bignumber';
import {
	JsonRpcProvider
} from '@ethersproject/providers';
import SynthTokenAbi from "../../artifacts/contracts/SynthToken.sol/SynthToken.json";
import {
  SynthTokenFactory,
  SynthToken,
} from '../../types';
import { Signer } from 'ethers';
import { parseEther } from 'ethers/lib/utils';

describe('SunthToken Factory tests', () => {
    let contractsOwner: any;
    let provider: JsonRpcProvider;
    let synthToken: SynthToken
    provider = waffle.provider;

    before(async() => {
        [contractsOwner] = await ethers.getSigners();
    })

    describe("SynthToken using ClonesUpgradeable from OpenZeppelin for nonLp token", async() => {
        let proxyCreatedEvent: any
        before('Should create SynthToken using SynthToken factory using OZ clones', async() => {

            // GenericProxyFactory is using ClonesUpgradeable from OpenZeppelin
            const genericProxyFactoryContract = await ethers.getContractFactory('GenericProxyFactory');
            const hardhatGenericProxyFactory = await genericProxyFactoryContract.deploy();

            const SynthTokenFactory = await ethers.getContractFactory('SynthTokenFactory');
            const hardhatSynthTokenFactory = (await SynthTokenFactory.deploy(
                hardhatGenericProxyFactory.address
            ) as unknown) as SynthTokenFactory;

            // deploy SynthToken using `createNewProxy` function and perform all tx in single tx
            const initializeTx = await hardhatSynthTokenFactory.createNewProxy(
                ethers.constants.AddressZero, 
                ethers.constants.AddressZero, 
                ethers.constants.AddressZero, 
                "LemmaETH", 
                "iLETH"
            );

            const receipt = await provider.getTransactionReceipt(initializeTx.hash);
            proxyCreatedEvent = hardhatGenericProxyFactory.interface.parseLog(
                receipt.logs[0],
            );

            expect(proxyCreatedEvent.name).to.equal('ProxyCreated');

            synthToken = (await ethers.getContractAt(
                SynthTokenAbi.abi,
                proxyCreatedEvent.args[0],
                contractsOwner,
            ) as unknown) as SynthToken;
        })

        it ('new SynthToken address should match', async() => {
            console.log('New Instance addresses by clones');
            console.log('synthToken.address: ', synthToken.address);
            console.log('proxyCreatedEvent.args[0]: ', proxyCreatedEvent.args[0]);
            expect(synthToken.address).to.eq(proxyCreatedEvent.args[0])
        })

        it ('Check name and Symbol', async() => {
            const name = await synthToken.name();
            const symbol = await synthToken.symbol();
            console.log('name: ', name);
            console.log('symbol: ', symbol);
            expect(name).to.eq("LemmaETH")
            expect(symbol).to.eq("iLETH")
        })
    })
})