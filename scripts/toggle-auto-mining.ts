import { network } from "hardhat";

async function main() {
    const isAutoMining = await network.provider.send("hardhat_getAutomine");

    console.log("Auto mining is " + (isAutoMining ? "enabled" : "disabled"));

    console.log("Toggling auto mining...");

    await network.provider.send("evm_setAutomine", [!isAutoMining]);

    const isAutoMiningAfter = await network.provider.send("hardhat_getAutomine");

    console.log("Auto mining is now " + (isAutoMiningAfter ? "enabled" : "disabled"));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
