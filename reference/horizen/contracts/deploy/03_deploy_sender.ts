import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const announcer = await get("ERC5564Announcer");

  await deploy("WraithSender", {
    from: deployer,
    args: [announcer.address],
    log: true,
  });
};

func.tags = ["WraithSender"];
func.dependencies = ["ERC5564Announcer"];
export default func;
