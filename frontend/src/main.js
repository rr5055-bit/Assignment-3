import { BrowserProvider, Contract, formatUnits, isAddress, MaxUint256, ZeroAddress } from "ethers";
import { tokenAbi, poolAbi } from "./abis.js";
import { parseLandAmount, parseUsdcAmount } from "./amounts.js";

const $ = (id) => document.getElementById(id);
const SEPOLIA = 11155111n;
let deployment, provider, signer, account, usdc, land, pool;
let year = 0n, price = 0n, admin = "", initialized = false;
let ready = false, busy = false, past = false;

function status(message, state = "pending") {
  $("status").textContent = message;
  $("status").dataset.state = state;
}

function readableError(error) {
  if (error.code === 4001 || error.code === "ACTION_REJECTED") return "Request cancelled in MetaMask.";
  if (error.code === "INSUFFICIENT_FUNDS") return "Not enough Sepolia ETH for gas.";
  if (error.code === -32002) return "A MetaMask request is already pending. Open MetaMask to finish it.";
  if (error.revert?.name === "NotImplemented" || error.message?.includes("NotImplemented")) {
    return "Contract TODOs are not implemented. Complete, test, and redeploy the contracts.";
  }
  return error.reason || error.shortMessage || error.message || "Transaction failed. Check phase, approval, balances, and reserves.";
}

function quantity() {
  const amount = parseLandAmount($("amount").value);
  const quotedPrice = past ? 1_000_000n : price;
  if (quotedPrice <= 0n || amount > MaxUint256 / quotedPrice) throw new Error("Amount is too large or price is unavailable.");
  return amount;
}

function render() {
  $("connect").disabled = busy || Boolean(account);
  $("refresh").disabled = busy || !account || !deployment;
  $("amount").disabled = busy || !ready || !initialized || past;
  const isAdmin = account?.toLowerCase() === admin.toLowerCase();
  $("initialize").disabled = busy || !ready || initialized || past || !isAdmin || year !== 0n;
  $("initialize").textContent = initialized ? "Liquidity added" : "Add USDC + LAND to pool";
  $("usdc-amount").disabled = busy || !ready || !initialized || past || !isAdmin;
  let validRequest = false;
  $("request-note").textContent = "Receive mock USDC in your connected wallet.";
  try { parseUsdcAmount($("usdc-amount").value); validRequest = true; }
  catch (error) { $("request-note").textContent = error.message; }
  $("request-usdc").disabled = busy || !ready || !initialized || past || !isAdmin || !validRequest;
  $("advance").disabled = busy || !ready || past || year !== 0n || !initialized || account?.toLowerCase() !== admin.toLowerCase();
  $("past").disabled = busy || !ready || year !== 5n || past;
  $("present").disabled = busy || !ready || !past;
  $("view-year").textContent = ready ? (past ? "0 (historical)" : year.toString()) : "-";
  $("price").textContent = ready ? formatUnits(past ? 1_000_000n : price, 6) : "-";
  $("view-note").textContent = past
    ? "Historical price only. Trading is disabled; balances are current and the on-chain year remains 5."
    : "";
  let valid = false;
  if (!ready) $("quote").textContent = "Connect and refresh to see a quote.";
  try {
    if (ready) {
      const amount = quantity();
      $("quote").textContent = `${amount} LAND = ${formatUnits(amount * (past ? 1_000_000n : price), 6)} mock USDC${past ? " (historical quote only)" : ""}.`;
      valid = true;
    }
  } catch (error) { $("quote").textContent = error.message; }
  $("buy").disabled = busy || !ready || !initialized || past || !valid || year !== 0n;
  $("sell").disabled = busy || !ready || !initialized || past || !valid || year !== 5n;
}

async function refresh() {
  ready = false;
  render();
  if (BigInt(await window.ethereum.request({ method: "eth_chainId" })) !== SEPOLIA) {
    throw new Error("Switch MetaMask to Ethereum Sepolia.");
  }
  const values = await Promise.all([
    pool.currentYear(), pool.pricePerLand(), pool.admin(), pool.liquidityInitialized(),
    usdc.balanceOf(account), land.balanceOf(account),
    usdc.balanceOf(deployment.pool), land.balanceOf(deployment.pool),
  ]);
  [year, price, admin, initialized] = values;
  if (![0n, 5n].includes(year) || price !== (year === 0n ? 1_000_000n : 5_000_000n)) {
    throw new Error("Unexpected contract phase or price. Check the Solidity TODOs.");
  }
  $("chain-year").textContent = year.toString();
  $("wallet-usdc").textContent = formatUnits(values[4], 6);
  $("wallet-land").textContent = values[5].toString();
  $("pool-usdc").textContent = formatUnits(values[6], 6);
  $("pool-land").textContent = values[7].toString();
  ready = true;
  render();
}

async function connect() {
  if (!window.ethereum) throw new Error("Install MetaMask, then reload this page.");
  await window.ethereum.request({ method: "eth_requestAccounts" });
  provider = new BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  account = await signer.getAddress();
  $("account").textContent = account;
  if (!deployment) {
    status("Wallet connected. Trading is not available yet.", "success");
    return;
  }
  await loadSimulation();
}

async function loadSimulation() {
  ready = false;
  if (BigInt(await window.ethereum.request({ method: "eth_chainId" })) !== SEPOLIA) {
    $("switch-network").hidden = false;
    throw new Error("Wallet connected. Select Ethereum Sepolia in MetaMask, or use Switch to Sepolia, to use the simulation.");
  }
  if (await provider.getCode(deployment.pool) === "0x") {
    throw new Error("No Sepolia contract at VITE_POOL_ADDRESS. Correct .env and restart the frontend.");
  }
  const configuredPool = new Contract(deployment.pool, poolAbi, signer);
  const [usdcAddress, landAddress] = await Promise.all([configuredPool.usdc(), configuredPool.land()]);
  if (usdcAddress === ZeroAddress || landAddress === ZeroAddress || usdcAddress === landAddress) {
    throw new Error("Pool token addresses are invalid. Check the contract constructor and redeploy.");
  }
  for (const address of [usdcAddress, landAddress]) {
    if (await provider.getCode(address) === "0x") throw new Error("A pool token address has no contract on Sepolia.");
  }
  deployment.usdc = usdcAddress;
  deployment.land = landAddress;
  usdc = new Contract(deployment.usdc, tokenAbi, signer);
  land = new Contract(deployment.land, tokenAbi, signer);
  pool = configuredPool;
  await refresh();
  $("setup").textContent = "";
  status("Wallet connected. Choose an action.", "success");
}

async function confirm(send, label) {
  status(`${label}: confirm in MetaMask.`);
  const tx = await send();
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.href = `https://sepolia.etherscan.io/tx/${tx.hash}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `${label}: ${tx.hash}`;
  item.append(link);
  $("transactions").append(item);
  status(`${label}: waiting for confirmation…`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`${label} failed.`);
}

async function trade(kind) {
  if (past) throw new Error("Return to the current year to trade.");
  await refresh(); // Re-read phase/price before asking for an approval.
  const amount = quantity();
  if (!initialized || (kind === "buy" ? year !== 0n : year !== 5n)) throw new Error("This trade is not allowed in the current phase.");
  const payment = amount * price; // BigInt only: LAND has 0 decimals, USDC has 6.
  const inputToken = kind === "buy" ? usdc : land;
  const required = kind === "buy" ? payment : amount;
  const outputToken = kind === "buy" ? land : usdc;
  const output = kind === "buy" ? amount : payment;
  if (await inputToken.balanceOf(account) < required) throw new Error("Your token balance is too low.");
  if (await outputToken.balanceOf(deployment.pool) < output) throw new Error("The pool has insufficient reserves.");
  // Approval is a separate transaction; it gives permission without moving tokens.
  // The following pool call performs BOTH transfer legs atomically.
  if (await inputToken.allowance(account, deployment.pool) < required) {
    await confirm(() => inputToken.approve(deployment.pool, required), `Approve ${kind === "buy" ? "mock USDC" : "LAND"}`);
  }
  await confirm(() => pool[kind](amount), kind === "buy" ? "Buy LAND" : "Sell LAND");
  await refresh();
  status("Trade confirmed. Balances refreshed.", "success");
}

async function initializeLiquidity() {
  if (past) throw new Error("Return to the current year first.");
  await refresh();
  if (initialized || year !== 0n || account.toLowerCase() !== admin.toLowerCase()) {
    throw new Error("Only the admin can initialize liquidity, once at Year 0.");
  }
  await confirm(() => pool.initializeLiquidity(), "Add initial liquidity");
  await refresh();
  status("Liquidity added. Request mock USDC to start trading.", "success");
}

async function requestUsdc() {
  if (past) throw new Error("Return to the current year first.");
  await refresh();
  if (!initialized || account.toLowerCase() !== admin.toLowerCase()) {
    throw new Error("Connect the admin wallet and initialize liquidity first.");
  }
  const amount = parseUsdcAmount($("usdc-amount").value);
  if (amount > await usdc.balanceOf(deployment.pool)) {
    throw new Error("Requested amount exceeds the pool's available mock USDC.");
  }
  // No approval: the pool sends its own tokens; this does not mint more USDC.
  await confirm(() => pool.requestUsdc(amount), "Request mock USDC");
  await refresh();
  status(`${formatUnits(amount, 6)} mock USDC received. Balances refreshed.`, "success");
}

async function run(action) {
  if (busy) return;
  busy = true;
  render();
  try { await action(); }
  catch (error) {
    const message = readableError(error);
    if (pool) { try { await refresh(); } catch { ready = false; } }
    status(message, "error");
  } finally { busy = false; render(); }
}

$("connect").addEventListener("click", () => run(connect));
$("switch-network").addEventListener("click", () => run(async () => {
  await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
  window.location.reload();
}));
$("refresh").addEventListener("click", () => run(async () => { await loadSimulation(); status("Balances refreshed.", "success"); }));
$("initialize").addEventListener("click", () => run(initializeLiquidity));
$("request-usdc").addEventListener("click", () => run(requestUsdc));
$("usdc-amount").addEventListener("input", render);
$("buy").addEventListener("click", () => run(() => trade("buy")));
$("sell").addEventListener("click", () => run(() => trade("sell")));
$("advance").addEventListener("click", () => run(async () => {
  await confirm(() => pool.advanceFiveYears(), "Advance 5 Years");
  await refresh();
  status("On-chain year is now 5. No tokens moved.", "success");
}));
// Historical navigation changes only local presentation. Never send a transaction.
$("past").addEventListener("click", () => { past = true; render(); });
$("present").addEventListener("click", () => { past = false; render(); });
$("amount").addEventListener("input", render);

// A full refresh discards the old signer and stale quotes after wallet changes.
// Reconnect explicitly after reload; submitted transactions can still confirm.
window.ethereum?.on("accountsChanged", () => { if (account) window.location.reload(); });
window.ethereum?.on("chainChanged", () => window.location.reload());

async function init() {
  const poolAddress = import.meta.env.VITE_POOL_ADDRESS?.trim();
  if (poolAddress && isAddress(poolAddress) && poolAddress !== ZeroAddress) {
    deployment = { chainId: Number(SEPOLIA), pool: poolAddress };
    $("setup").textContent = "";
    status("Ready to connect.");
  } else {
    $("setup").textContent = poolAddress ? "Trading is unavailable. Check the pool address." : "";
    status("Connect your wallet to get started.");
  }
  render();
}
await init();
