import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { LicenseType, SharedPackStatus } from '../types/enums';

export type SharedPackDocument = HydratedDocument<SharedPack>;
export type PackAssetSnapshotDocument = HydratedDocument<PackAssetSnapshot>;

/**
 * 生成共享包时冻结的素材清单条目与许可快照。
 * 此后收藏集增减素材、素材本身的标题/许可/URL 变更均不会影响该快照。
 */
@Schema({ _id: false })
export class PackAssetSnapshot {
  @Prop({ type: Types.ObjectId, ref: 'Asset', required: true })
  assetId!: Types.ObjectId;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  assetType!: string;

  @Prop({ required: true })
  fileFormat!: string;

  @Prop({ required: true })
  fileUrl!: string;

  @Prop()
  thumbnailUrl?: string;

  @Prop({ type: String, enum: LicenseType, required: true })
  licenseType!: LicenseType;

  @Prop({ required: true })
  licenseVersion!: string;

  @Prop({ required: true })
  frozenAt!: Date;
}

export const PackAssetSnapshotSchema = SchemaFactory.createForClass(PackAssetSnapshot);

@Schema({ timestamps: true })
export class SharedPack {
  @Prop({ type: Types.ObjectId, ref: 'Collection', required: true })
  collectionId!: Types.ObjectId;

  @Prop({ required: true })
  creatorId!: string;

  @Prop({ required: true, unique: true, trim: true, uppercase: true })
  claimCode!: string;

  @Prop({ required: true, min: 1 })
  totalCopies!: number;

  @Prop({ required: true, default: 0, min: 0 })
  claimedCount!: number;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ enum: SharedPackStatus, default: SharedPackStatus.Active })
  status!: SharedPackStatus;

  /** 生成时刻冻结的素材清单与许可快照，创建后不可变 */
  @Prop({ type: [PackAssetSnapshotSchema], default: [], immutable: true })
  assets!: PackAssetSnapshot[];

  @Prop()
  revokedAt?: Date;

  @Prop()
  revokeReason?: string;
}

export const SharedPackSchema = SchemaFactory.createForClass(SharedPack);
