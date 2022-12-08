#!/bin/bash
# Note: It's expected that the working directory is the root of the project
source ./services/setup-node.sh
npx hardhat run-oracle-updater --service --every <check-every-x-seconds> --batch <batch-number> --network <network-name>
