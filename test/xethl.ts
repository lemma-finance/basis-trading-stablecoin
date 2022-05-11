import { ethers, upgrades } from "hardhat";
import hre from "hardhat";
import { expect, util } from "chai";
import { utils } from "ethers";
import { parseEther, parseUnits } from "ethers/lib/utils";
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

describe("eip4626xETHL", function () {
  let owner;
  let user1;
  let user2;
  let periphery;

  beforeEach(async function () {
    // Get the ContractFactory and Signers here.
    let Token = await ethers.getContractFactory("Token");
    [owner, user1, user2, periphery] = await ethers.getSigners();

    this.ethl = await upgrades.deployProxy(Token, [utils.parseEther("1000000")], { initializer: "initialize" });

    let XETHL = await ethers.getContractFactory("xETHL");
    this.xethl = await upgrades.deployProxy(XETHL, [AddressZero, this.ethl.address, periphery.address], {
      initializer: "initialize",
    });
    await this.xethl.setMinimumLock(100);

    await approveMAX(this.ethl, owner, this.xethl.address, utils.parseEther("1000"));
    await approveMAX(this.ethl, user1, this.xethl.address, utils.parseEther("1000"));
    await approveMAX(this.ethl, user2, this.xethl.address, utils.parseEther("1000"));
    await approveMAX(this.ethl, periphery, this.xethl.address, utils.parseEther("1000"));
  });

  async function previewShare(xethl, assets) {
    const totalSupply = await xethl.totalSupply();
    let shares;
    if (totalSupply == 0) {
      shares = totalSupply;
    } else {
      const assetsPerShare = await xethl.assetsPerShare();
      shares = assets.mul(parseEther("1")).div(assetsPerShare);
    }
    return shares;
  }

  async function previewAmount(xethl, shares) {
    const assetsPerShare = await xethl.assetsPerShare();
    let assets = assetsPerShare.mul(shares).div(parseEther("1"));
    return assets;
  }

  it("should initialize correctly", async function () {
    expect(await this.xethl.usdl()).to.equal(this.ethl.address);
    expect(await balanceOf(this.ethl, owner.address)).to.equal(utils.parseEther("1000000"));
  });
  it("should set periphery address correctly", async function () {
    await expect(this.xethl.connect(user1).setPeriphery(user2.address)).to.be.revertedWith(
      "Ownable: caller is not the owner",
    );
    let tx = await this.xethl.setPeriphery(user2.address);
    expect(tx).to.emit(this.xethl, "PeripheryUpdated").withArgs(user2.address);
    expect(await this.xethl.periphery()).to.equal(user2.address);
  });
  it("should set lock correctly", async function () {
    await expect(this.xethl.connect(user1).setMinimumLock(200)).to.be.revertedWith("Ownable: caller is not the owner");
    let tx = await this.xethl.setMinimumLock(200);
    expect(tx).to.emit(this.xethl, "MinimumLockUpdated").withArgs(200);
    expect(await this.xethl.minimumLock()).to.equal(200);
  });

  it("should deposit initial correctly", async function () {
    let tx = await this.xethl.deposit(utils.parseEther("1000"), owner.address);
    let share = await previewShare(this.xethl, utils.parseEther("1000"));
    expect(await balanceOf(this.xethl, owner.address)).to.equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xethl, "Deposit").withArgs(owner.address, owner.address, utils.parseEther("1000"), share);
  });

  it("assetsPerShare should stay the same after multiple deposits in a row", async function () {
    //pricePeShare only changes when ETHL are added or removed from xETHL without deposit or withdraw transactions
    let tx = await this.xethl.deposit(utils.parseEther("1000"), owner.address);
    let share = await previewShare(this.xethl, utils.parseEther("1000"));
    expect(await balanceOf(this.xethl, owner.address)).to.equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xethl, "Deposit").withArgs(owner.address, owner.address, utils.parseEther("1000"), share);
    // expect(tx).to.emit(this.xethl, "Deposit").withArgs(owner.address, utils.parseEther("1000"));

    await this.ethl.removeTokens(utils.parseEther("235"), this.xethl.address);
    let pricePerShareBefore = await this.xethl.assetsPerShare();
    await this.xethl.deposit(utils.parseEther("123"), owner.address);
    await this.xethl.deposit(utils.parseEther("489"), owner.address);
    await this.xethl.deposit(utils.parseEther("345"), owner.address);

    let pricePerShareAfter = await this.xethl.assetsPerShare();
    expect(pricePerShareBefore).to.equal(pricePerShareAfter);
  });

  it("should price per share greater than 1 when more ETHL", async function () {
    await this.xethl.deposit(utils.parseEther("1000"), owner.address);
    await this.ethl.transfer(this.xethl.address, utils.parseEther("1000"));
    expect(await this.xethl.assetsPerShare()).gt(utils.parseEther("1"));
  });

  it("should price per share less than 1 when more ETHL", async function () {
    await this.xethl.deposit(utils.parseEther("1000"), owner.address);
    await this.ethl.removeTokens(utils.parseEther("100"), this.xethl.address);
    expect(await this.xethl.assetsPerShare()).lt(utils.parseEther("1"));
  });

  it("should mint less XETHL when price per share greater than 1", async function () {
    await this.xethl.deposit(utils.parseEther("1000"), owner.address);
    await this.ethl.transfer(this.xethl.address, utils.parseEther("1000"));
    await this.ethl.transfer(user1.address, utils.parseEther("1000"));
    await this.xethl.connect(user1).deposit(utils.parseEther("1000"), user1.address);
    expect(await balanceOf(this.xethl, user1.address)).equal(utils.parseEther("500"));
  });

  it("should mint more XETHL when price per share less than 1", async function () {
    await this.xethl.deposit(utils.parseEther("1000"), owner.address);
    await this.ethl.removeTokens(utils.parseEther("500"), this.xethl.address);
    await this.ethl.transfer(user1.address, utils.parseEther("1000"));
    await this.xethl.connect(user1).deposit(utils.parseEther("1000"), user1.address);
    expect(await balanceOf(this.xethl, user1.address)).equal(utils.parseEther("2000"));
  });

  it("should revert while withdrawing & transfer before minimum lock", async function () {
    await this.xethl.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(97);

    await expect(this.xethl.transfer(user1.address, await balanceOf(this.xethl, owner.address))).to.be.revertedWith(
      "xETHL: Locked tokens",
    );
    await expect(
      this.xethl.withdraw(await balanceOf(this.xethl, owner.address), owner.address, owner.address),
    ).to.be.revertedWith("xETHL: Locked tokens");
  });

  it("should revert while withdrawing & transfer before minimum lock when periphery contract deposits on behalf of an address", async function () {
    //transfer is allowed for periphery but periphery will transfer the newly minted xETHL to an address and that address should not be allowed be transferred until minimum lock has passed
    await this.ethl.transfer(periphery.address, utils.parseEther("10000"));
    await this.xethl.connect(periphery).deposit(utils.parseEther("1000"), periphery.address);

    let bal = await this.xethl.balanceOf(periphery.address);
    await this.xethl.connect(periphery).transfer(user1.address, bal);
    await mineBlocks(97);

    await expect(
      this.xethl.connect(user1).transfer(user1.address, await balanceOf(this.xethl, owner.address)),
    ).to.be.revertedWith("xETHL: Locked tokens");
    await expect(
      this.xethl.connect(user1).withdraw(await balanceOf(this.xethl, owner.address), user1.address, user1.address),
    ).to.be.revertedWith("xETHL: Locked tokens");
  });

  it("should withdraw & transfer after minimum lock", async function () {
    await this.xethl.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);

    await expect(this.xethl.transfer(user1.address, utils.parseEther("100"))).not.to.be.reverted;
    await expect(this.xethl.withdraw(await balanceOf(this.xethl, owner.address), owner.address, owner.address)).not.to
      .be.reverted;
  });

  it("should withdraw same amount as deposited", async function () {
    await this.xethl.deposit(utils.parseEther("1000"), owner.address);

    await mineBlocks(100);
    let share = await previewShare(this.xethl, utils.parseEther("1000"));

    let preBalance = await balanceOf(this.ethl, owner.address);
    let tx = await this.xethl.withdraw(await balanceOf(this.xethl, owner.address), owner.address, owner.address);

    let postBalance = await balanceOf(this.ethl, owner.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("1000"));

    expect(tx).to.emit(this.xethl, "Withdraw").withArgs(owner.address, owner.address, utils.parseEther("1000"), share);
  });

  it("should withdraw more ETHL as price per share increases", async function () {
    await this.xethl.deposit(utils.parseEther("1000"), owner.address);

    await mineBlocks(100);
    await this.ethl.transfer(this.xethl.address, utils.parseEther("1000"));

    let share = await previewShare(this.xethl, utils.parseEther("2000"));

    let preBalance = await balanceOf(this.ethl, owner.address);
    let tx = await this.xethl.withdraw(utils.parseEther("2000"), owner.address, owner.address);

    let postBalance = await balanceOf(this.ethl, owner.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("2000"));
    expect(tx).to.emit(this.xethl, "Withdraw").withArgs(owner.address, owner.address, utils.parseEther("2000"), share);
  });

  it("should withdraw less ETHL as price per share decreases", async function () {
    await this.xethl.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);
    await this.ethl.removeTokens(utils.parseEther("500"), this.xethl.address);

    let share = await previewShare(this.xethl, utils.parseEther("500"));

    let preBalance = await balanceOf(this.ethl, owner.address);
    let tx = await this.xethl.withdraw(utils.parseEther("500"), owner.address, owner.address);

    let postBalance = await balanceOf(this.ethl, owner.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("500"));
    expect(tx).to.emit(this.xethl, "Withdraw").withArgs(owner.address, owner.address, utils.parseEther("500"), share);
  });

  it("should deposit and transfer from periphery without minimum blocks lock", async function () {
    await this.ethl.transfer(periphery.address, utils.parseEther("10000"));
    await this.xethl.connect(periphery).deposit(utils.parseEther("1000"), periphery.address);
    let bal = await this.xethl.balanceOf(periphery.address);
    await expect(this.xethl.connect(periphery).transfer(owner.address, bal)).not.to.be.reverted;
  });

  it("should withdraw to another user", async function () {
    await this.xethl.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);
    let preBalance = await balanceOf(this.ethl, user1.address);
    await this.xethl.withdraw(await balanceOf(this.xethl, owner.address), user1.address, owner.address);
    let postBalance = await balanceOf(this.ethl, user1.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("1000"));
  });

  ///////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////
  ////////// mint and redeem functions tests ////////////
  ///////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////

  it("should mint initial correctly", async function () {
    let tx = await this.xethl.mint(utils.parseEther("1000"), owner.address);
    let amount = await previewAmount(this.xethl, utils.parseEther("1000"));
    expect(await balanceOf(this.xethl, owner.address)).to.equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xethl, "Deposit").withArgs(owner.address, owner.address, amount, utils.parseEther("1000"));
  });

  it("assetsPerShare should stay the same after multiple mint in a row", async function () {
    //pricePeShare only changes when ETHL are added or removed from xETHL without deposit or withdraw transactions
    let tx = await this.xethl.mint(utils.parseEther("1000"), owner.address);
    let amount = await previewAmount(this.xethl, utils.parseEther("1000"));
    expect(await balanceOf(this.xethl, owner.address)).to.equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xethl, "Deposit").withArgs(owner.address, owner.address, amount, utils.parseEther("1000"));
    // expect(tx).to.emit(this.xethl, "Deposit").withArgs(owner.address, utils.parseEther("1000"));

    await this.ethl.removeTokens(utils.parseEther("235"), this.xethl.address);
    let pricePerShareBefore = await this.xethl.assetsPerShare();
    await this.xethl.mint(utils.parseEther("123"), owner.address);
    await this.xethl.mint(utils.parseEther("489"), owner.address);
    await this.xethl.mint(utils.parseEther("345"), owner.address);

    let pricePerShareAfter = await this.xethl.assetsPerShare();
    expect(pricePerShareBefore).to.equal(pricePerShareAfter);
  });

  it("should price per share greater than 1 when more ETHL", async function () {
    await this.xethl.mint(utils.parseEther("1000"), owner.address);
    await this.ethl.transfer(this.xethl.address, utils.parseEther("1000"));
    expect(await this.xethl.assetsPerShare()).gt(utils.parseEther("1"));
  });

  it("should price per share less than 1 when more ETHL", async function () {
    await this.xethl.mint(utils.parseEther("1000"), owner.address);
    await this.ethl.removeTokens(utils.parseEther("100"), this.xethl.address);
    expect(await this.xethl.assetsPerShare()).lt(utils.parseEther("1"));
  });

  it("should mint less XETHL when price per share greater than 1", async function () {
    await this.xethl.mint(utils.parseEther("1000"), owner.address);
    await this.ethl.transfer(this.xethl.address, utils.parseEther("1000"));
    await this.ethl.transfer(user1.address, utils.parseEther("1000"));
    await this.xethl.connect(user1).mint(utils.parseEther("500"), user1.address);
    expect(await balanceOf(this.xethl, user1.address)).equal(utils.parseEther("500"));
  });

  it("should revert while redeem & transfer before minimum lock", async function () {
    await this.xethl.mint(utils.parseEther("1000"), owner.address);
    await mineBlocks(97);

    await expect(this.xethl.transfer(user1.address, await balanceOf(this.xethl, owner.address))).to.be.revertedWith(
      "xETHL: Locked tokens",
    );
    await expect(
      this.xethl.redeem(await balanceOf(this.xethl, owner.address), owner.address, owner.address),
    ).to.be.revertedWith("xETHL: Locked tokens");
  });

  it("should revert while redeeming & transfer before minimum lock when periphery contract mints on behalf of an address", async function () {
    //transfer is allowed for periphery but periphery will transfer the newly minted xETHL to an address and that address should not be allowed be transferred until minimum lock has passed
    await this.ethl.transfer(periphery.address, utils.parseEther("10000"));
    await this.xethl.connect(periphery).mint(utils.parseEther("1000"), periphery.address);

    let bal = await this.xethl.balanceOf(periphery.address);
    await this.xethl.connect(periphery).transfer(user1.address, bal);
    await mineBlocks(97);

    await expect(
      this.xethl.connect(user1).transfer(user1.address, await balanceOf(this.xethl, owner.address)),
    ).to.be.revertedWith("xETHL: Locked tokens");
    await expect(
      this.xethl.connect(user1).redeem(await balanceOf(this.xethl, owner.address), user1.address, user1.address),
    ).to.be.revertedWith("xETHL: Locked tokens");
  });

  it("should redeem & transfer after minimum lock", async function () {
    await this.xethl.mint(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);

    await expect(this.xethl.transfer(user1.address, utils.parseEther("100"))).not.to.be.reverted;
    await expect(this.xethl.redeem(await balanceOf(this.xethl, owner.address), owner.address, owner.address)).not.to.be
      .reverted;
  });

  it("should redeem more ETHL as price per share increases", async function () {
    await this.xethl.mint(utils.parseEther("1000"), owner.address);

    await mineBlocks(100);
    await this.ethl.transfer(this.xethl.address, utils.parseEther("1000"));

    let amount = await previewAmount(this.xethl, utils.parseEther("1000"));
    let preBalance = await balanceOf(this.ethl, owner.address);
    let tx = await this.xethl.redeem(utils.parseEther("1000"), owner.address, owner.address);

    let postBalance = await balanceOf(this.ethl, owner.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("2000"));
    expect(tx).to.emit(this.xethl, "Withdraw").withArgs(owner.address, owner.address, amount, utils.parseEther("1000"));
  });

  it("should redeem less ETHL as price per share decreases", async function () {
    await this.xethl.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);
    await this.ethl.removeTokens(utils.parseEther("500"), this.xethl.address);

    let amount = await previewAmount(this.xethl, utils.parseEther("1000"));

    let preBalance = await balanceOf(this.ethl, owner.address);
    let tx = await this.xethl.redeem(utils.parseEther("1000"), owner.address, owner.address);

    let postBalance = await balanceOf(this.ethl, owner.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("500"));
    expect(tx).to.emit(this.xethl, "Withdraw").withArgs(owner.address, owner.address, amount, utils.parseEther("1000"));
  });

  it("should mint and transfer from periphery without minimum blocks lock", async function () {
    await this.ethl.transfer(periphery.address, utils.parseEther("10000"));
    await this.xethl.connect(periphery).mint(utils.parseEther("1000"), periphery.address);
    let bal = await this.xethl.balanceOf(periphery.address);
    await expect(this.xethl.connect(periphery).transfer(owner.address, bal)).not.to.be.reverted;
  });

  it("should redeem to another user", async function () {
    await this.xethl.mint(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);
    let preBalance = await balanceOf(this.ethl, user1.address);
    await this.xethl.redeem(await balanceOf(this.xethl, owner.address), user1.address, owner.address);
    let postBalance = await balanceOf(this.ethl, user1.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("1000"));
  });
});
