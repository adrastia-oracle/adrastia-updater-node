import { ethers } from "hardhat";

const CONTRACT_ADDRESS = "0x067f1B281E8bc66c9CC9D7922120f753FC25B10c";

const TOKEN = "0x0000000000000000000000000000000000000000";
const DATA = "0x00";

async function main() {
    const contract = await ethers.getContractAt("MockAutomationAci", CONTRACT_ADDRESS);

    const performData = await ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [TOKEN, DATA]);

    await contract.orderNewWork(performData);

    console.log("Work order sent.");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
