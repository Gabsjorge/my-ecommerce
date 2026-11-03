import type { Database } from '../db/client';
import {
  DrizzleUnitOfWork,
  type TxRepositories,
  type UnitOfWork,
} from '../modules/carts/cart.unit-of-work';

export interface FaultPoint {
  repository: keyof TxRepositories;
  method: string;
  // 'after' runs the real write first and then throws, which proves that the rollback undoes it.
  when: 'before' | 'after';
}

export const INJECTED_FAILURE = 'injected failure';

// Real unit of work (real transaction) whose chosen repository method fails, for atomicity tests (RN-021).
export function faultInjectingUnitOfWork(db: Database, fault: FaultPoint): UnitOfWork {
  const real = new DrizzleUnitOfWork(db);
  return {
    run: (work) =>
      real.run((repos) => {
        const target = repos[fault.repository] as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >;
        const wrapped = Object.create(target) as typeof target;
        wrapped[fault.method] = async (...args: unknown[]) => {
          if (fault.when === 'before') throw new Error(INJECTED_FAILURE);
          await target[fault.method](...args);
          throw new Error(INJECTED_FAILURE);
        };
        return work({ ...repos, [fault.repository]: wrapped });
      }),
  };
}
