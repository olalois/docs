import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  await deploy("WraithWithdrawer", {
    from: deployer,
    args: [],
    log: true,
  });
};

func.tags = ["WraithWithdrawer"];
export default func;
