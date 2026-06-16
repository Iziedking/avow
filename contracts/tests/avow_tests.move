// Copyright (c) 2026.
// SPDX-License-Identifier: Apache-2.0

/// Unit tests for the mandate gate and the evidence access policy.
///
/// The whole product rests on one claim: an action whose reported amount or target breaks
/// the mandate cannot produce a valid on-chain record. These tests exercise that claim
/// directly, driving the real `record::anchor` path so the agent check, the caps, the
/// expiry, the revoke, and the target allowlist all run the way they will in production.
/// They also cover the cap-based authority model, the one-access-per-mandate rule, the
/// evidence validation, the creation-time config checks, and the Seal policy.
#[test_only]
module avow::avow_tests;

use sui::test_scenario as ts;
use avow::mandate::{Self, Mandate, MandateCap};
use avow::record::{Self, EvidenceAccess};

const PRINCIPAL: address = @0xA1;
const AGENT: address = @0xA2;
const AUDITOR: address = @0xA3;
const OUTSIDER: address = @0xA4;

// A code for the trailing `abort` in failure tests. It is never reached when the guard
// under test fires first, and it differs from every real error code so a missing guard
// fails the test loudly instead of passing by accident.
const EUnreached: u64 = 99;

// A well-formed 32-byte evidence hash and a non-empty blob id for the happy paths.
fun valid_hash(): vector<u8> { b"01234567890123456789012345678901" }
fun valid_blob(): vector<u8> { b"blob-id" }

/// Stand up a principal, a mandate, and its evidence access, then hand the scenario back.
/// The caller advances to whichever sender it needs before taking the shared objects.
fun fresh(per_move: u64, daily: u64, expiry: u64, restrict: bool): ts::Scenario {
    let mut s = ts::begin(PRINCIPAL);
    mandate::create_entry(AGENT, per_move, daily, expiry, restrict, s.ctx());
    s.next_tx(PRINCIPAL);
    {
        let mut m = ts::take_shared<Mandate>(&s);
        let cap = ts::take_from_sender<MandateCap>(&s);
        record::create_access(&mut m, &cap, s.ctx());
        ts::return_shared(m);
        ts::return_to_sender(&s, cap);
    };
    s
}

// --- Mandate enforcement, driven through record::anchor ---

#[test]
fun anchor_within_bounds_accounts_amount() {
    let mut s = fresh(1000, 2000, 100, false);
    s.next_tx(AGENT);
    {
        let mut m = ts::take_shared<Mandate>(&s);
        let access = ts::take_shared<EvidenceAccess>(&s);
        record::anchor(&mut m, &access, valid_blob(), valid_hash(), 500, b"yield_move", b"navi", s.ctx());
        assert!(mandate::spent_in_epoch(&m) == 500, 0);
        ts::return_shared(m);
        ts::return_shared(access);
    };
    s.end();
}

#[test]
#[expected_failure(abort_code = avow::mandate::EOverPerMoveCap)]
fun per_move_cap_rejects_oversized_move() {
    let mut s = fresh(1000, 100000, 100, false);
    s.next_tx(AGENT);
    let mut m = ts::take_shared<Mandate>(&s);
    let access = ts::take_shared<EvidenceAccess>(&s);
    record::anchor(&mut m, &access, valid_blob(), valid_hash(), 1001, b"yield_move", b"navi", s.ctx());
    abort EUnreached
}

#[test]
#[expected_failure(abort_code = avow::mandate::EOverDailyCap)]
fun daily_cap_rejects_when_total_exceeded() {
    let mut s = fresh(1000, 1500, 100, false);
    s.next_tx(AGENT);
    {
        let mut m = ts::take_shared<Mandate>(&s);
        let access = ts::take_shared<EvidenceAccess>(&s);
        record::anchor(&mut m, &access, valid_blob(), valid_hash(), 1000, b"yield_move", b"navi", s.ctx());
        ts::return_shared(m);
        ts::return_shared(access);
    };
    s.next_tx(AGENT);
    let mut m = ts::take_shared<Mandate>(&s);
    let access = ts::take_shared<EvidenceAccess>(&s);
    record::anchor(&mut m, &access, valid_blob(), valid_hash(), 600, b"yield_move", b"navi", s.ctx());
    abort EUnreached
}

#[test]
fun daily_cap_resets_after_epoch_rollover() {
    let mut s = fresh(1000, 1500, 100, false);
    s.next_tx(AGENT);
    {
        let mut m = ts::take_shared<Mandate>(&s);
        let access = ts::take_shared<EvidenceAccess>(&s);
        record::anchor(&mut m, &access, valid_blob(), valid_hash(), 1000, b"yield_move", b"navi", s.ctx());
        assert!(mandate::spent_in_epoch(&m) == 1000, 0);
        ts::return_shared(m);
        ts::return_shared(access);
    };
    s.next_epoch(AGENT);
    {
        let mut m = ts::take_shared<Mandate>(&s);
        let access = ts::take_shared<EvidenceAccess>(&s);
        record::anchor(&mut m, &access, valid_blob(), valid_hash(), 1000, b"yield_move", b"navi", s.ctx());
        assert!(mandate::spent_in_epoch(&m) == 1000, 1);
        ts::return_shared(m);
        ts::return_shared(access);
    };
    s.end();
}

#[test]
#[expected_failure(abort_code = avow::mandate::ENotAgent)]
fun non_agent_sender_rejected() {
    let mut s = fresh(1000, 100000, 100, false);
    s.next_tx(OUTSIDER);
    let mut m = ts::take_shared<Mandate>(&s);
    let access = ts::take_shared<EvidenceAccess>(&s);
    record::anchor(&mut m, &access, valid_blob(), valid_hash(), 500, b"yield_move", b"navi", s.ctx());
    abort EUnreached
}

#[test]
#[expected_failure(abort_code = avow::mandate::EExpired)]
fun expired_mandate_rejected() {
    let mut s = fresh(1000, 100000, 1, false);
    s.next_epoch(AGENT);
    let mut m = ts::take_shared<Mandate>(&s);
    let access = ts::take_shared<EvidenceAccess>(&s);
    record::anchor(&mut m, &access, valid_blob(), valid_hash(), 500, b"yield_move", b"navi", s.ctx());
    abort EUnreached
}

#[test]
#[expected_failure(abort_code = avow::mandate::ERevoked)]
fun revoked_mandate_rejected() {
    let mut s = fresh(1000, 100000, 100, false);
    s.next_tx(PRINCIPAL);
    {
        let mut m = ts::take_shared<Mandate>(&s);
        let cap = ts::take_from_sender<MandateCap>(&s);
        mandate::revoke(&mut m, &cap);
        ts::return_shared(m);
        ts::return_to_sender(&s, cap);
    };
    s.next_tx(AGENT);
    let mut m = ts::take_shared<Mandate>(&s);
    let access = ts::take_shared<EvidenceAccess>(&s);
    record::anchor(&mut m, &access, valid_blob(), valid_hash(), 500, b"yield_move", b"navi", s.ctx());
    abort EUnreached
}

#[test]
#[expected_failure(abort_code = avow::mandate::ETargetNotAllowed)]
fun restricted_target_not_on_allowlist_rejected() {
    let mut s = fresh(1000, 100000, 100, true);
    s.next_tx(AGENT);
    let mut m = ts::take_shared<Mandate>(&s);
    let access = ts::take_shared<EvidenceAccess>(&s);
    record::anchor(&mut m, &access, valid_blob(), valid_hash(), 500, b"yield_move", b"navi", s.ctx());
    abort EUnreached
}

#[test]
fun restricted_target_anchors_once_allowed() {
    let mut s = fresh(1000, 100000, 100, true);
    s.next_tx(PRINCIPAL);
    {
        let mut m = ts::take_shared<Mandate>(&s);
        let cap = ts::take_from_sender<MandateCap>(&s);
        mandate::allow_target(&mut m, &cap, b"navi");
        ts::return_shared(m);
        ts::return_to_sender(&s, cap);
    };
    s.next_tx(AGENT);
    {
        let mut m = ts::take_shared<Mandate>(&s);
        let access = ts::take_shared<EvidenceAccess>(&s);
        record::anchor(&mut m, &access, valid_blob(), valid_hash(), 500, b"yield_move", b"navi", s.ctx());
        ts::return_shared(m);
        ts::return_shared(access);
    };
    s.end();
}

#[test]
#[expected_failure(abort_code = avow::mandate::EWrongCap)]
fun wrong_cap_rejected_on_allow_target() {
    let mut s = ts::begin(PRINCIPAL);
    mandate::create_entry(AGENT, 1000, 100000, 100, true, s.ctx());
    s.next_tx(PRINCIPAL);
    let id1 = ts::most_recent_id_shared<Mandate>().destroy_some();
    mandate::create_entry(AGENT, 1000, 100000, 100, true, s.ctx());
    s.next_tx(PRINCIPAL);
    let mut m1 = ts::take_shared_by_id<Mandate>(&s, id1);
    let cap2 = ts::take_from_sender<MandateCap>(&s);
    mandate::allow_target(&mut m1, &cap2, b"navi");
    abort EUnreached
}

// --- Evidence access policy and authority ---

#[test]
#[expected_failure(abort_code = avow::mandate::EWrongCap)]
fun create_access_with_wrong_cap_rejected() {
    let mut s = ts::begin(PRINCIPAL);
    mandate::create_entry(AGENT, 1000, 100000, 100, false, s.ctx());
    s.next_tx(PRINCIPAL);
    let id_a = ts::most_recent_id_shared<Mandate>().destroy_some();
    mandate::create_entry(AGENT, 1000, 100000, 100, false, s.ctx());
    s.next_tx(PRINCIPAL);
    let mut m_a = ts::take_shared_by_id<Mandate>(&s, id_a);
    let cap_b = ts::take_from_sender<MandateCap>(&s);
    record::create_access(&mut m_a, &cap_b, s.ctx());
    abort EUnreached
}

#[test]
#[expected_failure(abort_code = avow::mandate::EAccessAlreadySet)]
fun second_create_access_rejected() {
    let mut s = fresh(1000, 100000, 100, false);
    s.next_tx(PRINCIPAL);
    let mut m = ts::take_shared<Mandate>(&s);
    let cap = ts::take_from_sender<MandateCap>(&s);
    record::create_access(&mut m, &cap, s.ctx());
    abort EUnreached
}

#[test]
#[expected_failure(abort_code = avow::record::EAccessMandateMismatch)]
fun anchor_with_foreign_access_rejected() {
    let mut s = ts::begin(PRINCIPAL);
    mandate::create_entry(AGENT, 1000, 100000, 100, false, s.ctx());
    s.next_tx(PRINCIPAL);
    {
        let mut m1 = ts::take_shared<Mandate>(&s);
        let cap1 = ts::take_from_sender<MandateCap>(&s);
        record::create_access(&mut m1, &cap1, s.ctx());
        ts::return_shared(m1);
        ts::return_to_sender(&s, cap1);
    };
    s.next_tx(PRINCIPAL);
    let access1_id = ts::most_recent_id_shared<EvidenceAccess>().destroy_some();
    mandate::create_entry(AGENT, 1000, 100000, 100, false, s.ctx());
    s.next_tx(AGENT);
    let m2_id = ts::most_recent_id_shared<Mandate>().destroy_some();
    let mut m2 = ts::take_shared_by_id<Mandate>(&s, m2_id);
    let access1 = ts::take_shared_by_id<EvidenceAccess>(&s, access1_id);
    record::anchor(&mut m2, &access1, valid_blob(), valid_hash(), 500, b"yield_move", b"navi", s.ctx());
    abort EUnreached
}

#[test]
#[expected_failure(abort_code = avow::record::EBadEvidence)]
fun anchor_with_short_hash_rejected() {
    let mut s = fresh(1000, 100000, 100, false);
    s.next_tx(AGENT);
    let mut m = ts::take_shared<Mandate>(&s);
    let access = ts::take_shared<EvidenceAccess>(&s);
    record::anchor(&mut m, &access, valid_blob(), b"0123456789012345678901234567890", 500, b"yield_move", b"navi", s.ctx());
    abort EUnreached
}

#[test]
#[expected_failure(abort_code = avow::record::EBadEvidence)]
fun anchor_with_empty_blob_rejected() {
    let mut s = fresh(1000, 100000, 100, false);
    s.next_tx(AGENT);
    let mut m = ts::take_shared<Mandate>(&s);
    let access = ts::take_shared<EvidenceAccess>(&s);
    record::anchor(&mut m, &access, b"", valid_hash(), 500, b"yield_move", b"navi", s.ctx());
    abort EUnreached
}

// --- Creation-time config validation ---

#[test]
#[expected_failure(abort_code = avow::mandate::EInvalidConfig)]
fun create_with_past_expiry_rejected() {
    let mut s = ts::begin(PRINCIPAL);
    mandate::create_entry(AGENT, 1000, 2000, 0, false, s.ctx());
    abort EUnreached
}

#[test]
#[expected_failure(abort_code = avow::mandate::EInvalidConfig)]
fun create_with_per_move_above_daily_rejected() {
    let mut s = ts::begin(PRINCIPAL);
    mandate::create_entry(AGENT, 3000, 2000, 100, false, s.ctx());
    abort EUnreached
}

// --- Migration guard ---

#[test]
#[expected_failure(abort_code = avow::mandate::EAlreadyMigrated)]
fun migrate_at_current_version_rejected() {
    let mut s = fresh(1000, 100000, 100, false);
    s.next_tx(PRINCIPAL);
    let mut m = ts::take_shared<Mandate>(&s);
    let cap = ts::take_from_sender<MandateCap>(&s);
    mandate::migrate(&mut m, &cap);
    abort EUnreached
}

// --- Seal policy ---

#[test]
fun seal_approve_allows_principal_reader() {
    let mut s = fresh(1000, 100000, 100, false);
    s.next_tx(PRINCIPAL);
    let access = ts::take_shared<EvidenceAccess>(&s);
    let mut id = object::id(&access).to_bytes();
    id.push_back(7u8);
    record::seal_approve(id, &access, s.ctx());
    ts::return_shared(access);
    s.end();
}

#[test]
fun seal_approve_allows_added_auditor() {
    let mut s = fresh(1000, 100000, 100, false);
    s.next_tx(PRINCIPAL);
    {
        let mut access = ts::take_shared<EvidenceAccess>(&s);
        let cap = ts::take_from_sender<MandateCap>(&s);
        record::add_auditor(&mut access, &cap, AUDITOR);
        ts::return_shared(access);
        ts::return_to_sender(&s, cap);
    };
    s.next_tx(AUDITOR);
    let access = ts::take_shared<EvidenceAccess>(&s);
    let mut id = object::id(&access).to_bytes();
    id.push_back(1u8);
    record::seal_approve(id, &access, s.ctx());
    ts::return_shared(access);
    s.end();
}

#[test]
#[expected_failure(abort_code = avow::record::ENoAccess)]
fun seal_approve_rejects_non_reader() {
    let mut s = fresh(1000, 100000, 100, false);
    s.next_tx(OUTSIDER);
    let access = ts::take_shared<EvidenceAccess>(&s);
    let mut id = object::id(&access).to_bytes();
    id.push_back(1u8);
    record::seal_approve(id, &access, s.ctx());
    abort EUnreached
}

#[test]
#[expected_failure(abort_code = avow::record::ENoAccess)]
fun seal_approve_rejects_wrong_prefix() {
    let mut s = fresh(1000, 100000, 100, false);
    s.next_tx(PRINCIPAL);
    let access = ts::take_shared<EvidenceAccess>(&s);
    let id = b"this_is_not_the_access_object_id_prefix";
    record::seal_approve(id, &access, s.ctx());
    abort EUnreached
}
