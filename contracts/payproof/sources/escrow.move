/// Shared-object escrow for a single fungible asset type.
///
/// Deliberation and evidence stay off-chain. This module only holds funds and
/// executes a settlement after the designated parties have approved the exact
/// same allocation. A trusted backend can verify the resulting receipt object.
module payproof::escrow {
    use std::string::String;
    use sui::balance::{Self, Balance};
    use sui::clock::Clock;
    use sui::coin::{Self, Coin};
    use sui::event;

    const E_ZERO_AMOUNT: u64 = 0;
    const E_INVALID_ORDER_HASH: u64 = 1;
    const E_EMPTY_REFERENCE: u64 = 2;
    const E_REFERENCE_TOO_LONG: u64 = 3;
    const E_INVALID_PARTIES: u64 = 4;
    const E_INVALID_STATE: u64 = 5;
    const E_INVALID_DISPUTE: u64 = 6;
    const E_UNAUTHORIZED: u64 = 7;
    const E_ALREADY_RELEASED: u64 = 8;
    const E_INVALID_ALLOCATION: u64 = 9;
    const E_APPROVAL_MISMATCH: u64 = 10;
    const E_APPROVAL_REQUIRED: u64 = 11;
    const E_FUNDS_NOT_READY: u64 = 12;
    const E_INVALID_PROPOSAL_HASH: u64 = 13;

    const SHA256_LENGTH: u64 = 32;
    const MAX_REFERENCE_LENGTH: u64 = 128;

    const STATUS_OPEN: u8 = 0;
    const STATUS_DISPUTED: u8 = 1;

    /// A mutable shared escrow. `funds` is a Balance so it cannot be directly
    /// transferred without passing through one of the guarded entry points.
    public struct Escrow<phantom T> has key {
        id: object::UID,
        buyer: address,
        supplier: address,
        arbitrator: address,
        total_amount: u64,
        disputed_amount: u64,
        requested_buyer_refund: u64,
        funds: Balance<T>,
        order_hash: vector<u8>,
        order_reference: String,
        opened_at_ms: u64,
        status: u8,
        undisputed_released: bool,
        buyer_approved: bool,
        supplier_approved: bool,
        arbitrator_approved: bool,
        approved_buyer_refund: u64,
        approved_supplier_release: u64,
        proposal_hash: vector<u8>,
    }

    /// Public immutable receipt shared after a successful execution.
    public struct SettlementReceipt<phantom T> has key, store {
        id: object::UID,
        escrow_id: object::ID,
        buyer: address,
        supplier: address,
        buyer_refund: u64,
        supplier_release: u64,
        order_hash: vector<u8>,
        proposal_hash: vector<u8>,
        settled_at_ms: u64,
        /// 0 = normal buyer confirmation, 1 = mutual approval, 2 = arbitrator.
        approval_mode: u8,
    }

    public struct EscrowCreated<phantom T> has copy, drop {
        escrow_id: object::ID,
        buyer: address,
        supplier: address,
        arbitrator: address,
        amount: u64,
        order_hash: vector<u8>,
        order_reference: String,
        created_at_ms: u64,
    }

    public struct DisputeOpened<phantom T> has copy, drop {
        escrow_id: object::ID,
        disputed_amount: u64,
        requested_buyer_refund: u64,
        opened_at_ms: u64,
    }

    public struct UndisputedReleased<phantom T> has copy, drop {
        escrow_id: object::ID,
        supplier: address,
        amount: u64,
    }

    public struct SettlementExecuted<phantom T> has copy, drop {
        escrow_id: object::ID,
        receipt_id: object::ID,
        buyer: address,
        supplier: address,
        buyer_refund: u64,
        supplier_release: u64,
        proposal_hash: vector<u8>,
        settled_at_ms: u64,
        approval_mode: u8,
    }

    /// Deposit the whole payment into a shared escrow object.
    public entry fun create<T>(
        payment: Coin<T>,
        supplier: address,
        arbitrator: address,
        order_hash: vector<u8>,
        order_reference: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let buyer = ctx.sender();
        let amount = payment.value();
        assert!(amount > 0, E_ZERO_AMOUNT);
        assert!(order_hash.length() == SHA256_LENGTH, E_INVALID_ORDER_HASH);
        assert!(order_reference.length() > 0, E_EMPTY_REFERENCE);
        assert!(order_reference.length() <= MAX_REFERENCE_LENGTH, E_REFERENCE_TOO_LONG);
        assert!(buyer != supplier && buyer != arbitrator && supplier != arbitrator, E_INVALID_PARTIES);

        let escrow = Escrow<T> {
            id: object::new(ctx),
            buyer,
            supplier,
            arbitrator,
            total_amount: amount,
            disputed_amount: 0,
            requested_buyer_refund: 0,
            funds: coin::into_balance(payment),
            order_hash,
            order_reference,
            opened_at_ms: clock.timestamp_ms(),
            status: STATUS_OPEN,
            undisputed_released: false,
            buyer_approved: false,
            supplier_approved: false,
            arbitrator_approved: false,
            approved_buyer_refund: 0,
            approved_supplier_release: 0,
            proposal_hash: vector[],
        };
        let escrow_id = object::id(&escrow);
        event::emit(EscrowCreated<T> {
            escrow_id,
            buyer,
            supplier,
            arbitrator,
            amount,
            order_hash: escrow.order_hash,
            order_reference: escrow.order_reference,
            created_at_ms: escrow.opened_at_ms,
        });
        transfer::share_object(escrow);
    }

    /// Buyer freezes only the disputed portion. The undisputed portion remains
    /// available for the supplier to release with `release_undisputed`.
    public entry fun open_dispute<T>(
        escrow: &mut Escrow<T>,
        disputed_amount: u64,
        requested_buyer_refund: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == escrow.buyer, E_UNAUTHORIZED);
        assert!(escrow.status == STATUS_OPEN, E_INVALID_STATE);
        assert!(disputed_amount > 0 && disputed_amount <= escrow.total_amount, E_INVALID_DISPUTE);
        assert!(requested_buyer_refund <= disputed_amount, E_INVALID_DISPUTE);
        escrow.disputed_amount = disputed_amount;
        escrow.requested_buyer_refund = requested_buyer_refund;
        escrow.status = STATUS_DISPUTED;
        event::emit(DisputeOpened<T> {
            escrow_id: object::id(escrow),
            disputed_amount,
            requested_buyer_refund,
            opened_at_ms: clock.timestamp_ms(),
        });
    }

    /// Supplier receives the undisputed balance exactly once.
    public entry fun release_undisputed<T>(
        escrow: &mut Escrow<T>,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == escrow.supplier, E_UNAUTHORIZED);
        assert!(escrow.status == STATUS_DISPUTED, E_INVALID_STATE);
        assert!(!escrow.undisputed_released, E_ALREADY_RELEASED);
        let amount = escrow.total_amount - escrow.disputed_amount;
        escrow.undisputed_released = true;
        if (amount > 0) {
            let payout = coin::from_balance(balance::split(&mut escrow.funds, amount), ctx);
            transfer::public_transfer(payout, escrow.supplier);
        };
        event::emit(UndisputedReleased<T> {
            escrow_id: object::id(escrow),
            supplier: escrow.supplier,
            amount,
        });
    }

    fun validate_allocation<T>(escrow: &Escrow<T>, buyer_refund: u64, supplier_release: u64, proposal_hash: &vector<u8>) {
        assert!(proposal_hash.length() == SHA256_LENGTH, E_INVALID_PROPOSAL_HASH);
        assert!(buyer_refund <= escrow.requested_buyer_refund, E_INVALID_ALLOCATION);
        assert!(buyer_refund + supplier_release == escrow.disputed_amount, E_INVALID_ALLOCATION);
    }

    /// Buyer signs the exact allocation and proposal hash.
    public entry fun approve_buyer<T>(
        escrow: &mut Escrow<T>,
        buyer_refund: u64,
        supplier_release: u64,
        proposal_hash: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == escrow.buyer, E_UNAUTHORIZED);
        assert!(escrow.status == STATUS_DISPUTED, E_INVALID_STATE);
        validate_allocation(escrow, buyer_refund, supplier_release, &proposal_hash);
        if (escrow.supplier_approved || escrow.arbitrator_approved) {
            assert!(escrow.approved_buyer_refund == buyer_refund && escrow.approved_supplier_release == supplier_release && escrow.proposal_hash == proposal_hash, E_APPROVAL_MISMATCH);
        };
        escrow.buyer_approved = true;
        escrow.approved_buyer_refund = buyer_refund;
        escrow.approved_supplier_release = supplier_release;
        escrow.proposal_hash = proposal_hash;
    }

    /// Supplier signs the same allocation and proposal hash.
    public entry fun approve_supplier<T>(
        escrow: &mut Escrow<T>,
        buyer_refund: u64,
        supplier_release: u64,
        proposal_hash: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == escrow.supplier, E_UNAUTHORIZED);
        assert!(escrow.status == STATUS_DISPUTED, E_INVALID_STATE);
        validate_allocation(escrow, buyer_refund, supplier_release, &proposal_hash);
        if (escrow.buyer_approved || escrow.arbitrator_approved) {
            assert!(escrow.approved_buyer_refund == buyer_refund && escrow.approved_supplier_release == supplier_release && escrow.proposal_hash == proposal_hash, E_APPROVAL_MISMATCH);
        };
        escrow.supplier_approved = true;
        escrow.approved_buyer_refund = buyer_refund;
        escrow.approved_supplier_release = supplier_release;
        escrow.proposal_hash = proposal_hash;
    }

    /// Arbitrator signs a final allocation; this bypasses mutual approval.
    public entry fun approve_arbitrator<T>(
        escrow: &mut Escrow<T>,
        buyer_refund: u64,
        supplier_release: u64,
        proposal_hash: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == escrow.arbitrator, E_UNAUTHORIZED);
        assert!(escrow.status == STATUS_DISPUTED, E_INVALID_STATE);
        validate_allocation(escrow, buyer_refund, supplier_release, &proposal_hash);
        escrow.arbitrator_approved = true;
        escrow.approved_buyer_refund = buyer_refund;
        escrow.approved_supplier_release = supplier_release;
        escrow.proposal_hash = proposal_hash;
    }

    /// Execute a mutual or arbitrator-approved settlement and share an immutable receipt.
    public entry fun execute_settlement<T>(
        escrow: Escrow<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(escrow.status == STATUS_DISPUTED, E_INVALID_STATE);
        assert!(escrow.undisputed_released || escrow.total_amount == escrow.disputed_amount, E_FUNDS_NOT_READY);
        assert!(escrow.arbitrator_approved || (escrow.buyer_approved && escrow.supplier_approved), E_APPROVAL_REQUIRED);
        assert!(balance::value(&escrow.funds) == escrow.disputed_amount, E_FUNDS_NOT_READY);

        let escrow_id = object::id(&escrow);
        let buyer = escrow.buyer;
        let supplier = escrow.supplier;
        let buyer_refund = escrow.approved_buyer_refund;
        let supplier_release = escrow.approved_supplier_release;
        let order_hash = escrow.order_hash;
        let proposal_hash = escrow.proposal_hash;
        let settled_at_ms = clock.timestamp_ms();
        let approval_mode = if (escrow.arbitrator_approved) { 2 } else { 1 };
        let Escrow {
            id,
            buyer: _,
            supplier: _,
            arbitrator: _,
            total_amount: _,
            disputed_amount: _,
            requested_buyer_refund: _,
            funds,
            order_hash: _,
            order_reference: _,
            opened_at_ms: _,
            status: _,
            undisputed_released: _,
            buyer_approved: _,
            supplier_approved: _,
            arbitrator_approved: _,
            approved_buyer_refund: _,
            approved_supplier_release: _,
            proposal_hash: _,
        } = escrow;
        let mut funds = funds;
        let buyer_coin = coin::from_balance(balance::split(&mut funds, buyer_refund), ctx);
        let supplier_coin = coin::from_balance(balance::split(&mut funds, supplier_release), ctx);
        balance::destroy_zero(funds);
        object::delete(id);
        transfer::public_transfer(buyer_coin, buyer);
        transfer::public_transfer(supplier_coin, supplier);

        let receipt = SettlementReceipt<T> {
            id: object::new(ctx),
            escrow_id,
            buyer,
            supplier,
            buyer_refund,
            supplier_release,
            order_hash,
            proposal_hash,
            settled_at_ms,
            approval_mode,
        };
        let receipt_id = object::id(&receipt);
        event::emit(SettlementExecuted<T> {
            escrow_id,
            receipt_id,
            buyer,
            supplier,
            buyer_refund,
            supplier_release,
            proposal_hash: receipt.proposal_hash,
            settled_at_ms,
            approval_mode,
        });
        transfer::share_object(receipt);
    }

    /// Non-disputed buyer confirmation releases the complete escrow to supplier.
    public entry fun release_full<T>(
        escrow: Escrow<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == escrow.buyer, E_UNAUTHORIZED);
        assert!(escrow.status == STATUS_OPEN, E_INVALID_STATE);
        let escrow_id = object::id(&escrow);
        let supplier = escrow.supplier;
        let buyer = escrow.buyer;
        let amount = balance::value(&escrow.funds);
        let order_hash = escrow.order_hash;
        let settled_at_ms = clock.timestamp_ms();
        let Escrow {
            id,
            buyer: _,
            supplier: _,
            arbitrator: _,
            total_amount: _,
            disputed_amount: _,
            requested_buyer_refund: _,
            funds,
            order_hash: _,
            order_reference: _,
            opened_at_ms: _,
            status: _,
            undisputed_released: _,
            buyer_approved: _,
            supplier_approved: _,
            arbitrator_approved: _,
            approved_buyer_refund: _,
            approved_supplier_release: _,
            proposal_hash: _,
        } = escrow;
        let payout = coin::from_balance(funds, ctx);
        object::delete(id);
        transfer::public_transfer(payout, supplier);
        let receipt = SettlementReceipt<T> {
            id: object::new(ctx),
            escrow_id,
            buyer,
            supplier,
            buyer_refund: 0,
            supplier_release: amount,
            order_hash,
            proposal_hash: vector[],
            settled_at_ms,
            approval_mode: 0,
        };
        transfer::share_object(receipt);
    }

    public fun escrow_id<T>(escrow: &Escrow<T>): object::ID { object::id(escrow) }
    public fun buyer<T>(escrow: &Escrow<T>): address { escrow.buyer }
    public fun supplier<T>(escrow: &Escrow<T>): address { escrow.supplier }
    public fun arbitrator<T>(escrow: &Escrow<T>): address { escrow.arbitrator }
    public fun total_amount<T>(escrow: &Escrow<T>): u64 { escrow.total_amount }
    public fun disputed_amount<T>(escrow: &Escrow<T>): u64 { escrow.disputed_amount }
    public fun requested_buyer_refund<T>(escrow: &Escrow<T>): u64 { escrow.requested_buyer_refund }
    public fun funds_amount<T>(escrow: &Escrow<T>): u64 { balance::value(&escrow.funds) }
    public fun status<T>(escrow: &Escrow<T>): u8 { escrow.status }
    public fun undisputed_released<T>(escrow: &Escrow<T>): bool { escrow.undisputed_released }
    public fun buyer_approved<T>(escrow: &Escrow<T>): bool { escrow.buyer_approved }
    public fun supplier_approved<T>(escrow: &Escrow<T>): bool { escrow.supplier_approved }
    public fun arbitrator_approved<T>(escrow: &Escrow<T>): bool { escrow.arbitrator_approved }
    public fun approved_buyer_refund<T>(escrow: &Escrow<T>): u64 { escrow.approved_buyer_refund }
    public fun approved_supplier_release<T>(escrow: &Escrow<T>): u64 { escrow.approved_supplier_release }

    #[test_only]
    public fun destroy_receipt_for_testing<T>(receipt: SettlementReceipt<T>) {
        let SettlementReceipt {
            id,
            escrow_id: _, buyer: _, supplier: _, buyer_refund: _, supplier_release: _,
            order_hash: _, proposal_hash: _, settled_at_ms: _, approval_mode: _,
        } = receipt;
        id.delete();
    }
}
