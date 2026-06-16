// Copyright (c) 2026.
// SPDX-License-Identifier: Apache-2.0

/// The on-chain declaration of what an agent is allowed to do.
///
/// Avow is a verifiable trust layer that any money-moving agent can plug into. The mandate
/// is the authority half of that layer: the principal names the single agent address, a cap
/// per action, a per-epoch cap, an optional allowlist of targets, and an expiry. The mandate
/// holds no funds. The agent's assets live in its own wallet and its actions run through that
/// wallet. The mandate is the source of truth for what was permitted, and the `record` module
/// checks every action against it at the moment it is anchored.
///
/// The key property: the contract refuses to anchor an action whose reported amount or
/// target breaks the mandate. Since the verifiable record is the product, an out-of-bounds
/// action simply cannot produce a valid on-chain proof. The mandate constrains the values the
/// agent reports; it does not see the agent's wallet, so honest reporting is still the agent's
/// responsibility and the dashboard reconciles each anchored amount against the transfer
/// digests carried in the sealed evidence bundle.
///
/// Nothing here is yield-specific. A `target` is whatever the strategy acts on: a lending
/// pool, a merchant, a market. The strategy detail lives inside the evidence bundle on Walrus.
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
const ETargetNotAllowed: u64 = 7;
const EWrongVersion: u64 = 8;
const EInvalidConfig: u64 = 9;
const EAccessAlreadySet: u64 = 10;
const EAlreadyMigrated: u64 = 11;

/// Bumped if the object layout changes in a future package upgrade. Existing objects are
/// brought forward with `migrate`, so an upgrade never strands a mandate.
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
    /// Maximum amount for any single action, in the asset's smallest unit.
    per_move_cap: u64,
    /// Maximum cumulative amount the agent may move within one epoch. On mainnet an epoch
    /// is roughly a day. This is a per-epoch window with a lazy reset, not a rolling 24h
    /// window, so a burst straddling an epoch boundary can move up to two windows close
    /// together in wall-clock time. Set the cap with that in mind.
    daily_cap: u64,
    /// Amount accounted in the current epoch. Resets when the epoch advances.
    spent_in_epoch: u64,
    /// The epoch the rolling counter was last reset in.
    last_epoch: u64,
    /// If true, the agent may only act on targets present in `allowed_targets`.
    restrict_targets: bool,
    /// Target identifiers as raw bytes, for example b"navi" or a merchant id.
    allowed_targets: VecSet<vector<u8>>,
    /// The mandate is invalid from this epoch onward.
    expiry_epoch: u64,
    revoked: bool,
    /// The one evidence access registered for this mandate, set once by
    /// `record::create_access`. Pinning a single Seal namespace stops the track record from
    /// being split across several access objects that auditors would have to chase.
    registered_access: Option<ID>,
}

/// Owner-held capability that authorizes administrative actions on one mandate. Holding the
/// cap is the single source of authority over both the mandate and its evidence access, so
/// transferring the cap transfers all of that authority together.
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

public struct TargetAllowed has copy, drop { mandate_id: ID, target: vector<u8> }
public struct MandateRevoked has copy, drop { mandate_id: ID }

// --- Creation ---

/// Create and share a mandate, returning the admin cap to the caller.
public fun create(
    agent: address,
    per_move_cap: u64,
    daily_cap: u64,
    expiry_epoch: u64,
    restrict_targets: bool,
    ctx: &mut TxContext,
): MandateCap {
    assert!(per_move_cap > 0, EInvalidConfig);
    assert!(daily_cap > 0, EInvalidConfig);
    assert!(per_move_cap <= daily_cap, EInvalidConfig);
    assert!(expiry_epoch > ctx.epoch(), EInvalidConfig);

    let m = Mandate {
        id: object::new(ctx),
        version: VERSION,
        principal: ctx.sender(),
        agent,
        per_move_cap,
        daily_cap,
        spent_in_epoch: 0,
        last_epoch: ctx.epoch(),
        restrict_targets,
        allowed_targets: vec_set::empty(),
        expiry_epoch,
        revoked: false,
        registered_access: option::none(),
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
    restrict_targets: bool,
    ctx: &mut TxContext,
) {
    let cap = create(agent, per_move_cap, daily_cap, expiry_epoch, restrict_targets, ctx);
    transfer::public_transfer(cap, ctx.sender());
}

// --- Administration (cap holder only) ---

/// Permit the agent to act on a specific target (relevant when restrict_targets is true).
public fun allow_target(m: &mut Mandate, cap: &MandateCap, target: vector<u8>) {
    check_cap(m, cap);
    if (!m.allowed_targets.contains(&target)) {
        m.allowed_targets.insert(target);
    };
    event::emit(TargetAllowed { mandate_id: object::id(m), target });
}

/// Revoke the mandate. No further actions can be anchored against it.
public fun revoke(m: &mut Mandate, cap: &MandateCap) {
    check_cap(m, cap);
    m.revoked = true;
    event::emit(MandateRevoked { mandate_id: object::id(m) });
}

/// Bring a mandate created by an older package version up to the current layout. Gated by
/// the cap so only the owner migrates. Without this an upgrade that bumps `VERSION` would
/// freeze anchoring on every existing mandate.
entry fun migrate(m: &mut Mandate, cap: &MandateCap) {
    check_cap(m, cap);
    assert!(m.version < VERSION, EAlreadyMigrated);
    m.version = VERSION;
}

// --- Package hooks for the record module ---

/// Run every mandate check for an action and account it against the per-epoch cap. Aborts if
/// the caller is not the agent, the mandate is expired or revoked, the amount exceeds a cap,
/// or the target is not allowed. This is the single gate every anchored action passes through.
public(package) fun check_and_account(
    m: &mut Mandate,
    amount: u64,
    target: vector<u8>,
    ctx: &TxContext,
) {
    assert!(m.version == VERSION, EWrongVersion);
    assert!(!m.revoked, ERevoked);
    assert!(ctx.epoch() < m.expiry_epoch, EExpired);
    assert!(ctx.sender() == m.agent, ENotAgent);
    assert!(amount <= m.per_move_cap, EOverPerMoveCap);

    // Roll the window forward if the epoch advanced.
    if (ctx.epoch() != m.last_epoch) {
        m.last_epoch = ctx.epoch();
        m.spent_in_epoch = 0;
    };
    assert!(m.spent_in_epoch + amount <= m.daily_cap, EOverDailyCap);
    m.spent_in_epoch = m.spent_in_epoch + amount;

    if (m.restrict_targets) {
        assert!(m.allowed_targets.contains(&target), ETargetNotAllowed);
    };
}

/// Record the one evidence access for this mandate. Callable once; a second attempt aborts.
public(package) fun register_access(m: &mut Mandate, access_id: ID) {
    assert!(m.version == VERSION, EWrongVersion);
    assert!(m.registered_access.is_none(), EAccessAlreadySet);
    m.registered_access.fill(access_id);
}

/// Abort unless `cap` is the admin cap for `m`.
public(package) fun check_cap(m: &Mandate, cap: &MandateCap) {
    assert!(cap.mandate_id == object::id(m), EWrongCap);
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
public fun registered_access(m: &Mandate): Option<ID> { m.registered_access }
public fun cap_mandate_id(cap: &MandateCap): ID { cap.mandate_id }
