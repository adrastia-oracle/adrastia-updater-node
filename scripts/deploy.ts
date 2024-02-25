import { ethers } from "hardhat";

async function deployMulticall2() {
    const factory = await ethers.getContractFactory("Multicall2");
    const contract = await factory.deploy();

    await contract.waitForDeployment();

    console.log("Multicall2 deployed to:", contract.target);
}

async function deployMockAutomationAci() {
    const factory = await ethers.getContractFactory("MockAutomationAci");
    const contract = await factory.deploy();

    await contract.waitForDeployment();

    console.log("MockAutomationAci deployed to:", contract.target);
}

async function main() {
    await deployMulticall2();
    await deployMockAutomationAci();
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
