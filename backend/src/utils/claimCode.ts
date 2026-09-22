const CLAIM_CODE_PATTERN = /^[A-Z0-9]{4,32}$/;

/** 领用码大小写不敏感，统一归一化为大写存储与匹配 */
export const normalizeClaimCode = (raw: unknown): string => String(raw ?? '').trim().toUpperCase();

export const isValidClaimCode = (code: string): boolean => CLAIM_CODE_PATTERN.test(code);
