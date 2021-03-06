import { ethers, upgrades } from "hardhat";
import { expect, util } from "chai";
import { utils } from 'ethers';
const { BigNumber, constants } = ethers;
const { AddressZero, MaxUint256, MaxInt256 } = constants;
import hre from "hardhat";

const approveMAX = async (erc20: any, signer: any, to: any, amount: any) => {
    if ((await erc20.allowance(signer.address, to)).lt(amount)) {
        let tx = await erc20.connect(signer).approve(to, MaxUint256);
        await tx.wait();
    }
};

const balanceOf = async (erc20: any, userAddress: any) => {
    return await erc20.balanceOf(userAddress);
};



async function mineBlocks(blockNumber: any) {
    while (blockNumber > 0) {
        blockNumber--;
        await hre.network.provider.request({
            method: "evm_mine",
            params: [],
        });
    }
}

describe('xUSDL', function () {

    let owner: any;
    let user1: any;
    let user2: any;
    let periphery: any;

    beforeEach(async function () {
        // Get the ContractFactory and Signers here.
        let Token = await ethers.getContractFactory("Token");
        [owner, user1, user2, periphery] = await ethers.getSigners();

        this.usdl = await upgrades.deployProxy(Token, [utils.parseEther("1000000")], { initializer: 'initialize' });

        let XUSDL = await ethers.getContractFactory("xUSDL");
        this.xusdl = await upgrades.deployProxy(XUSDL, [AddressZero, this.usdl.address, periphery.address], { initializer: 'initialize' });
        await this.xusdl.updateLock(100);

        await approveMAX(this.usdl, owner, this.xusdl.address, utils.parseEther("1000"));
        await approveMAX(this.usdl, user1, this.xusdl.address, utils.parseEther("1000"));
        await approveMAX(this.usdl, user2, this.xusdl.address, utils.parseEther("1000"));
        await approveMAX(this.usdl, periphery, this.xusdl.address, utils.parseEther("1000"));
    });


    it('should initialize correctly', async function () {
        expect(await this.xusdl.usdl()).to.equal(this.usdl.address);
        expect(await balanceOf(this.usdl, owner.address)).to.equal(utils.parseEther("1000000"));
    });

    it('should deposit initial correctly', async function () {
        let tx = await this.xusdl.deposit(utils.parseEther("1000"));
        expect(await balanceOf(this.xusdl, owner.address)).to.equal(utils.parseEther("1000"));
        expect(tx).to.emit(this.xusdl, "Deposit").withArgs(owner.address, utils.parseEther("1000"));
    });

    it('pricePerShare should stay the same after multiple deposits in a row', async function () {
        //pricePeShare only changes when USDL are added or removed from xUSDL without deposit or withdraw transactions
        let tx = await this.xusdl.deposit(utils.parseEther("1000"));
        expect(await balanceOf(this.xusdl, owner.address)).to.equal(utils.parseEther("1000"));
        expect(tx).to.emit(this.xusdl, "Deposit").withArgs(owner.address, utils.parseEther("1000"));

        await this.usdl.removeTokens(utils.parseEther("235"), this.xusdl.address);
        let pricePerShareBefore = await this.xusdl.pricePerShare();
        await this.xusdl.deposit(utils.parseEther("123"));
        await this.xusdl.deposit(utils.parseEther("489"));
        await this.xusdl.deposit(utils.parseEther("345"));

        let pricePerShareAfter = await this.xusdl.pricePerShare();
        expect(pricePerShareBefore).to.equal(pricePerShareAfter);
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

    it("should revert while withdrawing & transfer before minimum lock when periphery contract deposits on behalf of an address", async function () {
        //transfer is allowed for periphery but periphery will transfer the newly minted xUSDL to an address and that address should not be allowed be transferred until minimum lock has passed
        await this.usdl.transfer(periphery.address, utils.parseEther("10000"));
        await this.xusdl.connect(periphery).deposit(utils.parseEther("1000"));

        let bal = await this.xusdl.balanceOf(periphery.address);
        await this.xusdl.connect(periphery).transfer(user1.address, bal);
        await mineBlocks(97);

        await expect(this.xusdl.connect(user1).transfer(user1.address, await balanceOf(this.xusdl, owner.address)))
            .to.be.revertedWith('xUSDL: Locked tokens');
        await expect(this.xusdl.connect(user1).withdraw(await balanceOf(this.xusdl, owner.address)))
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
        let tx = await this.xusdl.withdraw(await balanceOf(this.xusdl, owner.address));

        let postBalance = await balanceOf(this.usdl, owner.address);
        expect(postBalance.sub(preBalance)).equal(utils.parseEther("1000"));
        expect(tx).to.emit(this.xusdl, "Withdraw").withArgs(owner.address, utils.parseEther("1000"));
    });


    it('should withdraw more USDL as price per share increases', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));

        await mineBlocks(100);
        await this.usdl.transfer(this.xusdl.address, utils.parseEther("1000"));

        let preBalance = await balanceOf(this.usdl, owner.address);
        let tx = await this.xusdl.withdraw(await balanceOf(this.xusdl, owner.address));

        let postBalance = await balanceOf(this.usdl, owner.address);
        expect(postBalance.sub(preBalance)).equal(utils.parseEther("2000"));
        expect(tx).to.emit(this.xusdl, "Withdraw").withArgs(owner.address, utils.parseEther("2000"));
    });

    it('should withdraw less USDL as price per share decreases', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));
        await mineBlocks(100);
        await this.usdl.removeTokens(utils.parseEther("500"), this.xusdl.address);

        let preBalance = await balanceOf(this.usdl, owner.address);
        let tx = await this.xusdl.withdraw(await balanceOf(this.xusdl, owner.address));

        let postBalance = await balanceOf(this.usdl, owner.address);
        expect(postBalance.sub(preBalance)).equal(utils.parseEther("500"));
        expect(tx).to.emit(this.xusdl, "Withdraw").withArgs(owner.address, utils.parseEther("500"));
    });

    it('should deposit and transfer from periphery without minimum blocks lock', async function () {
        await this.usdl.transfer(periphery.address, utils.parseEther("10000"));
        await this.xusdl.connect(periphery).deposit(utils.parseEther("1000"));
        let bal = await this.xusdl.balanceOf(periphery.address);
        await expect(this.xusdl.connect(periphery).transfer(owner.address, bal))
            .not.to.be.reverted;
    });

    it('should withdraw to another user', async function () {
        await this.xusdl.deposit(utils.parseEther("1000"));
        await mineBlocks(100);
        let preBalance = await balanceOf(this.usdl, user1.address);
        await this.xusdl.withdrawTo(user1.address, await balanceOf(this.xusdl, owner.address));
        let postBalance = await balanceOf(this.usdl, user1.address);
        expect(postBalance.sub(preBalance)).equal(utils.parseEther("1000"));
    });


});