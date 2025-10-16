const { ethers } = require("hardhat");

/**
 * Deploy MicroGrant DAO
 * Order: GovernanceToken → DAOTreasury → MicroGrantDAO
 * Then wire them together.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // 1. Deploy Governance Token
  console.log("1. Deploying GovernanceToken...");
  const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
  const token = await GovernanceToken.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("   GovernanceToken deployed at:", tokenAddress);

  // 2. Deploy Treasury (governor address unknown yet — use placeholder, update after)
  console.log("\n2. Deploying DAOTreasury...");
  const DAOTreasury = await ethers.getContractFactory("DAOTreasury");
  // Temporarily use deployer as governor, will update after DAO deployed
  const treasury = await DAOTreasury.deploy(deployer.address, deployer.address);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log("   DAOTreasury deployed at:", treasuryAddress);

  // 3. Deploy MicroGrantDAO
  console.log("\n3. Deploying MicroGrantDAO...");
  const MicroGrantDAO = await ethers.getContractFactory("MicroGrantDAO");
  const dao = await MicroGrantDAO.deploy(tokenAddress, treasuryAddress, deployer.address);
  await dao.waitForDeployment();
  const daoAddress = await dao.getAddress();
  console.log("   MicroGrantDAO deployed at:", daoAddress);

  // 4. Wire: Grant GOVERNOR_ROLE in Treasury to the DAO contract
  console.log("\n4. Granting GOVERNOR_ROLE to DAO in Treasury...");
  const GOVERNOR_ROLE = await treasury.GOVERNOR_ROLE();
  await treasury.grantRole(GOVERNOR_ROLE, daoAddress);
  console.log("   Done.");

  // 5. Seed treasury with initial ETH
  console.log("\n5. Seeding Treasury with 1 ETH...");
  await treasury.deposit("Initial seed", { value: ethers.parseEther("1") });
  console.log("   Treasury balance:", ethers.formatEther(await treasury.getBalance()), "ETH");

  // 6. Delegate tokens for voting (deployer self-delegates)
  console.log("\n6. Self-delegating governance tokens...");
  await token.delegate(deployer.address);
  console.log("   Done.");

  console.log("\n═══════════════════════════════════════════════════");
  console.log("✅  DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════════");
  console.log("GovernanceToken :", tokenAddress);
  console.log("DAOTreasury     :", treasuryAddress);
  console.log("MicroGrantDAO   :", daoAddress);
  console.log("═══════════════════════════════════════════════════");

  // Save addresses for frontend/tests
  const fs = require("fs");
  const addresses = { GovernanceToken: tokenAddress, DAOTreasury: treasuryAddress, MicroGrantDAO: daoAddress };
  fs.writeFileSync("deployed-addresses.json", JSON.stringify(addresses, null, 2));
  console.log("\nAddresses saved to deployed-addresses.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
