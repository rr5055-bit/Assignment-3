// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {LandToken} from "./LandToken.sol";

contract LandPool {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IERC20 public immutable land;
    address public immutable admin;
    uint256 public currentYear;
    bool public liquidityInitialized;

    error NotImplemented();

    constructor(address usdcAddress, address landAddress, address adminAddress) {
        // TODO(student): reject zero addresses and identical token addresses.
        if (usdcAddress == address(0) || landAddress == address(0) || adminAddress == address(0)) {
            revert("Zero address provided");
        }
        if (usdcAddress == landAddress) {
            revert("Identical token addresses provided");
        }
        usdc = IERC20(usdcAddress);
        land = IERC20(landAddress);
        admin = adminAddress;
    }

    function initializeLiquidity() external {
        // TODO(student): admin only, Year 0, exactly once. Call mintInitialSupply()
        // on BOTH configured tokens, creating 1,000 mock USDC and 100 LAND
        // directly in this pool. Set liquidityInitialized atomically.
        // If either mint fails, both token supplies and this flag must roll back.
        // Use the token contracts' typed interfaces for these calls.
        if (msg.sender != admin) {
            revert("Only admin can initialize liquidity");
        }
        if (currentYear != 0) {
            revert("Liquidity can only be initialized in Year 0");
        }
        if (liquidityInitialized) {
            revert("Liquidity already initialized");
        }
        liquidityInitialized = true;
        // Call mintInitialSupply on both tokens
        MockUSDC(address(usdc)).mintInitialSupply();
        LandToken(address(land)).mintInitialSupply();
        if (usdc.balanceOf(address(this)) != 1000 * 1e6 || land.balanceOf(address(this)) != 100) {
            revert("Liquidity initialization failed");
        }
    }
    
    function requestUsdc(uint256 usdcAmount) external {
        // TODO(student): admin only, after initialization, positive USDC BASE units.
        // Transfer exactly usdcAmount from reserves to msg.sender; never mint.
        // Reject requests above the available USDC balance without changing balances.
        // Repeat requests are allowed in either year, limited by remaining reserves.
        if (msg.sender != admin) {
            revert("Only admin can request USDC");
        }
        if (!liquidityInitialized) {
            revert("Liquidity not initialized");
        }
        if (usdcAmount == 0) {
            revert("Invalid USDC amount");
        }
        if (usdc.balanceOf(address(this)) < usdcAmount) {
            revert("Insufficient USDC balance");
        }
        usdc.safeTransfer(msg.sender, usdcAmount);
    }

    function pricePerLand() public view returns (uint256) {
        // TODO(student): return 1 * 10**6 at Year 0, 5 * 10**6 at Year 5.
        // Return mock USDC BASE UNITS per whole LAND, never a floating value.
        if (currentYear == 0) {
            return 1 * 10**6; // 1 USDC in base units
        } else if (currentYear == 5) {
            return 5 * 10**6; // 5 USDC in base units
        } else {
            revert("Invalid year for price");
        }
    }

    function buy(uint256 landAmount) external {
        // TODO(student): liquidity initialized, Year 0 only, positive quantity, enough LAND.
        // Payment = whole LAND quantity * pricePerLand() (USDC base units).
        // Take approved USDC from msg.sender and send LAND in ONE transaction.
        // Use SafeERC20; any failed leg must revert the entire swap.
        if (!liquidityInitialized) {
            revert("Liquidity not initialized");
        }
        if (currentYear != 0) {
            revert("Purchases are only allowed in Year 0");
        }
        if (landAmount == 0) {
            revert("Invalid LAND amount");
        }
        if (land.balanceOf(address(this)) < landAmount) {
            revert("Insufficient LAND in pool");
        }
        uint256 usdcPayment = landAmount * pricePerLand();
        if (usdc.balanceOf(msg.sender) < usdcPayment) {
            revert("Insufficient USDC balance");
        }
        usdc.safeTransferFrom(msg.sender, address(this), usdcPayment);
        land.safeTransfer(msg.sender, landAmount);
    }

    function advanceFiveYears() external {
        // TODO(student): admin only, liquidity initialized, Year 0 -> Year 5 exactly once.
        // Change only the phase; neither token should move.
        if (msg.sender != admin) {
            revert("Only admin can advance years");
        }
        if (!liquidityInitialized) {
            revert("Liquidity not initialized");
        }
        if (currentYear != 0) {
            revert("Can only advance from Year 0");
        }
        currentYear = 5;
    }

    function sell(uint256 landAmount) external {
        // TODO(student): liquidity initialized, Year 5 only, positive quantity, enough USDC.
        // Take approved LAND from msg.sender, then pay USDC atomically.
        // No arbitrary tokens, variable market prices, or on-chain reset.
        if (!liquidityInitialized) {
            revert("Liquidity not initialized");
        }
        if (currentYear != 5) {
            revert("Sales are only allowed in Year 5");
        }
        if (landAmount == 0) {
            revert("Invalid LAND amount");
        }
        if (land.balanceOf(msg.sender) < landAmount) {
            revert("Insufficient LAND balance");
        }
        uint256 usdcPayout = landAmount * pricePerLand();
        if (usdc.balanceOf(address(this)) < usdcPayout) {
            revert("Insufficient USDC in pool");
        }
        land.safeTransferFrom(msg.sender, address(this), landAmount);
        usdc.safeTransfer(msg.sender, usdcPayout);
    }
}
