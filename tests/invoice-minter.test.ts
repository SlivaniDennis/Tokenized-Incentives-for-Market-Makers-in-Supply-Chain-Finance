import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_INVOICE_HASH = 101;
const ERR_INVALID_AMOUNT = 102;
const ERR_INVALID_DUE_DATE = 103;
const ERR_INVALID_BUYER = 104;
const ERR_INVALID_INVOICE_STATUS = 115;
const ERR_INVALID_INTEREST_RATE = 116;
const ERR_INVALID_GRACE_PERIOD = 117;
const ERR_INVALID_LOCATION = 118;
const ERR_INVALID_CURRENCY = 119;
const ERR_INVALID_MIN_AMOUNT = 110;
const ERR_INVALID_MAX_AMOUNT = 111;
const ERR_MAX_INVOICES_EXCEEDED = 114;
const ERR_INVALID_UPDATE_PARAM = 113;
const ERR_ORACLE_NOT_VERIFIED = 109;
const ERR_INVOICE_ALREADY_EXISTS = 106;
const ERR_INVOICE_NOT_FOUND = 107;

interface Invoice {
  hash: string;
  amount: number;
  dueDate: number;
  buyer: string;
  timestamp: number;
  minter: string;
  status: boolean;
  interestRate: number;
  gracePeriod: number;
  location: string;
  currency: string;
  minAmount: number;
  maxAmount: number;
}

interface InvoiceUpdate {
  updateHash: string;
  updateAmount: number;
  updateTimestamp: number;
  updater: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class InvoiceMinterMock {
  state: {
    nextInvoiceId: number;
    maxInvoices: number;
    mintFee: number;
    oracleContract: string | null;
    invoices: Map<number, Invoice>;
    invoiceUpdates: Map<number, InvoiceUpdate>;
    invoicesByHash: Map<string, number>;
  } = {
    nextInvoiceId: 0,
    maxInvoices: 10000,
    mintFee: 500,
    oracleContract: null,
    invoices: new Map(),
    invoiceUpdates: new Map(),
    invoicesByHash: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  oracles: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextInvoiceId: 0,
      maxInvoices: 10000,
      mintFee: 500,
      oracleContract: null,
      invoices: new Map(),
      invoiceUpdates: new Map(),
      invoicesByHash: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.oracles = new Set(["ST1TEST"]);
    this.stxTransfers = [];
  }

  isVerifiedOracle(principal: string): Result<boolean> {
    return { ok: true, value: this.oracles.has(principal) };
  }

  setOracleContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.oracleContract !== null) {
      return { ok: false, value: false };
    }
    this.state.oracleContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setMintFee(newFee: number): Result<boolean> {
    if (!this.state.oracleContract) return { ok: false, value: false };
    this.state.mintFee = newFee;
    return { ok: true, value: true };
  }

  mintInvoice(
    hash: string,
    amount: number,
    dueDate: number,
    buyer: string,
    interestRate: number,
    gracePeriod: number,
    location: string,
    currency: string,
    minAmount: number,
    maxAmount: number
  ): Result<number> {
    if (this.state.nextInvoiceId >= this.state.maxInvoices) return { ok: false, value: ERR_MAX_INVOICES_EXCEEDED };
    if (!hash || hash.length > 32) return { ok: false, value: ERR_INVALID_INVOICE_HASH };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (dueDate <= this.blockHeight) return { ok: false, value: ERR_INVALID_DUE_DATE };
    if (buyer === this.caller) return { ok: false, value: ERR_INVALID_BUYER };
    if (interestRate > 20) return { ok: false, value: ERR_INVALID_INTEREST_RATE };
    if (gracePeriod > 30) return { ok: false, value: ERR_INVALID_GRACE_PERIOD };
    if (!location || location.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    if (!["STX", "USD", "BTC"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (minAmount <= 0) return { ok: false, value: ERR_INVALID_MIN_AMOUNT };
    if (maxAmount <= 0) return { ok: false, value: ERR_INVALID_MAX_AMOUNT };
    if (this.state.invoicesByHash.has(hash)) return { ok: false, value: ERR_INVOICE_ALREADY_EXISTS };
    if (!this.state.oracleContract) return { ok: false, value: ERR_ORACLE_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.mintFee, from: this.caller, to: this.state.oracleContract });

    const id = this.state.nextInvoiceId;
    const invoice: Invoice = {
      hash,
      amount,
      dueDate,
      buyer,
      timestamp: this.blockHeight,
      minter: this.caller,
      status: true,
      interestRate,
      gracePeriod,
      location,
      currency,
      minAmount,
      maxAmount,
    };
    this.state.invoices.set(id, invoice);
    this.state.invoicesByHash.set(hash, id);
    this.state.nextInvoiceId++;
    return { ok: true, value: id };
  }

  getInvoice(id: number): Invoice | null {
    return this.state.invoices.get(id) || null;
  }

  burnInvoice(id: number, burnAmount: number): Result<boolean> {
    const invoice = this.state.invoices.get(id);
    if (!invoice) return { ok: false, value: false };
    if (invoice.minter !== this.caller) return { ok: false, value: false };
    if (burnAmount <= 0 || burnAmount > invoice.amount) return { ok: false, value: false };
    const newAmount = invoice.amount - burnAmount;
    const newStatus = newAmount === 0 ? false : true;
    const updated: Invoice = {
      ...invoice,
      amount: newAmount,
      status: newStatus,
    };
    this.state.invoices.set(id, updated);
    return { ok: true, value: true };
  }

  updateInvoice(id: number, updateHash: string, updateAmount: number): Result<boolean> {
    const invoice = this.state.invoices.get(id);
    if (!invoice) return { ok: false, value: false };
    if (invoice.minter !== this.caller) return { ok: false, value: false };
    if (!updateHash || updateHash.length > 32) return { ok: false, value: false };
    if (updateAmount <= 0) return { ok: false, value: false };
    if (this.state.invoicesByHash.has(updateHash) && this.state.invoicesByHash.get(updateHash) !== id) {
      return { ok: false, value: false };
    }

    const updated: Invoice = {
      ...invoice,
      hash: updateHash,
      amount: updateAmount,
      timestamp: this.blockHeight,
    };
    this.state.invoices.set(id, updated);
    this.state.invoicesByHash.delete(invoice.hash);
    this.state.invoicesByHash.set(updateHash, id);
    this.state.invoiceUpdates.set(id, {
      updateHash,
      updateAmount,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  getInvoiceCount(): Result<number> {
    return { ok: true, value: this.state.nextInvoiceId };
  }

  checkInvoiceExistence(hash: string): Result<boolean> {
    return { ok: true, value: this.state.invoicesByHash.has(hash) };
  }
}

describe("InvoiceMinter", () => {
  let contract: InvoiceMinterMock;

  beforeEach(() => {
    contract = new InvoiceMinterMock();
    contract.reset();
  });

  it("mints an invoice successfully", () => {
    contract.setOracleContract("ST2TEST");
    const result = contract.mintInvoice(
      "abc123",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const invoice = contract.getInvoice(0);
    expect(invoice?.hash).toBe("abc123");
    expect(invoice?.amount).toBe(1000);
    expect(invoice?.dueDate).toBe(100);
    expect(invoice?.buyer).toBe("ST3BUYER");
    expect(invoice?.interestRate).toBe(10);
    expect(invoice?.gracePeriod).toBe(7);
    expect(invoice?.location).toBe("LocationX");
    expect(invoice?.currency).toBe("STX");
    expect(invoice?.minAmount).toBe(500);
    expect(invoice?.maxAmount).toBe(2000);
    expect(contract.stxTransfers).toEqual([{ amount: 500, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects duplicate invoice hashes", () => {
    contract.setOracleContract("ST2TEST");
    contract.mintInvoice(
      "abc123",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    const result = contract.mintInvoice(
      "abc123",
      2000,
      200,
      "ST4BUYER",
      15,
      14,
      "LocationY",
      "USD",
      1000,
      4000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVOICE_ALREADY_EXISTS);
  });

  it("rejects mint without oracle contract", () => {
    const result = contract.mintInvoice(
      "ghi789",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ORACLE_NOT_VERIFIED);
  });

  it("rejects invalid amount", () => {
    contract.setOracleContract("ST2TEST");
    const result = contract.mintInvoice(
      "jkl012",
      0,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects invalid due date", () => {
    contract.setOracleContract("ST2TEST");
    contract.blockHeight = 50;
    const result = contract.mintInvoice(
      "mno345",
      1000,
      40,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DUE_DATE);
  });

  it("burns an invoice successfully", () => {
    contract.setOracleContract("ST2TEST");
    contract.mintInvoice(
      "pqr678",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    const result = contract.burnInvoice(0, 500);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const invoice = contract.getInvoice(0);
    expect(invoice?.amount).toBe(500);
    expect(invoice?.status).toBe(true);
  });

  it("burns entire invoice and sets status false", () => {
    contract.setOracleContract("ST2TEST");
    contract.mintInvoice(
      "stu901",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    const result = contract.burnInvoice(0, 1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const invoice = contract.getInvoice(0);
    expect(invoice?.amount).toBe(0);
    expect(invoice?.status).toBe(false);
  });

  it("rejects burn for non-existent invoice", () => {
    contract.setOracleContract("ST2TEST");
    const result = contract.burnInvoice(99, 500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects burn by non-minter", () => {
    contract.setOracleContract("ST2TEST");
    contract.mintInvoice(
      "vwx234",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    contract.caller = "ST3FAKE";
    const result = contract.burnInvoice(0, 500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("updates an invoice successfully", () => {
    contract.setOracleContract("ST2TEST");
    contract.mintInvoice(
      "oldhash",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    const result = contract.updateInvoice(0, "newhash", 1500);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const invoice = contract.getInvoice(0);
    expect(invoice?.hash).toBe("newhash");
    expect(invoice?.amount).toBe(1500);
    const update = contract.state.invoiceUpdates.get(0);
    expect(update?.updateHash).toBe("newhash");
    expect(update?.updateAmount).toBe(1500);
    expect(update?.updater).toBe("ST1TEST");
  });

  it("rejects update for non-existent invoice", () => {
    contract.setOracleContract("ST2TEST");
    const result = contract.updateInvoice(99, "newhash", 1500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects update by non-minter", () => {
    contract.setOracleContract("ST2TEST");
    contract.mintInvoice(
      "yzab56",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    contract.caller = "ST3FAKE";
    const result = contract.updateInvoice(0, "newhash", 1500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets mint fee successfully", () => {
    contract.setOracleContract("ST2TEST");
    const result = contract.setMintFee(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.mintFee).toBe(1000);
    contract.mintInvoice(
      "cde789",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    expect(contract.stxTransfers).toEqual([{ amount: 1000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects mint fee change without oracle contract", () => {
    const result = contract.setMintFee(1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("returns correct invoice count", () => {
    contract.setOracleContract("ST2TEST");
    contract.mintInvoice(
      "fgh012",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    contract.mintInvoice(
      "ijk345",
      2000,
      200,
      "ST4BUYER",
      15,
      14,
      "LocationY",
      "USD",
      1000,
      4000
    );
    const result = contract.getInvoiceCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("checks invoice existence correctly", () => {
    contract.setOracleContract("ST2TEST");
    contract.mintInvoice(
      "lmn678",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    const result = contract.checkInvoiceExistence("lmn678");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const result2 = contract.checkInvoiceExistence("nonexistent");
    expect(result2.ok).toBe(true);
    expect(result2.value).toBe(false);
  });

  it("parses invoice parameters with Clarity types", () => {
    const hash = stringAsciiCV("opq901");
    const amount = uintCV(1000);
    expect(hash.value).toBe("opq901");
    expect(amount.value).toEqual(BigInt(1000));
  });

  it("rejects invoice mint with empty hash", () => {
    contract.setOracleContract("ST2TEST");
    const result = contract.mintInvoice(
      "",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_INVOICE_HASH);
  });

  it("rejects invoice mint with max invoices exceeded", () => {
    contract.setOracleContract("ST2TEST");
    contract.state.maxInvoices = 1;
    contract.mintInvoice(
      "rst234",
      1000,
      100,
      "ST3BUYER",
      10,
      7,
      "LocationX",
      "STX",
      500,
      2000
    );
    const result = contract.mintInvoice(
      "uvw567",
      2000,
      200,
      "ST4BUYER",
      15,
      14,
      "LocationY",
      "USD",
      1000,
      4000
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_INVOICES_EXCEEDED);
  });

  it("sets oracle contract successfully", () => {
    const result = contract.setOracleContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.oracleContract).toBe("ST2TEST");
  });

  it("rejects invalid oracle contract", () => {
    const result = contract.setOracleContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});