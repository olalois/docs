import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const WraithWithdrawer = await ethers.getContractFactory("WraithWithdrawer");
  const withdrawer = await WraithWithdrawer.deploy();
  await withdrawer.waitForDeployment();
  const addr = await withdrawer.getAddress();
  console.log("WraithWithdrawer deployed to:", addr);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
