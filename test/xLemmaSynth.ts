import { ethers, upgrades } from "hardhat";
import { expect, util } from "chai";
import { utils } from "ethers";
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

describe("xLemmaSynth", function () {
  let owner: any;
  let user1: any;
  let user2: any;
  let periphery: any;

  beforeEach(async function () {
    // Get the ContractFactory and Signers here.
    let Token = await ethers.getContractFactory("Token");
    [owner, user1, user2, periphery] = await ethers.getSigners();

    this.lSynth = await upgrades.deployProxy(Token, [utils.parseEther("1000000")], { initializer: "initialize" });

    let XLemmaSynth = await ethers.getContractFactory("xLemmaSynth");
    this.xsynth = await upgrades.deployProxy(
      XLemmaSynth,
      [AddressZero, this.lSynth.address, periphery.address, "xLemmaWETH", "IWETH"],
      {
        initializer: "initialize",
      },
    );
    await this.xsynth.setMinimumLock(100);

    await approveMAX(this.lSynth, owner, this.xsynth.address, utils.parseEther("1000"));
    await approveMAX(this.lSynth, user1, this.xsynth.address, utils.parseEther("1000"));
    await approveMAX(this.lSynth, user2, this.xsynth.address, utils.parseEther("1000"));
    await approveMAX(this.lSynth, periphery, this.xsynth.address, utils.parseEther("1000"));
  });

  it("should initialize correctly", async function () {
    expect(await this.xsynth.lSynth()).to.equal(this.lSynth.address);
    expect(await balanceOf(this.lSynth, owner.address)).to.equal(utils.parseEther("1000000"));
  });

  it("should deposit initial correctly", async function () {
    let tx = await this.xsynth.deposit(utils.parseEther("1000"), owner.address);
    expect(await balanceOf(this.xsynth, owner.address)).to.equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xsynth, "Deposit").withArgs(owner.address, utils.parseEther("1000"));
  });

  it("pricePerShare should stay the same after multiple deposits in a row", async function () {
    //pricePeShare only changes when USDL are added or removed from xLemmaSynth without deposit or withdraw transactions
    let tx = await this.xsynth.deposit(utils.parseEther("1000"), owner.address);
    expect(await balanceOf(this.xsynth, owner.address)).to.equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xsynth, "Deposit").withArgs(owner.address, utils.parseEther("1000"));

    await this.lSynth.removeTokens(utils.parseEther("235"), this.xsynth.address);
    let assetsPerShareBefore = await this.xsynth.assetsPerShare();
    await this.xsynth.deposit(utils.parseEther("123"), owner.address);
    await this.xsynth.deposit(utils.parseEther("489"), owner.address);
    await this.xsynth.deposit(utils.parseEther("345"), owner.address);

    let assetsPerShareAfter = await this.xsynth.assetsPerShare();
    expect(assetsPerShareBefore).to.equal(assetsPerShareAfter);
  });

  it("should price per share greater than 1 when more USDL", async function () {
    await this.xsynth.deposit(utils.parseEther("1000"), owner.address);
    await this.lSynth.transfer(this.xsynth.address, utils.parseEther("1000"));
    expect(await this.xsynth.assetsPerShare()).gt(utils.parseEther("1"));
  });

  it("should price per share less than 1 when more USDL", async function () {
    await this.xsynth.deposit(utils.parseEther("1000"), owner.address);
    await this.lSynth.removeTokens(utils.parseEther("100"), this.xsynth.address);
    expect(await this.xsynth.assetsPerShare()).lt(utils.parseEther("1"));
  });

  it("should mint less XLemmaSynth when price per share greater than 1", async function () {
    await this.xsynth.deposit(utils.parseEther("1000"), owner.address);
    await this.lSynth.transfer(this.xsynth.address, utils.parseEther("1000"));
    await this.lSynth.transfer(user1.address, utils.parseEther("1000"));
    await this.xsynth.connect(user1).deposit(utils.parseEther("1000"), user1.address);
    expect(await balanceOf(this.xsynth, user1.address)).equal(utils.parseEther("500"));
  });

  it("should mint more XLemmaSynth when price per share less than 1", async function () {
    await this.xsynth.deposit(utils.parseEther("1000"), owner.address);
    await this.lSynth.removeTokens(utils.parseEther("500"), this.xsynth.address);
    await this.lSynth.transfer(user1.address, utils.parseEther("1000"));
    await this.xsynth.connect(user1).deposit(utils.parseEther("1000"), user1.address);
    expect(await balanceOf(this.xsynth, user1.address)).equal(utils.parseEther("2000"));
  });

  it("should revert while withdrawing & transfer before minimum lock", async function () {
    await this.xsynth.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(97);

    await expect(this.xsynth.transfer(user1.address, await balanceOf(this.xsynth, owner.address))).to.be.revertedWith(
      "xLemmaSynth: Locked tokens",
    );
    await expect(
      this.xsynth.withdraw(await balanceOf(this.xsynth, owner.address), owner.address, owner.address),
    ).to.be.revertedWith("xLemmaSynth: Locked tokens");
  });

  it("should revert while withdrawing & transfer before minimum lock when periphery contract deposits on behalf of an address", async function () {
    //transfer is allowed for periphery but periphery will transfer the newly minted xLemmaSynth to an address and that address should not be allowed be transferred until minimum lock has passed
    await this.lSynth.transfer(periphery.address, utils.parseEther("10000"));
    await this.xsynth.connect(periphery).deposit(utils.parseEther("1000"), periphery.address);

    let bal = await this.xsynth.balanceOf(periphery.address);
    await this.xsynth.connect(periphery).transfer(user1.address, bal);
    await mineBlocks(97);

    await expect(
      this.xsynth.connect(user1).transfer(user1.address, await balanceOf(this.xsynth, owner.address)),
    ).to.be.revertedWith("xLemmaSynth: Locked tokens");
    await expect(
      this.xsynth.connect(user1).withdraw(await balanceOf(this.xsynth, owner.address), user1.address, user1.address),
    ).to.be.revertedWith("xLemmaSynth: Locked tokens");
  });

  it("should withdraw & transfer after minimum lock", async function () {
    await this.xsynth.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);

    await expect(this.xsynth.transfer(user1.address, utils.parseEther("100"))).not.to.be.reverted;
    await expect(this.xsynth.withdraw(await balanceOf(this.xsynth, owner.address), owner.address, owner.address)).not.to
      .be.reverted;
  });

  it("should withdraw same amount as deposited", async function () {
    await this.xsynth.deposit(utils.parseEther("1000"), owner.address);

    await mineBlocks(100);
    let preBalance = await balanceOf(this.lSynth, owner.address);
    let tx = await this.xsynth.withdraw(await balanceOf(this.xsynth, owner.address), owner.address, owner.address);

    let postBalance = await balanceOf(this.lSynth, owner.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xsynth, "Withdraw").withArgs(owner.address, utils.parseEther("1000"));
  });

  it("should withdraw more USDL as price per share increases", async function () {
    let postBalance = await balanceOf(this.lSynth, owner.address);
    await this.xsynth.deposit(utils.parseEther("1000"), owner.address);

    await mineBlocks(100);
    await this.lSynth.transfer(this.xsynth.address, utils.parseEther("1000"));
    let preBalance = await balanceOf(this.lSynth, owner.address);

    let assetsPerShareAfter = await this.xsynth.assetsPerShare();

    expect(postBalance.sub(preBalance)).equal(utils.parseEther("2000"));
    expect(assetsPerShareAfter).equal(utils.parseEther("2"));
  });

  it("should withdraw less USDL as price per share decreases", async function () {
    await this.xsynth.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);

    let assetsPerShareBefore = await this.xsynth.assetsPerShare();
    await this.lSynth.removeTokens(utils.parseEther("500"), this.xsynth.address);
    let assetsPerShareAfter = await this.xsynth.assetsPerShare();

    let tx = await this.xsynth.withdraw(utils.parseEther("500"), owner.address, owner.address);

    expect(assetsPerShareAfter).lt(assetsPerShareBefore);
    expect(tx).to.emit(this.xsynth, "Withdraw").withArgs(owner.address, utils.parseEther("500"));
  });

  it("should deposit and transfer from periphery without minimum blocks lock", async function () {
    await this.lSynth.transfer(periphery.address, utils.parseEther("10000"));
    await this.xsynth.connect(periphery).deposit(utils.parseEther("1000"), periphery.address);
    let bal = await this.xsynth.balanceOf(periphery.address);
    await expect(this.xsynth.connect(periphery).transfer(owner.address, bal)).not.to.be.reverted;
  });

  it("should withdraw to another user", async function () {
    await this.xsynth.deposit(utils.parseEther("1000"), owner.address);
    await mineBlocks(100);
    let preBalance = await balanceOf(this.lSynth, user1.address);
    await this.xsynth.withdraw(utils.parseEther("500"), user1.address, owner.address);
    let postBalance = await balanceOf(this.lSynth, user1.address);
    expect(postBalance.sub(preBalance)).equal(utils.parseEther("500"));
  });

  /// it restricts user to not to get lock again and again by attacker
  it("depositMethod: If owner has already deposited, then another user(user1.address) can't deposit for owner", async function () {
    let tx = await this.xsynth.deposit(utils.parseEther("1000"), owner.address);
    expect(await balanceOf(this.xsynth, owner.address)).to.equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xsynth, "Deposit").withArgs(owner.address, utils.parseEther("1000"));

    await this.lSynth.transfer(user1.address, utils.parseEther("20000"));

    await expect(this.xsynth.connect(user1).deposit(utils.parseEther("1000"), owner.address)).to.be.revertedWith(
      "Invalid Address: Receiver should be msg.sender",
    );
  });

  /// it restricts user to not to get lock again and again by attacker
  it("mintMethod: If owner has already deposited, then another user(user1.address) can't deposit for owner", async function () {
    let tx = await this.xsynth.mint(utils.parseEther("1000"), owner.address);
    expect(await balanceOf(this.xsynth, owner.address)).to.equal(utils.parseEther("1000"));
    expect(tx).to.emit(this.xsynth, "Deposit").withArgs(owner.address, utils.parseEther("1000"));

    await this.lSynth.transfer(user1.address, utils.parseEther("20000"));

    await expect(this.xsynth.connect(user1).mint(utils.parseEther("1000"), owner.address)).to.be.revertedWith(
      "Invalid Address: Receiver should be msg.sender",
    );
  });
});
