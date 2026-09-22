import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { Asset, type AssetDocument } from '../models/asset.schema';
import { Collection, type CollectionDocument } from '../models/collection.schema';
import { SharePack, type SharePackDocument } from '../models/sharePack.schema';
import { SharePackClaim, type SharePackClaimDocument } from '../models/sharePackClaim.schema';
import { AssetStatus, SharePackStatus, UserRole } from '../types/enums';
import type {
  AuthUser,
  CreateSharePackPayload,
  SharePackClaimView,
  SharePackSnapshotItem,
  SharePackSummaryView,
} from '../types/interfaces';

@Injectable()
export class SharePackService {
  constructor(
    @InjectModel(SharePack.name) private readonly sharePackModel: Model<SharePackDocument>,
    @InjectModel(SharePackClaim.name) private readonly sharePackClaimModel: Model<SharePackClaimDocument>,
    @InjectModel(Collection.name) private readonly collectionModel: Model<CollectionDocument>,
    @InjectModel(Asset.name) private readonly assetModel: Model<AssetDocument>,
  ) {}

  async create(user: AuthUser, payload: CreateSharePackPayload): Promise<SharePackSummaryView> {
    if (!payload.collectionId) throw new BadRequestException('collectionId 不能为空');
    const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : undefined;
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) throw new BadRequestException('有效期 expiresAt 不合法');
    if (expiresAt.getTime() <= Date.now()) throw new BadRequestException('有效期必须晚于当前时间');
    const totalQuota = Number(payload.totalQuota);
    if (!Number.isInteger(totalQuota) || totalQuota < 1) throw new BadRequestException('总领取份数必须为不小于 1 的整数');

    const collection = await this.collectionModel.findById(payload.collectionId).exec();
    if (!collection) throw new NotFoundException('收藏集不存在');
    if (collection.creatorId !== user.id) throw new ForbiddenException('只有收藏集创建人可以生成共享素材包');

    const items = await this.buildSnapshot(collection, payload.assetIds);
    const doc = {
      name: payload.name?.trim() || `${collection.name} 共享素材包`,
      collectionId: collection._id,
      creatorId: user.id,
      status: SharePackStatus.Active,
      expiresAt,
      totalQuota,
      claimedCount: 0,
      items,
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimCode = payload.claimCode?.trim() || this.generateClaimCode();
      try {
        const pack = await this.sharePackModel.create({ ...doc, claimCode });
        return this.toSummaryView(pack);
      } catch (err) {
        if (!this.isDuplicateKey(err)) throw err;
        if (payload.claimCode) break; // 用户指定的领用码冲突，直接报错不自动换码
      }
    }
    throw new ConflictException('领用码已被占用，请更换');
  }

  async claim(code: string, user: AuthUser): Promise<SharePackClaimView> {
    if (!code?.trim()) throw new BadRequestException('领用码不能为空');
    const pack = await this.sharePackModel.findOne({ claimCode: code.trim() }).exec();
    if (!pack) throw new NotFoundException('素材包不存在或领用码无效');

    // 同一账号重复领取：直接返回原结果，不占用份数
    const existing = await this.sharePackClaimModel.findOne({ packId: pack._id, claimerId: user.id }).exec();
    if (existing) return this.toClaimView(pack, existing, true);

    this.ensureClaimable(pack);

    // 原子扣减份数：条件不满足（过期/撤销/用尽）时更新结果为 null，并发下不会超卖
    const updated = await this.sharePackModel
      .findOneAndUpdate(
        {
          _id: pack._id,
          status: SharePackStatus.Active,
          expiresAt: { $gt: new Date() },
          claimedCount: { $lt: pack.totalQuota },
        },
        { $inc: { claimedCount: 1 } },
        { new: true },
      )
      .exec();
    if (!updated) {
      const fresh = await this.sharePackModel.findById(pack._id).exec();
      this.ensureClaimable(fresh);
      throw new ConflictException('领取份数已用尽');
    }

    try {
      const claim = await this.sharePackClaimModel.create({ packId: updated._id, claimerId: user.id });
      return this.toClaimView(updated, claim, false);
    } catch (err) {
      if (this.isDuplicateKey(err)) {
        // 同一账号并发领取撞唯一索引：回滚份数，返回先到的领取结果
        await this.sharePackModel.updateOne({ _id: updated._id }, { $inc: { claimedCount: -1 } }).exec();
        const [original, fresh] = await Promise.all([
          this.sharePackClaimModel.findOne({ packId: updated._id, claimerId: user.id }).exec(),
          this.sharePackModel.findById(updated._id).exec(),
        ]);
        if (original && fresh) return this.toClaimView(fresh, original, true);
      }
      throw err;
    }
  }

  async revoke(packId: string, user: AuthUser): Promise<SharePackSummaryView> {
    const pack = await this.sharePackModel.findById(packId).exec();
    if (!pack) throw new NotFoundException('素材包不存在');
    this.ensureOwner(pack, user, '撤销');
    if (pack.status !== SharePackStatus.Active) throw new ConflictException('素材包已撤销');
    pack.status = SharePackStatus.Revoked;
    await pack.save();
    return this.toSummaryView(pack);
  }

  async findMine(user: AuthUser): Promise<SharePackSummaryView[]> {
    const packs = await this.sharePackModel.find({ creatorId: user.id }).sort({ createdAt: -1 }).exec();
    return packs.map((pack) => this.toSummaryView(pack));
  }

  async findOneForCreator(packId: string, user: AuthUser): Promise<SharePackSummaryView> {
    const pack = await this.sharePackModel.findById(packId).exec();
    if (!pack) throw new NotFoundException('素材包不存在');
    this.ensureOwner(pack, user, '查看');
    return this.toSummaryView(pack);
  }

  /** 冻结收藏集内已发布素材的清单与许可快照 */
  private async buildSnapshot(collection: CollectionDocument, assetIds?: string[]): Promise<SharePackSnapshotItem[]> {
    const collectionAssetIds = (collection.assetIds ?? []).map((id) => id.toString());
    const requestedIds = assetIds?.length ? assetIds.map(String) : collectionAssetIds;
    const outside = requestedIds.filter((id) => !collectionAssetIds.includes(id));
    if (outside.length > 0) throw new BadRequestException('只能挑选收藏集内的素材');
    const uniqueIds = [...new Set(requestedIds)];
    if (uniqueIds.length === 0) throw new BadRequestException('收藏集内没有可打包的素材');

    const assets = await this.assetModel.find({ _id: { $in: uniqueIds.map((id) => new Types.ObjectId(id)) } }).exec();
    const byId = new Map(assets.map((asset) => [asset._id.toString(), asset]));
    return uniqueIds.map((id) => {
      const asset = byId.get(id);
      if (!asset) throw new BadRequestException(`素材 ${id} 不存在`);
      if (asset.status !== AssetStatus.Published) throw new BadRequestException(`素材「${asset.title}」未发布，只能挑选已发布素材`);
      return {
        assetId: id,
        title: asset.title,
        licenseType: asset.licenseType,
        licenseVersion: `${asset.licenseType}-2026.1`,
      };
    });
  }

  private ensureClaimable(pack: SharePackDocument | null) {
    if (!pack) throw new NotFoundException('素材包不存在或领用码无效');
    if (pack.status !== SharePackStatus.Active) throw new GoneException('素材包已被撤销');
    if (pack.expiresAt.getTime() <= Date.now()) throw new GoneException('素材包已过期');
  }

  private ensureOwner(pack: SharePackDocument, user: AuthUser, action: string) {
    if (pack.creatorId !== user.id && user.role !== UserRole.Admin) {
      throw new ForbiddenException(`只有创建人可以${action}素材包`);
    }
  }

  private toSummaryView(pack: SharePackDocument): SharePackSummaryView {
    return {
      id: pack._id.toString(),
      name: pack.name,
      collectionId: pack.collectionId.toString(),
      claimCode: pack.claimCode,
      status: pack.status,
      expiresAt: pack.expiresAt,
      totalQuota: pack.totalQuota,
      claimedCount: pack.claimedCount,
      remainingQuota: Math.max(pack.totalQuota - pack.claimedCount, 0),
      items: pack.items,
      createdAt: pack.createdAt,
    };
  }

  private toClaimView(pack: SharePackDocument, claim: SharePackClaimDocument, duplicated: boolean): SharePackClaimView {
    return {
      packId: pack._id.toString(),
      name: pack.name,
      claimCode: pack.claimCode,
      claimerId: claim.claimerId,
      claimedAt: claim.claimedAt,
      totalQuota: pack.totalQuota,
      claimedCount: pack.claimedCount,
      remainingQuota: Math.max(pack.totalQuota - pack.claimedCount, 0),
      duplicated,
      items: pack.items,
    };
  }

  private generateClaimCode(): string {
    return `SP-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private isDuplicateKey(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
  }
}
