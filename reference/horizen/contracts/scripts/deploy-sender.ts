import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // Announcer address on Horizen Testnet
  const announcerAddress = "0x8AE65c05E7eb48B9bA652781Bc0a3DBA09A484F3";

  const WraithSender = await ethers.getContractFactory("WraithSender");
  const sender = await WraithSender.deploy(announcerAddress);
  await sender.waitForDeployment();
  const senderAddr = await sender.getAddress();
  console.log("WraithSender deployed to:", senderAddr);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
