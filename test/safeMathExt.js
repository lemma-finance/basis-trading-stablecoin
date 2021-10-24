const { ethers } = require("hardhat");
const BigNumber = require("bignumber.js");
const { expect } = require("chai");

//same tests as https://github.com/mcdexio/mai-protocol-v3/blob/master/test/LibSafeMathExt.test.ts
//modified for solidity version 0.8.3
const weis = new BigNumber('1000000000000000000');
const toWad = (x) => {
    return new BigNumber(x).times(weis).toFixed(0);
};

describe('LibSafeMathExt', () => {
    let libSafeMathExt;

    beforeEach(async () => {
        const SafeMathExt = await ethers.getContractFactory("TestLibSafeMathExt");
        libSafeMathExt = await SafeMathExt.deploy();
    });

    describe('mul', () => {
        it('uint256 half up', async () => {
            expect(await libSafeMathExt.uwmul(toWad('0.000000000000000044'), toWad('0.1'))).to.equal(toWad('0.000000000000000004'));
            expect(await libSafeMathExt.uwmul(toWad('0.000000000000000045'), toWad('0.1'))).to.equal(toWad('0.000000000000000005'));
            expect(await libSafeMathExt.uwmul(toWad('100'), toWad('1'))).to.equal(toWad('100'));
            expect(await libSafeMathExt.uwmul(toWad('100'), toWad('0'))).to.equal(toWad('0'));
        });

        it('int256 half up', async () => {
            expect(await libSafeMathExt["wmul(int256,int256)"](toWad('0.000000000000000044'), toWad('0.1'))).to.equal(toWad('0.000000000000000004'));
            expect(await libSafeMathExt["wmul(int256,int256)"](toWad('0.000000000000000045'), toWad('0.1'))).to.equal(toWad('0.000000000000000005'));
            expect(await libSafeMathExt["wmul(int256,int256)"](toWad('100'), toWad('1'))).to.equal(toWad('100'));
            expect(await libSafeMathExt["wmul(int256,int256)"](toWad('100'), toWad('0'))).to.equal(toWad('0'));
            expect(await libSafeMathExt["wmul(int256,int256)"](toWad('-0.000000000000000044'), toWad('0.1'))).to.equal(toWad('-0.000000000000000004'));
            expect(await libSafeMathExt["wmul(int256,int256)"](toWad('-0.000000000000000045'), toWad('0.1'))).to.equal(toWad('-0.000000000000000005'));
            expect(await libSafeMathExt["wmul(int256,int256)"](toWad('100'), toWad('-1'))).to.equal(toWad('-100'));
            expect(await libSafeMathExt["wmul(int256,int256)"](toWad('-100'), toWad('0'))).to.equal(toWad('0'));
        });

        it('int256 ceil', async () => {
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('0.000000000000000044'), toWad('0.1'), 0)).to.equal(toWad('0.000000000000000005'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('0.000000000000000045'), toWad('0.1'), 0)).to.equal(toWad('0.000000000000000005'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('100'), toWad('1'), 0)).to.equal(toWad('100'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('100'), toWad('0'), 0)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('-0.000000000000000044'), toWad('0.1'), 0)).to.equal(toWad('-0.000000000000000004'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('-0.000000000000000045'), toWad('0.1'), 0)).to.equal(toWad('-0.000000000000000004'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('100'), toWad('-1'), 0)).to.equal(toWad('-100'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('-100'), toWad('0'), 0)).to.equal(toWad('0'));
        });

        it('int256 floor', async () => {
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('0.000000000000000044'), toWad('0.1'), 1)).to.equal(toWad('0.000000000000000004'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('0.000000000000000045'), toWad('0.1'), 1)).to.equal(toWad('0.000000000000000004'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('100'), toWad('1'), 1)).to.equal(toWad('100'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('100'), toWad('0'), 1)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('-0.000000000000000044'), toWad('0.1'), 1)).to.equal(toWad('-0.000000000000000005'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('-0.000000000000000045'), toWad('0.1'), 1)).to.equal(toWad('-0.000000000000000005'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('100'), toWad('-1'), 1)).to.equal(toWad('-100'));
            expect(await libSafeMathExt["wmul(int256,int256,uint8)"](toWad('-100'), toWad('0'), 1)).to.equal(toWad('0'));
        });

    });

    describe('div', () => {
        it('uint256 half up', async () => {
            expect(await libSafeMathExt.uwdiv(toWad('0.000000000000000004'), toWad('10'))).to.equal(toWad('0'));
            expect(await libSafeMathExt.uwdiv(toWad('0.000000000000000005'), toWad('10'))).to.equal(toWad('0.000000000000000001'));
            expect(await libSafeMathExt.uwdiv(toWad('100'), toWad('1'))).to.equal(toWad('100'));
            expect(await libSafeMathExt.uwdiv(toWad('0'), toWad('1'))).to.equal(toWad('0'));
            await expect(libSafeMathExt.uwdiv(toWad('100'), toWad('0'))).to.be.reverted;
        });

        it('int256 half up', async () => {
            expect(await libSafeMathExt["wdiv(int256,int256)"](toWad('0.000000000000000004'), toWad('10'))).to.equal(toWad('0'));
            expect(await libSafeMathExt["wdiv(int256,int256)"](toWad('0.000000000000000005'), toWad('10'))).to.equal(toWad('0.000000000000000001'));
            expect(await libSafeMathExt["wdiv(int256,int256)"](toWad('100'), toWad('1'))).to.equal(toWad('100'));
            expect(await libSafeMathExt["wdiv(int256,int256)"](toWad('0'), toWad('1'))).to.equal(toWad('0'));
            expect(await libSafeMathExt["wdiv(int256,int256)"](toWad('-0.000000000000000004'), toWad('10'))).to.equal(toWad('0'));
            expect(await libSafeMathExt["wdiv(int256,int256)"](toWad('-0.000000000000000005'), toWad('10'))).to.equal(toWad('-0.000000000000000001'));
            expect(await libSafeMathExt["wdiv(int256,int256)"](toWad('100'), toWad('-1'))).to.equal(toWad('-100'));
            expect(await libSafeMathExt["wdiv(int256,int256)"](toWad('0'), toWad('-1'))).to.equal(toWad('0'));
            await expect(libSafeMathExt["wdiv(int256,int256)"](toWad('100'), toWad('0'))).to.be.revertedWith('roundHalfUp only supports y > 0');
        });

        it('int256 ceil', async () => {
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('0.000000000000000004'), toWad('10'), 0)).to.equal(toWad('0.000000000000000001'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('0.000000000000000005'), toWad('10'), 0)).to.equal(toWad('0.000000000000000001'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('100'), toWad('1'), 0)).to.equal(toWad('100'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('0'), toWad('1'), 0)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('-0.000000000000000004'), toWad('10'), 0)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('-0.000000000000000005'), toWad('10'), 0)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('100'), toWad('-1'), 0)).to.equal(toWad('-100'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('0'), toWad('-1'), 0)).to.equal(toWad('0'));
            await expect(libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('100'), toWad('0'), 0)).to.be.revertedWith('division by zero');
        });

        it('int256 floor', async () => {
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('0.000000000000000004'), toWad('10'), 1)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('0.000000000000000005'), toWad('10'), 1)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('100'), toWad('1'), 1)).to.equal(toWad('100'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('0'), toWad('1'), 1)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('-0.000000000000000004'), toWad('10'), 1)).to.equal(toWad('-0.000000000000000001'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('-0.000000000000000005'), toWad('10'), 1)).to.equal(toWad('-0.000000000000000001'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('100'), toWad('-1'), 1)).to.equal(toWad('-100'));
            expect(await libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('0'), toWad('-1'), 1)).to.equal(toWad('0'));
            await expect(libSafeMathExt["wdiv(int256,int256,uint8)"](toWad('100'), toWad('0'), 1)).to.be.revertedWith('division by zero');
        });

    });

    describe('frac', () => {
        it('uint256 half up', async () => {
            expect(await libSafeMathExt.uwfrac(toWad('0.000000000000000002'), toWad('2'), toWad('10'))).to.equal(toWad('0'));
            expect(await libSafeMathExt.uwfrac(toWad('0.000000000000000001'), toWad('5'), toWad('10'))).to.equal(toWad('0.000000000000000001'));
            expect(await libSafeMathExt.uwfrac(toWad('20'), toWad('0.3'), toWad('1'))).to.equal(toWad('6'));
            expect(await libSafeMathExt.uwfrac(toWad('0'), toWad('20.1'), toWad('1'))).to.equal(toWad('0'));
            await expect(libSafeMathExt.uwfrac(toWad('100'), toWad('1'), toWad('0'))).to.be.reverted;
        });

        it('int256 half up', async () => {
            expect(await libSafeMathExt["wfrac(int256,int256,int256)"](toWad('0.000000000000000002'), toWad('2'), toWad('10'))).to.equal(toWad('0'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256)"](toWad('0.000000000000000001'), toWad('5'), toWad('10'))).to.equal(toWad('0.000000000000000001'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256)"](toWad('20'), toWad('0.3'), toWad('1'))).to.equal(toWad('6'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256)"](toWad('0'), toWad('20.1'), toWad('1'))).to.equal(toWad('0'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256)"](toWad('-0.000000000000000002'), toWad('2'), toWad('10'))).to.equal(toWad('0'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256)"](toWad('-0.000000000000000001'), toWad('5'), toWad('10'))).to.equal(toWad('-0.000000000000000001'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256)"](toWad('20'), toWad('-0.3'), toWad('1'))).to.equal(toWad('-6'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256)"](toWad('0'), toWad('-20.1'), toWad('-1'))).to.equal(toWad('0'));
            await expect(libSafeMathExt["wfrac(int256,int256,int256)"](toWad('-100'), toWad('1'), toWad('0'))).to.be.revertedWith('roundHalfUp only supports y > 0');
        });

        it('int256 ceil', async () => {
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('0.000000000000000002'), toWad('2'), toWad('10'), 0)).to.equal(toWad('0.000000000000000001'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('0.000000000000000001'), toWad('5'), toWad('10'), 0)).to.equal(toWad('0.000000000000000001'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('20'), toWad('0.3'), toWad('1'), 0)).to.equal(toWad('6'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('0'), toWad('20.1'), toWad('1'), 0)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('-0.000000000000000002'), toWad('2'), toWad('10'), 0)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('-0.000000000000000001'), toWad('5'), toWad('10'), 0)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('20'), toWad('-0.3'), toWad('1'), 0)).to.equal(toWad('-6'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('0'), toWad('-20.1'), toWad('-1'), 0)).to.equal(toWad('0'));
            await expect(libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('-100'), toWad('1'), toWad('0'), 0)).to.be.revertedWith('division by zero');
        });

        it('int256 down', async () => {
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('0.000000000000000002'), toWad('2'), toWad('10'), 1)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('0.000000000000000001'), toWad('5'), toWad('10'), 1)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('20'), toWad('0.3'), toWad('1'), 1)).to.equal(toWad('6'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('0'), toWad('20.1'), toWad('1'), 1)).to.equal(toWad('0'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('-0.000000000000000002'), toWad('2'), toWad('10'), 1)).to.equal(toWad('-0.000000000000000001'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('-0.000000000000000001'), toWad('5'), toWad('10'), 1)).to.equal(toWad('-0.000000000000000001'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('20'), toWad('-0.3'), toWad('1'), 1)).to.equal(toWad('-6'));
            expect(await libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('0'), toWad('-20.1'), toWad('-1'), 1)).to.equal(toWad('0'));
            await expect(libSafeMathExt["wfrac(int256,int256,int256,uint8)"](toWad('-100'), toWad('1'), toWad('0'), 1)).to.be.revertedWith('division by zero');
        });

    });

    describe('others', () => {
        it('uint256 max', async () => {
            expect(await libSafeMathExt.umax(toWad('0.1'), toWad('0.2'))).to.equal(toWad('0.2'));
            expect(await libSafeMathExt.umax(toWad('0.1'), toWad('0.1'))).to.equal(toWad('0.1'));
        });

        it('uint256 min', async () => {
            expect(await libSafeMathExt.umin(toWad('0.1'), toWad('0.2'))).to.equal(toWad('0.1'));
            expect(await libSafeMathExt.umin(toWad('0.1'), toWad('0.1'))).to.equal(toWad('0.1'));
        });

        it('int256 max', async () => {
            expect(await libSafeMathExt.max(toWad('0.1'), toWad('0.2'))).to.equal(toWad('0.2'));
            expect(await libSafeMathExt.max(toWad('0.1'), toWad('0.1'))).to.equal(toWad('0.1'));
            expect(await libSafeMathExt.max(toWad('-0.1'), toWad('-0.2'))).to.equal(toWad('-0.1'));
            expect(await libSafeMathExt.max(toWad('-0.1'), toWad('-0.1'))).to.equal(toWad('-0.1'));
        });

        it('int256 min', async () => {
            expect(await libSafeMathExt.min(toWad('0.1'), toWad('0.2'))).to.equal(toWad('0.1'));
            expect(await libSafeMathExt.min(toWad('0.1'), toWad('0.1'))).to.equal(toWad('0.1'));
            expect(await libSafeMathExt.min(toWad('-0.1'), toWad('-0.2'))).to.equal(toWad('-0.2'));
            expect(await libSafeMathExt.min(toWad('-0.1'), toWad('-0.1'))).to.equal(toWad('-0.1'));
        });

        it('abs', async () => {
            expect(await libSafeMathExt.abs(toWad('0.1'))).to.equal(toWad('0.1'));
            expect(await libSafeMathExt.abs(toWad('-0.1'))).to.equal(toWad('0.1'));
            expect(await libSafeMathExt.abs(toWad('0'))).to.equal(toWad('0'));
        });

        it('neg', async () => {
            expect(await libSafeMathExt.neg(toWad('0.1'))).to.equal(toWad('-0.1'));
            expect(await libSafeMathExt.neg(toWad('-0.1'))).to.equal(toWad('0.1'));
            expect(await libSafeMathExt.neg(toWad('0'))).to.equal(toWad('0'));
        });

    });


});
