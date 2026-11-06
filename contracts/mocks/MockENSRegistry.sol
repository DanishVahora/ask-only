// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title  MockENSRegistry
 * @notice A stand-in for the ENSv2 PermissionedRegistry, for tests and for the
 *         writable half of the demo.
 *
 *         It deliberately replicates TWO behaviours of the real
 *         EnhancedAccessControl, because a mock that is more permissive than the
 *         real thing lets tests pass on inputs production would reject:
 *
 *         1. ALL_ROLES VALIDATION. Every bitmap is checked against
 *            0x1111...1111 (64 ones) and rejected if any bit outside a nybble's
 *            low bit is set. Without this, a test would happily accept
 *            `0xF << 40` as a "level 15" and the live registry would revert
 *            EACInvalidRoleBitmap at the worst possible moment.
 *
 *         2. ROOT-OR SEMANTICS. A role held on ROOT_RESOURCE (id 0) counts for
 *            every resource, so `hasRoles` ORs the root grant with the
 *            per-resource grant exactly as the real registry does.
 */
contract MockENSRegistry {
    uint256 public constant ROOT_RESOURCE = 0;

    uint256 public constant ALL_ROLES =
        0x1111111111111111111111111111111111111111111111111111111111111111;

    /// resource id => account => role bitmap
    mapping(uint256 => mapping(address => uint256)) public roles;

    error EACInvalidRoleBitmap(uint256 roleBitmap);

    event RolesGranted(uint256 indexed anyId, uint256 roleBitmap, address indexed account);
    event RolesRevoked(uint256 indexed anyId, uint256 roleBitmap, address indexed account);

    function _validate(uint256 roleBitmap) internal pure {
        if (roleBitmap & ~ALL_ROLES != 0) revert EACInvalidRoleBitmap(roleBitmap);
    }

    function grantRoles(uint256 anyId, uint256 roleBitmap, address account)
        external
        returns (bool)
    {
        _validate(roleBitmap);
        roles[anyId][account] |= roleBitmap;
        emit RolesGranted(anyId, roleBitmap, account);
        return true;
    }

    function revokeRoles(uint256 anyId, uint256 roleBitmap, address account)
        external
        returns (bool)
    {
        _validate(roleBitmap);
        roles[anyId][account] &= ~roleBitmap;
        emit RolesRevoked(anyId, roleBitmap, account);
        return true;
    }

    function hasRoles(uint256 anyId, uint256 roleBitmap, address account)
        external
        view
        returns (bool)
    {
        _validate(roleBitmap);
        uint256 effective = roles[ROOT_RESOURCE][account] | roles[anyId][account];
        return effective & roleBitmap == roleBitmap;
    }
}
