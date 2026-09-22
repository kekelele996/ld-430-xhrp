interface MongoErrorLike {
  code?: number;
}

/** 识别 MongoDB E11000 唯一键冲突（用于领用码重复、并发重复领取兜底） */
export const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as MongoErrorLike).code === 11000;
