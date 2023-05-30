// SPDX-License-Identifier: MIT
pragma solidity =0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import '../oasis/interfaces/IRebateEstimator.sol';

interface Staking {
    function vestedBalance(address account) external view returns (uint256);
}

interface Pricer {
    function getValue(uint256 amount) external view returns (uint256);
}

contract FixedRebate is Ownable, IRebateEstimator {
    struct RebateTier {
        uint256 value;
        uint64 rebate;
    }

    mapping(address => uint64) public rebates;
    address internal rebateOverride;

    constructor() public {
    }

    function getRebate(address account) external override view returns (uint64) {
        if (rebateOverride != address(0)) {
            uint64 value = IRebateEstimator(rebateOverride).getRebate(account);
            if (value != 0) {
                return value;
            }
        }

        return rebates[account];
    }
    function setOwner(address _newOwner) external onlyOwner {
        transferOwnership(_newOwner);
    }

    function setRebateOverride(address _rebateOverride) external onlyOwner {
        rebateOverride = _rebateOverride;
    }

    function setRebates(address[] memory _users, uint64[] memory _rebates) external onlyOwner {
        require(_users.length == _rebates.length, "RebateEstimator: users and rebates arrays must have the same length");
        for (uint256 i = 0; i < _users.length; i++) {
            rebates[_users[i]] = _rebates[i];
        }
    }
}
