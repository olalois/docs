import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const WraithNames = await ethers.getContractFactory("WraithNames");
  const names = await WraithNames.deploy();
  await names.waitForDeployment();
  const addr = await names.getAddress();
  console.log("WraithNames deployed to:", addr);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
