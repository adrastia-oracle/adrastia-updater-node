import { ethers } from "hardhat";

async function main() {
    const factory = await ethers.getContractFactory("MockAutomationAci");
    const contract = await factory.deploy();

    await contract.waitForDeployment();

    console.log("MockAutomationAci deployed to:", contract.target);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
