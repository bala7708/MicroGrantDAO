// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DAOTreasury
 * @dev Manages ETH and token funds for the MicroGrant DAO.
 *      Only the Governor contract can authorize disbursements.
 */
contract DAOTreasury is AccessControl, ReentrancyGuard {

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");

    uint256 public totalDisbursed;
    uint256 public totalDeposited;

    event FundsDeposited(address indexed from, uint256 amount, string note);
    event GrantDisbursed(address indexed recipient, uint256 amount, uint256 proposalId);
    event EmergencyWithdraw(address indexed to, uint256 amount);

    constructor(address admin, address governor) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, governor);
        _grantRole(TREASURER_ROLE, admin);
    }

    receive() external payable {
        totalDeposited += msg.value;
        emit FundsDeposited(msg.sender, msg.value, "Direct deposit");
    }

    /**
     * @dev Deposit funds with a note (e.g., sponsorship, donation round).
     */
    function deposit(string calldata note) external payable {
        require(msg.value > 0, "Must send ETH");
        totalDeposited += msg.value;
        emit FundsDeposited(msg.sender, msg.value, note);
    }

    /**
     * @dev Disburse grant to recipient. Called by Governor after proposal passes.
     */
    function disburseGrant(
        address payable recipient,
        uint256 amount,
        uint256 proposalId
    ) external onlyRole(GOVERNOR_ROLE) nonReentrant {
        require(address(this).balance >= amount, "Insufficient treasury funds");
        require(recipient != address(0), "Invalid recipient");

        totalDisbursed += amount;
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Transfer failed");

        emit GrantDisbursed(recipient, amount, proposalId);
    }

    /**
     * @dev Emergency withdrawal by admin (multisig in production).
     */
    function emergencyWithdraw(address payable to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(address(this).balance >= amount, "Insufficient balance");
        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer failed");
        emit EmergencyWithdraw(to, amount);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getTreasuryStats() external view returns (
        uint256 balance,
        uint256 disbursed,
        uint256 deposited
    ) {
        return (address(this).balance, totalDisbursed, totalDeposited);
    }
}
