#[test_only]
module payproof::payproof_tests {
    use std::string;
    use std::unit_test::assert_eq;
    use sui::clock::Clock;
    use sui::coin;
    use sui::sui::SUI;
    use sui::test_scenario as ts;
    use payproof::payproof::{Self, PaymentReceipt};

    const PAYER: address = @0xA11CE;
    const RECIPIENT: address = @0xB0B;
    const AMOUNT: u64 = 2_500_000_000;

    public struct TestUsdc has drop {}

    #[test]
    fun payment_transfers_coin_and_creates_receipt() {
        let mut scenario = ts::begin(PAYER);
        scenario.create_system_objects();
        let payment = coin::mint_for_testing<SUI>(AMOUNT, scenario.ctx());
        let hash = vector::tabulate!(32, |_| 7u8);

        scenario.with_shared!<Clock>(|clock, scenario| {
            payproof::pay(
                payment,
                RECIPIENT,
                hash,
                string::utf8(b"ORDER-1042"),
                clock,
                scenario.ctx(),
            );
        });

        let effects = scenario.next_tx(PAYER);
        assert_eq!(effects.num_user_events(), 1);
        let receipt = scenario.take_from_sender<PaymentReceipt<SUI>>();
        assert_eq!(receipt.payer(), PAYER);
        assert_eq!(receipt.recipient(), RECIPIENT);
        assert_eq!(receipt.amount(), AMOUNT);
        assert_eq!(*receipt.order_hash(), vector::tabulate!(32, |_| 7u8));
        assert_eq!(receipt.paid_at_ms(), 0);
        payproof::destroy_for_testing(receipt);

        scenario.next_tx(RECIPIENT);
        let received = scenario.take_from_sender<coin::Coin<SUI>>();
        assert_eq!(received.value(), AMOUNT);
        received.burn_for_testing();
        scenario.end();
    }

    #[test, expected_failure(abort_code = payproof::EInvalidOrderHash)]
    fun rejects_non_sha256_order_hash() {
        let mut scenario = ts::begin(PAYER);
        scenario.create_system_objects();
        let payment = coin::mint_for_testing<SUI>(AMOUNT, scenario.ctx());

        scenario.with_shared!<Clock>(|clock, scenario| {
            payproof::pay(
                payment,
                RECIPIENT,
                vector::tabulate!(31, |_| 7u8),
                string::utf8(b"ORDER-INVALID"),
                clock,
                scenario.ctx(),
            );
        });
        abort 99
    }

    #[test]
    fun supports_stablecoin_types_without_asset_specific_logic() {
        let mut scenario = ts::begin(PAYER);
        scenario.create_system_objects();
        let payment = coin::mint_for_testing<TestUsdc>(25_000_000, scenario.ctx());

        scenario.with_shared!<Clock>(|clock, scenario| {
            payproof::pay(
                payment,
                RECIPIENT,
                vector::tabulate!(32, |_| 9u8),
                string::utf8(b"USDC-ORDER"),
                clock,
                scenario.ctx(),
            );
        });

        scenario.next_tx(PAYER);
        let receipt = scenario.take_from_sender<PaymentReceipt<TestUsdc>>();
        assert_eq!(receipt.amount(), 25_000_000);
        payproof::destroy_for_testing(receipt);

        scenario.next_tx(RECIPIENT);
        let received = scenario.take_from_sender<coin::Coin<TestUsdc>>();
        assert_eq!(received.value(), 25_000_000);
        received.burn_for_testing();
        scenario.end();
    }

    #[test, expected_failure(abort_code = payproof::EZeroAmount)]
    fun rejects_zero_amount() {
        let mut scenario = ts::begin(PAYER);
        scenario.create_system_objects();
        let payment = coin::zero<SUI>(scenario.ctx());
        scenario.with_shared!<Clock>(|clock, scenario| {
            payproof::pay(
                payment,
                RECIPIENT,
                vector::tabulate!(32, |_| 7u8),
                string::utf8(b"ZERO"),
                clock,
                scenario.ctx(),
            );
        });
        abort 99
    }

    #[test, expected_failure(abort_code = payproof::EEmptyReference)]
    fun rejects_empty_reference() {
        let mut scenario = ts::begin(PAYER);
        scenario.create_system_objects();
        let payment = coin::mint_for_testing<SUI>(AMOUNT, scenario.ctx());
        scenario.with_shared!<Clock>(|clock, scenario| {
            payproof::pay(
                payment,
                RECIPIENT,
                vector::tabulate!(32, |_| 7u8),
                string::utf8(b""),
                clock,
                scenario.ctx(),
            );
        });
        abort 99
    }

    #[test, expected_failure(abort_code = payproof::EReferenceTooLong)]
    fun rejects_reference_over_128_bytes() {
        let mut scenario = ts::begin(PAYER);
        scenario.create_system_objects();
        let payment = coin::mint_for_testing<SUI>(AMOUNT, scenario.ctx());
        let reference = vector::tabulate!(129, |_| 65u8);
        scenario.with_shared!<Clock>(|clock, scenario| {
            payproof::pay(
                payment,
                RECIPIENT,
                vector::tabulate!(32, |_| 7u8),
                string::utf8(reference),
                clock,
                scenario.ctx(),
            );
        });
        abort 99
    }
}
