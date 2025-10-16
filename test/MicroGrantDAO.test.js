const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MicroGrant DAO", function () {
  let token, treasury, dao;
  let deployer, member1, member2, member3, grantee, curator;
  const ONE_DAY = 86400;
  const FIVE_DAYS = 5 * ONE_DAY;
  const TWO_DAYS = 2 * ONE_DAY;

  beforeEach(async () => {
    [deployer, member1, member2, member3, grantee, curator] = await ethers.getSigners();

    // Deploy contracts
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    token = await GovernanceToken.deploy(deployer.address);

    const DAOTreasury = await ethers.getContractFactory("DAOTreasury");
    treasury = await DAOTreasury.deploy(deployer.address, deployer.address);

    const MicroGrantDAO = await ethers.getContractFactory("MicroGrantDAO");
    dao = await MicroGrantDAO.deploy(await token.getAddress(), await treasury.getAddress(), deployer.address);

    // Wire: DAO gets governor role
    const GOVERNOR_ROLE = await treasury.GOVERNOR_ROLE();
    await treasury.grantRole(GOVERNOR_ROLE, await dao.getAddress());

    // Grant curator role
    const CURATOR_ROLE = await dao.CURATOR_ROLE();
    await dao.grantRole(CURATOR_ROLE, curator.address);

    // Setup members
    await token.addMember(member1.address);
    await token.addMember(member2.address);
    await token.addMember(member3.address);
    await token.connect(member1).delegate(member1.address);
    await token.connect(member2).delegate(member2.address);
    await token.connect(member3).delegate(member3.address);
    await token.delegate(deployer.address);

    // Seed treasury
    await treasury.deposit("test seed", { value: ethers.parseEther("10") });
  });

  // ── Helpers ──────────────────────────────────────────────────────────────
  async function createProposal(proposer = member1, amount = "0.5") {
    return dao.connect(proposer).createProposal(
      grantee.address,
      ethers.parseEther(amount),
      "Test Grant",
      "Test description",
      "Public Goods",
      "QmTestHash"
    );
  }

  async function fullLifecycle(propId) {
    await time.increase(ONE_DAY);
    await dao.activateVoting(propId);
    await dao.connect(member1).castVote(propId, 1);
    await dao.connect(member2).castVote(propId, 1);
    await dao.connect(deployer).castVote(propId, 1);
    await time.increase(FIVE_DAYS);
    await dao.finalizeProposal(propId);
    await time.increase(TWO_DAYS);
    await dao.executeProposal(propId);
  }

  // ─── Token Tests ─────────────────────────────────────────────────────────
  describe("GovernanceToken", () => {
    it("mints initial tokens to admin", async () => {
      expect(await token.balanceOf(deployer.address)).to.equal(
        ethers.parseEther("1000000")
      );
    });

    it("adds member with 100 tokens", async () => {
      const [, , , , , , newMember] = await ethers.getSigners();
      await token.addMember(newMember.address);
      expect(await token.balanceOf(newMember.address)).to.equal(
        ethers.parseEther("100")
      );
    });

    it("rejects addMember from non-owner", async () => {
      await expect(token.connect(member1).addMember(member2.address))
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Treasury Tests ───────────────────────────────────────────────────────
  describe("DAOTreasury", () => {
    it("accepts deposits and tracks balance", async () => {
      const stats = await treasury.getTreasuryStats();
      expect(stats.balance).to.equal(ethers.parseEther("10"));
    });

    it("rejects disbursement from non-governor", async () => {
      await expect(
        treasury.connect(member1).disburseGrant(grantee.address, ethers.parseEther("1"), 1)
      ).to.be.reverted;
    });
  });

  // ─── Proposal Tests ───────────────────────────────────────────────────────
  describe("Proposal Creation", () => {
    it("creates a proposal successfully", async () => {
      await expect(createProposal()).to.emit(dao, "ProposalCreated");
      const proposal = await dao.getProposal(1);
      expect(proposal.proposer).to.equal(member1.address);
      expect(proposal.recipient).to.equal(grantee.address);
    });

    it("rejects proposal with insufficient tokens", async () => {
      const [, , , , , , noTokenUser] = await ethers.getSigners();
      await expect(createProposal(noTokenUser)).to.be.revertedWith(
        "Insufficient tokens to propose"
      );
    });

    it("rejects proposal exceeding max grant amount", async () => {
      await expect(createProposal(member1, "6")).to.be.revertedWith("Invalid amount");
    });

    it("records proposer history", async () => {
      await createProposal();
      await createProposal();
      const history = await dao.getProposerHistory(member1.address);
      expect(history.length).to.equal(2);
    });
  });

  // ─── Voting Tests ─────────────────────────────────────────────────────────
  describe("Voting", () => {
    let propId;
    beforeEach(async () => {
      await createProposal();
      propId = 1n;
      await time.increase(ONE_DAY);
      await dao.activateVoting(propId);
    });

    it("allows members to vote FOR", async () => {
      await dao.connect(member1).castVote(propId, 1);
      const stats = await dao.getVoteStats(propId);
      expect(stats.forVotes).to.equal(await token.balanceOf(member1.address));
    });

    it("allows members to vote AGAINST", async () => {
      await dao.connect(member1).castVote(propId, 0);
      const stats = await dao.getVoteStats(propId);
      expect(stats.againstVotes).to.be.gt(0);
    });

    it("prevents double voting", async () => {
      await dao.connect(member1).castVote(propId, 1);
      await expect(dao.connect(member1).castVote(propId, 0)).to.be.revertedWith(
        "Already voted"
      );
    });

    it("rejects vote before voting period", async () => {
      await createProposal();
      await expect(dao.connect(member1).castVote(2, 1)).to.be.revertedWith(
        "Proposal not active"
      );
    });
  });

  // ─── Finalization Tests ───────────────────────────────────────────────────
  describe("Finalization", () => {
    it("passes proposal with quorum and majority", async () => {
      await createProposal();
      await time.increase(ONE_DAY);
      await dao.activateVoting(1);
      await dao.connect(member1).castVote(1, 1);
      await dao.connect(member2).castVote(1, 1);
      await dao.connect(deployer).castVote(1, 1);
      await time.increase(FIVE_DAYS);
      await dao.finalizeProposal(1);
      const p = await dao.getProposal(1);
      expect(p.status).to.equal(2); // PASSED
    });

    it("rejects proposal without quorum", async () => {
      await createProposal();
      await time.increase(ONE_DAY);
      await dao.activateVoting(1);
      // Only member1 votes (not enough for 10% quorum)
      await dao.connect(member1).castVote(1, 1);
      await time.increase(FIVE_DAYS);
      await dao.finalizeProposal(1);
      const p = await dao.getProposal(1);
      expect(p.status).to.equal(3); // REJECTED
    });
  });

  // ─── Execution Tests ──────────────────────────────────────────────────────
  describe("Execution", () => {
    it("executes and transfers ETH to grantee", async () => {
      await createProposal();
      const balBefore = await ethers.provider.getBalance(grantee.address);
      await fullLifecycle(1n);
      const balAfter = await ethers.provider.getBalance(grantee.address);
      expect(balAfter - balBefore).to.equal(ethers.parseEther("0.5"));
    });

    it("rejects execution before timelock", async () => {
      await createProposal();
      await time.increase(ONE_DAY);
      await dao.activateVoting(1);
      await dao.connect(member1).castVote(1, 1);
      await dao.connect(deployer).castVote(1, 1);
      await dao.connect(member2).castVote(1, 1);
      await time.increase(FIVE_DAYS);
      await dao.finalizeProposal(1);
      // Don't advance past timelock
      await expect(dao.executeProposal(1)).to.be.revertedWith("Timelock not elapsed");
    });
  });

  // ─── Curator Tests ────────────────────────────────────────────────────────
  describe("Curator", () => {
    it("flags a proposal and prevents activation", async () => {
      await createProposal();
      await dao.connect(curator).flagProposal(1, "Suspicious recipient");
      await time.increase(ONE_DAY);
      await expect(dao.activateVoting(1)).to.be.revertedWith("Proposal flagged by curator");
    });

    it("rejects flag from non-curator", async () => {
      await createProposal();
      await expect(dao.connect(member1).flagProposal(1, "test")).to.be.reverted;
    });
  });

  // ─── Cancellation Tests ───────────────────────────────────────────────────
  describe("Cancellation", () => {
    it("allows proposer to cancel pending proposal", async () => {
      await createProposal();
      await dao.connect(member1).cancelProposal(1);
      const p = await dao.getProposal(1);
      expect(p.status).to.equal(5); // CANCELLED
    });

    it("rejects cancel from unauthorized account", async () => {
      await createProposal();
      await expect(dao.connect(member2).cancelProposal(1)).to.be.revertedWith(
        "Not authorized"
      );
    });
  });

  // ─── Admin Config Tests ───────────────────────────────────────────────────
  describe("Admin Config", () => {
    it("updates voting period", async () => {
      await dao.setVotingPeriod(7 * ONE_DAY);
      expect(await dao.votingPeriod()).to.equal(7 * ONE_DAY);
    });

    it("rejects out-of-range voting period", async () => {
      await expect(dao.setVotingPeriod(31 * ONE_DAY)).to.be.revertedWith("Out of range");
    });

    it("pauses and unpauses the DAO", async () => {
      await dao.pause();
      await expect(createProposal()).to.be.revertedWithCustomError(dao, "EnforcedPause");
      await dao.unpause();
      await expect(createProposal()).to.emit(dao, "ProposalCreated");
    });
  });
});
