import { UserRole } from './enums';

export interface AuthUser {
  id: string;
  role: UserRole;
  canDownloadCommercial?: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** 生成共享包时冻结的单条素材许可快照 */
export interface PackAssetSnapshot {
  assetId: string;
  title: string;
  assetType: string;
  fileFormat: string;
  fileUrl: string;
  thumbnailUrl?: string;
  licenseType: string;
  licenseVersion: string;
  frozenAt: Date;
}

/** 创建共享素材包入参 */
export interface CreateSharedPackInput {
  collectionId: string;
  assetIds: string[];
  claimCode: string;
  totalCopies: number;
  expiresAt: string | Date;
}

/** 领取结果中回传给领取人的素材条目（来自冻结快照） */
export interface ClaimedAssetItem extends PackAssetSnapshot {}

export interface PackClaimResult {
  packId: string;
  claimCode: string;
  claimId: string;
  claimantId: string;
  claimedAt: Date;
  expiresAt: Date;
  remainingCopies: number;
  totalCopies: number;
  assets: ClaimedAssetItem[];
  repeated: boolean;
}
