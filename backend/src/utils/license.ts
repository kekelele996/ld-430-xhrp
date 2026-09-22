import { LicenseType } from '../types/enums';

/** 许可快照协议版本：冻结进共享包与下载记录，保证快照可追溯 */
export const LICENSE_SNAPSHOT_VERSION = '2026.1';

export const buildLicenseVersion = (licenseType: LicenseType): string =>
  `${licenseType}-${LICENSE_SNAPSHOT_VERSION}`;
