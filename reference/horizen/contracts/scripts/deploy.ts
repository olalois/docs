import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  // Deploy ERC5564Announcer
  const Announcer = await ethers.getContractFactory("ERC5564Announcer");
  const announcer = await Announcer.deploy();
  await announcer.waitForDeployment();
  const announcerAddr = await announcer.getAddress();
  console.log("ERC5564Announcer deployed to:", announcerAddr);

  // Deploy ERC6538Registry
  const Registry = await ethers.getContractFactory("ERC6538Registry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("ERC6538Registry deployed to:", registryAddr);

  console.log("\nUpdate packages/web/src/config/contracts.ts with:");
  console.log(`  ANNOUNCER: ${announcerAddr}`);
  console.log(`  REGISTRY:  ${registryAddr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
