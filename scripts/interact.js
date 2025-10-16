/**
 * interact.js — Common DAO operations CLI helper
 * Usage: npx hardhat run scripts/interact.js --network <network>
 */
const { ethers } = require("hardhat");
const addresses = require("../deployed-addresses.json");

async function main() {
  const [deployer, member1, member2, grantee] = await ethers.getSigners();

  const token   = await ethers.getContractAt("GovernanceToken",  addresses.GovernanceToken);
  const dao     = await ethers.getContractAt("MicroGrantDAO",    addresses.MicroGrantDAO);
  const treasury = await ethers.getContractAt("DAOTreasury",     addresses.DAOTreasury);

  console.log("=== MicroGrant DAO Interaction Demo ===\n");

  // ── Step 1: Add Members ─────────────────────────────────────────────────
  console.log("STEP 1: Onboarding members...");
  await token.addMember(member1.address);
  await token.addMember(member2.address);
  console.log(`  member1 balance: ${ethers.formatEther(await token.balanceOf(member1.address))} MGRANT`);
  console.log(`  member2 balance: ${ethers.formatEther(await token.balanceOf(member2.address))} MGRANT`);

  // Members must self-delegate to activate voting power
  await token.connect(member1).delegate(member1.address);
  await token.connect(member2).delegate(member2.address);
  console.log("  Voting power delegated.\n");

  // ── Step 2: Create Proposal ─────────────────────────────────────────────
  console.log("STEP 2: Creating grant proposal...");
  const tx = await dao.connect(member1).createProposal(
    grantee.address,
    ethers.parseEther("0.5"),
    "Open Source Dev Tools",
    "Fund development of open-source Solidity testing utilities",
    "Public Goods",
    "QmSomeIpfsHashHere123"
  );
  const receipt = await tx.wait();
  const event   = receipt.logs.find(l => l.fragment?.name === "ProposalCreated");
  const propId  = event?.args?.id || 1n;
  console.log(`  Proposal #${propId} created!\n`);

  // ── Step 3: Advance time (local only) ──────────────────────────────────
  console.log("STEP 3: Fast-forwarding past voting delay...");
  await ethers.provider.send("evm_increaseTime", [86400]); // 1 day
  await ethers.provider.send("evm_mine");
  await dao.activateVoting(propId);
  console.log("  Voting activated!\n");

  // ── Step 4: Vote ────────────────────────────────────────────────────────
  console.log("STEP 4: Casting votes...");
  await dao.connect(member1).castVote(propId, 1); // FOR
  await dao.connect(member2).castVote(propId, 1); // FOR
  await dao.connect(deployer).castVote(propId, 1); // FOR
  const stats = await dao.getVoteStats(propId);
  console.log(`  FOR: ${ethers.formatEther(stats.forVotes)} | AGAINST: ${ethers.formatEther(stats.againstVotes)}`);
  console.log(`  Quorum needed: ${ethers.formatEther(stats.quorumNeeded)} | Reached: ${stats.quorumReached}\n`);

  // ── Step 5: End voting + Finalize ───────────────────────────────────────
  console.log("STEP 5: Finalizing proposal...");
  await ethers.provider.send("evm_increaseTime", [5 * 86400]); // 5 days
  await ethers.provider.send("evm_mine");
  await dao.finalizeProposal(propId);
  const proposal = await dao.getProposal(propId);
  console.log(`  Status: ${["PENDING","ACTIVE","PASSED","REJECTED","EXECUTED","CANCELLED"][proposal.status]}\n`);

  // ── Step 6: Execute after timelock ─────────────────────────────────────
  console.log("STEP 6: Executing after timelock...");
  await ethers.provider.send("evm_increaseTime", [2 * 86400]); // 2 days
  await ethers.provider.send("evm_mine");
  const granteeBalBefore = await ethers.provider.getBalance(grantee.address);
  await dao.executeProposal(propId);
  const granteeBalAfter = await ethers.provider.getBalance(grantee.address);
  console.log(`  Grantee received: ${ethers.formatEther(granteeBalAfter - granteeBalBefore)} ETH`);
  console.log("\n✅ Full proposal lifecycle complete!");
}

main().catch(console.error);
