import { ethers } from "hardhat";

const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const PERFORM_DATA = "0x00";

async function main() {
    const contract = await ethers.getContractAt("MockAutomationAci", CONTRACT_ADDRESS);

    await contract.orderNewWork(PERFORM_DATA);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
