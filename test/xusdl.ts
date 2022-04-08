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

describe("eip4626xUSDL", function () {
  let owner;
  let user1;
  let user2;
  let periphery;

  beforeEach(async function () {
    // Get the ContractFactory and Signers here.
    let Token = await ethers.getContractFactory("Token");
    [owner, user1, user2, periphery] = await ethers.getSigners();

    this.usdl = await upgrades.deployProxy(Token, [utils.parseEther("1000000")], { initializer: "initialize" });

    let XUSDL = await ethers.getContractFactory("xUSDL");
    this.xusdl = await upgrades.deployProxy(XUSDL, [AddressZero, this.usdl.address, periphery.address], {
      initializer: "initialize",
    });
    await this.xusdl.updateLock(100);

    await approveMAX(this.usdl, owner, this.xusdl.address, utils.parseEther("1000"));
    await approveMAX(this.usdl, user1, this.xusdl.address, utils.parseEther("1000"));
    await approveMAX(this.usdl, user2, this.xusdl.address, utils.parseEther("1000"));
    await approveMAX(this.usdl, periphery, this.xusdl.address, utils.parseEther("1000"));
  });

  async function previewShare(xusdl, assets) {
    const totalSupply = await xusdl.totalSupply();
    let shares;
    if (totalSupply == 0) {
      shares = totalSupply;
    } else {
      const assetsPerShare = await xusdl.assetsPerShare();
      shares = assets.mul(parseEther("1")).div(assetsPerShare);
    }
    return shares;
  }

  async function previewAmount(xusdl, shares) {
    const assetsPerShare = await xusdl.assetsPerShare();
    let assets = assetsPerShare.mul(shares).div(parseEther("1"));
    return assets;
  }

  it("should initialize correctly", async function () {
    expect(await this.xusdl.usdl()).to.equal(this.usdl.address);
    expect(await balanceOf(this.usdl, owner.address)).to.equal(utils.parseEther("1000000"));
  });

  it("should deposit initial correctly", async function () {
    let tx = await this.xusdl.deposit(utils.parseEther("1000"), owner.address);
    let share = await previewShare(this.xusdl, utils.parseEther("1000"));
    expect(await balanceOf(this.xusdl, owner.address)).to.equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xusdl, "Deposit").withArgs(owner.address, owner.address, utils.parseEther("1000"), share);
  });

  it("assetsPerShare should stay the same after multiple deposits in a row", async function () {
    //pricePeShare only changes when USDL are added or removed from xUSDL without deposit or withdraw transactions
    let tx = await this.xusdl.deposit(utils.parseEther("1000"), owner.address);
    let share = await previewShare(this.xusdl, utils.parseEther("1000"));
    expect(await balanceOf(this.xusdl, owner.address)).to.equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xusdl, "Deposit").withArgs(owner.address, owner.address, utils.parseEther("1000"), share);
    // expect(tx).to.emit(this.xusdl, "Deposit").withArgs(owner.address, utils.parseEther("1000"));

    await this.usdl.removeTokens(utils.parseEther("235"), this.xusdl.address);
    let pricePerShareBefore = await this.xusdl.assetsPerShare();
    await this.xusdl.deposit(utils.parseEther("123"), owner.address);
    await this.xusdl.deposit(utils.parseEther("489"), owner.address);
    await this.xusdl.deposit(utils.parseEther("345"), owner.address);

    let pricePerShareAfter = await this.xusdl.assetsPerShare();
    expect(pricePerShareBefore).to.equal(pricePerShareAfter);
  });

  it("should price per share greater than 1 when more USDL", async function () {
    await this.xusdl.deposit(utils.parseEther("1000"), owner.address);
    await this.usdl.transfer(this.xusdl.address, utils.parseEther("1000"));
    expect(await this.xusdl.assetsPerShare()).gt(utils.parseEther("1"));
  });

  it("should price per share less than 1 when more USDL", async function () {
    await this.xusdl.deposit(utils.parseEther("1000"), owner.address);
    await this.usdl.removeTokens(utils.parseEther("100"), this.xusdl.address);
    expect(await this.xusdl.assetsPerShare()).lt(utils.parseEther("1"));
  });

  it("should mint less XUSDL when price per share greater than 1", async function () {
    await this.xusdl.deposit(utils.parseEther("1000"), owner.address);
    await this.usdl.transfer(this.xusdl.address, utils.parseEther("1000"));
    await this.usdl.transfer(user1.address, utils.parseEther("1000"));
    await this.xusdl.connect(user1).deposit(utils.parseEther("1000"), user1.address);
    expect(await balanceOf(this.xusdl, user1.address)).equal(utils.parseEther("500"));
  });

  it("should mint more XUSDL when price per share less than 1", async function () {
    await this.xusdl.deposit(utils.parseEther("1000"), owner.address);
    await this.usdl.removeTokens(utils.parseEther("500"), this.xusdl.address);
    await this.usdl.transfer(user1.address, utils.parseEther("1000"));
    await this.xusdl.connect(user1).deposit(utils.parseEther("1000"), user1.address);
    expect(await balanceOf(this.xusdl, user1.address)).equal(utils.parseEther("2000"));
  });

  it("should revert while withdrawing & transfer before minimum lock", async function () {
    await this.xusdl.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(97);

    await expect(this.xusdl.transfer(user1.address, await balanceOf(this.xusdl, owner.address))).to.be.revertedWith(
      "xUSDL: Locked tokens",
    );
    await expect(
      this.xusdl.withdraw(await balanceOf(this.xusdl, owner.address), owner.address, owner.address),
    ).to.be.revertedWith("xUSDL: Locked tokens");
  });

  it("should revert while withdrawing & transfer before minimum lock when periphery contract deposits on behalf of an address", async function () {
    //transfer is allowed for periphery but periphery will transfer the newly minted xUSDL to an address and that address should not be allowed be transferred until minimum lock has passed
    await this.usdl.transfer(periphery.address, utils.parseEther("10000"));
    await this.xusdl.connect(periphery).deposit(utils.parseEther("1000"), periphery.address);

    let bal = await this.xusdl.balanceOf(periphery.address);
    await this.xusdl.connect(periphery).transfer(user1.address, bal);
    await mineBlocks(97);

    await expect(
      this.xusdl.connect(user1).transfer(user1.address, await balanceOf(this.xusdl, owner.address)),
    ).to.be.revertedWith("xUSDL: Locked tokens");
    await expect(
      this.xusdl.connect(user1).withdraw(await balanceOf(this.xusdl, owner.address), user1.address, user1.address),
    ).to.be.revertedWith("xUSDL: Locked tokens");
  });

  it("should withdraw & transfer after minimum lock", async function () {
    await this.xusdl.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);

    await expect(this.xusdl.transfer(user1.address, utils.parseEther("100"))).not.to.be.reverted;
    await expect(this.xusdl.withdraw(await balanceOf(this.xusdl, owner.address), owner.address, owner.address)).not.to
      .be.reverted;
  });

  it("should withdraw same amount as deposited", async function () {
    await this.xusdl.deposit(utils.parseEther("1000"), owner.address);

    await mineBlocks(100);
    let share = await previewShare(this.xusdl, utils.parseEther("1000"));

    let preBalance = await balanceOf(this.usdl, owner.address);
    let tx = await this.xusdl.withdraw(await balanceOf(this.xusdl, owner.address), owner.address, owner.address);

    let postBalance = await balanceOf(this.usdl, owner.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("1000"));

    expect(tx).to.emit(this.xusdl, "Withdraw").withArgs(owner.address, owner.address, utils.parseEther("1000"), share);
  });

  it("should withdraw more USDL as price per share increases", async function () {
    await this.xusdl.deposit(utils.parseEther("1000"), owner.address);

    await mineBlocks(100);
    await this.usdl.transfer(this.xusdl.address, utils.parseEther("1000"));

    let share = await previewShare(this.xusdl, utils.parseEther("2000"));

    let preBalance = await balanceOf(this.usdl, owner.address);
    let tx = await this.xusdl.withdraw(utils.parseEther("2000"), owner.address, owner.address);

    let postBalance = await balanceOf(this.usdl, owner.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("2000"));
    expect(tx).to.emit(this.xusdl, "Withdraw").withArgs(owner.address, owner.address, utils.parseEther("2000"), share);
  });

  it("should withdraw less USDL as price per share decreases", async function () {
    await this.xusdl.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);
    await this.usdl.removeTokens(utils.parseEther("500"), this.xusdl.address);

    let share = await previewShare(this.xusdl, utils.parseEther("500"));

    let preBalance = await balanceOf(this.usdl, owner.address);
    let tx = await this.xusdl.withdraw(utils.parseEther("500"), owner.address, owner.address);

    let postBalance = await balanceOf(this.usdl, owner.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("500"));
    expect(tx).to.emit(this.xusdl, "Withdraw").withArgs(owner.address, owner.address, utils.parseEther("500"), share);
  });

  it("should deposit and transfer from periphery without minimum blocks lock", async function () {
    await this.usdl.transfer(periphery.address, utils.parseEther("10000"));
    await this.xusdl.connect(periphery).deposit(utils.parseEther("1000"), periphery.address);
    let bal = await this.xusdl.balanceOf(periphery.address);
    await expect(this.xusdl.connect(periphery).transfer(owner.address, bal)).not.to.be.reverted;
  });

  it("should withdraw to another user", async function () {
    await this.xusdl.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);
    let preBalance = await balanceOf(this.usdl, user1.address);
    await this.xusdl.withdraw(await balanceOf(this.xusdl, owner.address), user1.address, owner.address);
    let postBalance = await balanceOf(this.usdl, user1.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("1000"));
  });

  ///////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////
  ////////// mint and redeem functions tests ////////////
  ///////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////

  it("should mint initial correctly", async function () {
    let tx = await this.xusdl.mint(utils.parseEther("1000"), owner.address);
    let amount = await previewAmount(this.xusdl, utils.parseEther("1000"));
    expect(await balanceOf(this.xusdl, owner.address)).to.equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xusdl, "Deposit").withArgs(owner.address, owner.address, amount, utils.parseEther("1000"));
  });

  it("assetsPerShare should stay the same after multiple mint in a row", async function () {
    //pricePeShare only changes when USDL are added or removed from xUSDL without deposit or withdraw transactions
    let tx = await this.xusdl.mint(utils.parseEther("1000"), owner.address);
    let amount = await previewAmount(this.xusdl, utils.parseEther("1000"));
    expect(await balanceOf(this.xusdl, owner.address)).to.equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xusdl, "Deposit").withArgs(owner.address, owner.address, amount, utils.parseEther("1000"));
    // expect(tx).to.emit(this.xusdl, "Deposit").withArgs(owner.address, utils.parseEther("1000"));

    await this.usdl.removeTokens(utils.parseEther("235"), this.xusdl.address);
    let pricePerShareBefore = await this.xusdl.assetsPerShare();
    await this.xusdl.mint(utils.parseEther("123"), owner.address);
    await this.xusdl.mint(utils.parseEther("489"), owner.address);
    await this.xusdl.mint(utils.parseEther("345"), owner.address);

    let pricePerShareAfter = await this.xusdl.assetsPerShare();
    expect(pricePerShareBefore).to.equal(pricePerShareAfter);
  });

  it("should price per share greater than 1 when more USDL", async function () {
    await this.xusdl.mint(utils.parseEther("1000"), owner.address);
    await this.usdl.transfer(this.xusdl.address, utils.parseEther("1000"));
    expect(await this.xusdl.assetsPerShare()).gt(utils.parseEther("1"));
  });

  it("should price per share less than 1 when more USDL", async function () {
    await this.xusdl.mint(utils.parseEther("1000"), owner.address);
    await this.usdl.removeTokens(utils.parseEther("100"), this.xusdl.address);
    expect(await this.xusdl.assetsPerShare()).lt(utils.parseEther("1"));
  });

  it("should mint less XUSDL when price per share greater than 1", async function () {
    await this.xusdl.mint(utils.parseEther("1000"), owner.address);
    await this.usdl.transfer(this.xusdl.address, utils.parseEther("1000"));
    await this.usdl.transfer(user1.address, utils.parseEther("1000"));
    await this.xusdl.connect(user1).mint(utils.parseEther("500"), user1.address);
    expect(await balanceOf(this.xusdl, user1.address)).equal(utils.parseEther("500"));
  });

  it("should revert while redeem & transfer before minimum lock", async function () {
    await this.xusdl.mint(utils.parseEther("1000"), owner.address);
    await mineBlocks(97);

    await expect(this.xusdl.transfer(user1.address, await balanceOf(this.xusdl, owner.address))).to.be.revertedWith(
      "xUSDL: Locked tokens",
    );
    await expect(
      this.xusdl.redeem(await balanceOf(this.xusdl, owner.address), owner.address, owner.address),
    ).to.be.revertedWith("xUSDL: Locked tokens");
  });

  it("should revert while redeeming & transfer before minimum lock when periphery contract mints on behalf of an address", async function () {
    //transfer is allowed for periphery but periphery will transfer the newly minted xUSDL to an address and that address should not be allowed be transferred until minimum lock has passed
    await this.usdl.transfer(periphery.address, utils.parseEther("10000"));
    await this.xusdl.connect(periphery).mint(utils.parseEther("1000"), periphery.address);

    let bal = await this.xusdl.balanceOf(periphery.address);
    await this.xusdl.connect(periphery).transfer(user1.address, bal);
    await mineBlocks(97);

    await expect(
      this.xusdl.connect(user1).transfer(user1.address, await balanceOf(this.xusdl, owner.address)),
    ).to.be.revertedWith("xUSDL: Locked tokens");
    await expect(
      this.xusdl.connect(user1).redeem(await balanceOf(this.xusdl, owner.address), user1.address, user1.address),
    ).to.be.revertedWith("xUSDL: Locked tokens");
  });

  it("should redeem & transfer after minimum lock", async function () {
    await this.xusdl.mint(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);

    await expect(this.xusdl.transfer(user1.address, utils.parseEther("100"))).not.to.be.reverted;
    await expect(this.xusdl.redeem(await balanceOf(this.xusdl, owner.address), owner.address, owner.address)).not.to.be
      .reverted;
  });

  it("should redeem more USDL as price per share increases", async function () {
    await this.xusdl.mint(utils.parseEther("1000"), owner.address);

    await mineBlocks(100);
    await this.usdl.transfer(this.xusdl.address, utils.parseEther("1000"));

    let amount = await previewAmount(this.xusdl, utils.parseEther("1000"));
    let preBalance = await balanceOf(this.usdl, owner.address);
    let tx = await this.xusdl.redeem(utils.parseEther("1000"), owner.address, owner.address);

    let postBalance = await balanceOf(this.usdl, owner.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("2000"));
    expect(tx).to.emit(this.xusdl, "Withdraw").withArgs(owner.address, owner.address, amount, utils.parseEther("1000"));
  });

  it("should redeem less USDL as price per share decreases", async function () {
    await this.xusdl.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);
    await this.usdl.removeTokens(utils.parseEther("500"), this.xusdl.address);

    let amount = await previewAmount(this.xusdl, utils.parseEther("1000"));

    let preBalance = await balanceOf(this.usdl, owner.address);
    let tx = await this.xusdl.redeem(utils.parseEther("1000"), owner.address, owner.address);

    let postBalance = await balanceOf(this.usdl, owner.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("500"));
    expect(tx).to.emit(this.xusdl, "Withdraw").withArgs(owner.address, owner.address, amount, utils.parseEther("1000"));
  });

  it("should mint and transfer from periphery without minimum blocks lock", async function () {
    await this.usdl.transfer(periphery.address, utils.parseEther("10000"));
    await this.xusdl.connect(periphery).mint(utils.parseEther("1000"), periphery.address);
    let bal = await this.xusdl.balanceOf(periphery.address);
    await expect(this.xusdl.connect(periphery).transfer(owner.address, bal)).not.to.be.reverted;
  });

  it("should redeem to another user", async function () {
    await this.xusdl.mint(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);
    let preBalance = await balanceOf(this.usdl, user1.address);
    await this.xusdl.redeem(await balanceOf(this.xusdl, owner.address), user1.address, owner.address);
    let postBalance = await balanceOf(this.usdl, user1.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("1000"));
  });
});
