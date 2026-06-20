// Copyright (c) 2026.
// SPDX-License-Identifier: Apache-2.0

/// Anchors the verifiable record of each agent action, and gates who can decrypt it.
///
/// This is the proof half of the Avow trust layer, and it is strategy-agnostic on purpose:
/// any money-moving agent can plug in. For every action the agent takes, it builds an
/// evidence bundle off chain (its rationale, the data it paid for, the before and after
/// state, and the on-chain transaction digests), Seal-encrypts it, and stores the ciphertext
/// on Walrus. It then calls `anchor`, which evaluates the action against the mandate and records
/// the Walrus blob id, the content hash, the amount, the action type, and the target on chain as
/// an event, stamped with whether the action stayed inside the limits and, if not, which it broke.
/// Every action the agent anchors is captured, in bounds or not, so the record is a complete,
/// forensic track record. The compliance verdict is computed on chain, so the agent cannot stamp a
/// rule-breaking action as compliant.
///
/// The Move event stays generic. Strategy detail (APYs, prices, routes, receipts) never goes
/// on chain; it lives inside the sealed bundle on Walrus. `action_type` is a free label such
/// as b"yield_move", b"payment", or b"trade", and `target` is whatever the strategy acts on.
///
/// What the anchor proves: every anchored action carries its compliance, judged on chain at the
/// moment it ran, and the sealed bundle has not been altered since (the on-chain hash binds it).
/// What it does not prove on its own: that the agent reported the true amount, or that it anchored
/// every action it took. The mandate holds no funds, so those two are closed off chain by the
/// dashboard, which decrypts the bundle, recomputes the hash, and reconciles the anchored
/// amount against the transaction digests inside it.
///
/// `EvidenceAccess` is the Seal namespace, one per mandate. Its id forms the prefix of every
/// Seal key-id for that mandate's evidence, and `seal_approve` releases a decryption key only
/// to an authorized reader. The cap holder can add auditors so a third party can verify the
/// track record without being trusted with anything else.
module avow::record;

use sui::event;
use sui::vec_set::{Self, VecSet};
use avow::mandate::{Self, Mandate, MandateCap};

// --- Error codes ---
const ENotAuthorized: u64 = 1;
const ENoAccess: u64 = 2;
const EWrongVersion: u64 = 3;
const EAccessMandateMismatch: u64 = 4;
const EBadEvidence: u64 = 5;
const EAlreadyMigrated: u64 = 6;

const VERSION: u64 = 1;

/// SHA-256 digest length in bytes. The anchored evidence hash must be exactly this long.
const HASH_LEN: u64 = 32;

/// The Seal access policy for one mandate's evidence. Shared, and persists so the record
/// stays verifiable over time.
public struct EvidenceAccess has key {
    id: UID,
    version: u64,
    principal: address,
    mandate_id: ID,
    /// Addresses allowed to decrypt the evidence: the cap holder at creation plus any added
    /// auditors.
    readers: VecSet<address>,
}

// --- Events ---
public struct AccessCreated has copy, drop {
    access_id: ID,
    mandate_id: ID,
    principal: address,
}

/// The on-chain anchor for a single action. Reading these events for a mandate reconstructs
/// the agent's full, verifiable track record.
public struct ActionAnchored has copy, drop {
    mandate_id: ID,
    access_id: ID,
    agent: address,
    /// The user this action was taken for. For a single-user agent this is the principal; for
    /// a shared agent it is whichever user the agent served. The evidence is sealed to this
    /// address, so only this user (and global readers) can decrypt the reasoning behind it.
    user: address,
    /// Walrus blob id of the Seal-encrypted evidence bundle.
    blob_id: vector<u8>,
    /// SHA-256 of the plaintext bundle, for the integrity proof.
    evidence_hash: vector<u8>,
    /// Amount moved, in the asset's smallest unit.
    amount: u64,
    /// What kind of action this is, for example b"yield_move", b"payment", b"trade".
    action_type: vector<u8>,
    /// What the action acted on, for example b"navi" or a merchant id. Allowlistable in the
    /// mandate.
    target: vector<u8>,
    epoch: u64,
    /// True if the action stayed inside every mandate limit at the moment it was anchored.
    within_mandate: bool,
    /// Bitmask of the limits it broke, 0 when none: revoked | expired | per-move | daily | target.
    /// Computed on chain, so the agent cannot stamp a rule-breaking action as compliant.
    breaches: u8,
}

public struct AuditorAdded has copy, drop { access_id: ID, auditor: address }

// --- Access policy lifecycle ---

/// Create the Seal namespace for a mandate's evidence and register it on the mandate.
/// Gated by the mandate cap, and callable once per mandate.
public fun create_access(m: &mut Mandate, cap: &MandateCap, ctx: &mut TxContext) {
    mandate::check_cap(m, cap);
    let sender = ctx.sender();

    let mut readers = vec_set::empty<address>();
    readers.insert(sender);

    let access = EvidenceAccess {
        id: object::new(ctx),
        version: VERSION,
        principal: sender,
        mandate_id: mandate::id(m),
        readers,
    };
    let access_id = object::id(&access);
    mandate::register_access(m, access_id);
    event::emit(AccessCreated {
        access_id,
        mandate_id: mandate::id(m),
        principal: sender,
    });
    transfer::share_object(access);
}

/// Grant an auditor read access to this mandate's evidence. Gated by the mandate cap.
public fun add_auditor(access: &mut EvidenceAccess, cap: &MandateCap, auditor: address) {
    assert!(access.version == VERSION, EWrongVersion);
    assert!(mandate::cap_mandate_id(cap) == access.mandate_id, ENotAuthorized);
    if (!access.readers.contains(&auditor)) {
        access.readers.insert(auditor);
    };
    event::emit(AuditorAdded { access_id: object::id(access), auditor });
}

/// Bring an evidence access created by an older package version up to the current layout.
/// Gated by the mandate cap. Decryption itself never depends on the version (see
/// `seal_approve`), so historical evidence stays readable regardless; this only unfreezes
/// anchoring and auditor management after an upgrade.
entry fun migrate_access(access: &mut EvidenceAccess, cap: &MandateCap) {
    assert!(mandate::cap_mandate_id(cap) == access.mandate_id, ENotAuthorized);
    assert!(access.version < VERSION, EAlreadyMigrated);
    access.version = VERSION;
}

// --- Anchor an action ---

/// Evaluate the action against the mandate, then record its evidence anchor on chain, stamped with
/// whether it stayed inside the limits. Callable only by the mandate's agent (the authorization
/// check lives in `evaluate_and_account` and still aborts); a policy breach is recorded, not
/// rejected, so the track record captures everything the agent did, in bounds or not.
public fun anchor(
    m: &mut Mandate,
    access: &EvidenceAccess,
    user: address,
    blob_id: vector<u8>,
    evidence_hash: vector<u8>,
    amount: u64,
    action_type: vector<u8>,
    target: vector<u8>,
    ctx: &TxContext,
) {
    assert!(access.version == VERSION, EWrongVersion);
    // The access must be the one registered for this mandate, so every anchor lands in the
    // single Seal namespace the principal and auditors watch.
    assert!(mandate::registered_access(m).contains(&object::id(access)), EAccessMandateMismatch);
    // Reject empty or malformed evidence so the record cannot point at nothing.
    assert!(!blob_id.is_empty(), EBadEvidence);
    assert!(evidence_hash.length() == HASH_LEN, EBadEvidence);

    // Evaluate against every mandate limit and account the spend. Aborts only if the caller is not
    // the agent; any limit it breaks comes back as a bitmask instead of aborting.
    let breaches = mandate::evaluate_and_account(m, amount, target, ctx);

    event::emit(ActionAnchored {
        mandate_id: mandate::id(m),
        access_id: object::id(access),
        agent: ctx.sender(),
        user,
        blob_id,
        evidence_hash,
        amount,
        action_type,
        target,
        epoch: ctx.epoch(),
        within_mandate: breaches == 0,
        breaches,
    });
}

// --- Seal access policy ---

/// The Seal policy. Key servers dry-run a transaction that calls this function; if it does not
/// abort, the caller is allowed the decryption key. This composes two of Seal's canonical
/// patterns: an access-namespace prefix (the allowlist pattern) wrapping an account-based check
/// (the account_based pattern), so one shared agent can serve many users with full isolation.
///
/// The key-id layout is `[access id][user address][nonce]`. There are two tiers of access:
///   1. Global readers — the principal and any added auditors — decrypt every bundle under this
///      access. This is the owner/developer, plus auditors they explicitly grant.
///   2. Per user — anyone else decrypts only a bundle whose key-id carries their own address.
///      No whitelist transaction is needed: a user's address IS their key, so each user sees
///      only their own reasoning and never another user's.
///
/// There is deliberately no version check here: decrypting historical evidence must keep working
/// across package upgrades, or the track record stops being verifiable.
entry fun seal_approve(id: vector<u8>, access: &EvidenceAccess, ctx: &TxContext) {
    let sender = ctx.sender();
    let prefix = object::id(access).to_bytes();
    // The key-id must live in this access's namespace.
    assert!(has_prefix(id, prefix), ENoAccess);

    // Tier 1: global readers (principal + auditors) see everything under this access.
    if (access.readers.contains(&sender)) {
        return
    };

    // Tier 2: account-based. The bytes right after the namespace prefix are the address the
    // bundle was sealed to; the caller may decrypt only if that address is their own.
    assert!(segment_eq(id, prefix.length(), sender.to_bytes()), ENoAccess);
}

// --- Read-only accessors ---

public fun access_principal(access: &EvidenceAccess): address { access.principal }
public fun access_mandate_id(access: &EvidenceAccess): ID { access.mandate_id }

// --- Internal ---

/// True if `prefix` is a prefix of `id`.
fun has_prefix(id: vector<u8>, prefix: vector<u8>): bool {
    if (prefix.length() > id.length()) {
        return false
    };
    let mut i = 0;
    while (i < prefix.length()) {
        if (prefix[i] != id[i]) {
            return false
        };
        i = i + 1;
    };
    true
}

/// True if `segment` equals the bytes of `word` starting at `offset`. Used to match the
/// per-user address embedded in a key-id right after the access-namespace prefix.
fun segment_eq(word: vector<u8>, offset: u64, segment: vector<u8>): bool {
    if (offset + segment.length() > word.length()) {
        return false
    };
    let mut i = 0;
    while (i < segment.length()) {
        if (word[offset + i] != segment[i]) {
            return false
        };
        i = i + 1;
    };
    true
}
