import { describe, it } from "node:test";
import { network } from "hardhat";
import assert from "node:assert/strict";
import { ZeroAddress } from "ethers";

// Reusable fresh deployment. Only call after implementing token/funding TODOs.
export async function deployEmptyFixture() {
  const connection = await network.connect();
  const { ethers } = connection;
  const [admin, other] = await ethers.getSigners();
  const usdc = await ethers.deployContract("MockUSDC", [admin.address]);
  const land = await ethers.deployContract("LandToken", [admin.address]);
  await Promise.all([usdc.waitForDeployment(), land.waitForDeployment()]);
  const pool = await ethers.deployContract("LandPool", [await usdc.getAddress(), await land.getAddress(), admin.address]);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  await (await usdc.setPool(poolAddress)).wait();
  await (await land.setPool(poolAddress)).wait();
  // Close connection in your test's finally block: await connection.close().
  return { connection, ethers, admin, other, usdc, land, pool, poolAddress };
}

// Use the empty fixture for initialization/permission tests, this one for trades.
export async function deployFundedFixture() {
  const fixture = await deployEmptyFixture();
  try {
    await (await fixture.pool.initializeLiquidity()).wait();
    await (await fixture.pool.requestUsdc(100_000_000n)).wait();
    return fixture;
  } catch (error) {
    await fixture.connection.close();
    throw error;
  }
}

type Fixture = Awaited<ReturnType<typeof deployEmptyFixture>>;

// Returns [wallet USDC, wallet LAND, pool USDC, pool LAND] as bigints.
async function balances(f: Fixture, wallet: string = f.admin.address) {
  return Promise.all([
    f.usdc.balanceOf(wallet),
    f.land.balanceOf(wallet),
    f.usdc.balanceOf(f.poolAddress),
    f.land.balanceOf(f.poolAddress),
  ]);
}

const USDC = 1_000_000n; // 1 mock USDC in base units (6 decimals)

describe("LandPool assignment", () => {
  it("starts with zero supplies, zero balances, Year 0, correct decimals and no initialized liquidity", async () => {
    const f = await deployEmptyFixture();
    try {
      assert.equal(await f.usdc.totalSupply(), 0n);
      assert.equal(await f.land.totalSupply(), 0n);
      assert.deepEqual(await balances(f), [0n, 0n, 0n, 0n]);
      assert.equal(await f.usdc.decimals(), 6n);
      assert.equal(await f.land.decimals(), 0n);
      assert.equal(await f.pool.currentYear(), 0n);
      assert.equal(await f.pool.liquidityInitialized(), false);
      assert.equal(await f.usdc.supplyMinted(), false);
      assert.equal(await f.land.supplyMinted(), false);
    } finally {
      await f.connection.close();
    }
  });

  it("validates constructor addresses; only admin can bind each token to a nonzero pool contract, once", async () => {
    const f = await deployEmptyFixture();
    const { ethers, admin, other, poolAddress } = f;
    try {
      const usdcAddress = await f.usdc.getAddress();
      const landAddress = await f.land.getAddress();

      // Constructor validation
      await assert.rejects(ethers.deployContract("MockUSDC", [ZeroAddress]), /Zero admin address provided/);
      await assert.rejects(ethers.deployContract("LandToken", [ZeroAddress]), /Zero admin address provided/);
      await assert.rejects(ethers.deployContract("LandPool", [ZeroAddress, landAddress, admin.address]), /Zero address provided/);
      await assert.rejects(ethers.deployContract("LandPool", [usdcAddress, ZeroAddress, admin.address]), /Zero address provided/);
      await assert.rejects(ethers.deployContract("LandPool", [usdcAddress, landAddress, ZeroAddress]), /Zero address provided/);
      await assert.rejects(
        ethers.deployContract("LandPool", [usdcAddress, usdcAddress, admin.address]),
        /Identical token addresses provided/,
      );

      // setPool permissions on fresh, unbound tokens
      const freshUsdc = await ethers.deployContract("MockUSDC", [admin.address]);
      const freshLand = await ethers.deployContract("LandToken", [admin.address]);
      for (const token of [freshUsdc, freshLand]) {
        await assert.rejects(token.connect(other).setPool(poolAddress), /Only admin can set pool/);
        await assert.rejects(token.setPool(ZeroAddress), /Zero pool address provided/);
        assert.equal(await token.pool(), ZeroAddress);

        await (await token.setPool(poolAddress)).wait();
        assert.equal(await token.pool(), poolAddress);

        await assert.rejects(token.setPool(other.address), /Pool address already set/);
        assert.equal(await token.pool(), poolAddress);
      }

      // The fixture's tokens are bound to the fixture's pool
      assert.equal(await f.usdc.pool(), poolAddress);
      assert.equal(await f.land.pool(), poolAddress);
    } finally {
      await f.connection.close();
    }
  });

  it("only the configured pool can mint each fixed supply once; arbitrary callers cannot mint", async () => {
    const f = await deployEmptyFixture();
    const { ethers, admin, other } = f;
    try {
      // Fixture tokens are bound to the pool contract: no EOA can mint
      for (const token of [f.usdc, f.land]) {
        await assert.rejects(token.mintInitialSupply(), /Only pool can mint initial supply/);
        await assert.rejects(token.connect(other).mintInitialSupply(), /Only pool can mint initial supply/);
        assert.equal(await token.totalSupply(), 0n);
      }

      // A contract can't sign transactions, so bind fresh tokens to an EOA ("other")
      // and call mintInitialSupply as that configured pool.
      const freshUsdc = await ethers.deployContract("MockUSDC", [admin.address]);
      const freshLand = await ethers.deployContract("LandToken", [admin.address]);
      const cases = [
        [freshUsdc, 1_000n * USDC],
        [freshLand, 100n],
      ] as const;
      for (const [token, supply] of cases) {
        await (await token.setPool(other.address)).wait();
        await assert.rejects(token.mintInitialSupply(), /Only pool can mint initial supply/); // admin isn't the pool

        await (await token.connect(other).mintInitialSupply()).wait();
        assert.equal(await token.totalSupply(), supply);
        assert.equal(await token.balanceOf(other.address), supply);
        assert.equal(await token.supplyMinted(), true);

        await assert.rejects(token.connect(other).mintInitialSupply(), /Initial supply already minted/);
        assert.equal(await token.totalSupply(), supply);
      }
    } finally {
      await f.connection.close();
    }
  });

  it("only admin initializes once: pool gets 1,000 USDC and 100 LAND; wallet stays empty", async () => {
    const f = await deployEmptyFixture();
    try {
      await assert.rejects(f.pool.connect(f.other).initializeLiquidity(), /Only admin can initialize liquidity/);
      assert.equal(await f.pool.liquidityInitialized(), false);

      await (await f.pool.initializeLiquidity()).wait();
      assert.equal(await f.pool.liquidityInitialized(), true);
      assert.deepEqual(await balances(f), [0n, 0n, 1_000n * USDC, 100n]);
      assert.equal(await f.usdc.totalSupply(), 1_000n * USDC);
      assert.equal(await f.land.totalSupply(), 100n);

      await assert.rejects(f.pool.initializeLiquidity(), /Liquidity already initialized/);
      assert.equal(await f.usdc.totalSupply(), 1_000n * USDC);
      assert.equal(await f.land.totalSupply(), 100n);
    } finally {
      await f.connection.close();
    }
  });

  it("if either initial mint fails, both supplies and liquidityInitialized roll back", async () => {
    const f = await deployEmptyFixture();
    const { ethers, admin, other } = f;
    try {
      // Bind one token to the new pool and the other to an EOA, so that token's mint reverts.
      for (const [bindUsdc, bindLand] of [[true, false], [false, true]]) {
        const usdc = await ethers.deployContract("MockUSDC", [admin.address]);
        const land = await ethers.deployContract("LandToken", [admin.address]);
        const pool = await ethers.deployContract("LandPool", [await usdc.getAddress(), await land.getAddress(), admin.address]);
        const poolAddress = await pool.getAddress();
        await (await usdc.setPool(bindUsdc ? poolAddress : other.address)).wait();
        await (await land.setPool(bindLand ? poolAddress : other.address)).wait();

        await assert.rejects(pool.initializeLiquidity(), /Only pool can mint initial supply/);
        assert.equal(await usdc.totalSupply(), 0n);
        assert.equal(await land.totalSupply(), 0n);
        assert.equal(await usdc.supplyMinted(), false);
        assert.equal(await land.supplyMinted(), false);
        assert.equal(await pool.liquidityInitialized(), false);
      }
    } finally {
      await f.connection.close();
    }
  });

  it("requesting 100 USDC leaves wallet 100/0 and pool 900/100 without changing total supply", async () => {
    const f = await deployEmptyFixture();
    try {
      await (await f.pool.initializeLiquidity()).wait();
      await (await f.pool.requestUsdc(100n * USDC)).wait();
      assert.deepEqual(await balances(f), [100n * USDC, 0n, 900n * USDC, 100n]);
      assert.equal(await f.usdc.totalSupply(), 1_000n * USDC);
      assert.equal(await f.land.totalSupply(), 100n);
    } finally {
      await f.connection.close();
    }
  });

  it("requests transfer exactly the input, including 0.000001 USDC; repeat requests work in either year", async () => {
    const f = await deployEmptyFixture();
    try {
      await (await f.pool.initializeLiquidity()).wait();

      await (await f.pool.requestUsdc(1n)).wait(); // 0.000001 USDC
      assert.deepEqual(await balances(f), [1n, 0n, 999_999_999n, 100n]);

      await (await f.pool.requestUsdc(1n)).wait(); // repeat in Year 0
      assert.deepEqual(await balances(f), [2n, 0n, 999_999_998n, 100n]);

      await (await f.pool.advanceFiveYears()).wait();
      await (await f.pool.requestUsdc(3n)).wait(); // repeat in Year 5
      assert.deepEqual(await balances(f), [5n, 0n, 999_999_995n, 100n]);

      assert.equal(await f.usdc.totalSupply(), 1_000n * USDC);
    } finally {
      await f.connection.close();
    }
  });

  it("rejects zero/excess reserve requests, non-admin requests, and requests before initialization", async () => {
    const f = await deployEmptyFixture();
    try {
      await assert.rejects(f.pool.requestUsdc(1n), /Liquidity not initialized/);
      await assert.rejects(f.pool.connect(f.other).requestUsdc(1n), /Only admin can request USDC/);

      await (await f.pool.initializeLiquidity()).wait();
      await assert.rejects(f.pool.connect(f.other).requestUsdc(1n), /Only admin can request USDC/);
      await assert.rejects(f.pool.requestUsdc(0n), /Invalid USDC amount/);
      await assert.rejects(f.pool.requestUsdc(1_000n * USDC + 1n), /Insufficient USDC balance/);

      assert.deepEqual(await balances(f), [0n, 0n, 1_000n * USDC, 100n]);
      assert.deepEqual(await balances(f, f.other.address), [0n, 0n, 1_000n * USDC, 100n]);
    } finally {
      await f.connection.close();
    }
  });

  it("allows requesting exactly the available reserve; a later request fails without changing balances", async () => {
    const f = await deployFundedFixture(); // wallet 100 / 0, pool 900 / 100
    try {
      await (await f.pool.requestUsdc(900n * USDC)).wait();
      assert.deepEqual(await balances(f), [1_000n * USDC, 0n, 0n, 100n]);

      await assert.rejects(f.pool.requestUsdc(1n), /Insufficient USDC balance/);
      assert.deepEqual(await balances(f), [1_000n * USDC, 0n, 0n, 100n]);
    } finally {
      await f.connection.close();
    }
  });

  it("buys 20 LAND after approving 20 * 10**6 USDC; asserts all four balances", async () => {
    const f = await deployFundedFixture(); // wallet 100 / 0, pool 900 / 100
    try {
      await (await f.usdc.approve(f.poolAddress, 20n * USDC)).wait();
      await (await f.pool.buy(20n)).wait();

      assert.deepEqual(await balances(f), [80n * USDC, 20n, 920n * USDC, 80n]);
      assert.equal(await f.usdc.allowance(f.admin.address, f.poolAddress), 0n);
    } finally {
      await f.connection.close();
    }
  });

  it("rejects zero trades, insufficient approvals, insufficient wallet balances and pool reserves", async () => {
    const f = await deployFundedFixture(); // wallet 100 / 0, pool 900 / 100
    try {
      // --- Year 0: buying ---
      await assert.rejects(f.pool.buy(0n), /Invalid LAND amount/);

      await (await f.usdc.approve(f.poolAddress, 20n * USDC - 1n)).wait();
      await assert.rejects(f.pool.buy(20n), /ERC20InsufficientAllowance/);

      // "other" holds no USDC
      await assert.rejects(f.pool.connect(f.other).buy(1n), /Insufficient USDC balance/);

      // Pool only holds 100 LAND
      await assert.rejects(f.pool.buy(101n), /Insufficient LAND in pool/);

      // --- Year 5: selling ---
      await (await f.usdc.approve(f.poolAddress, 20n * USDC)).wait();
      await (await f.pool.buy(20n)).wait(); // wallet 80 / 20, pool 920 / 80
      await (await f.pool.advanceFiveYears()).wait();

      await assert.rejects(f.pool.sell(0n), /Invalid LAND amount/);
      await assert.rejects(f.pool.sell(20n), /ERC20InsufficientAllowance/); // no LAND approval yet

      await (await f.land.approve(f.poolAddress, 100n)).wait();
      await assert.rejects(f.pool.sell(21n), /Insufficient LAND balance/);

      // Drain the pool's USDC so it can't pay a seller
      await (await f.pool.requestUsdc(920n * USDC)).wait();
      await assert.rejects(f.pool.sell(1n), /Insufficient USDC in pool/);
    } finally {
      await f.connection.close();
    }
  });

  it("failed buys AND sells leave every wallet/pool token balance unchanged", async () => {
    const f = await deployFundedFixture(); // wallet 100 / 0, pool 900 / 100
    try {
      // Failed buys
      let before = await balances(f);
      await assert.rejects(f.pool.buy(20n), /ERC20InsufficientAllowance/); // USDC leg fails
      assert.deepEqual(await balances(f), before);
      await assert.rejects(f.pool.buy(101n), /Insufficient LAND in pool/);
      assert.deepEqual(await balances(f), before);

      // Set up a LAND position, then move to Year 5
      await (await f.usdc.approve(f.poolAddress, 20n * USDC)).wait();
      await (await f.pool.buy(20n)).wait();
      await (await f.pool.advanceFiveYears()).wait();

      // Failed sells
      before = await balances(f);
      await assert.rejects(f.pool.sell(20n), /ERC20InsufficientAllowance/); // LAND leg fails
      assert.deepEqual(await balances(f), before);

      await (await f.land.approve(f.poolAddress, 20n)).wait();
      await (await f.pool.requestUsdc(920n * USDC)).wait(); // drain pool USDC
      before = await balances(f);
      await assert.rejects(f.pool.sell(20n), /Insufficient USDC in pool/); // payout can't be covered
      assert.deepEqual(await balances(f), before);
    } finally {
      await f.connection.close();
    }
  });

  it("only admin advances once: year 5 and price 5 * 10**6; token balances unchanged", async () => {
    const f = await deployFundedFixture(); // wallet 100 / 0, pool 900 / 100
    try {
      assert.equal(await f.pool.pricePerLand(), 1n * USDC);
      await assert.rejects(f.pool.connect(f.other).advanceFiveYears(), /Only admin can advance years/);
      assert.equal(await f.pool.currentYear(), 0n);

      const before = await balances(f);
      await (await f.pool.advanceFiveYears()).wait();
      assert.equal(await f.pool.currentYear(), 5n);
      assert.equal(await f.pool.pricePerLand(), 5n * USDC);
      assert.deepEqual(await balances(f), before);
      assert.equal(await f.usdc.totalSupply(), 1_000n * USDC);
      assert.equal(await f.land.totalSupply(), 100n);

      await assert.rejects(f.pool.advanceFiveYears(), /Can only advance from Year 0/);
      assert.equal(await f.pool.currentYear(), 5n);
    } finally {
      await f.connection.close();
    }
  });

  it("rejects selling at Year 0, buying at Year 5, and all trades/advancement before initialization", async () => {
    const f = await deployEmptyFixture();
    try {
      // Before initialization
      await assert.rejects(f.pool.buy(1n), /Liquidity not initialized/);
      await assert.rejects(f.pool.sell(1n), /Liquidity not initialized/);
      await assert.rejects(f.pool.advanceFiveYears(), /Liquidity not initialized/);

      await (await f.pool.initializeLiquidity()).wait();
      await (await f.pool.requestUsdc(100n * USDC)).wait();

      // Selling at Year 0
      await assert.rejects(f.pool.sell(1n), /Sales are only allowed in Year 5/);

      // Buying at Year 5
      await (await f.pool.advanceFiveYears()).wait();
      await (await f.usdc.approve(f.poolAddress, 1n * USDC)).wait();
      await assert.rejects(f.pool.buy(1n), /Purchases are only allowed in Year 0/);
    } finally {
      await f.connection.close();
    }
  });

  it("sells 20 LAND after approval: wallet 180 USDC/0 LAND; pool 820 USDC/100 LAND", async () => {
    const f = await deployFundedFixture(); // wallet 100 / 0, pool 900 / 100
    try {
      await (await f.usdc.approve(f.poolAddress, 20n * USDC)).wait();
      await (await f.pool.buy(20n)).wait(); // wallet 80 / 20, pool 920 / 80
      await (await f.pool.advanceFiveYears()).wait();

      await (await f.land.approve(f.poolAddress, 20n)).wait();
      await (await f.pool.sell(20n)).wait(); // 20 LAND * 5 USDC = 100 USDC

      assert.deepEqual(await balances(f), [180n * USDC, 0n, 820n * USDC, 100n]);
    } finally {
      await f.connection.close();
    }
  });
});
