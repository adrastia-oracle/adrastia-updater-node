import { ethers } from "hardhat";

const CONTRACT_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

const TOKEN = "0x0000000000000000000000000000000000000000";
const DATA = "0x00";

const customRevertInPerform = false;
const stringRevertInPerform = false;
const emptyRevertInPerform = false;
const outOfGasRevertInPerform = false;

async function main() {
    const contract = await ethers.getContractAt("MockAutomationAci", CONTRACT_ADDRESS);

    const performData = await ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [TOKEN, DATA]);

    await contract.orderNewWork(
        performData,
        customRevertInPerform,
        stringRevertInPerform,
        emptyRevertInPerform,
        outOfGasRevertInPerform,
    );

    console.log("Work order sent.");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
