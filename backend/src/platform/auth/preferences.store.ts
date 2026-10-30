import type { Pool, RowDataPacket } from "mysql2/promise";

/** Interface languages the frontend has translations for. */
export const LANGUAGES = ["en", "ar"] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * iTop's User `language` for each of ours, where iTop has that dictionary.
 * iTop ships no Arabic one, so an Arabic choice is kept by the BFF only and
 * iTop's field is left as it was.
 */
export const ITOP_LANGUAGE: Partial<Record<Language, string>> = { en: "EN US" };

/** Per-account settings iTop has nowhere to keep, by iTop User id. */
export interface PreferencesStore {
  language(userId: number): Promise<Language | undefined>;
  setLanguage(userId: number, language: Language): Promise<void>;
}

export class MemoryPreferencesStore implements PreferencesStore {
  private readonly languages = new Map<number, Language>();

  async language(userId: number): Promise<Language | undefined> {
    return this.languages.get(userId);
  }

  async setLanguage(userId: number, language: Language): Promise<void> {
    this.languages.set(userId, language);
  }
}

/** Table `bff_user_prefs` in the BFF's own database, created on first use. */
export class MySqlPreferencesStore implements PreferencesStore {
  private ready?: Promise<void>;

  constructor(private readonly pool: Pool) {}

  private init(): Promise<void> {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS bff_user_prefs (
           user_id INT NOT NULL PRIMARY KEY,
           language VARCHAR(10) NULL,
           updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }

  async language(userId: number): Promise<Language | undefined> {
    await this.init();
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT language FROM bff_user_prefs WHERE user_id = ?", [userId]);
    const value = rows[0]?.["language"];
    return (LANGUAGES as readonly string[]).includes(value) ? (value as Language) : undefined;
  }

  async setLanguage(userId: number, language: Language): Promise<void> {
    await this.init();
    await this.pool.query(
      "INSERT INTO bff_user_prefs (user_id, language) VALUES (?, ?) ON DUPLICATE KEY UPDATE language = VALUES(language)",
      [userId, language],
    );
  }
}
