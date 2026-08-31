import {
  acceptProposal, arbitratorInstruct, buildArbitrationPackage, confirmSettlementExecution, counterProposal,
  enforceDeadline, openDispute, recordAiProposal, recordMediationAbstention, rejectProposal, submitEarlyPosition,
  submitHumanProposal, supplierRespond, type OpenDisputeInput, type ProposalInput,
} from "../domain/dispute-machine.js";
import { DomainError, type Actor, type DisputeAggregate, type DomainContext, type EvidenceFile, type MediationRun, type Proposal } from "../domain/types.js";
import type { DisputeStore } from "../store/store.js";
import type { SettlementExecution } from "../domain/types.js";

export class DisputeService {
  constructor(private readonly store: DisputeStore, private readonly ctx: DomainContext) {}

  async open(input: OpenDisputeInput, actor: Actor): Promise<DisputeAggregate> {
    if (input.onchainEscrow && await this.store.findByEscrowObjectId(input.onchainEscrow.escrowObjectId)) {
      throw new DomainError("ESCROW_ALREADY_BOUND", "This Sui escrow is already bound to another dispute", 409);
    }
    const dispute = openDispute(input, actor, this.ctx);
    await this.store.create(dispute);
    return dispute;
  }

  async get(id: string): Promise<DisputeAggregate> {
    const dispute = await this.store.get(id);
    if (!dispute) throw new DomainError("NOT_FOUND", "Dispute not found", 404);
    return dispute;
  }

  private async update(id: string, fn: (dispute: DisputeAggregate) => DisputeAggregate): Promise<DisputeAggregate> {
    const current = await this.get(id);
    const updated = fn(current);
    await this.store.save(updated, current.version);
    return updated;
  }

  respond(id: string, actor: Actor, response: { agrees: boolean; statement?: string; files?: EvidenceFile[] }) {
    return this.update(id, (d) => supplierRespond(d, actor, response, this.ctx));
  }
  propose(id: string, actor: Actor, input: ProposalInput) {
    return this.update(id, (d) => submitHumanProposal(d, actor, input, this.ctx));
  }
  recordAi(id: string, proposal: Proposal, run?: MediationRun) {
    return this.update(id, (d) => recordAiProposal(d, proposal, this.ctx, run));
  }
  recordAiAbstention(id: string, run: MediationRun) {
    return this.update(id, (d) => recordMediationAbstention(d, run, this.ctx));
  }
  accept(id: string, actor: Actor, proposalId: string) {
    return this.update(id, (d) => acceptProposal(d, actor, proposalId, this.ctx));
  }
  reject(id: string, actor: Actor, proposalId: string) {
    return this.update(id, (d) => rejectProposal(d, actor, proposalId, this.ctx));
  }
  counter(id: string, actor: Actor, proposalId: string, input: ProposalInput) {
    return this.update(id, (d) => counterProposal(d, actor, proposalId, input, this.ctx));
  }
  enforceDeadline(id: string) {
    return this.update(id, (d) => enforceDeadline(d, this.ctx));
  }
  earlyPosition(id: string, actor: Actor, input: ProposalInput) {
    return this.update(id, (d) => submitEarlyPosition(d, actor, input, this.ctx));
  }
  decide(id: string, actor: Actor, input: ProposalInput) {
    return this.update(id, (d) => arbitratorInstruct(d, actor, input, this.ctx));
  }
  confirmSettlement(id: string, execution: Omit<SettlementExecution, "verifiedAt">) {
    return this.update(id, (d) => confirmSettlementExecution(d, execution, this.ctx));
  }
  async arbitrationPackage(id: string, actor: Actor) {
    const dispute = await this.get(id);
    if (actor.id !== dispute.arbitratorId && actor.id !== dispute.buyerId && actor.id !== dispute.supplierId) {
      throw new DomainError("FORBIDDEN", "Actor cannot access this arbitration package", 403);
    }
    return buildArbitrationPackage(dispute, this.ctx);
  }
}

export const systemContext: DomainContext = {
  now: () => new Date(),
  id: () => crypto.randomUUID(),
};
