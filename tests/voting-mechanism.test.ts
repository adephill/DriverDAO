import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, booleanCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_PROPOSAL_TITLE = 101;
const ERR_INVALID_PROPOSAL_DESC = 102;
const ERR_INVALID_DURATION = 103;
const ERR_PROPOSAL_ALREADY_EXISTS = 104;
const ERR_PROPOSAL_NOT_FOUND = 105;
const ERR_VOTING_NOT_OPEN = 106;
const ERR_ALREADY_VOTED = 107;
const ERR_INSUFFICIENT_BALANCE = 108;
const ERR_INVALID_AMOUNT = 109;
const ERR_QUORUM_NOT_MET = 110;
const ERR_TIMELOCK_ACTIVE = 111;
const ERR_NOT_PASSED = 112;
const ERR_ALREADY_EXECUTED = 113;
const ERR_INVALID_QUORUM = 114;
const ERR_INVALID_TIMELOCK = 115;

interface Proposal {
  title: string;
  description: string;
  yesVotes: number;
  noVotes: number;
  startTime: number;
  endTime: number;
  creator: string;
  executed: boolean;
  passed?: boolean;
}

interface Vote {
  amount: number;
  support: boolean;
  timestamp: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class VotingMechanismMock {
  state: {
    nextProposalId: number;
    quorumThreshold: number;
    timelockDuration: number;
    totalVotingPower: number;
    authorityContract: string | null;
    proposals: Map<number, Proposal>;
    votes: Map<string, Vote>;
  } = {
    nextProposalId: 0,
    quorumThreshold: 51,
    timelockDuration: 10,
    totalVotingPower: 1000000,
    authorityContract: null,
    proposals: new Map(),
    votes: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorities: Set<string> = new Set(["ST1TEST"]);

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextProposalId: 0,
      quorumThreshold: 51,
      timelockDuration: 10,
      totalVotingPower: 1000000,
      authorityContract: null,
      proposals: new Map(),
      votes: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setQuorumThreshold(newThreshold: number): Result<boolean> {
    if (newThreshold <= 0 || newThreshold > 100) return { ok: false, value: false };
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.quorumThreshold = newThreshold;
    return { ok: true, value: true };
  }

  setTimelockDuration(newDuration: number): Result<boolean> {
    if (newDuration <= 0) return { ok: false, value: false };
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.timelockDuration = newDuration;
    return { ok: true, value: true };
  }

  createProposal(title: string, description: string, duration: number): Result<number> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (title.length === 0 || title.length > 100) return { ok: false, value: ERR_INVALID_PROPOSAL_TITLE };
    if (description.length === 0 || description.length > 200) return { ok: false, value: ERR_INVALID_PROPOSAL_DESC };
    if (duration <= 0 || duration > 100) return { ok: false, value: ERR_INVALID_DURATION };
    if (this.state.proposals.has(this.state.nextProposalId)) return { ok: false, value: ERR_PROPOSAL_ALREADY_EXISTS };

    const id = this.state.nextProposalId;
    const proposal: Proposal = {
      title,
      description,
      yesVotes: 0,
      noVotes: 0,
      startTime: this.blockHeight,
      endTime: this.blockHeight + duration,
      creator: this.caller,
      executed: false,
    };
    this.state.proposals.set(id, proposal);
    this.state.nextProposalId++;
    return { ok: true, value: id };
  }

  vote(proposalId: number, amount: number, support: boolean): Result<boolean> {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) return { ok: false, value: ERR_PROPOSAL_NOT_FOUND };
    const voteKey = `${proposalId}-${this.caller}`;
    if (this.state.votes.has(voteKey)) return { ok: false, value: ERR_ALREADY_VOTED };
    const currentTime = this.blockHeight;
    if (currentTime < proposal.startTime || currentTime > proposal.endTime) return { ok: false, value: ERR_VOTING_NOT_OPEN };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (this.state.totalVotingPower < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };

    const newYes = support ? proposal.yesVotes + amount : proposal.yesVotes;
    const newNo = !support ? proposal.noVotes + amount : proposal.noVotes;
    this.state.proposals.set(proposalId, { ...proposal, yesVotes: newYes, noVotes: newNo });
    this.state.votes.set(voteKey, { amount, support, timestamp: currentTime });
    return { ok: true, value: true };
  }

  executeProposal(proposalId: number): Result<boolean> {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) return { ok: false, value: ERR_PROPOSAL_NOT_FOUND };
    if (proposal.executed) return { ok: false, value: ERR_ALREADY_EXECUTED };
    const currentTime = this.blockHeight;
    const timelockEnd = proposal.endTime + this.state.timelockDuration;
    if (currentTime < timelockEnd) return { ok: false, value: ERR_TIMELOCK_ACTIVE };
    const totalVotes = proposal.yesVotes + proposal.noVotes;
    const quorumMet = totalVotes * 100 >= this.state.quorumThreshold * totalVotes;
    const yesPercent = (proposal.yesVotes * 100) / totalVotes;
    const passed = quorumMet && yesPercent >= 51;
    if (!quorumMet) return { ok: false, value: ERR_QUORUM_NOT_MET };
    if (!passed) return { ok: false, value: ERR_NOT_PASSED };

    this.state.proposals.set(proposalId, { ...proposal, executed: true, passed });
    return { ok: true, value: true };
  }

  getProposal(id: number): Proposal | null {
    return this.state.proposals.get(id) || null;
  }

  getProposalCount(): Result<number> {
    return { ok: true, value: this.state.nextProposalId };
  }

  getVote(proposalId: number, voter: string): Vote | null {
    const voteKey = `${proposalId}-${voter}`;
    return this.state.votes.get(voteKey) || null;
  }
}

describe("VotingMechanism", () => {
  let contract: VotingMechanismMock;

  beforeEach(() => {
    contract = new VotingMechanismMock();
    contract.reset();
  });

  it("creates a proposal successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createProposal("Fair Wage Policy", "Raise min rate to $2/mile", 20);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const proposal = contract.getProposal(0);
    expect(proposal?.title).toBe("Fair Wage Policy");
    expect(proposal?.description).toBe("Raise min rate to $2/mile");
    expect(proposal?.startTime).toBe(0);
    expect(proposal?.endTime).toBe(20);
  });

  it("rejects proposal without authority", () => {
    const result = contract.createProposal("Test", "Desc", 10);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects invalid title length", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.createProposal("", "Desc", 10);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PROPOSAL_TITLE);
  });

  it("votes yes successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createProposal("Policy", "Desc", 30);
    contract.blockHeight = 5;
    const result = contract.vote(0, 1000, true);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const proposal = contract.getProposal(0);
    expect(proposal?.yesVotes).toBe(1000);
    const vote = contract.getVote(0, "ST1TEST");
    expect(vote?.amount).toBe(1000);
    expect(vote?.support).toBe(true);
  });

  it("rejects already voted", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createProposal("Policy", "Desc", 30);
    contract.blockHeight = 5;
    contract.vote(0, 100, true);
    const result = contract.vote(0, 200, false);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_VOTED);
  });

  it("executes passed proposal after timelock", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createProposal("Policy", "Desc", 10);
    contract.blockHeight = 5;
    contract.vote(0, 600000, true);
    contract.vote(0, 100000, false);
    contract.blockHeight = 25;
    const result = contract.executeProposal(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const proposal = contract.getProposal(0);
    expect(proposal?.executed).toBe(true);
    expect(proposal?.passed).toBe(true);
  });

  it("rejects execution during timelock", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createProposal("Policy", "Desc", 10);
    contract.blockHeight = 5;
    contract.vote(0, 600000, true);
    contract.blockHeight = 15;
    const result = contract.executeProposal(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_TIMELOCK_ACTIVE);
  });

  it("sets quorum threshold successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setQuorumThreshold(60);
    expect(result.ok).toBe(true);
    expect(contract.state.quorumThreshold).toBe(60);
  });

  it("returns proposal count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.createProposal("One", "Desc", 10);
    contract.createProposal("Two", "Desc", 20);
    const result = contract.getProposalCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });
});