// Copyright (c) 2026.
// SPDX-License-Identifier: Apache-2.0

/// The on-chain declaration of what a yield agent is allowed to do.
///
/// The principal creates a mandate that names the single agent address, a cap per move,
/// a rolling daily cap, an optional allowlist of protocols, and an expiry. The mandate
/// does not custody funds, because the agent's stablecoins live in its t2000 wallet and
/// the actual yield moves run through that wallet. Instead, the mandate is the source of
/// truth for what was permitted, and the `record` module checks every move against it at
/// the moment it is anchored.
///
/// The key property: the contract refuses to anchor a move that breaks the mandate. Since
/// the verifiable record is the product, an out-of-bounds move simply cannot produce a
/// valid on-chain proof, which is what lets a reader trust that every anchored move was
/// within the declared authority.
module avow::mandate;

use sui::event;
use sui::vec_set::{Self, VecSet};

// --- Error codes ---
const EWrongCap: u64 = 1;
const ERevoked: u64 = 2;
const EExpired: u64 = 3;
const ENotAgent: u64 = 4;
const EOverPerMoveCap: u64 = 5;
const EOverDailyCap: u64 = 6;
const EProtocolNotAllowed: u64 = 7;
const EWrongVersion: u64 = 8;

/// Bumped if the object layout changes in a future package upgrade.
const VERSION: u64 = 1;

/// The agent's declared authority. Shared so the agent's transactions can read and
/// account against it.
public struct Mandate has key {
    id: UID,
    version: u64,
    /// The owner who set the mandate.
    principal: address,
    /// The single agent address permitted to act under this mandate.
    agent: address,
    /// Maximum amount for any single move, in the stablecoin's smallest unit.
    per_move_cap: u64,
    /// Maximum cumulative amount the agent may move within one epoch (roughly a day on
    /// mainnet).
    daily_cap: u64,
    /// Amount accounted in the current epoch. Resets when the epoch advances.
    spent_in_epoch: u64,
    /// The epoch the rolling counter was last reset in.
    last_epoch: u64,
    /// If true, the agent may only act on protocols present in `allowed_protocols`.
    restrict_protocols: bool,
    /// Protocol identifiers as raw bytes, for example b"navi".
    allowed_protocols: VecSet<vector<u8>>,
    /// The mandate is invalid from this epoch onward.
    expiry_epoch: u64,
    revoked: bool,
}

/// Owner-held capability that authorizes administrative actions on one mandate.
public struct MandateCap has key, store {
    id: UID,
    mandate_id: ID,
}

// --- Events ---
public struct MandateCreated has copy, drop {
    mandate_id: ID,
    principal: address,
    agent: address,
    per_move_cap: u64,
    daily_cap: u64,
}

public struct ProtocolAllowed has copy, drop { mandate_id: ID, protocol: vector<u8> }
public struct MandateRevoked has copy, drop { mandate_id: ID }

// --- Creation ---

/// Create and share a mandate, returning the admin cap to the caller.
public fun create(
    agent: address,
    per_move_cap: u64,
    daily_cap: u64,
    expiry_epoch: u64,
    restrict_protocols: bool,
    ctx: &mut TxContext,
): MandateCap {
    let m = Mandate {
        id: object::new(ctx),
        version: VERSION,
        principal: ctx.sender(),
        agent,
        per_move_cap,
        daily_cap,
        spent_in_epoch: 0,
        last_epoch: ctx.epoch(),
        restrict_protocols,
        allowed_protocols: vec_set::empty(),
        expiry_epoch,
        revoked: false,
    };
    let mandate_id = object::id(&m);
    let cap = MandateCap { id: object::new(ctx), mandate_id };
    event::emit(MandateCreated {
        mandate_id,
        principal: m.principal,
        agent,
        per_move_cap,
        daily_cap,
    });
    transfer::share_object(m);
    cap
}

/// Convenience entry wrapper: create the mandate and send the cap to the sender.
entry fun create_entry(
    agent: address,
    per_move_cap: u64,
    daily_cap: u64,
    expiry_epoch: u64,
    restrict_protocols: bool,
    ctx: &mut TxContext,
) {
    let cap = create(agent, per_move_cap, daily_cap, expiry_epoch, restrict_protocols, ctx);
    transfer::public_transfer(cap, ctx.sender());
}

// --- Administration (principal only, via the cap) ---

/// Permit the agent to act on a specific protocol (relevant when restrict_protocols is true).
public fun allow_protocol(m: &mut Mandate, cap: &MandateCap, protocol: vector<u8>) {
    assert_cap(m, cap);
    if (!m.allowed_protocols.contains(&protocol)) {
        m.allowed_protocols.insert(protocol);
    };
    event::emit(ProtocolAllowed { mandate_id: object::id(m), protocol });
}

/// Revoke the mandate. No further moves can be anchored against it.
public fun revoke(m: &mut Mandate, cap: &MandateCap) {
    assert_cap(m, cap);
    m.revoked = true;
    event::emit(MandateRevoked { mandate_id: object::id(m) });
}

// --- Enforcement (called by the record module when anchoring a move) ---

/// Run every mandate check for a move and account it against the rolling daily cap.
/// Aborts if the caller is not the agent, the mandate is expired or revoked, the amount
/// exceeds a cap, or the protocol is not allowed. This is the single gate every anchored
/// move passes through.
public(package) fun check_and_account(
    m: &mut Mandate,
    amount: u64,
    protocol: vector<u8>,
    ctx: &TxContext,
) {
    assert!(m.version == VERSION, EWrongVersion);
    assert!(!m.revoked, ERevoked);
    assert!(ctx.epoch() < m.expiry_epoch, EExpired);
    assert!(ctx.sender() == m.agent, ENotAgent);
    assert!(amount <= m.per_move_cap, EOverPerMoveCap);

    // Roll the daily window forward if the epoch advanced.
    if (ctx.epoch() != m.last_epoch) {
        m.last_epoch = ctx.epoch();
        m.spent_in_epoch = 0;
    };
    assert!(m.spent_in_epoch + amount <= m.daily_cap, EOverDailyCap);
    m.spent_in_epoch = m.spent_in_epoch + amount;

    if (m.restrict_protocols) {
        assert!(m.allowed_protocols.contains(&protocol), EProtocolNotAllowed);
    };
}

// --- Read-only accessors (for the record module, the SDK, and the UI) ---

public fun id(m: &Mandate): ID { object::id(m) }
public fun principal(m: &Mandate): address { m.principal }
public fun agent(m: &Mandate): address { m.agent }
public fun per_move_cap(m: &Mandate): u64 { m.per_move_cap }
public fun daily_cap(m: &Mandate): u64 { m.daily_cap }
public fun spent_in_epoch(m: &Mandate): u64 { m.spent_in_epoch }
public fun expiry_epoch(m: &Mandate): u64 { m.expiry_epoch }
public fun revoked(m: &Mandate): bool { m.revoked }

// --- Internal ---

fun assert_cap(m: &Mandate, cap: &MandateCap) {
    assert!(cap.mandate_id == object::id(m), EWrongCap);
}
