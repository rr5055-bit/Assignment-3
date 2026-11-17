# Assignment 3 - LAND Token Exchange

Build a two-token trading simulation on Ethereum Sepolia using Solidity, Hardhat, Alchemy, and MetaMask. The frontend and deployment setup are provided.

Read the **assignment instructions PDF** for the full requirements, setup details, and demonstration steps.

## Submission

- **Name:** Laxman Singh Rawat
- **NetID:** LR3531

### Deployed contracts (Sepolia)
- MockUSDC: [0x65B6…F648](https://sepolia.etherscan.io/address/0x65B6129D43609633b1cd2831620534EB7907F648)
- LandToken: [0x84F8…073f](https://sepolia.etherscan.io/address/0x84F851485C44b799d8Cb4EFA44F033E039d8073f)
- LandPool: [0xA133…3b24](https://sepolia.etherscan.io/address/0xA13371C02C7365848cBeDfD6B003544722Df3b24)

### Transactions
- Buy 20 LAND: https://sepolia.etherscan.io/tx/0x47c6754064cc3fbceaf8813a39a917d5164cccfa45e778a6147bba53baec1c1e
- Advance 5 years: https://sepolia.etherscan.io/tx/0xf2dea4aa7a2d8a564a5cab648d3717dfbb010b1a8689353d509a2904307135ea
- Sell 20 LAND: https://sepolia.etherscan.io/tx/0x8230d1f8c2669a67f35adcf1e31fd2c2021f990279d882ecd31aa243743fa0b6

### Demo video
end-to-end-demo.mp4

### Test results
All 15 tests in `test/LandPool.ts` pass:

```
> land-pool-assignment@1.0.0 test
> hardhat test

No contracts to compile

Running Solidity tests


Running node:test tests

  LandPool assignment
    ✔ starts with zero supplies, zero balances, Year 0, correct decimals and no initialized liquidity (208ms)
    ✔ validates constructor addresses; only admin can bind each token to a nonzero pool contract, once
    ✔ only the configured pool can mint each fixed supply once; arbitrary callers cannot mint
    ✔ only admin initializes once: pool gets 1,000 USDC and 100 LAND; wallet stays empty
    ✔ if either initial mint fails, both supplies and liquidityInitialized roll back
    ✔ requesting 100 USDC leaves wallet 100/0 and pool 900/100 without changing total supply
    ✔ requests transfer exactly the input, including 0.000001 USDC; repeat requests work in either year
    ✔ rejects zero/excess reserve requests, non-admin requests, and requests before initialization
    ✔ allows requesting exactly the available reserve; a later request fails without changing balances
    ✔ buys 20 LAND after approving 20 * 10**6 USDC; asserts all four balances
    ✔ rejects zero trades, insufficient approvals, insufficient wallet balances and pool reserves
    ✔ failed buys AND sells leave every wallet/pool token balance unchanged
    ✔ only admin advances once: year 5 and price 5 * 10**6; token balances unchanged
    ✔ rejects selling at Year 0, buying at Year 5, and all trades/advancement before initialization
    ✔ sells 20 LAND after approval: wallet 180 USDC/0 LAND; pool 820 USDC/100 LAND


15 passing (15 nodejs)

WARNING: hre.network.connect() is deprecated and will be removed in a future version. Use hre.network.create() or hre.network.getOrCreate() instead.
```

### Observed balances (Sepolia demo)

| Stage | Wallet USDC | Wallet LAND | Pool USDC | Pool LAND |
|---|---:|---:|---:|---:|
| Initialize pool | 0 | 0 | 1,000 | 100 |
| Request 100 USDC | 100 | 0 | 900 | 100 |
| Buy 20 LAND | 80 | 20 | 920 | 80 |
| Advance five years | 80 | 20 | 920 | 80 |
| Sell 20 LAND | 180 | 0 | 820 | 100 |

### Where the 100 mock USDC came from
The pool paid the 100 mock USDC out of its own reserve: the 900 USDC left from the initial 1,000 after my 100 USDC request, plus the 20 USDC I paid to buy LAND in Year 0. No new USDC was minted for the sale. In exchange the pool took back the 20 LAND, so its reserves went from 920 USDC and 80 LAND to 820 USDC and 100 LAND. The pool ends with all 100 LAND again and 180 USDC less than its initial 1,000, and those 180 USDC are the balance now in my wallet.

## High-level steps

1. Fork this repository, clone your fork, and create a branch for your submission.
2. Install the dependencies and configure your Alchemy Sepolia endpoint and test-wallet credentials in `.env`.
3. Complete the smart contract TODOs and the pending tests, then compile and run the tests.
4. Deploy the contracts to Sepolia. Add the printed pool address to `.env` as `VITE_POOL_ADDRESS`.
5. Start the provided frontend, connect your deployment wallet, and complete the demonstration described in the assignment PDF.
6. Push your completed work to your fork and open a pull request to the original repository.

Use a dedicated test wallet funded with Sepolia ETH for gas. Keep `.env` and your private keys out of Git and your recording.

## Deliverables

- The **pull request URL** for your completed work.
- An **end-to-end demonstration recording**, submitted as an MP4 file or an accessible video link. Follow the recording requirements in the assignment PDF.
