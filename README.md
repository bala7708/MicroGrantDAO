# 🏛️ MicroGrant DAO

> A fully decentralized, on-chain micro-grant system where token holders propose, vote on, and execute community grants — no multisig required, no central authority.

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-blue?style=flat-square&logo=solidity)](https://soliditylang.org)
[![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-5.0-purple?style=flat-square)](https://openzeppelin.com)
[![Java](https://img.shields.io/badge/Java-orange?style=for-the-badge)](https://openjdk.org)
[![Hardhat](https://img.shields.io/badge/Hardhat-2.22-yellow?style=flat-square)](https://hardhat.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Proposal Lifecycle](#proposal-lifecycle)
- [Contract Reference](#contract-reference)
- [Setup & Installation](#setup--installation)
- [Running Tests](#running-tests)
- [Deployment](#deployment)
- [Governance Parameters](#governance-parameters)
- [Frontend dApp](#frontend-dapp)
- [Security](#security)
- [Roadmap](#roadmap)

---

## Overview

**MicroGrant DAO** enables communities to fund small projects (up to 5 ETH) entirely on-chain. Any holder of MGRANT tokens can:

- Submit a grant proposal with a recipient, amount, and description
- Vote FOR / AGAINST / ABSTAIN during a configurable voting window
- Execute passed proposals after a timelock, sending ETH directly from the treasury

Curators can flag suspicious proposals. Admins can adjust governance parameters. No central authority ever holds or controls the funds.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        dApp Frontend                        │
│                    (React + ethers.js)                      │
└─────────────────────┬───────────────────────────────────────┘
                      │ calls
          ┌───────────▼───────────────────┐
          │       MicroGrantDAO.sol       │  ← Core governance
          │  - createProposal()           │
          │  - castVote()                 │
          │  - finalizeProposal()         │
          │  - executeProposal()          │
          └──────┬──────────────┬─────────┘
                 │ reads        │ disburseGrant()
    ┌────────────▼────┐    ┌────▼──────────────┐
    │ GovernanceToken │    │   DAOTreasury     │
    │  (MGRANT ERC20) │    │  (holds ETH)      │
    │  - ERC20Votes   │    │  - deposit()      │
    │  - ERC20Permit  │    │  - disburseGrant()│
    └─────────────────┘    └───────────────────┘
```

### Contracts

| Contract | Purpose |
|---|---|
| `GovernanceToken.sol` | ERC20 voting token (MGRANT) with `ERC20Votes` extension |
| `DAOTreasury.sol` | Holds ETH, only disbursable by the DAO Governor |
| `MicroGrantDAO.sol` | Core governance: proposals, voting, execution |

---

## Proposal Lifecycle

```
Submit        Review        Vote          Finalize      Execute
  │             │             │               │             │
  ▼             ▼             ▼               ▼             ▼
PENDING ──► ACTIVE ──► [voting ends] ──► PASSED ──► EXECUTED
              │                          │
           (curator                   REJECTED
            can flag)
              │
           CANCELLED
```

### Step-by-Step

1. **Submit** — Any member with ≥ 10 MGRANT calls `createProposal()` with:
   - Recipient address
   - ETH amount (max 5 ETH)
   - Title, description, category
   - IPFS hash of full proposal doc

2. **Review Period** — Voting delay (default: 1 day). Curators can flag suspicious proposals during this window.

3. **Voting** — After delay, anyone calls `activateVoting()`. Members vote `castVote(id, choice)`:
   - `0` = AGAINST
   - `1` = FOR
   - `2` = ABSTAIN
   - Vote weight = MGRANT token balance

4. **Finalize** — After voting period (default: 5 days), anyone calls `finalizeProposal()`. Proposal passes if:
   - Total votes ≥ 10% of total supply (quorum)
   - FOR votes > AGAINST votes (majority)

5. **Timelock** — Passed proposals wait 2 days before execution (community can prepare/review).

6. **Execute** — Anyone calls `executeProposal()`. Treasury sends ETH directly to the grant recipient.

---

## Contract Reference

### MicroGrantDAO

```solidity
// Create a grant proposal
function createProposal(
    address payable recipient,
    uint256 amount,          // in wei
    string calldata title,
    string calldata description,
    string calldata category,
    string calldata ipfsHash
) external returns (uint256 proposalId);

// Vote on an active proposal
function castVote(uint256 proposalId, VoteChoice choice) external;
// VoteChoice: 0=AGAINST, 1=FOR, 2=ABSTAIN

// Activate voting after delay
function activateVoting(uint256 proposalId) external;

// Finalize after voting ends
function finalizeProposal(uint256 proposalId) external;

// Execute after timelock
function executeProposal(uint256 proposalId) external;

// Cancel (proposer or curator)
function cancelProposal(uint256 proposalId) external;

// Curator: flag suspicious proposal
function flagProposal(uint256 proposalId, string calldata reason) external;

// Read
function getProposal(uint256 proposalId) external view returns (Proposal memory);
function getVoteStats(uint256 proposalId) external view returns (...);
function hasVoted(uint256 proposalId, address voter) external view returns (bool);
```

### GovernanceToken

```solidity
function addMember(address member) external;          // onlyOwner
function mintReward(address to, uint256 amount) external; // onlyOwner
function delegate(address delegatee) external;        // Required before voting!
```

### DAOTreasury

```solidity
function deposit(string calldata note) external payable;
function getBalance() external view returns (uint256);
function getTreasuryStats() external view returns (uint256 balance, uint256 disbursed, uint256 deposited);
```

---

## Setup & Installation

### Prerequisites

- Node.js ≥ 18
- npm or yarn
- MetaMask (for frontend)

### Install

```bash
git clone https://github.com/yourorg/microgrant-dao
cd microgrant-dao
npm install
cp .env.example .env
# Fill in your .env values
```

### Compile

```bash
npm run compile
```

---

## Running Tests

```bash
# Run all tests
npm test

# With gas report
npm run test:gas

# Coverage report
npm run coverage
```

**Test Coverage:**
- Token minting & membership
- Proposal creation validation
- Full voting lifecycle (FOR/AGAINST/ABSTAIN)
- Quorum & majority checks
- Timelock enforcement
- Curator flagging
- Admin configuration
- Pause/unpause

---

## Deployment

### Local (Hardhat Node)

```bash
# Terminal 1: Start local node
npm run node

# Terminal 2: Deploy
npm run deploy:local

# Run interaction demo
npm run interact
```

### Sepolia Testnet

```bash
# Make sure .env has SEPOLIA_RPC_URL and PRIVATE_KEY
npm run deploy:sepolia
```

### Verify on Etherscan

```bash
npx hardhat verify --network sepolia DEPLOYED_CONTRACT_ADDRESS constructor_args
```

---

## Governance Parameters

All parameters adjustable by ADMIN_ROLE via governance:

| Parameter | Default | Range | Description |
|---|---|---|---|
| `votingDelay` | 1 day | 1 hour – 7 days | Time before voting opens |
| `votingPeriod` | 5 days | 1 day – 30 days | Duration of voting window |
| `timelockDelay` | 2 days | 1 hour – 14 days | Wait before execution |
| `quorumPercentage` | 10% | 1% – 50% | Minimum participation |
| `maxGrantAmount` | 5 ETH | Unrestricted | Cap per proposal |
| `proposalThreshold` | 10 MGRANT | Unrestricted | Min tokens to propose |

---

## Frontend dApp

```bash
cd frontend
npm install
npm run dev
```

Update `src/App.jsx` with your deployed contract addresses after deployment.

**Features:**
- Connect MetaMask wallet
- Browse all proposals with real-time vote bars
- Submit new grant proposals
- Vote FOR / AGAINST / ABSTAIN
- Activate, finalize, and execute proposals
- Status badges per proposal lifecycle stage

---

## Roles & Permissions

| Role | Who | Permissions |
|---|---|---|
| `DEFAULT_ADMIN` | Deployer / Multisig | Grant/revoke all roles |
| `ADMIN_ROLE` | Deployer / Multisig | Update governance params, pause |
| `CURATOR_ROLE` | Trusted community members | Flag proposals |
| `GOVERNOR_ROLE` (Treasury) | MicroGrantDAO contract | Disburse grants |
| Token Holders | Any MGRANT holder | Propose, vote |

---

## Security

### Implemented Protections

- **ReentrancyGuard** on all state-changing treasury calls
- **Timelock** before execution (allows community to react)
- **Quorum check** prevents low-participation manipulation
- **Token-weighted voting** proportional to stake
- **Curator flagging** for fraud prevention
- **Pausable** emergency stop mechanism
- **AccessControl** role-based permissions
- **Treasury isolation** — only governor can disburse

### Recommendations for Production

- Replace single admin with a **Gnosis Safe multisig**
- Run a **formal audit** before mainnet
- Consider **snapshot-based voting** (vote power at proposal creation block)
- Add **proposal bond** (small ETH/token deposit to deter spam)
- Integrate **Chainlink VRF** for randomized curator assignment
- Use **IPFS pinning** for proposal document permanence

---

## Roadmap

- [x] Core governance lifecycle
- [x] ERC20Votes-based voting
- [x] Timelock execution
- [x] Curator review system
- [x] Treasury management
- [ ] Snapshot-based voting power (ERC20Votes at block)
- [ ] Quadratic voting option
- [ ] Multi-round grants (milestone-based disbursement)
- [ ] On-chain reputation scores for proposers
- [ ] Subgraph indexing for fast frontend queries
- [ ] Mobile-optimized PWA

---

## License

MIT © MicroGrant DAO Contributors
