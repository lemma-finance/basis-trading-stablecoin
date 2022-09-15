// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.3;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

contract Token is ERC20Upgradeable {
    function initialize(uint256 amount) external initializer {
        __ERC20_init("Token", "token");
        _mint(_msgSender(), amount);
    }

    function removeTokens(uint256 amount, address guy) external {
        _burn(guy, amount);
    }
}
