#[test_only]
module payproof::escrow_tests {
    use std::string;
    use std::unit_test::assert_eq;
    use sui::clock::Clock;
    use sui::coin;
    use sui::test_scenario as ts;
    use payproof::escrow::{Self, Escrow, SettlementReceipt};

    const BUYER: address = @0xA11CE;
    const SUPPLIER: address = @0xB0B;
    const ARBITRATOR: address = @0xC0DE;
    const OUTSIDER: address = @0xBAD;
    const TOTAL: u64 = 100_000;
    const DISPUTED: u64 = 30_000;
    const REQUESTED_REFUND: u64 = 20_000;
    const DELIVERY_DEADLINE_MS: u64 = 1_000_000;
    const INSPECTION_WINDOW_MS: u64 = 500_000;

    /// A stand-in coin type lets the same escrow code be tested for USDC-like
    /// assets without depending on a privileged framework coin.
    public struct TestUsdc has drop {}

    fun order_hash(): vector<u8> {
        vector::tabulate!(32, |_| 7u8)
    }

    fun proposal_hash(): vector<u8> {
        vector::tabulate!(32, |_| 9u8)
    }

    fun evidence_hash(): vector<u8> {
        vector::tabulate!(32, |_| 3u8)
    }

    /// Funds a fresh escrow from the buyer and leaves the scenario on the buyer's next tx.
    fun fund(scenario: &mut ts::Scenario, reference: vector<u8>) {
        let payment = coin::mint_for_testing<TestUsdc>(TOTAL, scenario.ctx());
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::create(
                payment,
                SUPPLIER,
                ARBITRATOR,
                order_hash(),
                string::utf8(reference),
                DELIVERY_DEADLINE_MS,
                INSPECTION_WINDOW_MS,
                clock,
                scenario.ctx(),
            );
        });
    }

    fun advance_clock(scenario: &mut ts::Scenario, ms: u64) {
        scenario.with_shared!<Clock>(|clock, _scenario| {
            clock.increment_for_testing(ms);
        });
    }

    fun ship(scenario: &mut ts::Scenario) {
        scenario.next_tx(SUPPLIER);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            scenario.with_shared!<Clock>(|clock, scenario| {
                escrow::mark_shipped(escrow, clock, scenario.ctx());
            });
        });
    }

    fun take_coin(scenario: &mut ts::Scenario, owner: address, expected: u64) {
        scenario.next_tx(owner);
        let paid = scenario.take_from_sender<coin::Coin<TestUsdc>>();
        assert_eq!(paid.value(), expected);
        paid.burn_for_testing();
    }

    fun take_receipt(scenario: &mut ts::Scenario, expected_mode: u8, expected_buyer: u64, expected_supplier: u64) {
        scenario.next_tx(ARBITRATOR);
        let receipt = scenario.take_shared<SettlementReceipt<TestUsdc>>();
        assert_eq!(escrow::receipt_approval_mode(&receipt), expected_mode);
        assert_eq!(escrow::receipt_buyer_refund(&receipt), expected_buyer);
        assert_eq!(escrow::receipt_supplier_release(&receipt), expected_supplier);
        escrow::destroy_receipt_for_testing(receipt);
    }

    #[test]
    fun opening_a_dispute_pays_the_undisputed_value_in_the_same_transaction() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-1");
        let create_effects = scenario.next_tx(BUYER);
        assert_eq!(create_effects.num_user_events(), 1);

        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            scenario.with_shared!<Clock>(|clock, scenario| {
                escrow::open_dispute(escrow, DISPUTED, REQUESTED_REFUND, clock, scenario.ctx());
            });
        });
        let dispute_effects = scenario.next_tx(BUYER);
        // DisputeOpened and UndisputedReleased, no supplier action needed.
        assert_eq!(dispute_effects.num_user_events(), 2);

        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, _scenario| {
            assert_eq!(escrow::status(escrow), 1);
            assert_eq!(escrow::total_amount(escrow), TOTAL);
            assert_eq!(escrow::disputed_amount(escrow), DISPUTED);
            assert_eq!(escrow::requested_buyer_refund(escrow), REQUESTED_REFUND);
            assert_eq!(escrow::funds_amount(escrow), DISPUTED);
            assert!(escrow::undisputed_released(escrow));
        });
        take_coin(&mut scenario, SUPPLIER, TOTAL - DISPUTED);

        scenario.next_tx(BUYER);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            escrow::approve_buyer(escrow, 12_000, 18_000, proposal_hash(), scenario.ctx());
        });
        scenario.next_tx(SUPPLIER);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            escrow::approve_supplier(escrow, 12_000, 18_000, proposal_hash(), scenario.ctx());
        });

        scenario.next_tx(ARBITRATOR);
        let escrow = scenario.take_shared<Escrow<TestUsdc>>();
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::execute_settlement(escrow, clock, scenario.ctx());
        });
        let settle_effects = scenario.next_tx(ARBITRATOR);
        assert_eq!(settle_effects.num_user_events(), 1);

        take_coin(&mut scenario, BUYER, 12_000);
        take_coin(&mut scenario, SUPPLIER, 18_000);
        take_receipt(&mut scenario, 1, 12_000, 18_000);
        scenario.end();
    }

    #[test]
    fun arbitrator_can_execute_when_one_party_does_not_approve() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-2");
        scenario.next_tx(BUYER);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            scenario.with_shared!<Clock>(|clock, scenario| {
                escrow::open_dispute(escrow, TOTAL, REQUESTED_REFUND, clock, scenario.ctx());
            });
        });
        scenario.next_tx(ARBITRATOR);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            escrow::approve_arbitrator(escrow, 15_000, 85_000, proposal_hash(), scenario.ctx());
        });
        scenario.next_tx(ARBITRATOR);
        let escrow = scenario.take_shared<Escrow<TestUsdc>>();
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::execute_settlement(escrow, clock, scenario.ctx());
        });
        take_coin(&mut scenario, BUYER, 15_000);
        take_coin(&mut scenario, SUPPLIER, 85_000);
        take_receipt(&mut scenario, 2, 15_000, 85_000);
        scenario.end();
    }

    #[test]
    fun buyer_can_confirm_without_a_dispute() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-3");
        scenario.next_tx(BUYER);
        let escrow = scenario.take_shared<Escrow<TestUsdc>>();
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::release_full(escrow, clock, scenario.ctx());
        });
        take_coin(&mut scenario, SUPPLIER, TOTAL);
        take_receipt(&mut scenario, 0, 0, TOTAL);
        scenario.end();
    }

    #[test, expected_failure(abort_code = escrow::E_UNAUTHORIZED)]
    fun only_buyer_can_open_a_dispute() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-4");
        scenario.next_tx(SUPPLIER);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            scenario.with_shared!<Clock>(|clock, scenario| {
                escrow::open_dispute(escrow, 1, 1, clock, scenario.ctx());
            });
        });
        abort 99
    }

    #[test]
    fun shipment_and_evidence_are_recorded_as_events() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-5");
        ship(&mut scenario);
        let ship_effects = scenario.next_tx(SUPPLIER);
        assert_eq!(ship_effects.num_user_events(), 1);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            assert!(escrow::shipped(escrow));
            scenario.with_shared!<Clock>(|clock, scenario| {
                escrow::anchor_evidence(escrow, 1, evidence_hash(), clock, scenario.ctx());
            });
        });
        let anchor_effects = scenario.next_tx(BUYER);
        assert_eq!(anchor_effects.num_user_events(), 1);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            scenario.with_shared!<Clock>(|clock, scenario| {
                escrow::anchor_evidence(escrow, 2, evidence_hash(), clock, scenario.ctx());
            });
        });
        let buyer_anchor_effects = scenario.next_tx(BUYER);
        assert_eq!(buyer_anchor_effects.num_user_events(), 1);
        scenario.end();
    }

    #[test, expected_failure(abort_code = escrow::E_UNAUTHORIZED)]
    fun outsiders_cannot_anchor_evidence() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-6");
        scenario.next_tx(OUTSIDER);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            scenario.with_shared!<Clock>(|clock, scenario| {
                escrow::anchor_evidence(escrow, 1, evidence_hash(), clock, scenario.ctx());
            });
        });
        abort 99
    }

    #[test, expected_failure(abort_code = escrow::E_ALREADY_SHIPPED)]
    fun shipment_can_only_be_marked_once() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-7");
        ship(&mut scenario);
        ship(&mut scenario);
        abort 99
    }

    #[test]
    fun buyer_reclaims_an_unshipped_escrow_after_the_delivery_deadline() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-8");
        scenario.next_tx(BUYER);
        advance_clock(&mut scenario, DELIVERY_DEADLINE_MS + 1);
        scenario.next_tx(BUYER);
        let escrow = scenario.take_shared<Escrow<TestUsdc>>();
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::refund_unshipped(escrow, clock, scenario.ctx());
        });
        take_coin(&mut scenario, BUYER, TOTAL);
        take_receipt(&mut scenario, 3, TOTAL, 0);
        scenario.end();
    }

    #[test, expected_failure(abort_code = escrow::E_DEADLINE_NOT_REACHED)]
    fun buyer_cannot_reclaim_before_the_delivery_deadline() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-9");
        scenario.next_tx(BUYER);
        let escrow = scenario.take_shared<Escrow<TestUsdc>>();
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::refund_unshipped(escrow, clock, scenario.ctx());
        });
        abort 99
    }

    #[test, expected_failure(abort_code = escrow::E_ALREADY_SHIPPED)]
    fun buyer_cannot_reclaim_a_shipped_escrow() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-10");
        ship(&mut scenario);
        scenario.next_tx(BUYER);
        advance_clock(&mut scenario, DELIVERY_DEADLINE_MS + 1);
        scenario.next_tx(BUYER);
        let escrow = scenario.take_shared<Escrow<TestUsdc>>();
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::refund_unshipped(escrow, clock, scenario.ctx());
        });
        abort 99
    }

    #[test]
    fun supplier_claims_an_uninspected_escrow_after_the_window() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-11");
        ship(&mut scenario);
        scenario.next_tx(SUPPLIER);
        // Shipped before the deadline, so the window runs from the deadline.
        advance_clock(&mut scenario, DELIVERY_DEADLINE_MS + INSPECTION_WINDOW_MS + 1);
        scenario.next_tx(SUPPLIER);
        let escrow = scenario.take_shared<Escrow<TestUsdc>>();
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::claim_uninspected(escrow, clock, scenario.ctx());
        });
        take_coin(&mut scenario, SUPPLIER, TOTAL);
        take_receipt(&mut scenario, 4, 0, TOTAL);
        scenario.end();
    }

    #[test, expected_failure(abort_code = escrow::E_DEADLINE_NOT_REACHED)]
    fun supplier_cannot_claim_inside_the_inspection_window() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-12");
        ship(&mut scenario);
        scenario.next_tx(SUPPLIER);
        advance_clock(&mut scenario, DELIVERY_DEADLINE_MS + INSPECTION_WINDOW_MS);
        scenario.next_tx(SUPPLIER);
        let escrow = scenario.take_shared<Escrow<TestUsdc>>();
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::claim_uninspected(escrow, clock, scenario.ctx());
        });
        abort 99
    }

    #[test, expected_failure(abort_code = escrow::E_NOT_SHIPPED)]
    fun supplier_cannot_claim_without_marking_shipment() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-13");
        scenario.next_tx(SUPPLIER);
        advance_clock(&mut scenario, DELIVERY_DEADLINE_MS + INSPECTION_WINDOW_MS + 1);
        scenario.next_tx(SUPPLIER);
        let escrow = scenario.take_shared<Escrow<TestUsdc>>();
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::claim_uninspected(escrow, clock, scenario.ctx());
        });
        abort 99
    }

    #[test]
    fun a_late_shipment_extends_the_inspection_window() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        fund(&mut scenario, b"ORDER-ESCROW-14");
        scenario.next_tx(SUPPLIER);
        advance_clock(&mut scenario, DELIVERY_DEADLINE_MS + 100);
        ship(&mut scenario);
        scenario.next_tx(SUPPLIER);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, _scenario| {
            assert_eq!(escrow::inspection_closes_at_ms(escrow), DELIVERY_DEADLINE_MS + 100 + INSPECTION_WINDOW_MS);
        });
        // Buyer still disputes inside the extended window.
        scenario.next_tx(BUYER);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            scenario.with_shared!<Clock>(|clock, scenario| {
                escrow::open_dispute(escrow, DISPUTED, REQUESTED_REFUND, clock, scenario.ctx());
            });
        });
        take_coin(&mut scenario, SUPPLIER, TOTAL - DISPUTED);
        scenario.end();
    }
}
