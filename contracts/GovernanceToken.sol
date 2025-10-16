// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GovernanceToken
 * @dev ERC20 token with voting capabilities for the MicroGrant DAO.
 *      Members receive MGRANT tokens to vote on grant proposals.
 */
contract GovernanceToken is ERC20, ERC20Permit, ERC20Votes, Ownable {

    uint256 public constant MAX_SUPPLY = 10_000_000 * 10 ** 18; // 10 million tokens
    uint256 public constant INITIAL_MEMBER_GRANT = 100 * 10 ** 18; // 100 tokens per member

    event MemberAdded(address indexed member, uint256 amount);

    constructor(address initialOwner)
        ERC20("MicroGrant DAO Token", "MGRANT")
        ERC20Permit("MicroGrant DAO Token")
        Ownable(initialOwner)
    {
        // Mint initial supply to deployer for treasury/distribution
        _mint(initialOwner, 1_000_000 * 10 ** 18);
    }

    /**
     * @dev Add a new DAO member with initial voting tokens.
     */
    function addMember(address member) external onlyOwner {
        require(totalSupply() + INITIAL_MEMBER_GRANT <= MAX_SUPPLY, "Max supply exceeded");
        _mint(member, INITIAL_MEMBER_GRANT);
        emit MemberAdded(member, INITIAL_MEMBER_GRANT);
    }

    /**
     * @dev Mint additional tokens (e.g., rewards for active participation).
     */
    function mintReward(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "Max supply exceeded");
        _mint(to, amount);
    }

    // Required overrides
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
