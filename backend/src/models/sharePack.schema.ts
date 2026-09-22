import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { LicenseType, SharePackStatus } from '../types/enums';
import type { SharePackSnapshotItem } from '../types/interfaces';

export type SharePackDocument = HydratedDocument<SharePack> & { createdAt: Date; updatedAt: Date };

@Schema({ timestamps: true })
export class SharePack {
  @Prop({ required: true })
  name!: string;

  @Prop({ type: Types.ObjectId, ref: 'Collection', required: true })
  collectionId!: Types.ObjectId;

  @Prop({ required: true })
  creatorId!: string;

  @Prop({ required: true, unique: true })
  claimCode!: string;

  @Prop({ enum: SharePackStatus, default: SharePackStatus.Active })
  status!: SharePackStatus;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ required: true, min: 1 })
  totalQuota!: number;

  @Prop({ default: 0 })
  claimedCount!: number;

  /** 生成时冻结的素材清单与许可快照，不随收藏集或素材后续变更 */
  @Prop({
    type: [
      {
        _id: false,
        assetId: { type: String, required: true },
        title: { type: String, required: true },
        licenseType: { type: String, enum: LicenseType, required: true },
        licenseVersion: { type: String, required: true },
      },
    ],
    default: [],
  })
  items!: SharePackSnapshotItem[];
}

export const SharePackSchema = SchemaFactory.createForClass(SharePack);
SharePackSchema.index({ creatorId: 1, createdAt: -1 });
