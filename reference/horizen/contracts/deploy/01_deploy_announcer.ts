import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  await deploy("ERC5564Announcer", {
    from: deployer,
    args: [],
    log: true,
  });
};

func.tags = ["ERC5564Announcer"];
export default func;
