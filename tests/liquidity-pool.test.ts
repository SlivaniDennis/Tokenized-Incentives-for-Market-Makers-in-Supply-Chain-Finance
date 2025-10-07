import { describe, it, expect, beforeEach } from "vitest";

const ERR_NOT_AUTHORIZED = 401;
const ERR_INSUFFICIENT_BALANCE = 101;
const ERR_INVALID_AMOUNT = 102;
const ERR_POOL_NOT_FOUND = 105;
const ERR_POOL_ALREADY_EXISTS = 104;
const ERR_SLIPPAGE = 107;
const ERR_PAUSED = 112;
const ERR_INVALID_K = 116;
const ERR_DEADLINE_PASSED = 128;
const ERR_INVALID_FEE = 111;
const ERR_INVALID_POOL = 103;
const FEE_DENOMINATOR = 10000;
const FEE_RATE = 30;
const PRECISION = 100000000;
const ERR_LOAN_NOT_REPAID = 136;

interface Pool {
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  feeRate: bigint;
  isActive: boolean;
  lastK: bigint;
  cooldownEnd: bigint;
}

interface FlashLoanData {
  amount: bigint;
  token: string;
  premium: bigint;
}

type Result<T> = { ok: true; value: T; } | { ok: false; value: number; };

class LiquidityPoolMock {
  state: {
    contractOwner: string;
    isPaused: boolean;
    totalPools: bigint;
    oraclePrice: bigint;
    lastOracleUpdate: bigint;
    routerContract: string | null;
    pools: Map<string, Pool>;
    userShares: Map<string, bigint>;
    userCooldowns: Map<string, bigint>;
    flashLoanData: Map<string, FlashLoanData>;
  } = {
    contractOwner: "ST1TEST",
    isPaused: false,
    totalPools: 0n,
    oraclePrice: 1000000n,
    lastOracleUpdate: 0n,
    routerContract: null,
    pools: new Map(),
    userShares: new Map(),
    userCooldowns: new Map(),
    flashLoanData: new Map(),
  };
  blockHeight: bigint = 0n;
  caller: string = "ST1TEST";
  transfers: Array<{ token: string; amount: bigint; from: string; to: string }> = [];
  events: Array<any> = [];
  callbacks: Map<string, (token: string, amount: bigint) => Result<boolean>> = new Map();

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      contractOwner: "ST1TEST",
      isPaused: false,
      totalPools: 0n,
      oraclePrice: 1000000n,
      lastOracleUpdate: 0n,
      routerContract: null,
      pools: new Map(),
      userShares: new Map(),
      userCooldowns: new Map(),
      flashLoanData: new Map(),
    };
    this.blockHeight = 0n;
    this.caller = "ST1TEST";
    this.transfers = [];
    this.events = [];
    this.callbacks = new Map();
  }

  private getPoolKey(tokenA: string, tokenB: string): string {
    return `${tokenA}-${tokenB}`;
  }

  private getUserSharesKey(poolKey: string, user: string): string {
    return `${poolKey}-${user}`;
  }

  private getUserCooldownKey(user: string, poolKey: string): string {
    return `${user}-${poolKey}`;
  }

  private getFlashLoanKey(borrower: string): string {
    return borrower;
  }

  private mulDown(a: bigint, b: bigint): bigint {
    return (a * b) / BigInt(PRECISION);
  }

  private divDown(a: bigint, b: bigint): bigint {
    return (a * BigInt(PRECISION)) / b;
  }

  private calculateK(reserveA: bigint, reserveB: bigint): bigint {
    return reserveA * reserveB;
  }

  private bigIntSqrt(n: bigint): bigint {
    let x = n;
    let y = (x + 1n) / 2n;
    while (y < x) {
      x = y;
      y = (x + n / x) / 2n;
    }
    return x;
  }

  private calculateShares(amountA: bigint, amountB: bigint, reserveA: bigint, reserveB: bigint, totalShares: bigint): bigint {
    if (totalShares === 0n) {
      return this.bigIntSqrt(amountA * amountB);
    }
    const shareA = this.divDown(amountA * totalShares, reserveA);
    const shareB = this.divDown(amountB * totalShares, reserveB);
    return shareA < shareB ? shareA : shareB;
  }

  private calculateAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
    const amountInWithFee = amountIn * (BigInt(FEE_DENOMINATOR) - BigInt(FEE_RATE));
    return (amountInWithFee * reserveOut) / (reserveIn * BigInt(FEE_DENOMINATOR) + amountInWithFee);
  }

  createPool(tokenA: string, tokenB: string, feeRate: bigint): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const poolKey = this.getPoolKey(tokenA, tokenB);
    if (this.state.pools.has(poolKey)) return { ok: false, value: ERR_POOL_ALREADY_EXISTS };
    if (this.state.totalPools >= 100n) return { ok: false, value: ERR_INVALID_POOL };
    if (feeRate > BigInt(FEE_RATE)) return { ok: false, value: ERR_INVALID_FEE };
    this.state.pools.set(poolKey, {
      reserveA: 0n,
      reserveB: 0n,
      totalShares: 0n,
      feeRate,
      isActive: true,
      lastK: 0n,
      cooldownEnd: 0n,
    });
    this.state.totalPools += 1n;
    this.events.push({ event: "pool-created", tokenA, tokenB, feeRate });
    return { ok: true, value: true };
  }

  addLiquidity(tokenA: string, tokenB: string, amountA: bigint, amountB: bigint, minShares: bigint, deadline: bigint): Result<bigint> {
    if (this.state.isPaused) return { ok: false, value: ERR_PAUSED };
    if (this.blockHeight > deadline) return { ok: false, value: ERR_DEADLINE_PASSED };
    const poolKey = this.getPoolKey(tokenA, tokenB);
    const pool = this.state.pools.get(poolKey);
    if (!pool) return { ok: false, value: ERR_POOL_NOT_FOUND };
    if (amountA <= 0n || amountB <= 0n) return { ok: false, value: ERR_INVALID_AMOUNT };
    const shares = this.calculateShares(amountA, amountB, pool.reserveA, pool.reserveB, pool.totalShares);
    if (shares < minShares) return { ok: false, value: ERR_SLIPPAGE };
    this.transfers.push({ token: tokenA, amount: amountA, from: this.caller, to: "contract" });
    this.transfers.push({ token: tokenB, amount: amountB, from: this.caller, to: "contract" });
    const newReserveA = pool.reserveA + amountA;
    const newReserveB = pool.reserveB + amountB;
    const newK = this.calculateK(newReserveA, newReserveB);
    if (newK < pool.lastK) return { ok: false, value: ERR_INVALID_K };
    this.state.pools.set(poolKey, { ...pool, reserveA: newReserveA, reserveB: newReserveB, lastK: newK, totalShares: pool.totalShares + shares });
    const userSharesKey = this.getUserSharesKey(poolKey, this.caller);
    this.state.userShares.set(userSharesKey, (this.state.userShares.get(userSharesKey) || 0n) + shares);
    this.events.push({ event: "liquidity-added", tokenA, tokenB, amountA, amountB, shares });
    return { ok: true, value: shares };
  }

  removeLiquidity(tokenA: string, tokenB: string, shares: bigint, minAmountA: bigint, minAmountB: bigint, deadline: bigint): Result<{ amountA: bigint; amountB: bigint }> {
    if (this.state.isPaused) return { ok: false, value: ERR_PAUSED };
    if (this.blockHeight > deadline) return { ok: false, value: ERR_DEADLINE_PASSED };
    const poolKey = this.getPoolKey(tokenA, tokenB);
    const pool = this.state.pools.get(poolKey);
    if (!pool) return { ok: false, value: ERR_POOL_NOT_FOUND };
    const userSharesKey = this.getUserSharesKey(poolKey, this.caller);
    const userShares = this.state.userShares.get(userSharesKey) || 0n;
    if (userShares < shares) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    if (shares <= 0n) return { ok: false, value: ERR_INVALID_AMOUNT };
    const cooldownKey = this.getUserCooldownKey(this.caller, poolKey);
    const cooldown = this.state.userCooldowns.get(cooldownKey) || 0n;
    if (this.blockHeight < cooldown) return { ok: false, value: ERR_COOLDOWN_NOT_MET };
    const amountA = this.divDown(shares * pool.reserveA, pool.totalShares);
    const amountB = this.divDown(shares * pool.reserveB, pool.totalShares);
    if (amountA < minAmountA || amountB < minAmountB) return { ok: false, value: ERR_SLIPPAGE };
    const newReserveA = pool.reserveA - amountA;
    const newReserveB = pool.reserveB - amountB;
    const newK = this.calculateK(newReserveA, newReserveB);
    if (newK < pool.lastK) return { ok: false, value: ERR_INVALID_K };
    this.state.pools.set(poolKey, { ...pool, reserveA: newReserveA, reserveB: newReserveB, lastK: newK, totalShares: pool.totalShares - shares });
    this.state.userShares.set(userSharesKey, userShares - shares);
    this.transfers.push({ token: tokenA, amount: amountA, from: "contract", to: this.caller });
    this.transfers.push({ token: tokenB, amount: amountB, from: "contract", to: this.caller });
    this.state.userCooldowns.set(cooldownKey, this.blockHeight + BigInt(COOLDOWN_PERIOD));
    this.events.push({ event: "liquidity-removed", tokenA, tokenB, shares, amountA, amountB });
    return { ok: true, value: { amountA, amountB } };
  }

  swap(tokenIn: string, tokenOut: string, amountIn: bigint, minAmountOut: bigint, deadline: bigint): Result<bigint> {
    if (this.state.isPaused) return { ok: false, value: ERR_PAUSED };
    if (this.blockHeight > deadline) return { ok: false, value: ERR_DEADLINE_PASSED };
    const poolKey = this.getPoolKey(tokenIn, tokenOut);
    const pool = this.state.pools.get(poolKey);
    if (!pool) return { ok: false, value: ERR_POOL_NOT_FOUND };
    if (amountIn <= 0n) return { ok: false, value: ERR_INVALID_AMOUNT };
    const amountOut = this.calculateAmountOut(amountIn, pool.reserveA, pool.reserveB);
    if (amountOut < minAmountOut) return { ok: false, value: ERR_SLIPPAGE };
    this.transfers.push({ token: tokenIn, amount: amountIn, from: this.caller, to: "contract" });
    const newReserveIn = pool.reserveA + amountIn;
    const newReserveOut = pool.reserveB - amountOut;
    const newK = this.calculateK(newReserveIn, newReserveOut);
    if (newK < pool.lastK) return { ok: false, value: ERR_INVALID_K };
    this.state.pools.set(poolKey, { ...pool, reserveA: newReserveIn, reserveB: newReserveOut, lastK: newK });
    this.transfers.push({ token: tokenOut, amount: amountOut, from: "contract", to: this.caller });
    this.events.push({ event: "swap-executed", tokenIn, tokenOut, amountIn, amountOut });
    return { ok: true, value: amountOut };
  }

  setPaused(paused: boolean): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.isPaused = paused;
    return { ok: true, value: true };
  }

  flashLoan(token: string, amount: bigint, callback: string): Result<boolean> {
    if (this.state.isPaused) return { ok: false, value: ERR_PAUSED };
    const poolKey = this.getPoolKey(token, "contract");
    const pool = this.state.pools.get(poolKey);
    if (!pool) return { ok: false, value: ERR_POOL_NOT_FOUND };
    if (pool.reserveA < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    const premium = (amount * BigInt(FEE_RATE)) / BigInt(FEE_DENOMINATOR);
    const loanKey = this.getFlashLoanKey(this.caller);
    this.state.flashLoanData.set(loanKey, { amount, token, premium });
    this.transfers.push({ token, amount, from: "contract", to: this.caller });
    const cb = this.callbacks.get(callback);
    if (cb) {
      cb(token, amount);
    }
    const loanData = this.state.flashLoanData.get(loanKey);
    if (!loanData || loanData.amount !== amount || loanData.token !== token) return { ok: false, value: ERR_LOAN_NOT_REPAID };
    this.transfers.push({ token, amount: amount + premium, from: this.caller, to: "contract" });
    this.state.flashLoanData.delete(loanKey);
    this.events.push({ event: "flash-loan", borrower: this.caller, amount, premium });
    return { ok: true, value: true };
  }
}

describe("LiquidityPool", () => {
  let contract: LiquidityPoolMock;

  beforeEach(() => {
    contract = new LiquidityPoolMock();
    contract.reset();
  });

  it("creates a pool successfully", () => {
    const result = contract.createPool("INV", "LFORGE", 30n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.totalPools).toBe(1n);
    expect(contract.events).toEqual([{ event: "pool-created", tokenA: "INV", tokenB: "LFORGE", feeRate: 30n }]);
  });

  it("rejects pool creation by non-owner", () => {
    contract.caller = "ST2FAKE";
    const result = contract.createPool("INV", "LFORGE", 30n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("adds liquidity successfully", () => {
    contract.createPool("INV", "LFORGE", 30n);
    const result = contract.addLiquidity("INV", "LFORGE", 1000n, 1000n, 0n, 100n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000n);
    expect(contract.transfers).toEqual([
      { token: "INV", amount: 1000n, from: "ST1TEST", to: "contract" },
      { token: "LFORGE", amount: 1000n, from: "ST1TEST", to: "contract" },
    ]);
    expect(contract.events[1]).toEqual({ event: "liquidity-added", tokenA: "INV", tokenB: "LFORGE", amountA: 1000n, amountB: 1000n, shares: 1000n });
  });

  it("rejects add liquidity when paused", () => {
    contract.createPool("INV", "LFORGE", 30n);
    contract.setPaused(true);
    const result = contract.addLiquidity("INV", "LFORGE", 1000n, 1000n, 0n, 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("rejects remove liquidity with insufficient shares", () => {
    contract.createPool("INV", "LFORGE", 30n);
    const result = contract.removeLiquidity("INV", "LFORGE", 1000n, 0n, 0n, 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });

  it("executes swap successfully", () => {
    contract.createPool("INV", "LFORGE", 30n);
    contract.addLiquidity("INV", "LFORGE", 10000n, 10000n, 0n, 100n);
    const result = contract.swap("INV", "LFORGE", 100n, 0n, 100n);
    expect(result.ok).toBe(true);
    expect(result.value >= 0n).toBe(true);
    expect(contract.transfers.length).toBe(4);
  });

  it("rejects swap with invalid amount", () => {
    contract.createPool("INV", "LFORGE", 30n);
    const result = contract.swap("INV", "LFORGE", 0n, 0n, 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("sets paused successfully", () => {
    const result = contract.setPaused(true);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.isPaused).toBe(true);
  });

  it("rejects set paused by non-owner", () => {
    contract.caller = "ST2FAKE";
    const result = contract.setPaused(true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects flash loan when paused", () => {
    contract.setPaused(true);
    const result = contract.flashLoan("INV", 1000n, "callback");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });
});