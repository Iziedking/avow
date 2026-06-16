// Copyright (c) 2026.
// SPDX-License-Identifier: Apache-2.0

/// Anchors the verifiable record of each agent action, and gates who can decrypt it.
///
/// This is the proof half of the Avow trust layer, and it is strategy-agnostic on purpose:
/// any money-moving agent can plug in. For every action the agent takes, it builds an
/// evidence bundle off chain (its rationale, the data it paid for, the before and after
/// state, and the on-chain transaction digests), Seal-encrypts it, and stores the ciphertext
/// on Walrus. It then calls `anchor`, which checks the action against the mandate and records
/// the Walrus blob id, the content hash, the amount, the action type, and the target on chain
/// as an event. Because `anchor` runs the mandate check, an action whose reported amount or
/// target breaks the mandate cannot produce a valid record.
///
/// The Move event stays generic. Strategy detail (APYs, prices, routes, receipts) never goes
/// on chain; it lives inside the sealed bundle on Walrus. `action_type` is a free label such
/// as b"yield_move", b"payment", or b"trade", and `target` is whatever the strategy acts on.
///
/// What the anchor proves: every anchored action was inside the declared limits, and the
/// sealed bundle has not been altered since (the on-chain hash binds it). What it does not
/// prove on its own: that the agent reported the true amount, or that it anchored every
/// action it took. The mandate holds no funds, so those two are closed off chain by the
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

/// Check the action against the mandate, then record its evidence anchor on chain.
/// Callable only by the mandate's agent; the agent check lives in `check_and_account`.
public fun anchor(
    m: &mut Mandate,
    access: &EvidenceAccess,
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

    // Enforce every mandate limit and account the action. Aborts if out of bounds.
    mandate::check_and_account(m, amount, target, ctx);

    event::emit(ActionAnchored {
        mandate_id: mandate::id(m),
        access_id: object::id(access),
        agent: ctx.sender(),
        blob_id,
        evidence_hash,
        amount,
        action_type,
        target,
        epoch: ctx.epoch(),
    });
}

// --- Seal access policy ---

/// The Seal policy. Key servers dry-run a transaction that calls this function; if it does
/// not abort, the caller is allowed the decryption key. The key-id must be prefixed by this
/// object's id, and the caller must be an authorized reader.
///
/// There is deliberately no version check here: decrypting historical evidence must keep
/// working across package upgrades, or the track record stops being verifiable. The reader
/// set and the key-id prefix are the only gates, and both are enough.
entry fun seal_approve(id: vector<u8>, access: &EvidenceAccess, ctx: &TxContext) {
    let sender = ctx.sender();
    assert!(access.readers.contains(&sender), ENoAccess);
    assert!(has_prefix(id, object::id(access).to_bytes()), ENoAccess);
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
