import { config } from "../../package.json";
import { joinLocalPath } from "./localPath";

// Pref keys: path/folder/attachments use old obsidian keys for backward compat
// with existing user data. Nickname is a new key.
const NOTES_DIR_PATH_KEY = `${config.prefsPrefix}.obsidianVaultPath`;
const NOTES_DIR_FOLDER_KEY = `${config.prefsPrefix}.obsidianTargetFolder`;
const NOTES_DIR_ATTACHMENTS_KEY = `${config.prefsPrefix}.obsidianAttachmentsFolder`;
const NOTES_DIR_NICKNAME_KEY = `${config.prefsPrefix}.notesDirectoryNickname`;

type ZoteroPrefsLike = {
  get?: (key: string, global?: boolean) => unknown;
  set?: (key: string, value: unknown, global?: boolean) => void;
};

export type NotesDirectoryConfig = {
  directoryPath: string;
  defaultFolder: string;
  defaultTargetPath: string;
  attachmentsFolder: string;
  attachmentsPath: string;
  nickname: string;
};

export type NotesDirectoryWritePolicy = NotesDirectoryConfig & {
  enforceDefaultTarget: boolean;
};

function getPrefs(): ZoteroPrefsLike | null {
  return (
    (
      globalThis as typeof globalThis & {
        Zotero?: { Prefs?: ZoteroPrefsLike };
      }
    ).Zotero?.Prefs || null
  );
}

function getStringPref(key: string, fallback = ""): string {
  const value = getPrefs()?.get?.(key, true);
  return typeof value === "string" ? value : fallback;
}

function setStringPref(key: string, value: string): void {
  getPrefs()?.set?.(key, value, true);
}

export function getNotesDirectoryPath(): string {
  return getStringPref(NOTES_DIR_PATH_KEY);
}

export function setNotesDirectoryPath(value: string): void {
  setStringPref(NOTES_DIR_PATH_KEY, value);
}

export function getNotesDirectoryFolder(): string {
  return getStringPref(NOTES_DIR_FOLDER_KEY, "Zotero Notes");
}

export function setNotesDirectoryFolder(value: string): void {
  setStringPref(NOTES_DIR_FOLDER_KEY, value);
}

export function getNotesDirectoryAttachmentsFolder(): string {
  return getStringPref(NOTES_DIR_ATTACHMENTS_KEY, "assets");
}

export function setNotesDirectoryAttachmentsFolder(value: string): void {
  setStringPref(NOTES_DIR_ATTACHMENTS_KEY, value);
}

export function getNotesDirectoryNickname(): string {
  return getStringPref(NOTES_DIR_NICKNAME_KEY);
}

export function setNotesDirectoryNickname(value: string): void {
  setStringPref(NOTES_DIR_NICKNAME_KEY, value);
}

export function isNotesDirectoryConfigured(): boolean {
  return getNotesDirectoryPath().trim().length > 0;
}

export function getNotesDirectoryConfig(): NotesDirectoryConfig | null {
  if (!isNotesDirectoryConfigured()) return null;
  const directoryPath = getNotesDirectoryPath();
  const defaultFolder = getNotesDirectoryFolder();
  const attachmentsFolder = getNotesDirectoryAttachmentsFolder();
  const nickname = getNotesDirectoryNickname().trim();
  const defaultTargetPath = defaultFolder
    ? joinLocalPath(directoryPath, defaultFolder)
    : directoryPath;
  const attachmentsPath = attachmentsFolder
    ? joinLocalPath(directoryPath, attachmentsFolder)
    : "";
  return {
    directoryPath,
    defaultFolder,
    defaultTargetPath,
    attachmentsFolder,
    attachmentsPath,
    nickname,
  };
}

export function buildNotesDirectoryConfigSection(): string {
  const notesConfig = getNotesDirectoryConfig();
  if (!notesConfig) return "";
  const lines = ["Notes directory configuration (user-configured):"];
  if (notesConfig.nickname) {
    lines.push(`- Nickname: ${notesConfig.nickname}`);
  }
  lines.push(
    `- Directory path: ${notesConfig.directoryPath}`,
    `- Default folder: ${notesConfig.defaultFolder}`,
    `- Default target path: ${notesConfig.defaultTargetPath}`,
    `- Default note file template: ${joinLocalPath(notesConfig.defaultTargetPath, "<filename>.md")}`,
    `- Rule: when the user does not explicitly specify another folder, write file-based notes directly under Default target path. Do not append Default folder to Default target path again.`,
    `- Attachments folder: ${notesConfig.attachmentsFolder} (relative to notes directory root)`,
  );
  if (notesConfig.attachmentsPath) {
    lines.push(
      `- Attachments path: ${notesConfig.attachmentsPath} (resolved absolute path for copying images)`,
    );
  }
  if (notesConfig.nickname) {
    lines.push(
      `When the user mentions "${notesConfig.nickname}" in the context of notes, write to this directory.`,
    );
  }
  return lines.join("\n");
}

function normalizeForComparison(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
}

export function isLocalPathInsideOrEqual(
  path: string,
  directory: string,
): boolean {
  const normalizedPath = normalizeForComparison(path);
  const normalizedDirectory = normalizeForComparison(directory);
  return (
    normalizedPath === normalizedDirectory ||
    normalizedPath.startsWith(`${normalizedDirectory}/`)
  );
}

export function getLocalPathBasename(path: string): string {
  return (
    path
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() || ""
  );
}

function userTextSpecifiesCustomNoteFolder(
  userText: string | undefined,
  config: NotesDirectoryConfig,
): boolean {
  const text = (userText || "").trim();
  if (!text) return false;
  const defaultFolder = config.defaultFolder.trim();
  const nickname = config.nickname.trim();
  const pathLikeMatch = text.match(
    /\b(?:to|into|in|under|inside|as)\s+["'`]?((?:~\/|\/|[A-Za-z]:[\\/]|[\w .-]+[\\/])[^"'`,.;\n]+)/i,
  );
  if (pathLikeMatch?.[1]?.trim()) return true;
  const customFolderPattern =
    /\b(?:folder|directory|subfolder)\s+["'`]?([^"'`,.;\n]+)/i;
  const folderMatch = text.match(customFolderPattern);
  if (!folderMatch?.[1]) return false;
  const requested = folderMatch[1].trim().replace(/[\\/]+$/g, "");
  if (!requested) return false;
  const requestedLower = requested.toLowerCase();
  if (defaultFolder && requestedLower === defaultFolder.toLowerCase()) {
    return false;
  }
  if (nickname && requestedLower === nickname.toLowerCase()) {
    return false;
  }
  return true;
}

export function buildNotesDirectoryWritePolicy(
  params: {
    userText?: string;
  } = {},
): NotesDirectoryWritePolicy | null {
  const config = getNotesDirectoryConfig();
  if (!config) return null;
  return {
    ...config,
    enforceDefaultTarget: !userTextSpecifiesCustomNoteFolder(
      params.userText,
      config,
    ),
  };
}

function readStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

export function parseNotesDirectoryWritePolicy(
  value: unknown,
): NotesDirectoryWritePolicy | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const directoryPath = readStringField(record, "directoryPath");
  const defaultTargetPath = readStringField(record, "defaultTargetPath");
  if (!directoryPath || !defaultTargetPath) return null;
  return {
    directoryPath,
    defaultFolder: readStringField(record, "defaultFolder"),
    defaultTargetPath,
    attachmentsFolder: readStringField(record, "attachmentsFolder"),
    attachmentsPath: readStringField(record, "attachmentsPath"),
    nickname: readStringField(record, "nickname"),
    enforceDefaultTarget: record.enforceDefaultTarget !== false,
  };
}
