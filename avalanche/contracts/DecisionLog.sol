// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TimosAI DecisionLog
/// @notice Ajanın karar/emir izini (SignalLedger) zincire sabitler. Değer tutmaz, token çıkarmaz.
contract DecisionLog {
    address public immutable owner;
    string public constant AGENT = "TimosAI";
    uint64 public anchors;

    event Registered(address indexed owner, string agent, string tasks);
    event Decision(string symbol, string side, bytes32 hash, uint64 ts);
    event Anchor(bytes32 indexed head, uint64 count, uint64 ts);
    event Outcome(string symbol, int64 pnlMicroUsdt, bytes32 hash, uint64 ts);

    modifier onlyOwner() {
        require(msg.sender == owner, "yetkisiz");
        _;
    }

    constructor() {
        owner = msg.sender;
        emit Registered(msg.sender, AGENT, "scam-scan,opportunity-scan");
    }

    function logDecision(string calldata symbol, string calldata side, bytes32 hash) external onlyOwner {
        emit Decision(symbol, side, hash, uint64(block.timestamp));
    }

    function anchor(bytes32 head, uint64 count) external onlyOwner {
        anchors += 1;
        emit Anchor(head, count, uint64(block.timestamp));
    }

    function logOutcome(string calldata symbol, int64 pnlMicroUsdt, bytes32 hash) external onlyOwner {
        emit Outcome(symbol, pnlMicroUsdt, hash, uint64(block.timestamp));
    }
}
