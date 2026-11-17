// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    address public immutable admin;
    address public pool;
    bool public supplyMinted;
    error NotImplemented();

    constructor(address adminAddress) ERC20("Mock USDC", "mUSDC") {
        // TODO(student): reject a zero admin. Start with ZERO supply.
        if (adminAddress == address(0)) {
            revert("Zero admin address provided");
        }
        supplyMinted = false;
        admin = adminAddress;
    }

    function setPool(address poolAddress) external {
        // TODO(student): admin only; set a nonzero pool contract exactly once.
        // Deployment wires this permission before the app initializes liquidity.
        if (msg.sender != admin) {
            revert("Only admin can set pool");
        }
        if (poolAddress == address(0)) {
            revert("Zero pool address provided");
        }
        if (pool != address(0)) {
            revert("Pool address already set");
        }
        pool = poolAddress;
    }

    function mintInitialSupply() external {
        // TODO(student): only the configured pool, exactly once.
        // Mint exactly 1,000 mock USDC (1_000 * 10**6 base units) directly to pool.
        // Record supplyMinted; never allow arbitrary amounts or later minting.
        if (msg.sender != pool) {
            revert("Only pool can mint initial supply");
        }
        if (supplyMinted) {
            revert("Initial supply already minted");
        }
        supplyMinted = true;
        _mint(pool, 1000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
