const { ethers } = require("hardhat");
const { expect } = require("chai");
const { utils } = require('ethers');
const { BigNumber, constants } = ethers;
const { AddressZero, MaxUint256, MaxInt256 } = constants;


const approveMAX = async (erc20, signer, to, amount) => {
    if ((await erc20.allowance(signer.address, to)).lt(amount)) {
        let tx = await erc20.connect(signer).approve(to, MaxUint256);
        await tx.wait();
    }
};

const balanceOf = async (erc20, userAddress) => {
    return await erc20.balanceOf(userAddress);
};



async function mineBlocks(blockNumber) {
    while (blockNumber > 0) {
        blockNumber--;
        await hre.network.provider.request({
            method: "evm_mine",
            params: [],
        });
    }
}

describe('xUSDL', function () {

    let owner;
    let user1;
    let user2;

    beforeEach(async function () {
        // Get the ContractFactory and Signers here.
        let Token = await ethers.getContractFactory("Token");
        [owner, user1, user2] = await ethers.getSigners();

        // To deploy our contract, we just have to call Token.deploy() and await
        // for it to be deployed(), which happens onces its transaction has been
        // mined.
        this.usdl = await upgrades.deployProxy(Token, [utils.parseEther("1000000")], { initializer: 'initialize' });

        let XUSDL = await ethers.getContractFactory("xUSDL");

        this.xusdl = await upgrades.deployProxy(XUSDL, [AddressZero, this.usdl.address], { initializer: 'initialize' });

        await approveMAX(this.usdl, owner, this.xusdl.address, utils.parseEther("1000"));
        await approveMAX(this.usdl, user1, this.xusdl.address, utils.parseEther("1000"));
        await approveMAX(this.usdl, user2, this.xusdl.address, utils.parseEther("1000"));
    });


    it('should initialize correctly', async function () {
        expect(await this.xusdl.usdl()).to.equal(this.usdl.address);
        expect(await balanceOf(this.usdl, owner.address)).to.equal(utils.parseEther("1000000"));
    });

    it('should deposit initial correctly', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));
        expect(await balanceOf(this.xusdl, owner.address)).to.equal(utils.parseEther("1000"));
    });

    it('should price per share greater than 1 when more USDL', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));

        await this.usdl.transfer(this.xusdl.address, utils.parseEther("1000"));

        expect(await this.xusdl.pricePerShare()).gt(utils.parseEther("1"));
    });

    it('should price per share less than 1 when more USDL', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));

        await this.usdl.removeTokens(utils.parseEther("100"), this.xusdl.address);

        expect(await this.xusdl.pricePerShare()).lt(utils.parseEther("1"));
    });

    it('should mint less XUSDL when price per share greater than 1', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));

        await this.usdl.transfer(this.xusdl.address, utils.parseEther("1000"));

        await this.usdl.transfer(user1.address, utils.parseEther("1000"));

        await this.xusdl.connect(user1).deposit(utils.parseEther("1000"));

        expect(await balanceOf(this.xusdl, user1.address)).equal(utils.parseEther("500"));
    });

    it('should mint more XUSDL when price per share less than 1', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));

        await this.usdl.removeTokens(utils.parseEther("500"), this.xusdl.address);

        await this.usdl.transfer(user1.address, utils.parseEther("1000"));

        await this.xusdl.connect(user1).deposit(utils.parseEther("1000"));

        expect(await balanceOf(this.xusdl, user1.address)).equal(utils.parseEther("2000"));

    });


    it('should revert while withdrawing & transfer before minimum lock', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));

        await mineBlocks(97);

        await expect(this.xusdl.transfer(user1.address, await balanceOf(this.xusdl, owner.address)))
            .to.be.revertedWith('xUSDL: Locked tokens');
        await expect(this.xusdl.withdraw(await balanceOf(this.xusdl, owner.address)))
            .to.be.revertedWith('xUSDL: Locked tokens');
    });

    it('should withdraw & transfer after minimum lock', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));

        await mineBlocks(100);

        await expect(this.xusdl.transfer(user1.address, utils.parseEther("100")))
            .not.to.be.reverted;
        await expect(this.xusdl.withdraw(await balanceOf(this.xusdl, owner.address)))
            .not.to.be.reverted;
    });


    it('should withdraw same amount as deposited', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));

        await mineBlocks(100);
        let preBalance = await balanceOf(this.usdl, owner.address);
        await this.xusdl.withdraw(await balanceOf(this.xusdl, owner.address));

        let postBalance = await balanceOf(this.usdl, owner.address);
        expect(postBalance.sub(preBalance)).equal(utils.parseEther("1000"));
    });


    it('should withdraw more USDL as price per share increases', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));

        await mineBlocks(100);
        await this.usdl.transfer(this.xusdl.address, utils.parseEther("1000"));

        let preBalance = await balanceOf(this.usdl, owner.address);
        await this.xusdl.withdraw(await balanceOf(this.xusdl, owner.address));

        let postBalance = await balanceOf(this.usdl, owner.address);
        expect(postBalance.sub(preBalance)).equal(utils.parseEther("2000"));
    });

    it('should withdraw less USDL as price per share decreases', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));

        await mineBlocks(100);

        await this.usdl.removeTokens(utils.parseEther("500"), this.xusdl.address);

        let preBalance = await balanceOf(this.usdl, owner.address);
        await this.xusdl.withdraw(await balanceOf(this.xusdl, owner.address));

        let postBalance = await balanceOf(this.usdl, owner.address);
        expect(postBalance.sub(preBalance)).equal(utils.parseEther("500"));
    });

    it('should deposit to another user', async function() {
        await this.xusdl.depositTo(user1.address, utils.parseEther("1000"));

        expect(await balanceOf(this.xusdl, user1.address)).equal(utils.parseEther("1000"));       
    })

    it('should disable withdraw & transfer before minimum lock for depositing another user', async function() {
        await this.xusdl.depositTo(user1.address, utils.parseEther("1000"));

        await mineBlocks(80);

        await expect(this.xusdl.connect(user1).transfer(owner.address, utils.parseEther("100")))
        .to.be.revertedWith('xUSDL: Locked tokens');
        await expect(this.xusdl.connect(user1).withdraw(utils.parseEther("1000")))
        .to.be.revertedWith('xUSDL: Locked tokens');        
    })


    it('should enable withdraw after minimum lock for depositing another user', async function() {
        await this.xusdl.depositTo(user1.address, utils.parseEther("1000"));

        await mineBlocks(100);

        await expect(this.xusdl.connect(user1).withdraw(utils.parseEther("1000")))
        .not.to.be.reverted;        
    })

    it('should withdraw to another user', async function() {
        await this.xusdl.deposit(utils.parseEther("1000"));

        await mineBlocks(100);

        let preBalance = await balanceOf(this.usdl, user1.address);
        await this.xusdl.withdrawTo(user1.address, await balanceOf(this.xusdl, owner.address));

        let postBalance = await balanceOf(this.usdl, user1.address);
        expect(postBalance.sub(preBalance)).equal(utils.parseEther("1000"));     
    })


});