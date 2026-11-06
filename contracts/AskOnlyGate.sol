// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title  AskOnlyGate
 * @notice The authorization point for AskOnly.
 *
 *         AskOnly splits a permission into two questions that are answered by two
 *         different systems, each doing the thing only it can do:
 *
 *           ENSv2  answers WHO may ask WHAT   - an on-chain role bitmap on a name.
 *           Arkiv  answers UNTIL WHEN         - an entity whose expiry is enforced
 *                                               by the network, not by a flag.
 *
 *         This contract is the first half. It holds no permissions of its own: it
 *         translates a question-set into an ENSv2 EnhancedAccessControl role bit
 *         and asks the registry. If the registry says no, the question is refused
 *         before anything touches the owner's document.
 *
 *         Nothing here is cosmetic. `mayAsk` is called on every single ask, and a
 *         `false` from it is the refusal the verifier sees on screen.
 */

/**
 * @notice The ENSv2 PermissionedRegistry surface we depend on (EnhancedAccessControl).
 *
 *         VERIFIED against the live Sepolia deployment on 2026-11-06.
 *
 *         The first parameter is a **uint256**, not a bytes32. This matters more
 *         than it looks: with `bytes32` the call still compiles, still encodes, and
 *         then reverts in a way that reads like a permissions failure rather than an
 *         ABI mismatch. That is an expensive hour if you trust the type.
 */
interface IPermissionedRegistry {
    function hasRoles(uint256 anyId, uint256 roleBitmap, address account)
        external
        view
        returns (bool);
}

contract AskOnlyGate {
    /// @notice The ENSv2 registry this gate trusts. Set once, never mutable.
    IPermissionedRegistry public immutable ens;

    /// @notice Who may change the question-set table.
    address public immutable steward;

    /**
     * @notice Question-set role bits.
     *
     *         A nybble in EnhancedAccessControl is a BOOLEAN, not a 0-15 level.
     *         Every bitmap is validated against ALL_ROLES = 0x1111...1111 (64 ones)
     *         and reverts EACInvalidRoleBitmap if any bit outside a nybble's low bit
     *         is set. So `1 << 40` is legal and `0xF << 40` is rejected outright -
     *         four question-sets means four separate nybbles, never one 4-bit counter.
     *
     *         ENS itself occupies nybbles 0-6, 8, 9, 30 and 31. Nybbles 7 and 10-29
     *         are free, so AskOnly takes 10-13.
     */
    uint256 public constant ROLE_ASK_INCOME = 1 << 40; // nybble 10
    uint256 public constant ROLE_ASK_IDENTITY = 1 << 44; // nybble 11
    uint256 public constant ROLE_ASK_TENANCY = 1 << 48; // nybble 12
    uint256 public constant ROLE_ASK_EMPLOYMENT = 1 << 52; // nybble 13

    /// @notice The same validation mask the live registry applies.
    uint256 public constant ALL_ROLES =
        0x1111111111111111111111111111111111111111111111111111111111111111;

    /// @notice questionSet (keccak of its name) -> required role bit.
    mapping(bytes32 => uint256) public roleForSet;

    error UnknownQuestionSet(bytes32 questionSet);
    error InvalidRoleBitmap(uint256 roleBitmap);
    error NotSteward(address caller);
    error NotPermitted(address asker, uint256 labelId, bytes32 questionSet);

    event QuestionSetMapped(bytes32 indexed questionSet, uint256 roleBit);
    event AskRefused(address indexed asker, uint256 indexed labelId, bytes32 indexed questionSet);

    constructor(IPermissionedRegistry _ens, address _steward) {
        ens = _ens;
        steward = _steward;

        _map("income", ROLE_ASK_INCOME);
        _map("identity", ROLE_ASK_IDENTITY);
        _map("tenancy", ROLE_ASK_TENANCY);
        _map("employment", ROLE_ASK_EMPLOYMENT);
    }

    function _map(string memory name, uint256 roleBit) internal {
        bytes32 id = keccak256(bytes(name));
        // Refuse at deploy time to store a bitmap the live registry would reject,
        // rather than discovering it mid-demo as an opaque revert.
        if (roleBit & ~ALL_ROLES != 0) revert InvalidRoleBitmap(roleBit);
        roleForSet[id] = roleBit;
        emit QuestionSetMapped(id, roleBit);
    }

    /// @notice Add or re-point a question-set. Steward only.
    function mapQuestionSet(string calldata name, uint256 roleBit) external {
        if (msg.sender != steward) revert NotSteward(msg.sender);
        _map(name, roleBit);
    }

    /// @notice Is this bitmap one the registry will accept at all?
    function isLegalRoleBitmap(uint256 roleBitmap) public pure returns (bool) {
        return roleBitmap & ~ALL_ROLES == 0;
    }

    function roleOf(string calldata questionSet) external view returns (uint256) {
        return roleForSet[keccak256(bytes(questionSet))];
    }

    /**
     * @notice The whole point. May `asker` ask a question from `questionSet`
     *         about the name identified by `labelId`?
     *
     *         `labelId` is a labelhash of ONE label cast to uint256 -
     *         `uint256(keccak256(bytes(label)))` - not a namehash. `0` is the EAC
     *         ROOT_RESOURCE, which the registry treats as granting across all names.
     *
     * @dev    A view, so the UI can refuse a question without spending anything.
     */
    function mayAsk(address asker, uint256 labelId, bytes32 questionSet)
        public
        view
        returns (bool)
    {
        uint256 roleBit = roleForSet[questionSet];
        if (roleBit == 0) revert UnknownQuestionSet(questionSet);
        return ens.hasRoles(labelId, roleBit, asker);
    }

    /// @notice String convenience form of {mayAsk}.
    function mayAskSet(address asker, uint256 labelId, string calldata questionSet)
        external
        view
        returns (bool)
    {
        return mayAsk(asker, labelId, keccak256(bytes(questionSet)));
    }

    /**
     * @notice Reverting form, for a caller that wants the refusal to be terminal.
     *         Named so the revert reason is legible in a wallet: the verifier
     *         should be able to see WHY they were refused, not just that they were.
     */
    function requireMayAsk(address asker, uint256 labelId, bytes32 questionSet) external view {
        if (!mayAsk(asker, labelId, questionSet)) {
            revert NotPermitted(asker, labelId, questionSet);
        }
    }

    /**
     * @notice Which of the four sets may this address ask about this name?
     *         One call instead of four, so the verifier UI can show the whole
     *         permission surface without four round trips.
     */
    function permittedSets(address asker, uint256 labelId)
        external
        view
        returns (bool income, bool identity, bool tenancy, bool employment)
    {
        income = ens.hasRoles(labelId, ROLE_ASK_INCOME, asker);
        identity = ens.hasRoles(labelId, ROLE_ASK_IDENTITY, asker);
        tenancy = ens.hasRoles(labelId, ROLE_ASK_TENANCY, asker);
        employment = ens.hasRoles(labelId, ROLE_ASK_EMPLOYMENT, asker);
    }

    /// @notice Convenience for callers that have a label string rather than a hash.
    function labelIdOf(string calldata label) external pure returns (uint256) {
        return uint256(keccak256(bytes(label)));
    }
}
