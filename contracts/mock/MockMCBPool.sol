pragma solidity =0.8.3;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract MCBStaking is Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    string public constant name = "MCBStaking";

    struct StakedBalance {
        uint256 balance;
        uint256 unlockTime;
    }

    IERC20Upgradeable public stakeToken;
    uint256 public lockPeriod;
    mapping(address => StakedBalance) public stakedBalances;

    event SetUnlockPeriod(uint256 previousLockPeriod, uint256 newLockPeriod);
    event Stake(
        address indexed account,
        uint256 newStaked,
        uint256 totalStaked,
        uint256 unlockTime
    );
    event Redeem(address indexed account, uint256 redeemed);

    function initialize(address stakeToken_, uint256 lockPeriod_) external initializer {
        __ReentrancyGuard_init();
        __Ownable_init();

        stakeToken = IERC20Upgradeable(stakeToken_);
        _setUnlockPeriod(lockPeriod_);
    }

    /// @notice Get staked balance of account.
    function balanceOf(address account) public view returns (uint256) {
        return stakedBalances[account].balance;
    }

    /// @notice Get timestamp of unlock time.
    function unlockTime(address account) public view returns (uint256) {
        return stakedBalances[account].unlockTime;
    }

    /// @notice Get expected unlock time if try to stake 'amount' tokens.
    function calcUnlockTime(address account, uint256 amount) public view returns (uint256) {
        return _calcUnlockTime(stakedBalances[account], amount);
    }

    /// @notice Get remaining seconds before unlock.
    function secondsUntilUnlock(address account) public view returns (uint256) {
        uint256 eta = stakedBalances[account].unlockTime;
        uint256 current = _blockTime();
        return eta > current ? eta - current : 0;
    }

    /// @notice Stake token into contract and refresh unlock time according to `_calcUnlockTime`.
    function stake(uint256 amount) external nonReentrant {
        require(amount != 0, "MCBStaking::stake::ZeroStakeAmount");
        StakedBalance storage staked = stakedBalances[msg.sender];

        uint256 newUnlockTime = _calcUnlockTime(staked, amount);
        stakeToken.transferFrom(msg.sender, address(this), amount);
        staked.balance += amount;
        staked.unlockTime = newUnlockTime;

        emit Stake(msg.sender, amount, staked.balance, staked.unlockTime);
    }

    /// @notice Refresh unlock time to current time + lockPeriod
    function restake() external {
        StakedBalance storage staked = stakedBalances[msg.sender];
        require(staked.balance != 0, "MCBStaking::restake::NotStakedYet");
        staked.unlockTime = _blockTime() + lockPeriod;
        emit Stake(msg.sender, 0, staked.balance, staked.unlockTime);
    }

    /// @notice Redeem token from contract if time has already surpassed the `unlockTime`.
    function redeem() external nonReentrant {
        StakedBalance storage staked = stakedBalances[msg.sender];
        require(staked.balance != 0, "MCBStaking::redeem::NotStaked");
        require(_blockTime() >= staked.unlockTime, "MCBStaking::redeem::LockTimeNotSurpassed");

        uint256 balance = staked.balance;
        staked.balance -= staked.balance;
        stakeToken.transfer(msg.sender, balance);

        emit Redeem(msg.sender, balance);
    }

    /// @notice Set new unlock period which only applies on new stakes.
    function setUnlockPeriod(uint256 period) external onlyOwner {
        _setUnlockPeriod(period);
    }

    function _setUnlockPeriod(uint256 period) internal {
        require(period != lockPeriod, "MCBStaking::_setUnlockPeriod::PeriodUnchanged");
        emit SetUnlockPeriod(lockPeriod, period);
        lockPeriod = period;
    }

    function _calcUnlockTime(StakedBalance storage staked, uint256 amount)
        internal
        view
        returns (uint256)
    {
        uint256 eta = staked.unlockTime;
        // protection
        if (amount == 0) {
            return eta;
        }
        uint256 current = _blockTime();
        uint256 remaining = eta > current ? eta - current : 0;
        // if last staking ends, lock all funds in contract by lockPeriod
        if (remaining == 0) {
            return current + lockPeriod;
        }
        // else update the unlockTime with (p + nT) / (m + n)
        // ref: https://docs.google.com/document/d/1IC4mmb2GnEZ3nDTj1Tq2gypsNpHOZjNFQGncGDnOsRk/edit
        return
            current +
            (staked.balance * remaining + amount * lockPeriod) /
            (staked.balance + amount);
    }

    function _blockTime() internal view virtual returns (uint256) {
        return block.timestamp;
    }
}