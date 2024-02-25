// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./AutomationCompatibleInterface.sol";

contract MockAutomationAci is AutomationCompatibleInterface {
    struct Upkeep {
        bool upkeepNeeded;
        bytes performData;
        uint256 orderBlockNumber;
        uint256 fulfillBlockNumber;
        bool customRevertInPerform;
        bool stringRevertInPerform;
        bool emptyRevertInPerform;
        bool outOfGasRevertInPerform;
    }

    mapping(address => Upkeep) public upkeep;

    uint256 internal junk;

    event UpkeepPerformed(bytes performData, uint256 blockDelay);

    error CustomRevertInPerform();

    function orderNewWork(
        bytes calldata performData,
        bool customRevertInPerform,
        bool stringRevertInPerform,
        bool emptyRevertInPerform,
        bool outOfGasRevertInPerform
    ) external {
        address token = abi.decode(performData, (address));

        upkeep[token] = Upkeep({
            upkeepNeeded: true,
            performData: performData,
            orderBlockNumber: block.number,
            fulfillBlockNumber: 0,
            customRevertInPerform: customRevertInPerform,
            stringRevertInPerform: stringRevertInPerform,
            emptyRevertInPerform: emptyRevertInPerform,
            outOfGasRevertInPerform: outOfGasRevertInPerform
        });
    }

    function checkUpkeep(bytes calldata checkData) external view override returns (bool, bytes memory) {
        address token = abi.decode(checkData, (address));

        Upkeep memory _upkeep = upkeep[token];

        return (_upkeep.upkeepNeeded, _upkeep.performData);
    }

    function performUpkeep(bytes calldata petformData) external override {
        address token = abi.decode(petformData, (address));

        Upkeep storage _upkeep = upkeep[token];

        require(keccak256(_upkeep.performData) == keccak256(petformData), "petformData must match");
        require(_upkeep.upkeepNeeded, "no upkeep needed");
        require(_upkeep.fulfillBlockNumber == 0, "upkeep already fulfilled");
        if (_upkeep.customRevertInPerform) revert CustomRevertInPerform();
        require(!_upkeep.stringRevertInPerform, "string revert in perform");
        require(!_upkeep.emptyRevertInPerform);

        if (_upkeep.outOfGasRevertInPerform) {
            for (uint i = 0; i < type(uint256).max; i++) {
                junk = i;
            }
        }

        _upkeep.upkeepNeeded = false;
        _upkeep.fulfillBlockNumber = block.number;

        emit UpkeepPerformed(petformData, _upkeep.fulfillBlockNumber - _upkeep.orderBlockNumber);
    }
}
