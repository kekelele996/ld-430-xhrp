import { LicenseType, SharePackStatus, UserRole } from './enums';

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

/** 生成素材包时冻结的素材与许可快照，之后收藏集或许可变更均不影响 */
export interface SharePackSnapshotItem {
  assetId: string;
  title: string;
  licenseType: LicenseType;
  licenseVersion: string;
}

export interface CreateSharePackPayload {
  collectionId?: string;
  name?: string;
  assetIds?: string[];
  claimCode?: string;
  expiresAt?: string;
  totalQuota?: number;
}

/** 创建人视角的素材包领取情况 */
export interface SharePackSummaryView {
  id: string;
  name: string;
  collectionId: string;
  claimCode: string;
  status: SharePackStatus;
  expiresAt: Date;
  totalQuota: number;
  claimedCount: number;
  remainingQuota: number;
  items: SharePackSnapshotItem[];
  createdAt?: Date;
}

/** 领取人视角的领取结果，份数口径与创建人视图一致 */
export interface SharePackClaimView {
  packId: string;
  name: string;
  claimCode: string;
  claimerId: string;
  claimedAt: Date;
  totalQuota: number;
  claimedCount: number;
  remainingQuota: number;
  duplicated: boolean;
  items: SharePackSnapshotItem[];
}
