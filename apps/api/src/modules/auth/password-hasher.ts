import { argon2id, hash, needsRehash, verify, type HashOptions } from 'argon2';

export interface Argon2Parameters {
  /** KiB of memory per hash. */
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/**
 * OWASP Password Storage Cheat Sheet configuration for Argon2id (19 MiB, 2 iterations, 1 lane).
 * It resists GPU cracking while keeping memory per concurrent login low enough that a burst of
 * requests cannot exhaust the server. Raise it here; existing hashes are upgraded on next login.
 */
export const DEFAULT_ARGON2_PARAMETERS: Readonly<Argon2Parameters> = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export interface PasswordHasher {
  hash: (password: string) => Promise<string>;
  /** False for a wrong password or an unreadable hash; never throws. */
  verify: (passwordHash: string, password: string) => Promise<boolean>;
  /** True when the stored hash uses weaker parameters than the current configuration. */
  needsRehash: (passwordHash: string) => boolean;
  /**
   * Spends the same effort as a real verification. Used when no account matches, so response
   * times do not reveal which e-mail addresses are registered.
   */
  verifyAgainstDummy: (password: string) => Promise<void>;
}

export function createArgon2PasswordHasher(
  parameters: Readonly<Argon2Parameters> = DEFAULT_ARGON2_PARAMETERS,
): PasswordHasher {
  const options: HashOptions = { type: argon2id, ...parameters };
  let dummyHash: Promise<string> | undefined;

  const verifyHash = async (passwordHash: string, password: string): Promise<boolean> => {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  };

  return {
    hash: (password) => hash(password, options),
    verify: verifyHash,
    needsRehash: (passwordHash) => {
      try {
        return needsRehash(passwordHash, options);
      } catch {
        return true;
      }
    },
    verifyAgainstDummy: async (password) => {
      dummyHash ??= hash('calmcash-timing-equaliser', options);
      await verifyHash(await dummyHash, password);
    },
  };
}
