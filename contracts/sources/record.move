// Copyright (c) 2026.
// SPDX-License-Identifier: Apache-2.0

/// Anchors the verifiable record of each yield move, and gates who can decrypt it.
///
/// For every move the agent makes, it builds an evidence bundle off chain (the rates it
/// saw, the data it paid for, its rationale, the before and after position, and the Sui
/// transaction digests), Seal-encrypts it, and stores the ciphertext on Walrus. It then
/// calls `anchor`, which checks the move against the mandate and records the Walrus blob
/// id, the content hash, and the headline numbers on chain as an event. Because `anchor`
/// runs the mandate check, an out-of-bounds move cannot produce a valid record.
///
/// `EvidenceAccess` is the Seal namespace, one per mandate. Its id forms the prefix of
/// every Seal key-id for that mandate's evidence, and `seal_approve` releases a decryption
/// key only to an authorized reader. The principal can add auditors so a third party can
/// verify the track record without being trusted with anything else.
module avow::record;

use sui::event;
use sui::vec_set::{Self, VecSet};
use avow::mandate::{Self, Mandate};

// --- Error codes ---
const ENotPrincipal: u64 = 1;
const ENoAccess: u64 = 2;
const EWrongVersion: u64 = 3;
const EAccessMandateMismatch: u64 = 4;

const VERSION: u64 = 1;

/// The Seal access policy for one mandate's evidence. Shared, and persists so the record
/// stays verifiable over time.
public struct EvidenceAccess has key {
    id: UID,
    version: u64,
    principal: address,
    mandate_id: ID,
    /// Addresses allowed to decrypt the evidence: the principal plus any added auditors.
    readers: VecSet<address>,
}

// --- Events ---
public struct AccessCreated has copy, drop {
    access_id: ID,
    mandate_id: ID,
    principal: address,
}

/// The on-chain anchor for a single move. Reading these events for a mandate reconstructs
/// the agent's full, verifiable track record.
public struct MoveAnchored has copy, drop {
    mandate_id: ID,
    access_id: ID,
    agent: address,
    /// Walrus blob id of the Seal-encrypted evidence bundle.
    blob_id: vector<u8>,
    /// SHA-256 of the plaintext bundle, for the integrity proof.
    evidence_hash: vector<u8>,
    /// Yield before and after the move, in basis points.
    from_apy_bps: u64,
    to_apy_bps: u64,
    /// Amount moved, in the stablecoin's smallest unit.
    amount: u64,
    /// Protocol acted on, for example b"navi".
    protocol: vector<u8>,
    epoch: u64,
}

public struct AuditorAdded has copy, drop { access_id: ID, auditor: address }

// --- Access policy lifecycle ---

/// The principal creates the Seal namespace for a mandate's evidence.
public fun create_access(m: &Mandate, ctx: &mut TxContext) {
    let sender = ctx.sender();
    assert!(sender == mandate::principal(m), ENotPrincipal);

    let mut readers = vec_set::empty<address>();
    readers.insert(sender);

    let access = EvidenceAccess {
        id: object::new(ctx),
        version: VERSION,
        principal: sender,
        mandate_id: mandate::id(m),
        readers,
    };
    event::emit(AccessCreated {
        access_id: object::id(&access),
        mandate_id: mandate::id(m),
        principal: sender,
    });
    transfer::share_object(access);
}

/// The principal grants an auditor read access to this mandate's evidence.
public fun add_auditor(access: &mut EvidenceAccess, auditor: address, ctx: &TxContext) {
    assert!(ctx.sender() == access.principal, ENotPrincipal);
    if (!access.readers.contains(&auditor)) {
        access.readers.insert(auditor);
    };
    event::emit(AuditorAdded { access_id: object::id(access), auditor });
}

// --- Anchor a move ---

/// Check the move against the mandate, then record its evidence anchor on chain.
/// Callable only by the mandate's agent; the agent check lives in `check_and_account`.
public fun anchor(
    m: &mut Mandate,
    access: &EvidenceAccess,
    blob_id: vector<u8>,
    evidence_hash: vector<u8>,
    from_apy_bps: u64,
    to_apy_bps: u64,
    amount: u64,
    protocol: vector<u8>,
    ctx: &TxContext,
) {
    assert!(access.version == VERSION, EWrongVersion);
    assert!(access.mandate_id == mandate::id(m), EAccessMandateMismatch);

    // Enforce every mandate limit and account the move. Aborts if out of bounds.
    mandate::check_and_account(m, amount, protocol, ctx);

    event::emit(MoveAnchored {
        mandate_id: mandate::id(m),
        access_id: object::id(access),
        agent: ctx.sender(),
        blob_id,
        evidence_hash,
        from_apy_bps,
        to_apy_bps,
        amount,
        protocol,
        epoch: ctx.epoch(),
    });
}

// --- Seal access policy ---

/// The Seal policy. Key servers dry-run a transaction that calls this function; if it does
/// not abort, the caller is allowed the decryption key. The key-id must be prefixed by this
/// object's id, and the caller must be an authorized reader.
entry fun seal_approve(id: vector<u8>, access: &EvidenceAccess, ctx: &TxContext) {
    assert!(access.version == VERSION, EWrongVersion);
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
