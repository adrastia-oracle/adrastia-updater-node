// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./AutomationCompatibleInterface.sol";

contract MockAutomationAci is AutomationCompatibleInterface {
    struct Upkeep {
        bool upkeepNeeded;
        bytes performData;
        uint256 orderBlockNumber;
        uint256 fulfillBlockNumber;
    }

    Upkeep public upkeep;

    event UpkeepPerformed(bytes performData, uint256 blockDelay);
    
    function orderNewWork(bytes calldata performData) external {
        upkeep = Upkeep({
            upkeepNeeded: true,
            performData: performData,
            orderBlockNumber: block.number,
            fulfillBlockNumber: 0
        });
    }
    
    function checkUpkeep(bytes calldata) external view override returns (bool, bytes memory) {
        Upkeep memory _upkeep = upkeep;

        return (_upkeep.upkeepNeeded, _upkeep.performData);
    }
    
    function performUpkeep(bytes calldata petformData) external override {
        Upkeep storage _upkeep = upkeep;

        require(keccak256(_upkeep.performData) == keccak256(petformData), "petformData must match");
        require(_upkeep.upkeepNeeded, "no upkeep needed");
        require(_upkeep.fulfillBlockNumber == 0, "upkeep already fulfilled");

        _upkeep.upkeepNeeded = false;
        _upkeep.fulfillBlockNumber = block.number;

        emit UpkeepPerformed(petformData, _upkeep.fulfillBlockNumber - _upkeep.orderBlockNumber);
    }
}