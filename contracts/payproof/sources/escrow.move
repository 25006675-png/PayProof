/// Shared-object escrow for a single fungible asset type.
///
/// Deliberation and evidence stay off-chain. This module holds funds, records
/// shipment and evidence fingerprints, pays undisputed value the moment the
/// buyer records an exception, and settles the disputed remainder once the
/// designated parties have approved the exact same allocation. Two deadline
/// paths stop either party from holding the other hostage: the buyer reclaims
/// an escrow that was never shipped, and the supplier claims an escrow the
/// buyer never inspected. A trusted backend can verify the receipt object.
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
    const E_ALREADY_SHIPPED: u64 = 8;
    const E_INVALID_ALLOCATION: u64 = 9;
    const E_APPROVAL_MISMATCH: u64 = 10;
    const E_APPROVAL_REQUIRED: u64 = 11;
    const E_FUNDS_NOT_READY: u64 = 12;
    const E_INVALID_PROPOSAL_HASH: u64 = 13;
    const E_INVALID_DEADLINE: u64 = 14;
    const E_INVALID_EVIDENCE_HASH: u64 = 15;
    const E_DEADLINE_NOT_REACHED: u64 = 16;
    const E_NOT_SHIPPED: u64 = 17;

    const SHA256_LENGTH: u64 = 32;
    const MAX_REFERENCE_LENGTH: u64 = 128;

    const STATUS_OPEN: u8 = 0;
    const STATUS_DISPUTED: u8 = 1;

    /// How a settlement receipt came about.
    const MODE_BUYER_CONFIRMATION: u8 = 0;
    const MODE_MUTUAL_APPROVAL: u8 = 1;
    const MODE_ARBITRATOR: u8 = 2;
    const MODE_REFUND_UNSHIPPED: u8 = 3;
    const MODE_CLAIM_UNINSPECTED: u8 = 4;

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
        /// The supplier must mark shipment by this time or the buyer may reclaim the escrow.
        delivery_deadline_ms: u64,
        /// How long after the later of shipment and the delivery deadline the buyer has to
        /// accept or dispute before the supplier may claim the escrow.
        inspection_window_ms: u64,
        shipped: bool,
        shipped_at_ms: u64,
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
        /// 0 = buyer confirmation, 1 = mutual approval, 2 = arbitrator,
        /// 3 = refund after the delivery deadline, 4 = supplier claim after the inspection window.
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
        delivery_deadline_ms: u64,
        inspection_window_ms: u64,
    }

    public struct Shipped<phantom T> has copy, drop {
        escrow_id: object::ID,
        supplier: address,
        shipped_at_ms: u64,
    }

    /// A document fingerprint bound to the escrow by one of its parties.
    public struct EvidenceAnchored<phantom T> has copy, drop {
        escrow_id: object::ID,
        party: address,
        kind: u8,
        evidence_hash: vector<u8>,
        anchored_at_ms: u64,
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
        delivery_deadline_ms: u64,
        inspection_window_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let buyer = ctx.sender();
        let amount = payment.value();
        let now = clock.timestamp_ms();
        assert!(amount > 0, E_ZERO_AMOUNT);
        assert!(order_hash.length() == SHA256_LENGTH, E_INVALID_ORDER_HASH);
        assert!(order_reference.length() > 0, E_EMPTY_REFERENCE);
        assert!(order_reference.length() <= MAX_REFERENCE_LENGTH, E_REFERENCE_TOO_LONG);
        assert!(buyer != supplier && buyer != arbitrator && supplier != arbitrator, E_INVALID_PARTIES);
        assert!(delivery_deadline_ms > now && inspection_window_ms > 0, E_INVALID_DEADLINE);

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
            opened_at_ms: now,
            delivery_deadline_ms,
            inspection_window_ms,
            shipped: false,
            shipped_at_ms: 0,
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
            created_at_ms: now,
            delivery_deadline_ms,
            inspection_window_ms,
        });
        transfer::share_object(escrow);
    }

    /// Supplier records dispatch. From here the buyer can no longer reclaim the
    /// escrow as unshipped, and the inspection window starts counting.
    public entry fun mark_shipped<T>(
        escrow: &mut Escrow<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == escrow.supplier, E_UNAUTHORIZED);
        assert!(escrow.status == STATUS_OPEN, E_INVALID_STATE);
        assert!(!escrow.shipped, E_ALREADY_SHIPPED);
        let now = clock.timestamp_ms();
        escrow.shipped = true;
        escrow.shipped_at_ms = now;
        event::emit(Shipped<T> { escrow_id: object::id(escrow), supplier: escrow.supplier, shipped_at_ms: now });
    }

    /// Either party binds a document fingerprint to the escrow. The file stays
    /// off-chain; substituting it later no longer matches this hash.
    public entry fun anchor_evidence<T>(
        escrow: &Escrow<T>,
        kind: u8,
        evidence_hash: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let party = ctx.sender();
        assert!(party == escrow.buyer || party == escrow.supplier, E_UNAUTHORIZED);
        assert!(evidence_hash.length() == SHA256_LENGTH, E_INVALID_EVIDENCE_HASH);
        event::emit(EvidenceAnchored<T> {
            escrow_id: object::id(escrow),
            party,
            kind,
            evidence_hash,
            anchored_at_ms: clock.timestamp_ms(),
        });
    }

    /// Buyer records an exception. Only the disputed portion stays locked: the
    /// undisputed balance is paid to the supplier in this same transaction.
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
        let escrow_id = object::id(escrow);
        event::emit(DisputeOpened<T> {
            escrow_id,
            disputed_amount,
            requested_buyer_refund,
            opened_at_ms: clock.timestamp_ms(),
        });
        let undisputed = escrow.total_amount - disputed_amount;
        escrow.undisputed_released = true;
        if (undisputed > 0) {
            let payout = coin::from_balance(balance::split(&mut escrow.funds, undisputed), ctx);
            transfer::public_transfer(payout, escrow.supplier);
        };
        event::emit(UndisputedReleased<T> { escrow_id, supplier: escrow.supplier, amount: undisputed });
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
        assert!(escrow.undisputed_released, E_FUNDS_NOT_READY);
        assert!(escrow.arbitrator_approved || (escrow.buyer_approved && escrow.supplier_approved), E_APPROVAL_REQUIRED);
        assert!(balance::value(&escrow.funds) == escrow.disputed_amount, E_FUNDS_NOT_READY);
        let approval_mode = if (escrow.arbitrator_approved) { MODE_ARBITRATOR } else { MODE_MUTUAL_APPROVAL };
        let buyer_refund = escrow.approved_buyer_refund;
        let supplier_release = escrow.approved_supplier_release;
        settle(escrow, buyer_refund, supplier_release, approval_mode, clock, ctx);
    }

    /// Non-disputed buyer confirmation releases the complete escrow to the supplier.
    public entry fun release_full<T>(
        escrow: Escrow<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == escrow.buyer, E_UNAUTHORIZED);
        assert!(escrow.status == STATUS_OPEN, E_INVALID_STATE);
        let amount = balance::value(&escrow.funds);
        settle(escrow, 0, amount, MODE_BUYER_CONFIRMATION, clock, ctx);
    }

    /// The supplier never marked shipment and the delivery deadline has passed:
    /// the buyer takes the whole escrow back without anyone else's signature.
    public entry fun refund_unshipped<T>(
        escrow: Escrow<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == escrow.buyer, E_UNAUTHORIZED);
        assert!(escrow.status == STATUS_OPEN, E_INVALID_STATE);
        assert!(!escrow.shipped, E_ALREADY_SHIPPED);
        assert!(clock.timestamp_ms() > escrow.delivery_deadline_ms, E_DEADLINE_NOT_REACHED);
        let amount = balance::value(&escrow.funds);
        settle(escrow, amount, 0, MODE_REFUND_UNSHIPPED, clock, ctx);
    }

    /// The goods were shipped and the buyer neither accepted nor disputed within
    /// the inspection window: the supplier claims the whole escrow.
    public entry fun claim_uninspected<T>(
        escrow: Escrow<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == escrow.supplier, E_UNAUTHORIZED);
        assert!(escrow.status == STATUS_OPEN, E_INVALID_STATE);
        assert!(escrow.shipped, E_NOT_SHIPPED);
        assert!(clock.timestamp_ms() > inspection_closes_at_ms(&escrow), E_DEADLINE_NOT_REACHED);
        let amount = balance::value(&escrow.funds);
        settle(escrow, 0, amount, MODE_CLAIM_UNINSPECTED, clock, ctx);
    }

    /// Pays out the remaining balance, deletes the escrow, and shares the receipt.
    fun settle<T>(
        escrow: Escrow<T>,
        buyer_refund: u64,
        supplier_release: u64,
        approval_mode: u8,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let escrow_id = object::id(&escrow);
        let settled_at_ms = clock.timestamp_ms();
        let Escrow {
            id,
            buyer,
            supplier,
            arbitrator: _,
            total_amount: _,
            disputed_amount: _,
            requested_buyer_refund: _,
            funds,
            order_hash,
            order_reference: _,
            opened_at_ms: _,
            delivery_deadline_ms: _,
            inspection_window_ms: _,
            shipped: _,
            shipped_at_ms: _,
            status: _,
            undisputed_released: _,
            buyer_approved: _,
            supplier_approved: _,
            arbitrator_approved: _,
            approved_buyer_refund: _,
            approved_supplier_release: _,
            proposal_hash,
        } = escrow;
        let mut funds = funds;
        assert!(balance::value(&funds) == buyer_refund + supplier_release, E_FUNDS_NOT_READY);
        if (buyer_refund > 0) {
            transfer::public_transfer(coin::from_balance(balance::split(&mut funds, buyer_refund), ctx), buyer);
        };
        if (supplier_release > 0) {
            transfer::public_transfer(coin::from_balance(balance::split(&mut funds, supplier_release), ctx), supplier);
        };
        balance::destroy_zero(funds);
        object::delete(id);

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
        event::emit(SettlementExecuted<T> {
            escrow_id,
            receipt_id: object::id(&receipt),
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

    /// The later of shipment and the agreed delivery deadline, plus the inspection window.
    public fun inspection_closes_at_ms<T>(escrow: &Escrow<T>): u64 {
        let start = if (escrow.shipped_at_ms > escrow.delivery_deadline_ms) { escrow.shipped_at_ms } else { escrow.delivery_deadline_ms };
        start + escrow.inspection_window_ms
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
    public fun delivery_deadline_ms<T>(escrow: &Escrow<T>): u64 { escrow.delivery_deadline_ms }
    public fun inspection_window_ms<T>(escrow: &Escrow<T>): u64 { escrow.inspection_window_ms }
    public fun shipped<T>(escrow: &Escrow<T>): bool { escrow.shipped }
    public fun shipped_at_ms<T>(escrow: &Escrow<T>): u64 { escrow.shipped_at_ms }
    public fun undisputed_released<T>(escrow: &Escrow<T>): bool { escrow.undisputed_released }
    public fun buyer_approved<T>(escrow: &Escrow<T>): bool { escrow.buyer_approved }
    public fun supplier_approved<T>(escrow: &Escrow<T>): bool { escrow.supplier_approved }
    public fun arbitrator_approved<T>(escrow: &Escrow<T>): bool { escrow.arbitrator_approved }
    public fun approved_buyer_refund<T>(escrow: &Escrow<T>): u64 { escrow.approved_buyer_refund }
    public fun approved_supplier_release<T>(escrow: &Escrow<T>): u64 { escrow.approved_supplier_release }
    public fun receipt_approval_mode<T>(receipt: &SettlementReceipt<T>): u8 { receipt.approval_mode }
    public fun receipt_buyer_refund<T>(receipt: &SettlementReceipt<T>): u64 { receipt.buyer_refund }
    public fun receipt_supplier_release<T>(receipt: &SettlementReceipt<T>): u64 { receipt.supplier_release }

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
