import { ethers } from "hardhat";
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  const F = await ethers.getContractFactory("WraithMessages");
  const c = await F.deploy();
  await c.waitForDeployment();
  console.log("WraithMessages deployed to:", await c.getAddress());
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
