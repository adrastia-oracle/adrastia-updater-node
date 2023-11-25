import { network } from "hardhat";

const intervalMs = 120_000;

async function main() {
    await network.provider.send("evm_setIntervalMining", [intervalMs]);

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
