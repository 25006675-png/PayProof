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
    const TOTAL: u64 = 100_000;
    const DISPUTED: u64 = 30_000;
    const REQUESTED_REFUND: u64 = 20_000;

    /// A stand-in coin type lets the same escrow code be tested for USDC-like
    /// assets without depending on a privileged framework coin.
    public struct TestUsdc has drop {}

    fun order_hash(): vector<u8> {
        vector::tabulate!(32, |_| 7u8)
    }

    fun proposal_hash(): vector<u8> {
        vector::tabulate!(32, |_| 9u8)
    }

    #[test]
    fun disputed_settlement_releases_only_disputed_funds() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        let payment = coin::mint_for_testing<TestUsdc>(TOTAL, scenario.ctx());

        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::create(
                payment,
                SUPPLIER,
                ARBITRATOR,
                order_hash(),
                string::utf8(b"ORDER-ESCROW-1"),
                clock,
                scenario.ctx(),
            );
        });
        let create_effects = scenario.next_tx(BUYER);
        assert_eq!(create_effects.num_user_events(), 1);

        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            scenario.with_shared!<Clock>(|clock, scenario| {
                escrow::open_dispute(escrow, DISPUTED, REQUESTED_REFUND, clock, scenario.ctx());
            });
        });
        scenario.next_tx(BUYER);

        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, _scenario| {
            assert_eq!(escrow::status(escrow), 1);
            assert_eq!(escrow::total_amount(escrow), TOTAL);
            assert_eq!(escrow::disputed_amount(escrow), DISPUTED);
            assert_eq!(escrow::requested_buyer_refund(escrow), REQUESTED_REFUND);
            assert_eq!(escrow::funds_amount(escrow), TOTAL);
        });
        scenario.next_tx(SUPPLIER);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            escrow::release_undisputed(escrow, scenario.ctx());
        });
        let release_effects = scenario.next_tx(SUPPLIER);
        assert_eq!(release_effects.num_user_events(), 1);
        let undisputed_coin = scenario.take_from_sender<coin::Coin<TestUsdc>>();
        assert_eq!(undisputed_coin.value(), TOTAL - DISPUTED);
        undisputed_coin.burn_for_testing();

        scenario.next_tx(BUYER);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            escrow::approve_buyer(escrow, 12_000, 18_000, proposal_hash(), scenario.ctx());
        });
        scenario.next_tx(BUYER);

        scenario.next_tx(SUPPLIER);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            escrow::approve_supplier(escrow, 12_000, 18_000, proposal_hash(), scenario.ctx());
        });
        scenario.next_tx(SUPPLIER);

        scenario.next_tx(ARBITRATOR);
        let escrow = scenario.take_shared<Escrow<TestUsdc>>();
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::execute_settlement(escrow, clock, scenario.ctx());
        });
        let settle_effects = scenario.next_tx(ARBITRATOR);
        assert_eq!(settle_effects.num_user_events(), 1);

        scenario.next_tx(BUYER);
        let buyer_coin = scenario.take_from_sender<coin::Coin<TestUsdc>>();
        assert_eq!(buyer_coin.value(), 12_000);
        buyer_coin.burn_for_testing();

        scenario.next_tx(SUPPLIER);
        let supplier_coin = scenario.take_from_sender<coin::Coin<TestUsdc>>();
        assert_eq!(supplier_coin.value(), 18_000);
        supplier_coin.burn_for_testing();

        scenario.next_tx(ARBITRATOR);
        let receipt = scenario.take_shared<SettlementReceipt<TestUsdc>>();
        escrow::destroy_receipt_for_testing(receipt);
        scenario.end();
    }

    #[test]
    fun arbitrator_can_execute_when_one_party_does_not_approve() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        let payment = coin::mint_for_testing<TestUsdc>(TOTAL, scenario.ctx());
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::create(
                payment,
                SUPPLIER,
                ARBITRATOR,
                order_hash(),
                string::utf8(b"ORDER-ESCROW-2"),
                clock,
                scenario.ctx(),
            );
        });
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
        scenario.next_tx(BUYER);
        let buyer_coin = scenario.take_from_sender<coin::Coin<TestUsdc>>();
        assert_eq!(buyer_coin.value(), 15_000);
        buyer_coin.burn_for_testing();
        scenario.next_tx(SUPPLIER);
        let supplier_coin = scenario.take_from_sender<coin::Coin<TestUsdc>>();
        assert_eq!(supplier_coin.value(), 85_000);
        supplier_coin.burn_for_testing();
        scenario.next_tx(ARBITRATOR);
        let receipt = scenario.take_shared<SettlementReceipt<TestUsdc>>();
        escrow::destroy_receipt_for_testing(receipt);
        scenario.end();
    }

    #[test]
    fun buyer_can_confirm_without_a_dispute() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        let payment = coin::mint_for_testing<TestUsdc>(TOTAL, scenario.ctx());
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::create(
                payment,
                SUPPLIER,
                ARBITRATOR,
                order_hash(),
                string::utf8(b"ORDER-ESCROW-3"),
                clock,
                scenario.ctx(),
            );
        });
        scenario.next_tx(BUYER);
        let escrow = scenario.take_shared<Escrow<TestUsdc>>();
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::release_full(escrow, clock, scenario.ctx());
        });
        scenario.next_tx(SUPPLIER);
        let supplier_coin = scenario.take_from_sender<coin::Coin<TestUsdc>>();
        assert_eq!(supplier_coin.value(), TOTAL);
        supplier_coin.burn_for_testing();
        scenario.next_tx(BUYER);
        let receipt = scenario.take_shared<SettlementReceipt<TestUsdc>>();
        escrow::destroy_receipt_for_testing(receipt);
        scenario.end();
    }

    #[test, expected_failure(abort_code = escrow::E_UNAUTHORIZED)]
    fun only_buyer_can_open_a_dispute() {
        let mut scenario = ts::begin(BUYER);
        scenario.create_system_objects();
        let payment = coin::mint_for_testing<TestUsdc>(TOTAL, scenario.ctx());
        scenario.with_shared!<Clock>(|clock, scenario| {
            escrow::create(
                payment,
                SUPPLIER,
                ARBITRATOR,
                order_hash(),
                string::utf8(b"ORDER-ESCROW-4"),
                clock,
                scenario.ctx(),
            );
        });
        scenario.next_tx(SUPPLIER);
        scenario.with_shared!<Escrow<TestUsdc>>(|escrow, scenario| {
            scenario.with_shared!<Clock>(|clock, scenario| {
                escrow::open_dispute(escrow, 1, 1, clock, scenario.ctx());
            });
        });
        abort 99
    }
}
