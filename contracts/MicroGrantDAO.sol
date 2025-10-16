// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./GovernanceToken.sol";
import "./DAOTreasury.sol";

/**
 * @title MicroGrantDAO
 * @dev Core governance contract for the Decentralized Micro-Grant DAO.
 *
 * LIFECYCLE:
 *   1. Anyone with enough tokens submits a grant proposal
 *   2. Proposal enters REVIEW period (curators can flag/approve)
 *   3. Voting period opens — MGRANT holders vote
 *   4. If quorum + majority reached → PASSED, else REJECTED
 *   5. Passed proposals enter timelock before execution
 *   6. Anyone can execute after timelock → Treasury sends ETH to grantee
 */
contract MicroGrantDAO is AccessControl, ReentrancyGuard, Pausable {

    // ─── Roles ───────────────────────────────────────────────────────────────
    bytes32 public constant CURATOR_ROLE = keccak256("CURATOR_ROLE");
    bytes32 public constant ADMIN_ROLE   = keccak256("ADMIN_ROLE");

    // ─── Config (adjustable via admin) ───────────────────────────────────────
    uint256 public votingDelay        = 1 days;
    uint256 public votingPeriod       = 5 days;
    uint256 public timelockDelay      = 2 days;
    uint256 public proposalThreshold  = 10 * 10 ** 18;
    uint256 public quorumPercentage   = 10;
    uint256 public maxGrantAmount     = 5 ether;

    // ─── State ───────────────────────────────────────────────────────────────
    GovernanceToken public immutable token;
    DAOTreasury     public immutable treasury;
    uint256 public proposalCount;

    enum ProposalStatus {
        PENDING,
        ACTIVE,
        PASSED,
        REJECTED,
        EXECUTED,
        CANCELLED
    }

    enum VoteChoice { AGAINST, FOR, ABSTAIN }

    // String metadata in a sub-struct to avoid stack-too-deep
    struct ProposalMeta {
        string title;
        string description;
        string category;
        string ipfsHash;
    }

    struct Proposal {
        uint256         id;
        address         proposer;
        address payable recipient;
        uint256         amount;
        uint256         createdAt;
        uint256         voteStart;
        uint256         voteEnd;
        uint256         executionTime;
        uint256         forVotes;
        uint256         againstVotes;
        uint256         abstainVotes;
        ProposalStatus  status;
        bool            flaggedByCurator;
        ProposalMeta    meta;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool))       public hasVoted;
    mapping(uint256 => mapping(address => VoteChoice)) public voteRecord;
    mapping(address => uint256[])                       public proposerHistory;

    // ─── Events ──────────────────────────────────────────────────────────────
    event ProposalCreated(uint256 indexed id, address indexed proposer, address recipient, uint256 amount, string title, string category);
    event ProposalActivated(uint256 indexed id, uint256 voteStart, uint256 voteEnd);
    event VoteCast(uint256 indexed proposalId, address indexed voter, VoteChoice choice, uint256 weight);
    event ProposalFinalized(uint256 indexed id, ProposalStatus status);
    event ProposalExecuted(uint256 indexed id, address recipient, uint256 amount);
    event ProposalCancelled(uint256 indexed id, address cancelledBy);
    event ProposalFlagged(uint256 indexed id, address curator, string reason);
    event ConfigUpdated(string param, uint256 newValue);

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(address _token, address payable _treasury, address admin) {
        token    = GovernanceToken(_token);
        treasury = DAOTreasury(_treasury);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(CURATOR_ROLE, admin);
    }

    // ─── Proposal Lifecycle ──────────────────────────────────────────────────

    function createProposal(
        address payable recipient,
        uint256 amount,
        string calldata title,
        string calldata description,
        string calldata category,
        string calldata ipfsHash
    ) external whenNotPaused returns (uint256) {
        require(token.balanceOf(msg.sender) >= proposalThreshold, "Insufficient tokens to propose");
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0 && amount <= maxGrantAmount, "Invalid amount");
        require(bytes(title).length > 0 && bytes(title).length <= 100, "Invalid title length");
        require(bytes(description).length <= 500, "Description too long");
        require(amount <= treasury.getBalance(), "Insufficient treasury funds");

        uint256 id        = ++proposalCount;
        uint256 voteStart = block.timestamp + votingDelay;
        uint256 voteEnd   = voteStart + votingPeriod;

        Proposal storage p = proposals[id];
        p.id               = id;
        p.proposer         = msg.sender;
        p.recipient        = recipient;
        p.amount           = amount;
        p.createdAt        = block.timestamp;
        p.voteStart        = voteStart;
        p.voteEnd          = voteEnd;
        p.executionTime    = voteEnd + timelockDelay;
        p.status           = ProposalStatus.PENDING;
        p.flaggedByCurator = false;
        p.meta.title       = title;
        p.meta.description = description;
        p.meta.category    = category;
        p.meta.ipfsHash    = ipfsHash;

        proposerHistory[msg.sender].push(id);
        emit ProposalCreated(id, msg.sender, recipient, amount, title, category);
        return id;
    }

    function activateVoting(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.PENDING, "Not pending");
        require(!p.flaggedByCurator, "Proposal flagged by curator");
        require(block.timestamp >= p.voteStart, "Voting delay not elapsed");
        p.status = ProposalStatus.ACTIVE;
        emit ProposalActivated(proposalId, p.voteStart, p.voteEnd);
    }

    function castVote(uint256 proposalId, VoteChoice choice) external whenNotPaused {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.ACTIVE, "Proposal not active");
        require(block.timestamp >= p.voteStart && block.timestamp <= p.voteEnd, "Not in voting window");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        uint256 weight = token.balanceOf(msg.sender);
        require(weight > 0, "No voting power");

        hasVoted[proposalId][msg.sender]   = true;
        voteRecord[proposalId][msg.sender] = choice;

        if      (choice == VoteChoice.FOR)     p.forVotes     += weight;
        else if (choice == VoteChoice.AGAINST) p.againstVotes += weight;
        else                                   p.abstainVotes += weight;

        emit VoteCast(proposalId, msg.sender, choice, weight);
    }

    function finalizeProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.ACTIVE, "Not active");
        require(block.timestamp > p.voteEnd, "Voting still ongoing");

        uint256 totalVotes   = p.forVotes + p.againstVotes + p.abstainVotes;
        uint256 quorumNeeded = (token.totalSupply() * quorumPercentage) / 100;
        bool quorumMet       = totalVotes >= quorumNeeded;
        bool majorityMet     = p.forVotes > p.againstVotes;

        p.status = (quorumMet && majorityMet) ? ProposalStatus.PASSED : ProposalStatus.REJECTED;
        emit ProposalFinalized(proposalId, p.status);
    }

    function executeProposal(uint256 proposalId) external nonReentrant whenNotPaused {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.PASSED, "Proposal not passed");
        require(block.timestamp >= p.executionTime, "Timelock not elapsed");
        require(p.amount <= treasury.getBalance(), "Treasury insufficient");

        p.status = ProposalStatus.EXECUTED;
        treasury.disburseGrant(p.recipient, p.amount, proposalId);
        emit ProposalExecuted(proposalId, p.recipient, p.amount);
    }

    function cancelProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.proposer == msg.sender || hasRole(CURATOR_ROLE, msg.sender), "Not authorized");
        require(p.status == ProposalStatus.PENDING || p.status == ProposalStatus.ACTIVE, "Cannot cancel");
        p.status = ProposalStatus.CANCELLED;
        emit ProposalCancelled(proposalId, msg.sender);
    }

    function flagProposal(uint256 proposalId, string calldata reason) external onlyRole(CURATOR_ROLE) {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.PENDING, "Can only flag pending proposals");
        p.flaggedByCurator = true;
        emit ProposalFlagged(proposalId, msg.sender, reason);
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function getVoteStats(uint256 proposalId) external view returns (
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes,
        uint256 totalVotes,
        uint256 quorumNeeded,
        bool    quorumReached
    ) {
        Proposal storage p = proposals[proposalId];
        forVotes      = p.forVotes;
        againstVotes  = p.againstVotes;
        abstainVotes  = p.abstainVotes;
        totalVotes    = forVotes + againstVotes + abstainVotes;
        quorumNeeded  = (token.totalSupply() * quorumPercentage) / 100;
        quorumReached = totalVotes >= quorumNeeded;
    }

    function getProposalMeta(uint256 proposalId) external view returns (ProposalMeta memory) {
        return proposals[proposalId].meta;
    }

    function getProposerHistory(address proposer) external view returns (uint256[] memory) {
        return proposerHistory[proposer];
    }

    // ─── Admin: Config Updates ────────────────────────────────────────────────

    function setVotingDelay(uint256 _delay) external onlyRole(ADMIN_ROLE) {
        require(_delay >= 1 hours && _delay <= 7 days, "Out of range");
        votingDelay = _delay;
        emit ConfigUpdated("votingDelay", _delay);
    }

    function setVotingPeriod(uint256 _period) external onlyRole(ADMIN_ROLE) {
        require(_period >= 1 days && _period <= 30 days, "Out of range");
        votingPeriod = _period;
        emit ConfigUpdated("votingPeriod", _period);
    }

    function setTimelockDelay(uint256 _delay) external onlyRole(ADMIN_ROLE) {
        require(_delay >= 1 hours && _delay <= 14 days, "Out of range");
        timelockDelay = _delay;
        emit ConfigUpdated("timelockDelay", _delay);
    }

    function setQuorumPercentage(uint256 _quorum) external onlyRole(ADMIN_ROLE) {
        require(_quorum >= 1 && _quorum <= 50, "Out of range");
        quorumPercentage = _quorum;
        emit ConfigUpdated("quorumPercentage", _quorum);
    }

    function setMaxGrantAmount(uint256 _max) external onlyRole(ADMIN_ROLE) {
        require(_max > 0, "Must be positive");
        maxGrantAmount = _max;
        emit ConfigUpdated("maxGrantAmount", _max);
    }

    function setProposalThreshold(uint256 _threshold) external onlyRole(ADMIN_ROLE) {
        proposalThreshold = _threshold;
        emit ConfigUpdated("proposalThreshold", _threshold);
    }

    function pause()   external onlyRole(ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(ADMIN_ROLE) { _unpause(); }
}
