import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Collection, type CollectionDocument } from '../models/collection.schema';
import { PackClaim, type PackClaimDocument } from '../models/packClaim.schema';
import { SharedPack, type PackAssetSnapshot, type SharedPackDocument } from '../models/sharedPack.schema';
import { Asset, type AssetDocument } from '../models/asset.schema';
import { AssetStatus, SharedPackStatus, UserRole } from '../types/enums';
import type { AuthUser, CreateSharedPackInput, PackClaimResult } from '../types/interfaces';
import { isValidClaimCode, normalizeClaimCode } from '../utils/claimCode';
import { buildLicenseVersion } from '../utils/license';
import { isDuplicateKeyError } from '../utils/mongoError';

/** 领取人视角：剩余份数始终以服务端 claimedCount 为唯一来源计算 */
const withRemaining = (pack: SharedPackDocument) => {
  const plain = pack.toObject();
  return {
    ...plain,
    remainingCopies: Math.max(pack.totalCopies - pack.claimedCount, 0),
  };
};

@Injectable()
export class SharedPackService {
  constructor(
    @InjectModel(SharedPack.name) private readonly packModel: Model<SharedPackDocument>,
    @InjectModel(PackClaim.name) private readonly claimModel: Model<PackClaimDocument>,
    @InjectModel(Collection.name) private readonly collectionModel: Model<CollectionDocument>,
    @InjectModel(Asset.name) private readonly assetModel: Model<AssetDocument>,
  ) {}

  /** 创建人查看自己创建的共享包（Admin 可查看全部） */
  findMine(user: AuthUser) {
    const filter = user.role === UserRole.Admin ? {} : { creatorId: user.id };
    return this.packModel.find(filter).sort({ createdAt: -1 }).then((packs) => packs.map(withRemaining));
  }

  /** 创建人查看包详情：份数（claimedCount / totalCopies / remainingCopies） */
  async findOneForCreator(packId: string, user: AuthUser) {
    if (!isValidObjectId(packId)) throw new BadRequestException('共享包 ID 非法');
    const pack = await this.packModel.findById(packId).exec();
    if (!pack) throw new NotFoundException('共享素材包不存在');
    if (pack.creatorId !== user.id && user.role !== UserRole.Admin) {
      throw new ForbiddenException('仅创建人可查看该共享包');
    }
    const claims = await this.claimModel.find({ packId: pack._id }).sort({ claimedAt: 1 }).exec();
    return { ...withRemaining(pack), claims };
  }

  async createPack(input: CreateSharedPackInput, creator: AuthUser) {
    const claimCode = normalizeClaimCode(input.claimCode);
    if (!isValidClaimCode(claimCode)) {
      throw new BadRequestException('领用码需为 4-32 位大写字母或数字');
    }
    const totalCopies = Number(input.totalCopies);
    if (!Number.isInteger(totalCopies) || totalCopies < 1) {
      throw new BadRequestException('总领取份数必须为不小于 1 的整数');
    }
    const expiresAt = input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) throw new BadRequestException('有效期时间格式非法');
    if (expiresAt.getTime() <= Date.now()) throw new BadRequestException('有效期必须晚于当前时间');
    if (!isValidObjectId(input.collectionId)) throw new BadRequestException('收藏集 ID 非法');
    const rawAssetIds = Array.isArray(input.assetIds) ? input.assetIds : [];
    const assetIds = [...new Set(rawAssetIds)].filter((id) => isValidObjectId(id));
    if (assetIds.length === 0) throw new BadRequestException('至少选择一个素材');
    if (assetIds.length !== rawAssetIds.length) throw new BadRequestException('素材 ID 列表含非法或重复项');

    const collection = await this.collectionModel.findById(input.collectionId).exec();
    if (!collection) throw new NotFoundException('收藏集不存在');
    if (collection.creatorId !== creator.id && creator.role !== UserRole.Admin) {
      throw new ForbiddenException('仅收藏集创建人可生成共享素材包');
    }

    const collectionAssetIdSet = new Set(collection.assetIds.map((id) => id.toString()));
    const assets = await this.assetModel.find({ _id: { $in: assetIds.map((id) => new Types.ObjectId(id)) } }).exec();
    if (assets.length !== assetIds.length) throw new BadRequestException('部分素材不存在');
    for (const asset of assets) {
      if (asset.status !== AssetStatus.Published) {
        throw new BadRequestException(`素材「${asset.title}」未发布，不能加入共享包`);
      }
      if (!collectionAssetIdSet.has(asset._id.toString())) {
        throw new BadRequestException(`素材「${asset.title}」不属于该收藏集`);
      }
    }

    const frozenAt = new Date();
    const snapshots: PackAssetSnapshot[] = assets.map((asset) => ({
      assetId: asset._id,
      title: asset.title,
      assetType: asset.assetType,
      fileFormat: asset.fileFormat,
      fileUrl: asset.fileUrl,
      thumbnailUrl: asset.thumbnailUrl,
      licenseType: asset.licenseType,
      licenseVersion: buildLicenseVersion(asset.licenseType),
      frozenAt,
    }));

    try {
      return await this.packModel.create({
        collectionId: collection._id,
        creatorId: collection.creatorId,
        claimCode,
        totalCopies,
        claimedCount: 0,
        expiresAt,
        status: SharedPackStatus.Active,
        assets: snapshots,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new ConflictException('领用码已存在，请更换');
      throw error;
    }
  }

  async revoke(packId: string, user: AuthUser, reason?: string) {
    if (!isValidObjectId(packId)) throw new BadRequestException('共享包 ID 非法');
    const pack = await this.packModel.findById(packId).exec();
    if (!pack) throw new NotFoundException('共享素材包不存在');
    if (pack.creatorId !== user.id && user.role !== UserRole.Admin) {
      throw new ForbiddenException('仅创建人可撤销共享素材包');
    }
    if (pack.status === SharedPackStatus.Revoked) return withRemaining(pack);
    pack.status = SharedPackStatus.Revoked;
    pack.revokedAt = new Date();
    pack.revokeReason = reason;
    await pack.save();
    return withRemaining(pack);
  }

  /**
   * 凭码领取：
   * - 先插入领取记录（(packId, claimantId) 唯一索引决胜），同账号重复/并发领取只返回原结果、不计数；
   * - 再用条件原子自增占用份数（claimedCount < totalCopies），不同账号并发不超卖；
   * - 过期 / 撤销 / 份数用尽时拒绝；占用失败则回滚刚插入的领取记录。
   */
  async claim(rawCode: string, claimant: AuthUser): Promise<PackClaimResult> {
    const claimCode = normalizeClaimCode(rawCode);
    if (!isValidClaimCode(claimCode)) throw new BadRequestException('领用码格式非法');
    const pack = await this.packModel.findOne({ claimCode }).exec();
    if (!pack) throw new NotFoundException('领用码无效或共享包不存在');
    if (pack.status === SharedPackStatus.Revoked) throw new ForbiddenException('该共享素材包已被撤销');
    if (pack.expiresAt.getTime() <= Date.now()) throw new GoneException('该共享素材包已过期');

    // 第一步：幂等插入领取记录。(packId, claimantId) 唯一索引在数据库层决胜，
    // 同账号并发下至多一个请求进入占用份数的分支。
    let claim: PackClaimDocument;
    try {
      claim = await this.claimModel.create({ packId: pack._id, claimantId: claimant.id });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existingClaim = await this.claimModel.findOne({ packId: pack._id, claimantId: claimant.id }).exec();
      // 重复领取：返回原结果，不重复计数
      if (existingClaim) {
        const latest = await this.packModel.findById(pack._id).exec();
        if (latest) return this.buildClaimResult(latest, existingClaim, true);
      }
      throw new ConflictException('该账号已领取过该共享包');
    }

    // 第二步：仅首位领取者原子占用一份。条件 $expr 保证 claimedCount < totalCopies，
    // 不同账号并发下数据库串行执行更新，天然不会超卖。
    const updated = await this.packModel
      .findOneAndUpdate(
        {
          _id: pack._id,
          status: SharedPackStatus.Active,
          expiresAt: { $gt: new Date() },
          $expr: { $lt: ['$claimedCount', '$totalCopies'] },
        },
        { $inc: { claimedCount: 1 } },
        { new: true },
      )
      .exec();

    if (updated) {
      return this.buildClaimResult(updated, claim, false);
    }

    // 占用失败（并发抢空 / 刚被撤销 / 刚过期）：删除刚建立的领取记录并回滚，
    // 使本次领取语义上完全失败，账号后续在包重新有效时仍可领取。
    await this.claimModel.deleteOne({ _id: claim._id }).exec().catch(() => undefined);
    const current = await this.packModel.findById(pack._id).exec();
    if (current?.status === SharedPackStatus.Revoked) throw new ForbiddenException('该共享素材包已被撤销');
    if (current && current.expiresAt.getTime() <= Date.now()) throw new GoneException('该共享素材包已过期');
    throw new ConflictException('共享素材包份数已用尽');
  }

  /** 剩余量创建人与领取人共用同一计算口径，保证两边看到的数字一致 */
  private buildClaimResult(pack: SharedPackDocument, claim: PackClaimDocument, repeated: boolean): PackClaimResult {
    return {
      packId: pack._id.toString(),
      claimCode: pack.claimCode,
      claimId: claim._id.toString(),
      claimantId: claim.claimantId,
      claimedAt: claim.claimedAt,
      expiresAt: pack.expiresAt,
      totalCopies: pack.totalCopies,
      remainingCopies: Math.max(pack.totalCopies - pack.claimedCount, 0),
      assets: pack.assets.map((asset) => ({
        assetId: asset.assetId.toString(),
        title: asset.title,
        assetType: asset.assetType,
        fileFormat: asset.fileFormat,
        fileUrl: asset.fileUrl,
        thumbnailUrl: asset.thumbnailUrl,
        licenseType: asset.licenseType,
        licenseVersion: asset.licenseVersion,
        frozenAt: asset.frozenAt,
      })),
      repeated,
    };
  }
}
