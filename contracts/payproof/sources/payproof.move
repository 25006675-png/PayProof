/// Atomic Sui payments with privacy-preserving, payer-owned receipts.
module payproof::payproof {
    use std::string::String;
    use sui::clock::Clock;
    use sui::coin::Coin;
    use sui::event;

    const EZeroAmount: u64 = 0;
    const EInvalidOrderHash: u64 = 1;
    const EEmptyReference: u64 = 2;
    const EReferenceTooLong: u64 = 3;

    const SHA256_LENGTH: u64 = 32;
    const MAX_REFERENCE_LENGTH: u64 = 128;

    /// An immutable payment record owned by the payer.
    public struct PaymentReceipt<phantom T> has key, store {
        id: UID,
        payer: address,
        recipient: address,
        amount: u64,
        order_hash: vector<u8>,
        order_reference: String,
        paid_at_ms: u64,
    }

    /// Indexed proof emitted in the same transaction as the asset transfer.
    public struct PaymentRecorded<phantom T> has copy, drop {
        receipt_id: ID,
        payer: address,
        recipient: address,
        amount: u64,
        order_hash: vector<u8>,
        order_reference: String,
        paid_at_ms: u64,
    }

    /// Transfer any Sui coin and create its receipt atomically.
    #[allow(lint(self_transfer))]
    public fun pay<T>(
        payment: Coin<T>,
        recipient: address,
        order_hash: vector<u8>,
        order_reference: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = payment.value();
        assert!(amount > 0, EZeroAmount);
        assert!(order_hash.length() == SHA256_LENGTH, EInvalidOrderHash);

        let reference_length = order_reference.length();
        assert!(reference_length > 0, EEmptyReference);
        assert!(reference_length <= MAX_REFERENCE_LENGTH, EReferenceTooLong);

        let payer = ctx.sender();
        let paid_at_ms = clock.timestamp_ms();
        let receipt = PaymentReceipt<T> {
            id: object::new(ctx),
            payer,
            recipient,
            amount,
            order_hash,
            order_reference,
            paid_at_ms,
        };
        let receipt_id = object::id(&receipt);

        event::emit(PaymentRecorded<T> {
            receipt_id,
            payer,
            recipient,
            amount,
            order_hash: receipt.order_hash,
            order_reference: receipt.order_reference,
            paid_at_ms,
        });

        transfer::public_transfer(payment, recipient);
        transfer::public_transfer(receipt, payer);
    }

    public fun payer<T>(receipt: &PaymentReceipt<T>): address { receipt.payer }
    public fun recipient<T>(receipt: &PaymentReceipt<T>): address { receipt.recipient }
    public fun amount<T>(receipt: &PaymentReceipt<T>): u64 { receipt.amount }
    public fun order_hash<T>(receipt: &PaymentReceipt<T>): &vector<u8> { &receipt.order_hash }
    public fun order_reference<T>(receipt: &PaymentReceipt<T>): &String { &receipt.order_reference }
    public fun paid_at_ms<T>(receipt: &PaymentReceipt<T>): u64 { receipt.paid_at_ms }

    #[test_only]
    public fun destroy_for_testing<T>(receipt: PaymentReceipt<T>) {
        let PaymentReceipt {
            id,
            payer: _,
            recipient: _,
            amount: _,
            order_hash: _,
            order_reference: _,
            paid_at_ms: _,
        } = receipt;
        id.delete();
    }
}
