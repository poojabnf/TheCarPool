jest.mock('../firestore', () => ({ db: {} }));
import { withdrawableOf, creditWithdrawable, creditRideOnly, debitWallet } from '../wallet';

describe('withdrawable wallet balance', () => {
  it('treats a legacy wallet as fully withdrawable', () => {
    expect(withdrawableOf({ available_wallet_balance: 250 })).toBe(250);
  });

  it('never lets top-ups or promo credit become withdrawable', () => {
    let w: any = { available_wallet_balance: 0, withdrawable_balance: 0 };
    w = { ...w, ...creditRideOnly(w, 500) };
    expect(w.available_wallet_balance).toBe(500);
    expect(withdrawableOf(w)).toBe(0);
  });

  it('makes earnings withdrawable', () => {
    const w = creditWithdrawable({ available_wallet_balance: 100, withdrawable_balance: 0 }, 80.5);
    expect(w).toEqual({ available_wallet_balance: 180.5, withdrawable_balance: 80.5 });
  });

  it('spends ride-only money before earnings', () => {
    const w = debitWallet({ available_wallet_balance: 180, withdrawable_balance: 80 }, 60);
    expect(w).toEqual({ available_wallet_balance: 120, withdrawable_balance: 80 });
    const w2 = debitWallet(w, 70);
    expect(w2).toEqual({ available_wallet_balance: 50, withdrawable_balance: 50 });
  });

  it('takes a payout entirely from earnings', () => {
    const w = debitWallet({ available_wallet_balance: 180, withdrawable_balance: 80 }, 80, true);
    expect(w).toEqual({ available_wallet_balance: 100, withdrawable_balance: 0 });
  });
});
